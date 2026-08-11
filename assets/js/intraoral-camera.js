/* Cronos V463 — Exame Digital: câmera + Storage + galeria + upload/download/PDF. */
(function(){
'use strict';
if(window.__CRONOS_EXAM_V463__) return; window.__CRONOS_EXAM_V463__=true;
const BUCKET='cronos-exam-digital';
const S={stream:null,patient:null,locked:false,devices:[],deviceId:'',session:[],stored:[],selected:new Set(),lightboxIndex:0,evaluationId:'',galleryEvaluationId:'',editImageId:'',editTeeth:new Set(),mode:'gallery',noteTimer:null};
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const can=k=>window.CronosPermissions?.can?.(k,typeof currentActor==='function'?currentActor():null)===true;
const client=()=>typeof supabaseClient!=='undefined'?supabaseClient:window.supabaseClient;
const owner=()=>String((typeof CLOUD_CLINIC_OWNER_UID!=='undefined'&&CLOUD_CLINIC_OWNER_UID)||(typeof CLOUD_OWNER_UID!=='undefined'&&CLOUD_OWNER_UID)||'');
const pkey=()=>S.patient?String(S.patient.entryId):'';
function status(t){const e=$('intraoralStatusText');if(e)e.textContent=t}
function stop(){if(S.stream)S.stream.getTracks().forEach(t=>t.stop());S.stream=null;const v=$('intraoralPreview');if(v)v.srcObject=null}
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
function toothGridHTML(){
  const row=(a,cls='')=>`<div class="examToothRow ${cls}">${a.map(n=>`<button type="button" class="examTooth ${S.editTeeth.has(n)?'selected':''}" data-tooth="${n}" title="Dente ${n}">${n}</button>`).join('')}</div>`;
  return`<div class="examOdontoMini"><div class="examOdontoLabel">Permanentes</div>${PERM_ROWS.map((r,i)=>row(r,i===2?'examJawGap':'')).join('')}<details><summary>Dentes decíduos</summary>${DEC_ROWS.map((r,i)=>row(r,i===2?'examJawGap':'')).join('')}</details></div>`
}
function results(q){q=String(q||'').trim().toLowerCase();const box=$('intraoralPatientResults');if(!box)return;if(!q){box.innerHTML='';box.classList.remove('show');return}const r=patients().filter(x=>[x.name,x.phone,x.cpf].some(v=>String(v||'').toLowerCase().includes(q))).slice(0,20);box.innerHTML=r.map(x=>`<button type="button" class="intraoralPatientResult" data-entry-id="${esc(x.entryId)}"><b>${esc(x.name)}</b><span>${esc(x.phone||x.cpf||'')}</span></button>`).join('')||'<div class="intraoralSearchEmpty">Nenhum paciente encontrado.</div>';box.classList.add('show')}
async function devices(){if(!navigator.mediaDevices?.enumerateDevices)return;S.devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');const s=$('intraoralDeviceSelect');if(s){s.innerHTML=S.devices.map((d,i)=>`<option value="${esc(d.deviceId)}">${esc(d.label||`Câmera ${i+1}`)}</option>`).join('');if(S.deviceId)s.value=S.deviceId}}
async function preview(){if(!S.patient)return status('Selecione um paciente.');stop();try{const id=$('intraoralDeviceSelect')?.value;S.stream=await navigator.mediaDevices.getUserMedia({video:id?{deviceId:{exact:id},width:{ideal:1920},height:{ideal:1080}}:{width:{ideal:1920},height:{ideal:1080}},audio:false});const v=$('intraoralPreview');v.srcObject=S.stream;await v.play();S.deviceId=S.stream.getVideoTracks()[0]?.getSettings?.().deviceId||id||'';await devices();status('Preview ativo.')}catch(e){status(`Erro: ${e.message||e.name}`)}}
async function persistImage(x){
  if(!S.patient) throw new Error('Selecione um paciente.');
  if(!S.evaluationId) throw new Error('Selecione a avaliação/ficha.');
  const path=`${owner()}/${pkey()}/${S.evaluationId}/${new Date(x.createdAt).toISOString().slice(0,10)}/${crypto.randomUUID()}.jpg`;
  const blob=dataUrlBlob(x.dataUrl);
  let r=await client().storage.from(BUCKET).upload(path,blob,{contentType:'image/jpeg',upsert:false});
  if(r.error) throw r.error;
  const row={owner_uid:owner(),patient_entry_id:pkey(),patient_name:S.patient.name,evaluation_id:S.evaluationId,storage_path:path,source:x.source,mime_type:'image/jpeg',width:x.width,height:x.height,captured_at:x.createdAt};
  r=await client().from('cronos_exam_images').insert(row).select('*').single();
  if(r.error){await client().storage.from(BUCKET).remove([path]);throw r.error}
  return r.data;
}
async function capture(){
  if(!can('exam.capture'))return alert('Sem permissão para capturar imagens.');
  const v=$('intraoralPreview'),c=$('intraoralCaptureCanvas');
  if(!S.patient||!S.stream||!v?.videoWidth)return status('Abra o preview antes de capturar.');
  c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0,c.width,c.height);
  const x={id:crypto.randomUUID(),dataUrl:c.toDataURL('image/jpeg',.92),width:c.width,height:c.height,source:'camera',createdAt:new Date().toISOString()};
  S.session.push(x); render(); status('Salvando foto...');
  try{const saved=await persistImage(x);S.session=S.session.filter(t=>t.id!==x.id);S.editImageId=saved?.id||'';status('Foto salva.');await loadStored();selectEditImage(S.editImageId)}
  catch(e){status('Falha ao salvar. A foto continua nesta sessão.');console.error(e);render()}
}
async function normalizeFile(file){return new Promise((res,rej)=>{const img=new Image(),u=URL.createObjectURL(file);img.onload=()=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);URL.revokeObjectURL(u);c.toBlob(b=>b?res({blob:b,width:c.width,height:c.height}):rej(new Error('Falha ao converter imagem')),'image/jpeg',.92)};img.onerror=()=>rej(new Error('Imagem inválida'));img.src=u})}
async function uploadFiles(files){
  if(!can('exam.capture'))return alert('Sem permissão para importar imagens.');
  status('Importando imagens...');
  for(const f of files){
    if(!f.type.startsWith('image/'))continue;
    const n=await normalizeFile(f),dataUrl=await blobDataUrl(n.blob);
    const x={id:crypto.randomUUID(),dataUrl,width:n.width,height:n.height,source:'upload',createdAt:new Date().toISOString()};
    S.session.push(x);render();
    try{const saved=await persistImage(x);S.session=S.session.filter(t=>t.id!==x.id);S.editImageId=saved?.id||S.editImageId}
    catch(e){console.error(e);status('Uma imagem não pôde ser salva.');}
  }
  await loadStored();if(S.editImageId)selectEditImage(S.editImageId);status('Upload concluído.');
}
function blobDataUrl(b){return new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(b)})}
function dataUrlBlob(u){const [h,b]=u.split(','),mime=/data:([^;]+)/.exec(h)?.[1]||'image/jpeg',bin=atob(b),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return new Blob([a],{type:mime})}
async function loadStored(){
  if(!S.patient||!can('exam.view')){S.stored=[];render();return}
  let q=client().from('cronos_exam_images').select('*').eq('owner_uid',owner()).eq('patient_entry_id',pkey()).is('deleted_at',null);
  const filter=S.mode==='gallery'?S.galleryEvaluationId:S.evaluationId;
  if(filter&&filter!=='__all__')q=q.eq('evaluation_id',filter);
  const {data,error}=await q.order('captured_at',{ascending:false});
  if(error){console.warn(error);status('Não foi possível carregar a galeria.');return}
  const ids=(data||[]).map(x=>x.id);
  let toothRows=[];
  if(ids.length){
    const tr=await client().from('cronos_exam_image_teeth').select('image_id,tooth_number').in('image_id',ids);
    if(!tr.error)toothRows=tr.data||[];
  }
  const byImage={};
  toothRows.forEach(t=>(byImage[t.image_id]??=[]).push(String(t.tooth_number)));
  S.stored=await Promise.all((data||[]).map(async x=>{
    const {data:s}=await client().storage.from(BUCKET).createSignedUrl(x.storage_path,3600);
    return{...x,teeth:byImage[x.id]||[],url:s?.signedUrl||''}
  }));
  render();renderPhotoEditor();
}
async function saveSession(){if(!S.patient||!S.session.length)return;if(!can('exam.capture'))return alert('Sem permissão para salvar exames.');status('Salvando imagens...');for(const x of [...S.session]){const path=`${owner()}/${pkey()}/${new Date(x.createdAt).toISOString().slice(0,10)}/${crypto.randomUUID()}.jpg`,blob=dataUrlBlob(x.dataUrl);let r=await client().storage.from(BUCKET).upload(path,blob,{contentType:'image/jpeg',upsert:false});if(r.error)throw r.error;const row={owner_uid:owner(),patient_entry_id:pkey(),patient_name:S.patient.name,evaluation_id:S.evaluationId||null,storage_path:path,source:x.source,mime_type:'image/jpeg',width:x.width,height:x.height,captured_at:x.createdAt};r=await client().from('cronos_exam_images').insert(row);if(r.error){await client().storage.from(BUCKET).remove([path]);throw r.error}}S.session=[];status('Exame salvo.');await loadStored()}
function allItems(){
  return[
    ...S.session.map(x=>({...x,url:x.dataUrl,temporary:true,storageId:`tmp:${x.id}`,evaluation_id:S.evaluationId,teeth:[]})),
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
      ${S.mode==='exam'&&!x.temporary&&can('exam.capture')?`<button type="button" class="btn examEditPhotoBtn" data-edit-photo="${esc(x.id)}">${editing?'Editando dados clínicos':'Vincular dente / observação'}</button>`:''}
    </article>`
  }).join(''):'<div class="intraoralEmptyGallery">Nenhuma imagem nesta avaliação.</div>';
  const info=$('intraoralSelectionInfo');if(info)info.textContent=`${S.selected.size} selecionada(s)`;
  ['btnExamDownload','btnExamPdf'].forEach(id=>{const e=$(id);if(e)e.disabled=!S.selected.size});
  const del=$('btnExamDelete');if(del){del.disabled=!S.selected.size||!can('exam.delete');del.hidden=!can('exam.delete')}
}
async function updateImageMetadata(id,{evaluationId,observation}={}){
  if(!id||!can('exam.capture'))return;
  const x=S.stored.find(v=>String(v.id)===String(id));if(!x)return;
  const ev=evaluationId!==undefined?evaluationId:(x.evaluation_id||S.evaluationId);
  const ob=observation!==undefined?observation:String(x.observation||'');
  const r=await client().rpc('cronos_update_exam_image_metadata',{p_id:id,p_evaluation_id:ev,p_observation:ob});
  if(r.error)throw r.error;
  x.evaluation_id=ev;x.observation=ob;
}
async function saveTeeth(id){
  if(!id||!can('exam.capture'))return;
  let r=await client().from('cronos_exam_image_teeth').delete().eq('image_id',id);
  if(r.error)throw r.error;
  const rows=[...S.editTeeth].map(n=>({image_id:id,tooth_number:n}));
  if(rows.length){r=await client().from('cronos_exam_image_teeth').insert(rows);if(r.error)throw r.error}
  const x=S.stored.find(v=>String(v.id)===String(id));if(x)x.teeth=[...S.editTeeth];
}
function renderPhotoEditor(){
  const box=$('examPhotoEditor');if(!box)return;
  const x=currentEdit();
  if(!x){box.innerHTML='<div class="examPhotoEditorEmpty">Depois de fotografar, escolha uma imagem abaixo para vincular dentes e observações.</div>';return}
  const evalId=String(x.evaluation_id||S.evaluationId||'');
  box.innerHTML=`<div class="examEditorHead"><div><strong>Dados clínicos da foto</strong><small>${new Date(x.captured_at).toLocaleString('pt-BR')}</small></div><button type="button" class="btn" id="btnPreviewEditPhoto">Ampliar</button></div>
    <label class="intraoralField"><span>Ficha / avaliação desta foto</span><select id="examPhotoEvaluation">${evaluationOptions(evalId,false)}</select></label>
    <div class="examEditorLabel">Dente(s) relacionado(s)</div>${toothGridHTML()}
    <label class="intraoralField"><span>Observação da imagem</span><textarea id="examPhotoObservation" rows="4" placeholder="Ex.: possibilidade de tratamento endodôntico, extração para implante...">${esc(x.observation||'')}</textarea></label>
    <div class="examEditorSaveState" id="examEditorSaveState">Alterações são salvas automaticamente.</div>`;
  $('btnPreviewEditPhoto')?.addEventListener('click',()=>{const i=allItems().findIndex(v=>String(v.id)===String(x.id));if(i>=0)lightbox(i)});
  $('examPhotoEvaluation')?.addEventListener('change',async e=>{
    const next=e.target.value;const state=$('examEditorSaveState');if(state)state.textContent='Movendo foto para a avaliação...';
    try{await updateImageMetadata(x.id,{evaluationId:next});if(state)state.textContent='Avaliação atualizada.';await loadStored()}
    catch(err){if(state)state.textContent='Falha ao atualizar.';alert(err.message)}
  });
  box.querySelectorAll('[data-tooth]').forEach(b=>b.addEventListener('click',async()=>{
    const n=b.dataset.tooth;S.editTeeth.has(n)?S.editTeeth.delete(n):S.editTeeth.add(n);b.classList.toggle('selected',S.editTeeth.has(n));
    const state=$('examEditorSaveState');if(state)state.textContent='Salvando dentes...';
    try{await saveTeeth(x.id);if(state)state.textContent='Dentes vinculados.';render()}
    catch(err){if(state)state.textContent='Falha ao salvar.';alert(err.message)}
  }));
  $('examPhotoObservation')?.addEventListener('input',e=>{
    clearTimeout(S.noteTimer);const value=e.target.value,state=$('examEditorSaveState');if(state)state.textContent='Digitando...';
    S.noteTimer=setTimeout(async()=>{try{if(state)state.textContent='Salvando observação...';await updateImageMetadata(x.id,{observation:value});if(state)state.textContent='Observação salva.';render()}catch(err){if(state)state.textContent='Falha ao salvar.'}},500)
  });
}

function selected(){const m=new Map(allItems().map(x=>[x.storageId,x]));return[...S.selected].map(id=>m.get(id)).filter(Boolean)}
function lightbox(i){
  const a=allItems();if(!a[i])return;S.lightboxIndex=i;
  let b=$('intraoralLightbox');
  if(!b){
    b=document.createElement('div');b.id='intraoralLightbox';b.className='intraoralLightbox';
    b.innerHTML='<button class="intraoralLightboxClose">×</button><button class="intraoralLightboxPrev">‹</button><img><button class="intraoralLightboxNext">›</button><div class="intraoralLightboxCaption"></div>';
    document.body.appendChild(b);
    b.querySelector('.intraoralLightboxClose').onclick=()=>b.hidden=true;
    b.querySelector('.intraoralLightboxPrev').onclick=()=>{const n=allItems().length;if(n)lightbox((S.lightboxIndex-1+n)%n)};
    b.querySelector('.intraoralLightboxNext').onclick=()=>{const n=allItems().length;if(n)lightbox((S.lightboxIndex+1)%n)}
  }
  const x=a[i],teeth=(x.teeth||[]).length?` • Dente${x.teeth.length>1?'s':''} ${(x.teeth||[]).join(', ')}`:'';
  const obs=x.observation?` • ${x.observation}`:'';
  b.hidden=false;b.querySelector('img').src=x.url;
  b.querySelector('.intraoralLightboxCaption').textContent=`${S.patient?.name||''} • ${evaluationLabel(x.evaluation_id)}${teeth}${obs}`;
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
function body(){
  const capture=can('exam.capture');
  return`<div class="intraoralDiag">
    ${S.locked?'':`<section class="intraoralPatientSection"><label class="intraoralField"><span>Localizar paciente</span><input id="intraoralPatientSearch" autocomplete="off" placeholder="Nome, telefone ou CPF"></label><div id="intraoralPatientResults" class="intraoralPatientResults"></div></section>`}
    <div class="intraoralPatientCard"><div><small>Paciente</small><strong id="examPatientName">${esc(S.patient?.name||'Nenhum selecionado')}</strong></div></div>
    ${capture?`<div class="examClinicalTop">
      <label class="intraoralField examEvalField"><span>Salvar novas fotos em</span><select id="examEvaluationSelect">${evaluationOptions(S.evaluationId,false)}</select></label>
      <div class="intraoralAutosaveHint">Cada foto é salva automaticamente na avaliação escolhida.</div>
    </div>
    <div class="intraoralToolbar"><label class="intraoralField"><span>Câmera</span><select id="intraoralDeviceSelect"></select></label><button class="btn" id="btnIntraoralScan">Detectar</button><button class="btn primary" id="btnIntraoralStart">Abrir preview</button><button class="btn" id="btnIntraoralStop">Parar</button></div>
    <div id="intraoralStatusText" class="intraoralDiagnostic">Pronto.</div>
    <div class="examClinicalLayout">
      <section class="intraoralPanel examCameraPanel"><header><strong>Preview ao vivo</strong><small>${esc(evaluationLabel(S.evaluationId))}</small></header><div class="intraoralMedia"><video id="intraoralPreview" autoplay playsinline muted></video></div><button class="btn primary intraoralCaptureBtn" id="btnIntraoralCapture">Capturar foto</button></section>
      <section class="intraoralPanel examClinicalPanel">
        <header><strong>Dados clínicos</strong><small>Vincule a foto ao odontograma</small></header>
        <button class="btn" id="btnExamUpload">Upload de imagens</button><input class="intraoralUploadInput" id="examUploadInput" type="file" accept="image/jpeg,image/png,image/webp" multiple>
        <div id="examPhotoEditor" class="examPhotoEditor"><div class="examPhotoEditorEmpty">Capture ou selecione uma foto abaixo para vincular dentes e observações.</div></div>
      </section>
    </div>`:''}
    <section class="intraoralStoredSection"><header><div><strong>Fotos desta avaliação</strong><small>${esc(evaluationLabel(S.evaluationId))}</small></div><small id="intraoralGalleryCount">0 foto(s)</small></header>
      <div class="intraoralActionsV463"><span class="selectionInfo" id="intraoralSelectionInfo">0 selecionada(s)</span><button class="btn" id="btnExamSelectAll">Selecionar todas</button><button class="btn" id="btnExamDownload">Baixar</button><button class="btn" id="btnExamPdf">Gerar PDF</button><button class="btn danger" id="btnExamDelete">Mover para lixeira</button><button class="btn" id="btnExamTrash">Lixeira</button></div>
      <div id="intraoralGallery" class="intraoralGallery"></div>
    </section>
    <canvas id="intraoralCaptureCanvas" hidden></canvas>
  </div>`
}
function bind(){
  render();devices();renderPhotoEditor();
  const ev=$('examEvaluationSelect');
  ev?.addEventListener('change',async()=>{
    S.evaluationId=ev.value;S.galleryEvaluationId=ev.value;S.selected.clear();S.editImageId='';S.editTeeth.clear();
    const hdr=document.querySelector('.examCameraPanel header small');if(hdr)hdr.textContent=evaluationLabel(S.evaluationId);
    await loadStored()
  });
  $('btnIntraoralScan')?.addEventListener('click',devices);
  $('btnIntraoralStart')?.addEventListener('click',preview);
  $('btnIntraoralStop')?.addEventListener('click',stop);
  $('btnIntraoralCapture')?.addEventListener('click',()=>capture().catch(e=>alert(e.message)));
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
    setPatientById(b.dataset.entryId);S.selected.clear();S.editImageId='';S.editTeeth.clear();results('');s.value=S.patient.name;
    const name=$('examPatientName');if(name)name.textContent=S.patient.name;
    if(ev){ev.innerHTML=evaluationOptions(S.evaluationId,false);ev.value=S.evaluationId}
    await loadStored()
  });
  setTimeout(()=>{try{cronosResetModalGuard()}catch(_){}},80)
}
async function openExam(opt={}){
  if(!can('exam.capture'))return openGallery(opt);
  S.mode='exam';S.locked=!!opt.entryId;S.selected.clear();S.session=[];S.editImageId='';S.editTeeth.clear();
  if(opt.entryId)setPatientById(opt.entryId);else S.patient=null;
  if(opt.evaluationId&&S.patient?.evaluations?.some(v=>String(v.id)===String(opt.evaluationId))){S.evaluationId=String(opt.evaluationId);S.galleryEvaluationId=S.evaluationId}
  openModal({title:'Exame digital',sub:S.patient?S.patient.name:'Selecione um paciente',bodyHTML:body(),footHTML:'<button class="btn" id="btnCloseExam">Fechar</button>',modalClass:'modalIntraoralDiagnostic',maxWidth:'1340px',width:'calc(100vw - 24px)',onMount(){
    bind();$('btnCloseExam')?.addEventListener('click',()=>{stop();closeModal({force:true,source:'exam'})});if(S.patient)loadStored();
    setTimeout(()=>{try{cronosResetModalGuard()}catch(_){}},80)
  }})
}
async function openGallery(opt={}){
  if(!can('exam.view'))return alert('Você não tem acesso à galeria do Exame Digital.');
  if(opt.entryId&&!setPatientById(opt.entryId))return alert('Paciente não encontrado.');
  S.mode='gallery';S.locked=true;S.selected.clear();S.session=[];S.editImageId='';S.editTeeth.clear();stop();
  if(opt.evaluationId)S.galleryEvaluationId=String(opt.evaluationId);
  if(!S.galleryEvaluationId)S.galleryEvaluationId=S.patient?.evaluationId||S.patient?.evaluations?.[0]?.id||'eval_1';
  openModal({title:'Galeria de Exames Digitais',sub:S.patient?.name||'',bodyHTML:`<div class="intraoralDiag intraoralGalleryOnly">
    <div class="examGalleryFilter">
      <label class="intraoralField"><span>Ficha / avaliação</span><select id="examGalleryEvaluation">${evaluationOptions(S.galleryEvaluationId,true)}</select></label>
      <div class="intraoralAutosaveHint">A galeria abre na avaliação atual. Use “Todas as avaliações” para consultar o histórico completo.</div>
    </div>
    <section class="intraoralStoredSection"><header><div><strong>Imagens do paciente</strong><small id="examGalleryEvalLabel">${esc(evaluationLabel(S.galleryEvaluationId))}</small></div><small id="intraoralGalleryCount">0 foto(s)</small></header>
    <div class="intraoralActionsV463"><span class="selectionInfo" id="intraoralSelectionInfo">0 selecionada(s)</span>
    <button class="btn" id="btnExamSelectAll">Selecionar todas</button><button class="btn" id="btnExamDownload">Baixar</button><button class="btn" id="btnExamPdf">Gerar PDF</button>
    ${can('exam.capture')?'<button class="btn primary" id="btnNewExam">Novo exame digital</button>':''}
    ${can('exam.delete')?'<button class="btn danger" id="btnExamDelete">Mover para lixeira</button><button class="btn" id="btnExamTrash">Lixeira</button>':''}</div>
    <div id="intraoralGallery" class="intraoralGallery"></div></section></div>`,
    footHTML:'<button class="btn" id="btnCloseGallery">Fechar</button>',modalClass:'modalIntraoralDiagnostic',maxWidth:'1240px',width:'calc(100vw - 32px)',
    onMount(){
      render();loadStored();
      const ge=$('examGalleryEvaluation');
      ge?.addEventListener('change',async()=>{S.galleryEvaluationId=ge.value;S.selected.clear();const l=$('examGalleryEvalLabel');if(l)l.textContent=evaluationLabel(S.galleryEvaluationId);await loadStored()});
      $('btnCloseGallery')?.addEventListener('click',()=>closeModal({force:true,source:'gallery'}));
      $('btnExamSelectAll')?.addEventListener('click',()=>{const a=allItems();if(S.selected.size===a.length)S.selected.clear();else a.forEach(x=>S.selected.add(x.storageId));render()});
      $('btnExamDownload')?.addEventListener('click',()=>downloadSelected().catch(e=>alert(e.message)));
      $('btnExamPdf')?.addEventListener('click',()=>pdfSelected().catch(e=>alert(e.message)));
      $('btnExamDelete')?.addEventListener('click',()=>deleteSelected().catch(e=>alert(e.message)));
      $('btnExamTrash')?.addEventListener('click',()=>openTrash().catch(e=>alert(e.message)));
      $('btnNewExam')?.addEventListener('click',()=>{const ev=S.galleryEvaluationId==='__all__'?(S.patient?.evaluationId||S.patient?.evaluations?.[0]?.id):S.galleryEvaluationId;closeModal({force:true,source:'gallery'});openExam({entryId:pkey(),evaluationId:ev})});
      $('intraoralGallery')?.addEventListener('click',e=>{const o=e.target.closest('[data-open]');if(o)lightbox(Number(o.dataset.open))});
      $('intraoralGallery')?.addEventListener('change',e=>{const c=e.target.closest('[data-select]');if(!c)return;c.checked?S.selected.add(c.dataset.select):S.selected.delete(c.dataset.select);render()});
      setTimeout(()=>{try{cronosResetModalGuard()}catch(_){}},80)
    }})
}
function syncExamNav(){const n=$('navIntraoralCamera');if(n)n.style.display=can('exam.capture')?'':'none'}
document.addEventListener('DOMContentLoaded',()=>{syncExamNav();setTimeout(syncExamNav,700)});
document.addEventListener('click',e=>{const n=e.target.closest('#navIntraoralCamera');if(n){e.preventDefault();openExam();return}const nb=e.target.closest('[data-cronos-new-exam-entry]');if(nb){e.preventDefault();e.stopPropagation();openExam({entryId:nb.dataset.cronosNewExamEntry});return}const b=e.target.closest('[data-cronos-exam-entry]');if(b){e.preventDefault();e.stopPropagation();openGallery({entryId:b.dataset.cronosExamEntry})}},true);
window.CRONOS_EXAM_DIGITAL={open:openExam,openForPatient:id=>openGallery({entryId:id}),newExamForPatient:id=>openExam({entryId:id}),reload:loadStored};
})();
