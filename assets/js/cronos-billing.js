(function(){
  'use strict';
  const BUILD='billing-v1-4-20260827';
  const SUPABASE_URL='https://nsqpslierpulanxvsxaw.supabase.co';
  const ANON_KEY='sb_publishable_gFddoL8aMpTWJE979hRgvg_dJVackKZ';
  const ENDPOINT=`${SUPABASE_URL}/functions/v1/billing-client`;
  let statusCache=null, statusAt=0, statusPromise=null;

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function brl(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function dateBR(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('pt-BR');}
  function statusLabel(v){return ({active:'Ativo',trial:'Teste',grace:'Período de tolerância',past_due:'Vencido',suspended:'Suspenso',pending:'Aguardando pagamento',canceled:'Cancelado'})[String(v||'')]||'Sem assinatura';}
  function effectiveLabel(v){return ({allow:'Acesso liberado',expired:'Acesso vencido',blocked:'Acesso bloqueado',pending:'Aguardando pagamento',legacy:'Controle atual'})[String(v||'')]||String(v||'—');}

  async function session(){
    try{
      if(typeof supabaseClient!=='undefined'&&supabaseClient?.auth){const r=await supabaseClient.auth.getSession();return r?.data?.session||null;}
    }catch(_){ }
    return null;
  }
  async function call(action,payload={}){
    const s=await session(); if(!s?.access_token) throw new Error('Faça login para acessar a assinatura.');
    const res=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${s.access_token}`,'apikey':ANON_KEY},body:JSON.stringify({action,...payload})});
    const data=await res.json().catch(()=>null); if(!res.ok||data?.ok!==true) throw new Error(data?.error||`Falha no billing (HTTP ${res.status}).`); return data;
  }
  async function getStatus(options={}){
    const force=options===true||options?.force===true;
    if(!force&&statusCache&&Date.now()-statusAt<10000)return statusCache;
    if(statusPromise&&!force)return statusPromise;
    const p=call('status').then(data=>{statusCache=data;statusAt=Date.now();window.__CRONOS_BILLING_STATUS__=data;renderSettings(data);return data;}).finally(()=>{if(statusPromise===p)statusPromise=null;});
    statusPromise=p; return p;
  }
  function reset(){statusCache=null;statusAt=0;statusPromise=null;window.__CRONOS_BILLING_STATUS__=null;}

  function injectStyles(){
    if(document.getElementById('cronosBillingStyles'))return;
    const style=document.createElement('style');style.id='cronosBillingStyles';style.textContent=`
      .billingCard{position:relative;overflow:hidden}.billingCard:before{content:"";position:absolute;inset:0;background:linear-gradient(135deg,rgba(37,99,235,.10),rgba(20,184,166,.08));pointer-events:none}.billingCard>*{position:relative}
      .billingHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.billingStatus{display:inline-flex;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:900;background:rgba(52,211,153,.14);color:#6ee7b7;border:1px solid rgba(52,211,153,.24)}.billingStatus.warn{background:rgba(251,191,36,.13);color:#facc15;border-color:rgba(251,191,36,.24)}
      .billingGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}.billingMetric{padding:12px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.025)}.billingMetric small{display:block;color:var(--muted);margin-bottom:5px}.billingMetric strong{font-size:15px}
      html.light .billingCard,body.light .billingCard,:root.light .billingCard{background:linear-gradient(135deg,rgba(219,234,254,.96) 0%,rgba(238,242,255,.96) 48%,rgba(204,251,241,.88) 100%);border-color:rgba(59,130,246,.20);box-shadow:0 12px 30px rgba(15,23,42,.06)}
      html.light .billingCard:before,body.light .billingCard:before,:root.light .billingCard:before{background:linear-gradient(135deg,rgba(37,99,235,.14) 0%,rgba(99,102,241,.08) 48%,rgba(20,184,166,.12) 100%)}
      html.light .billingMetric,body.light .billingMetric,:root.light .billingMetric{background:rgba(255,255,255,.82);border-color:rgba(59,130,246,.18);box-shadow:0 5px 16px rgba(15,23,42,.035)}
      .billingModalBg{position:fixed;inset:0;z-index:10050;background:rgba(2,6,23,.64);display:none;align-items:center;justify-content:center;padding:18px}.billingModalBg.show{display:flex}.billingModal{width:min(760px,96vw);max-height:90vh;overflow:auto;background:#0b1220;border:1px solid rgba(148,163,184,.18);border-radius:22px;box-shadow:0 28px 90px rgba(0,0,0,.42);padding:18px}.billingModalHead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.billingPlans{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:16px 0}.billingPlan{border:1px solid var(--line);border-radius:16px;padding:14px;background:rgba(255,255,255,.03);cursor:pointer}.billingPlan.selected{border-color:#38bdf8;box-shadow:0 0 0 2px rgba(56,189,248,.14)}.billingPlan strong{display:block;font-size:18px}.billingFormGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.billingFormGrid .full{grid-column:1/-1}.billingMethods{display:flex;gap:8px;flex-wrap:wrap}.billingMethod{padding:9px 12px;border:1px solid var(--line);border-radius:12px;cursor:pointer;background:rgba(255,255,255,.025)}.billingMethod.selected{background:rgba(37,99,235,.18);border-color:#60a5fa}.billingPix{display:grid;justify-items:center;gap:10px;padding:14px;border:1px solid var(--line);border-radius:16px;margin-top:14px}.billingPix img{width:min(260px,80vw);background:white;padding:10px;border-radius:12px}.billingCopy{width:100%;min-height:70px}.billingGateBtn{margin-left:8px}
      html.light .billingModal,body.light .billingModal,:root.light .billingModal{background:linear-gradient(135deg,#edf6ff,#effcf6);color:#0f172a}.billingModal input,.billingModal select,.billingModal textarea{width:100%;box-sizing:border-box}.billingModal label{display:block;font-size:12px;font-weight:800;margin-bottom:5px;color:var(--muted)}
      @media(max-width:720px){.billingGrid,.billingPlans,.billingFormGrid{grid-template-columns:1fr}.billingFormGrid .full{grid-column:auto}}
    `;document.head.appendChild(style);
  }

  function ensureSettingsCard(){
    const root=document.getElementById('view-settings');if(!root)return null;
    let card=document.getElementById('cronosBillingSettingsCard');if(card)return card;
    card=document.createElement('div');card.className='card billingCard';card.id='cronosBillingSettingsCard';card.innerHTML=`<div class="billingHead"><div><h3 style="margin:0">Plano e assinatura</h3><div class="muted" style="margin-top:5px">Consulte o plano atual, vencimento e pagamentos do Cronos.</div></div><span class="billingStatus warn" id="billingSettingsStatus">Carregando...</span></div><div id="billingSettingsBody" class="muted" style="margin-top:12px">Carregando assinatura...</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="btn ok" id="btnBillingOpen" type="button">Pagar / Renovar</button><button class="btn" id="btnBillingRefresh" type="button">Atualizar</button></div>`;
    const first=root.querySelector('.card'); if(first)root.insertBefore(card,first); else root.appendChild(card);
    card.querySelector('#btnBillingOpen').onclick=()=>openCheckout();
    card.querySelector('#btnBillingRefresh').onclick=async()=>{try{await getStatus({force:true});}catch(e){notify(e.message||String(e),'error');}};
    return card;
  }
  function renderSettings(data){
    const card=ensureSettingsCard();if(!card)return;
    const badge=card.querySelector('#billingSettingsStatus'),body=card.querySelector('#billingSettingsBody');
    const sub=data?.subscription,plan=data?.plan,billing=data?.billing||{};
    if(!sub||!plan){badge.textContent='Ainda sem billing';badge.classList.add('warn');body.innerHTML=`O controle automático de assinatura ainda não foi ativado para esta clínica. O acesso atual continua obedecendo às regras existentes do Cronos.`;return;}
    const allow=billing.mode==='allow';badge.textContent=effectiveLabel(billing.mode);badge.classList.toggle('warn',!allow);
    const price=sub.billing_cycle==='yearly'?plan.price_yearly:plan.price_monthly;
    body.innerHTML=`<div class="billingGrid"><div class="billingMetric"><small>Plano</small><strong>${esc(plan.name)}</strong></div><div class="billingMetric"><small>Valor</small><strong>${brl(price)} / ${sub.billing_cycle==='yearly'?'ano':'mês'}</strong></div><div class="billingMetric"><small>Validade atual</small><strong>${dateBR(sub.current_period_end)}</strong></div></div><div class="muted" style="margin-top:10px">Status: <b>${esc(statusLabel(sub.status))}</b>${sub.grace_until?` • tolerância até ${dateBR(sub.grace_until)}`:''}</div>`;
  }
  function notify(message,type='info'){
    try{if(typeof toast==='function'){toast(type==='error'?'Pagamento':'Cronos',message);return;}}catch(_){ }
    alert(message);
  }

  function ensureModal(){
    injectStyles();let bg=document.getElementById('cronosBillingModalBg');if(bg)return bg;
    bg=document.createElement('div');bg.id='cronosBillingModalBg';bg.className='billingModalBg';bg.innerHTML=`<div class="billingModal"><div class="billingModalHead"><div><div class="muted" style="font-size:12px">Cronos Odonto</div><h2 style="margin:4px 0 0">Plano e pagamento</h2></div><button class="btn" id="billingClose" type="button">Fechar</button></div><div id="billingModalBody" style="margin-top:12px"></div></div>`;document.body.appendChild(bg);bg.querySelector('#billingClose').onclick=()=>bg.classList.remove('show');bg.addEventListener('click',e=>{if(e.target===bg)bg.classList.remove('show');});return bg;
  }
  async function openCheckout(){
    const bg=ensureModal(),body=bg.querySelector('#billingModalBody');bg.classList.add('show');body.innerHTML='<div class="muted">Carregando planos...</div>';
    try{const data=await getStatus({force:true});renderCheckoutForm(data,body);}catch(e){body.innerHTML=`<div class="muted">${esc(e.message||e)}</div>`;}
  }
  function renderCheckoutForm(data,body){
    const plans=(data?.plans||[]).filter(p=>p.active!==false);if(!plans.length){body.innerHTML='<div class="muted">Nenhum plano disponível no momento.</div>';return;}
    const selected=data?.plan?.id||plans[0].id;
    body.innerHTML=`<div class="billingPlans">${plans.map(p=>`<div class="billingPlan ${p.id===selected?'selected':''}" data-plan-id="${esc(p.id)}"><strong>${esc(p.name)}</strong><span>${brl(p.price_monthly)}/mês</span>${p.price_yearly?`<div class="muted" style="margin-top:4px">${brl(p.price_yearly)}/ano</div>`:''}<div class="muted" style="margin-top:7px;font-size:12px">${esc(p.description||'')}</div></div>`).join('')}</div><div class="billingFormGrid"><div><label>Ciclo</label><select id="billingCycle"><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></div><div><label>CPF/CNPJ do responsável</label><input id="billingDocument" inputmode="numeric" placeholder="Somente números"></div><div><label>Nome / razão social</label><input id="billingLegalName" value="${esc(data?.clinic?.name||'')}"></div><div><label>E-mail</label><input id="billingEmail" type="email" value="${esc(data?.user?.email||'')}"></div><div class="full"><label>WhatsApp</label><input id="billingPhone" inputmode="tel" placeholder="DDD + número"></div><div class="full"><label>Forma de pagamento</label><div class="billingMethods"><button type="button" class="billingMethod selected" data-method="pix">Pix</button><button type="button" class="billingMethod" data-method="boleto">Boleto</button><button type="button" class="billingMethod" data-method="card">Cartão</button></div><div class="muted" style="font-size:12px;margin-top:6px">Cartão é concluído no checkout seguro do provedor; o Cronos não recebe nem armazena os dados do cartão.</div></div></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn ok" id="billingCreateCheckout" type="button">Gerar pagamento</button></div><div id="billingCheckoutResult"></div>`;
    let planId=selected,method='pix';body.querySelectorAll('.billingPlan').forEach(n=>n.onclick=()=>{planId=n.dataset.planId;body.querySelectorAll('.billingPlan').forEach(x=>x.classList.toggle('selected',x===n));});body.querySelectorAll('.billingMethod').forEach(n=>n.onclick=()=>{method=n.dataset.method;body.querySelectorAll('.billingMethod').forEach(x=>x.classList.toggle('selected',x===n));});
    body.querySelector('#billingCreateCheckout').onclick=async e=>{const btn=e.currentTarget,res=body.querySelector('#billingCheckoutResult');btn.disabled=true;btn.textContent='Gerando...';res.innerHTML='';try{const out=await call('create_checkout',{plan_id:planId,billing_cycle:body.querySelector('#billingCycle').value,payment_method:method,document_number:body.querySelector('#billingDocument').value,legal_name:body.querySelector('#billingLegalName').value,email:body.querySelector('#billingEmail').value,phone:body.querySelector('#billingPhone').value});renderCheckoutResult(out.checkout,res);}catch(err){res.innerHTML=`<div class="muted" style="margin-top:12px">${esc(err.message||err)}</div>`;}finally{btn.disabled=false;btn.textContent='Gerar pagamento';}};
  }
  function renderCheckoutResult(checkout,host){
    const pix=checkout?.pix,url=checkout?.invoiceUrl;host.innerHTML=`${pix?.encodedImage?`<div class="billingPix"><strong>Pix pronto para pagamento</strong><img alt="QR Code Pix" src="data:image/png;base64,${pix.encodedImage}"><textarea class="billingCopy" readonly>${esc(pix.payload||'')}</textarea><button class="btn" id="billingCopyPix" type="button">Copiar Pix</button></div>`:''}${url?`<div style="margin-top:12px"><a class="btn ok" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir pagamento seguro</a></div>`:''}<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn" id="billingVerify" type="button">Verificar pagamento</button></div><div class="muted" id="billingVerifyText" style="margin-top:8px">A liberação ocorre automaticamente após a confirmação do pagamento.</div>`;
    host.querySelector('#billingCopyPix')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(pix.payload||'');notify('Pix copiado.');}catch(_){notify('Não foi possível copiar o Pix.','error');}});
    host.querySelector('#billingVerify')?.addEventListener('click',async e=>{const b=e.currentTarget,t=host.querySelector('#billingVerifyText');b.disabled=true;b.textContent='Verificando...';try{const st=await getStatus({force:true});if(st?.billing?.mode==='allow'){t.textContent='Pagamento confirmado. Acesso liberado.';t.style.color='#34d399';setTimeout(()=>location.reload(),650);}else t.textContent='Ainda aguardando confirmação do pagamento.';}catch(err){t.textContent=err.message||String(err);}finally{b.disabled=false;b.textContent='Verificar pagamento';}});
  }

  function wireAccessButtons(){
    const gateActions=document.querySelector('#accessGateView .accessGateActions');if(gateActions&&!document.getElementById('btnRenewAccessBilling')){const b=document.createElement('button');b.type='button';b.className='btn ok billingGateBtn';b.id='btnRenewAccessBilling';b.textContent='Pagar / renovar online';b.onclick=openCheckout;gateActions.insertBefore(b,gateActions.firstChild);}
    const notice=document.querySelector('#accessNoticeModal .accessNoticeActions');if(notice&&!document.getElementById('btnAccessNoticeBilling')){const b=document.createElement('button');b.type='button';b.className='btn ok';b.id='btnAccessNoticeBilling';b.textContent='Pagar / renovar online';b.onclick=openCheckout;notice.insertBefore(b,notice.firstChild);}
  }
  function boot(){injectStyles();ensureSettingsCard();wireAccessButtons();getStatus().catch(()=>{});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,120));else setTimeout(boot,120);

  window.CronosBilling={BUILD,getStatus,reset,openCheckout,call};
})();
