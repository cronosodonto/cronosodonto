(function(){
  'use strict';
  const ACL_BUILD='v462.2';

  const SHARED=window.__CRONOS_SUPERADMIN_SHARED__||{};
  const CONFIG=SHARED.CONFIG||{};
  const state=SHARED.state||{};
  const ENDPOINT='permissions-admin';
  const ROLES=['MASTER','GERENTE','SECRETARIA','CRC','DENTISTA'];
  const ROLE_LABELS={MASTER:'Master',GERENTE:'Gerente',SECRETARIA:'Secretária',CRC:'CRC',DENTISTA:'Dentista'};
  let globalData=null, clinicData=null, selectedRole='MASTER', lastClinicId='', clinicLoadTimer=null;

  if(!CONFIG.endpoints) CONFIG.endpoints={};
  CONFIG.endpoints.permissionsAdmin=CONFIG.endpoints.permissionsAdmin||ENDPOINT;

  function call(payload){
    if(typeof SHARED.callEdgeFunction!=='function') throw new Error('Conector do Super Admin indisponível.');
    return SHARED.callEdgeFunction(CONFIG.endpoints.permissionsAdmin,payload);
  }
  function esc(value){ return typeof SHARED.escapeHtml==='function'?SHARED.escapeHtml(value):String(value??''); }
  function note(message,type='info'){ if(typeof SHARED.toast==='function') SHARED.toast(message,type,3000); }
  function loading(button,text,fn){ return typeof SHARED.withButtonLoading==='function'?SHARED.withButtonLoading(button,text,fn):fn(); }

  function injectStyles(){
    if(document.getElementById('aclStyles'))return;
    const style=document.createElement('style');style.id='aclStyles';style.textContent=`
      .acl-card{padding:18px}.acl-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}
      .acl-head h3{margin:0 0 5px;font-size:20px}.acl-head p{margin:0;color:var(--muted);font-size:13px;max-width:820px}
      .acl-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.acl-tab{border:1px solid var(--line);background:#0c1220;color:var(--muted);border-radius:12px;padding:9px 12px;font-weight:800;cursor:pointer}.acl-tab.active{color:#fff;border-color:rgba(25,198,255,.45);background:rgba(25,198,255,.12)}
      .acl-grid{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:10px}.acl-item{display:grid;grid-template-columns:1fr 160px;gap:12px;align-items:center;padding:12px;border:1px solid rgba(255,255,255,.06);border-radius:14px;background:rgba(255,255,255,.025)}
      .acl-item strong{display:block;font-size:13px}.acl-item small{display:block;margin-top:4px;color:var(--muted);font-size:11px;line-height:1.4}.acl-switch{display:flex;align-items:center;justify-content:flex-end;gap:8px}.acl-switch input{width:18px;height:18px;accent-color:#19c6ff}
      .acl-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:14px}.acl-user{border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px;background:rgba(255,255,255,.02)}.acl-user+.acl-user{margin-top:10px}.acl-user-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.acl-user-meta{display:grid;gap:3px}.acl-user-meta span{color:var(--muted);font-size:12px}.acl-user-editor{display:none;margin-top:12px}.acl-user.open .acl-user-editor{display:block}
      @media(max-width:900px){.acl-grid{grid-template-columns:1fr}.acl-item{grid-template-columns:1fr}.acl-switch{justify-content:flex-start}}
    `;document.head.appendChild(style);
  }

  function defaultMap(data,role){const map={};(data?.defaults||[]).filter(r=>r.role===role).forEach(r=>map[r.permission_key]=r.allowed===true);return map;}
  function overrideMap(data,role){const map={};(data?.clinic_role||[]).filter(r=>r.role===role).forEach(r=>map[r.permission_key]=r.allowed===true);return map;}
  function userOverrideMap(data,authUid){const map={};(data?.users||[]).filter(r=>String(r.auth_uid)===String(authUid)).forEach(r=>map[r.permission_key]=r.allowed===true);return map;}

  function ensureGlobalPanel(){
    injectStyles();if(document.getElementById('aclGlobalCard'))return;
    const anchor=document.getElementById('globalFeatureCard')||document.getElementById('statsGrid');if(!anchor)return;
    const card=document.createElement('div');card.className='card section-gap';card.id='aclGlobalCard';
    card.innerHTML=`<div class="acl-card"><div class="acl-head"><div><h3>Permissões padrão dos usuários</h3><p>Clínicas novas herdam esta matriz. Depois você pode personalizar um cargo inteiro em uma clínica ou criar uma exceção para um usuário específico.</p></div><button class="btn btn-ghost" id="aclRefreshGlobal" type="button">Atualizar</button></div><div class="acl-tabs" id="aclGlobalTabs"></div><div class="acl-grid" id="aclGlobalBody"><div class="helper">Carregando permissões...</div></div><div class="acl-actions"><button class="btn btn-primary" id="aclSaveGlobal" type="button">Salvar padrão global</button></div></div>`;
    anchor.insertAdjacentElement('afterend',card);
    const tabs=card.querySelector('#aclGlobalTabs');
    ROLES.forEach(role=>{const b=document.createElement('button');b.type='button';b.className='acl-tab'+(role===selectedRole?' active':'');b.textContent=ROLE_LABELS[role];b.dataset.role=role;b.onclick=()=>{selectedRole=role;tabs.querySelectorAll('.acl-tab').forEach(x=>x.classList.toggle('active',x.dataset.role===role));renderGlobalRole(role);};tabs.appendChild(b);});
    card.querySelector('#aclRefreshGlobal').onclick=()=>loadGlobal(true);card.querySelector('#aclSaveGlobal').onclick=saveGlobal;
  }
  function renderGlobalRole(role){
    const body=document.getElementById('aclGlobalBody');if(!body||!globalData)return;const map=defaultMap(globalData,role);
    body.innerHTML=(globalData.catalog||[]).map(p=>`<label class="acl-item"><div><strong>${esc(p.label)}</strong><small>${esc(p.description||p.permission_key)}</small></div><span class="acl-switch"><input type="checkbox" data-acl-global-key="${esc(p.permission_key)}" ${map[p.permission_key]===true?'checked':''}><span>${map[p.permission_key]===true?'Liberado':'Bloqueado'}</span></span></label>`).join('');
    body.querySelectorAll('input[data-acl-global-key]').forEach(i=>i.addEventListener('change',()=>{i.parentElement.querySelector('span').textContent=i.checked?'Liberado':'Bloqueado';}));
  }
  async function loadGlobal(showToast=false){
    ensureGlobalPanel();const body=document.getElementById('aclGlobalBody');if(body)body.innerHTML='<div class="helper">Carregando permissões...</div>';
    try{globalData=await call({action:'list_global'});renderGlobalRole(selectedRole);if(showToast)note('Permissões globais atualizadas.','success');}
    catch(e){console.error(e);if(body)body.innerHTML=`<div class="helper">${esc(e.message||'Não foi possível carregar as permissões.')}</div>`;}
  }
  async function saveGlobal(){
    const button=document.getElementById('aclSaveGlobal');const rows=[...document.querySelectorAll('#aclGlobalBody input[data-acl-global-key]')].map(i=>({role:selectedRole,permission_key:i.dataset.aclGlobalKey,allowed:i.checked}));
    return loading(button,'Salvando...',async()=>{await call({action:'save_global',rows});await loadGlobal(false);note(`Padrão de ${ROLE_LABELS[selectedRole]} salvo.`,'success');});
  }

  function currentClinicOwnerUid(){
    const details=state.selectedClinicDetails||{};
    const clinic=details.clinic||{};
    const priv=details.private||{};
    return String(
      clinic.owner_uid||clinic.ownerUid||clinic.master_uid||clinic.masterUid||
      priv.owner_uid||priv.ownerUid||priv.master_uid||priv.masterUid||''
    ).trim();
  }
  function currentClinicOwnerEmail(){
    const details=state.selectedClinicDetails||{};
    const clinic=details.clinic||{};
    const priv=details.private||{};
    return String(
      clinic.owner_email||clinic.ownerEmail||clinic.master_email||clinic.masterEmail||
      priv.owner_email||priv.ownerEmail||priv.master_email||priv.masterEmail||''
    ).trim().toLowerCase();
  }
  function currentClinicPayload(action,extra={}){
    return {
      action,
      clinic_id:state.selectedClinicId,
      owner_uid:currentClinicOwnerUid()||undefined,
      owner_email:currentClinicOwnerEmail()||undefined,
      ...extra
    };
  }
  function findUserId(user){return user?.auth_uid||user?.user_id||user?.authUid||'';}
  function roleForUser(user){return String(user?.role||'').toUpperCase();}

  function clinicRoleEditor(role){
    const defaults=defaultMap(clinicData,role),overrides=overrideMap(clinicData,role);
    return `<div class="acl-grid">${(clinicData.catalog||[]).map(p=>{const has=Object.prototype.hasOwnProperty.call(overrides,p.permission_key),value=has?(overrides[p.permission_key]?'allow':'deny'):'inherit',global=defaults[p.permission_key]===true?'liberado':'bloqueado';return `<div class="acl-item"><div><strong>${esc(p.label)}</strong><small>Padrão global: ${global}</small></div><select class="select" data-acl-clinic-role="${role}" data-acl-clinic-key="${esc(p.permission_key)}"><option value="inherit" ${value==='inherit'?'selected':''}>Usar global</option><option value="allow" ${value==='allow'?'selected':''}>Liberar</option><option value="deny" ${value==='deny'?'selected':''}>Bloquear</option></select></div>`;}).join('')}</div><div class="acl-actions"><button class="btn btn-primary" type="button" data-acl-save-role="${role}">Salvar ${ROLE_LABELS[role]}</button></div>`;
  }
  function userEditor(user){
    const uid=findUserId(user),role=roleForUser(user),userMap=userOverrideMap(clinicData,uid),clinicMap=overrideMap(clinicData,role),globals=defaultMap(clinicData,role);
    if(!uid)return `<div class="acl-user"><div class="acl-user-meta"><strong>${esc(user.name||user.display_name||user.email||'Usuário')}</strong><span>Sem auth_uid; personalização individual indisponível.</span></div></div>`;
    const count=Object.keys(userMap).length;
    return `<div class="acl-user"><div class="acl-user-head"><div class="acl-user-meta"><strong>${esc(user.name||user.display_name||user.email||'Usuário')}</strong><span>${esc(role||'Perfil')} • ${count?`${count} exceção(ões) individual(is)`:'usa o padrão do cargo'}</span></div><div class="row-actions"><button class="btn btn-ghost" type="button" data-acl-toggle-user="${esc(uid)}">Personalizar</button>${count?`<button class="btn btn-warning" type="button" data-acl-reset-user="${esc(uid)}">Usar padrão do cargo</button>`:''}</div></div><div class="acl-user-editor"><div class="acl-grid">${(clinicData.catalog||[]).map(p=>{const has=Object.prototype.hasOwnProperty.call(userMap,p.permission_key),base=Object.prototype.hasOwnProperty.call(clinicMap,p.permission_key)?clinicMap[p.permission_key]:globals[p.permission_key],value=has?(userMap[p.permission_key]?'allow':'deny'):'inherit';return `<div class="acl-item"><div><strong>${esc(p.label)}</strong><small>Padrão efetivo do cargo: ${base?'liberado':'bloqueado'}</small></div><select class="select" data-acl-user-key="${esc(p.permission_key)}"><option value="inherit" ${value==='inherit'?'selected':''}>Usar cargo</option><option value="allow" ${value==='allow'?'selected':''}>Liberar</option><option value="deny" ${value==='deny'?'selected':''}>Bloquear</option></select></div>`;}).join('')}</div><div class="acl-actions"><button class="btn btn-primary" type="button" data-acl-save-user="${esc(uid)}">Salvar usuário</button></div></div></div>`;
  }
  function ensureClinicSection(){
    const root=document.getElementById('detailContent');if(!root||!state.selectedClinicId||state.selectedClinicDetails?.__loading)return null;
    let section=document.getElementById('detailAclSection');if(section)return section;
    section=document.createElement('details');section.className='section';section.id='detailAclSection';section.open=true;section.innerHTML=`<summary>Permissões de acesso dos usuários</summary><div class="section-body"><div class="helper">A clínica herda o padrão global. Personalize apenas quando precisar de uma regra diferente.</div><div class="acl-tabs" id="aclClinicTabs"></div><div id="aclClinicRoleBody"><div class="helper">Carregando...</div></div><div style="height:1px;background:var(--line);margin:16px 0"></div><div><strong>Exceções por usuário</strong><div class="helper" style="margin-top:5px">Uma exceção individual tem prioridade sobre o padrão do cargo.</div></div><div id="aclClinicUsers"></div></div>`;
    const usersSection=[...root.querySelectorAll('details.section')].find(n=>n.querySelector('summary')?.textContent.trim()==='Usuários da clínica');
    if(usersSection?.parentNode)usersSection.parentNode.insertBefore(section,usersSection);else root.appendChild(section);return section;
  }
  function renderClinic(){
    const section=ensureClinicSection();if(!section||!clinicData)return;const tabs=section.querySelector('#aclClinicTabs');tabs.innerHTML='';
    ROLES.forEach(role=>{const b=document.createElement('button');b.type='button';b.className='acl-tab'+(role===selectedRole?' active':'');b.dataset.role=role;b.textContent=ROLE_LABELS[role];b.onclick=()=>{selectedRole=role;tabs.querySelectorAll('.acl-tab').forEach(x=>x.classList.toggle('active',x.dataset.role===role));section.querySelector('#aclClinicRoleBody').innerHTML=clinicRoleEditor(role);bindClinicButtons();};tabs.appendChild(b);});
    section.querySelector('#aclClinicRoleBody').innerHTML=clinicRoleEditor(selectedRole);const users=state.selectedClinicDetails?.users||[];section.querySelector('#aclClinicUsers').innerHTML=users.length?users.map(userEditor).join(''):'<div class="empty">Nenhum usuário retornado para esta clínica.</div>';bindClinicButtons();
  }
  function collectMode(select){return {permission_key:select.dataset.aclClinicKey||select.dataset.aclUserKey,mode:select.value,allowed:select.value==='allow'};}
  function bindClinicButtons(){
    const section=document.getElementById('detailAclSection');if(!section)return;
    section.querySelectorAll('[data-acl-save-role]').forEach(btn=>btn.onclick=()=>loading(btn,'Salvando...',async()=>{const role=btn.dataset.aclSaveRole,rows=[...section.querySelectorAll(`select[data-acl-clinic-role="${role}"]`)].map(collectMode);await call(currentClinicPayload('save_clinic_role',{role,rows}));await loadClinic(state.selectedClinicId,true);note(`Permissões de ${ROLE_LABELS[role]} salvas para esta clínica.`,'success');}));
    section.querySelectorAll('[data-acl-toggle-user]').forEach(btn=>btn.onclick=()=>btn.closest('.acl-user')?.classList.toggle('open'));
    section.querySelectorAll('[data-acl-save-user]').forEach(btn=>btn.onclick=()=>loading(btn,'Salvando...',async()=>{const box=btn.closest('.acl-user'),rows=[...box.querySelectorAll('select[data-acl-user-key]')].map(collectMode),uid=btn.dataset.aclSaveUser;await call(currentClinicPayload('save_user',{auth_uid:uid,rows}));await loadClinic(state.selectedClinicId,true);note('Permissões individuais salvas.','success');}));
    section.querySelectorAll('[data-acl-reset-user]').forEach(btn=>btn.onclick=async()=>{if(!confirm('Remover as exceções deste usuário e voltar ao padrão do cargo?'))return;await call(currentClinicPayload('reset_user',{auth_uid:btn.dataset.aclResetUser}));await loadClinic(state.selectedClinicId,true);note('Usuário voltou ao padrão do cargo.','success');});
  }
  async function loadClinic(clinicId,force=false){
    if(!clinicId||state.selectedClinicDetails?.__loading)return;if(!force&&clinicData&&String(clinicId)===String(lastClinicId)){renderClinic();return;}lastClinicId=String(clinicId);
    const section=ensureClinicSection();if(section){const body=section.querySelector('#aclClinicRoleBody');if(body)body.innerHTML='<div class="helper">Carregando permissões...</div>';}
    try{clinicData=await call(currentClinicPayload('list_clinic'));renderClinic();}catch(e){console.error(e);const body=document.querySelector('#detailAclSection #aclClinicRoleBody');if(body)body.innerHTML=`<div class="helper">${esc(e.message||'Não foi possível carregar as permissões.')}</div>`;}
  }
  function watchDetail(){
    const root=document.getElementById('detailContent');if(!root)return;const observer=new MutationObserver(()=>{clearTimeout(clinicLoadTimer);clinicLoadTimer=setTimeout(()=>{if(state.selectedClinicId&&!state.selectedClinicDetails?.__loading)loadClinic(state.selectedClinicId,true);},80);});observer.observe(root,{childList:true,subtree:false});
  }
  function boot(){injectStyles();ensureGlobalPanel();loadGlobal(false);watchDetail();if(state.selectedClinicId&&!state.selectedClinicDetails?.__loading)loadClinic(state.selectedClinicId,true);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,100));else setTimeout(boot,100);
  window.CronosSuperadminPermissions={loadGlobal,loadClinic};
})();
