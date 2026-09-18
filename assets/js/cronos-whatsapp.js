(function(){
  'use strict';

  const CONNECTOR='http://127.0.0.1:3210';
  const HUB='https://nsqpslierpulanxvsxaw.supabase.co/functions/v1/whatsapp-hub';
  const CONNECTOR_INSTALLER='/downloads/CronosConnectorSetup.msi';
  const CONNECTOR_RELEASE='0.6.1';
  const DEFAULTS={
    enabled:true,
    appointment_enabled:true, appointment_auto:true, appointment_days_before:1, appointment_time:'14:00',
    birthday_enabled:true, birthday_auto:true, birthday_days_before:0, birthday_time:'09:00',
    installment_enabled:true, installment_auto:true, installment_days_before:1, installment_time:'10:00',
    appointment_template:'Olá, {{primeiroNome}}! 😊 Sua consulta na {{clinica}} está agendada para amanhã, {{data}}, às {{hora}}, com {{profissional}}. Podemos confirmar sua presença?',
    birthday_template:'Oi, {{primeiroNome}}! Feliz aniversário! 🥳 A equipe da {{clinica}} deseja um novo ciclo cheio de saúde, alegria e muitos motivos pra sorrir.',
    installment_template:'Olá, {{primeiroNome}}! Passando para lembrar que sua parcela de {{valor}} vence amanhã ({{vencimento}}). Forma de pagamento: {{forma}}. Se já realizou o pagamento, desconsidere esta mensagem.'
  };

  let modal=null, installModal=null, installPollTimer=null, installAutoContinue=false, installChecking=false, pollTimer=null, activationTimer=null, settingsTimer=null, automationTimer=null;
  let current={phone:'',message:'',title:'WhatsApp'}, sending=false, sentForCurrentOpen=false, localState=null, globalState=null, waSettings={...DEFAULTS};
  let enrollPromise=null, lastAutomationMinute='', settingsLoadedClinic='', settingsFormClinic='', settingsFetchedAt=0;

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const clinicId=()=>String(window.__CRONOS_CLINIC_ID__||window.CRONOS_WHATSAPP_DATA?.clinicId?.()||'').trim();
  const sb=()=>window.__CRONOS_SUPABASE_CLIENT__||null;

  function normalizePhone(value){ let d=String(value||'').replace(/\D/g,''); if((d.length===10||d.length===11)&&!d.startsWith('55'))d=`55${d}`; return d; }
  function formatPhone(value){ const d=normalizePhone(value); if(d.startsWith('55')&&d.length>=12){const l=d.slice(2),ddd=l.slice(0,2),n=l.slice(2);return n.length===9?`+55 (${ddd}) ${n.slice(0,5)}-${n.slice(5)}`:`+55 (${ddd}) ${n.slice(0,4)}-${n.slice(4)}`;} return d?`+${d}`:''; }
  function parseWhatsAppUrl(raw){ try{const u=new URL(raw,location.href),h=u.hostname.toLowerCase();if(!['wa.me','api.whatsapp.com','web.whatsapp.com'].includes(h))return null;let p=h==='wa.me'?u.pathname.replace(/\D/g,''):'';if(!p)p=String(u.searchParams.get('phone')||'').replace(/\D/g,'');return{phone:normalizePhone(p),message:u.searchParams.get('text')||''};}catch(_){return null;} }
  function localDateISO(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function hhmm(){const d=new Date();return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
  function cleanTime(v){const m=String(v||'').match(/^(\d{2}):(\d{2})/);return m?`${m[1]}:${m[2]}`:'14:00';}
  function template(tpl,vars){return String(tpl||'').replace(/\{\{\s*([\wÀ-ÿ]+)\s*\}\}/g,(_,k)=>String(vars?.[k]??'')).replace(/\{([\wÀ-ÿ]+)\}/g,(_,k)=>String(vars?.[k]??''));}

  function localErrorMessage(error){
    if(error?.name==='AbortError')return 'O Cronos WhatsApp Connector não respondeu a tempo.';
    if(location.protocol==='file:')return 'O navegador bloqueou o acesso do Cronos ao Connector porque esta versão foi aberta direto pelo arquivo. Abra pelo atalho "Abrir Cronos Local" ou pelo site do Cronos.';
    const raw=String(error?.message||error||'').trim();
    if(/failed to fetch|networkerror|load failed/i.test(raw))return 'Não foi possível acessar o Cronos WhatsApp Connector em 127.0.0.1:3210.';
    return raw||'Falha ao acessar o Cronos WhatsApp Connector.';
  }

  async function localRequest(path,options={}){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),Number(options.timeoutMs||2500));
    const opts={...options};delete opts.timeoutMs;
    try{
      const r=await fetch(`${CONNECTOR}${path}`,{...opts,mode:'cors',cache:'no-store',targetAddressSpace:'loopback',headers:{'Content-Type':'application/json',...(opts.headers||{})},signal:controller.signal});
      const d=await r.json().catch(()=>({}));if(!r.ok||d?.ok===false)throw new Error(d?.error||`Connector ${r.status}`);return d;
    }catch(error){
      const wrapped=new Error(localErrorMessage(error));wrapped.cause=error;throw wrapped;
    }finally{clearTimeout(timeout);}
  }


  async function connectorHealth(){
    try{return await localRequest('/health',{timeoutMs:1200});}catch(_){return null;}
  }

  function isLocalPreview(){
    return location.hostname==='127.0.0.1'||location.hostname==='localhost';
  }

  async function installerAvailability(){
    try{
      const r=await fetch(CONNECTOR_INSTALLER,{method:'HEAD',cache:'no-store'});
      return {available:r.ok,status:r.status};
    }catch(error){
      return {available:false,status:0,error};
    }
  }

  async function refreshInstallerAvailability(){
    const w=ensureInstallModal();
    const download=w.querySelector('#cronosWaInstallDownload');
    if(!download)return false;
    download.disabled=true;
    download.textContent='Verificando instalador...';
    const result=await installerAvailability();
    if(result.available){
      download.disabled=false;
      download.textContent='Instalar integração';
      return true;
    }
    if(isLocalPreview()){
      setInstallState('waiting','Prévia local','O instalador MSI é gerado automaticamente pelo GitHub Actions e não existe dentro do ZIP de desenvolvimento. Publique esta versão para testar a instalação final.');
      download.disabled=true;
      download.textContent='Disponível após publicar';
    }else{
      setInstallState('waiting','Instalador temporariamente indisponível','O pacote de instalação ainda não foi publicado neste endereço. Tente novamente em instantes.');
      download.disabled=false;
      download.textContent='Verificar instalador';
    }
    return false;
  }

  function ensureInstallModal(){
    if(installModal)return installModal;
    const wrap=document.createElement('div');
    wrap.id='cronosWaInstallModal';wrap.className='cronosWaInstallModal';wrap.setAttribute('aria-hidden','true');
    wrap.innerHTML=`<div class="cronosWaInstallBackdrop" data-wa-install-close></div><section class="cronosWaInstallDialog" role="dialog" aria-modal="true" aria-labelledby="cronosWaInstallTitle"><header class="cronosWaInstallHeader"><div class="cronosWaInstallBrand"><span class="cronosWaInstallLogo" aria-hidden="true">W</span><div><h2 id="cronosWaInstallTitle">Preparar WhatsApp neste computador</h2><p>Configuração necessária apenas uma vez</p></div></div><button class="cronosWaInstallClose" type="button" data-wa-install-close aria-label="Fechar">×</button></header><div class="cronosWaInstallBody"><div class="cronosWaInstallState" id="cronosWaInstallState" data-state="waiting"><span class="cronosWaInstallStateDot"></span><div><strong id="cronosWaInstallStateTitle">Integração ainda não instalada</strong><span id="cronosWaInstallStateDetail">O Cronos precisa preparar este computador para manter o WhatsApp conectado.</span></div></div><div class="cronosWaInstallIntro"><h3>Instalação rápida</h3><p>O Cronos usa o instalador padrão do Windows para preparar a integração e detecta sozinho quando estiver pronto. Você não precisa extrair ZIP nem configurar portas ou pastas.</p></div><ol class="cronosWaInstallSteps"><li><span>1</span><div><strong>Instale a integração</strong><small>Clique no botão abaixo e abra o arquivo <b>CronosConnectorSetup.msi</b> que for baixado.</small></div></li><li><span>2</span><div><strong>Aguarde a confirmação</strong><small>O instalador prepara tudo em segundo plano e avisa quando terminar.</small></div></li><li><span>3</span><div><strong>Volte para o Cronos</strong><small>Esta janela detecta a instalação automaticamente e continua para o QR Code.</small></div></li></ol><div class="cronosWaInstallNotice">A instalação usa o Windows Installer no seu usuário. Em produção, o pacote pode ser assinado digitalmente para exibir a identidade do Cronos como editor.</div></div><footer class="cronosWaInstallFooter"><button class="cronosWaBtn cronosWaBtnSecondary" id="cronosWaInstallVerify" type="button">Verificar novamente</button><button class="cronosWaBtn cronosWaBtnPrimary" id="cronosWaInstallDownload" type="button">Instalar integração</button></footer></section>`;
    document.body.appendChild(wrap);
    wrap.querySelectorAll('[data-wa-install-close]').forEach(b=>b.addEventListener('click',closeInstallModal));
    wrap.querySelector('#cronosWaInstallDownload').addEventListener('click',async()=>{
      const available=await refreshInstallerAvailability();
      if(!available)return;
      const a=document.createElement('a');a.href=CONNECTOR_INSTALLER;a.download='CronosConnectorSetup.msi';document.body.appendChild(a);a.click();a.remove();
      setInstallState('installing','Aguardando a instalação...','Abra o arquivo baixado. Assim que terminar, o Cronos continua automaticamente.');
      startInstallWatch(true);
    });
    wrap.querySelector('#cronosWaInstallVerify').addEventListener('click',()=>void checkInstallNow(true));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&wrap.classList.contains('open'))closeInstallModal();});
    installModal=wrap;return wrap;
  }

  function setInstallState(state,title,detail){
    const w=ensureInstallModal();const box=w.querySelector('#cronosWaInstallState');box.dataset.state=state;
    w.querySelector('#cronosWaInstallStateTitle').textContent=title;w.querySelector('#cronosWaInstallStateDetail').textContent=detail;
    const download=w.querySelector('#cronosWaInstallDownload');const verify=w.querySelector('#cronosWaInstallVerify');
    if(state==='ready'){download.disabled=true;verify.disabled=true;}else{verify.disabled=false;}
  }

  function openInstallModal(autoContinue=true){
    const w=ensureInstallModal();installAutoContinue=autoContinue!==false;
    setInstallState('waiting','Integração ainda não instalada','Instale uma vez neste computador para conectar o WhatsApp pelo Cronos.');
    w.classList.add('open');w.setAttribute('aria-hidden','false');document.documentElement.classList.add('cronosWaModalOpen');
    void refreshInstallerAvailability();
    startInstallWatch(installAutoContinue);return w;
  }

  function closeInstallModal(){
    if(!installModal)return;installModal.classList.remove('open');installModal.setAttribute('aria-hidden','true');
    if(!modal?.classList.contains('open'))document.documentElement.classList.remove('cronosWaModalOpen');
    if(installPollTimer){clearInterval(installPollTimer);installPollTimer=null;}installChecking=false;
  }

  async function checkInstallNow(autoContinue=installAutoContinue){
    if(installChecking)return false;installChecking=true;
    try{
      const health=await connectorHealth();
      if(!health){setInstallState('installing','Ainda aguardando...','Se o download já terminou, abra o CronosConnectorSetup.msi. Esta tela continuará verificando automaticamente.');return false;}
      setInstallState('ready','Integração instalada ✓',`Cronos WhatsApp ${health.version||CONNECTOR_RELEASE} detectado. Continuando a conexão...`);
      await refreshAllStatus();
      if(autoContinue){
        installAutoContinue=false;
        setTimeout(async()=>{closeInstallModal();await connectFromSettings({skipInstallerCheck:true});},700);
      }
      return true;
    }finally{installChecking=false;}
  }

  function startInstallWatch(autoContinue=true){
    installAutoContinue=autoContinue!==false;
    if(installPollTimer)clearInterval(installPollTimer);
    void checkInstallNow(installAutoContinue);
    installPollTimer=setInterval(()=>void checkInstallNow(installAutoContinue),1200);
  }

  async function userHub(action,payload={},timeoutMs=8000){
    const id=clinicId(); if(!id) throw new Error('Clínica ainda não identificada.');
    const client=sb(); if(!client) throw new Error('Sessão do Cronos indisponível.');
    const session=await client.auth.getSession(); const token=session?.data?.session?.access_token;
    if(!token) throw new Error('Faça login novamente no Cronos.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const r=await fetch(HUB,{method:'POST',mode:'cors',cache:'no-store',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({action,clinic_id:id,...payload}),signal:controller.signal});
      const d=await r.json().catch(()=>({}));if(!r.ok||d?.ok===false)throw new Error(d?.error||`WhatsApp Hub ${r.status}`);return d;
    }finally{clearTimeout(timer);}
  }

  async function ensureLocalBinding(){
    const id=clinicId(); if(!id) return null;
    if(enrollPromise) return enrollPromise;
    enrollPromise=(async()=>{
      const device=await localRequest('/api/device',{timeoutMs:1800});
      if(device?.bound&&String(device.clinicId||'')===id) return device;
      const enrolled=await userHub('enroll',{device_id:device.deviceId,device_name:device.deviceName});
      await localRequest('/api/bind',{method:'POST',body:JSON.stringify({clinicId:id,deviceToken:enrolled.deviceToken,hubUrl:HUB}),timeoutMs:5000});
      return await localRequest('/api/device',{timeoutMs:1800});
    })();
    try{return await enrollPromise;}finally{enrollPromise=null;}
  }

  async function activateThisComputer(){
    try{
      await ensureLocalBinding();
      await localRequest('/api/activate',{method:'POST',body:JSON.stringify({clinicId:clinicId()}),timeoutMs:2500});
    }catch(_){ }
  }

  function ensureModal(){
    if(modal)return modal;
    const wrap=document.createElement('div');wrap.id='cronosWaModal';wrap.className='cronosWaModal';wrap.setAttribute('aria-hidden','true');
    wrap.innerHTML=`<div class="cronosWaBackdrop" data-wa-close></div><section class="cronosWaDialog" role="dialog" aria-modal="true" aria-labelledby="cronosWaTitle"><header class="cronosWaHeader"><div class="cronosWaBrand"><span class="cronosWaLogo" aria-hidden="true">W</span><div><h2 id="cronosWaTitle">WhatsApp</h2><p id="cronosWaRecipient">Destinatário</p></div></div><button class="cronosWaClose" type="button" data-wa-close aria-label="Fechar">×</button></header><div class="cronosWaBody"><div class="cronosWaStatus" id="cronosWaStatus"><span class="cronosWaDot"></span><div><strong id="cronosWaStatusTitle">Verificando WhatsApp...</strong><span id="cronosWaStatusDetail">Consultando a clínica</span></div></div><label class="cronosWaLabel" for="cronosWaMessage">Mensagem</label><textarea id="cronosWaMessage" class="cronosWaMessage" maxlength="4000"></textarea><div id="cronosWaFeedback" class="cronosWaFeedback" aria-live="polite"></div></div><footer class="cronosWaFooter"><button id="cronosWaSend" class="cronosWaBtn cronosWaBtnPrimary" type="button">Enviar</button></footer></section>`;
    document.body.appendChild(wrap);wrap.querySelectorAll('[data-wa-close]').forEach(b=>b.addEventListener('click',close));
    wrap.querySelector('#cronosWaSend').addEventListener('click',sendCurrent);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&wrap.classList.contains('open'))close();});modal=wrap;return wrap;
  }
  const el=id=>ensureModal().querySelector(`#${id}`);
  function setFeedback(text='',tone=''){const n=el('cronosWaFeedback');n.textContent=text;n.className=`cronosWaFeedback${tone?` ${tone}`:''}`;}

  function effectiveStatus(){
    if(globalState?.linked&&globalState?.online)return 'connected';
    if(localState?.status==='qr')return 'qr';
    if(localState?.status==='connecting'||localState?.status==='reconnecting')return localState.status;
    if(localState?.status==='unbound')return 'unbound';
    if(localState?.status==='standby'&&!globalState?.linked)return 'ready';
    if(localState?.status==='local_error')return 'local_error';
    if(globalState?.linked)return 'standby';
    if(localState?.status==='disconnected')return 'disconnected';
    return 'offline';
  }

  function statusText(){
    const status=effectiveStatus();
    if(status==='connected'){
      const who=globalState?.leaderDeviceName?`Responsável: ${globalState.leaderDeviceName}`:'Sessão ativa da clínica';
      return ['WhatsApp conectado',[globalState?.name,formatPhone(globalState?.phone),who].filter(Boolean).join(' · ')];
    }
    if(status==='qr')return ['Leia o QR para conectar','Este QR cria a única sessão de WhatsApp da clínica'];
    if(status==='connecting'||status==='reconnecting')return [status==='reconnecting'?'Transferindo/reconectando sessão...':'Conectando WhatsApp...','O computador responsável está preparando a sessão'];
    if(status==='standby')return ['WhatsApp vinculado','A sessão está salva; aguardando um computador ativo assumir'];
    if(status==='unbound')return ['Computador preparado','Finalizando o vínculo com esta clínica'];
    if(status==='ready')return ['Computador preparado','Pronto para conectar o WhatsApp'];
    if(status==='local_error')return globalState?.linked
      ? ['WhatsApp vinculado à clínica','Este computador ainda não está preparado para assumir os envios']
      : ['Integração necessária neste computador','Clique em Conectar WhatsApp para instalar e continuar'];
    if(status==='disconnected')return ['WhatsApp desconectado',localState?.lastError||'É necessário conectar novamente'];
    return globalState?.linked
      ? ['WhatsApp vinculado à clínica','A sessão pode estar ativa em outro computador da clínica']
      : ['Computador ainda não preparado','Clique em Conectar WhatsApp para instalar a integração'];
  }

  function renderModalStatus(){
    const status=effectiveStatus(),txt=statusText(),box=el('cronosWaStatus');box.dataset.status=status;el('cronosWaStatusTitle').textContent=txt[0];el('cronosWaStatusDetail').textContent=txt[1];
    const send=el('cronosWaSend');send.disabled=sending||sentForCurrentOpen||status!=='connected';
    if(status!=='connected')el('cronosWaStatusDetail').textContent='Conecte o WhatsApp em Configurações → WhatsApp para enviar por aqui.';
  }

  async function refreshAllStatus(){
    const [l,g]=await Promise.allSettled([localRequest('/api/status',{timeoutMs:1800}),userHub('clinic_status',{},4500)]);
    localState=l.status==='fulfilled'?l.value:{status:'local_error',lastError:localErrorMessage(l.reason)};
    globalState=g.status==='fulfilled'?g.value:null;
    if(modal?.classList.contains('open'))renderModalStatus();renderSettingsStatus();
  }

  function startPolling(){stopPolling();refreshAllStatus();pollTimer=setInterval(refreshAllStatus,1800);}
  function stopPolling(){if(pollTimer){clearInterval(pollTimer);pollTimer=null;}}

  function open(options={}){
    const phone=normalizePhone(options.phone||'');if(!phone){window.toast?.('Sem telefone','Esse contato não tem WhatsApp válido.');return false;}
    current={phone,message:String(options.message||''),title:String(options.title||'WhatsApp')};const w=ensureModal();el('cronosWaTitle').textContent=current.title;el('cronosWaRecipient').textContent=formatPhone(phone);el('cronosWaMessage').value=current.message;setFeedback('');sending=false;sentForCurrentOpen=false;w.classList.add('open');w.setAttribute('aria-hidden','false');document.documentElement.classList.add('cronosWaModalOpen');startPolling();setTimeout(()=>el('cronosWaMessage').focus(),40);return true;
  }
  function close(){if(!modal)return;modal.classList.remove('open');modal.setAttribute('aria-hidden','true');document.documentElement.classList.remove('cronosWaModalOpen');stopPolling();sending=false;sentForCurrentOpen=false;const btn=modal.querySelector('#cronosWaSend');if(btn){btn.textContent='Enviar';btn.disabled=false;}}

  async function connectLocal(){
    setFeedback('Preparando a conexão neste computador...','info');
    try{
      await ensureLocalBinding();
      await localRequest('/api/activate',{method:'POST',body:JSON.stringify({clinicId:clinicId()}),timeoutMs:3500});
      await localRequest('/api/connect',{method:'POST',body:'{}',timeoutMs:5000});
      await sleep(700);
      await refreshAllStatus();
      return localState;
    }catch(e){
      setFeedback(e?.message||'Não consegui iniciar a conexão.','error');
      throw e;
    }
  }

  function notifySendSuccess(detail=''){
    try{ if(typeof window.toast==='function') window.toast('Mensagem enviada ✅',detail||'O WhatsApp confirmou o envio.'); }catch(_){ }
  }

  function finishSuccessfulSend(detail=''){
    sentForCurrentOpen=true;
    setFeedback('Mensagem enviada com sucesso.','success');
    notifySendSuccess(detail||formatPhone(current.phone));
    setTimeout(()=>close(),180);
  }

  async function sendCurrent(){
    if(sending||sentForCurrentOpen)return;
    const message=el('cronosWaMessage').value.trim();
    if(!message){setFeedback('Digite a mensagem antes de enviar.','error');return;}
    if(!globalState?.linked||effectiveStatus()!=='connected'){
      setFeedback('O WhatsApp da clínica não está conectado. Vá em Configurações → WhatsApp.','error');
      return;
    }
    sending=true;
    const btn=el('cronosWaSend');
    btn.disabled=true;btn.textContent='Enviando...';
    setFeedback('Enviando pelo WhatsApp da clínica...','info');
    try{
      const queued=await userHub('enqueue',{dispatch_type:'manual',dedupe_key:`manual:${crypto.randomUUID()}`,phone:current.phone,message});
      const id=queued?.dispatch?.id;if(!id)throw new Error('O Hub não retornou o envio.');
      const deadline=Date.now()+22000;let last=null;
      while(Date.now()<deadline){
        await sleep(650);
        const r=await userHub('dispatch_status',{dispatch_id:id},5000);
        last=r?.dispatch;
        const st=last?.status;
        if(st==='read'){finishSuccessfulSend('Mensagem enviada e lida.');return;}
        if(st==='delivered'){finishSuccessfulSend('Mensagem enviada e entregue.');return;}
        if(st==='sent'){finishSuccessfulSend('Mensagem enviada pelo WhatsApp.');return;}
        if(st==='failed')throw new Error(last?.last_error||'O WhatsApp informou falha no envio.');
        if(st==='uncertain'){
          setFeedback('O envio foi iniciado, mas o Cronos não conseguiu confirmar o resultado. Verifique antes de tentar novamente.','info');
          return;
        }
      }
      if(last?.status==='sent'){
        finishSuccessfulSend('Mensagem enviada pelo WhatsApp.');
        return;
      }
      setFeedback('A mensagem continua na fila. Aguarde a confirmação antes de tentar novamente.','info');
    }catch(e){
      setFeedback(e?.message||'Não foi possível enviar.','error');
      await refreshAllStatus();
    }finally{
      sending=false;
      if(!sentForCurrentOpen){btn.textContent='Enviar';btn.disabled=effectiveStatus()!=='connected';}
    }
  }

  function settingsNodes(){
    const card=document.getElementById('cronosWaSettingsCard');if(!card)return null;
    const id=x=>document.getElementById(x);return{
      card,status:id('cronosWaSettingsStatus'),title:id('cronosWaSettingsTitle'),detail:id('cronosWaSettingsDetail'),qr:id('cronosWaSettingsQr'),qrImage:id('cronosWaSettingsQrImage'),toggle:id('cronosWaSettingsToggle'),hint:id('cronosWaSettingsHint'),
      appt:id('cronosWaAppointmentEnabled'),apptAuto:id('cronosWaAppointmentAuto'),apptDays:id('cronosWaAppointmentDaysBefore'),apptTime:id('cronosWaAppointmentTime'),
      birth:id('cronosWaBirthdayEnabled'),birthAuto:id('cronosWaBirthdayAuto'),birthDays:id('cronosWaBirthdayDaysBefore'),birthTime:id('cronosWaBirthdayTime'),
      inst:id('cronosWaInstallmentEnabled'),instAuto:id('cronosWaInstallmentAuto'),instDays:id('cronosWaInstallmentDaysBefore'),instTime:id('cronosWaInstallmentTime'),
      apptTpl:id('cronosWaAppointmentTemplate'),birthTpl:id('cronosWaBirthdayTemplate'),instTpl:id('cronosWaInstallmentTemplate'),save:id('cronosWaSaveAutomation'),automationHint:id('cronosWaAutomationHint')
    };
  }

  function renderSettingsStatus(){
    const n=settingsNodes();if(!n)return;
    const status=effectiveStatus(),txt=statusText();
    n.status.dataset.status=status;n.title.textContent=txt[0];n.detail.textContent=txt[1];n.qr.hidden=true;
    if(localState?.status==='qr'&&localState?.qr){n.qrImage.src=localState.qr;n.qr.hidden=false;}

    if(n.toggle){
      const connected=status==='connected';
      n.toggle.hidden=false;
      n.toggle.textContent=connected?'Desconectar WhatsApp':'Conectar WhatsApp';
      n.toggle.classList.toggle('ok',!connected);
      n.toggle.classList.toggle('danger',connected);
      n.toggle.disabled=status==='connecting'||status==='reconnecting';
    }

    if(status==='local_error'){
      n.hint.textContent=location.protocol==='file:'
        ? 'Abra esta versão pelo atalho "Abrir Cronos Local" ou pelo site do Cronos.'
        : (globalState?.linked?'A sessão da clínica continua disponível. Este computador pode ser preparado quando necessário.':'Ao conectar, o Cronos prepara este computador automaticamente.');
    }else if(status==='offline'){
      n.hint.textContent=globalState?.linked
        ? 'A sessão da clínica existe e pode estar ativa em outro computador.'
        : 'Clique em Conectar WhatsApp para preparar este computador.';
    }else if(status==='ready'&&globalState?.leaderDeviceId&&localState?.deviceId&&globalState.leaderDeviceId!==localState.deviceId){
      n.hint.textContent='Pronto para iniciar o primeiro pareamento do WhatsApp.';
    }else if(globalState?.linked&&globalState?.online){
      n.hint.textContent='Sessão ativa. O status é atualizado automaticamente.';
    }else if(globalState?.linked){
      n.hint.textContent='Sessão vinculada. O computador ativo continuará tentando reconectar automaticamente.';
    }else{
      n.hint.textContent='';
    }
  }

  function fillSettingsForm(s){
    const n=settingsNodes();if(!n)return;
    const incoming=s||{};
    waSettings={...DEFAULTS,...incoming};
    if(incoming.send_time){
      if(incoming.appointment_time===undefined)waSettings.appointment_time=incoming.send_time;
      if(incoming.birthday_time===undefined)waSettings.birthday_time=incoming.send_time;
      if(incoming.installment_time===undefined)waSettings.installment_time=incoming.send_time;
    }
    n.appt.checked=waSettings.appointment_enabled!==false;n.apptAuto.checked=waSettings.appointment_auto!==false;n.apptDays.value=String(Math.max(0,Number(waSettings.appointment_days_before??1)));n.apptTime.value=cleanTime(waSettings.appointment_time);
    n.birth.checked=waSettings.birthday_enabled!==false;n.birthAuto.checked=waSettings.birthday_auto!==false;n.birthDays.value=String(Math.max(0,Number(waSettings.birthday_days_before??0)));n.birthTime.value=cleanTime(waSettings.birthday_time);
    n.inst.checked=waSettings.installment_enabled!==false;n.instAuto.checked=waSettings.installment_auto!==false;n.instDays.value=String(Math.max(0,Number(waSettings.installment_days_before??1)));n.instTime.value=cleanTime(waSettings.installment_time);
    n.apptTpl.value=waSettings.appointment_template||DEFAULTS.appointment_template;n.birthTpl.value=waSettings.birthday_template||DEFAULTS.birthday_template;n.instTpl.value=waSettings.installment_template||DEFAULTS.installment_template;settingsFormClinic=clinicId();
  }

  async function loadSettings(){
    const n=settingsNodes(),cid=clinicId();if(!n||!cid)return;
    try{const r=await userHub('settings_get');fillSettingsForm(r.settings);settingsLoadedClinic=cid;settingsFetchedAt=Date.now();n.automationHint.textContent='';}
    catch(e){fillSettingsForm(waSettings);n.automationHint.textContent=e?.message||'Automações ainda não disponíveis.';}
  }

  async function ensureSettingsFresh(maxAge=120000){
    const cid=clinicId();if(!cid)return false;
    if(settingsLoadedClinic===cid&&Date.now()-settingsFetchedAt<maxAge)return true;
    try{const r=await userHub('settings_get');waSettings={...DEFAULTS,...(r.settings||{})};settingsLoadedClinic=cid;settingsFetchedAt=Date.now();return true;}catch(_){return false;}
  }

  async function saveSettings(){
    const n=settingsNodes();if(!n)return;n.save.disabled=true;n.automationHint.textContent='Salvando...';
    try{
      const payload={
        enabled:true,
        appointment_enabled:n.appt.checked,appointment_auto:n.apptAuto.checked,appointment_days_before:Math.max(0,Number(n.apptDays.value||0)),appointment_time:n.apptTime.value||'14:00',
        birthday_enabled:n.birth.checked,birthday_auto:n.birthAuto.checked,birthday_days_before:Math.max(0,Number(n.birthDays.value||0)),birthday_time:n.birthTime.value||'09:00',
        installment_enabled:n.inst.checked,installment_auto:n.instAuto.checked,installment_days_before:Math.max(0,Number(n.instDays.value||0)),installment_time:n.instTime.value||'10:00',
        appointment_template:n.apptTpl.value.trim(),birthday_template:n.birthTpl.value.trim(),installment_template:n.instTpl.value.trim()
      };
      const r=await userHub('settings_save',{settings:payload});fillSettingsForm(r.settings);settingsLoadedClinic=clinicId();settingsFetchedAt=Date.now();n.automationHint.textContent='Automações salvas.';await runAutomationScan(true);
    }catch(e){n.automationHint.textContent=e?.message||'Não foi possível salvar.';}finally{n.save.disabled=false;}
  }

  async function disconnectClinic(){
    const n=settingsNodes();if(!n)return;
    if(!confirm('Desconectar o WhatsApp desta clínica? Será necessário ler um novo QR para vincular novamente.'))return;
    n.toggle.disabled=true;n.hint.textContent='Solicitando desconexão...';
    try{
      await userHub('disconnect_request');
      for(let i=0;i<16;i++){await sleep(700);await refreshAllStatus();if(!globalState?.linked)break;}
      n.hint.textContent=globalState?.linked?'A solicitação foi enviada ao computador responsável.':'WhatsApp desconectado.';
    }catch(e){n.hint.textContent=e?.message||'Não foi possível desconectar.';}
    finally{n.toggle.disabled=false;renderSettingsStatus();}
  }

  async function refreshSettingsStatus(){await refreshAllStatus();}
  async function connectFromSettings(options={}){
    const n=settingsNodes();if(!n)return;
    if(options.skipInstallerCheck!==true){
      const health=await connectorHealth();
      if(!health){openInstallModal(true);return;}
    }
    n.toggle.disabled=true;n.hint.textContent='Preparando este computador...';
    try{
      await connectLocal();
      const status=effectiveStatus();
      n.hint.textContent=status==='qr'?'QR Code pronto. Leia com o WhatsApp do celular.':status==='connected'?'WhatsApp conectado.':'Computador preparado. Atualizando a sessão...';
    }catch(e){
      n.hint.textContent=e?.message||'Falha ao conectar.';
    }finally{
      n.toggle.disabled=false;
      renderSettingsStatus();
    }
  }

  async function toggleConnectionFromSettings(){
    if(effectiveStatus()==='connected') return disconnectClinic();
    return connectFromSettings();
  }

  function initSettingsPanel(){
    const n=settingsNodes();if(!n)return;
    n.toggle?.addEventListener('click',toggleConnectionFromSettings);
    n.save?.addEventListener('click',saveSettings);
    loadSettings();refreshSettingsStatus();
    if(settingsTimer)clearInterval(settingsTimer);
    settingsTimer=setInterval(()=>{const view=document.getElementById('view-settings');if(view&&!view.classList.contains('hidden')){refreshSettingsStatus();if(settingsFormClinic!==clinicId())void loadSettings();}},3000);
  }

  async function enqueueCandidate(type,item,tpl){
    const message=template(tpl,item.vars);if(!message.trim()||!item.phone)return;
    const dedupe=`auto:${type}:${item.entityId}:${item.referenceDate}`;
    await userHub('enqueue',{dispatch_type:type,dedupe_key:dedupe,entity_id:item.entityId,reference_date:item.referenceDate,phone:item.phone,message});
  }

  function dateAdd(iso,days){
    const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return '';
    const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12,0,0,0);d.setDate(d.getDate()+Number(days||0));
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function dateBR(iso){
    const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}/${m[1]}`:String(iso||'');
  }
  function moneyBR(value){
    const n=Number(value||0);try{return n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}catch(_){return `R$ ${n.toFixed(2).replace('.',',')}`;}
  }
  function appDb(){
    try{return typeof window.loadDB==='function'?window.loadDB():null;}catch(_){return null;}
  }
  function clinicLabel(db){
    try{
      const a=typeof window.currentActor==='function'?window.currentActor():null;
      const byClinic=db?.settings?.clinicBranding?.byClinic||{};
      const keys=[a?.masterId,a?.clinicId,a?.authUid,a?.id].filter(Boolean).map(String);
      for(const key of keys){if(byClinic[key]?.clinicName)return String(byClinic[key].clinicName);}
      return String(db?.settings?.clinicName||db?.settings?.clinic||a?.clinicName||a?.masterName||'Clínica');
    }catch(_){return 'Clínica';}
  }
  function professionalsMap(db){
    let list=[];
    try{if(typeof window.cronosGetProfessionals==='function')list=window.cronosGetProfessionals(db,typeof window.currentActor==='function'?window.currentActor():null,{activeOnly:false})||[];}catch(_){}
    if(!list.length)list=Array.isArray(db?.settings?.professionals)?db.settings.professionals:[];
    return new Map(list.map(p=>[String(p?.id||''),String(p?.name||'Profissional')]));
  }
  function contactMap(db){return new Map((Array.isArray(db?.contacts)?db.contacts:[]).map(x=>[String(x?.id||''),x]));}
  function validAutoStatus(value){
    const s=String(value||'').toLowerCase();
    return !s.includes('desmarc')&&!s.includes('cancel')&&!s.includes('remarc')&&!s.includes('falt')&&!s.includes('realiz');
  }
  function buildScheduledCandidates(){
    const db=appDb();if(!db)return null;
    const today=localDateISO(),contacts=contactMap(db),pros=professionalsMap(db),clinic=clinicLabel(db);
    const result={appointments:[],birthdays:[],installments:[]};
    const apptDate=dateAdd(today,Math.max(0,Number(waSettings.appointment_days_before??1)));
    const agenda=db?.settings?.agendaData||{},overrides=agenda?.overrides||{};
    for(const e of Array.isArray(db.entries)?db.entries:[]){
      const key=String(e?.id||''),ov=overrides[key]||{};
      const date=String(ov.date||e?.apptDate||'').slice(0,10),time=String(ov.time||e?.apptTime||'').slice(0,5);
      const status=String(ov.agendaStatus||ov.status||e?.status||'');
      if(date!==apptDate||!time||!validAutoStatus(status))continue;
      const contact=contacts.get(String(e?.contactId||''))||{};
      const phone=normalizePhone(contact.phone||e?.phone||'');if(!phone)continue;
      const name=String(contact.name||e?.name||e?.lead||'Paciente'),professional=pros.get(String(ov.professionalId??e?.professionalId??''))||'Profissional';
      result.appointments.push({entityId:`entry:${key}`,referenceDate:date,phone,vars:{primeiroNome:name.trim().split(/\s+/)[0]||name,nome:name,clinica:clinic,data:dateBR(date),hora:time,profissional:professional}});
    }
    for(const a of Array.isArray(agenda?.appointments)?agenda.appointments:[]){
      const date=String(a?.date||'').slice(0,10),time=String(a?.time||'').slice(0,5);
      if(date!==apptDate||!time||!validAutoStatus(a?.agendaStatus||a?.status||''))continue;
      const contact=contacts.get(String(a?.contactId||''))||{};
      const phone=normalizePhone(contact.phone||a?.phone||'');if(!phone)continue;
      const name=String(contact.name||a?.patient||'Paciente'),professional=pros.get(String(a?.professionalId||''))||'Profissional';
      result.appointments.push({entityId:`agenda:${a?.id||''}`,referenceDate:date,phone,vars:{primeiroNome:name.trim().split(/\s+/)[0]||name,nome:name,clinica:clinic,data:dateBR(date),hora:time,profissional:professional}});
    }

    const birthOffset=Math.max(0,Number(waSettings.birthday_days_before??0));
    const targetBirthday=dateAdd(today,birthOffset),targetParts=targetBirthday.split('-');
    for(const contact of Array.isArray(db.contacts)?db.contacts:[]){
      const raw=String(contact?.birthDate||contact?.birthday||contact?.birth_date||'').slice(0,10),m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if(!m||m[2]!==targetParts[1]||m[3]!==targetParts[2])continue;
      const phone=normalizePhone(contact?.phone||'');if(!phone)continue;
      const name=String(contact?.name||'Paciente');
      let age=Number(targetParts[0])-Number(m[1]);if(!Number.isFinite(age)||age<0||age>130)age='';
      result.birthdays.push({entityId:`contact:${contact?.id||name}`,referenceDate:targetBirthday,phone,vars:{primeiroNome:name.trim().split(/\s+/)[0]||name,nome:name,clinica:clinic,idade:String(age)}});
    }

    const installmentDate=dateAdd(today,Math.max(0,Number(waSettings.installment_days_before??1)));
    const seen=new Set();
    const addInstallment=(entry,pay,planTitle='')=>{
      const due=String(pay?.dueDate||pay?.due||'').slice(0,10);if(due!==installmentDate)return;
      const method=String(pay?.payMethod||pay?.method||pay?.paymentMethod||'').toLowerCase();
      if(method&&!method.includes('pix')&&!method.includes('boleto'))return;
      const status=String(pay?.status||'').toLowerCase();if(status.includes('paid')||status.includes('pago')||status.includes('receb'))return;
      const contact=contacts.get(String(entry?.contactId||''))||{};
      const phone=normalizePhone(contact.phone||entry?.phone||'');if(!phone)return;
      const id=String(pay?.id||`${due}:${pay?.number||''}:${pay?.amount||''}`),dedupe=`${entry?.id||''}:${id}`;if(seen.has(dedupe))return;seen.add(dedupe);
      const name=String(contact.name||entry?.name||entry?.lead||'Paciente');
      result.installments.push({entityId:`installment:${dedupe}`,referenceDate:due,phone,vars:{primeiroNome:name.trim().split(/\s+/)[0]||name,nome:name,clinica:clinic,valor:moneyBR(pay?.amount||pay?.value||0),vencimento:dateBR(due),forma:String(pay?.payMethod||pay?.method||pay?.paymentMethod||''),parcela:String(pay?.number||''),total:String(pay?.total||''),titulo:String(planTitle||'')}});
    };
    for(const e of Array.isArray(db.entries)?db.entries:[]){
      for(const p of Array.isArray(e?.installments)?e.installments:[])addInstallment(e,p,e?.installPlan?.title||e?.treatment||'');
      for(const plan of Array.isArray(e?.financialPlans)?e.financialPlans:[])for(const p of Array.isArray(plan?.payments)?plan.payments:[])addInstallment(e,p,plan?.title||e?.treatment||'');
    }
    return result;
  }

  async function runAutomationScan(force=false){
    if(!clinicId())return;const now=hhmm(),minuteKey=`${localDateISO()}|${now}`;if(!force&&minuteKey===lastAutomationMinute)return;lastAutomationMinute=minuteKey;
    try{
      await ensureSettingsFresh(120000);
      const data=buildScheduledCandidates()||window.CRONOS_WHATSAPP_DATA?.buildAutomationCandidates?.();if(!data)return;
      const jobs=[];
      if(waSettings.appointment_enabled!==false&&waSettings.appointment_auto!==false&&now>=cleanTime(waSettings.appointment_time))for(const x of data.appointments||[])jobs.push(enqueueCandidate('appointment',x,waSettings.appointment_template));
      if(waSettings.birthday_enabled!==false&&waSettings.birthday_auto!==false&&now>=cleanTime(waSettings.birthday_time))for(const x of data.birthdays||[])jobs.push(enqueueCandidate('birthday',x,waSettings.birthday_template));
      if(waSettings.installment_enabled!==false&&waSettings.installment_auto!==false&&now>=cleanTime(waSettings.installment_time))for(const x of data.installments||[])jobs.push(enqueueCandidate('installment',x,waSettings.installment_template));
      for(let i=0;i<jobs.length;i+=8)await Promise.allSettled(jobs.slice(i,i+8));
    }catch(_){ }
  }

  function interceptLinks(){document.addEventListener('click',ev=>{const a=ev.target.closest?.('a[href]');if(!a)return;const p=parseWhatsAppUrl(a.href||a.getAttribute('href'));if(!p?.phone)return;ev.preventDefault();const label=String(a.textContent||'').trim().toLowerCase();open({phone:p.phone,message:p.message,title:a.dataset?.waTitle||(label.includes('cobrar')?'Enviar cobrança pelo WhatsApp':'Enviar WhatsApp')});},true);}

  function startBackground(){
    if(activationTimer)clearInterval(activationTimer);activationTimer=setInterval(()=>{void activateThisComputer();},20000);setTimeout(()=>void activateThisComputer(),2500);
    if(automationTimer)clearInterval(automationTimer);automationTimer=setInterval(()=>void runAutomationScan(false),30000);setTimeout(()=>void runAutomationScan(false),7000);
  }

  async function enqueueAutomation(options={}){
    const type=String(options.type||'automation');
    const entityId=String(options.entityId||'');
    const referenceDate=String(options.referenceDate||localDateISO());
    const phone=normalizePhone(options.phone||'');
    const message=String(options.message||'').trim();
    if(!phone||!message)throw new Error('Envio automático sem telefone ou mensagem.');
    const dedupeKey=String(options.dedupeKey||`auto:${type}:${entityId}:${referenceDate}`);
    return userHub('enqueue',{dispatch_type:type,dedupe_key:dedupeKey,entity_id:entityId,reference_date:referenceDate,phone,message});
  }

  interceptLinks();initSettingsPanel();startBackground();
  window.CRONOS_WHATSAPP=Object.freeze({open,close,status:refreshAllStatus,settingsStatus:refreshSettingsStatus,normalizePhone,parseUrl:parseWhatsAppUrl,connectorUrl:CONNECTOR,hubUrl:HUB,installerUrl:CONNECTOR_INSTALLER,install:()=>openInstallModal(false),runAutomationScan:()=>runAutomationScan(true),enqueueAutomation});
})();
