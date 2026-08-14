/* Cronos V463.2.4 RC3 — Exame Digital: view dedicada, câmera local e ACL reativa. */
(function(){
'use strict';
if(window.__CRONOS_EXAM_V463__) return; window.__CRONOS_EXAM_V463__=true;
const BUCKET='cronos-exam-digital';
const CAMERA_PROFILE_STORAGE_KEY='cronos.exam.cameraProfiles.v1';
const NATIVE_VIEW_IDS=['dashboard','leads','kanban','tasks','installments','users','settings','todayCronos','creditSimulator','performance'];
const S={
  stream:null,patient:null,locked:false,devices:[],deviceId:'',session:[],stored:[],
  selected:new Set(),lightboxIndex:0,evaluationId:'',galleryEvaluationId:'',editImageId:'',
  editTeeth:new Set(),mode:'gallery',noteTimer:null,contextVersion:0,viewActive:false,
  returnView:'dashboard',viewObserver:null,learning:null,captureBusy:false,lastPhysicalCaptureAt:0,
  cameraRequestVersion:0
};
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const can=(k,actorOverride)=>window.CronosPermissions?.can?.(k,actorOverride||(typeof currentActor==='function'?currentActor():null))===true;
const client=()=>typeof supabaseClient!=='undefined'?supabaseClient:window.supabaseClient;
const owner=()=>String((typeof CLOUD_CLINIC_OWNER_UID!=='undefined'&&CLOUD_CLINIC_OWNER_UID)||(typeof CLOUD_OWNER_UID!=='undefined'&&CLOUD_OWNER_UID)||'');
const pkey=()=>S.patient?String(S.patient.entryId):'';

// V463.2.3 — trava definitiva do backdrop do Exame Digital.
// Usa fase de captura para impedir que o listener global do Cronos receba o clique fora.
if(!window.__CRONOS_EXAM_BACKDROP_GUARD__){
  window.__CRONOS_EXAM_BACKDROP_GUARD__=true;
  document.addEventListener('click',function(ev){
    try{
      const bg=document.getElementById('modalBg');
      const root=document.querySelector('#modalBg > .modal');
      if(!bg || ev.target!==bg) return;
      if(!bg.classList.contains('show')) return;
      const isExam = root?.classList?.contains('modalIntraoralDiagnostic')
        || !!document.querySelector('#modalBody .intraoralDiag');
      if(!isExam) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    }catch(_){}
  }, true);
}

function status(t){const e=$('intraoralStatusText');if(e)e.textContent=t}
function stop(){
  S.cameraRequestVersion+=1;
  const stream=S.stream;
  S.stream=null;
  if(stream){
    try{stream.getTracks().forEach(t=>{try{t.stop()}catch(_){}})}catch(_){}
  }
  const v=$('intraoralPreview');if(v){try{v.pause()}catch(_){}v.srcObject=null}
  syncCameraButtons();
}
function clearLightbox(){
  const b=$('intraoralLightbox');if(!b)return;
  b.hidden=true;
  const img=b.querySelector('img');if(img)img.removeAttribute('src');
  const caption=b.querySelector('.intraoralLightboxCaption');if(caption)caption.textContent='';
}
function clearPatientState({stopCamera=false,clearSearch=true}={}){
  S.contextVersion+=1;
  clearTimeout(S.noteTimer);S.noteTimer=null;
  S.patient=null;S.session=[];S.stored=[];S.selected.clear();S.lightboxIndex=0;
  S.evaluationId='';S.galleryEvaluationId='';S.editImageId='';S.editTeeth.clear();S.captureBusy=false;
  if(stopCamera)stop();
  clearLightbox();
  const search=$('intraoralPatientSearch');if(search&&clearSearch)search.value='';
  const resultBox=$('intraoralPatientResults');if(resultBox){resultBox.innerHTML='';resultBox.classList.remove('show')}
  syncPatientUI();render();renderPhotoEditor();
  return S.contextVersion;
}
function syncPatientUI(){
  const name=$('examPatientName');if(name)name.textContent=S.patient?.name||'Nenhum selecionado';
  const hint=$('examPatientHint');if(hint)hint.textContent=S.patient?'Paciente selecionado':'Selecione um paciente';
  const ev=$('examEvaluationSelect');if(ev){ev.innerHTML=evaluationOptions(S.evaluationId,false);ev.value=S.evaluationId;ev.disabled=!S.patient}
  const cameraLabel=document.querySelector('#view-intraoralExam .examCameraPanel header small');if(cameraLabel)cameraLabel.textContent=S.patient?evaluationLabel(S.evaluationId):'Selecione um paciente';
  syncCameraButtons();
}
function streamIsLive(stream=S.stream){
  try{return !!stream&&stream.getVideoTracks().some(t=>t.readyState==='live')}catch(_){return false}
}
function syncCameraButtons(){
  const hasPatient=!!S.patient,live=streamIsLive();
  const start=$('btnIntraoralStart'),captureBtn=$('btnIntraoralCapture'),stopBtn=$('btnIntraoralStop');
  if(start){
    start.disabled=!hasPatient||live;
    start.textContent=live?'Câmera ativa':'Ativar câmera';
  }
  if(captureBtn)captureBtn.disabled=!hasPatient||!live||S.captureBusy;
  if(stopBtn){
    stopBtn.disabled=!live;
    stopBtn.textContent='Desativar câmera';
  }
}
function patients(){
  try{
    const db=loadDB(), a=currentActor(), cm=new Map((db.contacts||[]).map(c=>[String(c.id),c]));
    return(db.entries||[]).filter(e=>!a?.masterId||!e.masterId||String(e.masterId)===String(a.masterId)).map(e=>{
      const c=cm.get(String(e.contactId))||{}, ficha=(e.ficha&&typeof e.ficha==='object')?e.ficha:{};
      const evals=(Array.isArray(ficha.avaliacoes)?ficha.avaliacoes:[]).map((v,i)=>({
        id:String(v.id||`eval_${i+1}`),
        label:String(v.label||`Avaliação ${i+1}`),
        date:String(v.date||''),
        odontograma:v.odontograma||{}
      }));
      if(!evals.length) evals.push({id:'eval_1',label:'Avaliação 1',date:'',odontograma:{}});
      const active=String(ficha.activeEvaluationId||evals[evals.length-1].id);
      return{entryId:String(e.id||e._id||''),name:c.name||e.name||'Paciente',phone:c.phone||e.phone||'',cpf:c.cpf||e.cpf||'',evaluationId:active,evaluations:evals};
    }).filter(x=>x.entryId)
  }catch(_){return[]}
}
function setPatientById(id){
  S.patient=patients().find(x=>x.entryId===String(id))||null;
  if(S.patient){
    S.evaluationId=S.patient.evaluationId||S.patient.evaluations?.[0]?.id||'eval_1';
    S.galleryEvaluationId=S.evaluationId;
  }
  return !!S.patient
}
function evaluationById(id){return S.patient?.evaluations?.find(v=>String(v.id)===String(id))||null}
function evaluationLabel(id){
  if(id==='__all__')return'Todas as avaliações';
  const v=evaluationById(id);return v?`${v.label}${v.date?` • ${new Date(v.date+'T12:00:00').toLocaleDateString('pt-BR')}`:''}`:'Avaliação'
}
function evaluationOptions(selected,includeAll=false){
  const list=S.patient?.evaluations||[];
  return`${includeAll?`<option value="__all__" ${selected==='__all__'?'selected':''}>Todas as avaliações</option>`:''}${list.map(v=>`<option value="${esc(v.id)}" ${String(selected)===String(v.id)?'selected':''}>${esc(evaluationLabel(v.id))}</option>`).join('')}`
}
const PERM_ROWS=[['18','17','16','15','14','13','12','11'],['21','22','23','24','25','26','27','28'],['48','47','46','45','44','43','42','41'],['31','32','33','34','35','36','37','38']];
const DEC_ROWS=[['55','54','53','52','51'],['61','62','63','64','65'],['85','84','83','82','81'],['71','72','73','74','75']];
function toothGridHTML({disabled=false}={}){
  const row=(a,cls='')=>`<div class="examToothRow ${cls}">${a.map(n=>`<button type="button" class="examTooth ${S.editTeeth.has(n)?'selected':''}" data-tooth="${n}" title="Dente ${n}" ${disabled?'disabled':''}>${n}</button>`).join('')}</div>`;
  return`<div class="examOdontoMini"><div class="examOdontoLabel">Permanentes</div>${PERM_ROWS.map((r,i)=>row(r,i===2?'examJawGap':'')).join('')}<details><summary>Dentes decíduos</summary>${DEC_ROWS.map((r,i)=>row(r,i===2?'examJawGap':'')).join('')}</details></div>`
}
function results(q){q=String(q||'').trim().toLowerCase();const box=$('intraoralPatientResults');if(!box)return;if(!q){box.innerHTML='';box.classList.remove('show');return}const r=patients().filter(x=>[x.name,x.phone,x.cpf].some(v=>String(v||'').toLowerCase().includes(q))).slice(0,20);box.innerHTML=r.map(x=>`<button type="button" class="intraoralPatientResult" data-entry-id="${esc(x.entryId)}"><b>${esc(x.name)}</b><span>${esc(x.phone||x.cpf||'')}</span></button>`).join('')||'<div class="intraoralSearchEmpty">Nenhum paciente encontrado.</div>';box.classList.add('show')}
function readCameraProfiles(){
  try{const value=JSON.parse(localStorage.getItem(CAMERA_PROFILE_STORAGE_KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch(_){return{}}
}
function writeCameraProfiles(profiles){
  try{localStorage.setItem(CAMERA_PROFILE_STORAGE_KEY,JSON.stringify(profiles));return true}catch(_){return false}
}
function currentDevice(){
  const selected=$('intraoralDeviceSelect')?.value||S.deviceId||'';
  return S.devices.find(d=>String(d.deviceId)===String(selected))||null;
}
function cameraProfileKey(){
  const device=currentDevice(),id=String(device?.deviceId||$('intraoralDeviceSelect')?.value||S.deviceId||'').trim();
  if(id)return`device:${id}`;
  const label=String(device?.label||'').trim();
  return label?`label:${label}`:'';
}
function activeCameraProfile(){const key=cameraProfileKey();return key?readCameraProfiles()[key]||null:null}
function eventSignature(event){
  const code=String(event.code||'').trim(),key=String(event.key||'').trim();
  if(!code&&!key)return null;
  if(['Shift','Control','Alt','Meta','AltGraph','CapsLock','NumLock','ScrollLock'].includes(key))return null;
  return{type:'keydown',code,key,signature:`keydown:${code||key}`}
}
function cameraEventLabel(profile){return String(profile?.code||profile?.key||'evento detectado')}
function syncCameraProfileUI(message=''){
  const box=$('cameraLearnStatus');if(!box)return;
  const profile=activeCameraProfile();
  const forget=$('btnForgetCameraButton');if(forget)forget.disabled=!profile;
  const learn=$('btnLearnCameraButton');
  if(learn&&!S.learning){learn.disabled=false;learn.textContent=profile?'Alterar botão':'Aprender botão da câmera'}
  if(message){box.textContent=message;return}
  box.textContent=profile
    ?`Botão aprendido: ${cameraEventLabel(profile)}. Teste agora pressionando o botão físico. Se precisar trocar, use “Alterar botão”.`
    :'Nenhum botão físico aprendido para esta câmera. A captura manual continua disponível.';
}
function cancelLearning(message=''){
  const learning=S.learning;S.learning=null;
  if(learning?.timer)clearTimeout(learning.timer);
  syncCameraProfileUI(message||'');
}
function saveLearnedCameraProfile(learning,normalized){
  const profiles=readCameraProfiles();
  profiles[learning.profileKey]={
    version:2,type:normalized.type,code:normalized.code,key:normalized.key,
    signature:normalized.signature,deviceId:learning.deviceId,
    deviceLabel:learning.deviceLabel,learnedAt:new Date().toISOString()
  };
  return writeCameraProfiles(profiles);
}
function startLearning(){
  const profileKey=cameraProfileKey();
  if(!profileKey)return syncCameraProfileUI('Detecte a câmera ou abra o preview antes de iniciar o aprendizado.');
  cancelLearning();
  const device=currentDevice();
  S.learning={
    profileKey,deviceId:String(device?.deviceId||S.deviceId||''),
    deviceLabel:String(device?.label||''),counts:new Map(),
    lastBySignature:new Map(),timer:null,required:1
  };
  const btn=$('btnLearnCameraButton');
  if(btn){btn.disabled=true;btn.textContent='Aguardando 1 clique…'}
  syncCameraProfileUI('Pressione o botão físico 1 vez. O Cronos mostrará o evento detectado para você confirmar.');
  S.learning.timer=setTimeout(
    ()=>cancelLearning('Nenhum evento foi confirmado. A captura manual permanece disponível; tente novamente quando quiser.'),
    20000
  );
}
function forgetCameraProfile(){
  const key=cameraProfileKey();if(!key)return;
  const profiles=readCameraProfiles();delete profiles[key];writeCameraProfiles(profiles);syncCameraProfileUI('Perfil removido. A captura manual permanece disponível.');
}
function isTextEditingTarget(target){return !!target?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')}
function handleCameraKey(event){
  if(event.key==='Escape'&&$('view-intraoralExam')?.classList.contains('camera-expanded')){
    event.preventDefault();event.stopImmediatePropagation();setCameraExpanded(false);return;
  }
  const normalized=eventSignature(event);if(!normalized)return;
  if(S.learning){
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancelLearning('Aprendizado cancelado. A captura manual permanece disponível.');return}
    if(event.repeat)return;
    const now=Date.now(),last=S.learning.lastBySignature.get(normalized.signature)||0;
    if(now-last<180)return;
    S.learning.lastBySignature.set(normalized.signature,now);
    event.preventDefault();event.stopImmediatePropagation();

    const learning=S.learning;
    if(learning.timer)clearTimeout(learning.timer);
    const confirmed=window.confirm(
      `O Cronos detectou “${cameraEventLabel(normalized)}” como botão da câmera.\n\nUsar este botão?\n\nOK = confirmar\nCancelar = tentar detectar novamente`
    );
    if(!S.learning)return;
    if(!confirmed){
      learning.counts.clear();
      learning.lastBySignature.clear();
      syncCameraProfileUI('Tudo bem. Pressione o botão físico novamente para tentar outra detecção.');
      learning.timer=setTimeout(
        ()=>cancelLearning('Nenhum evento foi confirmado. A captura manual permanece disponível.'),
        20000
      );
      return;
    }

    const saved=saveLearnedCameraProfile(learning,normalized);
    cancelLearning(saved
      ?`Botão confirmado: ${cameraEventLabel(normalized)}. Teste agora pressionando o botão físico.`
      :'O evento foi confirmado, mas o navegador bloqueou o armazenamento local.');
    return;
  }
  if(!S.viewActive||S.mode!=='exam'||!S.stream||isTextEditingTarget(event.target)||event.repeat)return;
  const profile=activeCameraProfile();if(!profile||profile.signature!==normalized.signature)return;
  const now=Date.now();if(now-S.lastPhysicalCaptureAt<650)return;S.lastPhysicalCaptureAt=now;
  event.preventDefault();event.stopImmediatePropagation();
  capture().catch(e=>{console.error(e);status(e.message||'Não foi possível capturar a foto.')});
}
async function devices(){
  if(!navigator.mediaDevices?.enumerateDevices){status('Este navegador não oferece acesso às câmeras.');return}
  try{
    S.devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
    const s=$('intraoralDeviceSelect');if(s){
      s.innerHTML=S.devices.map((d,i)=>`<option value="${esc(d.deviceId)}">${esc(d.label||`Câmera ${i+1}`)}</option>`).join('');
      if(S.deviceId&&S.devices.some(d=>String(d.deviceId)===String(S.deviceId)))s.value=S.deviceId;
      if(!S.deviceId&&s.value)S.deviceId=s.value;
    }
    syncCameraProfileUI();
  }catch(e){status(`Não foi possível detectar as câmeras: ${e.message||e.name}`)}
}
async function preview(){
  if(!S.patient)return status('Selecione um paciente.');
  if(!navigator.mediaDevices?.getUserMedia)return status('Este navegador não permite abrir a câmera.');

  // Se a câmera já está viva, não desmonta nem solicita getUserMedia novamente.
  if(streamIsLive()){
    const v=$('intraoralPreview');
    if(v&&v.srcObject!==S.stream)v.srcObject=S.stream;
    try{if(v&&v.paused)await v.play()}catch(_){}
    syncCameraButtons();
    status('Câmera já está ativa.');
    return;
  }

  // Limpa apenas uma stream morta/obsoleta antes de nova ativação real.
  if(S.stream)stop();

  const requestVersion=++S.cameraRequestVersion;
  try{
    const id=$('intraoralDeviceSelect')?.value;
    const stream=await navigator.mediaDevices.getUserMedia({video:id?{deviceId:{exact:id},width:{ideal:1920},height:{ideal:1080}}:{width:{ideal:1920},height:{ideal:1080}},audio:false});
    if(!S.viewActive||requestVersion!==S.cameraRequestVersion){stream.getTracks().forEach(t=>t.stop());return}
    S.stream=stream;
    const v=$('intraoralPreview');if(!v){stop();return}
    v.srcObject=stream;await v.play();
    S.deviceId=stream.getVideoTracks()[0]?.getSettings?.().deviceId||id||'';

    // Atualiza rótulos/dispositivos sem reiniciar a stream.
    try{
      S.devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
      const s=$('intraoralDeviceSelect');
      if(s){
        s.innerHTML=S.devices.map((d,i)=>`<option value="${esc(d.deviceId)}">${esc(d.label||`Câmera ${i+1}`)}</option>`).join('');
        if(S.deviceId&&S.devices.some(d=>String(d.deviceId)===String(S.deviceId)))s.value=S.deviceId;
      }
    }catch(_){}

    if(requestVersion!==S.cameraRequestVersion)return;
    syncCameraButtons();
    status('Câmera ativa.');
  }catch(e){
    if(requestVersion!==S.cameraRequestVersion)return;
    stop();
    status(`Erro: ${e.message||e.name}`);
  }
}
function patientContext(){
  if(!S.patient||!S.evaluationId)return null;
  return{version:S.contextVersion,ownerUid:owner(),patientEntryId:pkey(),patientName:S.patient.name,evaluationId:S.evaluationId}
}
function contextIsCurrent(context){
  return !!context&&context.version===S.contextVersion&&context.patientEntryId===pkey()&&context.evaluationId===S.evaluationId
}
async function persistImage(x,context=patientContext()){
  if(!context?.patientEntryId) throw new Error('Selecione um paciente.');
  if(!context.evaluationId) throw new Error('Selecione a avaliação/ficha.');
  const path=`${context.ownerUid}/${context.patientEntryId}/${context.evaluationId}/${new Date(x.createdAt).toISOString().slice(0,10)}/${crypto.randomUUID()}.jpg`;
  const blob=dataUrlBlob(x.dataUrl);
  let r=await client().storage.from(BUCKET).upload(path,blob,{contentType:'image/jpeg',upsert:false});
  if(r.error) throw r.error;
  const row={owner_uid:context.ownerUid,patient_entry_id:context.patientEntryId,patient_name:context.patientName,evaluation_id:context.evaluationId,storage_path:path,source:x.source,mime_type:'image/jpeg',width:x.width,height:x.height,captured_at:x.createdAt};
  r=await client().from('cronos_exam_images').insert(row).select('*').single();
  if(r.error){await client().storage.from(BUCKET).remove([path]);throw r.error}
  return r.data;
}
async function capture(){
  if(!can('exam.capture'))return alert('Sem permissão para capturar imagens.');
  if(S.captureBusy)return;
  const v=$('intraoralPreview'),c=$('intraoralCaptureCanvas');
  if(!S.patient||!S.stream||!v?.videoWidth)return status('Abra o preview antes de capturar.');
  const context=patientContext();if(!context)return status('Selecione o paciente e a avaliação.');
  S.captureBusy=true;syncCameraButtons();
  c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0,c.width,c.height);
  const x={id:crypto.randomUUID(),dataUrl:c.toDataURL('image/jpeg',.92),width:c.width,height:c.height,source:'camera',createdAt:new Date().toISOString(),evaluation_id:context.evaluationId};
  S.session.push(x); render(); status('Salvando foto...');
  try{
    const saved=await persistImage(x,context);
    if(!contextIsCurrent(context))return;
    S.session=S.session.filter(t=>t.id!==x.id);S.editImageId=saved?.id||'';status('Foto salva.');await loadStored();
    if(contextIsCurrent(context))selectEditImage(S.editImageId)
  }
  catch(e){if(contextIsCurrent(context)){status('Falha ao salvar. A foto continua nesta sessão.');console.error(e);render()}}
  finally{if(contextIsCurrent(context)){S.captureBusy=false;syncCameraButtons()}}
}
async function normalizeFile(file){
  const MAX_EDGE=4096;
  const TARGET_BYTES=10*1024*1024; // folga abaixo do limite de 12 MB do bucket
  const img=await new Promise((res,rej)=>{
    const node=new Image(),u=URL.createObjectURL(file);
    node.onload=()=>{URL.revokeObjectURL(u);res(node)};
    node.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('Imagem inválida'))};
    node.src=u;
  });

  let width=Math.max(1,Number(img.naturalWidth||img.width||1));
  let height=Math.max(1,Number(img.naturalHeight||img.height||1));
  const longest=Math.max(width,height);
  if(longest>MAX_EDGE){
    const scale=MAX_EDGE/longest;
    width=Math.max(1,Math.round(width*scale));
    height=Math.max(1,Math.round(height*scale));
  }

  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw new Error('Navegador não conseguiu preparar a imagem.');
  ctx.drawImage(img,0,0,width,height);

  const encode=q=>new Promise((res,rej)=>canvas.toBlob(
    b=>b?res(b):rej(new Error('Falha ao converter imagem')),
    'image/jpeg',q
  ));

  let quality=.92;
  let blob=await encode(quality);
  while(blob.size>TARGET_BYTES&&quality>.62){
    quality=Math.max(.62,quality-.08);
    blob=await encode(quality);
  }

  // Se uma imagem excepcionalmente grande ainda ultrapassar o limite,
  // reduz dimensões progressivamente sem destruir desnecessariamente a qualidade.
  while(blob.size>TARGET_BYTES&&canvas.width>1600&&canvas.height>1200){
    const prev=document.createElement('canvas');
    prev.width=canvas.width;prev.height=canvas.height;
    prev.getContext('2d').drawImage(canvas,0,0);
    canvas.width=Math.max(1,Math.round(prev.width*.82));
    canvas.height=Math.max(1,Math.round(prev.height*.82));
    canvas.getContext('2d',{alpha:false}).drawImage(prev,0,0,canvas.width,canvas.height);
    quality=.86;
    blob=await encode(quality);
  }

  if(blob.size>TARGET_BYTES){
    throw new Error(`Imagem ainda muito grande após otimização (${(blob.size/1024/1024).toFixed(1)} MB).`);
  }
  return{blob,width:canvas.width,height:canvas.height,optimized:file.size!==blob.size||canvas.width!==img.naturalWidth||canvas.height!==img.naturalHeight};
}
async function uploadFiles(files){
  if(!can('exam.capture'))return alert('Sem permissão para importar imagens.');
  const context=patientContext();if(!context)return status('Selecione o paciente e a avaliação.');
  const candidates=[...(files||[])].filter(f=>String(f?.type||'').startsWith('image/'));
  if(!candidates.length)return status('Nenhuma imagem válida selecionada.');

  let savedCount=0,failedCount=0,lastSavedId='';
  status(`Importando ${candidates.length} imagem(ns)...`);

  for(const f of candidates){
    if(!contextIsCurrent(context))break;
    let x=null;
    try{
      const n=await normalizeFile(f);
      if(!contextIsCurrent(context))break;
      const dataUrl=await blobDataUrl(n.blob);
      if(!contextIsCurrent(context))break;

      x={id:crypto.randomUUID(),dataUrl,width:n.width,height:n.height,source:'upload',createdAt:new Date().toISOString(),evaluation_id:context.evaluationId};
      S.session.push(x);render();
      status(`Salvando imagem ${savedCount+failedCount+1} de ${candidates.length}...`);

      const saved=await persistImage(x,context);
      if(!contextIsCurrent(context))return;

      // Só remove a prévia temporária depois que Storage + INSERT confirmaram.
      S.session=S.session.filter(t=>t.id!==x.id);
      lastSavedId=saved?.id||lastSavedId;
      savedCount+=1;
      await loadStored();
    }catch(e){
      failedCount+=1;
      console.error('Falha no upload externo do Exame Digital:',e);
      // Não mantém uma falsa "foto recente" se a persistência falhou.
      if(x)S.session=S.session.filter(t=>t.id!==x.id);
      render();
    }
  }

  if(!contextIsCurrent(context))return;
  await loadStored();
  if(lastSavedId){
    S.editImageId=lastSavedId;
    selectEditImage(lastSavedId);
  }

  if(failedCount===0){
    status(`${savedCount} imagem(ns) importada(s) e salva(s).`);
  }else if(savedCount>0){
    status(`${savedCount} salva(s); ${failedCount} não puderam ser importada(s).`);
    alert(`${failedCount} imagem(ns) não puderam ser salvas. As demais foram importadas normalmente.`);
  }else{
    status('Falha no upload. Nenhuma imagem foi salva.');
    alert('Nenhuma imagem pôde ser salva. Verifique o Console para o erro técnico.');
  }
}
function blobDataUrl(b){return new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(b)})}
function dataUrlBlob(u){const [h,b]=u.split(','),mime=/data:([^;]+)/.exec(h)?.[1]||'image/jpeg',bin=atob(b),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return new Blob([a],{type:mime})}
async function loadStored(){
  if(!S.patient||!can('exam.view')){S.stored=[];render();return}
  const version=S.contextVersion,patientEntryId=pkey(),mode=S.mode;
  const filter=mode==='gallery'?S.galleryEvaluationId:S.evaluationId;
  const isCurrent=()=>version===S.contextVersion&&patientEntryId===pkey()&&mode===S.mode&&filter===(S.mode==='gallery'?S.galleryEvaluationId:S.evaluationId);
  let q=client().from('cronos_exam_images').select('*').eq('owner_uid',owner()).eq('patient_entry_id',patientEntryId).is('deleted_at',null);
  if(filter&&filter!=='__all__')q=q.eq('evaluation_id',filter);
  const {data,error}=await q.order('captured_at',{ascending:false});
  if(!isCurrent())return;
  if(error){console.warn(error);status('Não foi possível carregar a galeria.');return}
  const ids=(data||[]).map(x=>x.id);
  let toothRows=[];
  if(ids.length){
    const tr=await client().from('cronos_exam_image_teeth').select('image_id,tooth_number').in('image_id',ids);
    if(!isCurrent())return;
    if(!tr.error)toothRows=tr.data||[];
  }
  const byImage={};
  toothRows.forEach(t=>(byImage[t.image_id]??=[]).push(String(t.tooth_number)));
  const stored=await Promise.all((data||[]).map(async x=>{
    const {data:s}=await client().storage.from(BUCKET).createSignedUrl(x.storage_path,3600);
    return{...x,teeth:byImage[x.id]||[],url:s?.signedUrl||''}
  }));
  if(!isCurrent())return;
  S.stored=stored;
  render();renderPhotoEditor();
}
async function saveSession(){if(!S.patient||!S.session.length)return;if(!can('exam.capture'))return alert('Sem permissão para salvar exames.');status('Salvando imagens...');for(const x of [...S.session]){const path=`${owner()}/${pkey()}/${new Date(x.createdAt).toISOString().slice(0,10)}/${crypto.randomUUID()}.jpg`,blob=dataUrlBlob(x.dataUrl);let r=await client().storage.from(BUCKET).upload(path,blob,{contentType:'image/jpeg',upsert:false});if(r.error)throw r.error;const row={owner_uid:owner(),patient_entry_id:pkey(),patient_name:S.patient.name,evaluation_id:S.evaluationId||null,storage_path:path,source:x.source,mime_type:'image/jpeg',width:x.width,height:x.height,captured_at:x.createdAt};r=await client().from('cronos_exam_images').insert(row);if(r.error){await client().storage.from(BUCKET).remove([path]);throw r.error}}S.session=[];status('Exame salvo.');await loadStored()}
function allItems(){
  return[
    ...S.session.map(x=>({...x,url:x.dataUrl,temporary:true,storageId:`tmp:${x.id}`,evaluation_id:x.evaluation_id||S.evaluationId,teeth:[]})),
    ...S.stored.map(x=>({...x,storageId:x.id}))
  ]
}
function currentEdit(){return S.stored.find(x=>String(x.id)===String(S.editImageId))||null}
function selectEditImage(id){
  S.editImageId=String(id||'');
  const x=currentEdit();
  S.editTeeth=new Set((x?.teeth||[]).map(String));
  render();
  renderPhotoEditor();
}
function render(){
  const g=$('intraoralGallery'),cnt=$('intraoralGalleryCount');
  if(!g)return;
  const items=allItems();
  if(cnt)cnt.textContent=`${items.length} foto(s)`;
  g.innerHTML=items.length?items.map((x,i)=>{
    const teeth=(x.teeth||[]).join(', ');
    const obs=String(x.observation||'').trim();
    const editing=String(S.editImageId)===String(x.id);
    return`<article class="intraoralThumb ${S.selected.has(x.storageId)?'is-selected':''} ${editing?'is-editing':''}">
      <input class="intraoralSelect" type="checkbox" data-select="${esc(x.storageId)}" ${S.selected.has(x.storageId)?'checked':''}>
      <button type="button" class="intraoralThumbOpen" data-open="${i}"><img src="${esc(x.url)}" alt="Imagem ${i+1}"><span>${i+1}</span></button>
      <div class="intraoralThumbMeta"><span>${new Date(x.captured_at||x.createdAt).toLocaleString('pt-BR')}</span><span class="intraoralPersistBadge">${x.temporary?'salvando':x.source==='upload'?'upload':'câmera'}</span></div>
      <div class="intraoralEvaluationMeta">${esc(evaluationLabel(x.evaluation_id))}</div>
      ${teeth?`<div class="intraoralClinicalMeta"><b>Dente${x.teeth.length>1?'s':''}: ${esc(teeth)}</b></div>`:''}
      ${obs?`<div class="intraoralClinicalNote">${esc(obs)}</div>`:''}
      ${S.mode==='gallery'?`<button type="button" class="btn intraoralGalleryOpenBtn" data-open="${i}">Abrir foto</button>`:''}
      ${S.mode==='exam'&&!x.temporary&&can('exam.capture')?`<button type="button" class="btn examEditPhotoBtn" data-edit-photo="${esc(x.id)}">${editing?'Editando dados clínicos':'Editar dados / abrir foto'}</button>`:''}
    </article>`
  }).join(''):`<div class="intraoralEmptyGallery">${S.patient?'Nenhuma imagem nesta avaliação.':'Selecione um paciente para carregar a galeria.'}</div>`;
  const info=$('intraoralSelectionInfo');if(info)info.textContent=`${S.selected.size} selecionada(s)`;
  ['btnExamDownload','btnExamPdf'].forEach(id=>{const e=$(id);if(e)e.disabled=!S.selected.size});
  const del=$('btnExamDelete');if(del){del.disabled=!S.selected.size||!can('exam.delete');del.hidden=!can('exam.delete')}
  refreshExpandedLastPreview();
}
async function updateImageMetadata(id,{evaluationId,observation}={}){
  if(!id||!can('exam.capture'))return false;
  const version=S.contextVersion;
  const x=S.stored.find(v=>String(v.id)===String(id));if(!x)return;
  const ev=evaluationId!==undefined?evaluationId:(x.evaluation_id||S.evaluationId);
  const ob=observation!==undefined?observation:String(x.observation||'');
  const r=await client().rpc('cronos_update_exam_image_metadata',{p_id:id,p_evaluation_id:ev,p_observation:ob});
  if(r.error)throw r.error;
  if(version!==S.contextVersion)return false;
  x.evaluation_id=ev;x.observation=ob;
  return true
}
async function saveTeeth(id){
  if(!id||!can('exam.capture'))return false;
  const version=S.contextVersion;
  const selected=[...S.editTeeth].map(String);
  const r=await client().rpc('cronos_replace_exam_image_teeth',{p_image_id:id,p_tooth_numbers:selected});
  if(r.error)throw r.error;
  if(version!==S.contextVersion)return false;
  const saved=Array.isArray(r.data)?r.data.map(String):selected;
  S.editTeeth=new Set(saved);
  const x=S.stored.find(v=>String(v.id)===String(id));if(x)x.teeth=saved;
  return true
}
function renderPhotoEditor(){
  const box=$('examPhotoEditor');if(!box)return;
  const x=currentEdit();
  if(!x){
    box.innerHTML=`<div class="examEditorHead"><div><strong>Dados clínicos da imagem</strong><small>${S.patient?'Capture ou selecione uma foto na galeria.':'Aguardando paciente.'}</small></div></div>
      <label class="intraoralField"><span>Ficha / avaliação desta foto</span><select disabled>${evaluationOptions(S.evaluationId,false)}</select></label>
      <label class="intraoralField"><span>Observação da imagem</span><textarea rows="4" disabled placeholder="Selecione uma foto para registrar a observação."></textarea></label>
      <div class="examEditorSaveState">Para vincular dentes, abra a foto e use o Odontograma.</div>`;
    return
  }
  const evalId=String(x.evaluation_id||S.evaluationId||'');
  box.innerHTML=`<div class="examEditorHead"><div><strong>Dados clínicos da foto</strong><small>${new Date(x.captured_at).toLocaleString('pt-BR')}</small></div><button type="button" class="btn" id="btnPreviewEditPhoto">Abrir foto / odontograma</button></div>
    <label class="intraoralField"><span>Ficha / avaliação desta foto</span><select id="examPhotoEvaluation">${evaluationOptions(evalId,false)}</select></label>
    <label class="intraoralField"><span>Observação da imagem</span><textarea id="examPhotoObservation" rows="4" placeholder="Ex.: possibilidade de tratamento endodôntico, extração para implante...">${esc(x.observation||'')}</textarea></label>
    <div class="examEditorSaveState" id="examEditorSaveState">Alterações são salvas automaticamente. Dentes são vinculados no odontograma ao abrir a foto.</div>`;
  $('btnPreviewEditPhoto')?.addEventListener('click',()=>{const i=allItems().findIndex(v=>String(v.id)===String(x.id));if(i>=0)lightbox(i)});
  $('examPhotoEvaluation')?.addEventListener('change',async e=>{
    const next=e.target.value;const state=$('examEditorSaveState');if(state)state.textContent='Movendo foto para a avaliação...';
    try{const current=await updateImageMetadata(x.id,{evaluationId:next});if(!current)return;if(state)state.textContent='Avaliação atualizada.';await loadStored()}
    catch(err){if(state)state.textContent='Falha ao atualizar.';alert(err.message)}
  });

  $('examPhotoObservation')?.addEventListener('input',e=>{
    clearTimeout(S.noteTimer);const value=e.target.value,state=$('examEditorSaveState');if(state)state.textContent='Digitando...';
    S.noteTimer=setTimeout(async()=>{try{if(state)state.textContent='Salvando observação...';const current=await updateImageMetadata(x.id,{observation:value});if(!current)return;if(state)state.textContent='Observação salva.';render()}catch(err){if(state)state.textContent='Falha ao salvar.'}},500)
  });
}

