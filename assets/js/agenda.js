/* Cronos Agenda — V1.43.0
   Persistência da Agenda integrada à clínica pelo settings.agendaData, usando a camada oficial Cronos/Supabase.
   Horário de funcionamento e duração por profissional continuam usando as Configurações da clínica. */
(function(){
  'use strict';
  if(window.__CRONOS_AGENDA_V1420__) return;
  window.__CRONOS_AGENDA_V1420__ = true;

  const $ = (id)=>document.getElementById(id);
  const $$ = (sel, root=document)=>Array.from(root.querySelectorAll(sel));
  const nativeViews = ['dashboard','leads','kanban','tasks','installments','users','settings'];
  const auxViewIds = ['view-todayCronos','view-creditSimulator','view-performance','view-ficha'];
  const DEFAULT_SLOT_STEP = 30;
  const DEFAULT_CLINIC_PERIODS = [{start:'08:00',end:'12:00'},{start:'14:00',end:'19:00'}];

  const state = {
    mode:'day',
    date:localISODate(new Date()),
    professionalId:'',
    search:'',
    editing:null,
    drag:null,
    showCancelled:false,
    store:null,
    persisting:false,
    lastPersistedAt:''
  };

  const AGENDA_SETTINGS_KEY = 'agendaData';
  let agendaPersistChain = Promise.resolve(true);
  let agendaPersistRevision = 0;

  function esc(value){
    return String(value == null ? '' : value)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }
  function localISODate(date){
    const d=date instanceof Date?date:new Date(date);
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function parseDate(iso){
    const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return new Date();
    return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12,0,0,0);
  }
  function addDays(iso, days){const d=parseDate(iso);d.setDate(d.getDate()+Number(days||0));return localISODate(d)}
  function mondayOf(iso){const d=parseDate(iso);const wd=d.getDay();const diff=wd===0?-6:1-wd;d.setDate(d.getDate()+diff);return localISODate(d)}
  function fmtDate(iso,{short=false}={}){
    try{return parseDate(iso).toLocaleDateString('pt-BR',short?{day:'2-digit',month:'2-digit'}:{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}).replace('.', '');}catch(_){return iso||'—'}
  }
  function fmtDayName(iso){try{return parseDate(iso).toLocaleDateString('pt-BR',{weekday:'short'}).replace('.','').toUpperCase();}catch(_){return ''}}
  function normalizeTime(value){
    const m=String(value||'').match(/(\d{1,2}):(\d{2})/);if(!m)return '';
    return `${String(Math.min(23,Number(m[1]))).padStart(2,'0')}:${String(Math.min(59,Number(m[2]))).padStart(2,'0')}`;
  }
  function timeToMin(t){const m=normalizeTime(t).match(/(\d{2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):99999}
  function initials(name){return String(name||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'?'}
  function uuid(prefix='agenda'){
    try{return `${prefix}_${crypto.randomUUID()}`;}catch(_){return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`}
  }
  function toastSafe(title,msg){try{if(typeof toast==='function')toast(title,msg);else console.info(title,msg)}catch(_){}}
  function actor(){try{return typeof currentActor==='function'?currentActor():null}catch(_){return null}}
  function actorLabel(){const a=actor();return String(a?.name||a?.username||a?.email||'Usuário').trim()||'Usuário'}
  function fmtDateTime(value){
    if(!value)return '—';
    try{const d=new Date(value);if(Number.isNaN(d.getTime()))return String(value);return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).replace(',', ' -');}catch(_){return String(value)}
  }
  function db(){try{return typeof loadDB==='function'?loadDB():null}catch(_){return null}}
  function agendaClinicBranding(){
    const data=db()||{},a=actor()||{};
    const byClinic=data?.settings?.clinicBranding?.byClinic||{};
    const candidates=[a?.masterId,a?.clinicId,a?.authUid,a?.id].filter(Boolean).map(String);
    let row=null;
    for(const key of candidates){if(byClinic&&byClinic[key]){row=byClinic[key];break;}}
    if(!row){const keys=Object.keys(byClinic||{});if(keys.length===1)row=byClinic[keys[0]];}
    row=row&&typeof row==='object'?row:{};
    return {
      clinicName:String(row.clinicName||a?.masterName||a?.clinicName||'Clínica').trim()||'Clínica',
      clinicPhone:String(row.clinicPhone||'').trim(),
      logoDataUri:String(row.logoDataUri||'').trim()
    };
  }
  function minutesToTime(min){
    const n=Math.max(0,Math.min(1439,Number(min)||0));
    return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
  }
  function clonePeriods(periods){return (periods||[]).map(p=>({start:normalizeTime(p?.start),end:normalizeTime(p?.end)})).filter(p=>p.start&&p.end)}
  function normalizeClinicPeriods(periods){
    let rows=clonePeriods(periods).filter(p=>timeToMin(p.end)>timeToMin(p.start));
    if(!rows.length)rows=clonePeriods(DEFAULT_CLINIC_PERIODS);
    rows.sort((a,b)=>timeToMin(a.start)-timeToMin(b.start));
    return rows;
  }
  function clinicSchedule(){
    const configured=db()?.settings?.agendaSchedule?.periods;
    return {periods:normalizeClinicPeriods(Array.isArray(configured)?configured:DEFAULT_CLINIC_PERIODS)};
  }
  function professionalStep(professionalId){
    const raw=Number(professionalById(professionalId)?.agendaDurationMin);
    return Number.isFinite(raw)&&raw>=5&&raw<=240?Math.round(raw):DEFAULT_SLOT_STEP;
  }
  function fitsInClinicPeriod(time,professionalId){
    const start=timeToMin(time),duration=professionalStep(professionalId);
    if(!Number.isFinite(start)||start>1439)return false;
    return clinicSchedule().periods.some(p=>start>=timeToMin(p.start)&&start+duration<=timeToMin(p.end));
  }
  function baseDayTimes(professionalId){
    const duration=professionalStep(professionalId),out=[];
    clinicSchedule().periods.forEach(p=>{
      const start=timeToMin(p.start),end=timeToMin(p.end);
      for(let min=start;min+duration<=end;min+=duration)out.push(minutesToTime(min));
    });
    return Array.from(new Set(out));
  }
  function scheduleLabel(){return clinicSchedule().periods.map(p=>`${p.start}–${p.end}`).join(' • ')}
  function scheduleBreaks(){
    const periods=clinicSchedule().periods;
    const gaps=[];
    for(let i=1;i<periods.length;i++){
      const prevEnd=periods[i-1]?.end, nextStart=periods[i]?.start;
      if(prevEnd&&nextStart&&timeToMin(nextStart)>timeToMin(prevEnd))gaps.push({start:prevEnd,end:nextStart});
    }
    return gaps;
  }
  function scheduleBreaksLabel(){return scheduleBreaks().map(g=>`${g.start}–${g.end}`).join(' • ')}
  function emptyStore(){return {version:8,appointments:[],history:[],blocks:[],extraSlots:[],reminders:[],anamneses:{},certificates:{},prescriptions:{},overrides:{},updatedAt:'',updatedBy:''}}
  function normalizeAgendaStore(value){
    const raw=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    const out={...emptyStore(),...raw};
    if(!Array.isArray(out.appointments))out.appointments=[];
    if(!Array.isArray(out.history))out.history=[];
    if(!Array.isArray(out.blocks))out.blocks=[];
    if(!Array.isArray(out.extraSlots))out.extraSlots=[];
    if(!Array.isArray(out.reminders))out.reminders=[];
    if(!out.anamneses||typeof out.anamneses!=='object'||Array.isArray(out.anamneses))out.anamneses={};
    if(!out.certificates||typeof out.certificates!=='object'||Array.isArray(out.certificates))out.certificates={};
    if(!out.prescriptions||typeof out.prescriptions!=='object'||Array.isArray(out.prescriptions))out.prescriptions={};
    if(!out.overrides||typeof out.overrides!=='object'||Array.isArray(out.overrides))out.overrides={};
    out.version=8;
    return out;
  }
  function cloneAgendaStore(value){
    try{return JSON.parse(JSON.stringify(normalizeAgendaStore(value)));}catch(_){return normalizeAgendaStore(value)}
  }
  function loadStore(){
    const data=db();
    const stored=data?.settings?.[AGENDA_SETTINGS_KEY];
    state.store=normalizeAgendaStore(stored);
    state.lastPersistedAt=String(state.store.updatedAt||'');
    return state.store;
  }
  function saveStore(){
    if(!state.store)loadStore();
    const now=new Date().toISOString();
    state.store.updatedAt=now;
    state.store.updatedBy=actorLabel();
    const snapshot=cloneAgendaStore(state.store);
    const revision=++agendaPersistRevision;

    // Atualiza imediatamente a memória oficial da clínica para que toda a UI use o mesmo estado.
    const live=db();
    if(live){
      if(!live.settings||typeof live.settings!=='object')live.settings={};
      live.settings[AGENDA_SETTINGS_KEY]=cloneAgendaStore(snapshot);
    }

    agendaPersistChain=agendaPersistChain.catch(()=>true).then(async()=>{
      state.persisting=true;
      try{
        const current=db();
        if(!current)throw new Error('Base da clínica indisponível.');
        if(!current.settings||typeof current.settings!=='object')current.settings={};
        current.settings[AGENDA_SETTINGS_KEY]=cloneAgendaStore(snapshot);
        let ok=false;
        if(typeof cronosPersistSettingsPatch==='function'){
          ok=await cronosPersistSettingsPatch(current,{[AGENDA_SETTINGS_KEY]:cloneAgendaStore(snapshot)},{silent:true,keepPendingOnFailure:true});
        }else if(typeof saveDB==='function'){
          ok=await saveDB(current,{immediate:true,silent:true});
        }else{
          throw new Error('Persistência da clínica indisponível.');
        }
        if(!ok)throw new Error('O Supabase não confirmou a alteração da Agenda.');
        if(revision===agendaPersistRevision){
          state.lastPersistedAt=snapshot.updatedAt;
          try{window.dispatchEvent(new CustomEvent('cronos:agenda-saved',{detail:{updatedAt:snapshot.updatedAt}}));}catch(_){ }
        }
        return true;
      }catch(error){
        console.error('Agenda: falha ao salvar na clínica',error);
        if(revision===agendaPersistRevision){
          toastSafe('Agenda não salva',String(error?.message||'Não foi possível confirmar a alteração. Tente novamente antes de atualizar a página.'));
        }
        return false;
      }finally{
        if(revision===agendaPersistRevision)state.persisting=false;
      }
    });
    return true;
  }

  function getProfessionals(){
    const data=db(), a=actor();let list=[];
    try{if(typeof cronosGetProfessionals==='function')list=cronosGetProfessionals(data,a,{activeOnly:true})||[]}catch(_){ }
    if(!list.length){
      const raw=Array.isArray(data?.settings?.professionals)?data.settings.professionals:[];
      list=raw.filter(p=>p&&p.active!==false);
    }
    return list.map(p=>({id:String(p.id||''),name:String(p.name||'Profissional'),cro:String(p.cro||''),uf:String(p.uf||''),specialty:String(p.specialty||''),phone:String(p.phone||''),agendaDurationMin:Number(p.agendaDurationMin)||DEFAULT_SLOT_STEP}));
  }
  function getContacts(){return Array.isArray(db()?.contacts)?db().contacts:[]}
  function contactMap(){return new Map(getContacts().map(c=>[String(c.id),c]))}
  function getEntries(){return Array.isArray(db()?.entries)?db().entries:[]}
  function latestEntryForContact(contactId){
    const id=String(contactId||'');return getEntries().filter(e=>String(e.contactId||'')===id).sort((a,b)=>String(b.lastUpdateAt||b.firstContactAt||'').localeCompare(String(a.lastUpdateAt||a.firstContactAt||'')))[0]||null;
  }
  function professionalById(id){return getProfessionals().find(p=>String(p.id)===String(id))||null}
  function professionalName(id){return professionalById(id)?.name||(!id?'Não definido':'Profissional')}

  function normalizeAgendaStatus(raw){
    const s=String(raw||'').trim().toLowerCase();
    if(s.includes('desmarc')||s.includes('cancel'))return 'Desmarcado';
    if(s.includes('remarc'))return 'Remarcado';
    if(s.includes('falt'))return 'Falta';
    if(s.includes('recep')||s.includes('aguard'))return 'Recepção';
    if(s.includes('realiz')||s.includes('compareceu'))return 'Realizado';
    return 'Agendado';
  }
  function sourceLooksConfirmed(raw){return String(raw||'').toLowerCase().includes('confirm')}
  function appointmentStatus(a){return normalizeAgendaStatus(typeof a==='object'?(a.agendaStatus||a.status):a)}
  function appointmentConfirmed(a){return !!(a&&typeof a==='object'?(a.confirmed===true||sourceLooksConfirmed(a.sourceStatus)):sourceLooksConfirmed(a))}
  function statusClass(value){
    const s=appointmentStatus(value).toLowerCase();
    if(s==='realizado')return 'realized';
    if(s==='recepção')return 'reception';
    if(s==='falta')return 'missed';
    if(s==='desmarcado')return 'cancelled';
    if(s==='remarcado')return 'rescheduled';
    return 'scheduled';
  }
  function isCancelled(a){return appointmentStatus(a)==='Desmarcado'}
  function isRescheduledHistory(a){return appointmentStatus(a)==='Remarcado'||String(a?.historyType||'')==='reschedule'}
  function isHistorical(a){return isCancelled(a)||isRescheduledHistory(a)}
  function rescheduleFor(a){const r=a?.reschedule;return r&&typeof r==='object'&&!Array.isArray(r)?r:null}
  function cancellationFor(a){
    const c=a?.cancellation;
    return c&&typeof c==='object'&&!Array.isArray(c)?c:null;
  }
  function cancellationRequester(a){
    const raw=String(cancellationFor(a)?.requestedBy||'').trim().toLowerCase();
    if(raw==='patient'||raw==='paciente')return 'patient';
    if(raw==='clinic'||raw==='clínica'||raw==='clinica')return 'clinic';
    return '';
  }
  function cancellationRequesterLabel(a){
    const who=cancellationRequester(a);
    return who==='patient'?'Paciente':(who==='clinic'?'Clínica':'');
  }
  function cancellationTagClass(a){
    const who=cancellationRequester(a);
    return who==='patient'?'cancelled-by-patient':(who==='clinic'?'cancelled-by-clinic':'');
  }
  function statusLabel(value){
    const base=appointmentStatus(value);
    if(!value||typeof value!=='object')return base;
    if(base==='Desmarcado'){
      const who=cancellationRequester(value);
      return who==='patient'?'Desmarcado pelo paciente':(who==='clinic'?'Desmarcado pela clínica':'Desmarcado');
    }
    if(base==='Remarcado'){
      const r=rescheduleFor(value),toTime=normalizeTime(r?.toTime||'');
      const toDate=String(r?.toDate||'');
      if(toDate&&toDate!==String(value.date||''))return `Remarcado → ${fmtDate(toDate,{short:true})} • ${toTime||'—'}`;
      return toTime?`Remarcado → ${toTime}`:'Remarcado';
    }
    return base;
  }
  function auditForEntry(e,ov={}){
    const oa=ov?.agendaAudit&&typeof ov.agendaAudit==='object'?ov.agendaAudit:{};
    return {
      createdAt:String(oa.createdAt||e?.createdAt||e?.firstContactAt||''),
      createdBy:String(oa.createdBy||e?.createdBy||'registro antigo'),
      updatedAt:String(oa.updatedAt||''),
      updatedBy:String(oa.updatedBy||'')
    };
  }
  function markAudit(target,createdFallback={}){
    const now=new Date().toISOString();
    const current=target?.agendaAudit&&typeof target.agendaAudit==='object'?target.agendaAudit:{};
    target.agendaAudit={
      createdAt:current.createdAt||createdFallback.createdAt||now,
      createdBy:current.createdBy||createdFallback.createdBy||actorLabel(),
      updatedAt:now,
      updatedBy:actorLabel()
    };
    return target.agendaAudit;
  }
  function baseAppointments(){
    const cm=contactMap();const overrides=state.store?.overrides||{};
    return getEntries().map(e=>{
      const date=String(e.apptDate||'').slice(0,10);const time=normalizeTime(e.apptTime||'');
      if(!date||!time)return null;
      const key=String(e.id||'');const ov=overrides[key]||{};if(ov.hidden===true)return null;
      const c=cm.get(String(e.contactId||''))||{};
      const profId=String(ov.professionalId!==undefined?ov.professionalId:(e.professionalId||''));
      const sourceStatus=String(e.status||'Agendado');
      return {
        id:`entry:${key}`,entryId:key,contactId:String(e.contactId||''),source:'cronos',
        date:String(ov.date||date),time:normalizeTime(ov.time||time),professionalId:profId,
        patient:String(c.name||'Paciente'),phone:String(c.phone||''),
        procedure:String(ov.procedure||e.treatmentOther||e.treatment||'Consulta'),
        insurance:String(ov.insurance||e.convenio||e.convênio||e.insurance||c.convenio||c.convênio||c.insurance||'Particular'),sourceStatus,
        agendaStatus:String(ov.agendaStatus||normalizeAgendaStatus(ov.status||sourceStatus)),
        confirmed:ov.confirmed!==undefined?!!ov.confirmed:sourceLooksConfirmed(ov.status||sourceStatus),
        cancellation:ov.cancellation&&typeof ov.cancellation==='object'&&!Array.isArray(ov.cancellation)?{...ov.cancellation}:null,
        note:String(e.notes||''),audit:auditForEntry(e,ov),overridden:Object.keys(ov).length>0
      };
    }).filter(Boolean);
  }
  function localAppointments(){
    return (state.store?.appointments||[]).map(a=>({...a,source:'agenda',time:normalizeTime(a.time),professionalId:String(a.professionalId||''),insurance:String(a.insurance||'Particular'),agendaStatus:normalizeAgendaStatus(a.agendaStatus||a.status),confirmed:!!a.confirmed,cancellation:a.cancellation&&typeof a.cancellation==='object'&&!Array.isArray(a.cancellation)?{...a.cancellation}:null,reschedule:a.reschedule&&typeof a.reschedule==='object'&&!Array.isArray(a.reschedule)?{...a.reschedule}:null,audit:{createdAt:a.createdAt||'',createdBy:a.createdBy||'Usuário',updatedAt:a.updatedAt||'',updatedBy:a.updatedBy||''}})).filter(a=>a.date&&a.time);
  }
  function historyAppointments(){
    return (state.store?.history||[]).map(a=>({...a,source:'history',time:normalizeTime(a.time),professionalId:String(a.professionalId||''),insurance:String(a.insurance||'Particular'),agendaStatus:normalizeAgendaStatus(a.agendaStatus||a.status||'Remarcado'),confirmed:false,reschedule:a.reschedule&&typeof a.reschedule==='object'&&!Array.isArray(a.reschedule)?{...a.reschedule}:null,audit:{createdAt:a.createdAt||'',createdBy:a.createdBy||'Usuário',updatedAt:a.updatedAt||'',updatedBy:a.updatedBy||''}})).filter(a=>a.date&&a.time);
  }
  function allAppointments(){return baseAppointments().concat(localAppointments(),historyAppointments()).sort((a,b)=>`${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))}
  function appointmentById(id){return allAppointments().find(a=>String(a.id)===String(id))||null}
  function blocksFor(date,professionalId){return (state.store?.blocks||[]).filter(b=>b.date===date && (String(b.professionalId||'')===String(professionalId||'')))}
  function isBlocked(date,time,professionalId){return blocksFor(date,professionalId).find(b=>normalizeTime(b.time)===normalizeTime(time))||null}

  function ensureProfessionalSelection(){
    const pros=getProfessionals();
    if(!pros.length){state.professionalId='';return}
    if(!pros.some(p=>String(p.id)===String(state.professionalId)))state.professionalId=String(pros[0].id);
  }
  function appointmentsFor(date,professionalId,{allProfessionals=false,includeCancelled=state.showCancelled}={}){
    return allAppointments().filter(a=>a.date===date && (allProfessionals||String(a.professionalId||'')===String(professionalId||'')) && (includeCancelled||!isHistorical(a)));
  }
  function dayTimes(date,professionalId){
    const set=new Set(baseDayTimes(professionalId));
    appointmentsFor(date,professionalId).forEach(a=>set.add(normalizeTime(a.time)));
    blocksFor(date,professionalId).forEach(b=>set.add(normalizeTime(b.time)));
    (state.store?.extraSlots||[]).filter(x=>x.date===date&&String(x.professionalId||'')===String(professionalId||'')).forEach(x=>set.add(normalizeTime(x.time)));
    return Array.from(set).filter(Boolean).sort((a,b)=>timeToMin(a)-timeToMin(b));
  }

  function appointmentAuditTip(a){
    const au=a?.audit||{};
    let text=`Agendado em: ${fmtDateTime(au.createdAt)}
Por: ${au.createdBy||'registro antigo'}`;
    if(au.updatedAt){text+=`

Atualizada em: ${fmtDateTime(au.updatedAt)}
Por: ${au.updatedBy||'Usuário'}`;}
    if(isCancelled(a)){
      const c=cancellationFor(a),who=cancellationRequesterLabel(a);
      const cancelledAt=String(c?.cancelledAt||au.updatedAt||'');
      const cancelledBy=String(c?.cancelledBy||au.updatedBy||'');
      text+=`

Desmarcado em: ${fmtDateTime(cancelledAt)}`;
      if(who)text+=`
Solicitação: ${who}`;
      if(cancelledBy)text+=`
Registrado por: ${cancelledBy}`;
      if(String(c?.note||'').trim())text+=`
Observação: ${String(c.note).trim()}`;
    }
    if(isRescheduledHistory(a)){
      const r=rescheduleFor(a),toProf=professionalName(r?.toProfessionalId||'');
      text+=`

Remarcado em: ${fmtDateTime(r?.rescheduledAt||au.updatedAt||au.createdAt||'')}`;
      text+=`
Novo horário: ${fmtDate(r?.toDate||a.date)} • ${normalizeTime(r?.toTime||'')||'—'}`;
      if(toProf&&toProf!=='Não definido')text+=`
Novo profissional: ${toProf}`;
      if(r?.rescheduledBy)text+=`
Registrado por: ${r.rescheduledBy}`;
    }
    return text;
  }
  function resolveEntryForAppointment(a){
    if(!a)return null;
    return a.entryId?getEntries().find(e=>String(e.id)===String(a.entryId)):latestEntryForContact(a.contactId);
  }

  function updateNavBadge(){
    const pill=$('pillAgenda');if(!pill)return;
    const today=localISODate(new Date());const count=allAppointments().filter(a=>a.date===today&&!isHistorical(a)).length;
    pill.textContent=count?String(count):'agenda';
  }
  function isAgendaOpen(){const v=$('view-agenda');return !!v&&!v.classList.contains('hidden')&&v.style.display!=='none'}
  function hideAgenda(){const v=$('view-agenda');if(v){v.classList.add('hidden');v.style.display='none'}const b=$('navAgenda');if(b)b.classList.remove('active')}
  function hideOtherViews(){
    nativeViews.forEach(v=>{const n=$(`view-${v}`);if(n){n.classList.add('hidden');n.style.display='none'}});
    auxViewIds.forEach(id=>{const n=$(id);if(n){n.classList.add('hidden');n.style.display='none'}});
    const sticky=$('stickyFilters');if(sticky){sticky.classList.add('hidden');sticky.style.display='none'};
    $$('.sidebar .nav button,.nav button').forEach(b=>b.classList.remove('active'));
  }
  function agendaFeatureAllowsOpen(){
    try{
      if(typeof window.CRONOS_CAN_SEE_MODULE==='function' && window.CRONOS_CAN_SEE_MODULE('agenda')!==true)return false;
      if(typeof window.CRONOS_CAN_OPEN_MODULE==='function' && window.CRONOS_CAN_OPEN_MODULE('agenda')!==true){
        try{window.CRONOS_SHOW_FEATURE_BLOCKED?.('agenda')}catch(_){}
        return false;
      }
    }catch(_){return false}
    return true;
  }
  function openAgenda(ev){
    if(!agendaFeatureAllowsOpen()){
      try{ev?.preventDefault?.();ev?.stopPropagation?.()}catch(_){}
      return false;
    }
    ensureProfessionalSelection();hideOtherViews();const v=$('view-agenda');if(!v)return false;
    v.classList.remove('hidden');v.style.display='';const b=$('navAgenda');if(b)b.classList.add('active');render();return true;
  }

  function render(){
    loadStore();ensureProfessionalSelection();
    const dateInput=$('agendaDate');if(dateInput&&dateInput.value!==state.date)dateInput.value=state.date;
    $$('.agendaModeBtn').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.mode));
    renderKpis();renderMain();updateNavBadge();
  }
  function professionalSelectorMarkup(){
    const pros=getProfessionals();
    if(!pros.length){
      return `<div class="agendaPanelProfessional"><span>Profissional</span><select id="agendaProfessionalSelect" disabled aria-label="Selecionar agenda do profissional"><option value="">Nenhum profissional cadastrado</option></select></div>`;
    }
    const current=String(state.professionalId||'');
    const options=pros.map(p=>{
      const count=appointmentsFor(state.date,p.id,{includeCancelled:false}).length;
      const specialty=p.specialty?` — ${p.specialty}`:'';
      return `<option value="${esc(p.id)}" ${String(p.id)===current?'selected':''}>${esc(p.name)}${esc(specialty)} (${count})</option>`;
    }).join('');
    return `<div class="agendaPanelProfessional"><span>Profissional</span><select id="agendaProfessionalSelect" aria-label="Selecionar agenda do profissional" title="Escolha a agenda que deseja visualizar">${options}</select></div>`;
  }
  function renderKpis(){
    const host=$('agendaKpis');if(!host)return;
    const appts=appointmentsFor(state.date,state.professionalId,{includeCancelled:false});const blocked=blocksFor(state.date,state.professionalId).length;
    const confirmed=appts.filter(appointmentConfirmed).length;
    const missed=appts.filter(a=>appointmentStatus(a)==='Falta').length;
    const realized=appts.filter(a=>appointmentStatus(a)==='Realizado').length;
    const grid=baseDayTimes(state.professionalId);const free=grid.filter(t=>!appts.some(a=>a.time===t)&&!isBlocked(state.date,t,state.professionalId)).length;
    host.innerHTML=`
      <div class="agendaKpi"><small>Consultas</small><strong>${appts.length}</strong><span>${realized} realizadas</span></div>
      <div class="agendaKpi"><small>Confirmados</small><strong>${confirmed}</strong><span>presença confirmada</span></div>
      <div class="agendaKpi"><small>Horários livres</small><strong>${free}</strong><span>${professionalStep(state.professionalId)} min por horário</span></div>
      <div class="agendaKpi"><small>Bloqueados / faltas</small><strong>${blocked+missed}</strong><span>${blocked} bloqueados • ${missed} faltas</span></div>`;
  }
  function panelHead(title,sub,extra=''){
    return `<div class="agendaPanelHead"><div><h3>${esc(title)}</h3><p>${esc(sub)}</p></div><div class="agendaPanelActions">${extra}</div></div>`;
  }
  function renderMain(){
    const host=$('agendaMain');if(!host)return;
    if(state.mode==='week')renderWeek(host);else if(state.mode==='multi')renderMulti(host);else renderDay(host);
  }
  function reminderForAppointment(id){
    return (state.store?.reminders||[]).filter(r=>String(r.appointmentId)===String(id)).sort((x,y)=>String(y.updatedAt||y.createdAt||'').localeCompare(String(x.updatedAt||x.createdAt||'')))[0]||null;
  }
  function reminderMarkup(a){
    const r=reminderForAppointment(a?.id);if(!r?.note)return '';
    const tip=esc(`Lembrete:
${r.note}`).replace(/\n/g,'&#10;');
    return `<button type="button" class="agendaReminderIcon" data-reminder-open="${esc(a.id)}" data-tip="${tip}" title="Lembrete" aria-label="Abrir lembrete">✉</button>`;
  }
  function consultationStatusValue(a){return appointmentConfirmed(a)&&appointmentStatus(a)==='Agendado'?'Confirmado':appointmentStatus(a)}
  function consultationStatusOptions(a){
    const current=consultationStatusValue(a);return ['Agendado','Confirmado','Recepção','Realizado','Falta'].map(x=>`<option value="${esc(x)}" ${x===current?'selected':''}>${esc(x)}</option>`).join('');
  }
  function openConsultationEdit(id){
    const a=appointmentById(id);if(!a)return;const prof=professionalById(a.professionalId);const duration=professionalStep(a.professionalId);
    const body=`<div class="agendaConsultEdit"><div class="agendaConsultEditPatient"><strong>${esc(a.patient)}</strong><span>${esc(a.phone||'')}</span></div><div class="agendaModalGrid"><div><label>Data</label><input type="text" value="${esc(fmtDate(a.date,{short:true}))}" disabled></div><div><label>Hora</label><input type="text" value="${esc(a.time)}" disabled></div><div class="full"><label>Profissional</label><input type="text" value="${esc(prof?.name||'Não definido')}" disabled></div><div><label>Status</label><select id="agendaConsultStatus">${consultationStatusOptions(a)}</select></div><div><label>Convênio</label><input id="agendaConsultInsurance" list="agendaConsultInsuranceList" value="${esc(a.insurance||'Particular')}"><datalist id="agendaConsultInsuranceList">${insuranceListOptions()}</datalist></div><div class="full agendaConsultProcedureRow"><label>Procedimento</label>${procedurePickerMarkup('agendaConsultProcedure',a.procedure||'')}<span class="agendaConsultDuration"><small>Tempo da agenda</small><b>${esc(duration)} min</b></span></div></div></div>`;
    if(typeof openModal==='function')openModal({title:'Alterar consulta',sub:'Status, convênio e procedimento desta consulta',bodyHTML:body,footHTML:`<button class="btn" type="button" onclick="closeModal()">Fechar</button><button class="btn primary" type="button" onclick="CRONOS_AGENDA.saveConsultationEdit('${esc(id)}')">Salvar</button>`,maxWidth:'min(94vw,780px)',width:'min(94vw,780px)',modalClass:'cronosAgendaModal'});
  }
  function saveConsultationEdit(id){
    const a=appointmentById(id);if(!a)return;const status=String($('agendaConsultStatus')?.value||'Agendado');const procedure=procedurePickerValue('agendaConsultProcedure')||'Consulta';const insurance=String($('agendaConsultInsurance')?.value||'Particular').trim()||'Particular';
    let agendaStatus=status,confirmed=false;if(status==='Confirmado'){agendaStatus='Agendado';confirmed=true;}
    if(mutateAppointment(id,{agendaStatus,confirmed,procedure,insurance})){try{closeModal({force:true})}catch(_){ }toastSafe('Consulta atualizada','Status, convênio e procedimento foram salvos na Agenda.');}
  }

  function cancelledToggleMarkup(){
    return `<label class="agendaCancelledToggle" title="Mostra desmarcações e horários anteriores de consultas remarcadas"><input type="checkbox" id="agendaToggleCancelled" ${state.showCancelled?'checked':''}><span>Exibir histórico</span></label>`;
  }
  function managementButtons(a){
    if(isHistorical(a))return `<span class="agendaHistoryOnly" title="Registro histórico da agenda">Histórico</span>`;
    return `<div class="agendaManagementButtons">
      <button class="agendaManageBtn agendaManageBlue" type="button" data-agenda-menu="status" data-agenda-id="${esc(a.id)}" title="Gerenciar consulta" aria-label="Gerenciar consulta">◷</button>
      <button class="agendaManageBtn agendaManageAmber" type="button" data-agenda-menu="patient" data-agenda-id="${esc(a.id)}" title="Atalhos do paciente" aria-label="Atalhos do paciente">▤</button>
    </div>`;
  }
  function statusMenuMarkup(a){
    const confirmed=appointmentConfirmed(a),st=appointmentStatus(a);
    const item=(action,label,extra='')=>`<button type="button" class="agendaFloatingItem ${extra}" data-agenda-action="${action}" data-agenda-id="${esc(a.id)}">${label}</button>`;
    return `${item('reminder','Lembrete')}${item('unbook','Desmarcar',st==='Desmarcado'?'is-active':'')}${item('reschedule','Remarcar')}${item('confirm',confirmed?'✓ Confirmado':'Confirmar',confirmed?'is-active':'')}${item('reception','Recepção',st==='Recepção'?'is-active':'')}${item('realized','Realizado',st==='Realizado'?'is-active':'')}${item('missed','Falta',st==='Falta'?'is-active':'')}`;
  }
  function patientMenuMarkup(a){
    const item=(action,label)=>`<button type="button" class="agendaFloatingItem" data-agenda-patient-action="${action}" data-agenda-id="${esc(a.id)}">${label}</button>`;
    return `${item('record','Prontuário')}${item('anamnesis','Anamnese')}${item('certificate','Atestado')}${item('prescription','Receituário')}${item('exam','Exame digital')}${item('finance','Financeiro')}`;
  }
  function closeFloatingMenu(){const old=$('agendaFloatingMenu');if(old)old.remove()}
  function openFloatingMenu(button,id,type){
    closeFloatingMenu();const a=appointmentById(id);if(!a)return;
    const menu=document.createElement('div');menu.id='agendaFloatingMenu';menu.className=`agendaFloatingMenu ${type==='patient'?'amber':'blue'}`;
    menu.innerHTML=`<div class="agendaFloatingTitle">${type==='patient'?'Paciente':'Consulta'}</div>${type==='patient'?patientMenuMarkup(a):statusMenuMarkup(a)}`;
    document.body.appendChild(menu);
    const r=button.getBoundingClientRect(),mw=Math.min(220,Math.max(176,menu.offsetWidth||190)),mh=menu.offsetHeight||300;
    let left=r.right-mw;left=Math.max(8,Math.min(left,window.innerWidth-mw-8));
    let top=r.bottom+6;if(top+mh>window.innerHeight-8)top=Math.max(8,r.top-mh-6);
    menu.style.left=`${Math.round(left)}px`;menu.style.top=`${Math.round(top)}px`;
    setTimeout(()=>document.addEventListener('click',agendaOutsideMenuClick,{capture:true,once:true}),0);
  }
  function agendaOutsideMenuClick(ev){const menu=$('agendaFloatingMenu');if(!menu)return;if(menu.contains(ev.target))return;closeFloatingMenu()}
  function selectableSlotCheckbox(time,kind,blockId=''){
    return `<input class="agendaSlotCheck" type="checkbox" data-agenda-slot-select data-slot-time="${esc(time)}" data-slot-kind="${esc(kind)}" ${blockId?`data-block-id="${esc(blockId)}"`:''} aria-label="Selecionar horário ${esc(time)}">`;
  }
  function selectedSlotChecks(host=document){return $$('[data-agenda-slot-select]:checked',host)}
  function refreshBulkSelectionUI(host=document){
    const all=$$('[data-agenda-slot-select]',host),selected=selectedSlotChecks(host);const master=$('agendaSelectAllSlots');
    if(master){master.checked=all.length>0&&selected.length===all.length;master.indeterminate=selected.length>0&&selected.length<all.length}
    const free=selected.filter(x=>x.dataset.slotKind==='free').length,blocked=selected.filter(x=>x.dataset.slotKind==='blocked').length;
    const blockBtn=$('agendaBulkBlock'),unblockBtn=$('agendaBulkUnblock'),count=$('agendaBulkCount');
    if(blockBtn)blockBtn.disabled=free===0;if(unblockBtn)unblockBtn.disabled=blocked===0;
    if(count)count.textContent=selected.length?`${selected.length} horário${selected.length===1?'':'s'} selecionado${selected.length===1?'':'s'}`:'Selecione horários livres ou bloqueados';
  }
  function bulkBlockSelected(host=document){
    const free=selectedSlotChecks(host).filter(x=>x.dataset.slotKind==='free');if(!free.length)return;
    const answer=prompt(`Motivo do bloqueio para ${free.length} horário${free.length===1?'':'s'} (opcional):`,'');if(answer===null)return;if(!state.store)loadStore();
    let added=0;free.forEach(box=>{const time=normalizeTime(box.dataset.slotTime);if(!time||isBlocked(state.date,time,state.professionalId)||appointmentsFor(state.date,state.professionalId,{includeCancelled:false}).some(a=>a.time===time))return;state.store.blocks.push({id:uuid('block'),date:state.date,time,professionalId:String(state.professionalId||''),note:String(answer||'').trim(),createdAt:new Date().toISOString()});added++});
    if(added){saveStore();render();toastSafe('Horários bloqueados',`${added} horário${added===1?'':'s'} bloqueado${added===1?'':'s'} na Agenda.`)}
  }
  function bulkUnblockSelected(host=document){
    const blocked=selectedSlotChecks(host).filter(x=>x.dataset.slotKind==='blocked');if(!blocked.length)return;if(!state.store)loadStore();
    const ids=new Set(blocked.map(x=>String(x.dataset.blockId||'')).filter(Boolean));const keys=new Set(blocked.map(x=>`${state.date}::${normalizeTime(x.dataset.slotTime)}::${String(state.professionalId||'')}`));const before=state.store.blocks.length;
    state.store.blocks=state.store.blocks.filter(b=>!ids.has(String(b.id||''))&&!keys.has(`${String(b.date||'')}::${normalizeTime(b.time)}::${String(b.professionalId||'')}`));const removed=before-state.store.blocks.length;
    if(removed){saveStore();render();toastSafe('Horários desbloqueados',`${removed} horário${removed===1?'':'s'} liberado${removed===1?'':'s'} na Agenda.`)}
  }
  function appointmentDayRowMarkup(a,time,{extraCount=0}={}){
    const cls=statusClass(a),outside=!fitsInClinicPeriod(time,state.professionalId),confirmed=appointmentConfirmed(a),historical=isHistorical(a);
    const auditTip=esc(appointmentAuditTip(a)).replace(/\n/g,'&#10;');
    const patientClass=historical?'agendaSlotPatient agendaHistoricalPatient':'agendaSlotPatient agendaAppointmentDraggable';
    const patientAttrs=historical?'':` draggable="true" data-agenda-id="${esc(a.id)}"`;
    const procedure=historical
      ? `<span class="agendaProcedure agendaProcedureHistorical">${esc(a.procedure||'Consulta')}</span>`
      : `<button type="button" class="agendaProcedure agendaProcedureButton" data-edit-consultation="${esc(a.id)}" title="Alterar status, convênio ou procedimento">${esc(a.procedure||'Consulta')}</button>`;
    const statusExtra=isCancelled(a)?` ${cancellationTagClass(a)}`:'';
    return `<tr class="agendaDayRow agendaState-${cls} ${historical?'agendaHistoricalRow':''} ${outside?'agendaOutsideHours':''}" data-drop-time="${esc(time)}"><td class="agendaSelectCell">—</td><td class="agendaTime">${esc(time)}</td><td><div class="${patientClass}"${patientAttrs} data-detail="${esc(a.id)}"><span class="agendaPatientDot"></span><span><div class="agendaPatientName">${esc(a.patient)}${!historical&&confirmed?'<span class="agendaConfirmedMark" title="Presença confirmada">✓</span>':''}</div><div class="agendaPatientPhone">${esc(a.phone||'')}</div></span></div>${extraCount>0?`<div class="muted" style="font-size:9px;margin-top:3px">+${extraCount} no mesmo horário</div>`:''}</td><td><div class="agendaProcedureWrap">${historical?'':reminderMarkup(a)}${procedure}</div>${outside?'<span class="agendaOutsideBadge" style="margin-top:4px">Fora do expediente</span>':''}</td><td><span class="agendaStatus ${cls}${statusExtra}">${esc(statusLabel(a))}</span></td><td class="agendaInfoCell"><button class="agendaInfoBtn" type="button" data-tip="${auditTip}" aria-label="Informações do agendamento">i</button></td><td><div class="agendaRowActions">${managementButtons(a)}</div></td></tr>`;
  }
  function blockedDayRowMarkup(time,block){
    return `<tr class="agendaDayRow agendaSlotSelectable" data-drop-time="${esc(time)}"><td class="agendaSelectCell">${selectableSlotCheckbox(time,'blocked',block.id)}</td><td class="agendaTime">${esc(time)}</td><td><span class="agendaBlockedLabel">● Bloqueado</span></td><td class="agendaEmpty">${esc(block.note||'Horário indisponível')}</td><td><span class="agendaStatus neutral">Bloqueado</span></td><td class="agendaInfoCell">—</td><td><div class="agendaRowActions"><button class="agendaMiniBtn" data-unblock="${esc(block.id)}">Desbloquear</button></div></td></tr>`;
  }
  function freeDayRowMarkup(time){
    const extra=(state.store?.extraSlots||[]).find(x=>x.date===state.date&&String(x.professionalId||'')===String(state.professionalId||'')&&normalizeTime(x.time)===time);
    const outside=extra&&!fitsInClinicPeriod(time,state.professionalId);
    return `<tr class="agendaDayRow agendaSlotSelectable ${outside?'agendaOutsideHours':''}" data-drop-time="${esc(time)}"><td class="agendaSelectCell">${selectableSlotCheckbox(time,'free')}</td><td class="agendaTime">${esc(time)}${extra?' <span title="Horário encaixado" class="agendaExtraMark">＋</span>':''}</td><td class="agendaEmpty">Horário livre</td><td class="agendaEmpty">${outside?'<span class="agendaOutsideBadge">Fora do expediente</span>':(extra?'<span class="agendaFitBadge">Encaixe</span>':'—')}</td><td><span class="agendaStatus neutral">Disponível</span></td><td class="agendaInfoCell">—</td><td><div class="agendaRowActions"><button class="agendaMiniBtn primary" data-new-time="${esc(time)}">Agendar</button><button class="agendaMiniBtn" data-block-time="${esc(time)}" title="Bloquear horário">Bloquear</button>${extra?`<button class="agendaMiniBtn" data-remove-extra="${esc(extra.id)}">Remover</button>`:''}</div></td></tr>`;
  }
  function renderDay(host){
    const prof=professionalById(state.professionalId);const list=appointmentsFor(state.date,state.professionalId);const byTime=new Map();list.forEach(a=>{if(!byTime.has(a.time))byTime.set(a.time,[]);byTime.get(a.time).push(a)});
    const times=dayTimes(state.date,state.professionalId);
    const rows=times.map(time=>{
      const appts=byTime.get(time)||[];const active=appts.filter(a=>!isHistorical(a));const history=appts.filter(isHistorical);const block=isBlocked(state.date,time,state.professionalId);const parts=[];
      if(state.showCancelled&&history.length)history.forEach(a=>parts.push(appointmentDayRowMarkup(a,time)));
      if(active.length){
        if(state.showCancelled)active.forEach(a=>parts.push(appointmentDayRowMarkup(a,time)));
        else parts.push(appointmentDayRowMarkup(active[0],time,{extraCount:Math.max(0,active.length-1)}));
        return parts.join('');
      }
      if(block){parts.push(blockedDayRowMarkup(time,block));return parts.join('');}
      parts.push(freeDayRowMarkup(time));
      return parts.join('');
    }).join('');
    const bulk=`<div class="agendaBulkActions"><div class="agendaBulkSummary"><span class="agendaBulkIcon">✓</span><span id="agendaBulkCount">Selecione horários livres ou bloqueados</span></div><div class="agendaBulkButtons"><button class="agendaMiniBtn" id="agendaBulkBlock" type="button" disabled>🔒 Bloquear selecionados</button><button class="agendaMiniBtn" id="agendaBulkUnblock" type="button" disabled>🔓 Desbloquear selecionados</button></div></div>`;
    host.innerHTML=panelHead(`${fmtDayName(state.date)} • ${fmtDate(state.date,{short:true})}`,prof?prof.name:'Agenda geral',`${professionalSelectorMarkup()}${cancelledToggleMarkup()}`)+`<div class="agendaDayWrap"><table class="agendaDayTable"><thead><tr><th class="agendaSelectHead"><input id="agendaSelectAllSlots" type="checkbox" aria-label="Selecionar todos os horários livres e bloqueados" title="Selecionar todos os horários gerenciáveis"></th><th style="width:78px">Hora</th><th>Paciente</th><th>Procedimento</th><th style="width:190px">Status</th><th style="width:52px;text-align:center">Info</th><th style="width:128px;text-align:right">Gerenciar</th></tr></thead><tbody>${rows}</tbody></table></div>${bulk}`;
    const master=$('agendaSelectAllSlots');if(master)master.onchange=()=>{$$('[data-agenda-slot-select]',host).forEach(x=>x.checked=master.checked);refreshBulkSelectionUI(host)};
    $$('[data-agenda-slot-select]',host).forEach(x=>x.onchange=()=>refreshBulkSelectionUI(host));
    $('agendaBulkBlock')?.addEventListener('click',()=>bulkBlockSelected(host));$('agendaBulkUnblock')?.addEventListener('click',()=>bulkUnblockSelected(host));refreshBulkSelectionUI(host);
    $$('[data-new-time]',host).forEach(b=>b.onclick=()=>openAppointmentForm({date:state.date,time:b.dataset.newTime,professionalId:state.professionalId}));
    $$('[data-block-time]',host).forEach(b=>b.onclick=()=>blockTime(state.date,b.dataset.blockTime,state.professionalId));
    $$('[data-unblock]',host).forEach(b=>b.onclick=()=>unblockTime(b.dataset.unblock));
    $$('[data-remove-extra]',host).forEach(b=>b.onclick=()=>removeExtraSlot(b.dataset.removeExtra));
    $$('[data-detail]',host).forEach(b=>b.onclick=e=>{if(e.target.closest('[data-agenda-menu]'))return;openDetails(b.dataset.detail)});
    $$('[data-agenda-menu]',host).forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();openFloatingMenu(b,b.dataset.agendaId,b.dataset.agendaMenu)});
    $$('[data-reminder-open]',host).forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();openReminder(b.dataset.reminderOpen)});
    $$('[data-edit-consultation]',host).forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();openConsultationEdit(b.dataset.editConsultation)});
    bindDrag(host);
  }
  function renderWeek(host){
    const start=mondayOf(state.date);const days=Array.from({length:7},(_,i)=>addDays(start,i));const today=localISODate(new Date());const prof=professionalById(state.professionalId);
    const cards=days.map(day=>{
      const appts=appointmentsFor(day,state.professionalId),activeCount=appts.filter(a=>!isHistorical(a)).length,historyCount=appts.length-activeCount;const countLabel=`${activeCount} consulta${activeCount===1?'':'s'}${state.showCancelled&&historyCount?` • ${historyCount} histórico${historyCount===1?'':'s'}`:''}`;return `<div class="agendaWeekDay ${day===today?'today':''}"><div class="agendaWeekHead" data-week-day="${day}"><span><strong>${fmtDayName(day)}</strong><br><span>${fmtDate(day,{short:true})}</span></span><span>${countLabel}</span></div><div class="agendaWeekBody">${appts.length?appts.map(a=>`<div class="agendaWeekAppt ${statusClass(a)}" data-detail="${esc(a.id)}"><b>${esc(a.time)} • ${esc(a.patient)} ${!isHistorical(a)&&appointmentConfirmed(a)?'<span class="agendaConfirmedMark" title="Presença confirmada">✓</span>':''}</b><small>${esc(a.procedure||'Consulta')}</small><small>${esc(statusLabel(a))}</small></div>`).join(''):`<div class="agendaWeekEmpty">Sem consultas</div>`}<button class="agendaMiniBtn" data-week-new="${day}">+ Agendar</button></div></div>`;
    }).join('');
    host.innerHTML=panelHead(`Semana de ${fmtDate(start,{short:true})}`,prof?prof.name:'Agenda geral',`${professionalSelectorMarkup()}${cancelledToggleMarkup()}<button class="btn small" id="agendaWeekToday">Ir para hoje</button>`)+`<div class="agendaWeekGrid">${cards}</div>`;
    $$('[data-week-day]',host).forEach(h=>h.onclick=()=>{state.date=h.dataset.weekDay;state.mode='day';render()});
    $$('[data-detail]',host).forEach(b=>b.onclick=()=>openDetails(b.dataset.detail));
    $$('[data-week-new]',host).forEach(b=>b.onclick=()=>openAppointmentForm({date:b.dataset.weekNew,time:firstFreeTime(b.dataset.weekNew,state.professionalId),professionalId:state.professionalId}));
    $('agendaWeekToday')?.addEventListener('click',()=>{state.date=localISODate(new Date());render()});
  }
  function renderMulti(host){
    const pros=getProfessionals();
    if(!pros.length){host.innerHTML=panelHead(`Multi-agenda • ${fmtDate(state.date,{short:true})}`,'Todos os profissionais')+'<div class="agendaEmptyState"><strong>Nenhum profissional cadastrado</strong>Cadastre profissionais clínicos para usar a Multi-agenda.</div>';return}
    const cols=pros.map(p=>{
      const appts=appointmentsFor(state.date,p.id),activeCount=appts.filter(a=>!isHistorical(a)).length,historyCount=appts.length-activeCount;const countLabel=`${activeCount} consulta${activeCount===1?'':'s'}${state.showCancelled&&historyCount?` • ${historyCount} histórico${historyCount===1?'':'s'}`:''}`;return `<div class="agendaMultiCol"><div class="agendaMultiHead"><strong>${esc(p.name)}</strong><small>${countLabel}</small></div><div class="agendaMultiBody">${appts.length?appts.map(a=>`<div class="agendaMultiSlot ${statusClass(a)}" data-detail="${esc(a.id)}"><time>${esc(a.time)}</time><span><b>${esc(a.patient)} ${!isHistorical(a)&&appointmentConfirmed(a)?'<span class="agendaConfirmedMark" title="Presença confirmada">✓</span>':''}</b><small>${esc(a.procedure||'Consulta')}</small><small>${esc(statusLabel(a))}</small></span></div>`).join(''):`<div class="agendaMultiEmpty">Agenda livre</div>`}<button class="agendaMiniBtn" data-multi-new="${esc(p.id)}">+ Agendar</button></div></div>`;
    }).join('');
    host.innerHTML=panelHead(`Multi-agenda • ${fmtDate(state.date,{short:true})}`,'Visão simultânea dos profissionais',`${cancelledToggleMarkup()}<span class="muted" style="font-size:10px">${pros.length} profissionais</span>`)+`<div class="agendaMultiWrap"><div class="agendaMultiGrid">${cols}</div></div>`;
    $$('[data-detail]',host).forEach(b=>b.onclick=()=>openDetails(b.dataset.detail));
    $$('[data-multi-new]',host).forEach(b=>b.onclick=()=>openAppointmentForm({date:state.date,time:firstFreeTime(state.date,b.dataset.multiNew),professionalId:b.dataset.multiNew}));
  }
  function firstFreeTime(date,profId){return baseDayTimes(profId).find(t=>!appointmentsFor(date,profId,{includeCancelled:false}).some(a=>a.time===t)&&!isBlocked(date,t,profId))||clinicSchedule().periods[0]?.start||'09:00'}

  function blockTime(date,time,professionalId){
    if(!state.store)loadStore();if(isBlocked(date,time,professionalId))return;
    const answer=prompt(`Motivo do bloqueio de ${normalizeTime(time)} (opcional):`,'');if(answer===null)return;
    state.store.blocks.push({id:uuid('block'),date,time:normalizeTime(time),professionalId:String(professionalId||''),note:String(answer||'').trim(),createdAt:new Date().toISOString()});saveStore();render();toastSafe('Horário bloqueado','Bloqueio salvo na Agenda da clínica.');
  }
  function unblockTime(id){if(!state.store)loadStore();state.store.blocks=state.store.blocks.filter(b=>String(b.id)!==String(id));saveStore();render();}
  function removeExtraSlot(id){if(!state.store)loadStore();state.store.extraSlots=state.store.extraSlots.filter(x=>String(x.id)!==String(id));saveStore();render();}
  function openFitTime(){
    const body=`<div class="agendaModalHint"><b>Encaixe manual:</b> crie um horário fora da grade automática. Se ele cair no intervalo ou fora do expediente, o Cronos avisa antes de liberar.</div><div class="agendaModalGrid"><div><label>Data</label><input id="agendaFitDate" type="date" value="${esc(state.date)}"></div><div><label>Horário</label><input id="agendaFitTime" type="time" value="09:15"></div><div class="full"><label>Profissional</label><select id="agendaFitProfessional">${professionalOptions(state.professionalId)}</select></div></div>`;
    if(typeof openModal==='function')openModal({title:'Encaixar horário',sub:`Expediente: ${scheduleLabel()}`,bodyHTML:body,footHTML:'<button class="btn" type="button" onclick="closeModal()">Cancelar</button><button class="btn primary" type="button" onclick="CRONOS_AGENDA.saveExtraSlot()">Adicionar horário</button>',maxWidth:'min(94vw,620px)',width:'min(94vw,620px)',modalClass:'cronosAgendaModal'});
  }
  function saveExtraSlot(){
    const date=$('agendaFitDate')?.value||'';const time=normalizeTime($('agendaFitTime')?.value||'');const professionalId=String($('agendaFitProfessional')?.value||'');if(!date||!time)return toastSafe('Data e horário','Informe a data e o horário.');if(!state.store)loadStore();
    const exists=dayTimes(date,professionalId).includes(time);if(exists){toastSafe('Horário já existe','Escolha um horário fora da grade atual.');return}
    const outside=!fitsInClinicPeriod(time,professionalId);
    if(outside&&!confirm(`Este horário (${time}) fica fora dos períodos de funcionamento da clínica ou não comporta o atendimento completo de ${professionalStep(professionalId)} minutos. Deseja criar o encaixe mesmo assim?`))return;
    state.store.extraSlots.push({id:uuid('slot'),date,time,professionalId,outsideHours:outside,createdAt:new Date().toISOString()});saveStore();state.date=date;state.professionalId=professionalId||state.professionalId;try{closeModal({force:true})}catch(_){ }render();toastSafe('Horário encaixado',outside?'Encaixe criado fora do expediente e sinalizado na agenda.':'Novo horário adicionado à grade da Agenda.');
  }

  function patientPhone(c){return String(c?.phone||c?.whatsapp||c?.celular||c?.telefone||c?.mobile||'').trim()}
  function patientSearchKey(value){
    return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  }
  function patientContacts(){
    return getContacts().filter(c=>String(c?.name||'').trim()).slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
  }
  function patientPickerMarkup(selectedName='',selectedId='',{disabled=false}={}){
    const currentName=String(selectedName||'').trim(),currentId=String(selectedId||'').trim();
    const options=patientContacts().map(c=>{
      const name=String(c.name||'').trim(),phone=patientPhone(c);
      const search=patientSearchKey(`${name} ${phone}`);
      return `<button type="button" class="agendaPatientOption" data-patient-option data-contact-id="${esc(c.id||'')}" data-patient-name="${esc(name)}" data-patient-phone="${esc(phone)}" data-patient-search="${esc(search)}"><span>${esc(name)}</span>${phone?`<small>${esc(phone)}</small>`:''}</button>`;
    }).join('');
    return `<div class="agendaPatientPicker ${disabled?'is-disabled':''}" data-patient-picker>
      <input type="hidden" id="agendaFormContactId" value="${esc(currentId)}">
      <div class="agendaPatientSearchBox"><span aria-hidden="true">⌕</span><input id="agendaFormPatient" type="search" class="agendaPatientSearch" data-patient-search-input value="${esc(currentName)}" placeholder="Digite o nome do paciente..." autocomplete="off" ${disabled?'readonly':''}><button type="button" class="agendaPatientToggle" data-patient-toggle aria-label="Abrir lista de pacientes" ${disabled?'disabled':''}>⌄</button></div>
      <div class="agendaPatientResults" data-patient-results hidden><div class="agendaPatientResultMeta" data-patient-result-meta></div><div class="agendaPatientOptionList">${options}</div><div class="agendaPatientEmpty" data-patient-empty hidden>Nenhum paciente encontrado.</div></div>
    </div>`;
  }
  function refreshPatientPicker(picker,query=''){
    if(!picker)return;const q=patientSearchKey(query);let visible=0;
    $$('[data-patient-option]',picker).forEach(btn=>{const hit=!q||String(btn.dataset.patientSearch||'').includes(q);btn.hidden=!hit;if(hit)visible++});
    const meta=picker.querySelector('[data-patient-result-meta]');if(meta)meta.textContent=q?`${visible} paciente${visible===1?'':'s'} encontrado${visible===1?'':'s'}`:`${visible} pacientes`;
    const empty=picker.querySelector('[data-patient-empty]');if(empty)empty.hidden=visible!==0;
  }
  function openPatientPicker(picker){if(!picker||picker.classList.contains('is-disabled'))return;const box=picker.querySelector('[data-patient-results]');if(box)box.hidden=false;picker.classList.add('is-open');const search=picker.querySelector('[data-patient-search-input]');refreshPatientPicker(picker,search?.value||'')}
  function closePatientPicker(picker){if(!picker)return;const box=picker.querySelector('[data-patient-results]');if(box)box.hidden=true;picker.classList.remove('is-open')}
  function applyPatientSelection(contact,picker){
    if(!contact||!picker)return;const name=String(contact.name||'').trim(),phone=patientPhone(contact);
    const search=picker.querySelector('[data-patient-search-input]'),hidden=picker.querySelector('#agendaFormContactId');
    if(search)search.value=name;if(hidden)hidden.value=String(contact.id||'');
    const phoneInput=$('agendaFormPhone');if(phoneInput)phoneInput.value=phone;
    const insurance=String(contact?.convenio||contact?.convênio||contact?.insurance||'').trim();
    const insuranceInput=$('agendaFormInsurance');if(insuranceInput&&insurance&&!insuranceInput.dataset.userEdited)insuranceInput.value=insurance;
    closePatientPicker(picker);
  }
  function choosePatient(btn){
    const picker=btn?.closest?.('[data-patient-picker]');if(!picker)return;const id=String(btn.dataset.contactId||'');
    const contact=getContacts().find(c=>String(c.id||'')===id)||{id,name:btn.dataset.patientName||'',phone:btn.dataset.patientPhone||''};
    applyPatientSelection(contact,picker);
  }
  function syncPatientFromTypedName(picker){
    if(!picker)return null;const search=picker.querySelector('[data-patient-search-input]');const typed=patientSearchKey(search?.value||'');if(!typed)return null;
    const exact=patientContacts().find(c=>patientSearchKey(c.name)===typed);if(exact)applyPatientSelection(exact,picker);return exact||null;
  }
  function procedureCatalogNames(){
    const set=new Set();
    try{(db()?.settings?.procedureCatalog||[]).forEach(p=>{if(p?.ativo===false||p?.deletedAt)return;const n=String(p?.nome||p?.name||p?.label||'').trim();if(n)set.add(n)})}catch(_){ }
    // O catálogo mestre é a fonte principal. Histórico só entra como fallback se a clínica ainda não cadastrou procedimentos.
    if(!set.size)getEntries().forEach(e=>{const t=String(e.treatmentOther||e.treatment||'').trim();if(t)set.add(t)});
    return Array.from(set).filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR')).slice(0,500);
  }
  function procedureSearchKey(value){
    return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  }
  function procedurePickerMarkup(inputId,selected,{disabled=false}={}){
    const current=String(selected||'').trim(),names=procedureCatalogNames();if(current&&!names.includes(current))names.unshift(current);
    const options=names.map(x=>`<button type="button" class="agendaProcedureOption" data-procedure-option data-procedure-value="${esc(x)}" data-procedure-search="${esc(procedureSearchKey(x))}">${esc(x)}</button>`).join('');
    return `<div class="agendaProcedurePicker ${disabled?'is-disabled':''}" data-procedure-picker>
      <input type="hidden" id="${esc(inputId)}" value="${esc(current)}">
      <div class="agendaProcedureSearchBox"><span aria-hidden="true">⌕</span><input type="search" class="agendaProcedureSearch" data-procedure-search-input value="${esc(current)}" placeholder="Pesquisar procedimento..." autocomplete="off" ${disabled?'disabled':''}><button type="button" class="agendaProcedureToggle" data-procedure-toggle aria-label="Abrir lista de procedimentos" ${disabled?'disabled':''}>⌄</button></div>
      <div class="agendaProcedureResults" data-procedure-results hidden><div class="agendaProcedureResultMeta" data-procedure-result-meta></div><div class="agendaProcedureOptionList">${options}</div><div class="agendaProcedureEmpty" data-procedure-empty hidden>Nenhum procedimento encontrado.</div></div>
    </div>`;
  }
  function refreshProcedurePicker(picker,query=''){
    if(!picker)return;const q=procedureSearchKey(query);let visible=0;
    $$('[data-procedure-option]',picker).forEach(btn=>{const hit=!q||String(btn.dataset.procedureSearch||'').includes(q);btn.hidden=!hit;if(hit)visible++});
    const meta=picker.querySelector('[data-procedure-result-meta]');if(meta)meta.textContent=q?`${visible} resultado${visible===1?'':'s'}`:`${visible} procedimentos`;
    const empty=picker.querySelector('[data-procedure-empty]');if(empty)empty.hidden=visible!==0;
  }
  function openProcedurePicker(picker){if(!picker||picker.classList.contains('is-disabled'))return;const box=picker.querySelector('[data-procedure-results]');if(box)box.hidden=false;picker.classList.add('is-open');const search=picker.querySelector('[data-procedure-search-input]');refreshProcedurePicker(picker,search?.value||'')}
  function closeProcedurePicker(picker){if(!picker)return;const box=picker.querySelector('[data-procedure-results]');if(box)box.hidden=true;picker.classList.remove('is-open')}
  function chooseProcedure(btn){const picker=btn?.closest?.('[data-procedure-picker]');if(!picker)return;const value=String(btn.dataset.procedureValue||'');const hidden=picker.querySelector('input[type=hidden]');const search=picker.querySelector('[data-procedure-search-input]');if(hidden)hidden.value=value;if(search)search.value=value;closeProcedurePicker(picker)}
  function procedurePickerValue(inputId){
    const hidden=$(inputId);if(!hidden)return '';const picker=hidden.closest('[data-procedure-picker]');const typed=String(picker?.querySelector('[data-procedure-search-input]')?.value||'').trim();const chosen=String(hidden.value||'').trim();if(chosen&&procedureSearchKey(chosen)===procedureSearchKey(typed))return chosen;const exact=procedureCatalogNames().find(x=>procedureSearchKey(x)===procedureSearchKey(typed));return exact||'';
  }
  function insuranceValues(){
    const set=new Set(['Particular']);
    getEntries().forEach(e=>{const v=String(e?.convenio||e?.convênio||e?.insurance||'').trim();if(v)set.add(v)});
    getContacts().forEach(c=>{const v=String(c?.convenio||c?.convênio||c?.insurance||'').trim();if(v)set.add(v)});
    (state.store?.appointments||[]).forEach(a=>{const v=String(a?.insurance||'').trim();if(v)set.add(v)});
    Object.values(state.store?.overrides||{}).forEach(o=>{const v=String(o?.insurance||'').trim();if(v)set.add(v)});
    return Array.from(set).filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR'));
  }
  function insuranceListOptions(){return insuranceValues().map(x=>`<option value="${esc(x)}"></option>`).join('')}
  function professionalOptions(selected){
    const pros=getProfessionals();return `<option value="">Não definido</option>`+pros.map(p=>`<option value="${esc(p.id)}" ${String(p.id)===String(selected)?'selected':''}>${esc(p.name)}</option>`).join('');
  }
  function openAppointmentForm(seed={}){
    const existing=seed.id?appointmentById(seed.id):null;const isExistingReal=existing?.source==='cronos';const intent=String(seed.intent||'');
    state.editing=existing?{id:existing.id,source:existing.source,entryId:existing.entryId,intent}:null;
    const date=seed.date||existing?.date||state.date;const time=normalizeTime(seed.time||existing?.time||'09:00');const professionalId=String(seed.professionalId!==undefined?seed.professionalId:(existing?.professionalId||state.professionalId));
    const body=`<div class="agendaModalGrid"><div><label>Data</label><input id="agendaFormDate" type="date" value="${esc(date)}"></div><div><label>Horário</label><input id="agendaFormTime" type="time" value="${esc(time)}"></div><div class="full"><label>Profissional</label><select id="agendaFormProfessional">${professionalOptions(professionalId)}</select></div>
      <div class="full"><label>Paciente</label>${patientPickerMarkup(existing?.patient||seed.patient||'',existing?.contactId||seed.contactId||'',{disabled:isExistingReal})}</div>
      <div class="full"><label>Procedimento</label>${procedurePickerMarkup('agendaFormProcedure',existing?.procedure||seed.procedure||'',{disabled:isExistingReal})}</div>
      <div><label>Convênio</label><input id="agendaFormInsurance" list="agendaInsuranceList" value="${esc(existing?.insurance||seed.insurance||'Particular')}" ${isExistingReal?'readonly':''}><datalist id="agendaInsuranceList">${insuranceListOptions()}</datalist></div><div><label>Telefone</label><input id="agendaFormPhone" value="${esc(existing?.phone||seed.phone||'')}" ${isExistingReal?'readonly':''}></div>
      <div class="full"><label>Observação</label><textarea id="agendaFormNote" rows="3" placeholder="Observação da consulta">${esc(existing?.note||'')}</textarea></div></div>`;
    const foot=`<button class="btn" type="button" onclick="closeModal()">Cancelar</button>${existing?.source==='agenda'?`<button class="btn danger" type="button" onclick="CRONOS_AGENDA.removeAppointment('${esc(existing.id)}')">Excluir consulta</button>`:''}<button class="btn primary" type="button" onclick="CRONOS_AGENDA.saveAppointment()">${existing?'Salvar alteração':'Agendar'}</button>`;
    const title=existing?(intent==='reschedule'?'Remarcar consulta':(isExistingReal?'Editar horário':'Editar consulta')):'Agendar consulta';
    if(typeof openModal==='function')openModal({title,sub:'Agenda Cronos',bodyHTML:body,footHTML:foot,maxWidth:'min(94vw,760px)',width:'min(94vw,760px)',modalClass:'cronosAgendaModal'});
  }
  function recordRescheduleHistory(a,toDate,toTime,toProfessionalId){
    if(!a||isHistorical(a))return null;
    const nextDate=String(toDate||a.date||''),nextTime=normalizeTime(toTime||a.time||''),nextProfessionalId=String(toProfessionalId||a.professionalId||'');
    const changed=String(a.date||'')!==nextDate||normalizeTime(a.time||'')!==nextTime||String(a.professionalId||'')!==nextProfessionalId;
    if(!changed)return null;
    if(!state.store)loadStore();if(!Array.isArray(state.store.history))state.store.history=[];
    const now=new Date().toISOString();
    const item={id:uuid('hist'),historyType:'reschedule',linkedAppointmentId:String(a.id||''),entryId:String(a.entryId||''),contactId:String(a.contactId||''),date:String(a.date||''),time:normalizeTime(a.time||''),professionalId:String(a.professionalId||''),patient:String(a.patient||'Paciente'),phone:String(a.phone||''),procedure:String(a.procedure||'Consulta'),insurance:String(a.insurance||'Particular'),note:String(a.note||''),agendaStatus:'Remarcado',confirmed:false,createdAt:now,createdBy:actorLabel(),updatedAt:'',updatedBy:'',reschedule:{fromDate:String(a.date||''),fromTime:normalizeTime(a.time||''),fromProfessionalId:String(a.professionalId||''),toDate:nextDate,toTime:nextTime,toProfessionalId:nextProfessionalId,rescheduledAt:now,rescheduledBy:actorLabel()}};
    state.store.history.push(item);return item;
  }
  function saveAppointment(){
    const date=$('agendaFormDate')?.value||'';const time=normalizeTime($('agendaFormTime')?.value||'');const professionalId=String($('agendaFormProfessional')?.value||'');const patientPicker=$('agendaFormPatient')?.closest?.('[data-patient-picker]');syncPatientFromTypedName(patientPicker);const patient=String($('agendaFormPatient')?.value||'').trim();const contactId=String($('agendaFormContactId')?.value||'').trim();const procedure=procedurePickerValue('agendaFormProcedure')||'Consulta';const insurance=String($('agendaFormInsurance')?.value||'Particular').trim()||'Particular';const phone=String($('agendaFormPhone')?.value||'').trim();const note=String($('agendaFormNote')?.value||'').trim();
    if(!date||!time)return toastSafe('Data e horário','Informe a data e o horário.');if(!patient&&!state.editing)return toastSafe('Paciente obrigatório','Informe o paciente da consulta.');
    const hasExplicitExtra=(state.store?.extraSlots||[]).some(x=>x.date===date&&String(x.professionalId||'')===professionalId&&normalizeTime(x.time)===time);
    if(!fitsInClinicPeriod(time,professionalId)&&!hasExplicitExtra&&!confirm(`O horário ${time} está fora do expediente configurado ou ultrapassa o fim de um período para este profissional (${professionalStep(professionalId)} min). Deseja manter mesmo assim?`))return;
    if(!state.store)loadStore();
    const beforeEdit=state.editing?.id?appointmentById(state.editing.id):null;
    if(state.editing?.intent==='reschedule'&&beforeEdit)recordRescheduleHistory(beforeEdit,date,time,professionalId);
    if(state.editing?.source==='cronos'){
      const key=String(state.editing.entryId||'');const current=state.store.overrides[key]||{};const patch={...current,date,time,professionalId};
      if(state.editing.intent==='reschedule'){patch.agendaStatus='Agendado';patch.confirmed=false;}
      markAudit(patch,appointmentById(state.editing.id)?.audit||{});state.store.overrides[key]=patch;
    }else if(state.editing?.source==='agenda'){
      const item=state.store.appointments.find(a=>String(a.id)===String(state.editing.id));
      if(item){Object.assign(item,{date,time,professionalId,patient,procedure,insurance,phone,note,agendaStatus:state.editing.intent==='reschedule'?'Agendado':normalizeAgendaStatus(item.agendaStatus||'Agendado'),confirmed:state.editing.intent==='reschedule'?false:!!item.confirmed,updatedAt:new Date().toISOString(),updatedBy:actorLabel()});}
    }else{
      const matched=getContacts().find(c=>String(c.id||'')===contactId)||getContacts().find(c=>patientSearchKey(c.name)===patientSearchKey(patient));const now=new Date().toISOString();
      state.store.appointments.push({id:uuid('appt'),date,time,professionalId,patient,insurance,phone:phone||patientPhone(matched),contactId:String(matched?.id||contactId||''),procedure,agendaStatus:'Agendado',confirmed:false,note,createdAt:now,createdBy:actorLabel(),updatedAt:'',updatedBy:''});
    }
    saveStore();state.date=date;state.professionalId=professionalId||state.professionalId;state.editing=null;try{closeModal({force:true})}catch(_){ }render();toastSafe('Agenda atualizada','Alteração enviada para a Agenda da clínica.');
  }
  function removeAppointment(id){
    if(!state.store)loadStore();state.store.appointments=state.store.appointments.filter(a=>String(a.id)!==String(id));saveStore();state.editing=null;try{closeModal({force:true})}catch(_){ }render();toastSafe('Consulta removida','A consulta foi removida da Agenda.');
  }
  function mutateAppointment(id,patch={}){
    const a=appointmentById(id);if(!a)return false;if(!state.store)loadStore();
    if(a.source==='agenda'){
      const item=state.store.appointments.find(x=>String(x.id)===String(a.id));if(!item)return false;
      Object.assign(item,patch,{updatedAt:new Date().toISOString(),updatedBy:actorLabel()});
    }else{
      const key=String(a.entryId||'');const current=state.store.overrides[key]||{};const next={...current,...patch};markAudit(next,a.audit||{});state.store.overrides[key]=next;
    }
    saveStore();render();return true;
  }
  function openCancellation(id){
    closeFloatingMenu();const a=appointmentById(id);if(!a)return;
    if(isCancelled(a))return toastSafe('Já desmarcado','Esse agendamento já faz parte do histórico de desmarcações.');
    const prof=professionalById(a.professionalId);
    const body=`<div class="agendaCancellationContext"><strong>${esc(a.patient)}</strong><span>${esc(fmtDate(a.date))} • ${esc(a.time)}${prof?.name?` • ${esc(prof.name)}`:''}</span><small>${esc(a.procedure||'Consulta')}</small></div>
      <div class="agendaCancellationQuestion">Quem solicitou a desmarcação?</div>
      <div class="agendaCancellationChoices">
        <label class="agendaCancellationChoice"><input type="radio" name="agendaCancellationRequester" value="patient" checked><span><b>Paciente</b><small>O paciente pediu para desmarcar.</small></span></label>
        <label class="agendaCancellationChoice"><input type="radio" name="agendaCancellationRequester" value="clinic"><span><b>Clínica</b><small>A clínica decidiu desmarcar o atendimento.</small></span></label>
      </div>
      <label class="agendaCancellationNote"><span>Observação <small>(opcional)</small></span><textarea id="agendaCancellationNote" rows="3" placeholder="Ex.: paciente informou que não poderá comparecer"></textarea></label>
      <div class="agendaModalHint">O horário será liberado para novo agendamento. O registro antigo continuará disponível em <b>Exibir histórico</b>.</div>`;
    if(typeof openModal==='function')openModal({title:'Desmarcar consulta',sub:'Registrar histórico da desmarcação',bodyHTML:body,footHTML:`<button class="btn" type="button" onclick="closeModal()">Voltar</button><button class="btn danger" type="button" onclick="CRONOS_AGENDA.saveCancellation('${esc(id)}')">Desmarcar consulta</button>`,maxWidth:'min(94vw,650px)',width:'min(94vw,650px)',modalClass:'cronosAgendaModal'});
  }
  function saveCancellation(id){
    const a=appointmentById(id);if(!a)return;
    if(isCancelled(a))return toastSafe('Já desmarcado','Esse agendamento já faz parte do histórico de desmarcações.');
    const requestedBy=String(document.querySelector('input[name="agendaCancellationRequester"]:checked')?.value||'').trim();
    if(!['patient','clinic'].includes(requestedBy))return toastSafe('Informe quem solicitou','Selecione Paciente ou Clínica.');
    const note=String($('agendaCancellationNote')?.value||'').trim(),now=new Date().toISOString();
    const cancellation={requestedBy,requestedByLabel:requestedBy==='patient'?'Paciente':'Clínica',note,cancelledAt:now,cancelledBy:actorLabel()};
    if(!mutateAppointment(id,{agendaStatus:'Desmarcado',confirmed:false,cancellation}))return;
    try{closeModal({force:true})}catch(_){ }
    toastSafe('Consulta desmarcada',`Solicitação registrada como ${requestedBy==='patient'?'do paciente':'da clínica'}. O horário foi liberado.`);
  }
  function applyAppointmentAction(id,action){
    closeFloatingMenu();const a=appointmentById(id);if(!a)return;
    if(action==='reminder'){openReminder(id);return}
    if(action==='reschedule'){openAppointmentForm({id,intent:'reschedule'});return}
    if(action==='unbook'){
      if(appointmentStatus(a)==='Desmarcado')return toastSafe('Já desmarcado','Esse agendamento já faz parte do histórico de desmarcações.');
      openCancellation(id);return;
    }
    if(action==='confirm'){
      if(appointmentConfirmed(a))return toastSafe('Já confirmado','A presença deste paciente já está confirmada.');
      if(mutateAppointment(id,{confirmed:true}))toastSafe('Presença confirmada','O selo ✓ foi adicionado ao paciente.');return;
    }
    const map={reception:'Recepção',realized:'Realizado',missed:'Falta'};const next=map[action];if(!next)return;
    if(mutateAppointment(id,{agendaStatus:next}))toastSafe('Agenda atualizada',`${a.patient}: ${next}.`);
  }
  function openReminder(id){
    const a=appointmentById(id);if(!a)return;const existing=reminderForAppointment(id);const prof=professionalById(a.professionalId);
    const body=`<div class="agendaReminderContext"><strong>${esc(prof?.name||'Profissional')} • ${esc(a.time)}</strong><span>${esc(a.patient)} • ${esc(fmtDate(a.date,{short:true}))}</span></div><div><label style="display:block;margin-bottom:6px">Lembrete</label><textarea id="agendaReminderNote" rows="6" placeholder="Escreva o lembrete desta consulta">${esc(existing?.note||'')}</textarea></div>`;
    const deleteBtn=existing?`<button class="btn danger" type="button" onclick="CRONOS_AGENDA.deleteReminder('${esc(id)}')">Excluir lembrete</button>`:'';
    if(typeof openModal==='function')openModal({title:existing?'Editar lembrete':'Criar um lembrete',sub:'Vinculado a esta consulta',bodyHTML:body,footHTML:`<button class="btn" type="button" onclick="closeModal()">Cancelar</button>${deleteBtn}<button class="btn primary" type="button" onclick="CRONOS_AGENDA.saveReminder('${esc(id)}')">Salvar</button>`,maxWidth:'min(94vw,650px)',width:'min(94vw,650px)'});
  }
  function saveReminder(id){
    const a=appointmentById(id);if(!a)return;const note=String($('agendaReminderNote')?.value||'').trim();if(!note)return toastSafe('Lembrete vazio','Escreva o lembrete antes de salvar.');if(!state.store)loadStore();
    const existing=reminderForAppointment(id),now=new Date().toISOString();
    if(existing){const target=state.store.reminders.find(r=>String(r.id)===String(existing.id));if(target)Object.assign(target,{note,updatedAt:now,updatedBy:actorLabel()});}
    else state.store.reminders.push({id:uuid('reminder'),appointmentId:id,note,createdAt:now,createdBy:actorLabel(),updatedAt:'',updatedBy:''});
    saveStore();try{closeModal({force:true})}catch(_){ }render();toastSafe('Lembrete salvo','O envelope agora aparece ao lado do procedimento.');
  }
  function deleteReminder(id){
    if(!state.store)loadStore();const existing=reminderForAppointment(id);if(!existing)return;if(!confirm('Excluir este lembrete?'))return;state.store.reminders=state.store.reminders.filter(r=>String(r.id)!==String(existing.id));saveStore();try{closeModal({force:true})}catch(_){ }render();toastSafe('Lembrete removido','');
  }

  function contactForAppointment(a){
    if(!a)return null;
    const contacts=getContacts();
    if(a.contactId){
      const hit=contacts.find(c=>String(c.id||'')===String(a.contactId));
      if(hit)return hit;
    }
    const key=patientSearchKey(a.patient||'');
    return contacts.find(c=>patientSearchKey(c.name||'')===key)||null;
  }
  function ageFromBirth(iso){
    const raw=String(iso||'').trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '';
    const d=parseDate(raw),today=new Date();let age=today.getFullYear()-d.getFullYear();
    const m=today.getMonth()-d.getMonth();if(m<0||(m===0&&today.getDate()<d.getDate()))age--;
    return age>=0&&age<130?String(age):'';
  }
  function anamnesisStorageKey(a){
    const cid=String(a?.contactId||'').trim();
    if(cid)return `contact:${cid}`;
    return `patient:${patientSearchKey(a?.patient||'sem-paciente')}`;
  }
  function anamnesisRecord(a){
    if(!state.store)loadStore();
    return state.store?.anamneses?.[anamnesisStorageKey(a)]||null;
  }
  function anamValue(rec,key,fallback=''){
    const v=rec?.fields?.[key];
    return v===undefined||v===null?fallback:String(v);
  }
  function anamChecked(rec,key,value){return anamValue(rec,key,'')===String(value)?'checked':''}
  function anamYesNo(rec,key,label,extra=''){
    const val=anamValue(rec,key,'');
    return `<div class="anamQuestion"><div class="anamQuestionText">${esc(label)}</div><div class="anamChoiceRow">
      <label><input type="radio" name="anam_${esc(key)}" data-anam-field="${esc(key)}" value="Sim" ${val==='Sim'?'checked':''}> Sim</label>
      <label><input type="radio" name="anam_${esc(key)}" data-anam-field="${esc(key)}" value="Não" ${val==='Não'?'checked':''}> Não</label>
    </div>${extra}</div>`;
  }
  function anamTextInput(rec,key,label,{placeholder='',type='text',readonly=false}={}){
    return `<label class="anamField"><span>${esc(label)}</span><input type="${esc(type)}" data-anam-field="${esc(key)}" value="${esc(anamValue(rec,key,''))}" placeholder="${esc(placeholder)}" ${readonly?'readonly':''}></label>`;
  }
  function anamTextarea(rec,key,label,{rows=3,placeholder=''}={}){
    return `<label class="anamField anamTextarea"><span>${esc(label)}</span><textarea data-anam-field="${esc(key)}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(anamValue(rec,key,''))}</textarea></label>`;
  }
  function anamMulti(rec,key,label,items){
    const selected=Array.isArray(rec?.fields?.[key])?rec.fields[key].map(String):[];
    return `<div class="anamQuestion anamMulti"><div class="anamQuestionText">${esc(label)}</div><div class="anamChoiceWrap">${items.map(x=>`<label><input type="checkbox" data-anam-multi="${esc(key)}" value="${esc(x)}" ${selected.includes(String(x))?'checked':''}> ${esc(x)}</label>`).join('')}</div></div>`;
  }
  function anamSingleOptions(rec,key,label,items){
    const val=anamValue(rec,key,'');
    return `<div class="anamQuestion"><div class="anamQuestionText">${esc(label)}</div><div class="anamChoiceWrap">${items.map(x=>`<label><input type="radio" name="anam_${esc(key)}" data-anam-field="${esc(key)}" value="${esc(x)}" ${val===String(x)?'checked':''}> ${esc(x)}</label>`).join('')}</div></div>`;
  }
  function anamnesisFormMarkup(a,rec){
    const c=contactForAppointment(a)||{};
    const prof=professionalById(a.professionalId);
    const patientName=String(c.name||a.patient||'');
    const birth=anamValue(rec,'birthDate',String(c.birthDate||''));
    const age=anamValue(rec,'age',ageFromBirth(birth));
    const dentist=anamValue(rec,'dentist',String(prof?.name||''));
    const patient=anamValue(rec,'patient',patientName);
    const declaration=`Declaro, para os devidos fins, que todas as informações fornecidas por mim na Anamnese e Inventário de Saúde são verdadeiras e refletem fielmente meu atual estado de saúde.

Estou informando previamente que: pacientes especiais, pacientes menores de 18 e maiores de 60 anos precisam de acompanhante em caso de realizar procedimentos invasivos/cirúrgicos.

Estou ciente de que a veracidade e completude dos dados são essenciais para garantir a segurança e a qualidade do tratamento odontológico, e que qualquer omissão ou informação incorreta poderá prejudicar minha própria saúde e dificultar a atuação da equipe profissional envolvida.

Reconheço ainda que a prestação de informações falsas ou incompletas poderá implicar em responsabilidade ética e/ou jurídica, conforme previsto em lei.`;
    return `<form id="agendaAnamnesisForm" class="agendaAnamnesisForm" autocomplete="off">
      <div class="anamHero"><div><small>FICHA DE ANAMNESE</small><strong>${esc(patientName)}</strong></div><span>Modelo Mundo Odonto • preenchimento digital</span></div>

      <section class="anamSection">
        <h4>DADOS PESSOAIS</h4>
        <div class="anamGrid">
          <label class="anamField full"><span>Nome do dentista</span><input type="text" data-anam-field="dentist" value="${esc(dentist)}"></label>
          <label class="anamField full"><span>Paciente</span><input type="text" data-anam-field="patient" value="${esc(patient)}"></label>
          <div class="anamField"><span>Sexo</span><div class="anamInlineChoices">
            <label><input type="radio" name="anam_sex" data-anam-field="sex" value="F" ${anamChecked(rec,'sex','F')}> F</label>
            <label><input type="radio" name="anam_sex" data-anam-field="sex" value="M" ${anamChecked(rec,'sex','M')}> M</label>
          </div></div>
          <label class="anamField"><span>Data de Nascimento</span><input type="date" data-anam-field="birthDate" value="${esc(birth)}"></label>
          <label class="anamField"><span>Idade</span><input type="number" min="0" max="130" data-anam-field="age" value="${esc(age)}"></label>
        </div>
      </section>

      <section class="anamSection">
        <h4>QUEIXA PRINCIPAL</h4>
        ${anamTextarea(rec,'chiefComplaint','Queixa principal',{rows:5,placeholder:'Descreva a principal queixa do paciente.'})}
      </section>

      <section class="anamSection">
        <h4>HISTÓRICO DE CLÍNICA BUCAL</h4>
        ${anamSingleOptions(rec,'dentistFrequency','Com que frequência você vai ao dentista?',['Semestral','Anual','Raramente','Nunca'])}
        ${anamYesNo(rec,'gingivalBleeding','Apresenta sangramento gengival?')}
        ${anamYesNo(rec,'rootCanal','Já fez tratamento de Canal?')}
        ${anamYesNo(rec,'toothPain','Apresenta dor em algum dente?')}
        ${anamYesNo(rec,'prosthesis','Usa alguma prótese atualmente?',anamTextInput(rec,'prosthesisTime','Se sim, há quanto tempo?'))}
        ${anamYesNo(rec,'orthodontic','Usa ou já usou aparelho ortodôntico?',anamTextInput(rec,'orthodonticTime','Se sim, por quanto tempo?'))}
        ${anamYesNo(rec,'sensitivity','Sente sensibilidade dental?')}
        ${anamYesNo(rec,'extractions','Já fez extrações?',anamTextarea(rec,'extractionExperience','Como foi sua experiência?',{rows:2}))}
      </section>

      <section class="anamSection">
        <h4>HISTÓRICO DE CLÍNICA MÉDICA</h4>
        ${anamYesNo(rec,'medicalTreatment','Está atualmente sob algum tipo de tratamento médico?',anamTextInput(rec,'medicalTreatmentWhich','Se sim, qual?'))}
        ${anamYesNo(rec,'systemicDisease','Tem alguma doença sistêmica?',anamTextInput(rec,'systemicDiseaseWhich','Se sim, qual?'))}
        ${anamYesNo(rec,'medication','Está tomando algum medicamento?',anamTextInput(rec,'medicationWhich','Se sim, qual medicamento?'))}
        ${anamYesNo(rec,'seriousDisease','Já sofreu alguma doença grave?',anamTextInput(rec,'seriousDiseaseWhich','Se sim, qual?'))}
        ${anamYesNo(rec,'surgery','Já fez alguma cirurgia?',anamTextInput(rec,'surgeryWhich','Se sim, qual?'))}
        ${anamYesNo(rec,'slowHealing','Quando se fere, as feridas demoram a cicatrizar?')}
        ${anamYesNo(rec,'allergy','Possui alergia a algum medicamento ou alimento?',anamTextInput(rec,'allergyWhich','Quais?'))}
        ${anamYesNo(rec,'heartProblem','Tem algum problema no coração? (marca-passo, válvula etc)',anamTextInput(rec,'heartProblemTime','Se fez, há quanto tempo?'))}
        ${anamYesNo(rec,'stomachProblem','Tem problema estomacal?')}
        ${anamYesNo(rec,'pregnancy','Probabilidade de gravidez?')}
        ${anamYesNo(rec,'breastfeeding','Está amamentando?')}
        ${anamYesNo(rec,'radioChemo','Já fez radioterapia ou quimioterapia?')}
        ${anamYesNo(rec,'transplant','Já fez transplante?')}
        ${anamYesNo(rec,'psychologicalTreatment','Está fazendo algum tratamento psicológico?',anamTextInput(rec,'psychologicalTreatmentWhich','Se sim, qual?'))}
        ${anamTextarea(rec,'otherDisease','Existe alguma doença que não perguntei e você queira me relatar?',{rows:3})}
      </section>

      <section class="anamSection">
        <h4>HÁBITOS</h4>
        ${anamYesNo(rec,'oralHabits','Costuma roer unhas, apertar os dentes, chupar os dedos, morder objetos etc?',anamTextInput(rec,'oralHabitsWhich','Se sim, qual?'))}
        ${anamYesNo(rec,'alcohol','Ingere bebidas alcoólicas?')}
        ${anamYesNo(rec,'smoking','Fuma ou já fumou?')}
        ${anamYesNo(rec,'illicitDrugs','Faz uso de drogas ilícitas?')}
        ${anamSingleOptions(rec,'brushingFrequency','Frequência de escovação diária:',['1x','2x','3x','4x ou mais vezes ao dia'])}
        ${anamMulti(rec,'oralHygiene','O que utiliza para realizar sua higiene bucal?',['Escova','Palito','Creme dental','Fio dental','Enxaguante','Raspador de língua'])}
      </section>

      <section class="anamSection">
        <h4>VISÃO DO ESPECIALISTA</h4>
        ${anamTextarea(rec,'specialistView','Espaço para visão técnica e diagnóstico detalhado do caso.',{rows:7})}
      </section>

      <section class="anamSection anamDeclaration">
        <h4>DECLARAÇÃO DE VERACIDADE</h4>
        <div class="anamDeclarationText">${esc(declaration).replace(/\n\n/g,'</p><p>').replace(/^/,'<p>').replace(/$/,'</p>')}</div>
        <div class="anamSignaturePreview"><span>Assinatura do(a) Paciente/Responsável</span><span>Assinatura e Carimbo do(a) Cirurgião-Dentista responsável</span></div>
      </section>

      <div class="anamSaveMeta">${rec?.updatedAt?`Última atualização: ${esc(fmtDateTime(rec.updatedAt))} • ${esc(rec.updatedBy||'Usuário')}`:'Ainda não salva.'}</div>
    </form>`;
  }
  function collectAnamnesisFields(){
    const form=$('agendaAnamnesisForm');if(!form)return null;
    const out={};
    $$('[data-anam-field]',form).forEach(el=>{
      const key=String(el.dataset.anamField||'');if(!key)return;
      if(el.type==='radio'){if(el.checked)out[key]=el.value;return;}
      out[key]=String(el.value||'').trim();
    });
    const multiKeys=new Set($$('[data-anam-multi]',form).map(el=>String(el.dataset.anamMulti||'')).filter(Boolean));
    multiKeys.forEach(key=>{out[key]=$$(`[data-anam-multi="${CSS.escape(key)}"]:checked`,form).map(el=>el.value)});
    if(out.birthDate&&!out.age)out.age=ageFromBirth(out.birthDate);
    return out;
  }
  function agendaOpenModalSafe(options){
    try{
      const classes=String(options?.modalClass||'').split(/\s+/).filter(Boolean);
      // O openModal principal do Cronos aceita somente UM token em modalClass
      // (internamente usa classList.add(modalClass)). Passamos a primeira classe
      // e aplicamos as demais logo após a montagem do modal.
      const safeOptions={...(options||{}),modalClass:classes[0]||''};
      if(typeof openModal==='function'){
        openModal(safeOptions);
        const root=document.querySelector('#modalBg > .modal');
        if(root)classes.slice(1).forEach(c=>root.classList.add(c));
        return true;
      }
      if(typeof window.openModal==='function'){
        window.openModal(safeOptions);
        const root=document.querySelector('#modalBg > .modal');
        if(root)classes.slice(1).forEach(c=>root.classList.add(c));
        return true;
      }
      const bg=$('modalBg'),title=$('modalTitle'),sub=$('modalSub'),body=$('modalBody'),foot=$('modalFoot');
      if(!bg||!body)throw new Error('Modal principal do Cronos não encontrado.');
      if(title)title.textContent=String(options?.title||'');
      if(sub)sub.textContent=String(options?.sub||'');
      body.innerHTML=String(options?.bodyHTML||'');
      if(foot)foot.innerHTML=String(options?.footHTML||'');
      const root=document.querySelector('#modalBg > .modal');
      if(root){root.className='modal';classes.forEach(c=>root.classList.add(c));root.style.maxWidth=options?.maxWidth||'';root.style.width=options?.width||'';}
      bg.classList.add('show');bg.setAttribute('aria-hidden','false');
      return true;
    }catch(error){console.error('Agenda: falha ao abrir modal',error);return false;}
  }
  function openAnamnesis(id){
    try{
      const a=appointmentById(id);
      if(!a){toastSafe('Anamnese indisponível','Não consegui localizar esta consulta na Agenda.');return false;}
      const rec=anamnesisRecord(a)||{};
      const body=anamnesisFormMarkup(a,rec);
      const foot=`<button class="btn" type="button" onclick="closeModal()">Fechar</button><button class="btn" type="button" onclick="CRONOS_AGENDA.printAnamnesis('${esc(id)}')">Imprimir</button><button class="btn primary" type="button" onclick="CRONOS_AGENDA.saveAnamnesis('${esc(id)}')">Salvar anamnese</button>`;
      const opened=agendaOpenModalSafe({title:'Anamnese',sub:'Agenda → paciente • modelo estruturado da Mundo Odonto',bodyHTML:body,footHTML:foot,maxWidth:'min(96vw,980px)',width:'min(96vw,980px)',modalClass:'cronosAgendaModal agendaAnamnesisModal'});
      if(!opened)toastSafe('Falha ao abrir Anamnese','Abra o console para ver o erro técnico.');
      return opened;
    }catch(error){
      console.error('Agenda: falha ao montar Anamnese',error);
      toastSafe('Falha ao abrir Anamnese',String(error?.message||error||'Erro inesperado.'));
      return false;
    }
  }
  function saveAnamnesis(id,{silent=false,keepOpen=false}={}){
    const a=appointmentById(id);if(!a)return false;const fields=collectAnamnesisFields();if(!fields)return false;if(!state.store)loadStore();
    const key=anamnesisStorageKey(a),previous=state.store.anamneses[key]||{},now=new Date().toISOString();
    state.store.anamneses[key]={id:previous.id||uuid('anamnesis'),key,contactId:String(a.contactId||''),patient:String(a.patient||''),fields,createdAt:previous.createdAt||now,createdBy:previous.createdBy||actorLabel(),updatedAt:now,updatedBy:actorLabel()};
    const ok=saveStore();
    if(ok&&!silent)toastSafe('Anamnese salva','Os dados foram salvos na clínica.');
    if(ok&&!keepOpen){try{closeModal({force:true})}catch(_){}}
    return ok;
  }
  function anamnesePrintValue(fields,key){const v=fields?.[key];if(Array.isArray(v))return v.join(', ');return String(v||'')}
  function anamnesisHasClinicalData(fields){
    const identity=new Set(['dentist','patient','sex','birthDate','age']);
    return Object.entries(fields||{}).some(([key,value])=>{
      if(identity.has(key))return false;
      if(Array.isArray(value))return value.some(v=>String(v||'').trim());
      return String(value??'').trim()!=='';
    });
  }
  function printAnamnesis(id){
    const a=appointmentById(id);if(!a)return;
    const live=collectAnamnesisFields();if(live){saveAnamnesis(id,{silent:true,keepOpen:true});}
    const rec=anamnesisRecord(a)||{},f=rec.fields||{},prof=professionalById(a.professionalId),c=contactForAppointment(a)||{};
    const data=db(),act=actor();
    let branding={};try{branding=typeof getClinicBranding==='function'?getClinicBranding(data,act):(data?.settings?.clinicBranding?.byClinic?.[String(act?.masterId||act?.clinicId||'')]||{})}catch(_){}
    const clinicName=String((typeof getClinicDisplayName==='function'?getClinicDisplayName(data,act):'')||branding?.clinicName||act?.masterName||'Clínica');
    const clinicPhone=String(branding?.clinicPhone||'');
    const manualMode=!anamnesisHasClinicalData(f);
    const val=(key)=>anamnesePrintValue(f,key).trim();
    const has=(key)=>val(key)!=='';
    const blankLine=()=>'<span class="writeLine">&nbsp;</span>';
    const text=(key)=>has(key)?esc(val(key)):blankLine();
    const yn=(key)=>{const v=val(key);return `<span class="choices">(${v==='Sim'?'X':' '}) Sim&nbsp;&nbsp;&nbsp;(${v==='Não'?'X':' '}) Não</span>`};
    const single=(key,items)=>{const v=val(key);return `<span class="choices">${items.map(item=>`(${v===item?'X':' '}) ${esc(item)}`).join('&nbsp;&nbsp;')}</span>`};
    const multi=(key,items)=>{const values=Array.isArray(f?.[key])?f[key].map(x=>String(x)):[];return `<span class="choices wrap">${items.map(item=>`(${values.includes(item)?'X':' '}) ${esc(item)}`).join('&nbsp;&nbsp;')}</span>`};
    const lineYN=(label,key)=>`<div class="q"><span>${esc(label)}</span><b>${yn(key)}</b></div>`;
    const lineYN2=(label,key,key2,label2)=>`${lineYN(label,key)}<div class="subq"><span>${esc(label2)}</span><b>${text(key2)}</b></div>`;
    const lineSingle=(label,key,items)=>`<div class="q stack"><span>${esc(label)}</span><b>${single(key,items)}</b></div>`;
    const lineMulti=(label,key,items)=>`<div class="q stack"><span>${esc(label)}</span><b>${multi(key,items)}</b></div>`;
    const box=(key,{tall=false}={})=>`<div class="textBox${tall?' tall':''}${has(key)?'':' empty'}">${has(key)?esc(val(key)):''}</div>`;
    const identity=(value)=>String(value||'').trim()?esc(String(value).trim()):blankLine();
    const formatBirthDate=(value)=>{
      const raw=String(value||'').trim();
      if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){const [y,m,d]=raw.split('-');return `${d}/${m}/${y}`;}
      return raw;
    };
    let cronosLogo='';
    let cronosWatermark='';
    try{cronosLogo=new URL('../assets/brand/logo-cronos-odonto.svg',window.location.href).href;}catch(_){cronosLogo='';}
    try{cronosWatermark=new URL('../assets/brand/cronos-symbol.png',window.location.href).href;}catch(_){cronosWatermark='';}
    const sexValue=val('sex');
    const sexPrint=`<span class="choices">(${sexValue==='F'?'X':' '}) F&nbsp;&nbsp;&nbsp;(${sexValue==='M'?'X':' '}) M</span>`;
    const decl=`Declaro, para os devidos fins, que todas as informações fornecidas por mim na Anamnese e Inventário de Saúde são verdadeiras e refletem fielmente meu atual estado de saúde.

Estou informando previamente que: pacientes especiais, pacientes menores de 18 e maiores de 60 anos precisam de acompanhante em caso de realizar procedimentos invasivos/cirúrgicos.

Estou ciente de que a veracidade e completude dos dados são essenciais para garantir a segurança e a qualidade do tratamento odontológico, e que qualquer omissão ou informação incorreta poderá prejudicar minha própria saúde e dificultar a atuação da equipe profissional envolvida.

Reconheço ainda que a prestação de informações falsas ou incompletas poderá implicar em responsabilidade ética e/ou jurídica, conforme previsto em lei.`;
    const w=window.open('','_blank','width=1050,height=820');if(!w)return toastSafe('Pop-up bloqueado','Permita pop-ups para imprimir a anamnese.');
    const watermarkHtml=cronosWatermark?`<img class="watermark" src="${esc(cronosWatermark)}" alt="" aria-hidden="true">`:'';
    const pageHeader=(rightLabel)=>`<div class="head"><div class="logo">${cronosLogo?`<img src="${esc(cronosLogo)}" alt="Cronos Odonto">`:`<span class="logoFallback">Cronos Odonto</span>`}</div><div class="title"><h1>FICHA DE ANAMNESE</h1><p>${esc(clinicName)}</p></div><div class="date">${esc(rightLabel)}</div></div>${clinicPhone?`<div class="clinicFoot">${esc(clinicPhone)}</div>`:''}${manualMode?'<div class="printMode">Ficha preparada para preenchimento manual</div>':'<div class="printMode">Ficha preenchida digitalmente</div>'}<div class="brandLine"></div>`;
    const html=`<!doctype html><html><head><meta charset="utf-8"><title>Anamnese - ${esc(a.patient)}</title><style>
      @page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:"Segoe UI",Arial,sans-serif;color:#17233d;margin:0;background:#fff;font-size:12px}.page{min-height:277mm;page-break-after:always;padding:0 1mm;position:relative;overflow:hidden}.page:last-child{page-break-after:auto}
      .brandLine{height:4px;border-radius:99px;background:linear-gradient(90deg,#1677ff 0%,#19c6ff 58%,#2ee6a6 100%);margin:0 0 7px}.head{display:grid;grid-template-columns:150px 1fr 105px;align-items:center;gap:12px;margin-bottom:4px}.logo{width:148px;height:58px;display:flex;align-items:center;justify-content:flex-start}.logo img{max-width:148px;max-height:56px;object-fit:contain;object-position:left center}.logoFallback{font-size:16px;font-weight:800;color:#1677ff}.title{text-align:center}.title h1{margin:0;color:#162b50;font-size:22px;font-weight:800;letter-spacing:.02em}.title p{margin:3px 0 0;font-size:13px;font-weight:700;color:#223756}.date{text-align:right;font-size:10px;font-weight:700;color:#20395f}.clinicFoot{text-align:center;color:#55657c;font-size:9px;margin:1px 0 6px}.printMode{margin:-1px 0 7px;text-align:right;color:#65748a;font-size:8px}.section{background:linear-gradient(90deg,#1677ff 0%,#19aee0 62%,#21d2c3 100%);color:#fff;text-align:left;font-weight:800;padding:5px 10px;margin:6px 0 4px;letter-spacing:.045em;border-radius:8px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.06)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:2px 12px}.grid.personalTop{grid-template-columns:1.02fr 1.98fr;gap:1px 12px;margin-bottom:1px}.grid.personalMeta{grid-template-columns:minmax(108px,.62fr) minmax(180px,1.1fr) minmax(82px,.38fr);gap:1px 12px;margin-bottom:2px}.field{border-bottom:1px solid #7f8ba0;padding:2px 2px;min-height:18px}.field small{display:block;font-size:12px;color:#5d6c82;text-transform:uppercase;font-weight:700;letter-spacing:.03em;line-height:1.05}.field b{font-size:12px;font-weight:700;display:block;min-height:12px;color:#14223d;line-height:1.18}.field.compact{padding:1px 2px 1px;min-height:14px}.field.compact b{min-height:0}
      .q{display:flex;justify-content:space-between;gap:10px;border-bottom:1px dotted #c3cad5;padding:2px 0;line-height:1.16;align-items:flex-end}.q.stack{display:block}.q.stack b{display:block;text-align:left;margin-top:1px;min-width:0}.q span{flex:1}.q b{min-width:180px;text-align:right;font-weight:600}.subq{display:flex;gap:8px;margin:-1px 0 2px;padding:1px 0 2px 18px;border-bottom:1px solid #d5dbe4;line-height:1.14}.subq span{color:#4c596d}.subq b{flex:1;min-width:140px}.choices{font-weight:600;white-space:nowrap}.choices.wrap{white-space:normal;line-height:1.4}.writeLine{display:inline-block;width:100%;min-width:120px;height:11px;border-bottom:1px solid #536076;vertical-align:bottom}.textBox{border:1px solid #c6ced9;border-radius:5px;min-height:36px;padding:5px 6px;white-space:pre-wrap;margin-bottom:4px;line-height:1.32}.textBox.tall{min-height:58px}.textBox.empty{border:0;border-radius:0;background:repeating-linear-gradient(to bottom,transparent 0,transparent 16px,#cfd5de 17px,#cfd5de 18px);padding-top:1px}.decl{font-size:12px;line-height:1.4;white-space:pre-line;color:#27354b}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:34px}.sig{border-top:1px solid #24344e;text-align:center;padding-top:5px;font-size:12px;color:#344159}.audit{margin-top:64px;padding-top:16px;border-top:1px solid #e1e7ef;text-align:center;color:#7a8799;font-size:8px}.watermark{position:absolute;z-index:0;left:50%;top:50%;transform:translate(-50%,-50%);width:52%;max-height:82%;object-fit:contain;opacity:.18;pointer-events:none;user-select:none}
      .content{position:relative;z-index:1}.page.tight .section:first-of-type{margin-top:4px}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.section,.brandLine,.watermark{print-color-adjust:exact;-webkit-print-color-adjust:exact}.watermark{opacity:.20 !important}}
    </style></head><body>
      <div class="page">
        ${watermarkHtml}
        <div class="content">
          ${pageHeader(new Date().toLocaleDateString('pt-BR'))}
          <div class="section">DADOS PESSOAIS</div>
          <div class="grid personalTop">
            <div class="field compact"><small>Nome do dentista</small><b>${identity(f.dentist||prof?.name||'')}</b></div>
            <div class="field compact"><small>Paciente</small><b>${identity(f.patient||c.name||a.patient||'')}</b></div>
          </div>
          <div class="grid personalMeta">
            <div class="field"><small>Sexo</small><b>${sexPrint}</b></div>
            <div class="field"><small>Data de Nascimento</small><b>${identity(formatBirthDate(f.birthDate||c.birthDate||''))}</b></div>
            <div class="field"><small>Idade</small><b>${identity(f.age||ageFromBirth(f.birthDate||c.birthDate)||'')}</b></div>
          </div>
          <div class="section">QUEIXA PRINCIPAL</div>${box('chiefComplaint',{tall:true})}
          <div class="section">HISTÓRICO DE CLÍNICA BUCAL</div>
          ${lineSingle('Com que frequência você vai ao dentista?','dentistFrequency',['Semestral','Anual','Raramente','Nunca'])}
          ${lineYN('Apresenta sangramento gengival?','gingivalBleeding')}
          ${lineYN('Já fez tratamento de Canal?','rootCanal')}
          ${lineYN('Apresenta dor em algum dente?','toothPain')}
          ${lineYN2('Usa alguma prótese atualmente?','prosthesis','prosthesisTime','Se sim, há quanto tempo?')}
          ${lineYN2('Usa ou já usou aparelho ortodôntico?','orthodontic','orthodonticTime','Se sim, por quanto tempo?')}
          ${lineYN('Sente sensibilidade dental?','sensitivity')}
          ${lineYN2('Já fez extrações?','extractions','extractionExperience','Como foi sua experiência?')}
          <div class="section">HISTÓRICO DE CLÍNICA MÉDICA</div>
          ${lineYN2('Está atualmente sob algum tipo de tratamento médico?','medicalTreatment','medicalTreatmentWhich','Se sim, qual?')}
          ${lineYN2('Tem alguma doença sistêmica?','systemicDisease','systemicDiseaseWhich','Se sim, qual?')}
          ${lineYN2('Está tomando algum medicamento?','medication','medicationWhich','Se sim, qual medicamento?')}
          ${lineYN2('Já sofreu alguma doença grave?','seriousDisease','seriousDiseaseWhich','Se sim, qual?')}
          ${lineYN2('Já fez alguma cirurgia?','surgery','surgeryWhich','Se sim, qual?')}
          ${lineYN('Quando se fere, as feridas demoram a cicatrizar?','slowHealing')}
        </div>
      </div>
      <div class="page tight">
        ${watermarkHtml}
        <div class="content">
          ${pageHeader('Continuação')}
          <div class="section">HISTÓRICO DE CLÍNICA MÉDICA</div>
          ${lineYN2('Possui alergia a algum medicamento ou alimento?','allergy','allergyWhich','Quais?')}
          ${lineYN2('Tem algum problema no coração? (marca-passo, válvula etc)','heartProblem','heartProblemTime','Se fez, há quanto tempo?')}
          ${lineYN('Tem problema estomacal?','stomachProblem')}
          ${lineYN('Probabilidade de gravidez?','pregnancy')}
          ${lineYN('Está amamentando?','breastfeeding')}
          ${lineYN('Já fez radioterapia ou quimioterapia?','radioChemo')}
          ${lineYN('Já fez transplante?','transplant')}
          ${lineYN2('Está fazendo algum tratamento psicológico?','psychologicalTreatment','psychologicalTreatmentWhich','Se sim, qual?')}
          <div class="q"><span>Existe alguma doença que não perguntei e você queira me relatar?</span></div>${box('otherDisease')}
          <div class="section">HÁBITOS</div>
          ${lineYN2('Costuma roer unhas, apertar os dentes, chupar os dedos, morder objetos etc?','oralHabits','oralHabitsWhich','Se sim, qual?')}
          ${lineYN('Ingere bebidas alcoólicas?','alcohol')}
          ${lineYN('Fuma ou já fumou?','smoking')}
          ${lineYN('Faz uso de drogas ilícitas?','illicitDrugs')}
          ${lineSingle('Frequência de escovação diária:','brushingFrequency',['1x','2x','3x','4x ou mais vezes ao dia'])}
          ${lineMulti('O que utiliza para realizar sua higiene bucal?','oralHygiene',['Escova','Palito','Creme dental','Fio dental','Enxaguante','Raspador de língua'])}
          <div class="section">VISÃO DO ESPECIALISTA</div>${box('specialistView')}
        </div>
      </div>
      <div class="page">
        ${watermarkHtml}
        <div class="content">
          ${pageHeader('Declaração')}
          <div class="section">DECLARAÇÃO DE VERACIDADE</div><div class="decl">${esc(decl)}</div>
          <p style="margin-top:24px">São Luís (MA), ______ de ________________________ de 20______.</p>
          <div class="signatures"><div class="sig">Assinatura do(a) Paciente/Responsável</div><div class="sig">Assinatura e Carimbo do(a) Cirurgião-Dentista responsável</div></div>
          <div class="audit">${manualMode?`Ficha em branco emitida por Cronos Odonto • ${esc(fmtDateTime(new Date().toISOString()))}`:`Documento emitido por Cronos Odonto • ${esc(fmtDateTime(rec.updatedAt||new Date().toISOString()))} • ${esc(rec.updatedBy||actorLabel())}`}</div>
        </div>
      </div>
      <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`;
    w.document.write(html);w.document.close();
  }
  function certificateStorageKey(a){return `certificate:${String(a?.contactId||a?.entryId||a?.patient||'patient')}:${String(a?.date||'')}:${String(a?.time||'')}:${String(a?.professionalId||'')}`}
  function certificateRecord(a){if(!state.store)loadStore();return state.store?.certificates?.[certificateStorageKey(a)]||null}
  function certificateCro(prof){
    const cro=String(prof?.cro||'').trim(),uf=String(prof?.uf||'').trim().toUpperCase();
    if(!cro)return '';
    return `CRO${uf?'-'+uf:''} ${cro}`;
  }
  function certificateLongDate(iso){
    const raw=String(iso||'').trim();
    const d=/^\d{4}-\d{2}-\d{2}$/.test(raw)?new Date(`${raw}T12:00:00`):new Date();
    const months=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    return `${String(d.getDate()).padStart(2,'0')} de ${months[d.getMonth()]} de ${d.getFullYear()}`;
  }
  function certificateDefaults(a,type='attendance',days=1){
    const prof=professionalById(a?.professionalId),branding=agendaClinicBranding();
    const patient=String(a?.patient||'Paciente').trim();
    const date=String(a?.date||localISODate(new Date()));
    const time=String(a?.time||'').trim();
    const city=String(branding?.clinicCity||branding?.city||'São Luís').trim()||'São Luís';
    const doctor=String(prof?.name||'').trim();
    const cro=certificateCro(prof);
    const n=Math.max(1,Number(days)||1);
    if(type==='leave'){
      return {
        type:'leave',days:n,
        title:'ATESTADO ODONTOLÓGICO',
        body:`Atesto, para os devidos fins, que o(a) paciente ${patient} foi atendido(a) nesta clínica odontológica no dia ${fmtDate(date,{short:true})}, às ${time}, necessitando de afastamento de suas atividades habituais por ${n} ${n===1?'dia':'dias'}, a contar desta data, para recuperação em decorrência do procedimento odontológico realizado.`,
        cityDate:`${city}, ${certificateLongDate(date)}.`,
        doctor,cro
      };
    }
    return {
      type:'attendance',days:1,
      title:'ATESTADO DE COMPARECIMENTO',
      body:`Atesto, para os devidos fins, que o(a) paciente ${patient} compareceu a esta clínica odontológica no dia ${fmtDate(date,{short:true})}, às ${time}, para atendimento odontológico.`,
      cityDate:`${city}, ${certificateLongDate(date)}.`,
      doctor,cro
    };
  }
  function certificateEditorMarkup(a,rec={}){
    const prof=professionalById(a.professionalId),branding=agendaClinicBranding();
    const clinicName=branding.clinicName;
    const clinicPhone=branding.clinicPhone;
    const logo=branding.logoDataUri;
    const type=String(rec?.type||'attendance');
    const days=Math.max(1,Number(rec?.days)||1);
    const defaults=certificateDefaults(a,type,days);
    const title=String(rec?.title||defaults.title);
    const body=String(rec?.body||defaults.body);
    const cityDate=String(rec?.cityDate||defaults.cityDate);
    const doctor=String(rec?.doctor||defaults.doctor);
    const cro=String(rec?.cro||defaults.cro);
    return `<div class="certEditor" id="agendaCertificateForm" data-agenda-id="${esc(a.id)}">
      <div class="certControls">
        <label><span>Modelo</span><select id="agendaCertificateType">
          <option value="attendance"${type==='attendance'?' selected':''}>Comparecimento</option>
          <option value="leave"${type==='leave'?' selected':''}>Afastamento</option>
        </select></label>
        <label class="certDays"${type==='leave'?'':' hidden'}><span>Dias de afastamento</span><input id="agendaCertificateDays" type="number" min="1" max="365" step="1" value="${esc(days)}"></label>
        <button class="btn" type="button" onclick="CRONOS_AGENDA.resetCertificateTemplate('${esc(a.id)}')">Restaurar texto padrão</button>
      </div>
      <div class="certHint">O conteúdo é editável. Fonte, tamanhos, margens, alinhamentos e espaçamentos já vêm padronizados pelo Cronos e não precisam ser formatados manualmente.</div>
      <div class="certSheetPreview">
        <header class="certClinicHead">
          <div class="certClinicLogo">${logo?`<img src="${logo}" alt="${esc(clinicName)}">`:`<div class="certClinicFallback">${esc(clinicName.slice(0,2).toUpperCase())}</div>`}</div>
          <div><strong>${esc(clinicName)}</strong>${clinicPhone?`<small>${esc(clinicPhone)}</small>`:''}</div>
        </header>
        <div class="certEditable certEditableTitle" contenteditable="true" spellcheck="true" data-cert-field="title">${esc(title)}</div>
        <div class="certEditable certEditableBody" contenteditable="true" spellcheck="true" data-cert-field="body">${esc(body)}</div>
        <div class="certEditable certEditableDate" contenteditable="true" spellcheck="true" data-cert-field="cityDate">${esc(cityDate)}</div>
        <div class="certSignature">
          <div class="certSignatureLine"></div>
          <div class="certEditable certEditableDoctor" contenteditable="true" spellcheck="true" data-cert-field="doctor">${esc(doctor)}</div>
          <div class="certEditable certEditableCro" contenteditable="true" spellcheck="true" data-cert-field="cro">${esc(cro)}</div>
        </div>
      </div>
      <div class="certSaveMeta">${rec?.updatedAt?`Última atualização: ${esc(fmtDateTime(rec.updatedAt))} • ${esc(rec.updatedBy||'Usuário')}`:'Ainda não salvo.'}</div>
    </div>`;
  }
  function collectCertificateFields(){
    const form=$('agendaCertificateForm');if(!form)return null;
    const get=(key)=>String(form.querySelector(`[data-cert-field="${key}"]`)?.innerText||'').replace(/\u00a0/g,' ').trim();
    return {
      type:String($('agendaCertificateType')?.value||'attendance'),
      days:Math.max(1,Number($('agendaCertificateDays')?.value)||1),
      title:get('title'),body:get('body'),cityDate:get('cityDate'),doctor:get('doctor'),cro:get('cro')
    };
  }
  function openCertificate(id){
    const a=appointmentById(id);if(!a)return toastSafe('Atestado indisponível','Não consegui localizar esta consulta.');
    const rec=certificateRecord(a)||{};
    const body=certificateEditorMarkup(a,rec);
    const foot=`<button class="btn" type="button" onclick="closeModal()">Fechar</button><button class="btn" type="button" onclick="CRONOS_AGENDA.printCertificate('${esc(id)}')">Imprimir</button><button class="btn primary" type="button" onclick="CRONOS_AGENDA.saveCertificate('${esc(id)}')">Salvar atestado</button>`;
    const opened=agendaOpenModalSafe({title:'Atestado odontológico',sub:'Agenda → paciente • identidade da clínica',bodyHTML:body,footHTML:foot,maxWidth:'min(96vw,980px)',width:'min(96vw,980px)',modalClass:'cronosAgendaModal agendaCertificateModal'});
    if(opened){
      setTimeout(()=>{
        $('agendaCertificateType')?.addEventListener('change',()=>{
          const wrap=document.querySelector('.certDays');if(wrap)wrap.hidden=$('agendaCertificateType')?.value!=='leave';
        });
      },0);
    }
    return opened;
  }
  function resetCertificateTemplate(id){
    const a=appointmentById(id),form=$('agendaCertificateForm');if(!a||!form)return;
    const type=String($('agendaCertificateType')?.value||'attendance'),days=Math.max(1,Number($('agendaCertificateDays')?.value)||1);
    const d=certificateDefaults(a,type,days);
    ['title','body','cityDate','doctor','cro'].forEach(key=>{const el=form.querySelector(`[data-cert-field="${key}"]`);if(el)el.innerText=d[key]||'';});
    const wrap=document.querySelector('.certDays');if(wrap)wrap.hidden=type!=='leave';
  }
  function saveCertificate(id,{silent=false,keepOpen=false}={}){
    const a=appointmentById(id);if(!a)return false;
    const fields=collectCertificateFields();if(!fields)return false;
    if(!state.store)loadStore();
    const key=certificateStorageKey(a),previous=state.store.certificates[key]||{},now=new Date().toISOString();
    state.store.certificates[key]={id:previous.id||uuid('certificate'),key,contactId:String(a.contactId||''),patient:String(a.patient||''),...fields,createdAt:previous.createdAt||now,createdBy:previous.createdBy||actorLabel(),updatedAt:now,updatedBy:actorLabel()};
    const ok=saveStore();
    if(ok&&!silent)toastSafe('Atestado salvo','Atestado salvo na clínica.');
    if(ok&&!keepOpen)try{closeModal()}catch(_){}
    return ok;
  }
  function printCertificate(id){
    const a=appointmentById(id);if(!a)return;
    const live=collectCertificateFields();
    if(live)saveCertificate(id,{silent:true,keepOpen:true});
    const rec=certificateRecord(a)||live||certificateDefaults(a);
    const branding=agendaClinicBranding();
    const clinicName=branding.clinicName;
    const clinicPhone=branding.clinicPhone,logo=branding.logoDataUri;
    const safeLines=(v)=>esc(String(v||'')).replace(/\n/g,'<br>');
    const w=window.open('','_blank','width=1000,height=820');if(!w)return toastSafe('Pop-up bloqueado','Permita pop-ups para imprimir o atestado.');
    const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(rec.title||'Atestado')}</title><style>
      @page{size:A4;margin:18mm 20mm 20mm}*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif}.sheet{min-height:257mm;padding:0;position:relative}.clinic{text-align:center;border-bottom:1px solid #d8dde5;padding-bottom:16px;margin-bottom:42px}.clinic img{display:block;max-width:92px;max-height:74px;object-fit:contain;margin:0 auto 8px}.clinic strong{display:block;font-size:16px}.clinic small{display:block;margin-top:4px;font-size:12px;color:#555}.title{text-align:center;font-size:19px;font-weight:800;letter-spacing:.02em;margin:0 0 34px}.body{font-size:12px;line-height:1.7;text-align:justify;min-height:130px}.date{font-size:12px;margin-top:38px}.sign{width:52%;margin-top:74px;text-align:center}.signLine{border-top:1px solid #222;margin-bottom:7px}.doctor{font-size:12px;font-weight:700}.cro{font-size:12px;margin-top:3px;color:#333}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body><main class="sheet"><header class="clinic">${logo?`<img src="${logo}" alt="${esc(clinicName)}">`:''}<strong>${esc(clinicName)}</strong>${clinicPhone?`<small>${esc(clinicPhone)}</small>`:''}</header><h1 class="title">${safeLines(rec.title)}</h1><div class="body">${safeLines(rec.body)}</div><div class="date">${safeLines(rec.cityDate)}</div><div class="sign"><div class="signLine"></div><div class="doctor">${safeLines(rec.doctor)}</div><div class="cro">${safeLines(rec.cro)}</div></div></main><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`;
    w.document.write(html);w.document.close();
  }
  function prescriptionStorageKey(a){return `prescription:${String(a?.contactId||a?.entryId||a?.patient||'patient')}:${String(a?.date||'')}:${String(a?.time||'')}:${String(a?.professionalId||'')}`}
  function prescriptionRecord(a){if(!state.store)loadStore();return state.store?.prescriptions?.[prescriptionStorageKey(a)]||null}
  function emptyPrescriptionItem(){return {id:uuid('rxitem'),name:'',dose:'',quantity:'',instructions:''}}
  function prescriptionDefaults(a){
    const prof=professionalById(a?.professionalId);
    return {
      patient:String(a?.patient||'Paciente').trim(),
      doctor:String(prof?.name||'').trim(),
      cro:certificateCro(prof),
      date:String(a?.date||localISODate(new Date())),
      internal:[emptyPrescriptionItem(),emptyPrescriptionItem()],
      external:[emptyPrescriptionItem()],
      note:''
    };
  }
  function normalizePrescriptionItems(list,count=1){
    const src=Array.isArray(list)?list:[];
    const out=src.map(x=>({id:String(x?.id||uuid('rxitem')),name:String(x?.name||''),dose:String(x?.dose||''),quantity:String(x?.quantity||''),instructions:String(x?.instructions||'')}));
    while(out.length<count)out.push(emptyPrescriptionItem());
    return out;
  }
  function prescriptionItemMarkup(item,section,index){
    return `<div class="rxItem" data-rx-section="${esc(section)}" data-rx-index="${index}" data-rx-id="${esc(item.id)}">
      <div class="rxItemHead"><b>${index+1}. Medicamento</b><button class="rxRemoveBtn" type="button" title="Remover medicamento" onclick="CRONOS_AGENDA.removePrescriptionItem('${esc(section)}',${index})">×</button></div>
      <div class="rxItemGrid">
        <label class="rxField rxName"><span>Medicamento</span><input type="text" data-rx-field="name" value="${esc(item.name)}" placeholder="Digite o nome"></label>
        <label class="rxField"><span>Dose / concentração</span><input type="text" data-rx-field="dose" value="${esc(item.dose)}" placeholder="Ex.: ___ mg"></label>
        <label class="rxField"><span>Quantidade</span><input type="text" data-rx-field="quantity" value="${esc(item.quantity)}" placeholder="Ex.: ___ caixa(s)"></label>
        <label class="rxField rxInstructions"><span>Posologia / orientação</span><textarea data-rx-field="instructions" rows="2" placeholder="Digite a orientação de uso">${esc(item.instructions)}</textarea></label>
      </div>
    </div>`;
  }
  function prescriptionSectionMarkup(title,section,items){
    return `<section class="rxSection" data-rx-section-wrap="${esc(section)}"><div class="rxSectionHead"><div><small>RECEITUÁRIO</small><h4>${esc(title)}</h4></div><button class="btn" type="button" onclick="CRONOS_AGENDA.addPrescriptionItem('${esc(section)}')">+ Adicionar medicamento</button></div><div class="rxItems">${items.map((it,i)=>prescriptionItemMarkup(it,section,i)).join('')}</div></section>`;
  }
  function prescriptionEditorMarkup(a,rec={}){
    const branding=agendaClinicBranding(),prof=professionalById(a.professionalId),defaults=prescriptionDefaults(a);
    const internal=normalizePrescriptionItems(rec?.internal||defaults.internal,2),external=normalizePrescriptionItems(rec?.external||defaults.external,1);
    const doctor=String(rec?.doctor||defaults.doctor),cro=String(rec?.cro||defaults.cro),note=String(rec?.note||'');
    const logo=String(branding?.logoDataUri||'').trim(),clinicName=String(branding?.clinicName||'Clínica').trim(),clinicPhone=String(branding?.clinicPhone||'').trim();
    return `<div class="rxEditor" id="agendaPrescriptionForm" data-agenda-id="${esc(a.id)}">
      <div class="rxHint">O receituário já vem estruturado. Você só preenche ou substitui medicamento, dose, quantidade e orientação. A impressão mantém a formatação fixa da clínica.</div>
      <div class="rxPatientBar"><div><small>Paciente</small><strong>${esc(a.patient||'Paciente')}</strong></div><div><small>Profissional</small><strong>${esc(doctor||prof?.name||'Não definido')}</strong>${cro?`<span>${esc(cro)}</span>`:''}</div></div>
      ${prescriptionSectionMarkup('USO INTERNO','internal',internal)}
      ${prescriptionSectionMarkup('USO EXTERNO','external',external)}
      <section class="rxSection rxNoteSection"><div class="rxSectionHead"><div><small>OPCIONAL</small><h4>Observação</h4></div></div><textarea id="agendaPrescriptionNote" rows="3" placeholder="Observação complementar, se necessário">${esc(note)}</textarea></section>
      <div class="rxPrintPreview">
        <header class="rxClinicHead">${logo?`<img src="${logo}" alt="${esc(clinicName)}">`:''}<div><strong>${esc(clinicName)}</strong>${clinicPhone?`<small>${esc(clinicPhone)}</small>`:''}</div></header>
        <div class="rxPreviewTitle">RECEITUÁRIO ODONTOLÓGICO</div>
        <div class="rxPreviewMeta"><span><b>Paciente:</b> ${esc(a.patient||'Paciente')}</span><span><b>Data:</b> ${esc(fullNumericDate(a.date))}</span></div>
        <p>Os campos acima serão organizados automaticamente neste documento ao imprimir.</p>
      </div>
      <div class="rxSaveMeta">${rec?.updatedAt?`Última atualização: ${esc(fmtDateTime(rec.updatedAt))} • ${esc(rec.updatedBy||'Usuário')}`:'Ainda não salvo.'}</div>
    </div>`;
  }
  function collectPrescriptionItems(section){
    const form=$('agendaPrescriptionForm');if(!form)return [];
    return [...form.querySelectorAll(`.rxItem[data-rx-section="${section}"]`)].map(row=>({
      id:String(row.dataset.rxId||uuid('rxitem')),
      name:String(row.querySelector('[data-rx-field="name"]')?.value||'').trim(),
      dose:String(row.querySelector('[data-rx-field="dose"]')?.value||'').trim(),
      quantity:String(row.querySelector('[data-rx-field="quantity"]')?.value||'').trim(),
      instructions:String(row.querySelector('[data-rx-field="instructions"]')?.value||'').trim()
    }));
  }
  function collectPrescriptionFields(){
    const form=$('agendaPrescriptionForm');if(!form)return null;
    const a=appointmentById(form.dataset.agendaId),prof=professionalById(a?.professionalId);
    return {doctor:String(prof?.name||''),cro:certificateCro(prof),internal:collectPrescriptionItems('internal'),external:collectPrescriptionItems('external'),note:String($('agendaPrescriptionNote')?.value||'').trim()};
  }
  function rerenderPrescriptionSection(section,items){
    const wrap=document.querySelector(`[data-rx-section-wrap="${section}"] .rxItems`);if(!wrap)return;
    wrap.innerHTML=normalizePrescriptionItems(items,1).map((it,i)=>prescriptionItemMarkup(it,section,i)).join('');
  }
  function addPrescriptionItem(section){
    const current=collectPrescriptionItems(section);current.push(emptyPrescriptionItem());rerenderPrescriptionSection(section,current);
  }
  function removePrescriptionItem(section,index){
    const current=collectPrescriptionItems(section);current.splice(Number(index)||0,1);rerenderPrescriptionSection(section,current.length?current:[emptyPrescriptionItem()]);
  }
  function openPrescription(id){
    const a=appointmentById(id);if(!a)return toastSafe('Receituário indisponível','Não consegui localizar esta consulta.');
    const rec=prescriptionRecord(a)||{};
    const body=prescriptionEditorMarkup(a,rec);
    const foot=`<button class="btn" type="button" onclick="closeModal()">Fechar</button><button class="btn" type="button" onclick="CRONOS_AGENDA.printPrescription('${esc(id)}')">Imprimir</button><button class="btn primary" type="button" onclick="CRONOS_AGENDA.savePrescription('${esc(id)}')">Salvar receituário</button>`;
    return agendaOpenModalSafe({title:'Receituário odontológico',sub:'Agenda → paciente • modelo estruturado',bodyHTML:body,footHTML:foot,maxWidth:'min(97vw,1080px)',width:'min(97vw,1080px)',modalClass:'cronosAgendaModal agendaPrescriptionModal'});
  }
  function savePrescription(id,{silent=false,keepOpen=false}={}){
    const a=appointmentById(id);if(!a)return false;const fields=collectPrescriptionFields();if(!fields)return false;
    if(!state.store)loadStore();const key=prescriptionStorageKey(a),previous=state.store.prescriptions[key]||{},now=new Date().toISOString();
    state.store.prescriptions[key]={id:previous.id||uuid('prescription'),key,contactId:String(a.contactId||''),patient:String(a.patient||''),...fields,createdAt:previous.createdAt||now,createdBy:previous.createdBy||actorLabel(),updatedAt:now,updatedBy:actorLabel()};
    const ok=saveStore();if(ok&&!silent)toastSafe('Receituário salvo','Receituário salvo na clínica.');if(ok&&!keepOpen)try{closeModal()}catch(_){}return ok;
  }
  function formatPrescriptionDose(value){
    let v=String(value||'').trim();
    if(!v)return '';
    // Ex.: "1mg" -> "1 mg", "500mcg" -> "500 mcg", "2mL" -> "2 mL".
    v=v.replace(/(\d(?:[\d.,]*))\s*(mcg|µg|ug|mg|g|kg|ml|mL|l|L|ui|UI)\b/g,(m,n,u)=>`${n} ${u}`);
    return v.replace(/\s{2,}/g,' ');
  }
  function formatPrescriptionQuantity(value){
    let v=String(value||'').trim();
    if(!v)return '';
    // Ex.: "2caixas" -> "2 caixas", sem tentar adivinhar a unidade.
    v=v.replace(/(\d(?:[\d.,]*))\s*([A-Za-zÀ-ÿ]+)/g,'$1 $2');
    return v.replace(/\s{2,}/g,' ');
  }
  function fullNumericDate(iso){
    try{return parseDate(iso).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});}catch(_){return String(iso||'');}
  }
  function printPrescription(id){
    const a=appointmentById(id);if(!a)return;const live=collectPrescriptionFields();if(live)savePrescription(id,{silent:true,keepOpen:true});
    const rec=prescriptionRecord(a)||live||prescriptionDefaults(a),branding=agendaClinicBranding(),prof=professionalById(a.professionalId);
    const logo=String(branding?.logoDataUri||'').trim(),clinicName=String(branding?.clinicName||'Clínica').trim(),clinicPhone=String(branding?.clinicPhone||'').trim();
    const doctor=String(rec?.doctor||prof?.name||''),cro=String(rec?.cro||certificateCro(prof));
    const clean=(list)=>normalizePrescriptionItems(list,0).filter(x=>x.name||x.dose||x.quantity||x.instructions);
    const internal=clean(rec?.internal),external=clean(rec?.external);
    const renderItems=(items)=>items.map((x,i)=>`<div class="rxLine"><div class="rxDrug"><b>${i+1}. ${esc(x.name||'________________________')}</b><span>${esc(formatPrescriptionDose(x.dose||''))}</span><em>${esc(formatPrescriptionQuantity(x.quantity||''))}</em></div>${x.instructions?`<div class="rxInst">${esc(x.instructions)}</div>`:''}</div>`).join('');
    const section=(title,items)=>items.length?`<section><h2>${esc(title)}</h2>${renderItems(items)}</section>`:'';
    const w=window.open('','_blank','width=1000,height=820');if(!w)return toastSafe('Pop-up bloqueado','Permita pop-ups para imprimir o receituário.');
    const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Receituário - ${esc(a.patient||'Paciente')}</title><style>
      @page{size:A4;margin:17mm 19mm 20mm}*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif}.sheet{min-height:260mm;position:relative;display:flex;flex-direction:column}.clinic{text-align:center;border-bottom:1px solid #d8dde5;padding-bottom:14px;margin-bottom:26px}.clinic img{display:block;max-width:92px;max-height:72px;object-fit:contain;margin:0 auto 7px}.clinic strong{display:block;font-size:16px}.clinic small{display:block;margin-top:4px;font-size:12px;color:#555}.title{text-align:center;font-size:19px;font-weight:800;margin:0 0 24px}.meta{display:flex;justify-content:space-between;gap:16px;font-size:11px;padding-bottom:9px;border-bottom:1px solid #e1e5ea;margin-bottom:18px}.meta span:first-child{flex:1}.rxBody{flex:0 0 auto}.rxBody section{margin:18px 0 22px}.rxBody h2{font-size:13px;margin:0 0 10px;text-transform:uppercase}.rxLine{margin:0 0 12px}.rxDrug{display:grid;grid-template-columns:minmax(0,1fr) 125px 145px;gap:14px;align-items:end;border-bottom:1px solid #555;padding-bottom:3px;font-size:12px}.rxDrug b{font-weight:700;min-width:0}.rxDrug span{text-align:center;white-space:nowrap}.rxDrug em{text-align:right;font-style:normal;white-space:nowrap}.rxInst{font-size:12px;line-height:1.5;margin-top:4px;padding-left:2px}.note{font-size:12px;line-height:1.5;margin-top:20px}.sign{width:52%;margin-top:72px;padding-top:0;text-align:center}.signLine{border-top:1px solid #222;margin-bottom:6px}.doctor{font-size:12px;font-weight:700}.cro{font-size:12px;color:#333;margin-top:2px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body><main class="sheet"><header class="clinic">${logo?`<img src="${logo}" alt="${esc(clinicName)}">`:''}<strong>${esc(clinicName)}</strong>${clinicPhone?`<small>${esc(clinicPhone)}</small>`:''}</header><h1 class="title">RECEITUÁRIO ODONTOLÓGICO</h1><div class="meta"><span><b>Paciente:</b> ${esc(a.patient||'Paciente')}</span><span><b>Data:</b> ${esc(fullNumericDate(a.date))}</span></div><div class="rxBody">${section('Uso Interno',internal)}${section('Uso Externo',external)}${rec?.note?`<div class="note"><b>Observação:</b> ${esc(rec.note)}</div>`:''}</div><div class="sign"><div class="signLine"></div><div class="doctor">${esc(doctor)}</div><div class="cro">${esc(cro)}</div></div></main><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`;
    w.document.write(html);w.document.close();
  }
  function openPendingDocument(a,type){
    if(type==='certificate'){openCertificate(a.id);return}
    if(type==='prescription'){openPrescription(a.id);return}
    const label='Documento';
    const body=`<div class="agendaDetail"><div class="agendaDetailHero"><h3>${esc(label)}</h3><p>${esc(a.patient)}</p></div><div class="agendaModalHint">Este documento ainda não foi configurado.</div></div>`;
    if(typeof openModal==='function')openModal({title:label,sub:'Agenda → paciente',bodyHTML:body,footHTML:'<button class="btn" type="button" onclick="closeModal()">Fechar</button>',maxWidth:'min(94vw,620px)',width:'min(94vw,620px)'});
  }
  function openPatientAction(id,action){
    closeFloatingMenu();const a=appointmentById(id);if(!a)return;const entry=resolveEntryForAppointment(a);
    if(action==='record'){
      if(!entry?.id)return toastSafe('Prontuário indisponível','Não encontrei um registro do paciente para abrir.');
      try{window.openFicha?.(String(entry.id));}catch(error){console.error(error);toastSafe('Falha ao abrir prontuário','Tente novamente.')}return;
    }
    if(action==='exam'){
      if(!entry?.id)return toastSafe('Exame digital indisponível','Não encontrei um registro do paciente para abrir.');
      try{if(window.CRONOS_EXAM_DIGITAL?.openForPatient)return window.CRONOS_EXAM_DIGITAL.openForPatient(String(entry.id));}catch(error){console.error(error)}
      return toastSafe('Exame digital indisponível','O módulo não pôde ser aberto agora.');
    }
    if(action==='finance'){
      hideAgenda();if(typeof setActiveView==='function')setActiveView('installments');
      setTimeout(()=>{const input=$('instSearch');if(input){input.value=a.patient;input.dispatchEvent(new Event('input',{bubbles:true}))}try{if(typeof renderInstallmentsView==='function')renderInstallmentsView()}catch(_){}},100);return;
    }
    if(action==='anamnesis'){setTimeout(()=>openAnamnesis(id),0);return}
    if(['certificate','prescription'].includes(action)){openPendingDocument(a,action);return}
  }
  function openDetails(id){
    const a=appointmentById(id);if(!a)return;const prof=professionalById(a.professionalId);const entry=resolveEntryForAppointment(a);const c=cancellationFor(a),who=cancellationRequesterLabel(a),r=rescheduleFor(a);
    const cancellationDetails=isCancelled(a)?`<div class="agendaDetailGrid agendaCancellationDetails"><div class="agendaDetailBox"><small>Desmarcação</small><b>${esc(statusLabel(a))}</b></div><div class="agendaDetailBox"><small>Desmarcado em</small><b>${esc(fmtDateTime(c?.cancelledAt||a.audit?.updatedAt||''))}</b></div><div class="agendaDetailBox"><small>Registrado por</small><b>${esc(c?.cancelledBy||a.audit?.updatedBy||'Não informado')}</b></div><div class="agendaDetailBox"><small>Solicitação</small><b>${esc(who||'Não informada')}</b></div></div>${String(c?.note||'').trim()?`<div class="agendaDetailBox"><small>Observação da desmarcação</small><b>${esc(String(c.note).trim())}</b></div>`:''}`:'';
    const toProf=isRescheduledHistory(a)?professionalById(r?.toProfessionalId):null;
    const rescheduleDetails=isRescheduledHistory(a)?`<div class="agendaDetailGrid agendaRescheduleDetails"><div class="agendaDetailBox"><small>Horário anterior</small><b>${esc(fmtDate(r?.fromDate||a.date))} • ${esc(normalizeTime(r?.fromTime||a.time))}</b></div><div class="agendaDetailBox"><small>Remarcado para</small><b>${esc(fmtDate(r?.toDate||''))} • ${esc(normalizeTime(r?.toTime||''))}</b></div><div class="agendaDetailBox"><small>Novo profissional</small><b>${esc(toProf?.name||professionalName(r?.toProfessionalId)||'Não definido')}</b></div><div class="agendaDetailBox"><small>Remarcado em</small><b>${esc(fmtDateTime(r?.rescheduledAt||a.audit?.createdAt||''))}</b></div><div class="agendaDetailBox"><small>Registrado por</small><b>${esc(r?.rescheduledBy||a.audit?.createdBy||'Não informado')}</b></div></div>`:'';
    const sourceText=a.source==='history'?'• Registro histórico':(a.source==='agenda'?'• Consulta da Agenda':'• Agendamento vinculado ao prontuário');
    const body=`<div class="agendaDetail"><div class="agendaDetailHero"><h3>${esc(a.patient)} ${!isHistorical(a)&&appointmentConfirmed(a)?'<span class="agendaConfirmedMark" title="Presença confirmada">✓</span>':''}</h3><p>${esc(a.phone||'Sem telefone')} ${sourceText}</p></div><div class="agendaDetailGrid"><div class="agendaDetailBox"><small>Data e hora</small><b>${esc(fmtDate(a.date))} • ${esc(a.time)}</b></div><div class="agendaDetailBox"><small>Profissional</small><b>${esc(prof?.name||'Não definido')}</b></div><div class="agendaDetailBox"><small>Procedimento</small><b>${esc(a.procedure||'Consulta')}</b></div><div class="agendaDetailBox"><small>Status</small><b>${esc(statusLabel(a))}${a.overridden?' • atualizado na Agenda':''}</b></div><div class="agendaDetailBox"><small>Convênio</small><b>${esc(a.insurance||'Particular')}</b></div></div>${cancellationDetails}${rescheduleDetails}${a.note?`<div class="agendaDetailBox"><small>Observação</small><b>${esc(a.note)}</b></div>`:''}</div>`;
    const linkedCurrent=isRescheduledHistory(a)&&a.linkedAppointmentId?allAppointments().find(x=>String(x.id)===String(a.linkedAppointmentId)&&!isHistorical(x)):null;
    let foot=`<button class="btn" type="button" onclick="closeModal()">Fechar</button>`;
    if(entry)foot+=`<button class="btn" type="button" onclick="CRONOS_AGENDA.openLead('${esc(entry.id)}')">Abrir lead</button>`;
    if(isCancelled(a))foot+=`<button class="btn primary" type="button" onclick="CRONOS_AGENDA.editAppointment('${esc(a.id)}')">Agendar novamente</button>`;
    else if(linkedCurrent)foot+=`<button class="btn primary" type="button" onclick="CRONOS_AGENDA.openCurrentFromHistory('${esc(linkedCurrent.id)}')">Abrir consulta atual</button>`;
    else if(!isHistorical(a))foot+=`<button class="btn primary" type="button" onclick="CRONOS_AGENDA.editAppointment('${esc(a.id)}')">Remarcar</button>`;
    const title=isCancelled(a)?'Histórico de desmarcação':(isRescheduledHistory(a)?'Histórico de remarcação':'Consulta');
    if(typeof openModal==='function')openModal({title,sub:'Detalhes da agenda',bodyHTML:body,footHTML:foot,maxWidth:'min(94vw,720px)',width:'min(94vw,720px)'});
  }
  function openCurrentFromHistory(id){
    try{closeModal({force:true})}catch(_){ }
    setTimeout(()=>openDetails(id),40);
  }
  function editAppointment(id){
    const a=appointmentById(id);if(!a)return;try{closeModal({force:true})}catch(_){ }
    if(isCancelled(a)){
      const seed={date:a.date,time:a.time,professionalId:a.professionalId,patient:a.patient,contactId:a.contactId,procedure:a.procedure,insurance:a.insurance,phone:a.phone,note:''};
      setTimeout(()=>openAppointmentForm(seed),40);return;
    }
    if(isRescheduledHistory(a)){
      const linked=String(a.linkedAppointmentId||'');if(linked)return openCurrentFromHistory(linked);
      return toastSafe('Histórico de remarcação','A consulta atual vinculada a este histórico não foi encontrada.');
    }
    setTimeout(()=>openAppointmentForm({id:a.id,intent:'reschedule'}),40);
  }
  function openLead(id){try{closeModal({force:true})}catch(_){ }hideAgenda();if(typeof setActiveView==='function')setActiveView('leads');setTimeout(()=>{try{if(typeof openLeadEntry==='function')openLeadEntry(id)}catch(_){ }},80)}

  function moveAppointment(id,date,time,professionalId){
    const a=appointmentById(id);if(!a||isHistorical(a))return false;if(!state.store)loadStore();
    recordRescheduleHistory(a,date,time,professionalId);
    if(a.source==='agenda'){
      const item=state.store.appointments.find(x=>String(x.id)===String(a.id));
      if(item){item.date=date;item.time=normalizeTime(time);item.professionalId=String(professionalId||'');item.agendaStatus='Agendado';item.confirmed=false;item.updatedAt=new Date().toISOString();item.updatedBy=actorLabel();}
    }else{
      const key=String(a.entryId||'');const next={...(state.store.overrides[key]||{}),date,time:normalizeTime(time),professionalId:String(professionalId||''),agendaStatus:'Agendado',confirmed:false};markAudit(next,a.audit||{});state.store.overrides[key]=next;
    }
    saveStore();render();toastSafe('Consulta movida','Novo horário salvo na Agenda.');return true;
  }
  function bindDrag(host){
    $$('[draggable="true"][data-agenda-id]',host).forEach(node=>{
      node.addEventListener('dragstart',e=>{state.drag={id:node.dataset.agendaId};try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',node.dataset.agendaId)}catch(_){}});
      node.addEventListener('dragend',()=>{state.drag=null;$$('.agendaDayRow.dragOver',host).forEach(r=>r.classList.remove('dragOver'))});
    });
    $$('[data-drop-time]',host).forEach(row=>{
      row.addEventListener('dragover',e=>{if(!state.drag)return;e.preventDefault();row.classList.add('dragOver')});
      row.addEventListener('dragleave',()=>row.classList.remove('dragOver'));
      row.addEventListener('drop',e=>{if(!state.drag)return;e.preventDefault();row.classList.remove('dragOver');const time=row.dataset.dropTime;if(isBlocked(state.date,time,state.professionalId)){toastSafe('Horário bloqueado','Desbloqueie o horário antes de mover a consulta.');return}const occupied=appointmentsFor(state.date,state.professionalId,{includeCancelled:false}).some(a=>a.time===time&&a.id!==state.drag.id);if(occupied&&!confirm('Já existe uma consulta neste horário. Deseja colocar as duas no mesmo horário?'))return;moveAppointment(state.drag.id,state.date,time,state.professionalId);state.drag=null;});
    });
  }

  function openSearch(){
    const body=`<div><label style="display:block;font-size:10px;font-weight:800;color:var(--muted);margin-bottom:4px">Paciente, procedimento ou profissional</label><input id="agendaSearchModalInput" placeholder="Digite para localizar..." autocomplete="off" style="width:100%"><div class="agendaSearchResults" id="agendaSearchModalResults"></div></div>`;
    if(typeof openModal==='function')openModal({title:'Localizar consulta',sub:'Pesquisa nos agendamentos da clínica',bodyHTML:body,footHTML:'<button class="btn" type="button" onclick="closeModal()">Fechar</button>',maxWidth:'min(94vw,820px)',width:'min(94vw,820px)',onMount:()=>{const i=$('agendaSearchModalInput');if(i){i.oninput=renderSearchResults;i.focus()}renderSearchResults()}});
  }
  function renderSearchResults(){
    const host=$('agendaSearchModalResults');if(!host)return;const q=String($('agendaSearchModalInput')?.value||'').trim().toLowerCase();const pros=new Map(getProfessionals().map(p=>[String(p.id),p.name]));
    const rows=allAppointments().filter(a=>!q||[a.patient,a.phone,a.procedure,statusLabel(a),appointmentConfirmed(a)?'confirmado':'',pros.get(String(a.professionalId))].join(' ').toLowerCase().includes(q)).slice(0,100);
    host.innerHTML=rows.length?rows.map(a=>`<div class="agendaSearchItem"><div class="agendaSearchDate"><b>${esc(a.time)}</b><br>${esc(fmtDate(a.date,{short:true}))}</div><div><div class="agendaSearchName">${esc(a.patient)}</div><div class="agendaSearchProc">${esc(a.procedure||'Consulta')} • ${esc(pros.get(String(a.professionalId))||'Sem profissional')} • ${esc(statusLabel(a))}${appointmentConfirmed(a)?' • ✓ confirmado':''}</div></div><button class="agendaMiniBtn primary" data-search-open="${esc(a.id)}">Abrir</button></div>`).join(''):'<div class="agendaEmptyState"><strong>Nenhuma consulta encontrada</strong>Tente outro termo.</div>';
    $$('[data-search-open]',host).forEach(b=>b.onclick=()=>{const id=b.dataset.searchOpen;try{closeModal({force:true})}catch(_){ }setTimeout(()=>{const a=appointmentById(id);if(a){state.date=a.date;if(a.professionalId)state.professionalId=a.professionalId;state.mode='day';render();setTimeout(()=>openDetails(id),50)}},40)});
  }

  function printAgenda(){
    const date=state.date;const prof=professionalById(state.professionalId);const list=appointmentsFor(date,state.professionalId);const blocks=blocksFor(date,state.professionalId);const clinic=String((db()?.settings?.clinicBranding?.clinicName)||window.CLOUD_CLINIC_NAME||'Clínica');
    const rows=list.map(a=>`<tr><td>${esc(a.time)}</td><td>${esc(a.patient)}</td><td>${esc(a.procedure||'Consulta')}</td><td>${esc(statusLabel(a))}</td></tr>`).join('');
    const w=window.open('','_blank','width=980,height=760');if(!w)return toastSafe('Pop-up bloqueado','Permita pop-ups para imprimir a agenda.');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Agenda - ${esc(fmtDate(date,{short:true}))}</title><style>body{font-family:Arial,sans-serif;color:#111;padding:24px}h1{margin:0;font-size:24px}.sub{margin:5px 0 20px;color:#555}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:8px;font-size:12px;text-align:left}th{background:#f2f5f8}.foot{margin-top:16px;font-size:10px;color:#666}@media print{body{padding:0}}</style></head><body><h1>${esc(clinic)} — Agenda</h1><div class="sub">${esc(fmtDate(date))} • ${esc(prof?.name||'Agenda geral')} • ${list.length} consultas • ${blocks.length} bloqueios</div><table><thead><tr><th>Hora</th><th>Paciente</th><th>Procedimento</th><th>Status</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Sem consultas.</td></tr>'}</tbody></table><div class="foot">Impresso pelo Cronos Odonto</div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);w.document.close();
  }

  function clinicPeriodsEditorMarkup(periods){
    return normalizeClinicPeriods(periods).map((p,i)=>`<div class="agendaPeriodRow" data-period-row><div><label>Início</label><input type="time" data-period-start value="${esc(p.start)}"></div><div><label>Fim</label><input type="time" data-period-end value="${esc(p.end)}"></div><button class="btn small agendaPeriodRemove" type="button" data-remove-period ${periods.length<=1?'disabled':''}>Remover</button></div>`).join('');
  }
  function renderClinicScheduleSettings(){
    const host=$('agendaClinicPeriods');if(!host)return;
    const periods=clinicSchedule().periods;host.innerHTML=clinicPeriodsEditorMarkup(periods);
    const summary=$('agendaClinicScheduleSummary');
    if(summary){
      const breaks=scheduleBreaksLabel();
      summary.innerHTML=`<div><b>Expediente:</b> ${esc(scheduleLabel())}</div>${breaks?`<div style="margin-top:5px"><b>Intervalo automático:</b> ${esc(breaks)}</div>`:''}<div style="margin-top:5px">Os horários de intervalo não aparecem na grade normal, mas continuam disponíveis pelo botão <b>Encaixar horário</b>.</div>`;
    }
  }
  function addClinicPeriod(){
    const host=$('agendaClinicPeriods');if(!host)return;
    const rows=$$('[data-period-row]',host);const last=rows[rows.length-1];const lastEnd=normalizeTime(last?.querySelector('[data-period-end]')?.value||'14:00');
    const start=lastEnd||'14:00';const end=minutesToTime(Math.min(23*60+59,timeToMin(start)+240));
    host.insertAdjacentHTML('beforeend',clinicPeriodsEditorMarkup([{start,end}]));
    refreshPeriodRemoveButtons();
  }
  function refreshPeriodRemoveButtons(){const rows=$$('[data-period-row]',$('agendaClinicPeriods')||document);rows.forEach(r=>{const b=r.querySelector('[data-remove-period]');if(b)b.disabled=rows.length<=1})}
  async function saveClinicScheduleSettings(){
    const host=$('agendaClinicPeriods');if(!host)return;const hint=$('agendaClinicScheduleSavedHint');
    const periods=$$('[data-period-row]',host).map(r=>({start:normalizeTime(r.querySelector('[data-period-start]')?.value||''),end:normalizeTime(r.querySelector('[data-period-end]')?.value||'')}));
    if(periods.some(p=>!p.start||!p.end||timeToMin(p.end)<=timeToMin(p.start))){if(hint)hint.textContent='Revise os períodos: cada fim precisa ser depois do início.';return toastSafe('Horário inválido','Revise os períodos de funcionamento.')}
    periods.sort((a,b)=>timeToMin(a.start)-timeToMin(b.start));
    for(let i=1;i<periods.length;i++){if(timeToMin(periods[i].start)<timeToMin(periods[i-1].end)){if(hint)hint.textContent='Os períodos não podem se sobrepor.';return toastSafe('Períodos sobrepostos','Ajuste o expediente antes de salvar.')}}
    const data=db();if(!data)return toastSafe('Configurações indisponíveis','Não foi possível carregar a clínica.');if(!data.settings||typeof data.settings!=='object')data.settings={};
    const previous=data.settings.agendaSchedule;const next={version:1,periods,updatedAt:new Date().toISOString()};data.settings.agendaSchedule=next;
    const btn=$('btnSaveClinicSchedule');const oldText=btn?.textContent||'Salvar funcionamento';if(btn){btn.disabled=true;btn.textContent='Salvando...'}if(hint)hint.textContent='Salvando...';
    try{
      const ok=typeof cronosPersistSettingsPatch==='function'?await cronosPersistSettingsPatch(data,{agendaSchedule:next},{silent:true,keepPendingOnFailure:false}):false;
      if(ok===false)throw new Error('A configuração não foi confirmada pelo armazenamento da clínica.');
      if(hint)hint.textContent='Horário de funcionamento salvo.';renderClinicScheduleSettings();if(isAgendaOpen())render();toastSafe('Funcionamento salvo',scheduleLabel());
    }catch(error){
      if(previous===undefined)delete data.settings.agendaSchedule;else data.settings.agendaSchedule=previous;
      try{if(typeof safeSetLocalDB==='function')safeSetLocalDB(data)}catch(_){}
      if(hint)hint.textContent='Não foi possível salvar.';toastSafe('Falha ao salvar funcionamento',String(error?.message||'Tente novamente.'));
    }finally{if(btn){btn.disabled=false;btn.textContent=oldText}}
  }

  function bindStaticUI(){
    $('navAgenda')?.addEventListener('click',openAgenda);
    $('agendaPrevDay')?.addEventListener('click',()=>{state.date=addDays(state.date,-1);render()});
    $('agendaNextDay')?.addEventListener('click',()=>{state.date=addDays(state.date,1);render()});
    $('agendaToday')?.addEventListener('click',()=>{state.date=localISODate(new Date());render()});
    $('agendaDate')?.addEventListener('change',e=>{if(e.target.value){state.date=e.target.value;render()}});
    $('agendaSearchBtn')?.addEventListener('click',openSearch);
    $('agendaFitBtn')?.addEventListener('click',openFitTime);
    $('agendaPrintBtn')?.addEventListener('click',printAgenda);
    $('agendaAddClinicPeriod')?.addEventListener('click',addClinicPeriod);
    $('btnSaveClinicSchedule')?.addEventListener('click',saveClinicScheduleSettings);
    $('agendaClinicPeriods')?.addEventListener('click',e=>{const b=e.target?.closest?.('[data-remove-period]');if(!b)return;b.closest('[data-period-row]')?.remove();refreshPeriodRemoveButtons()});
    $$('.agendaModeBtn').forEach(b=>b.addEventListener('click',()=>{state.mode=b.dataset.mode||'day';render()}));
    document.addEventListener('input',e=>{
      const procedureSearch=e.target?.closest?.('[data-procedure-search-input]');
      if(procedureSearch){const picker=procedureSearch.closest('[data-procedure-picker]');const hidden=picker?.querySelector('input[type=hidden]');if(hidden&&procedureSearchKey(hidden.value)!==procedureSearchKey(procedureSearch.value))hidden.value='';$$('[data-patient-picker].is-open').forEach(closePatientPicker);openProcedurePicker(picker);refreshProcedurePicker(picker,procedureSearch.value);return}
      const patientSearch=e.target?.closest?.('[data-patient-search-input]');
      if(patientSearch){const picker=patientSearch.closest('[data-patient-picker]');const hidden=picker?.querySelector('#agendaFormContactId');if(hidden)hidden.value='';const phone=$('agendaFormPhone');if(phone)phone.value='';$$('[data-procedure-picker].is-open').forEach(closeProcedurePicker);openPatientPicker(picker);refreshPatientPicker(picker,patientSearch.value);return}
      if(e.target?.id==='agendaFormInsurance')e.target.dataset.userEdited='1';
    });
    document.addEventListener('focusin',e=>{const procedureSearch=e.target?.closest?.('[data-procedure-search-input]');if(procedureSearch){openProcedurePicker(procedureSearch.closest('[data-procedure-picker]'));return}const patientSearch=e.target?.closest?.('[data-patient-search-input]');if(patientSearch)openPatientPicker(patientSearch.closest('[data-patient-picker]'))});
    document.addEventListener('keydown',e=>{
      const procedureSearch=e.target?.closest?.('[data-procedure-search-input]');
      if(procedureSearch){const picker=procedureSearch.closest('[data-procedure-picker]');if(e.key==='Escape'){closeProcedurePicker(picker);procedureSearch.blur();return}if(e.key==='ArrowDown'){const first=$$('[data-procedure-option]',picker).find(x=>!x.hidden);if(first){e.preventDefault();first.focus()}return}if(e.key==='Enter'){const first=$$('[data-procedure-option]',picker).find(x=>!x.hidden);if(first){e.preventDefault();chooseProcedure(first)}}return}
      const patientSearch=e.target?.closest?.('[data-patient-search-input]');
      if(patientSearch){const picker=patientSearch.closest('[data-patient-picker]');if(e.key==='Escape'){closePatientPicker(picker);patientSearch.blur();return}if(e.key==='ArrowDown'){const first=$$('[data-patient-option]',picker).find(x=>!x.hidden);if(first){e.preventDefault();first.focus()}return}if(e.key==='Enter'){const first=$$('[data-patient-option]',picker).find(x=>!x.hidden);if(first){e.preventDefault();choosePatient(first)}else syncPatientFromTypedName(picker)}}
    });
    document.addEventListener('change',e=>{
      const select=e.target?.closest?.('#agendaProfessionalSelect');
      if(select){state.professionalId=String(select.value||'');render();return}
      const cancelled=e.target?.closest?.('#agendaToggleCancelled');
      if(cancelled){state.showCancelled=!!cancelled.checked;render();return}
    });

    document.addEventListener('click',e=>{
      const patientOption=e.target?.closest?.('[data-patient-option]');if(patientOption){e.preventDefault();e.stopPropagation();choosePatient(patientOption);return}
      const patientToggle=e.target?.closest?.('[data-patient-toggle]');if(patientToggle){e.preventDefault();e.stopPropagation();const picker=patientToggle.closest('[data-patient-picker]');const results=picker?.querySelector('[data-patient-results]');if(results?.hidden){$$('[data-procedure-picker].is-open').forEach(closeProcedurePicker);openPatientPicker(picker);picker?.querySelector('[data-patient-search-input]')?.focus()}else closePatientPicker(picker);return}
      const procedureOption=e.target?.closest?.('[data-procedure-option]');if(procedureOption){e.preventDefault();e.stopPropagation();chooseProcedure(procedureOption);return}
      const procedureToggle=e.target?.closest?.('[data-procedure-toggle]');if(procedureToggle){e.preventDefault();e.stopPropagation();const picker=procedureToggle.closest('[data-procedure-picker]');const results=picker?.querySelector('[data-procedure-results]');if(results?.hidden){$$('[data-patient-picker].is-open').forEach(closePatientPicker);openProcedurePicker(picker);picker?.querySelector('[data-procedure-search-input]')?.focus()}else closeProcedurePicker(picker);return}
      if(!e.target?.closest?.('[data-procedure-picker]'))$$('[data-procedure-picker].is-open').forEach(closeProcedurePicker);
      if(!e.target?.closest?.('[data-patient-picker]'))$$('[data-patient-picker].is-open').forEach(closePatientPicker);
      const statusAction=e.target?.closest?.('[data-agenda-action]');
      if(statusAction){e.preventDefault();e.stopPropagation();applyAppointmentAction(statusAction.dataset.agendaId,statusAction.dataset.agendaAction);return}
      const patientAction=e.target?.closest?.('[data-agenda-patient-action]');
      if(patientAction){e.preventDefault();e.stopPropagation();openPatientAction(patientAction.dataset.agendaId,patientAction.dataset.agendaPatientAction);return}
      const target=e.target?.closest?.('.nav button[data-view],#navHojeCronos,#navCreditoSimulator,#navPerformance');
      if(target&&isAgendaOpen())hideAgenda();
      if(target?.dataset?.view==='settings')setTimeout(renderClinicScheduleSettings,50);
    },true);
    document.addEventListener('cronos:acl-updated',()=>{if(isAgendaOpen())render();else updateNavBadge()});
    document.addEventListener('cronos:feature-access-updated',()=>{
      try{
        if(typeof window.CRONOS_CAN_SEE_MODULE==='function' && window.CRONOS_CAN_SEE_MODULE('agenda')!==true){
          if(isAgendaOpen())hideAgenda();
          return;
        }
        if(isAgendaOpen() && typeof window.CRONOS_CAN_OPEN_MODULE==='function' && window.CRONOS_CAN_OPEN_MODULE('agenda')===true)render();
        else updateNavBadge();
      }catch(_){ }
    });
    if(!window.__CRONOS_AGENDA_HYDRATION_SYNC__){
      window.__CRONOS_AGENDA_HYDRATION_SYNC__=true;
      window.addEventListener('cronos:persistence-hydrated',()=>{
        try{loadStore();ensureProfessionalSelection();if(isAgendaOpen())render();else updateNavBadge();}catch(error){console.error('Agenda: falha ao sincronizar após hidratação',error)}
      });
    }
    renderClinicScheduleSettings();setTimeout(renderClinicScheduleSettings,900);
    setTimeout(updateNavBadge,600);setTimeout(updateNavBadge,2200);
  }

  window.CRONOS_AGENDA={
    open:openAgenda,render,saveAppointment,removeAppointment,saveExtraSlot,openFitTime,openDetails,openCurrentFromHistory,editAppointment,openLead,openSearch,saveReminder,deleteReminder,openConsultationEdit,saveConsultationEdit,openCancellation,saveCancellation,applyAppointmentAction,openPatientAction,openAnamnesis,saveAnamnesis,printAnamnesis,openCertificate,resetCertificateTemplate,saveCertificate,printCertificate,openPrescription,addPrescriptionItem,removePrescriptionItem,savePrescription,printPrescription,bulkBlockSelected,bulkUnblockSelected,
    getState:()=>JSON.parse(JSON.stringify({mode:state.mode,date:state.date,professionalId:state.professionalId,showCancelled:state.showCancelled,store:state.store||loadStore(),schedule:clinicSchedule()})),getDayTimes:(date,professionalId)=>dayTimes(date||state.date,professionalId||state.professionalId),renderClinicScheduleSettings
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{loadStore();bindStaticUI()});
  else{loadStore();bindStaticUI()}
})();
