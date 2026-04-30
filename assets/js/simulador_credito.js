/* =========================================================
   Simulador de crédito e análise de risco
   ========================================================= */
(function(){
  const BOOT='__CRONOS_CREDITO_BOOTED__';
  if(window[BOOT]) return;
  window[BOOT]=true;
  window.CRONOS_CREDITO_VERSION='public';

  const VIEW_ID='view-creditSimulator';
  const NAV_ID='navCreditoSimulator';
  const STYLE_ID='cronosCreditoStyle';

  const $=id=>document.getElementById(id);
  const qs=(s,r=document)=>r.querySelector(s);
  const qsa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  const RISK_DEFAULT_INPUTS={
    total:'',entry:'',entryPct:'',financed:'',rate:'',months:'',payment:'',income:'',doc:'basic',
    delays:'',maxDelay:'',noShows:'',reneg:'',completed:'',contracts:'',historyNote:''
  };
  const S=window.__CRONOS_CREDITO_STATE__||{
    mode:'free',
    search:'',
    entryId:'',
    planKey:'',
    inputs:{total:'',entry:'',entryPct:'',entryMode:'entry',pv:'',n:'',rp:'',P:''},
    result:null,
    error:'',
    risk:{inputs:{...RISK_DEFAULT_INPUTS},result:null,error:'',source:'manual',snapshot:null,dirty:false,animating:false}
  };
  S.inputs={total:'',entry:'',entryPct:'',entryMode:'entry',pv:'',n:'',rp:'',P:'',...(S.inputs||{})};
  if(!S.inputs.total && S.inputs.pv) S.inputs.total=S.inputs.pv;
  if(!S.inputs.entry) S.inputs.entry='';
  if(!S.inputs.entryPct) S.inputs.entryPct='';
  S.risk=S.risk||{inputs:{},result:null,error:'',source:'manual',snapshot:null,dirty:false,animating:false};
  S.risk.inputs={...RISK_DEFAULT_INPUTS,...(S.risk.inputs||{})};
  window.__CRONOS_CREDITO_STATE__=S;

  function hasCronos(){return typeof window.loadDB==='function'&&typeof window.currentActor==='function'}
  function load(){try{return window.loadDB()}catch(_){return null}}
  function actor(){try{return window.currentActor()}catch(_){return null}}
  function toast(t,m=''){try{if(typeof window.toast==='function')return window.toast(t,m)}catch(_){} console.log('[Simulador]',t,m)}
  function canOpenCredit(){
    try{return !window.CRONOS_CAN_ACCESS_MODULE || window.CRONOS_CAN_ACCESS_MODULE('creditSimulator')}catch(_){return true}
  }
  function denyCreditAccess(){toast('Acesso restrito','Seu nível de acesso não permite abrir o Simulador.')}
  function esc(v){try{if(typeof window.escapeHTML==='function')return window.escapeHTML(v)}catch(_){} return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function money(v){try{if(typeof window.moneyBR==='function')return window.moneyBR(v)}catch(_){} return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
  function fmt(iso){try{if(typeof window.fmtBR==='function')return window.fmtBR(iso)}catch(_){} const s=String(iso||'').slice(0,10),p=s.split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:s}
  function today(){try{if(typeof window.todayISO==='function')return window.todayISO()}catch(_){} return new Date().toISOString().slice(0,10)}
  function parse(v){
    let s=String(v??'').trim();
    if(!s)return null;
    s=s.replace(/\s/g,'').replace(/R\$/gi,'').replace(/%/g,'');
    if(s.includes(',')){
      s=s.replace(/\./g,'').replace(',','.');
    }else{
      const dotCount=(s.match(/\./g)||[]).length;
      if(dotCount>1) s=s.replace(/\./g,'');
    }
    s=s.replace(/[^0-9.\-]/g,'');
    const n=Number(s);
    return Number.isFinite(n)?n:null;
  }
  function parseRate(v){
    let s=String(v??'').trim();
    if(!s)return null;
    s=s.replace(/\s/g,'').replace(/%/g,'');
    if(s.includes(',')){
      s=s.replace(/\./g,'').replace(',','.');
    }
    s=s.replace(/[^0-9.\-]/g,'');
    const n=Number(s);
    return Number.isFinite(n)?n:null;
  }
  function norm(s){
    return String(s||'')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .trim();
  }
  function brnum(v,d=2){return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d})}
  function docLabel(v){return ({complete:'Completo',basic:'Básico',incomplete:'Incompleto',none:'Não informado'})[String(v||'basic')]||'Básico'}
  function phone(v){return String(v||'').replace(/\D/g,'')}
  function mainHost(){return qs('main.main')||qs('.main')||document.body}

  function css(){
    const oldStyle=$(STYLE_ID);
    if(oldStyle) oldStyle.remove();
    const st=document.createElement('style');
    st.id=STYLE_ID;
    st.textContent=`
      #${VIEW_ID}{padding:18px;width:100%;box-sizing:border-box;min-height:72vh;color:var(--text,#eef2ff)}
      #${VIEW_ID},#${VIEW_ID}*{box-sizing:border-box}
      .credWrap{display:grid;gap:16px}
      .credHero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:start;padding:16px 18px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(135deg,rgba(124,92,255,.13),rgba(255,255,255,.025)),var(--panel2,#151a28);box-shadow:var(--shadow)}
      .credHero h2{margin:0 0 7px;font-size:24px}.credHero p{margin:0;color:var(--muted,#a8b3c7);line-height:1.45;max-width:780px}
      .credHero .credBtn{align-self:start;white-space:nowrap}

      .credRefreshBtn{display:inline-flex;align-items:center;justify-content:center;gap:8px}
      .credRefreshSpinner{display:none;width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:999px;animation:credSpin .75s linear infinite}
      .credRefreshBtn.loading .credRefreshSpinner{display:inline-block}
      .credRefreshBtn:not(.loading) .credRefreshSpinner{display:none!important}
      .credRefreshBtn.loading{pointer-events:none;opacity:.92}
      @keyframes credSpin{to{transform:rotate(360deg)}}
}
      .credGrid{display:grid!important;grid-template-columns:minmax(280px,0.82fr) minmax(460px,1.18fr)!important;gap:16px!important;align-items:start!important}
      .credCard{border:1px solid var(--line);border-radius:18px;background:var(--panel2,#151a28);padding:16px;box-shadow:var(--shadow)}
      .credCard h3{margin:0 0 12px;font-size:18px}
      .credMuted{color:var(--muted,#a8b3c7);font-size:13px}
      .credMode{display:flex;gap:8px;flex-wrap:wrap}.credMode button,.credBtn{border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.06);color:inherit;padding:10px 13px;font-weight:800;cursor:pointer}
      .credMode button.active,.credBtn.primary{background:linear-gradient(135deg,rgba(124,92,255,.32),rgba(75,127,255,.22));border-color:rgba(124,92,255,.8)}
      .credBtn.ok{background:rgba(45,212,191,.16);border-color:rgba(45,212,191,.45)}.credBtn.danger{background:rgba(239,68,68,.13);border-color:rgba(239,68,68,.36)}
      .credForm{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .credForm label{display:block;font-weight:800;font-size:13px;margin-bottom:6px}
      .credForm input,.credCard input{width:100%;border:1px solid var(--line);background:rgba(255,255,255,.06);color:inherit;border-radius:12px;padding:12px;font-size:15px;outline:none}
       .credForm input[readonly]{opacity:.82;cursor:not-allowed;background:rgba(255,255,255,.035)}
      #${VIEW_ID} .credEntryPctGroup label{display:block!important}
      #${VIEW_ID} .credEntryPctInline{display:grid!important;grid-template-columns:minmax(0,1fr) 94px!important;gap:10px!important;align-items:center!important}
      #${VIEW_ID} #credEntryPct{opacity:1!important;text-align:center!important;font-weight:900!important;letter-spacing:-.01em!important;color:#dbeafe!important;-webkit-text-fill-color:#dbeafe!important;background:rgba(96,165,250,.10)!important;border-color:rgba(147,197,253,.22)!important;cursor:text!important}
      :root.light #${VIEW_ID} #credEntryPct,html.light #${VIEW_ID} #credEntryPct,body.light #${VIEW_ID} #credEntryPct{opacity:1!important;color:#0f172a!important;-webkit-text-fill-color:#0f172a!important;background:rgba(37,99,235,.12)!important;border-color:rgba(37,99,235,.30)!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.65)!important}
      #${VIEW_ID} .credEntryPctBadge{display:none!important}
      @media(max-width:720px){#${VIEW_ID} .credEntryPctInline{grid-template-columns:1fr!important}#${VIEW_ID} #credEntryPct{text-align:left!important}}
      .credActions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .credAlert{border:1px solid rgba(251,146,60,.5);background:rgba(251,146,60,.12);border-radius:14px;padding:12px;line-height:1.45}
      .credSuccess{border:1px solid rgba(45,212,191,.42);background:rgba(45,212,191,.10);border-radius:14px;padding:12px;margin-top:12px}
      .credResult{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px}
      .credBox{border:1px solid var(--line);border-radius:12px;padding:12px;background:rgba(0,0,0,.10)}
      .credBox b{display:block;margin-top:5px;font-size:18px}
      .credSummary{white-space:pre-wrap;border-top:1px solid var(--line);margin-top:14px;padding-top:12px;line-height:1.45}
      .credSelected,.credSuggestion,.credPlan{width:100%;text-align:left;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.05);color:inherit;padding:12px;cursor:pointer}
      .credSelected{display:flex;justify-content:space-between;gap:12px;align-items:center}
      .credSuggestions,.credPlanList{display:grid;gap:8px;margin-top:12px}
      .credPlan.active{border-color:rgba(124,92,255,.9);background:rgba(124,92,255,.13)}
      .credPlanTop{display:flex;justify-content:space-between;gap:12px}
      .credPills{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
      .credPill{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:5px 8px;color:var(--muted,#a8b3c7)}
      .credHistory{margin-top:0}
      .credHistItem{display:flex;justify-content:space-between;gap:12px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:12px;margin-top:10px;flex-wrap:wrap}
      .credHistItem .credActions{margin-top:0}
      .riskPanel{overflow:hidden;position:relative}
      .riskHead{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap;margin-bottom:14px}
      .riskHead h3{margin:0 0 6px;font-size:19px}.riskHead p{margin:0;color:var(--muted,#a8b3c7);line-height:1.45;max-width:760px}

      .riskHead .credBtn{background:linear-gradient(135deg,rgba(124,92,255,.36),rgba(75,127,255,.24));border-color:rgba(124,92,255,.75);box-shadow:0 10px 22px rgba(75,127,255,.12)}
      .riskHead .credBtn:hover{filter:brightness(1.05);transform:translateY(-1px)}


      .riskHead .credBtn{background:linear-gradient(135deg,#2563eb,#06b6d4);border-color:rgba(37,99,235,.78);color:#fff;box-shadow:0 12px 24px rgba(37,99,235,.18), inset 0 0 0 1px rgba(255,255,255,.16)}
      .riskGrid{display:grid;grid-template-columns:minmax(310px,.92fr) minmax(360px,1fr);gap:16px;align-items:start}
      .riskSubgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .riskSubgrid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
      .riskSubgrid label{display:block;font-weight:800;font-size:12px;margin-bottom:5px;color:var(--muted,#a8b3c7)}
      .riskSubgrid input,.riskSubgrid select{width:100%;border:1px solid var(--line);background:rgba(255,255,255,.06);color:inherit;border-radius:12px;padding:10px 11px;font-size:14px;outline:none}
      .riskSubgrid input[readonly]{opacity:.78;cursor:not-allowed;background:rgba(255,255,255,.035)}
      .riskBlock{border:1px solid var(--line);border-radius:16px;padding:13px;background:rgba(255,255,255,.035);display:grid;gap:12px}
      .riskBlockTitle{display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:900}
      .riskMini{font-size:12px;color:var(--muted,#a8b3c7);line-height:1.45}
      .riskDirty{border:1px solid rgba(251,191,36,.55);background:rgba(251,191,36,.12);border-radius:14px;padding:10px 12px;line-height:1.45;margin-bottom:12px}
      .riskResult{border:1px solid var(--line);border-radius:18px;padding:16px;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));min-height:390px;display:grid;gap:14px}
      .riskEmpty{min-height:320px;display:grid;place-items:center;text-align:center;color:var(--muted,#a8b3c7);border:1px dashed var(--line);border-radius:18px;padding:20px;background:rgba(255,255,255,.025)}
      .riskDonutWrap{display:flex;align-items:center;justify-content:center;gap:18px;flex-wrap:wrap}
      .riskDonut{--p:0;position:relative;width:168px;height:168px;border-radius:999px;background:rgba(148,163,184,.16);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
      .riskDonut::before{content:"";position:absolute;inset:0;border-radius:inherit;background:conic-gradient(from -90deg,#ef4444 0deg,#f97316 90deg,#facc15 185deg,#22c55e 285deg,#38bdf8 360deg);-webkit-mask:conic-gradient(#000 calc(var(--p)*1%),transparent 0);mask:conic-gradient(#000 calc(var(--p)*1%),transparent 0)}
      .riskDonut::after{content:"";position:absolute;inset:18px;border-radius:inherit;background:var(--panel2,#151a28);border:1px solid var(--line)}
      .riskDonutCenter{position:absolute;inset:30px;display:grid;place-items:center;text-align:center;z-index:2}
      .riskScore{font-size:34px;font-weight:950;letter-spacing:-.04em;line-height:1;color:var(--text,#eef2ff)}.riskScore small{font-size:13px;color:var(--muted,#a8b3c7);display:block;font-weight:800;letter-spacing:0;margin-top:2px}
      .riskClass{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:999px;padding:7px 10px;font-size:12px;font-weight:900;background:rgba(255,255,255,.05);width:max-content}
      .riskDetails{display:grid;gap:10px}.riskFactor{border:1px solid var(--line);border-radius:13px;padding:10px 11px;background:rgba(0,0,0,.08);font-size:13px;line-height:1.35}.riskFactor.good{border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.08)}.riskFactor.bad{border-color:rgba(239,68,68,.36);background:rgba(239,68,68,.08)}
      .riskRec{border:1px solid rgba(124,92,255,.38);background:rgba(124,92,255,.10);border-radius:15px;padding:12px;line-height:1.45}
      .riskProcess{font-size:12px;color:var(--muted,#a8b3c7);min-height:18px;text-align:center}
      #${NAV_ID} .credNavIcon{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border:1.8px solid currentColor;border-radius:5px;font-size:11px;font-weight:900;line-height:1;margin-right:6px;opacity:.9}


      /* Ajustes fortes do simulador no tema claro */
      :root.light #${VIEW_ID}, html.light #${VIEW_ID}, body.light #${VIEW_ID}{color:#0f172a}
      :root.light #${VIEW_ID} .credCard,
      html.light #${VIEW_ID} .credCard,
      body.light #${VIEW_ID} .credCard{background:rgba(255,255,255,.78);border-color:rgba(15,23,42,.12);box-shadow:0 12px 30px rgba(15,23,42,.08)}
      :root.light #${VIEW_ID} .credHero,
      html.light #${VIEW_ID} .credHero,
      body.light #${VIEW_ID} .credHero{background:linear-gradient(135deg,rgba(37,99,235,.12),rgba(6,182,212,.09)),rgba(255,255,255,.78);border-color:rgba(37,99,235,.16)}
      :root.light #${VIEW_ID} .credMode button,
      :root.light #${VIEW_ID} .credBtn,
      html.light #${VIEW_ID} .credMode button,
      html.light #${VIEW_ID} .credBtn,
      body.light #${VIEW_ID} .credMode button,
      body.light #${VIEW_ID} .credBtn{
        background:linear-gradient(135deg,rgba(37,99,235,.13),rgba(6,182,212,.09));
        border-color:rgba(37,99,235,.30);
        color:#0f172a;
        box-shadow:0 6px 16px rgba(37,99,235,.08), inset 0 0 0 1px rgba(255,255,255,.55);
      }
      :root.light #${VIEW_ID} .credMode button:hover,
      :root.light #${VIEW_ID} .credBtn:hover,
      html.light #${VIEW_ID} .credMode button:hover,
      html.light #${VIEW_ID} .credBtn:hover,
      body.light #${VIEW_ID} .credMode button:hover,
      body.light #${VIEW_ID} .credBtn:hover{
        background:linear-gradient(135deg,rgba(37,99,235,.20),rgba(6,182,212,.14));
        border-color:rgba(37,99,235,.42);
        transform:translateY(-1px);
      }
      :root.light #${VIEW_ID} .credBtn:disabled,
      html.light #${VIEW_ID} .credBtn:disabled,
      body.light #${VIEW_ID} .credBtn:disabled{
        background:rgba(241,245,249,.75);
        border-color:rgba(15,23,42,.10);
        color:#94a3b8;
        box-shadow:none;
        cursor:not-allowed;
      }
      :root.light #${VIEW_ID} .credMode button.active,
      :root.light #${VIEW_ID} .credBtn.primary,
      html.light #${VIEW_ID} .credMode button.active,
      html.light #${VIEW_ID} .credBtn.primary,
      body.light #${VIEW_ID} .credMode button.active,
      body.light #${VIEW_ID} .credBtn.primary{
        background:linear-gradient(135deg,#2563eb,#06b6d4);
        border-color:rgba(37,99,235,.78);
        color:#fff;
        box-shadow:0 12px 24px rgba(37,99,235,.20), inset 0 0 0 1px rgba(255,255,255,.20);
      }
      :root.light #${VIEW_ID} .credBtn.ok,
      html.light #${VIEW_ID} .credBtn.ok,
      body.light #${VIEW_ID} .credBtn.ok{
        background:linear-gradient(135deg,rgba(20,184,166,.22),rgba(6,182,212,.14));
        border-color:rgba(20,184,166,.55);
        color:#0f172a;
      }
      :root.light #${VIEW_ID} .credForm input,
      :root.light #${VIEW_ID} .credCard input,
      :root.light #${VIEW_ID} select,
      html.light #${VIEW_ID} .credForm input,
      html.light #${VIEW_ID} .credCard input,
      html.light #${VIEW_ID} select,
      body.light #${VIEW_ID} .credForm input,
      body.light #${VIEW_ID} .credCard input,
      body.light #${VIEW_ID} select{background:rgba(255,255,255,.78);border-color:rgba(15,23,42,.14);color:#0f172a}
      :root.light #${VIEW_ID} .credForm input[readonly],
      html.light #${VIEW_ID} .credForm input[readonly],
      body.light #${VIEW_ID} .credForm input[readonly]{background:rgba(241,245,249,.82);color:#334155}
      :root.light #${VIEW_ID} .credSelected,
      :root.light #${VIEW_ID} .credSuggestion,
      :root.light #${VIEW_ID} .credPlan,
      html.light #${VIEW_ID} .credSelected,
      html.light #${VIEW_ID} .credSuggestion,
      html.light #${VIEW_ID} .credPlan,
      body.light #${VIEW_ID} .credSelected,
      body.light #${VIEW_ID} .credSuggestion,
      body.light #${VIEW_ID} .credPlan{background:rgba(255,255,255,.66);border-color:rgba(15,23,42,.13);color:#0f172a}
      :root.light #${VIEW_ID} .credPlan.active,
      html.light #${VIEW_ID} .credPlan.active,
      body.light #${VIEW_ID} .credPlan.active{background:rgba(37,99,235,.10);border-color:rgba(37,99,235,.48)}
      :root.light #${VIEW_ID} .credPill,
      html.light #${VIEW_ID} .credPill,
      body.light #${VIEW_ID} .credPill{background:rgba(255,255,255,.62);color:#334155;border-color:rgba(15,23,42,.12)}
      :root.light #${VIEW_ID} .credSuccess,
      html.light #${VIEW_ID} .credSuccess,
      body.light #${VIEW_ID} .credSuccess{background:linear-gradient(135deg,rgba(6,182,212,.20),rgba(20,184,166,.11));border-color:rgba(6,182,212,.42)}
      :root.light #${VIEW_ID} .credBox,
      html.light #${VIEW_ID} .credBox,
      body.light #${VIEW_ID} .credBox{background:rgba(255,255,255,.70);border-color:rgba(15,23,42,.12)}
      :root.light #${VIEW_ID} .riskBlock,
      html.light #${VIEW_ID} .riskBlock,
      body.light #${VIEW_ID} .riskBlock{background:rgba(255,255,255,.64);border-color:rgba(15,23,42,.13)}
      :root.light #${VIEW_ID} .riskResult,
      html.light #${VIEW_ID} .riskResult,
      body.light #${VIEW_ID} .riskResult{background:linear-gradient(135deg,rgba(37,99,235,.08),rgba(6,182,212,.06));border-color:rgba(15,23,42,.12)}
      :root.light #${VIEW_ID} .riskDonut::after,
      html.light #${VIEW_ID} .riskDonut::after,
      body.light #${VIEW_ID} .riskDonut::after{background:#fff!important;border-color:rgba(15,23,42,.14);box-shadow:inset 0 0 0 1px rgba(255,255,255,.9)}
      :root.light #${VIEW_ID} .riskScore,
      html.light #${VIEW_ID} .riskScore,
      body.light #${VIEW_ID} .riskScore{color:#0f172a!important}
      :root.light #${VIEW_ID} .riskScore small,
      html.light #${VIEW_ID} .riskScore small,
      body.light #${VIEW_ID} .riskScore small{color:#334155!important}
      :root.light #${VIEW_ID} .riskRec,
      html.light #${VIEW_ID} .riskRec,
      body.light #${VIEW_ID} .riskRec{background:#e9f2ff;border-color:#bfdbfe;color:#0f172a}
      :root.light #${VIEW_ID} .riskFactor.good,
      html.light #${VIEW_ID} .riskFactor.good,
      body.light #${VIEW_ID} .riskFactor.good{background:#e9f9ee;border-color:#cfead6;color:#14532d}
      :root.light #${VIEW_ID} .riskFactor.bad,
      html.light #${VIEW_ID} .riskFactor.bad,
      body.light #${VIEW_ID} .riskFactor.bad{background:#fff0f0;border-color:#f1c8c8;color:#7f1d1d}
      :root.light #${VIEW_ID} .riskClass,
      html.light #${VIEW_ID} .riskClass,
      body.light #${VIEW_ID} .riskClass{background:#eef6ff;border-color:#cfe0ff;color:#0f172a}


      :root.light #${VIEW_ID} .credBtn,
      :root.light #${VIEW_ID} .credMode button,
      html.light #${VIEW_ID} .credBtn,
      html.light #${VIEW_ID} .credMode button,
      body.light #${VIEW_ID} .credBtn,
      body.light #${VIEW_ID} .credMode button{
        background:linear-gradient(135deg,rgba(37,99,235,.18),rgba(6,182,212,.12))!important;
        border-color:rgba(37,99,235,.42)!important;
        color:#0f172a!important;
        box-shadow:0 6px 16px rgba(37,99,235,.10), inset 0 0 0 1px rgba(255,255,255,.45)!important;
      }
      :root.light #${VIEW_ID} .credBtn:hover,
      :root.light #${VIEW_ID} .credMode button:hover,
      html.light #${VIEW_ID} .credBtn:hover,
      html.light #${VIEW_ID} .credMode button:hover,
      body.light #${VIEW_ID} .credBtn:hover,
      body.light #${VIEW_ID} .credMode button:hover{
        background:linear-gradient(135deg,rgba(37,99,235,.25),rgba(6,182,212,.18))!important;
        border-color:rgba(37,99,235,.55)!important;
        transform:translateY(-1px);
      }
      :root.light #${VIEW_ID} .credMode button.active,
      :root.light #${VIEW_ID} .credBtn.primary,
      :root.light #${VIEW_ID} .riskHead .credBtn,
      html.light #${VIEW_ID} .credMode button.active,
      html.light #${VIEW_ID} .credBtn.primary,
      html.light #${VIEW_ID} .riskHead .credBtn,
      body.light #${VIEW_ID} .credMode button.active,
      body.light #${VIEW_ID} .credBtn.primary,
      body.light #${VIEW_ID} .riskHead .credBtn{
        background:linear-gradient(135deg,#2563eb,#06b6d4)!important;
        border-color:rgba(37,99,235,.78)!important;
        color:#fff!important;
        box-shadow:0 12px 24px rgba(37,99,235,.20), inset 0 0 0 1px rgba(255,255,255,.20)!important;
      }
      :root.light #${VIEW_ID} .credBtn:disabled,
      html.light #${VIEW_ID} .credBtn:disabled,
      body.light #${VIEW_ID} .credBtn:disabled{
        background:rgba(241,245,249,.80)!important;
        border-color:rgba(15,23,42,.10)!important;
        color:#94a3b8!important;
        box-shadow:none!important;
      }


      :root.light #${VIEW_ID} .credBtn,
      :root.light #${VIEW_ID} .credMode button,
      html.light #${VIEW_ID} .credBtn,
      html.light #${VIEW_ID} .credMode button,
      body.light #${VIEW_ID} .credBtn,
      body.light #${VIEW_ID} .credMode button{
        background:linear-gradient(135deg,#dbeafe 0%,#cffafe 100%)!important;
        border:1px solid #60a5fa!important;
        color:#0f172a!important;
        box-shadow:0 7px 16px rgba(37,99,235,.14), inset 0 0 0 1px rgba(255,255,255,.70)!important;
      }
      :root.light #${VIEW_ID} .credBtn:hover,
      :root.light #${VIEW_ID} .credMode button:hover,
      html.light #${VIEW_ID} .credBtn:hover,
      html.light #${VIEW_ID} .credMode button:hover,
      body.light #${VIEW_ID} .credBtn:hover,
      body.light #${VIEW_ID} .credMode button:hover{
        background:linear-gradient(135deg,#bfdbfe 0%,#a5f3fc 100%)!important;
        border-color:#3b82f6!important;
        transform:translateY(-1px);
      }
      :root.light #${VIEW_ID} .credMode button.active,
      :root.light #${VIEW_ID} .credBtn.primary,
      :root.light #${VIEW_ID} .riskHead .credBtn,
      html.light #${VIEW_ID} .credMode button.active,
      html.light #${VIEW_ID} .credBtn.primary,
      html.light #${VIEW_ID} .riskHead .credBtn,
      body.light #${VIEW_ID} .credMode button.active,
      body.light #${VIEW_ID} .credBtn.primary,
      body.light #${VIEW_ID} .riskHead .credBtn{
        background:linear-gradient(135deg,#2563eb 0%,#06b6d4 100%)!important;
        border:1px solid #2563eb!important;
        color:#fff!important;
        box-shadow:0 12px 24px rgba(37,99,235,.24), inset 0 0 0 1px rgba(255,255,255,.22)!important;
      }
      :root.light #${VIEW_ID} .credBtn.ok,
      html.light #${VIEW_ID} .credBtn.ok,
      body.light #${VIEW_ID} .credBtn.ok{
        background:linear-gradient(135deg,#ccfbf1 0%,#bae6fd 100%)!important;
        border-color:#14b8a6!important;
        color:#0f172a!important;
      }
      :root.light #${VIEW_ID} .credRefreshBtn.loading,
      html.light #${VIEW_ID} .credRefreshBtn.loading,
      body.light #${VIEW_ID} .credRefreshBtn.loading{
        background:linear-gradient(135deg,#1d4ed8 0%,#0891b2 100%)!important;
        color:#fff!important;
      }


      #${VIEW_ID} .credHero .credRefreshBtn,
      :root.light #${VIEW_ID} .credHero .credRefreshBtn,
      html.light #${VIEW_ID} .credHero .credRefreshBtn,
      body.light #${VIEW_ID} .credHero .credRefreshBtn{
        background:linear-gradient(135deg,#2563eb 0%,#06b6d4 100%)!important;
        border:1px solid #2563eb!important;
        color:#fff!important;
        text-shadow:0 1px 1px rgba(0,0,0,.18);
      }
      #${VIEW_ID} .credHero .credRefreshBtn .credRefreshText,
      :root.light #${VIEW_ID} .credHero .credRefreshBtn .credRefreshText,
      html.light #${VIEW_ID} .credHero .credRefreshBtn .credRefreshText,
      body.light #${VIEW_ID} .credHero .credRefreshBtn .credRefreshText{
        color:#fff!important;
      }


      #${VIEW_ID} .credSuggestions{
        max-height:260px;
        overflow:auto;
        padding-right:4px;
        overscroll-behavior:contain;
      }
      #${VIEW_ID} .credSuggestions::-webkit-scrollbar{width:8px}
      #${VIEW_ID} .credSuggestions::-webkit-scrollbar-thumb{background:rgba(148,163,184,.35);border-radius:999px}
      #${VIEW_ID} .credSuggestion{
        display:block;
        min-height:auto;
      }
      #${VIEW_ID} .credSuggestion .credMuted{
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      #${VIEW_ID} .credSearchHint{
        font-size:12px;
        color:var(--muted,#a8b3c7);
        margin-top:8px;
        line-height:1.35;
      }


      #${VIEW_ID} .credResultCard{margin-top:0}
      #${VIEW_ID} .credResultCard .credSuccess{margin-top:0}
      #${VIEW_ID} .credResultWide{grid-template-columns:repeat(6,minmax(120px,1fr))}
      #${VIEW_ID} .credResultCard .credSummary{font-size:14px}
      @media(max-width:1250px){#${VIEW_ID} .credResultWide{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:760px){#${VIEW_ID} .credResultWide{grid-template-columns:1fr 1fr}}


      #${VIEW_ID} .credResultBody{
        display:grid;
        grid-template-columns:minmax(320px,.95fr) minmax(280px,.55fr);
        gap:16px;
        align-items:stretch;
        margin-top:14px;
      }
      #${VIEW_ID} .credComposition{
        border:1px solid var(--line);
        border-radius:14px;
        padding:14px;
        background:rgba(0,0,0,.10);
        display:grid;
        align-content:start;
        gap:12px;
      }
      #${VIEW_ID} .credComposition h4{
        margin:0;
        font-size:15px;
        letter-spacing:-.01em;
      }
      #${VIEW_ID} .credStackBar{
        height:18px;
        border-radius:999px;
        overflow:hidden;
        display:flex;
        background:rgba(148,163,184,.20);
        border:1px solid rgba(255,255,255,.10);
      }
      #${VIEW_ID} .credStackSeg{height:100%;min-width:3px}
      #${VIEW_ID} .credSegEntry{background:linear-gradient(90deg,#22c55e,#84cc16)}
      #${VIEW_ID} .credSegFinanced{background:linear-gradient(90deg,#38bdf8,#2563eb)}
      #${VIEW_ID} .credSegInterest{background:linear-gradient(90deg,#f59e0b,#f97316)}
      #${VIEW_ID} .credLegend{
        display:grid;
        gap:8px;
      }
      #${VIEW_ID} .credLegendItem{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        font-size:13px;
      }
      #${VIEW_ID} .credLegendLeft{
        display:flex;
        align-items:center;
        gap:8px;
        min-width:0;
      }
      #${VIEW_ID} .credDot{
        width:10px;
        height:10px;
        border-radius:999px;
        flex:0 0 auto;
      }
      #${VIEW_ID} .credMiniNote{
        color:var(--muted,#a8b3c7);
        font-size:12px;
        line-height:1.35;
      }
      :root.light #${VIEW_ID} .credComposition,
      html.light #${VIEW_ID} .credComposition,
      body.light #${VIEW_ID} .credComposition{
        background:rgba(255,255,255,.72);
        border-color:rgba(15,23,42,.12);
      }
      :root.light #${VIEW_ID} .credStackBar,
      html.light #${VIEW_ID} .credStackBar,
      body.light #${VIEW_ID} .credStackBar{
        background:rgba(226,232,240,.9);
        border-color:rgba(15,23,42,.10);
      }
      @media(max-width:900px){
        #${VIEW_ID} .credResultBody{grid-template-columns:1fr}
      }

      @media(max-width:1100px){.riskGrid{grid-template-columns:1fr}.credResult{grid-template-columns:1fr 1fr}}@media(max-width:760px){.credGrid{grid-template-columns:1fr!important}}

      #${VIEW_ID} .credGrid{
        display:grid!important;
        grid-template-columns:minmax(280px,0.82fr) minmax(460px,1.18fr)!important;
        gap:16px!important;
        align-items:start!important;
      }
      #${VIEW_ID} .credLeftStack{
        align-self:start!important;
        align-content:start!important;
      }
      @media(max-width:760px){
        #${VIEW_ID} .credGrid{grid-template-columns:1fr!important}
      }

      @media(max-width:650px){.credHero{grid-template-columns:1fr}.credHero .credBtn{width:max-content}.credForm,.credResult,.riskSubgrid,.riskSubgrid.two{grid-template-columns:1fr}.riskDonut{width:148px;height:148px}}
    `;
    document.head.appendChild(st);
  }

  function ensureView(){
    let v=$(VIEW_ID);
    if(v)return v;
    v=document.createElement('section');
    v.id=VIEW_ID;
    v.className='hidden';
    v.style.display='none';
    mainHost().appendChild(v);
    return v;
  }
  function ensureNav(){
    const existing=$(NAV_ID);
    if(existing){
      existing.classList.toggle('hidden',!canOpenCredit());
      return;
    }
    const nav=qs('.nav');
    if(!nav)return;
    const b=document.createElement('button');
    b.id=NAV_ID;
    b.type='button';
    b.dataset.creditoSimulator='1';
    b.innerHTML='<span><span class="credNavIcon">$</span>Simulador</span><span class="pill">crédito</span>';
    b.classList.toggle('hidden',!canOpenCredit());
    const openCredit=e=>{
      try{
        e?.preventDefault?.();
        e?.stopPropagation?.();
        e?.stopImmediatePropagation?.();
      }catch(_){}
      if(!canOpenCredit()){
        denyCreditAccess();
        return false;
      }
      show();
      return false;
    };
    b.addEventListener('pointerdown',openCredit,true);
    b.addEventListener('click',openCredit,true);
    b.onclick=openCredit;
    const inst=qs('[data-view="installments"]',nav);
    if(inst)inst.insertAdjacentElement('afterend',b);
    else nav.appendChild(b);
  }
  function restore(){
    qsa('[data-credito-hidden="1"]',mainHost()).forEach(v=>{
      if(v.id!==VIEW_ID){
        delete v.dataset.creditoHidden;
      }
    });
  }
  function hide(){
    const v=$(VIEW_ID);
    if(v){v.classList.add('hidden');v.style.display='none'}
    const b=$(NAV_ID); if(b)b.classList.remove('active');
  }
  function hideOthers(){
    const host=mainHost();
    ensureView();
    qsa(':scope > *',host).forEach(v=>{
      if(v.id===VIEW_ID){
        v.classList.remove('hidden');
        v.style.display='';
      }else{
        v.dataset.creditoHidden='1';
        v.classList.add('hidden');
        v.style.display='none';
      }
    });
    const sticky=$('stickyFilters');
    if(sticky){sticky.classList.add('hidden');sticky.dataset.creditoHidden='1'}
    const today=$('view-todayCronos');
    if(today){today.classList.add('hidden');today.style.display='none'}
    qsa('.nav button').forEach(b=>b.classList.toggle('active',b.id===NAV_ID));
  }
  function recoverBind(){
    if(window.__CRONOS_CREDITO_RECOVERY__)return;
    window.__CRONOS_CREDITO_RECOVERY__=true;
    const rec=ev=>{
      const b=ev.target?.closest?.('[data-view]');
      if(!b)return;
      const v=$(VIEW_ID);
      const open=v&&v.style.display!=='none'&&!v.classList.contains('hidden');
      if(!open)return;
      restore(); hide();
    };
    document.addEventListener('pointerdown',rec,true);
    document.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' ')rec(ev)},true);
  }
  function show(){
    if(!canOpenCredit()){
      denyCreditAccess();
      return;
    }
    css();ensureView();ensureNav();recoverBind();hideOthers();render();
    setTimeout(()=>scrollTo({top:0,left:0,behavior:'auto'}),0);
  }

  function cmap(db,master){return new Map((db.contacts||[]).filter(c=>!master||c.masterId===master).map(c=>[String(c.id),c]))}
  function getEntry(){
    const db=load(),a=actor();
    if(!db||!a||!S.entryId)return null;
    return (db.entries||[]).find(e=>String(e.id)===String(S.entryId)&&(!a.masterId||e.masterId===a.masterId))||null;
  }
  function contactOf(db,e){return (db?.contacts||[]).find(c=>String(c.id)===String(e?.contactId))||{}}
  function searchEntries(){
    const q=norm(S.search||'');
    if(q.length<2)return[];
    const db=load(), a=actor();
    const entries=(db.entries||[]).filter(e=>!a?.masterId || e.masterId===a.masterId);
    const tokens=q.split(/\s+/).filter(Boolean);
    const scored=[];
    for(const e of entries){
      const c=contactOf(db,e)||{};
      const name=norm(c.name||'');
      const treatment=norm(e.treatment||e.tratamento||'');
      let score=0;

      if(name===q) score+=120;
      if(name.startsWith(q)) score+=100;
      else if(name.split(/\s+/).some(part=>part.startsWith(q))) score+=82;
      else if(name.includes(q)) score+=55;

      const digits=String(S.search||'').replace(/\D/g,'');
      if(digits.length>=3){
        if(String(c.phone||'').replace(/\D/g,'').includes(digits)) score+=45;
        if(String(c.cpf||'').replace(/\D/g,'').includes(digits)) score+=45;
      }

      if(score===0 && q.length>=4 && treatment.includes(q)) score+=12;

      if(tokens.length>1 && tokens.every(t=>name.includes(t))) score+=35;

      if(score>0) scored.push({entry:e,contact:c,score,name});
    }

    return scored
      .sort((a,b)=>b.score-a.score || String(a.contact.name||'').localeCompare(String(b.contact.name||''),'pt-BR'))
      .slice(0,8);
  }
  function paid(p){return !!(p?.paidAt||p?.cashDate||p?.paid)||String(p?.status||'').toUpperCase()==='PAGA'}
  function planTotals(plan){
    const pays=Array.isArray(plan?.payments)?plan.payments:[],
      sum=pays.reduce((s,p)=>s+Number(p.amount||0),0),
      total=Number(plan?.total||plan?.amount||plan?.valorTotal||sum||0),
      pg=pays.filter(paid).reduce((s,p)=>s+Number(p.amount||0),0),
      pend=pays.filter(p=>!paid(p)).reduce((s,p)=>s+Number(p.amount||0),0);
    return {total,paid:pg,open:Math.max(0,pend||(total-pg))};
  }
  function buildOptions(e){
    if(!e)return [];
    const out=[];
    const items=Array.isArray(e.ficha?.plano)?e.ficha.plano.filter(i=>Number(i.valorFechado||i.valorBase||0)>0):[];
    if(items.length){
      const groups=new Map();
      items.forEach(i=>{
        const k=String(i.avaliacaoId||i.avaliacaoLabel||i.avaliacaoData||'avaliacao');
        if(!groups.has(k))groups.set(k,[]);
        groups.get(k).push(i);
      });
      groups.forEach((arr,k)=>{
        const f=arr[0]||{},
          total=arr.reduce((s,i)=>s+Number(i.valorFechado||i.valorBase||0),0),
          pg=arr.filter(i=>!!i.pago).reduce((s,i)=>s+Number(i.valorFechado||i.valorBase||0),0);
        out.push({
          key:`ficha:${k}`,
          type:'Ficha',
          title:`${f.avaliacaoLabel||'Avaliação'} • Plano de tratamento`,
          subtitle:`${arr.length} procedimento(s)${f.avaliacaoData?' • '+fmt(f.avaliacaoData):''}`,
          total,paid:pg,open:Math.max(0,total-pg)
        });
      });
      if(groups.size>1){
        const total=items.reduce((s,i)=>s+Number(i.valorFechado||i.valorBase||0),0),
          pg=items.filter(i=>!!i.pago).reduce((s,i)=>s+Number(i.valorFechado||i.valorBase||0),0);
        out.unshift({key:'ficha:all',type:'Ficha',title:'Ficha completa • todos os planos',subtitle:`${items.length} procedimento(s)`,total,paid:pg,open:Math.max(0,total-pg)});
      }
    }
    (Array.isArray(e.financialPlans)?e.financialPlans:[]).forEach(p=>{
      const t=planTotals(p);
      if(t.total>0||t.open>0)out.push({key:`fin:${p.id||p.createdAt||p.title}`,type:'Recebimento',title:p.title||'Recebimento/Plano financeiro',subtitle:`${p.status||'Aguardando'} • ${Array.isArray(p.payments)?p.payments.length:0} pagamento(s)`,...t});
    });
    const legacy=Array.isArray(e.installments)?e.installments:[];
    if(legacy.length){
      const total=legacy.reduce((s,p)=>s+Number(p.amount||0),0),
        pg=legacy.filter(paid).reduce((s,p)=>s+Number(p.amount||0),0);
      out.push({key:'legacy:installments',type:'Legado',title:'Parcelamento legado',subtitle:`${legacy.length} parcela(s)`,total,paid:pg,open:Math.max(0,total-pg)});
    }
    return out.filter(o=>o.total>0||o.open>0);
  }
  function selected(){
    const opts=buildOptions(getEntry());
    return opts.find(o=>o.key===S.planKey)||opts[0]||null;
  }

  function updateCreditDerived(source){
    const total=parse(S.inputs.total);
    const entryRaw=parse(S.inputs.entry);
    const pctRaw=parseRate(S.inputs.entryPct);
    const entryEl=$('credEntry');
    const pctEl=$('credEntryPct');
    const pctBadge=$('credEntryPctBadge');
    const pvEl=$('credPV');

    if(source==='entry') S.inputs.entryMode='entry';
    if(source==='entryPct') S.inputs.entryMode='entryPct';
    if(!S.inputs.entryMode) S.inputs.entryMode='entry';

    if(total!==null){
      let en=0;
      let entryPct=0;

      if(S.inputs.entryMode==='entryPct'){
        entryPct=Math.max(0,Number(pctRaw||0));
        en=total>0?(total*entryPct/100):0;
        S.inputs.entry=(S.inputs.entryPct||'').trim()?brnum(en):'';
        if(entryEl) entryEl.value=S.inputs.entry;
      }else{
        en=Math.max(0,Number(entryRaw||0));
        entryPct=total>0?(en/total)*100:0;
        S.inputs.entryPct=brnum(entryPct,1)+'%';
        if(pctEl) pctEl.value=S.inputs.entryPct;
        if(pctBadge) pctBadge.textContent=S.inputs.entryPct;
      }

      const financed=Math.max(0,total-en);
      S.inputs.pv=brnum(financed);
      if(pvEl) pvEl.value=S.inputs.pv;
      if(pctBadge) pctBadge.textContent=(S.inputs.entryMode==='entryPct'?(S.inputs.entryPct||'0,0%'):S.inputs.entryPct)||'0,0%';
    }else{
      S.inputs.pv='';
      if(pvEl) pvEl.value='';
      if(S.inputs.entryMode!=='entryPct'){
        S.inputs.entryPct='';
        if(pctEl) pctEl.value='';
      }
      if(pctBadge) pctBadge.textContent='—';
    }
  }
  function rememberInputs(source){
    const map={total:'credTotal',entry:'credEntry',entryPct:'credEntryPct',n:'credN',rp:'credRate',P:'credPMT'};
    Object.keys(map).forEach(k=>{const el=$(map[k]); if(el)S.inputs[k]=el.value});
    updateCreditDerived(source);
  }
  function setInputValue(key,value){
    S.inputs[key]=value==null?'':String(value);
    const map={total:'credTotal',entry:'credEntry',entryPct:'credEntryPct',pv:'credPV',n:'credN',rp:'credRate',P:'credPMT'};
    const el=$(map[key]); if(el)el.value=S.inputs[key];
    if(key==='entry')S.inputs.entryMode='entry';
    if(key==='entryPct')S.inputs.entryMode='entryPct';
    if(['total','entry','entryPct'].includes(key))updateCreditDerived(key==='total'?'total':key);
  }
  function inputValue(key){return S.inputs[key]||''}

  function usePlan(k){
    S.planKey=k;S.result=null;S.error='';
    const o=selected(), amt=Number(o?.open||o?.total||0);
    if(amt>0){S.inputs.entryMode='entry';setInputValue('total',brnum(amt));setInputValue('entry','');updateCreditDerived('entry');}
    render();
  }
  function selectEntry(id){
    S.entryId=String(id||'');S.planKey='';S.result=null;S.error='';
    if(!id){S.inputs.total='';S.inputs.entry='';S.inputs.pv='';render();return}
    const o=selected();
    if(o)usePlan(o.key); else render();
  }
  function setMode(m){
    rememberInputs();
    S.mode=m==='linked'?'linked':'free';S.result=null;S.error='';
    if(S.mode==='free'){S.entryId='';S.planKey=''}
    render();
  }
  function search(v){
    rememberInputs();
    S.search=String(v||'');S.entryId='';S.planKey='';
    render();
    setTimeout(()=>{const el=$('credSearch'); if(el){el.focus(); el.selectionStart=el.selectionEnd=el.value.length}},0);
  }

  function pmt(pv,n,i){if(n<=0)return null; if(Math.abs(i)<1e-12)return pv/n; const den=1-Math.pow(1+i,-n); return den>0?pv*i/den:null}
  function pvcalc(P,n,i){if(n<=0)return null; if(Math.abs(i)<1e-12)return P*n; return P*(1-Math.pow(1+i,-n))/i}
  function rate(pv,n,P){
    if(pv<=0||n<=0||P<=0)return null;
    const flat=pv/n;
    if(Math.abs(P-flat)<1e-6)return 0;
    if(P<flat)return null;
    let lo=0,hi=.01;
    for(let s=0;pmt(pv,n,hi)<P&&hi<100&&s<200;s++)hi*=2;
    if(hi>=100)return null;
    for(let k=0;k<120;k++){
      const mid=(lo+hi)/2;
      if(pmt(pv,n,mid)>P)hi=mid; else lo=mid;
    }
    return (lo+hi)/2;
  }
  function months(pv,i,P){
    if(pv<=0||P<=0)return null;
    if(Math.abs(i)<1e-12)return pv/P;
    if(P<=pv*i)return null;
    return -Math.log(1-(pv*i/P))/Math.log(1+i);
  }
  function roundMoney(v){
    return Math.round((Number(v||0)+Number.EPSILON)*100)/100;
  }

  function calc(){
    rememberInputs();
    const total=parse(inputValue('total')), entryRaw=parse(inputValue('entry')), n=parse(inputValue('n')), rp=parseRate(inputValue('rp'));
    const entry=Math.max(0,Number(entryRaw||0));
    S.error='';S.result=null;

    if(total===null || n===null || rp===null){
      S.inputs.P='';
      S.error='Preencha valor total/proposta, nº de meses e taxa mensal. A entrada é opcional; o saldo financiado e a prestação são calculados pelo Cronos.';
      return render();
    }

    const pv=Math.max(0,total-entry);
    setInputValue('pv',brnum(pv));

    let out={total,entry,entryPct:total>0?(entry/total)*100:0,pv,n,ratePct:rp,pmt:null,target:'pmt',exactMonths:false};
    try{
      if(total<=0||n<=0||rp<0)throw Error('Valor total, meses e taxa precisam ser válidos.');
      if(entry>total)throw Error('A entrada não pode ser maior que o valor total/proposta.');
      if(pv<=0)throw Error('O saldo financiado precisa ser maior que zero. Confira a entrada e o valor total.');
      out.pmtExact=pmt(pv,n,rp/100);
      out.pmt=roundMoney(out.pmtExact);
      setInputValue('P',brnum(out.pmt));
      if(!Number.isFinite(out.total)||!Number.isFinite(out.entry)||!Number.isFinite(out.pv)||!Number.isFinite(out.n)||!Number.isFinite(out.ratePct)||!Number.isFinite(out.pmt))throw Error('Não foi possível calcular com esses dados.');
      out.installmentsTotal=roundMoney(out.pmt*out.n);
      out.totalPaid=roundMoney(out.entry+out.installmentsTotal);
      out.interest=roundMoney(out.installmentsTotal-out.pv);
      out.createdAt=new Date().toISOString();
      S.result=out;
      const snap=currentSimulationSnapshot();
      if(S.risk?.snapshot && !sameRiskSnapshot(S.risk.snapshot,snap)) S.risk.dirty=true;
    }catch(e){
      S.inputs.P='';
      S.error=e.message||'Não foi possível calcular.';
    }
    render();
  }

  function clinic(){
    const db=load(),a=actor();
    return db?.settings?.clinicDisplayName||db?.settings?.clinicName||db?.settings?.brandClinicName||a?.clinicName||'Cronos Odonto';
  }
  function resultText(){
    const r=S.result;
    if(!r)return'';
    const e=getEntry(), c=contactOf(load(),e), o=selected(), monthsLine=r.exactMonths?`${brnum(r.n,2)} meses (aprox.)`:`${Math.round(r.n)} meses`;
    const total=Number(r.total||r.pv||0), entry=Number(r.entry||0), parcelado=Number(r.installmentsTotal||((r.pmt||0)*(r.n||0))||0);
    return `${clinic()}
Simulação de crédito/pagamento

${c?.name?'Paciente: '+c.name+'\n':''}${o?.title?'Base da simulação: '+o.title+'\n':''}Valor total/proposta: ${money(total)}
Entrada: ${money(entry)}
Valor financiado/saldo: ${money(r.pv)}
Prazo: ${monthsLine}
Taxa mensal: ${brnum(r.ratePct,4)}%
Prestação estimada: ${money(r.pmt)}

Total parcelado: ${money(parcelado)}
Total geral estimado: ${money(r.totalPaid)}
Juros estimados: ${money(r.interest)}

Observação: esta é uma simulação estimativa e pode variar conforme aprovação, forma de pagamento e condições comerciais.`;
  }
  async function copy(){
    if(!S.result)return toast('Simulação','Calcule antes de copiar.');
    try{await navigator.clipboard.writeText(resultText());toast('Copiado ✅','Simulação pronta para colar.')}
    catch(_){toast('Copiar','Não consegui copiar automaticamente.')}
  }
  function whats(){
    if(!S.result)return toast('Simulação','Calcule antes de enviar.');
    const e=getEntry(), c=contactOf(load(),e), ph=phone(c.phone);
    if(!ph)return toast('WhatsApp','Paciente sem telefone.');
    window.open(`https://wa.me/55${ph}?text=${encodeURIComponent(resultText())}`,'_blank');
  }
  function printText(text){
    const safe=esc(text||'').replace(/\n/g,'<br>');
    const html=`<!doctype html><html><head><meta charset="utf-8"><title>Simulação de pagamento</title><style>body{font-family:Arial,sans-serif;margin:0;padding:32px;color:#111}.doc{max-width:760px;margin:0 auto;border:1px solid #ddd;border-radius:14px;padding:28px}h1{margin:0 0 8px}.muted{color:#666}.text{line-height:1.65}.top{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #eee;padding-bottom:16px;margin-bottom:18px}@media print{body{padding:0}.doc{border:0}.noPrint{display:none}}</style></head><body><div class="doc"><div class="top"><div><h1>${esc(clinic())}</h1><div class="muted">Simulação de crédito / pagamento</div></div><div class="muted">${fmt(today())}</div></div><div class="text">${safe}</div><p class="noPrint" style="margin-top:24px"><button onclick="window.print()">Imprimir</button></p></div><script>setTimeout(()=>window.print(),350)<\/script></body></html>`;
    const w=window.open('','_blank');
    if(!w)return toast('Impressão bloqueada','Permita pop-ups.');
    w.document.open();w.document.write(html);w.document.close();
  }
  function print(){
    if(!S.result)return toast('Simulação','Calcule antes de imprimir.');
    printText(resultText());
  }
  function riskReportText(){
    const r=S.risk?.result, ri=S.risk?.inputs||{};
    if(!r)return'';
    const e=getEntry(), c=contactOf(load(),e), factors=(r.factors||[]).map(f=>`${f.impact>=0?'▲':'▼'} ${f.txt}`).join('\n');
    return `${clinic()}
Análise Inteligente de Risco — USO INTERNO

${c?.name?'Paciente: '+c.name+'\n':''}Origem: ${S.risk.source==='linked'?'Vinculada ao lead':S.risk.source==='simulation'?'Simulação avulsa':'Manual/avulsa'}
Data: ${fmt(today())}

Dados da proposta
Valor total/proposta: ${money(parse(ri.total)||r.inputs?.total||0)}
Entrada: ${money(parse(ri.entry)||r.inputs?.entry||0)}
% entrada: ${ri.entryPct||brnum(r.inputs?.entryPct||0,1)+'%'}
Valor financiado/saldo: ${money(parse(ri.financed)||r.inputs?.financed||0)}
Taxa mensal: ${ri.rate||brnum(r.inputs?.ratePct||0,4)+'%'}
Parcelas: ${ri.months||r.inputs?.months||''}
Valor da parcela: ${money(parse(ri.payment)||r.inputs?.payment||0)}
Renda informada: ${ri.income?money(parse(ri.income)||0):'Não informada'}
Cadastro/documentos: ${docLabel(ri.doc)}

Histórico interno informado
Atrasos anteriores: ${ri.delays||'0'}
Maior atraso/dias: ${ri.maxDelay||'0'}
Faltas sem aviso: ${ri.noShows||'0'}
Renegociações: ${ri.reneg||'0'}
Contratos quitados: ${ri.completed||'0'}
Total contratos: ${ri.contracts||'0'}

Resultado
Score interno: ${r.score}/1000
Classificação: ${r.classInfo?.label||''}
Recomendação do Cronos: ${r.recommendation||''}

3 fatores principais
${factors||'Sem fatores calculados.'}

Observação: documento interno de apoio à decisão, baseado nos dados registrados no Cronos. Não substitui consulta a órgãos de crédito nem decisão administrativa da clínica.`;
  }
  function printRiskAnalysis(){
    if(!S.risk?.result)return toast('Análise de risco','Calcule a análise antes de imprimir.');
    const r=S.risk.result, ri=S.risk.inputs||{}, e=getEntry(), db=load(), c=e&&db?contactOf(db,e):null;
    const origin=S.risk.source==='linked'?'Vinculada ao lead':S.risk.source==='simulation'?'Usando a simulação':'Manual';
    const p=Math.max(0,Math.min(100,r.score/10));
    const factorTone=f=>f.kind==='good'?'good':'bad';
    const factorIcon=f=>f.impact>=0?'▲':'▼';
    const proposalItems=[
      ['Valor total/proposta', money(parse(ri.total)||r.inputs?.total||0)],
      ['Entrada', money(parse(ri.entry)||r.inputs?.entry||0)],
      ['% entrada', ri.entryPct||brnum(r.inputs?.entryPct||0,1)+'%'],
      ['Valor financiado/saldo', money(parse(ri.financed)||r.inputs?.financed||0)],
      ['Taxa mensal', ri.rate||brnum(r.inputs?.ratePct||0,4)+'%'],
      ['Parcelas', String(ri.months||r.inputs?.months||'—')],
      ['Valor da parcela', money(parse(ri.payment)||r.inputs?.payment||0)],
      ['Renda informada', ri.income?money(parse(ri.income)||0):'Não informada'],
      ['Cadastro/documentos', docLabel(ri.doc)]
    ];
    const historyItems=[
      ['Atrasos anteriores', String(ri.delays||'0')],
      ['Maior atraso/dias', String(ri.maxDelay||'0')],
      ['Faltas sem aviso', String(ri.noShows||'0')],
      ['Renegociações', String(ri.reneg||'0')],
      ['Contratos quitados', String(ri.completed||'0')],
      ['Total contratos', String(ri.contracts||'0')]
    ];
    const proposalHtml=proposalItems.map(([k,v])=>`<div class="metric"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    const historyHtml=historyItems.map(([k,v])=>`<div class="metric"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    const factors=(Array.isArray(r.factors)&&r.factors.length?r.factors:[{txt:'Sem fatores calculados.',impact:0,kind:'bad'}]).map(f=>`<div class="factor ${factorTone(f)}"><b>${factorIcon(f)} ${esc(f.txt)}</b></div>`).join('');
    const html=`<!doctype html><html><head><meta charset="utf-8"><title>Análise de risco interna</title><style>
      :root{--line:#d8dee8;--muted:#64748b;--ink:#0f172a;--soft:#f8fafc;--blue:#e9f2ff;--green:#e9f9ee;--red:#fff0f0;}
      *{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;padding:28px;color:var(--ink);background:#fff}.doc{max-width:900px;margin:0 auto;border:1px solid var(--line);border-radius:18px;padding:28px;background:#fff}h1,h2,h3,p{margin:0}h1{font-size:24px;margin-bottom:6px}.muted{color:var(--muted)}.top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;border-bottom:1px solid #e5e7eb;padding-bottom:18px;margin-bottom:18px}.brandSub{font-size:13px;color:var(--muted)}
      .hero{display:flex;gap:18px;align-items:center}.donut{--p:${p};width:120px;height:120px;border-radius:50%;position:relative;display:grid;place-items:center;background:radial-gradient(closest-side,#fff 67%,transparent 68% 100%),conic-gradient(from -90deg,#ff5877 0%,#ff9b45 18%,#ffd64c 38%,#61d96d 64%,#32b5ff calc(var(--p)*1%),#e5e7eb 0)}.donutCenter{text-align:center;line-height:1.05;color:var(--ink)}.donutCenter b{display:block;font-size:30px;color:var(--ink)}.donutCenter small{font-size:14px;color:var(--muted)}.scoreSide{display:grid;gap:8px;justify-items:end;text-align:right}.pill{display:inline-block;padding:8px 12px;border:1px solid var(--line);border-radius:999px;font-weight:700;background:#fff}.classTag{display:inline-block;padding:8px 12px;border-radius:999px;background:#eef6ff;border:1px solid #cfe0ff;font-weight:700}
      .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.card{border:1px solid var(--line);border-radius:16px;padding:16px;background:#fff}.sectionTitle{font-size:16px;font-weight:800;margin-bottom:12px}.mini{font-size:12px;color:var(--muted);margin-top:6px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.meta .metric,.metrics .metric{background:var(--soft)}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.metric{border:1px solid var(--line);border-radius:12px;padding:11px 12px;min-height:66px}.metric span{display:block;font-size:12px;color:var(--muted);margin-bottom:7px}.metric b{font-size:16px;line-height:1.25}
      .callout{border-radius:14px;padding:14px 16px;border:1px solid #cfe0ff;background:var(--blue);margin-top:16px}.callout b{display:block;margin-bottom:6px}.factors{display:grid;gap:10px;margin-top:12px}.factor{border:1px solid var(--line);border-radius:14px;padding:14px 16px}.factor.good{background:var(--green);border-color:#cfead6}.factor.bad{background:var(--red);border-color:#f1c8c8}.note{margin-top:16px;border:1px dashed #cbd5e1;border-radius:14px;padding:12px 14px;background:#fafafa;font-size:12px;color:#475569;line-height:1.5}.footer{margin-top:18px;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted)}.noPrint{margin-top:20px}button{padding:10px 14px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;font-weight:700;cursor:pointer}
      @media print{body{padding:0}.doc{border:0;border-radius:0;max-width:none;padding:18px}.noPrint{display:none}.grid2{page-break-inside:avoid}.card,.callout,.factor,.note,.metric{break-inside:avoid}}
    </style></head><body><div class="doc">
      <div class="top">
        <div>
          <div class="brandSub">${esc(fmt(new Date().toISOString().slice(0,10)))} • ${esc(today())}</div>
          <h1>${esc(clinic())}</h1>
          <div class="muted">Análise Inteligente de Risco — uso interno</div>
        </div>
        <div class="hero">
          <div class="scoreSide"><span class="classTag">${esc(r.classInfo?.label||'')}</span><span class="pill">Score ${esc(r.score)}/1000</span></div>
          <div class="donut"><div class="donutCenter"><b>${esc(r.score)}</b><small>/1000</small></div></div>
        </div>
      </div>
      <div class="card">
        <div class="sectionTitle">Resumo da análise</div>
        <div class="meta">
          <div class="metric"><span>Paciente</span><b>${esc(c?.name||'Não vinculado')}</b></div>
          <div class="metric"><span>Origem</span><b>${esc(origin)}</b></div>
          <div class="metric"><span>Data</span><b>${esc(fmt(String(r.createdAt||new Date().toISOString()).slice(0,10)))}</b></div>
        </div>
      </div>
      <div class="grid2">
        <div class="card"><div class="sectionTitle">Dados da proposta</div><div class="metrics">${proposalHtml}</div></div>
        <div class="card"><div class="sectionTitle">Histórico interno</div><div class="metrics">${historyHtml}</div><div class="mini">${esc(ri.historyNote||'Baseado no histórico registrado dentro da clínica.')}</div></div>
      </div>
      <div class="callout"><b>Recomendação do Cronos</b>${esc(r.recommendation||'')}</div>
      <div class="card" style="margin-top:16px"><div class="sectionTitle">3 fatores principais</div><div class="factors">${factors}</div></div>
      <div class="note">Documento interno de apoio à decisão. O score é baseado nos dados da proposta e no histórico registrado no Cronos. Não substitui consulta a órgãos de crédito nem decisão administrativa da clínica.</div>
      <p class="noPrint"><button onclick="window.print()">Imprimir</button></p>
    </div><script>setTimeout(()=>window.print(),350)<\/script></body></html>`;
    const w=window.open('','_blank');
    if(!w)return toast('Impressão bloqueada','Permita pop-ups.');
    w.document.open();w.document.write(html);w.document.close();
  }
  function saveHistoryRecord(){
    if(!S.result)return toast('Histórico','Calcule antes de salvar.');

    const db=load(),a=actor();
    if(!db||!a)return toast('Histórico','Não consegui acessar a base do Cronos.');

    const e=getEntry();
    const c=e?contactOf(db,e):null;

    if(!e || !c?.name){
      return toast('Histórico','Vincule um paciente antes de salvar no histórico.');
    }

    db.creditSimulations=Array.isArray(db.creditSimulations)?db.creditSimulations:[];
    const o=selected();
    const text=resultText();

    const alreadySaved=db.creditSimulations.some(x=>
      (!x.masterId || x.masterId===a.masterId) &&
      String(x.entryId||'')===String(e.id||'') &&
      String(x.contactId||'')===String(e.contactId||'') &&
      String(x.text||'')===String(text||'')
    );

    if(alreadySaved){
      return toast('Histórico','Essa simulação já está salva para este paciente.');
    }

    const rec={
      id:'sim_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
      masterId:a.masterId,
      entryId:e.id||'',
      contactId:e.contactId||'',
      patientName:c.name||'',
      patientPhone:c.phone||'',
      sourceTitle:o?.title||'Simulação vinculada',
      mode:'linked',
      createdAt:new Date().toISOString(),
      result:{...S.result},
      text
    };

    db.creditSimulations.unshift(rec);
    db.creditSimulations=db.creditSimulations.slice(0,500);

    try{
      if(typeof window.saveDB==='function')window.saveDB(db,{immediate:true});
      else if(typeof window.save==='function')window.save(db,{immediate:true});
    }catch(_){}

    toast('Histórico salvo ✅',rec.patientName);
    render();
  }

  function historyList(){
    const db=load(),a=actor(),e=getEntry();
    if(!db||!a||!e)return[];
    return (Array.isArray(db.creditSimulations)?db.creditSimulations:[])
      .filter(x=>
        (!x.masterId || x.masterId===a.masterId) &&
        (
          String(x.entryId||'')===String(e.id||'') ||
          String(x.contactId||'')===String(e.contactId||'')
        )
      )
      .slice(0,50);
  }

  function allHistoryList(){
    const db=load(),a=actor();
    if(!db||!a)return[];
    return (Array.isArray(db.creditSimulations)?db.creditSimulations:[])
      .filter(x=>!x.masterId||x.masterId===a.masterId);
  }

  async function copyHistory(id){
    const rec=historyList().find(x=>String(x.id)===String(id));
    if(!rec)return toast('Histórico','Simulação não encontrada para este paciente.');
    try{await navigator.clipboard.writeText(rec.text||'');toast('Copiado ✅','Simulação do histórico copiada.')}
    catch(_){toast('Copiar','Não consegui copiar automaticamente.')}
  }

  function printHistory(id){
    const rec=historyList().find(x=>String(x.id)===String(id));
    if(!rec)return toast('Histórico','Simulação não encontrada para este paciente.');
    printText(rec.text||'');
  }

  function deleteHistory(id){
    const db=load(),a=actor();
    if(!db||!a)return toast('Histórico','Não consegui acessar a base do Cronos.');
    const rec=allHistoryList().find(x=>String(x.id)===String(id));
    if(!rec)return toast('Histórico','Simulação não encontrada.');
    if(!confirm('Apagar esta simulação do histórico?'))return;

    db.creditSimulations=(Array.isArray(db.creditSimulations)?db.creditSimulations:[])
      .filter(x=>String(x.id)!==String(id));

    try{
      if(typeof window.saveDB==='function')window.saveDB(db,{immediate:true});
      else if(typeof window.save==='function')window.save(db,{immediate:true});
    }catch(_){}

    toast('Histórico apagado ✅');
    render();
  }
  function clear(){
    S.inputs={total:'',entry:'',entryPct:'',entryMode:'entry',pv:'',n:'',rp:'',P:''};
    S.result=null;S.error='';
    render();
  }

  function riskInput(k,v){
    S.risk=S.risk||{inputs:{},result:null,error:'',source:'manual',snapshot:null,dirty:false,animating:false};
    S.risk.inputs={...RISK_DEFAULT_INPUTS,...(S.risk.inputs||{})};
    S.risk.inputs[k]=String(v??'');
    if(['total','entry','financed'].includes(k)){
      updateRiskDerived(false,k);
      const pctEl=$('risk_entryPct'); if(pctEl)pctEl.value=S.risk.inputs.entryPct||'';
      const finEl=$('risk_financed'); if(finEl)finEl.value=S.risk.inputs.financed||'';
      const totalEl=$('risk_total'); if(totalEl)totalEl.value=S.risk.inputs.total||'';
    }
    S.risk.result=null;
    S.risk.error='';
  }

  function updateRiskDerived(renderAfter=true,changedKey=''){
    const ri=S.risk.inputs;
    const total=parse(ri.total), entry=parse(ri.entry), financed=parse(ri.financed);
    const en=Math.max(0,Number(entry||0));
    if(total!==null){
      const saldo=Math.max(0,total-en);
      ri.financed=brnum(saldo);
      const pct=total>0?(en/total)*100:0;
      ri.entryPct=Number.isFinite(pct)?brnum(Math.max(0,pct),1):'';
    }else if(financed!==null){
      const t=financed+en;
      ri.total=brnum(t);
      ri.entryPct=t>0?brnum((en/t)*100,1):'';
    }else{
      ri.entryPct='';
    }
    if(renderAfter)render();
  }

  function riskSet(k,v){
    S.risk.inputs[k]=v==null?'':String(v);
    const el=$('risk_'+k); if(el)el.value=S.risk.inputs[k];
  }

  function currentSimulationSnapshot(){
    if(!S.result)return null;
    const r=S.result||{}, o=selected(), e=getEntry();
    return {
      entryId:String(e?.id||''),
      contactId:String(e?.contactId||''),
      planKey:String(S.planKey||''),
      total:Number(r.total||r.pv||0),
      entry:Number(r.entry||0),
      pv:Number(r.pv||0),
      n:Number(r.n||0),
      ratePct:Number(r.ratePct||0),
      pmt:Number(r.pmt||0),
      totalPaid:Number(r.totalPaid||0),
      sourceTitle:String(o?.title||'')
    };
  }
  function sameRiskSnapshot(a,b){
    if(!a||!b)return false;
    return ['entryId','contactId','planKey','sourceTitle'].every(k=>String(a[k]||'')===String(b[k]||'')) &&
      ['total','entry','pv','n','ratePct','pmt','totalPaid'].every(k=>Math.abs(Number(a[k]||0)-Number(b[k]||0))<0.01);
  }

  function daysBetween(a,b){
    const da=new Date(String(a||'').slice(0,10)+'T00:00:00'), db=new Date(String(b||'').slice(0,10)+'T00:00:00');
    if(!Number.isFinite(da.getTime())||!Number.isFinite(db.getTime()))return 0;
    return Math.max(0,Math.round((db-da)/86400000));
  }

  function collectPatientPayments(db,contactId){
    const a=actor();
    const entries=(db?.entries||[]).filter(e=>String(e.contactId||'')===String(contactId||'')&&(!a?.masterId||e.masterId===a.masterId));
    const payments=[];
    let contracts=0, reneg=0, noShows=0, completed=0, entrySum=0, entryCount=0;
    entries.forEach(e=>{
      const st=String(e.status||'').toLowerCase();
      if(st.includes('falt'))noShows++;
      const blob=JSON.stringify(e||{}).toLowerCase();
      if(blob.includes('renegoc'))reneg++;
      if(e.installPlan){contracts++; const en=Number(e.installPlan.entryAmount||0); if(en>0){entrySum+=en;entryCount++;}}
      if(Array.isArray(e.financialPlans)&&e.financialPlans.length)contracts+=e.financialPlans.length;
      if(Array.isArray(e.installments)&&e.installments.length&&!e.installPlan)contracts++;
      (Array.isArray(e.installments)?e.installments:[]).forEach(p=>payments.push({...p,_entry:e}));
      (Array.isArray(e.financialPlans)?e.financialPlans:[]).forEach(fp=>{
        (Array.isArray(fp.payments)?fp.payments:[]).forEach(p=>payments.push({...p,_plan:fp,_entry:e}));
      });
    });
    let delays=0,maxDelay=0,paidCount=0,plansWithOpen=0;
    const todayIso=today();
    payments.forEach(p=>{
      const due=String(p.dueDate||p.due||p.vencimento||p.date||'').slice(0,10);
      const paidAt=String(p.paidAt||p.cashDate||p.paidDate||p.paid||'').slice(0,10);
      const isPaid=paid(p);
      if(isPaid)paidCount++;
      if(due){
        if(isPaid && paidAt && paidAt>due){
          const d=daysBetween(due,paidAt); delays++; maxDelay=Math.max(maxDelay,d);
        }else if(!isPaid && due<todayIso){
          const d=daysBetween(due,todayIso); delays++; maxDelay=Math.max(maxDelay,d); plansWithOpen++;
        }
      }
    });
    entries.forEach(e=>{
      const pays=[];
      (Array.isArray(e.installments)?e.installments:[]).forEach(p=>pays.push(p));
      (Array.isArray(e.financialPlans)?e.financialPlans:[]).forEach(fp=>(Array.isArray(fp.payments)?fp.payments:[]).forEach(p=>pays.push(p)));
      if(pays.length && pays.every(paid))completed++;
    });
    return {contracts,delays,maxDelay,noShows,reneg,completed,paidCount,openPastDue:plansWithOpen,avgEntry:entryCount?entrySum/entryCount:0,entries:entries.length};
  }

  function loadRiskHistoryIntoInputs(){
    const db=load(), e=getEntry();
    if(!db||!e)return null;
    const prof=collectPatientPayments(db,e.contactId);
    riskSet('delays',prof.delays||'');
    riskSet('maxDelay',prof.maxDelay||'');
    riskSet('noShows',prof.noShows||'');
    riskSet('reneg',prof.reneg||'');
    riskSet('completed',prof.completed||'');
    riskSet('contracts',prof.contracts||'');
    riskSet('historyNote',prof.entries?`Histórico interno: ${prof.entries} registro(s), ${prof.paidCount} pagamento(s) lido(s).`:'Pouco ou nenhum histórico interno localizado.');
    return prof;
  }

  function useSimulationForRisk(){
    if(!S.result)return toast('Análise de risco','Calcule uma simulação válida primeiro.');
    const r=S.result, e=getEntry();
    const total=Number(r.total||r.pv||0);
    const entry=Number(r.entry||0);
    const financed=Number(r.pv||0);
    S.risk.inputs={...S.risk.inputs,
      total:total?brnum(total):'',
      entry:entry?brnum(entry):'0,00',
      financed:financed?brnum(financed):'',
      rate:brnum(r.ratePct||0,4),
      months:brnum(r.n||0,(r.exactMonths?2:0)),
      payment:r.pmt?brnum(r.pmt):'',
      historyNote:e?'Histórico interno pronto para cruzar com a simulação.':'Simulação avulsa: histórico do paciente não será usado.'
    };
    updateRiskDerived(false);
    if(e)loadRiskHistoryIntoInputs();
    S.risk.source=e?'linked':'simulation';
    S.risk.snapshot=currentSimulationSnapshot();
    S.risk.dirty=false;
    S.risk.result=null;
    S.risk.error='';
    render();
  }

  function clearRisk(){
    S.risk={inputs:{...RISK_DEFAULT_INPUTS},result:null,error:'',source:'manual',snapshot:null,dirty:false,animating:false};
    render();
  }

  function riskClass(score){
    if(score>=820)return {label:'Baixo risco',tone:'good'};
    if(score>=680)return {label:'Risco controlado',tone:'good'};
    if(score>=540)return {label:'Risco moderado',tone:'warn'};
    if(score>=420)return {label:'Risco alto',tone:'bad'};
    return {label:'Risco crítico',tone:'bad'};
  }
  function riskRecommendation(score){
    if(score>=820)return 'Aprovar normal, mantendo os dados da proposta e o acompanhamento padrão.';
    if(score>=680)return 'Aprovar com atenção: manter entrada, evitar alongar demais as parcelas e acompanhar os vencimentos.';
    if(score>=540)return 'Aprovar com entrada maior ou limitar parcelas. Se o valor for alto, peça análise manual antes de liberar boleto próprio.';
    if(score>=420)return 'Evitar boleto próprio nas condições atuais. Melhor aumentar entrada, reduzir prazo ou priorizar cartão/financeira.';
    return 'Não recomendado para boleto próprio. Priorizar Pix, cartão, à vista ou análise manual do gerente.';
  }

  function addFactor(list,txt,impact){list.push({txt,impact,kind:impact>=0?'good':'bad'});return impact;}

  function calculateRiskScore(){
    const ri=S.risk.inputs;
    updateRiskDerived(false);
    let score=620;
    const factors=[];
    const total=parse(ri.total), entry=parse(ri.entry), financed=parse(ri.financed), months=parse(ri.months), payment=parse(ri.payment), income=parse(ri.income), ratePct=parseRate(ri.rate);
    const delays=parse(ri.delays)||0, maxDelay=parse(ri.maxDelay)||0, noShows=parse(ri.noShows)||0, reneg=parse(ri.reneg)||0, completed=parse(ri.completed)||0, contracts=parse(ri.contracts)||0;

    if(!financed||financed<=0 || !months||months<=0 || !payment||payment<=0){
      return {error:'Preencha valor financiado, parcelas e valor da parcela para calcular o risco.'};
    }

    const effectiveTotal=total&&total>0?total:(financed+(entry||0));
    const entryPct=effectiveTotal>0?(Number(entry||0)/effectiveTotal)*100:0;

    if(entryPct>=50)score+=addFactor(factors,`Entrada forte (${brnum(entryPct,1)}% do total).`,160);
    else if(entryPct>=30)score+=addFactor(factors,`Entrada boa (${brnum(entryPct,1)}% do total).`,110);
    else if(entryPct>=20)score+=addFactor(factors,`Entrada razoável (${brnum(entryPct,1)}% do total).`,70);
    else if(entryPct>=10)score+=addFactor(factors,`Entrada baixa (${brnum(entryPct,1)}% do total).`,30);
    else if(entryPct>0)score+=addFactor(factors,`Entrada muito baixa (${brnum(entryPct,1)}% do total).`,-35);
    else score+=addFactor(factors,'Sem entrada informada.',-90);

    if(months<=6)score+=addFactor(factors,`Prazo curto (${Math.round(months)}x).`,80);
    else if(months<=10)score+=addFactor(factors,`Prazo controlado (${Math.round(months)}x).`,45);
    else if(months<=12)score+=addFactor(factors,`Prazo comum (${Math.round(months)}x).`,20);
    else if(months<=18)score+=addFactor(factors,`Prazo alongado (${Math.round(months)}x).`,-25);
    else if(months<=24)score+=addFactor(factors,`Prazo alto (${Math.round(months)}x).`,-65);
    else score+=addFactor(factors,`Prazo muito alto (${Math.round(months)}x).`,-120);

    if(income&&income>0){
      const ratio=payment/income;
      if(ratio<=.15)score+=addFactor(factors,`Parcela leve em relação à renda (${brnum(ratio*100,1)}%).`,100);
      else if(ratio<=.25)score+=addFactor(factors,`Parcela aceitável em relação à renda (${brnum(ratio*100,1)}%).`,60);
      else if(ratio<=.35)score+=addFactor(factors,`Parcela começa a pesar na renda (${brnum(ratio*100,1)}%).`,15);
      else if(ratio<=.45)score+=addFactor(factors,`Parcela pesada para a renda (${brnum(ratio*100,1)}%).`,-55);
      else score+=addFactor(factors,`Parcela muito pesada para a renda (${brnum(ratio*100,1)}%).`,-125);
    }else{
      score+=addFactor(factors,'Renda não informada; análise fica menos segura.',-25);
    }

    const doc=String(ri.doc||'basic');
    if(doc==='complete')score+=addFactor(factors,'Cadastro/documentos informado como completo.',80);
    else if(doc==='basic')score+=addFactor(factors,'Cadastro/documentos básico informado.',25);
    else if(doc==='incomplete')score+=addFactor(factors,'Cadastro/documentos incompleto.',-90);
    else score+=addFactor(factors,'Sem cadastro/documentos informados.',-140);

    if(financed<=2000)score+=addFactor(factors,`Valor financiado baixo (${money(financed)}).`,50);
    else if(financed<=5000)score+=addFactor(factors,`Valor financiado moderado (${money(financed)}).`,20);
    else if(financed<=10000)score+=addFactor(factors,`Valor financiado alto (${money(financed)}).`,-20);
    else score+=addFactor(factors,`Valor financiado muito alto (${money(financed)}).`,-70);

    if(ratePct!==null && ratePct>5)score+=addFactor(factors,`Taxa alta (${brnum(ratePct,2)}% a.m.) pode pressionar a parcela.`,-25);

    if(completed>=3)score+=addFactor(factors,`${completed} parcelamento(s)/contrato(s) concluído(s) na clínica.`,95);
    else if(completed>=1)score+=addFactor(factors,`${completed} histórico(s) concluído(s) na clínica.`,45);
    else if(contracts>0)score+=addFactor(factors,'Há histórico interno, mas sem conclusão completa registrada.',-10);
    else score+=addFactor(factors,'Sem histórico interno suficiente na clínica.',-20);

    if(delays===0 && completed>0)score+=addFactor(factors,'Histórico sem atrasos registrados.',45);
    else if(delays===1)score+=addFactor(factors,'Um atraso registrado no histórico.',-35);
    else if(delays<=3 && delays>1)score+=addFactor(factors,`${delays} atrasos registrados.`,-85);
    else if(delays>3)score+=addFactor(factors,`${delays} atrasos registrados.`,-155);

    if(maxDelay>60)score+=addFactor(factors,`Maior atraso acima de 60 dias (${maxDelay} dias).`,-110);
    else if(maxDelay>30)score+=addFactor(factors,`Maior atraso acima de 30 dias (${maxDelay} dias).`,-70);
    else if(maxDelay>15)score+=addFactor(factors,`Maior atraso relevante (${maxDelay} dias).`,-35);

    if(noShows>=3)score+=addFactor(factors,`${noShows} faltas registradas.`,-85);
    else if(noShows>0)score+=addFactor(factors,`${noShows} falta(s) registrada(s).`,-35);

    if(reneg>=2)score+=addFactor(factors,`${reneg} renegociação(ões) encontrada(s).`,-75);
    else if(reneg===1)score+=addFactor(factors,'Uma renegociação encontrada no histórico.',-38);

    score=Math.max(0,Math.min(1000,Math.round(score)));
    const top=[...factors].sort((a,b)=>Math.abs(b.impact)-Math.abs(a.impact)).slice(0,3);
    return {score,classInfo:riskClass(score),recommendation:riskRecommendation(score),factors:top,allFactors:factors,inputs:{total:effectiveTotal,entry:entry||0,entryPct,financed,months,payment,income:income||0,ratePct:ratePct||0},createdAt:new Date().toISOString()};
  }

  function animateRiskScore(finalScore){
    const donut=$('riskDonut'), scoreEl=$('riskScoreNumber'), process=$('riskProcess');
    if(!donut||!scoreEl)return;
    const steps=['analisando entrada...','verificando parcelas...','cruzando histórico...','calculando score...'];
    const start=performance.now(), dur=1100;
    function tick(now){
      const t=Math.min(1,(now-start)/dur);
      const eased=1-Math.pow(1-t,3);
      const cur=Math.round(finalScore*eased);
      donut.style.setProperty('--p',String(cur/10));
      scoreEl.textContent=String(cur);
      if(process)process.textContent=steps[Math.min(steps.length-1,Math.floor(t*steps.length))];
      if(t<1)requestAnimationFrame(tick);
      else if(process)process.textContent='análise concluída.';
    }
    requestAnimationFrame(tick);
  }

  function calculateRisk(){
    const res=calculateRiskScore();
    if(res.error){S.risk.error=res.error;S.risk.result=null;return render();}
    S.risk.error='';
    S.risk.result=res;
    S.risk.dirty=false;
    render();
    setTimeout(()=>animateRiskScore(res.score),40);
  }

  function riskResultHTML(){
    const r=S.risk.result;
    if(!r){
      return `<div class="riskEmpty"><div><b>Análise ainda não calculada</b><p style="margin:8px 0 0">Preencha os dados ou use a simulação acima para gerar um score interno de 0 a 1000. Isso é apoio à decisão, não Serasa de jaleco.</p></div></div>`;
    }
    const p=Math.max(0,Math.min(100,r.score/10));
    return `<div class="riskResult"><div class="riskDonutWrap"><div id="riskDonut" class="riskDonut" style="--p:${p}"><div class="riskDonutCenter"><div class="riskScore"><span id="riskScoreNumber">${r.score}</span><small>/1000</small></div></div></div><div style="display:grid;gap:8px;min-width:210px"><span class="riskClass">${esc(r.classInfo.label)}</span><div class="riskMini">Score interno baseado na proposta atual e no histórico registrado dentro da clínica.</div><div id="riskProcess" class="riskProcess">análise concluída.</div><button class="credBtn" style="width:max-content" onclick="CRONOS_CREDITO.printRiskAnalysis()">Imprimir análise interna</button></div></div><div class="riskDetails"><div class="riskRec"><b>Recomendação do Cronos</b><br>${esc(r.recommendation)}</div><div><b>3 fatores principais</b><div style="display:grid;gap:8px;margin-top:8px">${r.factors.map(f=>`<div class="riskFactor ${f.kind}">${f.impact>=0?'▲':'▼'} ${esc(f.txt)}</div>`).join('')}</div></div></div></div>`;
  }

  function riskAnalysisCard(){
    const ri=S.risk.inputs;
    const hasSim=!!S.result;
    const e=getEntry();
    const dirty=S.risk.dirty;
    return `<div class="credCard riskPanel"><div class="riskHead"><div><h3>Análise Inteligente de Risco</h3><p>Score interno para apoiar decisão de boleto próprio/parcelamento interno. O Cronos cruza dados da proposta com o histórico da clínica — sem fingir que é SPC/Serasa.</p></div><div class="credActions" style="margin-top:0"><button class="credBtn ${hasSim?'primary':''}" ${hasSim?'':'disabled'} onclick="CRONOS_CREDITO.useSimulationForRisk()">Usar dados do simulador de crédito</button><button class="credBtn" onclick="CRONOS_CREDITO.calculateRisk()">Calcular risco</button><button class="credBtn" onclick="CRONOS_CREDITO.clearRisk()">Limpar análise</button></div></div>${dirty?`<div class="riskDirty"><b>Os dados da simulação foram alterados.</b><br>Atualize a análise para usar a última simulação visível na tela. <button class="credBtn" style="margin-left:8px;padding:7px 10px" onclick="CRONOS_CREDITO.useSimulationForRisk()">Atualizar análise</button></div>`:''}${S.risk.error?`<div class="credAlert" style="margin-bottom:12px">${esc(S.risk.error)}</div>`:''}<div class="riskGrid"><div style="display:grid;gap:12px"><div class="riskBlock"><div class="riskBlockTitle">Dados da proposta <span class="credPill">${S.risk.source==='linked'?'vinculado ao lead':S.risk.source==='simulation'?'simulação avulsa':'manual'}</span></div><div class="riskSubgrid"><div><label>Valor total/proposta</label><input id="risk_total" value="${esc(ri.total)}" oninput="CRONOS_CREDITO.riskInput('total',this.value)" placeholder="Ex: 8000,00"></div><div><label>Entrada</label><input id="risk_entry" value="${esc(ri.entry)}" oninput="CRONOS_CREDITO.riskInput('entry',this.value)" placeholder="Ex: 2000,00"></div><div><label>% entrada</label><input id="risk_entryPct" value="${esc(ri.entryPct)}" readonly tabindex="-1" placeholder="auto"></div><div><label>Valor financiado/saldo</label><input id="risk_financed" value="${esc(ri.financed)}" readonly aria-readonly="true" tabindex="-1" placeholder="calculado automaticamente"></div><div><label>Taxa mensal (%)</label><input id="risk_rate" value="${esc(ri.rate)}" oninput="CRONOS_CREDITO.riskInput('rate',this.value)" placeholder="Ex: 2,5"></div><div><label>Parcelas</label><input id="risk_months" value="${esc(ri.months)}" oninput="CRONOS_CREDITO.riskInput('months',this.value)" placeholder="Ex: 12"></div><div><label>Valor da parcela</label><input id="risk_payment" value="${esc(ri.payment)}" oninput="CRONOS_CREDITO.riskInput('payment',this.value)" placeholder="Ex: 580,00"></div><div><label>Renda informada</label><input id="risk_income" value="${esc(ri.income)}" oninput="CRONOS_CREDITO.riskInput('income',this.value)" placeholder="opcional"></div><div><label>Cadastro/documentos</label><select id="risk_doc" onchange="CRONOS_CREDITO.riskInput('doc',this.value)"><option value="complete" ${ri.doc==='complete'?'selected':''}>Completo</option><option value="basic" ${ri.doc==='basic'?'selected':''}>Básico</option><option value="incomplete" ${ri.doc==='incomplete'?'selected':''}>Incompleto</option><option value="none" ${ri.doc==='none'?'selected':''}>Não informado</option></select></div></div><div class="riskMini">O botão acima só usa a simulação válida que está aberta agora. Se ela mudar depois, o Cronos avisa antes de reaproveitar.</div></div><div class="riskBlock"><div class="riskBlockTitle">Histórico interno <span class="credPill">editável</span></div><div class="riskSubgrid two"><div><label>Atrasos anteriores</label><input id="risk_delays" value="${esc(ri.delays)}" oninput="CRONOS_CREDITO.riskInput('delays',this.value)" placeholder="0"></div><div><label>Maior atraso/dias</label><input id="risk_maxDelay" value="${esc(ri.maxDelay)}" oninput="CRONOS_CREDITO.riskInput('maxDelay',this.value)" placeholder="0"></div><div><label>Faltas sem aviso</label><input id="risk_noShows" value="${esc(ri.noShows)}" oninput="CRONOS_CREDITO.riskInput('noShows',this.value)" placeholder="0"></div><div><label>Renegociações</label><input id="risk_reneg" value="${esc(ri.reneg)}" oninput="CRONOS_CREDITO.riskInput('reneg',this.value)" placeholder="0"></div><div><label>Contratos quitados</label><input id="risk_completed" value="${esc(ri.completed)}" oninput="CRONOS_CREDITO.riskInput('completed',this.value)" placeholder="0"></div><div><label>Total contratos</label><input id="risk_contracts" value="${esc(ri.contracts)}" oninput="CRONOS_CREDITO.riskInput('contracts',this.value)" placeholder="0"></div></div><div class="riskMini">${esc(ri.historyNote|| (e?'Use os dados do simulador para puxar o histórico possível deste lead.':'Modo avulso: preencha manualmente se tiver informação.'))}</div></div></div>${riskResultHTML()}</div></div>`;
  }

  function linkedCard(){
    if(S.mode!=='linked')return'';
    const e=getEntry(), db=load(), c=e?contactOf(db,e):null, sug=searchEntries(), opts=e?buildOptions(e):[], sel=selected();
    return `<div class="credCard"><h3>Paciente vinculado</h3>${
      e?`<div class="credSelected"><div><b>${esc(c.name||'(sem nome)')}</b><div class="credMuted">${esc(c.phone||'')}${c.cpf?' • CPF '+esc(c.cpf):''}</div></div><button class="credBtn" onclick="CRONOS_CREDITO.selectEntry('')">Trocar</button></div>${
        opts.length?`<div class="credPlanList">${opts.map(o=>`<button class="credPlan ${sel&&sel.key===o.key?'active':''}" onclick="CRONOS_CREDITO.usePlan('${esc(o.key)}')"><div class="credPlanTop"><div><b>${esc(o.title)}</b><div class="credMuted">${esc(o.subtitle||'')}</div></div><span class="credPill">${esc(o.type)}</span></div><div class="credPills"><span class="credPill">Total ${money(o.total)}</span><span class="credPill">Pago ${money(o.paid)}</span><span class="credPill">Saldo ${money(o.open||o.total)}</span></div></button>`).join('')}</div>`:`<div class="credAlert" style="margin-top:12px"><b>Nenhum plano ativo encontrado para este paciente.</b><br>Use a <b>Simulação livre</b> e informe o valor manualmente.</div>`
      }`:`<label class="credMuted" style="font-weight:800">Buscar por nome, telefone ou CPF</label><input id="credSearch" value="${esc(S.search)}" placeholder="Digite o nome do paciente" oninput="CRONOS_CREDITO.search(this.value)"><div class="credSuggestions">${sug.length?sug.map(x=>`<button class="credSuggestion" onclick="CRONOS_CREDITO.selectEntry('${esc(x.entry.id)}')"><b>${esc(x.contact.name||'(sem nome)')}</b><div class="credMuted">${esc(x.contact.phone||'')} • ${esc(x.entry.treatment||x.entry.tratamento||'Lead')}</div></button>`).join(''):`<div class="credMuted">${String(S.search||'').trim().length<2?'Digite pelo menos 2 letras para buscar.':'Nenhum paciente encontrado com esse nome.'}</div>`}</div>${sug.length>=8?`<div class="credSearchHint">Mostrando os 8 mais relevantes. Digite mais letras para refinar.</div>`:''}`
    }</div>`;
  }
  function calcCard(){
    const r=S.result,e=getEntry(),c=e?contactOf(load(),e):null;
    return `<div class="credCard"><h3>Cálculo financeiro</h3><div class="credMuted" style="margin-bottom:12px">Preencha <b>valor total/proposta</b>, <b>entrada opcional</b>, <b>nº de meses</b> e <b>taxa mensal</b>. O Cronos calcula o <b>saldo financiado</b> e a <b>prestação</b>.</div><div class="credForm"><div><label>Valor total/proposta</label><input id="credTotal" value="${esc(S.inputs.total||'')}" oninput="CRONOS_CREDITO.rememberInputs('total')" placeholder="Ex: 2930,00"></div><div class="credEntryPctGroup"><label>Entrada opcional</label><div class="credEntryPctInline"><input id="credEntry" value="${esc(S.inputs.entry||'')}" oninput="CRONOS_CREDITO.rememberInputs('entry')" placeholder="Ex: 500,00"><input id="credEntryPct" value="${esc(S.inputs.entryPct||'')}" oninput="CRONOS_CREDITO.rememberInputs('entryPct')" title="Digite a porcentagem para o Cronos calcular a entrada" placeholder="Ex: 20%"></div></div><div><label>Valor financiado/saldo</label><input id="credPV" value="${esc(S.inputs.pv||'')}" readonly aria-readonly="true" tabindex="-1" placeholder="calculado automaticamente"></div><div><label>Nº de meses</label><input id="credN" value="${esc(S.inputs.n||'')}" oninput="CRONOS_CREDITO.rememberInputs()" placeholder="Ex: 12"></div><div><label>Taxa de juros mensal (%)</label><input id="credRate" value="${esc(S.inputs.rp||'')}" oninput="CRONOS_CREDITO.rememberInputs()" placeholder="Ex: 2,5"></div><div><label>Valor da prestação</label><input id="credPMT" value="${esc(S.inputs.P||'')}" readonly aria-readonly="true" tabindex="-1" placeholder="calculado automaticamente"></div></div><div class="credActions"><button class="credBtn primary" onclick="CRONOS_CREDITO.calc()">Calcular prestação</button><button class="credBtn" onclick="CRONOS_CREDITO.clear()">Limpar</button>${r?`<button class="credBtn ok" onclick="CRONOS_CREDITO.copy()">Copiar</button>${c?.phone?`<button class="credBtn wa" onclick="CRONOS_CREDITO.whats()">WhatsApp</button>`:''}<button class="credBtn" onclick="CRONOS_CREDITO.print()">Imprimir simulação</button>${e?`<button class="credBtn" onclick="CRONOS_CREDITO.saveHistoryRecord()">Salvar histórico</button>`:''}`:''}</div>${S.error?`<div class="credAlert" style="margin-top:12px">${esc(S.error)}</div>`:''}</div>`;
  }


  function pctOf(v,total){
    if(!Number.isFinite(v)||!Number.isFinite(total)||total<=0)return 0;
    return Math.max(0,Math.min(100,(v/total)*100));
  }
  function simulationCompositionHTML(r){
    const entry=Number(r.entry||0);
    const financed=Number(r.pv||0);
    const interest=Math.max(0,Number(r.interest||0));
    const total=Math.max(0,entry+financed+interest);
    const entryPct=pctOf(entry,total);
    const financedPct=pctOf(financed,total);
    const interestPct=Math.max(0,100-entryPct-financedPct);
    return `<div class="credComposition">
      <h4>Composição da simulação</h4>
      <div class="credStackBar" aria-label="Composição visual da simulação">
        <span class="credStackSeg credSegEntry" style="width:${entryPct}%"></span>
        <span class="credStackSeg credSegFinanced" style="width:${financedPct}%"></span>
        <span class="credStackSeg credSegInterest" style="width:${interestPct}%"></span>
      </div>
      <div class="credLegend">
        <div class="credLegendItem"><span class="credLegendLeft"><span class="credDot credSegEntry"></span>Entrada</span><b>${money(entry)}</b></div>
        <div class="credLegendItem"><span class="credLegendLeft"><span class="credDot credSegFinanced"></span>Valor financiado</span><b>${money(financed)}</b></div>
        <div class="credLegendItem"><span class="credLegendLeft"><span class="credDot credSegInterest"></span>Juros estimados</span><b>${money(interest)}</b></div>
      </div>
      <div class="credMiniNote">Resumo visual para leitura rápida da proposta. A impressão para paciente continua separada.</div>
    </div>`;
  }

  function resultCard(){
    const r=S.result;
    if(!r)return '';
    return `<div class="credCard credResultCard"><div class="credSuccess"><b>Simulação calculada ✅</b><div class="credResult credResultWide"><div class="credBox"><span class="credMuted">Valor total</span><b>${money(r.total||r.pv)}</b></div><div class="credBox"><span class="credMuted">Entrada</span><b>${money(r.entry||0)}</b></div><div class="credBox"><span class="credMuted">Financiado</span><b>${money(r.pv)}</b></div><div class="credBox"><span class="credMuted">Prestação</span><b>${money(r.pmt)}</b></div><div class="credBox"><span class="credMuted">Total geral</span><b>${money(r.totalPaid)}</b></div><div class="credBox"><span class="credMuted">Juros</span><b>${money(r.interest)}</b></div></div><div class="credResultBody"><div class="credSummary">${esc(resultText())}</div>${simulationCompositionHTML(r)}</div></div></div>`;
  }
  function historyCard(){
    const e=getEntry();
    const c=e?contactOf(load(),e):null;
    const list=historyList();

    if(!e){
      return `<div class="credCard credHistory"><h3>Histórico de simulações</h3><div class="credMuted">Selecione um paciente vinculado para ver as simulações salvas dele. Assim o histórico não vira uma lista infinita fazendo cosplay de cartório.</div></div>`;
    }

    return `<div class="credCard credHistory"><h3>Histórico de simulações</h3><div class="credMuted" style="margin-bottom:12px">Mostrando apenas simulações salvas para <b>${esc(c?.name||'este paciente')}</b>. Elas não viram recebimento automaticamente.</div>${list.length?list.map(x=>{
      const r=x.result||{};
      return `<div class="credHistItem"><div><b>${esc(x.sourceTitle||'Simulação')}</b><div class="credMuted">${fmt(String(x.createdAt||'').slice(0,10))} • ${money(r.pv||0)} em ${r.exactMonths?brnum(r.n,2):Math.round(r.n||0)}x de ${money(r.pmt||0)}</div></div><div class="credActions"><button class="credBtn" onclick="CRONOS_CREDITO.copyHistory('${esc(x.id)}')">Copiar</button><button class="credBtn" onclick="CRONOS_CREDITO.printHistory('${esc(x.id)}')">Imprimir</button><button class="credBtn danger" onclick="CRONOS_CREDITO.deleteHistory('${esc(x.id)}')">Apagar</button></div></div>`;
    }).join(''):`<div class="credMuted">Nenhuma simulação salva para este paciente ainda.</div>`}</div>`;
  }
  function refresh(btn){
    try{
      if(btn){
        btn.classList.add('loading');
        btn.disabled=true;
        const txt=btn.querySelector('.credRefreshText');
        if(txt) txt.textContent='Atualizando';
      }
      setTimeout(()=>{
        render();
        toast('Simulador atualizado','Dados recalculados na tela.');
      },420);
    }catch(_){
      if(btn){
        btn.classList.remove('loading');
        btn.disabled=false;
        const txt=btn.querySelector('.credRefreshText');
        if(txt) txt.textContent='Atualizar';
      }
      render();
    }
  }

  function render(){
    const v=ensureView();
    v.innerHTML=`<div class="credWrap"><div class="credHero"><div><h2>Simulador de crédito / pagamento</h2><p>Calcule a prestação a partir do valor total, entrada opcional, saldo financiado, taxa mensal e prazo.<br>Use livremente ou vincule a um paciente para puxar ficha, plano ou recebimentos.</p></div><button class="credBtn primary credRefreshBtn" onclick="CRONOS_CREDITO.refresh(this)"><span class="credRefreshSpinner" aria-hidden="true"></span><span class="credRefreshText">Atualizar</span></button></div><div class="credGrid"><div class="credLeftStack" style="display:grid;gap:16px;align-content:start;align-self:start"><div class="credCard"><h3>Modo da simulação</h3><div class="credMode"><button class="${S.mode==='free'?'active':''}" onclick="CRONOS_CREDITO.setMode('free')">Simulação livre</button><button class="${S.mode==='linked'?'active':''}" onclick="CRONOS_CREDITO.setMode('linked')">Vincular paciente</button></div><p class="credMuted" style="margin-bottom:0">Livre calcula qualquer valor. Vinculada tenta puxar valores reais do paciente.</p></div>${linkedCard()}</div>${calcCard()}</div>${resultCard()}${riskAnalysisCard()}${historyCard()}</div>`;
  }
  async function boot(){
    for(let i=0;i<80;i++){if(document.body&&hasCronos())break;await sleep(150)}
    css();ensureView();ensureNav();recoverBind();
    setInterval(()=>{try{ensureNav()}catch(_){}},7000);
  }
  window.CRONOS_CREDITO={show,render,refresh,setMode,search,selectEntry,usePlan,calc,clear,copy,whats,print,rememberInputs,saveHistoryRecord,copyHistory,printHistory,deleteHistory,riskInput,useSimulationForRisk,calculateRisk,clearRisk,printRiskAnalysis};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot); else boot();
})();