function selected(){const m=new Map(allItems().map(x=>[x.storageId,x]));return[...S.selected].map(id=>m.get(id)).filter(Boolean)}
function lightboxOdontoHTML(x){
  const selected=new Set((x?.teeth||[]).map(String));
  const row=(a,cls='')=>`<div class="examToothRow ${cls}">${a.map(n=>`<button type="button" class="examTooth ${selected.has(n)?'selected':''}" data-lightbox-tooth="${n}" title="Dente ${n}">${n}</button>`).join('')}</div>`;
  return`<div class="intraoralLightboxOdontoHead"><div><strong>Dados clínicos da foto</strong><small>${esc(evaluationLabel(x?.evaluation_id))}</small></div><button type="button" class="intraoralLightboxOdontoClose" aria-label="Fechar dados clínicos">×</button></div><div class="examOdontoMini"><div class="examOdontoLabel">Odontograma — permanentes</div>${PERM_ROWS.map((r,i)=>row(r,i===2?'examJawGap':'')).join('')}<details><summary>Dentes decíduos</summary>${DEC_ROWS.map((r,i)=>row(r,i===2?'examJawGap':'')).join('')}</details></div><label class="intraoralField intraoralLightboxObservation"><span>Observação da imagem</span><textarea rows="5" data-lightbox-observation placeholder="Ex.: possibilidade de tratamento endodôntico, extração para implante...">${esc(x?.observation||'')}</textarea></label><div class="intraoralLightboxOdontoHint" data-lightbox-save-state>Clique nos dentes para vincular/desvincular. Odontograma e observação são salvos automaticamente.</div>`
}
function lightbox(i){
  const a=allItems();if(!a[i])return;S.lightboxIndex=i;
  let b=$('intraoralLightbox');
  if(!b){
    b=document.createElement('div');b.id='intraoralLightbox';b.className='intraoralLightbox';
    b.innerHTML='<div class="intraoralLightboxStage"><button class="intraoralLightboxClose">×</button><button class="intraoralLightboxPrev">‹</button><img><button class="intraoralLightboxNext">›</button><button class="intraoralLightboxOdontoToggle" type="button">Dados clínicos</button><div class="intraoralLightboxCaption"></div></div><aside class="intraoralLightboxOdonto" hidden></aside>';
    document.body.appendChild(b);
    b.querySelector('.intraoralLightboxClose').onclick=()=>b.hidden=true;
    b.querySelector('.intraoralLightboxPrev').onclick=()=>{const n=allItems().length;if(n)lightbox((S.lightboxIndex-1+n)%n)};
    b.querySelector('.intraoralLightboxNext').onclick=()=>{const n=allItems().length;if(n)lightbox((S.lightboxIndex+1)%n)};
    b.querySelector('.intraoralLightboxOdontoToggle').onclick=()=>{const panel=b.querySelector('.intraoralLightboxOdonto');panel.hidden=!panel.hidden;b.classList.toggle('with-odonto',!panel.hidden)};
  }
  const x=a[i],teeth=(x.teeth||[]).length?` • Dente${x.teeth.length>1?'s':''} ${(x.teeth||[]).join(', ')}`:'';
  const obs=x.observation?` • ${x.observation}`:'';
  b.hidden=false;b.classList.remove('with-odonto');
  const panel=b.querySelector('.intraoralLightboxOdonto');panel.hidden=true;panel.innerHTML=lightboxOdontoHTML(x);
  b.querySelector('img').src=x.url;
  b.querySelector('.intraoralLightboxCaption').textContent=`${S.patient?.name||''} • ${evaluationLabel(x.evaluation_id)}${teeth}${obs}`;
  panel.querySelector('.intraoralLightboxOdontoClose').onclick=()=>{panel.hidden=true;b.classList.remove('with-odonto')};
  const lightboxObs=panel.querySelector('[data-lightbox-observation]'), lightboxSave=panel.querySelector('[data-lightbox-save-state]');
  if(lightboxObs){
    if(x.temporary||!can('exam.capture')) lightboxObs.disabled=true;
    else lightboxObs.addEventListener('input',e=>{
      clearTimeout(S.noteTimer);const value=e.target.value;if(lightboxSave)lightboxSave.textContent='Digitando...';
      S.noteTimer=setTimeout(async()=>{try{if(lightboxSave)lightboxSave.textContent='Salvando observação...';const current=await updateImageMetadata(x.id,{observation:value});if(current){x.observation=value;if(lightboxSave)lightboxSave.textContent='Observação salva automaticamente.';b.querySelector('.intraoralLightboxCaption').textContent=`${S.patient?.name||''} • ${evaluationLabel(x.evaluation_id)}${(x.teeth||[]).length?` • Dente${x.teeth.length>1?'s':''} ${x.teeth.join(', ')}`:''}${value?` • ${value}`:''}`}}catch(err){if(lightboxSave)lightboxSave.textContent='Falha ao salvar observação.'}},500)
    });
  }
  panel.querySelectorAll('[data-lightbox-tooth]').forEach(btn=>btn.addEventListener('click',async()=>{
    if(!can('exam.capture')||x.temporary)return;
    const n=btn.dataset.lightboxTooth,original=new Set((x.teeth||[]).map(String));
    const next=new Set(original);next.has(n)?next.delete(n):next.add(n);x.teeth=[...next];btn.classList.toggle('selected',next.has(n));
    const previousEditId=S.editImageId,previousTeeth=S.editTeeth;S.editImageId=String(x.id);S.editTeeth=new Set(next);
    try{await saveTeeth(x.id);b.querySelector('.intraoralLightboxCaption').textContent=`${S.patient?.name||''} • ${evaluationLabel(x.evaluation_id)}${x.teeth.length?` • Dente${x.teeth.length>1?'s':''} ${x.teeth.join(', ')}`:''}${x.observation?` • ${x.observation}`:''}`;render()}
    catch(err){x.teeth=[...original];btn.classList.toggle('selected',original.has(n));alert(err.message)}
    finally{S.editImageId=previousEditId;S.editTeeth=previousTeeth}
  }));
}
async function downloadSelected(){for(const [i,x] of selected().entries()){const blob=x.temporary?dataUrlBlob(x.dataUrl):await(await fetch(x.url)).blob();const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=`exame-${(S.patient?.name||'paciente').replace(/\W+/g,'-')}-${i+1}.jpg`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);await new Promise(r=>setTimeout(r,180))}}
function jpegSize(bytes){let i=2;while(i<bytes.length){if(bytes[i]!==0xFF){i++;continue}const m=bytes[i+1];if([0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF].includes(m))return{h:(bytes[i+5]<<8)+bytes[i+6],w:(bytes[i+7]<<8)+bytes[i+8]};i+=2+((bytes[i+2]<<8)+bytes[i+3])}return{w:1200,h:900}}
function pdfSafe(v){
  return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,' ').replace(/[()\\]/g,' ').replace(/\s+/g,' ').trim()
}
function pdfWrap(v,max=58,lines=2){
  const words=pdfSafe(v).split(' ').filter(Boolean),out=[];let line='';
  for(const w of words){const next=(line+' '+w).trim();if(next.length>max&&line){out.push(line);line=w;if(out.length>=lines-1)break}else line=next}
  if(line&&out.length<lines)out.push(line);
  if(words.length&&out.join(' ').length<pdfSafe(v).length&&out.length)out[out.length-1]=out[out.length-1].replace(/\.*$/,'')+'...';
  return out
}
async function pdfSelected(){
  const src=selected();if(!src.length)return;
  const imgs=[];
  for(const x of src){
    const b=x.temporary?dataUrlBlob(x.dataUrl):await(await fetch(x.url)).blob(),u=new Uint8Array(await b.arrayBuffer());
    imgs.push({u,...jpegSize(u),teeth:x.teeth||[],observation:x.observation||'',evaluation_id:x.evaluation_id||S.galleryEvaluationId||S.evaluationId,captured_at:x.captured_at||x.createdAt})
  }
  const enc=new TextEncoder(),parts=[],offs=[0];let pos=9;
  const push=b=>{b=typeof b==='string'?enc.encode(b):b;parts.push(b);pos+=b.length};
  push('%PDF-1.4\n');
  const add=(n,chunks)=>{offs[n]=pos;push(`${n} 0 obj\n`);chunks.forEach(push);push('\nendobj\n')};
  const perPage=imgs.length===1?1:2,pages=Math.ceil(imgs.length/perPage),imageBase=3+pages*2,N=2+pages*2+imgs.length;
  add(1,['<< /Type /Catalog /Pages 2 0 R >>']);
  add(2,[`<< /Type /Pages /Count ${pages} /Kids [${Array.from({length:pages},(_,i)=>`${3+i*2} 0 R`).join(' ')}] >>`]);
  for(let pg=0;pg<pages;pg++){
    const pageObj=3+pg*2,contObj=pageObj+1,W=595,H=842,margin=34,gap=18,header=82;
    const subset=imgs.slice(pg*perPage,(pg+1)*perPage),cmds=[],xobjs=[];
    cmds.push(`BT /F1 17 Tf ${margin} ${H-35} Td (Exame Digital) Tj ET`);
    cmds.push(`BT /F1 10 Tf ${margin} ${H-54} Td (${pdfSafe(S.patient?.name||'Paciente')}) Tj ET`);
    const evs=[...new Set(subset.map(x=>evaluationLabel(x.evaluation_id)))];
    cmds.push(`BT /F1 9 Tf ${margin} ${H-69} Td (${pdfSafe(evs.join(' | '))}) Tj ET`);
    subset.forEach((im,k)=>{
      const global=pg*perPage+k,io=imageBase+global;
      xobjs.push(`/Im${global} ${io} 0 R`);
      const cellH=perPage===1?(H-header-margin):(H-header-margin-gap)/2,cellY=perPage===1?margin:margin+(1-k)*(cellH+gap),cellX=margin,cellW=W-2*margin;
      const metaH=im.observation||im.teeth.length?48:24;
      const imgAreaH=cellH-metaH;
      const scale=Math.min(cellW/im.w,imgAreaH/im.h),w=im.w*scale,h=im.h*scale,x=cellX+(cellW-w)/2,y=cellY+metaH+(imgAreaH-h)/2;
      cmds.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${global} Do Q`);
      const teeth=im.teeth.length?`Dente${im.teeth.length>1?'s':''}: ${im.teeth.join(', ')}`:'Sem dente vinculado';
      cmds.push(`BT /F1 9 Tf ${cellX} ${cellY+metaH-13} Td (${pdfSafe(teeth)}) Tj ET`);
      pdfWrap(im.observation||'',82,2).forEach((line,li)=>cmds.push(`BT /F1 8 Tf ${cellX} ${cellY+metaH-27-(li*11)} Td (${pdfSafe(line)}) Tj ET`));
    });
    cmds.push(`BT /F1 8 Tf ${W-92} 18 Td (Pagina ${pg+1}/${pages}) Tj ET`);
    const stream=cmds.join('\n');
    add(pageObj,[`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> /XObject << ${xobjs.join(' ')} >> >> /Contents ${contObj} 0 R >>`]);
    add(contObj,[`<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream`]);
  }
  imgs.forEach((im,i)=>add(imageBase+i,[`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.u.length} >>\nstream\n`,im.u,'\nendstream']));
  const xref=pos;push(`xref\n0 ${N+1}\n0000000000 65535 f \n`);for(let i=1;i<=N;i++)push(`${String(offs[i]||0).padStart(10,'0')} 00000 n \n`);
  push(`trailer\n<< /Size ${N+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const blob=new Blob(parts,{type:'application/pdf'}),u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download=`exame-digital-${(S.patient?.name||'paciente').replace(/\W+/g,'-')}.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1500)
}
async function deleteSelected(){
  if(!can('exam.delete'))return;
  const items=selected();
  if(!confirm(`Mover ${items.length} imagem(ns) para a lixeira? Elas poderão ser restauradas por 30 dias.`))return;
  for(const x of items){
    if(x.temporary){S.session=S.session.filter(t=>`tmp:${t.id}`!==x.storageId);continue}
    const r=await client().from('cronos_exam_images').update({deleted_at:new Date().toISOString(),deleted_by:currentActor()?.authUid||null}).eq('id',x.id);
    if(r.error)throw r.error;
  }
  S.selected.clear();await loadStored();
}
async function openTrash(){
  if(!can('exam.delete'))return;
  let tq=client().from('cronos_exam_images').select('*').eq('owner_uid',owner()).eq('patient_entry_id',pkey()).not('deleted_at','is',null);
  const tev=S.mode==='gallery'?S.galleryEvaluationId:S.evaluationId;if(tev&&tev!=='__all__')tq=tq.eq('evaluation_id',tev);
  const {data,error}=await tq.order('deleted_at',{ascending:false});
  if(error)throw error;
  const rows=await Promise.all((data||[]).map(async x=>{const {data:s}=await client().storage.from(BUCKET).createSignedUrl(x.storage_path,3600);return{...x,url:s?.signedUrl||''}}));
  const html=rows.length?rows.map(x=>`<article class="intraoralTrashItem"><img src="${esc(x.url)}"><div><strong>${new Date(x.captured_at).toLocaleString('pt-BR')}</strong><small>Excluída em ${new Date(x.deleted_at).toLocaleString('pt-BR')}</small><div class="intraoralTrashActions"><button class="btn" data-restore="${esc(x.id)}">Restaurar</button><button class="btn danger" data-purge="${esc(x.id)}" data-path="${esc(x.storage_path)}">Excluir permanentemente</button></div></div></article>`).join(''):'<div class="intraoralEmptyGallery">A lixeira está vazia.</div>';
  openModal({title:'Lixeira do Exame Digital',sub:`${S.patient?.name||''} • ${evaluationLabel(S.mode==='gallery'?S.galleryEvaluationId:S.evaluationId)} • retenção de 30 dias`,bodyHTML:`<div id="examTrashList" class="intraoralTrashList">${html}</div>`,footHTML:'<button class="btn" id="btnCloseTrash">Fechar</button>',maxWidth:'900px',onMount(){
    $('btnCloseTrash')?.addEventListener('click',()=>closeModal({force:true,source:'trash'}));
    $('examTrashList')?.addEventListener('click',async e=>{
      const r=e.target.closest('[data-restore]'),p=e.target.closest('[data-purge]');
      if(r){const q=await client().from('cronos_exam_images').update({deleted_at:null}).eq('id',r.dataset.restore);if(q.error)return alert(q.error.message);closeModal({force:true,source:'trash'});await openGallery({entryId:pkey(),evaluationId:S.galleryEvaluationId})}
      if(p&&confirm('Excluir esta imagem permanentemente? Esta ação não poderá ser desfeita.')){let q=await client().storage.from(BUCKET).remove([p.dataset.path]);if(q.error)return alert(q.error.message);q=await client().from('cronos_exam_images').delete().eq('id',p.dataset.purge);if(q.error)return alert(q.error.message);p.closest('.intraoralTrashItem')?.remove()}
    });
  }});
}
function lastCapturedPreviewItem(){
  const items=allItems();
  if(!items.length)return null;
  return items.slice().sort((a,b)=>new Date(b.captured_at||b.createdAt||0)-new Date(a.captured_at||a.createdAt||0))[0]||null;
}
function refreshExpandedLastPreview(){
  const box=$('expandedLastCapturePreview');if(!box)return;
  const item=lastCapturedPreviewItem();
  const src=String(item?.url||item?.dataUrl||'');
  if(!item||!src){
    box.hidden=true;
    box.innerHTML='';
    return;
  }
  box.hidden=false;
  box.innerHTML=`<img src="${esc(src)}" alt="Última foto capturada"><span>Última foto</span>`;
}
function setCameraExpanded(expanded){
  const view=$('view-intraoralExam');if(!view)return;
  const on=!!expanded;
  view.classList.toggle('camera-expanded',on);
  document.body.classList.toggle('cronos-camera-expanded',on);
  const btn=$('btnIntraoralExpand');
  if(btn){
    btn.textContent=on?'Sair da visão expandida':'Expandir visão';
    btn.setAttribute('aria-pressed',on?'true':'false');
  }
  if(on){
    refreshExpandedLastPreview();
    setTimeout(()=>{try{$('intraoralPreview')?.play()}catch(_){}},0);
  }
}
function toggleCameraExpanded(){
  const view=$('view-intraoralExam');if(!view)return;
  setCameraExpanded(!view.classList.contains('camera-expanded'));
}
function examViewHTML(){
  return`<section id="view-intraoralExam" class="intraoralWorkspaceView" aria-label="Novo Exame Digital">
    <div class="examWorkspaceHeader">
      <div class="titleBlock"><h2>Exame Digital</h2><p>Novo exame com câmera intraoral</p></div>
      <div class="examHeaderPatient"><small>Paciente</small><strong id="examPatientName">${esc(S.patient?.name||'Nenhum selecionado')}</strong><span id="examPatientHint">${S.patient?'Paciente selecionado':'Selecione um paciente'}</span></div>
      <button type="button" class="btn" id="btnCloseExamView" aria-label="Fechar Exame Digital">Fechar exame</button>
    </div>
    <div class="intraoralDiag">
      ${S.locked?'':`<section class="examPatientBar"><div class="intraoralPatientSection"><label class="intraoralField"><span>Localizar paciente</span><input id="intraoralPatientSearch" autocomplete="off" placeholder="Nome, telefone ou CPF"></label><div id="intraoralPatientResults" class="intraoralPatientResults"></div></div></section>`}

      <div class="examCaptureWorkspace examCaptureWorkspaceInitial">
        <section class="intraoralPanel examCameraPanel">
          <header class="examPreviewHeader"><strong>Preview ao vivo</strong><small>${esc(S.patient?evaluationLabel(S.evaluationId):'Selecione um paciente')}</small></header>
          <div class="examCameraToolbar">
            <label class="intraoralField"><span>Câmera</span><select id="intraoralDeviceSelect"></select></label>
            <button class="btn" id="btnIntraoralScan" type="button">Detectar</button>
            <button class="btn primary" id="btnIntraoralStart" type="button">Ativar câmera</button>
            <button class="btn" id="btnIntraoralStop" type="button">Desativar câmera</button>
            <button class="btn examExpandBtn" id="btnIntraoralExpand" type="button" aria-pressed="false">Expandir visão</button>
          </div>
          <div class="intraoralMedia">
            <video id="intraoralPreview" autoplay playsinline muted></video>
            <div class="intraoralCaptureOverlay"><button class="btn primary intraoralCaptureBtn" id="btnIntraoralCapture" type="button">Capturar foto</button></div>
            <button type="button" id="expandedLastCapturePreview" class="expandedLastCapturePreview" hidden aria-label="Abrir última foto capturada"></button>
          </div>
          <div id="intraoralStatusText" class="intraoralDiagnostic">${S.patient?'Pronto para ativar a câmera.':'Selecione um paciente.'}</div>
        </section>
        <aside class="intraoralPanel examCaptureSide">
          <label class="intraoralField"><span>Salvar novas fotos em</span><select id="examEvaluationSelect" ${S.patient?'':'disabled'}>${evaluationOptions(S.evaluationId,false)}</select></label>
          <button class="btn" id="btnExamUpload" type="button">Upload de imagens</button>
          <input class="intraoralUploadInput" id="examUploadInput" type="file" accept="image/jpeg,image/png,image/webp" multiple>
          <details class="examCameraConfig" id="examCameraConfig">
            <summary>Configurar câmera</summary>
            <p>Em “Aprender”, pressione o botão físico 1 vez e confirme o evento detectado. Depois teste o botão. O perfil fica somente neste navegador/computador e nesta câmera.</p>
            <div class="examCameraConfigActions"><button class="btn" id="btnLearnCameraButton" type="button">Aprender botão da câmera</button><button class="btn" id="btnForgetCameraButton" type="button">Esquecer perfil</button></div>
            <div id="cameraLearnStatus" class="examCameraLearnStatus">A captura manual continua sempre disponível.</div>
          </details>
        </aside>
      </div>

      <section class="intraoralStoredSection examWorkspaceGallery"><header><div><strong>Fotos desta avaliação</strong><small>${esc(S.patient?evaluationLabel(S.evaluationId):'Nenhum paciente selecionado')}</small></div><small id="intraoralGalleryCount">0 foto(s)</small></header>
        <div class="intraoralActionsV463"><span class="selectionInfo" id="intraoralSelectionInfo">0 selecionada(s)</span><button class="btn" id="btnExamSelectAll" type="button">Selecionar todas</button><button class="btn" id="btnExamDownload" type="button">Baixar</button><button class="btn" id="btnExamPdf" type="button">Gerar PDF</button><button class="btn danger" id="btnExamDelete" type="button">Mover para lixeira</button><button class="btn" id="btnExamTrash" type="button">Lixeira</button></div>
        <div id="intraoralGallery" class="intraoralGallery"></div>
      </section>


      <canvas id="intraoralCaptureCanvas" hidden></canvas>
    </div>
  </section>`
}

function currentReturnView(){
  const active=document.querySelector('.nav button.active[data-view]')?.dataset?.view;
  return ['dashboard','leads','kanban','tasks','installments','users','settings'].includes(active)?active:'dashboard'
}
function setExamNavActive(){
  document.querySelectorAll('.nav button').forEach(btn=>{
    const active=btn.id==='navIntraoralCamera';
    try{
      if(typeof window.CRONOS_SET_NAV_ACTIVE_VISUAL==='function')window.CRONOS_SET_NAV_ACTIVE_VISUAL(btn,active);
      else btn.classList.toggle('active',active)
    }catch(_){btn.classList.toggle('active',active)}
  })
}
function hideNativeViews(){
  NATIVE_VIEW_IDS.forEach(id=>{
    const node=$(`view-${id}`);if(!node)return;
    node.classList.add('hidden');if(['todayCronos','creditSimulator','performance'].includes(id))node.style.display='none'
  });
  $('stickyFilters')?.classList.add('hidden');
}
function installViewObserver(){
  if(S.viewObserver||typeof MutationObserver==='undefined')return;
  const main=document.querySelector('.main');if(!main)return;
  const observeNativeNodes=()=>NATIVE_VIEW_IDS.forEach(id=>{const node=$(`view-${id}`);if(node)S.viewObserver.observe(node,{attributes:true,attributeFilter:['class','style']})});
  S.viewObserver=new MutationObserver(()=>{
    if(!S.viewActive)return;
    observeNativeNodes();
    const nativeVisible=NATIVE_VIEW_IDS.some(id=>{const node=$(`view-${id}`);return node&&!node.classList.contains('hidden')&&node.style.display!=='none'});
    if(nativeVisible)leaveExamView({restore:false})
  });
  S.viewObserver.observe(main,{childList:true});observeNativeNodes()
}
function enterExamView(){
  const main=document.querySelector('.main');if(!main)throw new Error('Área principal do Cronos não encontrada.');
  S.returnView=currentReturnView();hideNativeViews();
  main.insertAdjacentHTML('beforeend',examViewHTML());
  try{main.scrollTo({top:0,left:0,behavior:'auto'});if(window.innerWidth<=980)$('view-intraoralExam')?.scrollIntoView({block:'start',behavior:'auto'})}catch(_){main.scrollTop=0}
  S.viewActive=true;document.body.classList.add('cronos-exam-view-open');setExamNavActive();installViewObserver();
}
function leaveExamView({restore=false}={}){
  if(!S.viewActive&&!$('view-intraoralExam')){stop();clearLightbox();return}
  const returnView=S.returnView||'dashboard';
  S.viewActive=false;cancelLearning();setCameraExpanded(false);
  clearPatientState({stopCamera:true});
  $('view-intraoralExam')?.remove();document.body.classList.remove('cronos-exam-view-open');S.locked=false;
  if(restore){
    if(typeof window.setActiveView==='function')window.setActiveView(returnView);
    else{$(`view-${returnView}`)?.classList.remove('hidden');$('stickyFilters')?.classList.toggle('hidden',!['dashboard','leads','kanban'].includes(returnView))}
  }
}
function clearImagesForEvaluation(){
  S.contextVersion+=1;clearTimeout(S.noteTimer);S.noteTimer=null;S.session=[];S.stored=[];S.selected.clear();S.editImageId='';S.editTeeth.clear();S.captureBusy=false;clearLightbox();render();renderPhotoEditor();syncCameraButtons()
}
async function selectExamPatient(entryId,search){
  clearPatientState({stopCamera:false,clearSearch:false});
  if(!setPatientById(entryId)){if(search)search.value='';status('Paciente não encontrado.');return false}
  syncPatientUI();render();renderPhotoEditor();results('');if(search)search.value=S.patient.name;
  const galleryLabel=document.querySelector('.examWorkspaceGallery header small');if(galleryLabel)galleryLabel.textContent=evaluationLabel(S.evaluationId);
  status(S.stream?'Paciente alterado. O estado anterior foi limpo.':'Paciente selecionado. Abra o preview.');
  await loadStored();return true
}
function bindExamView(){
  render();renderPhotoEditor();syncPatientUI();devices();syncCameraProfileUI();
  const ev=$('examEvaluationSelect');
  ev?.addEventListener('change',async()=>{
    clearImagesForEvaluation();S.evaluationId=ev.value;S.galleryEvaluationId=ev.value;
    const hdr=document.querySelector('#view-intraoralExam .examCameraPanel header small');if(hdr)hdr.textContent=evaluationLabel(S.evaluationId);
    const galleryLabel=document.querySelector('.examWorkspaceGallery header small');if(galleryLabel)galleryLabel.textContent=evaluationLabel(S.evaluationId);
    renderPhotoEditor();
    await loadStored()
  });
  $('btnIntraoralScan')?.addEventListener('click',devices);
  $('btnIntraoralStart')?.addEventListener('click',preview);
  $('btnIntraoralStop')?.addEventListener('click',stop);
  $('btnIntraoralExpand')?.addEventListener('click',toggleCameraExpanded);
  $('expandedLastCapturePreview')?.addEventListener('click',()=>{
    const item=lastCapturedPreviewItem();if(!item)return;
    const list=allItems(),key=String(item.storageId||item.id||'');
    const idx=list.findIndex(x=>String(x.storageId||x.id||'')===key);
    if(idx>=0){setCameraExpanded(false);openLightbox(idx);}
  });
  $('btnIntraoralCapture')?.addEventListener('click',()=>capture().catch(e=>alert(e.message)));
  $('intraoralDeviceSelect')?.addEventListener('change',e=>{cancelLearning();stop();S.deviceId=e.target.value;syncCameraProfileUI();status('Câmera alterada. Ative a câmera novamente.')});
  $('btnLearnCameraButton')?.addEventListener('click',startLearning);
  $('btnForgetCameraButton')?.addEventListener('click',forgetCameraProfile);
  $('btnCloseExamView')?.addEventListener('click',()=>leaveExamView({restore:true}));
  $('btnExamUpload')?.addEventListener('click',()=>$('examUploadInput').click());
  $('examUploadInput')?.addEventListener('change',e=>uploadFiles([...e.target.files]).catch(x=>alert(x.message)));
  $('btnExamSelectAll')?.addEventListener('click',()=>{const a=allItems();if(S.selected.size===a.length)S.selected.clear();else a.forEach(x=>S.selected.add(x.storageId));render()});
  $('btnExamDownload')?.addEventListener('click',()=>downloadSelected().catch(e=>alert(e.message)));
  $('btnExamPdf')?.addEventListener('click',()=>pdfSelected().catch(e=>alert(e.message)));
  $('btnExamDelete')?.addEventListener('click',()=>deleteSelected().catch(e=>alert(e.message)));
  $('btnExamTrash')?.addEventListener('click',()=>openTrash().catch(e=>alert(e.message)));
  $('intraoralGallery')?.addEventListener('click',e=>{
    const ed=e.target.closest('[data-edit-photo]');if(ed){e.preventDefault();selectEditImage(ed.dataset.editPhoto);return}
    const o=e.target.closest('[data-open]');if(o)lightbox(Number(o.dataset.open))
  });
  $('intraoralGallery')?.addEventListener('change',e=>{const c=e.target.closest('[data-select]');if(!c)return;c.checked?S.selected.add(c.dataset.select):S.selected.delete(c.dataset.select);render()});
  const s=$('intraoralPatientSearch');
  s?.addEventListener('input',()=>results(s.value));
  $('intraoralPatientResults')?.addEventListener('click',async e=>{
    const b=e.target.closest('[data-entry-id]');if(!b)return;
    await selectExamPatient(b.dataset.entryId,s)
  })
}
async function openExam(opt={}){
  if(!can('exam.capture'))return openGallery(opt);
  if(document.querySelector('#modalBody .intraoralDiag'))try{closeModal({force:true,source:'exam-view'})}catch(_){}
  if(S.viewActive)leaveExamView({restore:false});
  S.mode='exam';S.locked=!!opt.entryId;clearPatientState({stopCamera:true});
  if(opt.entryId&&!setPatientById(opt.entryId))return alert('Paciente não encontrado.');
  if(opt.evaluationId&&S.patient?.evaluations?.some(v=>String(v.id)===String(opt.evaluationId))){S.evaluationId=String(opt.evaluationId);S.galleryEvaluationId=S.evaluationId}
  enterExamView();bindExamView();syncPatientUI();render();renderPhotoEditor();
  if(S.patient)await loadStored()
}
async function openGallery(opt={}){
  if(!can('exam.view'))return alert('Você não tem acesso à galeria do Exame Digital.');
  if(S.viewActive)leaveExamView({restore:false});
  S.mode='gallery';S.locked=true;clearPatientState({stopCamera:true});
  if(opt.entryId&&!setPatientById(opt.entryId))return alert('Paciente não encontrado.');
  if(opt.evaluationId)S.galleryEvaluationId=String(opt.evaluationId);
  if(!S.galleryEvaluationId)S.galleryEvaluationId=S.patient?.evaluationId||S.patient?.evaluations?.[0]?.id||'eval_1';
  openModal({title:'Galeria de Exames Digitais',sub:S.patient?.name||'',bodyHTML:`<div class="intraoralDiag intraoralGalleryOnly">
    <div class="examGalleryFilter">
      <label class="intraoralField"><span>Ficha / avaliação</span><select id="examGalleryEvaluation">${evaluationOptions(S.galleryEvaluationId,true)}</select></label>
      <div class="intraoralAutosaveHint">A galeria abre na avaliação atual. Use “Todas as avaliações” para consultar o histórico completo.</div>
    </div>
    <section class="intraoralStoredSection"><header><div><strong>Imagens do paciente</strong><small id="examGalleryEvalLabel">${esc(evaluationLabel(S.galleryEvaluationId))}</small></div><small id="intraoralGalleryCount">0 foto(s)</small></header>
    <div class="intraoralActionsV463"><span class="selectionInfo" id="intraoralSelectionInfo">0 selecionada(s)</span>
    <button class="btn" id="btnExamSelectAll">Selecionar todas</button><button class="btn" id="btnExamDownload">Baixar</button><button class="btn" id="btnExamPdf">Gerar PDF</button></div>
    <div id="intraoralGallery" class="intraoralGallery"></div></section></div>`,
    footHTML:'<button class="btn" id="btnCloseGallery">Fechar</button>',modalClass:'modalIntraoralDiagnostic',maxWidth:'1240px',width:'calc(100vw - 32px)',
    onMount(){
      render();loadStored();
      const ge=$('examGalleryEvaluation');
      ge?.addEventListener('change',async()=>{S.contextVersion+=1;S.galleryEvaluationId=ge.value;S.stored=[];S.selected.clear();clearLightbox();render();const l=$('examGalleryEvalLabel');if(l)l.textContent=evaluationLabel(S.galleryEvaluationId);await loadStored()});
      $('btnCloseGallery')?.addEventListener('click',()=>closeModal({force:true,source:'gallery'}));
      $('btnExamSelectAll')?.addEventListener('click',()=>{const a=allItems();if(S.selected.size===a.length)S.selected.clear();else a.forEach(x=>S.selected.add(x.storageId));render()});
      $('btnExamDownload')?.addEventListener('click',()=>downloadSelected().catch(e=>alert(e.message)));
      $('btnExamPdf')?.addEventListener('click',()=>pdfSelected().catch(e=>alert(e.message)));
      $('intraoralGallery')?.addEventListener('click',e=>{const o=e.target.closest('[data-open]');if(o)lightbox(Number(o.dataset.open))});
      $('intraoralGallery')?.addEventListener('change',e=>{const c=e.target.closest('[data-select]');if(!c)return;c.checked?S.selected.add(c.dataset.select):S.selected.delete(c.dataset.select);render()});
      setTimeout(()=>{try{cronosResetModalGuard()}catch(_){}},80)
    }})
}
function syncExamNav(actorOverride){
  const n=$('navIntraoralCamera');if(!n)return false;
  if(window.__CRONOS_ACCESS_UI_SUSPENDED__===true) return !n.classList.contains('hidden');
  if(window.__CRONOS_BOOTING__===true || window.__CRONOS_INITIAL_UI_COMMITTED__!==true){
    return false;
  }
  const allowed=window.CronosPermissions?.isValidated?.()===true&&can('exam.capture',actorOverride);
  try{n.style.removeProperty('display')}catch(_){n.style.display=''}
  n.classList.toggle('hidden',!allowed);
  n.setAttribute('aria-hidden',allowed?'false':'true');
  return allowed
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>syncExamNav(),{once:true});
else syncExamNav();
function shutdownExam(){
  if(S.viewActive)leaveExamView({restore:false});
  else{cancelLearning();clearPatientState({stopCamera:true})}
}
document.addEventListener('cronos:before-logout',shutdownExam);
window.addEventListener('pagehide',shutdownExam);
document.addEventListener('keydown',handleCameraKey,true);
document.addEventListener('click',e=>{
  const n=e.target.closest('#navIntraoralCamera');if(n){e.preventDefault();openExam();return}
  const otherNav=e.target.closest('.nav button');if(otherNav&&S.viewActive){leaveExamView({restore:false});return}
  const nb=e.target.closest('[data-cronos-new-exam-entry]');if(nb){e.preventDefault();e.stopPropagation();openExam({entryId:nb.dataset.cronosNewExamEntry});return}
  const b=e.target.closest('[data-cronos-exam-entry]');if(b){e.preventDefault();e.stopPropagation();openGallery({entryId:b.dataset.cronosExamEntry})}
},true);
window.CRONOS_EXAM_DIGITAL={open:openExam,openForPatient:id=>openGallery({entryId:id}),newExamForPatient:id=>openExam({entryId:id}),reload:loadStored,stop,close:shutdownExam,syncAccess:syncExamNav};
})();
