/* =========================================================
   Performance mensal
   ========================================================= */
(function(){
  const BOOT='__CRONOS_PERFORMANCE_BOOTED__';
  if(window[BOOT]) return;
  window[BOOT]=true;

  const VIEW_ID='view-performance';
  const NAV_ID='navPerformance';
  const STYLE_ID='cronosPerformanceStyle';
  const STATE=window.__CRONOS_PERFORMANCE_STATE__||{ monthsBack:'all', selectedYear:null, selectedMonth:null };
  window.__CRONOS_PERFORMANCE_STATE__=STATE;

  const $=id=>document.getElementById(id);
  const qs=(s,r=document)=>r.querySelector(s);
  const qsa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  function perfIconSvg(name){
    const icons = {
      reading:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17.5V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5Z"></path><path d="M8 15.5l3.1-3.1 2.3 2.3L17 9"></path><path d="M14 9h3v3"></path></svg>`
    };
    return icons[name] || icons.reading;
  }

  function hasCronos(){return typeof window.loadDB==='function'&&typeof window.currentActor==='function'}
  function load(){try{return window.loadDB()}catch(_){return null}}
  function actor(){try{return window.currentActor()}catch(_){return null}}
  function esc(v){try{if(typeof window.escapeHTML==='function')return window.escapeHTML(v)}catch(_){} return String(v??'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]))}
  function money(v){try{if(typeof window.moneyBR==='function')return window.moneyBR(v)}catch(_){} return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
  function toast(t,m=''){try{if(typeof window.toast==='function')return window.toast(t,m)}catch(_){} console.log('[Performance]',t,m)}
  function canOpenPerformance(){
    try{return !window.CRONOS_CAN_ACCESS_MODULE || window.CRONOS_CAN_ACCESS_MODULE('performance')}catch(_){return true}
  }
  function denyPerformanceAccess(){toast('Acesso restrito','Seu nível de acesso não permite abrir Performance.')}
  function num(v){const n=Number(v||0); return Number.isFinite(n)?n:0}
  function localISODate(date=new Date()){const d=date instanceof Date?date:new Date(date); if(isNaN(d))return ''; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
  function todayISO(){try{if(typeof window.todayISO==='function')return window.todayISO()}catch(_){} return localISODate(new Date())}
  function monthKeyFromDate(iso){return String(iso||'').slice(0,7)}
  function pad2(n){return String(n).padStart(2,'0')}
  function currentMonthKey(){const d=todayISO(); return d.slice(0,7)}
  function currentYear(){return Number(currentMonthKey().slice(0,4))||new Date().getFullYear()}
  function monthKeyOfYear(year,month){return `${year}-${pad2(month)}`}
  function ensureSelectedYear(years=[]){
    const cy=currentYear();
    let y=Number(STATE.selectedYear||cy);
    if(!Number.isFinite(y)||y<2000||y>2200) y=cy;
    const list=Array.isArray(years)?years.map(Number).filter(Number.isFinite):[];
    if(list.length && !list.includes(y) && y!==cy) y=cy;
    STATE.selectedYear=y;
    return y;
  }
  function normalizeMonthNumber(v){
    const n=Number(v);
    return Number.isFinite(n) ? Math.min(12,Math.max(1,Math.round(n))) : null;
  }
  function monthNumberFromKey(mk){
    return normalizeMonthNumber(String(mk||'').slice(5,7));
  }
  function ensureSelectedMonth(year){
    const cy=currentYear();
    const cmk=currentMonthKey();
    const currentMonthNumber=monthNumberFromKey(cmk)||12;
    const y=Number(year)||cy;
    let mk=String(STATE.selectedMonth||'');
    let m=monthNumberFromKey(mk);
    const selectedYearFromKey=Number(mk.slice(0,4));
    if(!m || selectedYearFromKey!==y){
      m = y===cy ? currentMonthNumber : 12;
    }
    if(y>cy) m=currentMonthNumber;
    if(y===cy && m>currentMonthNumber) m=currentMonthNumber;
    const finalKey=monthKeyOfYear(y,m);
    STATE.selectedMonth=finalKey;
    return finalKey;
  }
  function monthOptionsHtml(year, selectedKey){
    const cy=currentYear();
    const currentMonthNumber=monthNumberFromKey(currentMonthKey())||12;
    const y=Number(year)||cy;
    const selectedMonth=monthNumberFromKey(selectedKey)||currentMonthNumber;
    let html='';
    for(let m=1;m<=12;m++){
      const mk=monthKeyOfYear(y,m);
      const disabled=(y>cy || (y===cy && m>currentMonthNumber)) ? 'disabled' : '';
      const label=monthLabel(mk).replace(/\s+\d{4}$/,'');
      html+=`<option value="${mk}" ${m===selectedMonth?'selected':''} ${disabled}>${esc(label)}</option>`;
    }
    return html;
  }
  function prevMonthKey(mk){const [y,m]=String(mk||currentMonthKey()).split('-').map(Number); const d=new Date(y,(m||1)-2,1); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`}
  function nextMonthKey(mk){const [y,m]=String(mk||currentMonthKey()).split('-').map(Number); const d=new Date(y,(m||1),1); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`}
  function daysInMonth(mk){const [y,m]=String(mk||currentMonthKey()).split('-').map(Number); return new Date(y,m,0).getDate()}
  function monthLabel(mk, short=false){
    try{ if(!short && typeof window.monthLabel==='function') return window.monthLabel(mk); }catch(_){}
    const nomes=short?['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']:['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const [y,m]=String(mk||'').split('-');
    const idx=Number(m)-1;
    return nomes[idx] ? `${nomes[idx]} ${y||''}`.trim() : String(mk||'—');
  }
  function pickISO(raw){
    try{ if(typeof window.pickISOFlexible==='function') return window.pickISOFlexible(raw); }catch(_){}
    if(raw instanceof Date) return localISODate(raw);
    if(typeof raw==='number'){const d=new Date(raw); return isNaN(d)?'':localISODate(d)}
    const s=String(raw||'').trim();
    if(!s) return '';
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const br=s.match(/^([0-3]?\d)\/([0-1]?\d)\/([12]\d{3})/);
    if(br) return `${br[3]}-${pad2(br[2])}-${pad2(br[1])}`;
    const d=new Date(s); return isNaN(d)?'':localISODate(d);
  }
  function paymentPaid(p){return !!(p?.paidAt||p?.cashDate||p?.paid)||String(p?.status||'').toUpperCase()==='PAGA'}
  function fallbackEntryDate(e){
    return pickISO(e?.lastPaymentDate||e?.paymentDate||e?.paidAt||e?.cashDate||e?.paymentAt||e?.apptDate||e?.firstContactAt||e?.createdAt||e?.updatedAt||(e?.monthKey?`${String(e.monthKey).slice(0,7)}-01`:''));
  }
  function getEntryPaidValue(e){
    try{ if(typeof window.getEntryPaidValue==='function') return num(window.getEntryPaidValue(e)); }catch(_){}
    let total=0;
    (Array.isArray(e?.financialPlans)?e.financialPlans:[]).forEach(plan=>{
      (Array.isArray(plan?.payments)?plan.payments:[]).forEach(p=>{ if(paymentPaid(p)) total+=num(p.amount||p.value||p.valor); });
    });
    if(total>0) return total;
    return num(e?.valuePaid??e?.valueClosed??e?.valorPago??e?.received??e?.paid);
  }

  function getMainHost(){return qs('.main')||qs('main')||document.body}

  function css(){
    if($(STYLE_ID)) return;
    const st=document.createElement('style');
    st.id=STYLE_ID;
    st.textContent=`
      #${VIEW_ID}{width:100%;max-width:100%;min-height:74vh;padding:0;color:var(--text);box-sizing:border-box;overflow-x:hidden}
      #${VIEW_ID},#${VIEW_ID} *{box-sizing:border-box}
      .perfWrap{display:grid;gap:14px;min-width:0;max-width:100%}
      .perfWrap > *,.perfGrid > *,.perfMain > *{min-width:0}
      .perfHero{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:14px;padding:16px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(135deg,rgba(22,119,255,.15),rgba(46,230,166,.08)),var(--panel2);box-shadow:var(--shadow)}
      :root.light .perfHero{background:linear-gradient(135deg,rgba(37,99,235,.12),rgba(6,182,212,.08)),var(--panel2)}
      .perfHero h2{margin:0 0 6px;font-size:24px;letter-spacing:-.02em}
      .perfHero p{margin:0;color:var(--muted);line-height:1.45;max-width:min(720px,100%)}
      .perfBtn{border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.06);color:inherit;padding:10px 13px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:8px;justify-content:center;min-width:98px}
      .perfBtn:hover{filter:brightness(1.08);transform:translateY(-1px)}
      .perfActions{display:flex;align-items:flex-start;gap:8px;flex-wrap:nowrap;justify-content:flex-end;justify-self:end;margin-left:auto;max-width:100%;white-space:nowrap}
      .perfYearControl{display:flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.045);padding:7px 8px;color:var(--muted);font-size:12px;font-weight:800;white-space:nowrap;min-width:0}
      :root.light .perfYearControl{background:rgba(15,23,42,.035)}
      .perfSelect{appearance:none;border:1px solid var(--line);border-radius:10px;background:var(--panel2);color:var(--text);padding:7px 28px 7px 10px;font-weight:900;cursor:pointer;min-width:0;width:92px;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 14px) 50%,calc(100% - 9px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
      .perfYearControl:nth-child(2) .perfSelect{width:104px}
      .perfActions .perfBtn{min-width:94px;padding-left:12px;padding-right:12px;white-space:nowrap}
      .perfSelect:focus{outline:2px solid color-mix(in srgb,var(--brand) 40%,transparent);outline-offset:2px}
      .perfBtn.loading{opacity:.88;pointer-events:none}
      .perfBtn .perfSpin{width:14px;height:14px;border-radius:999px;border:2px solid color-mix(in srgb,var(--text) 22%,transparent);border-top-color:var(--accent);animation:perfSpin .8s linear infinite;display:inline-block}
      @keyframes perfSpin{to{transform:rotate(360deg)}}
      .perfGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;min-width:0}
      .perfCard{border:1px solid var(--line);border-radius:18px;background:var(--panel2);padding:15px;box-shadow:var(--shadow);min-width:0;max-width:100%}
      .perfKpi .muted{font-size:12px}.perfKpi b{display:block;margin-top:7px;font-size:22px;letter-spacing:-.02em;overflow-wrap:anywhere}.perfKpi small{display:block;margin-top:4px;color:var(--muted);line-height:1.35}
      .perfMain{display:grid;grid-template-columns:minmax(0,.82fr) minmax(0,1.18fr);gap:14px;align-items:start;min-width:0}
      .perfProgressTop{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;margin-bottom:10px}.perfProgressTop h3{margin:0;font-size:18px}.perfProgressTop b{font-size:22px}
      .perfBar{position:relative;height:22px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid var(--line);overflow:hidden}
      :root.light .perfBar{background:rgba(15,23,42,.055)}
      .perfBarFill{height:100%;min-width:0;border-radius:999px;background:linear-gradient(90deg,#ef4444 0%,#f97316 25%,#facc15 50%,#22c55e 75%,#38bdf8 100%);background-repeat:no-repeat;background-position:left center;box-shadow:0 0 24px rgba(46,230,166,.24);transition:width .45s ease,background-size .45s ease}
      .perfMini{height:12px;border-radius:999px;background:rgba(255,255,255,.065);border:1px solid var(--line);overflow:hidden;min-width:92px;max-width:150px;margin-left:auto}
      :root.light .perfMini{background:rgba(15,23,42,.055)}
      .perfMiniFill{height:100%;border-radius:999px;background:linear-gradient(90deg,#ef4444 0%,#f97316 25%,#facc15 50%,#22c55e 75%,#38bdf8 100%);background-repeat:no-repeat;background-position:left center}
      .perfMiniText{display:block;margin-top:3px;font-size:11px;color:var(--muted);text-align:right;white-space:nowrap}
      .perfBarOver{position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:900;color:var(--text);text-shadow:0 1px 3px rgba(0,0,0,.35)}
      .perfInsight{margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.045);line-height:1.48;color:var(--text)}
      :root.light .perfInsight{background:rgba(15,23,42,.035)}
      .perfChartWrap{position:relative;min-height:300px;max-width:100%;overflow:hidden}.perfChart{width:100%;height:290px;display:block;max-width:100%}.perfLegend{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;color:var(--muted);font-size:12px}.perfLegend span{border:1px solid var(--line);border-radius:999px;padding:5px 8px;background:rgba(255,255,255,.035)}
      .perfTable{width:100%;border-collapse:separate;border-spacing:0 8px;table-layout:fixed}.perfTable th{font-size:12px;color:var(--muted);font-weight:800;text-align:left;padding:0 10px}.perfTable td{padding:10px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:rgba(255,255,255,.035);word-break:break-word}.perfTable td:first-child{border-left:1px solid var(--line);border-radius:12px 0 0 12px}.perfTable td:last-child{border-right:1px solid var(--line);border-radius:0 12px 12px 0}.perfTable .right{text-align:right}.perfTable .center{text-align:center}.perfUp{color:var(--ok);font-weight:900}.perfDown{color:var(--danger);font-weight:900}.perfFlat{color:var(--muted);font-weight:900}
      .perfSelectedRow td{background:color-mix(in srgb,var(--brand) 14%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--brand) 28%,transparent)}
      .perfTableScroll{max-height:430px;overflow-y:auto;overflow-x:hidden;padding-right:0;max-width:100%}.perfEmpty{padding:18px;border:1px dashed var(--line);border-radius:16px;color:var(--muted);line-height:1.5}
      .perfStatusCard{position:relative;overflow:hidden;background:linear-gradient(135deg,rgba(22,119,255,.10),rgba(46,230,166,.04)),var(--panel2)}
      .perfStatusCard:before{content:'';position:absolute;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,var(--status-color,var(--brand)),rgba(46,230,166,.65));opacity:.9}
      .perfStatusBadge{display:inline-flex;align-items:center;gap:7px;border:1px solid color-mix(in srgb,var(--status-color,var(--brand)) 42%,transparent);border-radius:999px;background:color-mix(in srgb,var(--status-color,var(--brand)) 12%,transparent);color:var(--text);padding:6px 10px;font-size:12px;font-weight:950;margin-bottom:9px}
      .perfKpi.isMissing b{color:var(--danger)}.perfKpi.isProjection b{color:var(--accent)}
      .perfRead{display:grid;gap:10px;background:linear-gradient(135deg,rgba(22,119,255,.09),rgba(25,198,255,.035));border-color:rgba(25,198,255,.18)}
      :root.light .perfRead{background:linear-gradient(135deg,rgba(37,99,235,.08),rgba(6,182,212,.05));border-color:rgba(37,99,235,.16)}
      .perfReadHead{display:flex;align-items:center;gap:10px;font-weight:950;font-size:16px}.perfReadIcon{width:34px;height:34px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(135deg,rgba(22,119,255,.25),rgba(46,230,166,.12));border:1px solid rgba(25,198,255,.22);color:#67e8f9;flex:0 0 auto}.perfReadIcon svg{width:18px;height:18px;display:block}
      :root.light .perfReadIcon{background:linear-gradient(135deg,rgba(37,99,235,.16),rgba(6,182,212,.10));border-color:rgba(37,99,235,.22);color:#0f4ecf;box-shadow:inset 0 0 0 1px rgba(255,255,255,.45)}
      .perfRead p{margin:0;color:var(--text);line-height:1.45}.perfMetricPair{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.perfMetricBox{padding:12px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.035)}.perfMetricBox span{display:block;color:var(--muted);font-size:12px}.perfMetricBox b{display:block;margin-top:6px;font-size:18px;letter-spacing:-.01em}
      .perfLegend .perfDot{width:9px;height:9px;border-radius:999px;display:inline-block;margin-right:5px;background:var(--dot-color,var(--brand));box-shadow:0 0 10px color-mix(in srgb,var(--dot-color,var(--brand)) 45%,transparent)}
      .perfLegend span{display:inline-flex;align-items:center}.perfTrendSummary{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;color:var(--muted);font-size:12px}.perfTrendSummary b{color:var(--text)}.perfTrendSummary em{font-style:normal;font-weight:900}.perfTrendSummary .up{color:var(--ok)}.perfTrendSummary .down{color:var(--danger)}.perfTable thead th{position:sticky;top:0;z-index:3;background:var(--panel2);padding-top:8px;padding-bottom:8px}.perfTableScroll{scrollbar-gutter:stable}.perfSelectedRow td{background:linear-gradient(90deg,color-mix(in srgb,var(--brand) 18%,transparent),color-mix(in srgb,var(--brand) 10%,transparent));}

      @media(max-width:1260px){.perfMain{grid-template-columns:1fr}.perfChartWrap{min-height:290px}.perfChart{height:280px}}
      @media(max-width:1100px){.perfGrid{grid-template-columns:1fr 1fr}.perfMain{grid-template-columns:1fr}.perfHero{grid-template-columns:minmax(0,1fr) auto}.perfHero p{max-width:620px}.perfActions{transform:scale(.96);transform-origin:top right}}
      @media(max-width:920px){.perfHero{grid-template-columns:1fr}.perfActions{justify-self:start;margin-left:0;transform:none;flex-wrap:wrap;justify-content:flex-start}.perfHero p{max-width:100%}}
      @media(max-width:650px){#${VIEW_ID}{padding:0}.perfGrid{grid-template-columns:1fr}.perfHero h2{font-size:21px}.perfTable{font-size:13px}.perfChart{height:260px}.perfChartWrap{min-height:280px}}
    `;
    document.head.appendChild(st);
  }

  function ensureView(){
    let v=$(VIEW_ID); if(v) return v;
    v=document.createElement('section');
    v.id=VIEW_ID;
    v.className='hidden';
    v.style.display='none';
    getMainHost().appendChild(v);
    return v;
  }

  function ensureNav(){
    const nav=qs('.nav'); if(!nav) return;
    let btn=$(NAV_ID);
    if(btn){
      btn.classList.toggle('hidden',!canOpenPerformance());
    }
    if(!btn){
      btn=document.createElement('button');
      btn.id=NAV_ID;
      btn.type='button';
      btn.dataset.performance='1';
      btn.innerHTML='<span>↗ Performance</span><span class="pill">meta</span>';
      btn.classList.toggle('hidden',!canOpenPerformance());
      const open=(ev)=>{try{ev?.preventDefault?.();ev?.stopPropagation?.();ev?.stopImmediatePropagation?.()}catch(_){} if(!canOpenPerformance()){denyPerformanceAccess(); return false;} show(); return false;};
      btn.addEventListener('pointerdown',open,true);
      btn.addEventListener('click',open,true);
      btn.onclick=open;
    }
    const today=$('navHojeCronos');
    const dash=qs('[data-view="dashboard"]',nav);
    const anchor=(today&&today.parentNode===nav)?today:((dash&&dash.parentNode===nav)?dash:null);
    if(anchor && btn.previousElementSibling!==anchor){
      anchor.insertAdjacentElement('afterend',btn);
    }else if(!btn.parentNode){
      nav.appendChild(btn);
    }
  }

  function restore(){
    const host=getMainHost();
    qsa('[data-performance-hidden="1"]',host).forEach(n=>{ if(n.id!==VIEW_ID) delete n.dataset.performanceHidden; });
  }
  function hide(){
    const v=$(VIEW_ID); if(v){v.classList.add('hidden');v.style.display='none'}
    const b=$(NAV_ID); if(b)b.classList.remove('active');
  }
  function hideOthers(){
    const host=getMainHost(); ensureView();
    qsa(':scope > *',host).forEach(n=>{
      if(n.id===VIEW_ID){n.classList.remove('hidden');n.style.display=''}
      else{n.dataset.performanceHidden='1';n.classList.add('hidden');n.style.display='none'}
    });
    const sticky=$('stickyFilters'); if(sticky){sticky.classList.add('hidden');sticky.dataset.performanceHidden='1'}
    qsa('.nav button').forEach(b=>b.classList.toggle('active',b.id===NAV_ID));
  }
  function bindRecovery(){
    if(window.__CRONOS_PERFORMANCE_RECOVERY__) return;
    window.__CRONOS_PERFORMANCE_RECOVERY__=true;
    const rec=ev=>{
      const btn=ev.target?.closest?.('.nav button');
      if(!btn || btn.id===NAV_ID) return;
      const v=$(VIEW_ID);
      const open=v&&v.style.display!=='none'&&!v.classList.contains('hidden');
      if(!open) return;
      restore(); hide();
    };
    document.addEventListener('pointerdown',rec,true);
    document.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' ')rec(ev)},true);
  }

  function addPayment(store, key, amount, iso, meta={}){
    amount=num(amount); iso=pickISO(iso);
    if(!amount || !iso) return;
    const today=todayISO();
    if(iso>today) return;
    const mk=iso.slice(0,7);
    const finalKey=String(key||`${mk}:${amount}:${meta.patient||''}:${meta.source||''}`);
    if(store.seen.has(finalKey)) return;
    store.seen.add(finalKey);
    store.months.set(mk,(store.months.get(mk)||0)+amount);
    if(!store.details.has(mk)) store.details.set(mk,[]);
    store.details.get(mk).push({amount,iso,patient:meta.patient||'Sem paciente vinculado',source:meta.source||'Recebimento'});
    if(meta.entryId) store.entriesWithDetailedPayment.add(String(meta.entryId));
    if(meta.contactId) store.contactsWithDetailedPayment.add(String(meta.contactId));
  }

  function buildPerformanceData(){
    const db=load(), a=actor();
    const store={months:new Map(),details:new Map(),seen:new Set(),entriesWithDetailedPayment:new Set(),contactsWithDetailedPayment:new Set()};
    if(!db||!a) return {series:[],current:{},previous:{},months:new Map(),details:new Map(),years:[currentYear()],selectedYear:currentYear()};
    const masterId=a.masterId;
    const entries=(db.entries||[]).filter(e=>!masterId||e.masterId===masterId);
    const contacts=(db.contacts||[]).filter(c=>!masterId||c.masterId===masterId);
    const contactById=new Map(contacts.map(c=>[String(c.id),c]));
    const entryById=new Map(entries.map(e=>[String(e.id),e]));
    const entriesByContact=new Map();
    entries.forEach(e=>{const cid=String(e.contactId||''); if(cid&&!entriesByContact.has(cid))entriesByContact.set(cid,e)});
    const patientOf=(obj,e=null)=>{
      const entry=e||entryById.get(String(obj?.entryId||obj?.id||''))||entriesByContact.get(String(obj?.contactId||''));
      const c=contactById.get(String(obj?.contactId||entry?.contactId||''));
      return c?.name||obj?.contactName||obj?.name||entry?.name||entry?.lead||'Sem paciente vinculado';
    };

    const unifiedEvents = (typeof window.buildCronosReceivedEvents === 'function')
      ? window.buildCronosReceivedEvents(db, a, { includeLegacyDueFallback:false, includeUndatedLegacyByEntryMonth:true })
      : [];

    if(unifiedEvents.length){
      unifiedEvents.forEach(ev=>{
        addPayment(store, ev.key, ev.amount || ev.value, ev.iso, {
          patient: ev.patient,
          source: ev.desc || ev.source || 'Recebimento',
          entryId: ev.entryId,
          contactId: ev.contactId
        });
      });
    }else{
      (db.payments||[]).forEach((p,idx)=>{
        const pid=String(p.entryId||'');
        const cid=String(p.contactId||'');
        const e=pid?entryById.get(pid):(cid?entriesByContact.get(cid):null);
        if(p.masterId && masterId && p.masterId!==masterId) return;
        if(!p.masterId && !e && cid && !contactById.has(cid)) return;
        const status=String(p.status||'').toUpperCase();
        if(status && status!=='PAGA' && p.paid!==true && !p.paidAt && !p.cashDate) return;
        const iso=pickISO(p.cashDate||p.date||p.paidAt||p.paymentDate);
        const amount=num(p.value??p.amount??p.valor??p.total);
        addPayment(store,`cash:${p.id||idx}:${pid}:${cid}:${iso}:${amount}`,amount,iso,{patient:patientOf(p,e),source:p.desc||p.description||'Lançamento em Recebimentos',entryId:pid||e?.id,contactId:cid||e?.contactId});
      });
    }

    const cm=currentMonthKey();
    const cy=currentYear();
    const years=[...new Set([cy, ...Array.from(store.months.keys()).map(mk=>Number(String(mk).slice(0,4))).filter(Number.isFinite)])].sort((a,b)=>b-a);
    const selectedYear=ensureSelectedYear(years);
    const selectedYearNum=Number(selectedYear);
    const selectedMonthKey=ensureSelectedMonth(selectedYearNum);
    const selectedMonthNumber=monthNumberFromKey(selectedMonthKey)||Number(cm.slice(5,7))||12;
    const currentMonthNumber=Number(cm.slice(5,7))||12;
    const visibleUntilMonth=Math.min(selectedMonthNumber,currentMonthNumber);
    let series=[];
    for(let m=1;m<=12;m++){
      const mk=monthKeyOfYear(selectedYearNum,m);
      // Na tela de Performance, o histórico acompanha o mês analisado.
      // Ex.: escolhendo maio, junho-dezembro ficam em espera para não desenhar uma queda falsa para R$ 0,00.
      const isFuture=selectedYearNum>cy || (selectedYearNum===cy && m>currentMonthNumber) || m>visibleUntilMonth;
      const value=isFuture ? 0 : (store.months.get(mk)||0);
      const previous=series.length?series[series.length-1].value:null;
      const diff=(isFuture||previous==null)?0:value-previous;
      const pct=(!isFuture&&previous&&previous>0)?(diff/previous)*100:(!isFuture&&previous===0&&value>0?100:0);
      series.push({monthKey:mk,label:monthLabel(mk,true).replace(/\s+\d{4}$/,''),fullLabel:monthLabel(mk),value,diff,pct,isFuture,isSelected:mk===selectedMonthKey});
    }
    const pm=prevMonthKey(selectedMonthKey);
    const selectedIsFuture=selectedYearNum>cy || (selectedYearNum===cy && selectedMonthNumber>currentMonthNumber);
    const current={monthKey:selectedMonthKey,value:selectedIsFuture?0:(store.months.get(selectedMonthKey)||0),label:monthLabel(selectedMonthKey,true),fullLabel:monthLabel(selectedMonthKey),isFuture:selectedIsFuture};
    const previous={monthKey:pm,value:store.months.get(pm)||0,label:monthLabel(pm,true),fullLabel:monthLabel(pm)};
    return {series,current,analysis:current,previous,months:store.months,details:store.details,years,selectedYear,selectedMonthKey};
  }

  function chartPointLabel(p, series, i){
    const prev = i > 0 ? series[i-1] : null;
    const base = p.isFuture ? "Aguardando lançamento" : money(p.value);
    if(p.isFuture) return `${p.fullLabel || p.label}: ${base}`;
    if(!prev || prev.isFuture) return `${p.fullLabel || p.label}: ${base} • mês base`;
    const diff = num(p.value) - num(prev.value);
    const pct = prev.value > 0 ? (diff / prev.value) * 100 : (p.value > 0 ? 100 : 0);
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
    const pctText = diff === 0 ? "0,0%" : `${sign}${Math.abs(pct).toFixed(1).replace(".", ",")}%`;
    const diffText = diff === 0 ? "Empate" : `${sign}${money(Math.abs(diff))}`;
    return `${p.fullLabel || p.label}: ${base} • ${diffText} vs mês anterior (${pctText})`;
  }

  function ensureChartTooltip(){
    let tip = document.getElementById("perfChartTooltip");
    if(tip) return tip;
    tip = document.createElement("div");
    tip.id = "perfChartTooltip";
    tip.className = "perfChartTooltip hidden";
    document.body.appendChild(tip);
    return tip;
  }

  function drawChart(canvas, series){
    if(!canvas) return;
    const rect=canvas.getBoundingClientRect();
    const dpr=window.devicePixelRatio||1;
    const w=Math.max(320,rect.width||700), h=Math.max(240,rect.height||300);
    canvas.width=Math.floor(w*dpr); canvas.height=Math.floor(h*dpr);
    const ctx=canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
    const css=getComputedStyle(document.documentElement);
    const text=css.getPropertyValue('--text').trim()||'#e8eef6';
    const muted=css.getPropertyValue('--muted').trim()||'#a9b4c2';
    const line=css.getPropertyValue('--line').trim()||'rgba(255,255,255,.12)';
    const ok=css.getPropertyValue('--ok').trim()||'#2ee6a6';
    const brand=css.getPropertyValue('--brand').trim()||'#1677ff';
    const warn=css.getPropertyValue('--warn').trim()||'#ffcc00';
    const allSeries=Array.isArray(series)?series:[];
    const drawable=allSeries.filter(x=>!x.isFuture);
    const vals=drawable.map(x=>num(x.value));
    const max=Math.max(1,...vals)*1.12;
    const padL=64,padR=20,padT=26,padB=52;
    const cw=w-padL-padR,ch=h-padT-padB;
    ctx.font='12px system-ui, -apple-system, Segoe UI, Arial';
    ctx.strokeStyle=line; ctx.lineWidth=1;
    ctx.beginPath();
    for(let i=0;i<=4;i++){const y=padT+ch-(ch*i/4);ctx.moveTo(padL,y);ctx.lineTo(w-padR,y)}
    ctx.stroke();
    ctx.fillStyle=muted;
    ctx.textAlign='right'; ctx.textBaseline='middle';
    for(let i=0;i<=4;i++){const v=max*i/4;const y=padT+ch-(ch*i/4);ctx.fillText(v>=1000?`${Math.round(v/1000)}k`:String(Math.round(v)),padL-8,y)}
    const len=allSeries.length||12;
    const xAtIndex=i=> len===1 ? padL+cw/2 : padL+(cw*i/(len-1));
    const yAt=v=> padT+ch-(num(v)/max)*ch;
    ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle=muted;
    allSeries.forEach((p,i)=>{ctx.fillText(p.label,xAtIndex(i),padT+ch+12)});
    if(!drawable.length){ctx.textAlign='center';ctx.fillText('Sem dados para este ano ainda. Os meses já estão esperando o Cronos trabalhar.',w/2,h/2);return}
    const grad=ctx.createLinearGradient(padL,0,w-padR,0);grad.addColorStop(0,brand);grad.addColorStop(.55,warn);grad.addColorStop(1,ok);
    ctx.strokeStyle=grad;ctx.lineWidth=3;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();
    let started=false;
    allSeries.forEach((p,i)=>{
      if(p.isFuture) return;
      const x=xAtIndex(i),y=yAt(p.value);
      if(!started){ctx.moveTo(x,y); started=true;} else ctx.lineTo(x,y);
    });
    ctx.stroke();

    const points=[];
    allSeries.forEach((p,i)=>{
      const x=xAtIndex(i);
      const y=p.isFuture ? null : yAt(p.value);
      if(!p.isFuture){
        ctx.beginPath();ctx.fillStyle=p.isSelected?warn:(p.diff<0?'#ef4444':(p.diff>0?ok:brand));ctx.arc(x,y,p.isSelected?5.6:4.2,0,Math.PI*2);ctx.fill();ctx.strokeStyle=p.isSelected?text:'rgba(0,0,0,.25)';ctx.lineWidth=p.isSelected?2:1;ctx.stroke();
      }else{
        ctx.beginPath();ctx.fillStyle='rgba(148,163,184,.55)';ctx.arc(x,padT+ch,3.2,0,Math.PI*2);ctx.fill();
      }
      points.push({x,y:y ?? (padT+ch), rawY:y, p, i});
    });

    const last=drawable[drawable.length-1];
    if(last){ctx.textAlign='right';ctx.textBaseline='top';ctx.fillStyle=text;ctx.font='700 13px system-ui, -apple-system, Segoe UI, Arial';ctx.fillText(`${last.fullLabel}: ${money(last.value)}`,w-padR,padT-18)}

    canvas.__cronosPerfChartPoints = points;
    canvas.__cronosPerfChartSeries = allSeries;

    if(canvas.__cronosPerfTooltipBound !== true){
      canvas.__cronosPerfTooltipBound = true;
      const tip = ensureChartTooltip();

      const hide = ()=>{
        tip.classList.add("hidden");
        canvas.style.cursor = "";
      };

      canvas.addEventListener("mouseleave", hide);
      canvas.addEventListener("blur", hide);

      canvas.addEventListener("mousemove", (ev)=>{
        const pts = canvas.__cronosPerfChartPoints || [];
        if(!pts.length) return hide();
        const r = canvas.getBoundingClientRect();
        const mx = ev.clientX - r.left;
        const my = ev.clientY - r.top;

        let best = null;
        pts.forEach(pt=>{
          const dx = Math.abs(mx - pt.x);
          const dy = Math.abs(my - pt.y);
          const score = dx + dy * 0.25;
          if(!best || score < best.score) best = {...pt, dx, dy, score};
        });

        if(!best || best.dx > Math.max(28, r.width / 26)) return hide();

        const p = best.p || {};
        const seriesNow = canvas.__cronosPerfChartSeries || [];
        const prev = best.i > 0 ? seriesNow[best.i-1] : null;
        const isFuture = !!p.isFuture;
        const diff = (!isFuture && prev && !prev.isFuture) ? num(p.value) - num(prev.value) : null;
        const pct = (!isFuture && prev && !prev.isFuture && prev.value > 0) ? (diff / prev.value) * 100 : null;

        tip.innerHTML = `
          <div class="perfTipTitle">${esc(p.fullLabel || p.label || "Mês")}</div>
          <div class="perfTipRow"><span>Recebido</span><b>${isFuture ? "Aguardando" : money(p.value)}</b></div>
          ${prev && !isFuture ? `<div class="perfTipRow"><span>Mês anterior</span><b>${money(prev.value)}</b></div>` : ""}
          ${diff !== null ? `<div class="perfTipRow"><span>Variação</span><b class="${diff>0?'perfUp':diff<0?'perfDown':'perfFlat'}">${diff>0?'+':diff<0?'-':''}${money(Math.abs(diff))}${pct!==null?` (${pct>0?'+':''}${pct.toFixed(1).replace('.',',')}%)`:''}</b></div>` : ""}
          <div class="perfTipHint">${chartPointLabel(p, seriesNow, best.i)}</div>
        `;

        tip.classList.remove("hidden");
        canvas.style.cursor = "crosshair";

        const pad = 14;
        let left = ev.clientX + 14;
        let top = ev.clientY + 14;
        const tw = tip.offsetWidth || 260;
        const th = tip.offsetHeight || 130;
        if(left + tw + pad > window.innerWidth) left = ev.clientX - tw - 14;
        if(top + th + pad > window.innerHeight) top = ev.clientY - th - 14;
        tip.style.left = `${Math.max(pad, left)}px`;
        tip.style.top = `${Math.max(pad, top)}px`;
      });
    }
  }


  function monthStatusLabel(current, previous, projection){
    current=num(current); previous=num(previous); projection=num(projection);
    if(previous<=0 && current>0) return {label:'Mês abriu vantagem', tone:'var(--ok)', kind:'up'};
    if(current>=previous && previous>0) return {label:'Base superada', tone:'var(--ok)', kind:'up'};
    if(projection>=previous && previous>0) return {label:'Projeção positiva', tone:'var(--accent)', kind:'trend'};
    if(previous>0 && current<previous) return {label:'Abaixo da base', tone:'var(--danger)', kind:'down'};
    return {label:'Aguardando dados', tone:'var(--muted)', kind:'flat'};
  }

  function performanceReading(current, previous, projection, avgCurrent, dailyNeeded, selectedLabel, previousLabel){
    current=num(current); previous=num(previous); projection=num(projection); avgCurrent=num(avgCurrent); dailyNeeded=num(dailyNeeded);
    if(previous<=0 && current<=0) return 'Ainda não há base suficiente para leitura. Assim que houver recebimentos, o Cronos começa a comparar o ritmo do mês.';
    if(previous<=0 && current>0) return `${selectedLabel} já tem recebimentos registrados e criou uma base nova para acompanhar crescimento nos próximos meses.`;
    if(current>=previous) return `${selectedLabel} já superou ${previousLabel}. Agora a leitura principal é manter o ritmo sem depender de achismo no fechamento.`;
    if(projection>=previous) return `${selectedLabel} ainda está abaixo no acumulado, mas a média diária atual projeta superação até o fim do mês.`;
    if(avgCurrent>0 && dailyNeeded>avgCurrent) return `${selectedLabel} precisa acelerar: a média necessária por dia ainda está acima do ritmo atual da clínica.`;
    return `${selectedLabel} está abaixo da base. Use a tabela mensal para entender se foi queda pontual ou tendência.`;
  }

  function statusText(progress, current, previous, projection, dailyNeeded, remainingDays){
    if(previous<=0 && current<=0) return 'Ainda não há base no mês anterior. Assim que houver recebimentos registrados, a Performance começa a medir o desafio automaticamente.';
    if(previous<=0 && current>0) return `O mês anterior estava zerado. O mês analisado já abriu vantagem com ${money(current)} registrados.`;
    if(current>=previous) return `Mês anterior superado. Cada fechamento acima da base mostra que a operação está evoluindo — crescimento real, não achismo em planilha.`;
    if(projection>=previous) return `Se o ritmo atual continuar, o mês analisado deve superar a base anterior.`;
    if(remainingDays>0) return `Para superar o mês anterior, falta uma média de ${money(dailyNeeded)} por dia até o fim do mês. Não é julgamento; é bússola.`;
    return 'O mês fechou abaixo do anterior, mas isso vira referência para entender o ritmo e ajustar o próximo ciclo.';
  }

  function gradientSizeForProgress(p){
    const pct=Math.min(100,Math.max(.01,num(p)));
    return `${(10000/pct).toFixed(2)}% 100%`;
  }

  function miniProgressHtml(progress,label=''){
    const pct=Math.min(100,Math.max(0,num(progress)));
    const bg=gradientSizeForProgress(pct||.01);
    return `<div class="perfMini" title="${esc(label||`${pct.toFixed(1).replace('.',',')}% do mês anterior`)}"><div class="perfMiniFill" style="width:${pct}%;background-size:${bg}"></div></div><span class="perfMiniText">${pct.toFixed(1).replace('.',',')}%</span>`;
  }

  function render(){
    css(); const v=ensureView(); const data=buildPerformanceData(); const series=data.series||[];
    const selectedYear=data.selectedYear||currentYear();
    const years=Array.isArray(data.years)&&data.years.length?data.years:[currentYear()];
    const historicalSeries=series.filter(x=>!x.isFuture);
    const current=data.analysis||data.current||{value:0,monthKey:currentMonthKey(),fullLabel:monthLabel(currentMonthKey())};
    const selectedMonthKey=data.selectedMonthKey||current.monthKey||currentMonthKey();
    const previous=data.previous||{value:0,monthKey:prevMonthKey(selectedMonthKey),fullLabel:monthLabel(prevMonthKey(selectedMonthKey))};
    const today=todayISO(); const cm=currentMonthKey();
    const analysisIsCurrent=selectedMonthKey===cm;
    const analysisIsFuture=String(selectedMonthKey)>String(cm);
    const dim=daysInMonth(selectedMonthKey);
    const day=analysisIsCurrent?(Number(today.slice(8,10))||1):(analysisIsFuture?0:dim);
    const remaining=analysisIsCurrent?Math.max(0,dim-day):0;
    const progress=previous.value>0?(current.value/previous.value)*100:(current.value>0?100:0);
    const missing=Math.max(0,previous.value-current.value);
    const dailyNeeded=remaining>0?missing/remaining:missing;
    const projection=analysisIsCurrent?(day>0?(current.value/day)*dim:current.value):current.value;
    const diff=current.value-previous.value;
    const best=historicalSeries.reduce((b,x)=>x.value>(b?.value??-1)?x:b,null);
    const growths=historicalSeries.slice(1).map(x=>x.diff);
    const monthsUp=growths.filter(x=>x>0).length, monthsDown=growths.filter(x=>x<0).length;
    const progressWidth=Math.min(100,Math.max(0,progress));
    const progressGradientSize=gradientSizeForProgress(progressWidth||.01);
    const prevByMonth=new Map(series.map((x,i)=>[x.monthKey,i>0?series[i-1]:null]));
    const diffClass=diff>0?'perfUp':(diff<0?'perfDown':'perfFlat');
    const diffLabel=diff>0?`+${money(diff)}`:(diff<0?`-${money(Math.abs(diff))}`:'Empate');
    const rows=series.slice();
    const periodStateLabel=analysisIsFuture?'aguardando lançamento':(analysisIsCurrent?'até hoje':'mês fechado');
    const projectionTitle=analysisIsCurrent?'Projeção':'Resultado final';
    const projectionSmall=analysisIsCurrent?'Se o ritmo atual continuar até o fim do mês.':'Valor fechado no mês selecionado.';
    const missingSmall=analysisIsCurrent?`${remaining} dia(s) restante(s).`:(missing>0?'Foi o valor que faltou para virar o mês.':'Meta mensal batida.');
    const supportTitle=analysisIsCurrent?'Média diária necessária':'Saldo final vs base';
    const supportValue=analysisIsCurrent?money(dailyNeeded):diffLabel;
    const supportSmall=analysisIsCurrent?'Até o fim do mês.':(diff>=0?'O mês fechou acima da base.':'O mês fechou abaixo da base.');
    const avgCurrent = day>0 ? current.value/day : 0;
    const avgReference = analysisIsCurrent ? avgCurrent : (dim>0 ? current.value/dim : 0);
    const monthStatus = monthStatusLabel(current.value, previous.value, projection);
    const readingText = performanceReading(current.value, previous.value, projection, avgReference, dailyNeeded, monthLabel(selectedMonthKey), monthLabel(previous.monthKey));
    const missingTitle = diff>=0 ? 'Acima da base' : 'Falta para superar';
    const missingValue = diff>=0 ? `+${money(Math.abs(diff))}` : money(missing);
    const missingSmallLabel = diff>=0 ? 'Em relação ao mês anterior.' : 'Ainda falta para bater a base anterior.';
    const projectionLabel = analysisIsCurrent ? 'Projeção até o fim do mês' : 'Resultado final';
    v.innerHTML=`
      <div class="perfWrap">
        <div class="perfHero">
          <div>
            <h2>Performance</h2>
            <p>Comparativo mensal com desafio de crescimento. Escolha o mês para mostrar a tela com o desempenho daquele período; o histórico continua exibindo janeiro a dezembro.</p>
          </div>
          <div class="perfActions"><label class="perfYearControl">Ano <select class="perfSelect" onchange="CRONOS_PERFORMANCE.setYear(this.value)">${years.map(y=>`<option value="${y}" ${Number(y)===Number(selectedYear)?'selected':''}>${y}</option>`).join('')}</select></label><label class="perfYearControl">Mês <select class="perfSelect" onchange="CRONOS_PERFORMANCE.setMonth(this.value)">${monthOptionsHtml(selectedYear,selectedMonthKey)}</select></label><button class="perfBtn" onclick="CRONOS_PERFORMANCE.refresh(this)">Atualizar</button></div>
        </div>
        <div class="perfGrid">
          <div class="perfCard perfKpi"><span class="muted">Base anterior</span><b>${money(previous.value)}</b><small>${esc(previous.fullLabel||monthLabel(previous.monthKey))} é a referência do desafio.</small></div>
          <div class="perfCard perfKpi"><span class="muted">Recebido no mês</span><b>${money(current.value)}</b><small>${esc(current.fullLabel||monthLabel(current.monthKey))} • ${periodStateLabel}.</small></div>
          <div class="perfCard perfKpi isMissing"><span class="muted">${missingTitle}</span><b class="${diffClass}">${missingValue}</b><small>${missingSmallLabel}</small></div>
          <div class="perfCard perfKpi isProjection"><span class="muted">${projectionLabel}</span><b>${money(projection)}</b><small>${projectionSmall}</small></div>
        </div>
        <div class="perfMain">
          <div class="perfCard perfStatusCard" style="--status-color:${monthStatus.tone}">
            <div class="perfStatusBadge">● ${monthStatus.label}</div>
            <div class="perfProgressTop"><div><h3>Desafio do mês</h3><div class="muted" style="font-size:12px">${esc(monthLabel(selectedMonthKey))} tentando superar ${esc(monthLabel(previous.monthKey))}</div></div><b>${progress.toFixed(1).replace('.',',')}%</b></div>
            <div class="perfBar" title="${esc(progress.toFixed(1).replace('.',','))}% do mês anterior alcançado"><div class="perfBarFill" style="width:${progressWidth}%;background-size:${progressGradientSize}"></div>${progress>100?`<div class="perfBarOver">+${(progress-100).toFixed(1).replace('.',',')}%</div>`:''}</div>
            <div class="perfInsight perfRead"><div class="perfReadHead"><span class="perfReadIcon">${perfIconSvg("reading")}</span>Leitura do Cronos</div><p>${esc(readingText)}</p></div>
            <div class="perfMetricPair">
              <div class="perfMetricBox"><span>Média atual por dia</span><b>${money(avgReference)}</b><small>${analysisIsCurrent?'Calculada até hoje.':'Média do mês fechado.'}</small></div>
              <div class="perfMetricBox"><span>${supportTitle}</span><b class="${analysisIsCurrent?'':diffClass}">${supportValue}</b><small>${supportSmall}</small></div>
              <div class="perfMetricBox"><span>Falta para superar</span><b>${money(missing)}</b><small>${missingSmall}</small></div>
              <div class="perfMetricBox"><span>Status comercial</span><b style="color:${monthStatus.tone}">${monthStatus.label}</b><small>Baseado no acumulado e na projeção.</small></div>
            </div>
          </div>
          <div class="perfCard">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:10px">
              <div><h3 style="margin:0">Histórico de desempenho — ${selectedYear}</h3><div class="muted" style="font-size:12px;margin-top:3px">Recebido até o mês analisado. Meses seguintes ficam em espera para evitar queda falsa no gráfico.</div></div>
              <div class="muted" style="font-size:12px">Melhor mês: <b>${best?esc(best.fullLabel):'—'}</b> • ${best?money(best.value):money(0)}</div>
            </div>
            <div class="perfChartWrap"><canvas id="perfHistoryChart" class="perfChart"></canvas></div>
            <div class="perfLegend"><span><i class="perfDot" style="--dot-color:var(--ok)"></i>Subiu</span><span><i class="perfDot" style="--dot-color:var(--danger)"></i>Caiu</span><span><i class="perfDot" style="--dot-color:var(--accent)"></i>Mês analisado</span><span><i class="perfDot" style="--dot-color:var(--muted)"></i>Em espera</span></div>
            <div class="perfTrendSummary"><span>Tendência do ano:</span><b><em class="up">↑ ${monthsUp}</em> subiram</b><span>•</span><b><em class="down">↓ ${monthsDown}</em> caíram</b></div>
          </div>
        </div>
        <div class="perfCard">
          <h3 style="margin:0 0 4px">Sobe e desce mensal</h3>
          <div class="muted" style="font-size:13px;margin-bottom:10px">Janeiro a dezembro do ano selecionado. O mês analisado fica destacado e o cabeçalho acompanha a rolagem para não virar caça-palavra financeiro.</div>
          ${rows.length?`<div class="perfTableScroll"><table class="perfTable"><thead><tr><th>Mês</th><th class="right">Recebido</th><th class="right">Termômetro</th><th class="right">Variação</th><th class="center">Status</th></tr></thead><tbody>${rows.map((x,idx)=>{
            const baseIndex=series.findIndex(s=>s.monthKey===x.monthKey);
            const first = baseIndex===0;
            const future=!!x.isFuture;
            const prev=prevByMonth.get(x.monthKey);
            const monthProgress=first?0:(prev?.value>0?(x.value/prev.value)*100:(x.value>0?100:0));
            const cls=future?'perfFlat':(first?'perfFlat':(x.diff>0?'perfUp':(x.diff<0?'perfDown':'perfFlat')));
            const label=future?'Aguardando':(first?'Base':(x.diff>0?'Subiu':(x.diff<0?'Caiu':'Manteve')));
            const delta=future?'—':(first?'—':`${x.diff>0?'+':x.diff<0?'-':''}${money(Math.abs(x.diff))}${x.pct?` (${x.pct>0?'+':''}${x.pct.toFixed(1).replace('.',',')}%)`:''}`);
            const bar=future?'<span class="perfFlat">Aguardando</span>':(first?'<span class="perfFlat">Base</span>':miniProgressHtml(monthProgress,`${x.fullLabel} alcançou ${monthProgress.toFixed(1).replace('.',',')}% do mês anterior`));
            return `<tr class="${x.isSelected?'perfSelectedRow':''}"><td><b>${esc(x.fullLabel)}</b></td><td class="right mono">${future?'—':money(x.value)}</td><td class="right">${bar}</td><td class="right ${cls}">${delta}</td><td class="center ${cls}">${label}</td></tr>`;
          }).join('')}</tbody></table></div>`:`<div class="perfEmpty">Ainda não há recebimentos suficientes para montar o histórico de Performance.</div>`}
        </div>
      </div>`;
    setTimeout(()=>drawChart($('perfHistoryChart'),series),30);
    requestAnimationFrame(()=>drawChart($('perfHistoryChart'),series));
  }

  async function refresh(btn){
    if(btn){
      btn.classList.add('loading');
      btn.disabled=true;
      btn.innerHTML='<span class="perfSpin"></span>Atualizando';
    }
    try{
      if(typeof window.refreshCloudDataNow==='function'){
        await window.refreshCloudDataNow({ force:true, reason:'performance_button' });
      }else{
        await sleep(420);
      }
      await sleep(260);
      render();
      toast('Performance atualizada','Dados recalculados.');
    }catch(err){
      console.error('[Performance] Falha ao atualizar:',err);
      toast('Falha ao atualizar','Não foi possível recalcular a Performance agora.');
      if(btn){
        btn.classList.remove('loading');
        btn.disabled=false;
        btn.innerHTML='Atualizar';
      }
    }
  }

  function show(){
    if(!canOpenPerformance()){
      denyPerformanceAccess();
      return;
    }
    css();ensureView();ensureNav();bindRecovery();hideOthers();render();setTimeout(()=>{try{window.scrollTo({top:0,left:0,behavior:'auto'})}catch(_){ }},0)
  }

  function setYear(year){
    const y=Number(year);
    if(Number.isFinite(y)){
      const keepMonth=monthNumberFromKey(STATE.selectedMonth)||monthNumberFromKey(currentMonthKey())||1;
      STATE.selectedYear=y;
      STATE.selectedMonth=monthKeyOfYear(y,keepMonth);
      ensureSelectedMonth(y);
      render();
    }
  }

  function setMonth(monthKey){
    const mk=String(monthKey||currentMonthKey()).slice(0,7);
    if(/^\d{4}-\d{2}$/.test(mk)){
      STATE.selectedMonth=mk;
      const y=Number(mk.slice(0,4));
      if(Number.isFinite(y)) STATE.selectedYear=y;
      render();
    }
  }

  function redrawIfOpen(){
    const v=$(VIEW_ID); if(v&&v.style.display!=='none'&&!v.classList.contains('hidden')) render();
  }

  async function boot(){
    for(let i=0;i<80;i++){if(document.body&&hasCronos())break;await sleep(150)}
    css();ensureView();ensureNav();bindRecovery();restore();hide();
    setInterval(()=>{try{ensureNav(); if($(VIEW_ID)&&!$(VIEW_ID).classList.contains('hidden')) render();}catch(_){}},9000);
    try{
      const obs=new MutationObserver(()=>setTimeout(redrawIfOpen,60));
      obs.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
    }catch(_){}
  }

  window.CRONOS_PERFORMANCE={show,render,refresh,setYear,setMonth,redraw:redrawIfOpen};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot); else boot();
})();
