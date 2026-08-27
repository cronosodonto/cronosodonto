/* =========================================================
   Fluxos assistidos
   ========================================================= */
(function(){
  const BOOT_FLAG = "__CRONOS_FLUXOS_BOOTED__";
  if(window[BOOT_FLAG]) return;
  window[BOOT_FLAG] = true;

  const STYLE_ID = "cronosFluxosStyle";
  const CARD_ID = "cronosFlowSettingsCard";
  const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));
  let settingsReadyRetryTimer = null;
  let settingsReadyRetryCount = 0;
  const $ = (id)=>document.getElementById(id);
  const qs = (sel, root=document)=>root.querySelector(sel);
  const qsa = (sel, root=document)=>Array.from(root.querySelectorAll(sel));

  function hasCronos(){
    return typeof window.loadDB === "function" && typeof window.currentActor === "function" && typeof window.saveDB === "function";
  }

  function load(){ try{ return window.loadDB(); }catch(_){ return null; } }
  function actor(){ try{ return window.currentActor(); }catch(_){ return null; } }
  function save(db, opts={ immediate:true }){ try{ return window.saveDB(db, opts); }catch(e){ console.warn("Fluxos: falha ao salvar", e); } }
  function saveFlowSettings(db){
    try{
      if(typeof window.cronosPersistSettingsPatch === "function"){
        return window.cronosPersistSettingsPatch(db, { assistedFlows:db?.settings?.assistedFlows || [] }, { silent:true });
      }
      return save(db, { immediate:true });
    }catch(e){ console.warn("Fluxos: falha ao salvar configurações", e); }
  }
  function saveBirthdaySetting(db){
    try{
      if(typeof window.cronosPersistSettingsPatch === "function"){
        return window.cronosPersistSettingsPatch(db, { birthdayTemplate:String(db?.settings?.birthdayTemplate || "") }, { silent:true });
      }
      return save(db, { immediate:true });
    }catch(e){ console.warn("Fluxos: falha ao salvar aniversário", e); }
  }
  function toast(title, msg=""){
    try{ if(typeof window.toast === "function") return window.toast(title, msg); }catch(_){}
    console.log("[Fluxos]", title, msg);
  }
  function canSeeFlows(){
    try{ return !window.CRONOS_CAN_SEE_MODULE || window.CRONOS_CAN_SEE_MODULE('flows'); }catch(_){ return true; }
  }
  function canOpenFlows(){
    try{ return !window.CRONOS_CAN_OPEN_MODULE || window.CRONOS_CAN_OPEN_MODULE('flows'); }catch(_){ return true; }
  }
  function denyFlowsAccess(){
    toast("Fluxos indisponíveis", "Este recurso está bloqueado para esta clínica.");
  }
  function escapeHTML(v){
    try{ if(typeof window.escapeHTML === "function") return window.escapeHTML(v); }catch(_){}
    return String(v ?? "").replace(/[&<>\"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }
  function localISODate(date=new Date()){
    const d = date instanceof Date ? date : new Date(date);
    if(isNaN(d)) return "";
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function todayISO(){
    try{ if(typeof window.todayISO === "function") return window.todayISO(); }catch(_){}
    return localISODate(new Date());
  }
  function nowISO(){ return new Date().toISOString(); }
  function uid(prefix="id"){
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  }
  function firstName(name){ return String(name||"").trim().split(/\s+/)[0] || ""; }
  function addDaysISO(iso, days){
    const base = /^\d{4}-\d{2}-\d{2}$/.test(String(iso||"")) ? String(iso) : todayISO();
    const [y,m,d] = base.split("-").map(Number);
    const dt = new Date(y, (m||1)-1, d||1);
    dt.setDate(dt.getDate() + Number(days || 0));
    return localISODate(dt);
  }
  function fmtBR(iso){
    try{ if(typeof window.fmtBR === "function") return window.fmtBR(iso); }catch(_){}
    const s = String(iso||"").slice(0,10);
    const [y,m,d] = s.split("-");
    return y && m && d ? `${d}/${m}/${y}` : s;
  }

  function ensureStore(db){
    db.settings = db.settings || {};
    if(!Array.isArray(db.settings.assistedFlows)) db.settings.assistedFlows = [];
    if(!Array.isArray(db.flowRuns)) db.flowRuns = [];
    return db.settings.assistedFlows;
  }
  function flows(db=load()){
    if(!db) return [];
    return ensureStore(db);
  }
  function getFlow(db, id){
    return flows(db).find(f=>String(f.id)===String(id));
  }
  function getEntry(db, entryId){
    return (db.entries||[]).find(e=>String(e.id)===String(entryId));
  }
  function getContact(db, entry){
    if(!entry) return {};
    return (db.contacts||[]).find(c=>String(c.id)===String(entry.contactId)) || {};
  }
  function clinicName(db, a){
    return db?.settings?.clinicName || db?.settings?.clinic || db?.clinicName || a?.clinicName || a?.masterName || "Mundo Odonto";
  }
  function treatmentLabel(entry){
    if(!entry) return "";
    return entry.treatment === "Outros" ? (entry.treatmentOther || "") : (entry.treatment || entry.treatmentOther || "");
  }
  function applyVars(template, db, entry){
    const c = getContact(db, entry);
    const name = c.name || entry?.name || entry?.lead || "";
    const fn = firstName(name);
    const phone = c.phone || entry?.phone || "";
    const tr = treatmentLabel(entry);
    return String(template||"")
      .replaceAll("{nome}", name)
      .replaceAll("{primeiroNome}", fn || name)
      .replaceAll("{primeiro_nome}", fn || name)
      .replaceAll("{tratamento}", tr)
      .replaceAll("{telefone}", phone)
      .replaceAll("{clinica}", clinicName(db, actor()))
      .replaceAll("{hoje}", fmtBR(todayISO()))
      .replaceAll("{data}", fmtBR(todayISO()));
  }

  function addStyles(){
    if($(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .flowSettingsCard{position:relative}
      .flowHeader{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap}
      .flowActions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .flowIntroSurface{
        display:flex;align-items:center;justify-content:space-between;gap:22px;
        border:1px solid var(--line,rgba(148,163,184,.18));border-radius:22px;padding:20px 22px;
        background:linear-gradient(145deg,rgba(37,99,235,.075),rgba(20,184,166,.035) 46%,rgba(255,255,255,.025));
        box-shadow:0 12px 30px rgba(2,6,23,.045)
      }
      .flowIntroCopy{display:flex;align-items:center;gap:14px;min-width:0}
      .flowIntroIcon{width:48px;height:48px;border-radius:15px;display:grid;place-items:center;flex:0 0 auto;background:linear-gradient(145deg,rgba(37,99,235,.18),rgba(20,184,166,.12));border:1px solid rgba(96,165,250,.24)}
      .flowIntroIcon svg{width:25px;height:25px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .flowEyebrow{font-size:11px;font-weight:850;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#8b93a7);margin-bottom:3px}
      .flowIntroTitle{font-size:17px;font-weight:850;line-height:1.25}
      .flowIntroText{font-size:12.5px;color:var(--muted,#8b93a7);line-height:1.55;margin-top:4px;max-width:720px}
      .flowOverview{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px}
      .flowStatChip{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border-radius:999px;border:1px solid var(--line,rgba(148,163,184,.17));background:rgba(255,255,255,.025);font-size:11.5px;color:var(--muted,#8b93a7)}
      .flowStatChip b{color:var(--text);font-size:12px}
      .flowSectionHead{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin:22px 2px 10px}
      .flowSectionHead h4{margin:0;font-size:15px}
      .flowSectionHead .muted{font-size:12px;margin-top:3px}
      .flowSearchWrap{display:flex;align-items:center;gap:8px;min-width:min(360px,100%);justify-content:flex-end}
      .flowSearchBox{position:relative;display:flex;align-items:center;min-width:min(330px,100%)}
      .flowSearchIcon{position:absolute;left:12px;width:17px;height:17px;opacity:.62;pointer-events:none}
      .flowSearchInput{width:100%;height:40px;padding:0 38px 0 38px;border-radius:13px;border:1px solid var(--line,rgba(148,163,184,.18));background:rgba(255,255,255,.03);color:var(--text);outline:none;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}
      .flowSearchInput:focus{border-color:rgba(59,130,246,.46);box-shadow:0 0 0 3px rgba(59,130,246,.10)}
      .flowSearchInput::placeholder{color:var(--muted,#8b93a7);opacity:.82}
      .flowSearchClear{position:absolute;right:7px;width:27px;height:27px;border:0;border-radius:9px;background:transparent;color:var(--muted,#8b93a7);cursor:pointer;display:none;place-items:center;font-size:18px;line-height:1}
      .flowSearchClear.isVisible{display:grid}
      .flowSearchClear:hover{background:rgba(148,163,184,.10);color:var(--text)}
      .flowSearchResult{font-size:11.5px;color:var(--muted,#8b93a7);white-space:nowrap}
      .flowNoSearchResults{display:none;align-items:center;justify-content:center;min-height:130px;text-align:center;padding:24px;border:1px dashed var(--line,rgba(148,163,184,.26));border-radius:20px;background:rgba(255,255,255,.015)}
      .flowNoSearchResults.isVisible{display:flex}
      .flowNoSearchResults strong{display:block;margin-bottom:5px;color:var(--text)}
      .flowGrid{display:grid;gap:14px}
      .flowCard{border:1px solid var(--line,rgba(148,163,184,.18));border-radius:20px;padding:0;background:rgba(255,255,255,.028);box-shadow:0 10px 26px rgba(2,6,23,.04);overflow:hidden}
      .flowCardTop{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:18px;padding:17px 18px 15px}
      .flowCardIdentity{display:flex;gap:12px;min-width:0}
      .flowCardIcon{width:39px;height:39px;border-radius:12px;display:grid;place-items:center;flex:0 0 auto;background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.18);font-size:17px}
      .flowCardText{min-width:0}
      .flowTitleRow{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
      .flowTitle{font-weight:850;font-size:15px;line-height:1.25}
      .flowStatusBadge{display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:999px;font-size:10.5px;font-weight:750;border:1px solid var(--line,rgba(148,163,184,.16));background:rgba(255,255,255,.025);color:var(--muted,#8b93a7)}
      .flowStatusBadge::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.8}
      .flowStatusBadge.isActive{color:#16a34a;background:rgba(34,197,94,.07);border-color:rgba(34,197,94,.16)}
      .flowMeta{font-size:12px;color:var(--muted,#8b93a7);line-height:1.45;margin-top:4px}
      .flowTimeline{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:0 18px 15px 69px}
      .flowStepChip{display:inline-flex;align-items:center;gap:7px;min-width:0;padding:6px 9px;border-radius:10px;border:1px solid var(--line,rgba(148,163,184,.15));background:rgba(255,255,255,.022);font-size:11px;color:var(--muted,#8b93a7)}
      .flowStepChip b{font-size:10px;color:var(--text);font-weight:850}
      .flowStepChip span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}
      .flowCardFooter{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line,rgba(148,163,184,.14));padding:10px 14px 11px 18px;background:rgba(255,255,255,.018)}
      .flowCardFooter .flowMeta{margin:0}
      .flowCardFooter .btn{min-height:34px}
      .flowEmpty{display:flex;align-items:center;justify-content:center;min-height:150px;text-align:center;padding:24px;border:1px dashed var(--line,rgba(148,163,184,.26));border-radius:20px;background:rgba(255,255,255,.015)}
      .flowEmpty strong{display:block;margin-bottom:5px;color:var(--text)}
      .flowStepBox{border:1px solid var(--line,rgba(148,163,184,.18));border-radius:18px;padding:15px 16px;margin:12px 0;background:rgba(255,255,255,.025);box-shadow:0 8px 22px rgba(2,6,23,.035)}
      .flowStepHead{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px}
      .flowStepLabel{display:flex;align-items:center;gap:9px}
      .flowStepIndex{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-size:11px;font-weight:850;background:rgba(56,189,248,.09);border:1px solid rgba(56,189,248,.18)}
      .flowStepHead b{font-size:13px}
      .flowHelp{font-size:12px;color:var(--muted,#8b93a7);line-height:1.45}
      .flowTwo{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:12px}
      .flowThree{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
      .flowEditor{display:flex;flex-direction:column;gap:14px}
      .flowEditorBasics{border:1px solid var(--line,rgba(148,163,184,.18));border-radius:18px;padding:16px;background:rgba(255,255,255,.025)}
      .flowEditorSectionHead{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:2px}
      .flowEditorSectionHead h4{margin:0;font-size:14px}
      .flowEditor textarea{min-height:100px}
      .flowLeadBtn{white-space:nowrap}
      .flowRunBadge{display:inline-flex;border:1px solid var(--line,rgba(255,255,255,.12));border-radius:999px;padding:3px 8px;font-size:11px;color:var(--muted,#8b93a7);margin-top:5px}
      .settingsAccCard{overflow:hidden;transition:box-shadow .15s ease}
      .settingsAccHeader{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;background:transparent;border:0;color:inherit;text-align:left;cursor:pointer;padding:0;margin:0}
      .settingsAccTitle{display:flex;align-items:center;gap:8px;min-width:0}
      .settingsAccTitle h3{margin:0;font-size:16px}
      .settingsAccSummary{font-size:12px;color:var(--muted,#8b93a7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:420px}
      .settingsAccChevron{width:16px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;background:transparent;border:0;color:var(--muted,#8b93a7);font-size:20px;line-height:1;transition:.15s ease}
      .settingsAccCard.isOpen .settingsAccChevron{transform:rotate(90deg);color:inherit}
      .settingsAccBody{padding-top:12px;display:none}
      .settingsAccCard.isOpen .settingsAccBody{display:block}
      .settingsMsgSubCard{border:1px solid var(--line,rgba(255,255,255,.12));border-radius:14px;padding:12px;margin-top:12px;background:rgba(255,255,255,.03)}
      .settingsMsgSubCard h4{margin:0 0 8px;font-size:14px}
      .settingsMsgSubCard textarea{min-height:100px}
      .settingsMsgHint{font-size:12px;color:var(--muted,#8b93a7);line-height:1.45;margin:6px 0 10px}
      @media(max-width:760px){
        .flowTwo,.flowThree{grid-template-columns:1fr}
        .flowIntroSurface{align-items:flex-start;flex-direction:column}
        .flowIntroSurface .flowActions{width:100%}.flowIntroSurface .flowActions .btn{width:100%;justify-content:center}
        .flowCardTop{grid-template-columns:1fr}.flowTimeline{padding-left:18px}.flowCardFooter{align-items:flex-start}
        .flowSectionHead{align-items:stretch;flex-direction:column}.flowSearchWrap,.flowSearchBox{width:100%;min-width:0}.flowSearchResult{display:none}
        .settingsAccSummary{max-width:190px}.settingsAccTitle h3{font-size:15px}
      }

      /* Fluxos — contraste dedicado no modo claro. Evita cards lavados sobre o fundo branco. */
      :root.light .flowIntroSurface,html.light .flowIntroSurface,body.light .flowIntroSurface{
        background:linear-gradient(145deg,rgba(37,99,235,.11),rgba(20,184,166,.055) 48%,rgba(255,255,255,.96));
        border-color:rgba(15,23,42,.13);box-shadow:0 13px 32px rgba(15,23,42,.075)
      }
      :root.light .flowCard,html.light .flowCard,body.light .flowCard{
        background:#fff;border-color:rgba(15,23,42,.13);box-shadow:0 10px 27px rgba(15,23,42,.085)
      }
      :root.light .flowCardFooter,html.light .flowCardFooter,body.light .flowCardFooter{background:rgba(248,250,252,.92);border-top-color:rgba(15,23,42,.09)}
      :root.light .flowStepChip,html.light .flowStepChip,body.light .flowStepChip,
      :root.light .flowStatChip,html.light .flowStatChip,body.light .flowStatChip{background:rgba(248,250,252,.96);border-color:rgba(15,23,42,.11)}
      :root.light .flowCardIcon,html.light .flowCardIcon,body.light .flowCardIcon{background:rgba(37,99,235,.09);border-color:rgba(37,99,235,.19);color:#2563eb}
      :root.light .flowStatusBadge,html.light .flowStatusBadge,body.light .flowStatusBadge{background:#f8fafc;border-color:rgba(15,23,42,.11);color:#64748b}
      :root.light .flowStatusBadge.isActive,html.light .flowStatusBadge.isActive,body.light .flowStatusBadge.isActive{background:rgba(34,197,94,.10);border-color:rgba(22,163,74,.19);color:#15803d}
      :root.light .flowSearchInput,html.light .flowSearchInput,body.light .flowSearchInput{background:#fff;border-color:rgba(15,23,42,.14);color:#0f172a;box-shadow:0 5px 16px rgba(15,23,42,.055)}
      :root.light .flowSearchInput:focus,html.light .flowSearchInput:focus,body.light .flowSearchInput:focus{border-color:rgba(37,99,235,.42);box-shadow:0 0 0 3px rgba(37,99,235,.09),0 5px 16px rgba(15,23,42,.055)}
      :root.light .flowSearchClear:hover,html.light .flowSearchClear:hover,body.light .flowSearchClear:hover{background:#f1f5f9}
      :root.light .flowNoSearchResults,html.light .flowNoSearchResults,body.light .flowNoSearchResults{background:rgba(248,250,252,.78);border-color:rgba(15,23,42,.14)}

      /* Configurações — launcher modular 3x2. A lógica dos cards continua intacta. */
      #view-settings.settingsModulesReady > .card{display:none!important}
      #view-settings .settingsModulesHome{
        display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;
        width:min(980px,100%);margin:18px auto 0;padding:4px 2px 26px;
      }
      #view-settings .settingsModuleTile{
        min-width:0;min-height:176px;border:1px solid var(--line,rgba(148,163,184,.20));
        border-radius:22px;background:rgba(255,255,255,.035);color:var(--text);
        display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
        padding:20px 14px;cursor:pointer;text-align:center;box-shadow:0 12px 28px rgba(2,6,23,.07);
        transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease,background .16s ease;
      }
      #view-settings .settingsModuleTile:hover{transform:translateY(-2px);border-color:rgba(56,189,248,.52);box-shadow:0 16px 32px rgba(14,116,144,.12)}
      #view-settings .settingsModuleIcon{
        width:92px;height:92px;border-radius:22px;display:grid;place-items:center;
        background:linear-gradient(145deg,rgba(37,99,235,.18),rgba(20,184,166,.12));
        border:1px solid rgba(96,165,250,.28);box-shadow:inset 0 0 0 1px rgba(255,255,255,.035);
      }
      #view-settings .settingsModuleIcon svg{width:46px;height:46px;display:block;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
      #view-settings .settingsModuleName{font-size:15px;line-height:1.25;font-weight:800;max-width:200px}
      #view-settings .settingsModuleNav{display:none;align-items:center;gap:12px;padding:18px clamp(18px,3vw,44px) 14px;border-bottom:1px solid var(--line,rgba(148,163,184,.18))}
      #view-settings .settingsModuleBack{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line,rgba(148,163,184,.24));background:rgba(255,255,255,.04);color:inherit;border-radius:12px;padding:9px 13px;cursor:pointer;font-weight:750}
      #view-settings .settingsModuleBack svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
      #view-settings .settingsModuleNavText{min-width:0;display:flex;flex-direction:column;gap:2px}
      #view-settings .settingsModuleNavText strong{font-size:17px}.settingsModuleNavText small{font-size:12px;color:var(--muted,#8b93a7)}
      #view-settings.settingsModuleOpen > .topbar,#view-settings.settingsModuleOpen > .settingsModulesHome{display:none!important}
      #view-settings.settingsModuleOpen > .settingsModuleNav{display:flex}
      #view-settings.settingsModuleOpen > .card.settingsModuleActive{
        display:block!important;width:100%;max-width:none;min-height:calc(100dvh - 126px);margin:0!important;
        border-radius:0!important;border-left:0!important;border-right:0!important;padding:24px clamp(18px,3vw,44px) 42px!important;
        box-shadow:none!important;background:transparent!important;overflow:visible!important;
      }
      /* O conteúdo já existente fica aberto; só escondemos o cabeçalho de acordeão nesta visão. */
      #view-settings.settingsModuleOpen > .card.settingsModuleActive > .settingsAccHeader{display:none!important}
      #view-settings.settingsModuleOpen > .card.settingsModuleActive > .settingsAccBody{display:block!important;padding-top:0!important;max-width:1180px;margin:0 auto;display:flex!important;flex-direction:column;gap:18px}
      #view-settings .settingsSectionLead{font-size:13px;line-height:1.65;color:var(--muted,#8b93a7);margin:0}
      #view-settings .settingsSurface,
      #view-settings .settingsMsgSubCard{
        border:1px solid var(--line,rgba(148,163,184,.18));
        border-radius:22px;padding:20px 22px;background:rgba(255,255,255,.03);
        box-shadow:0 12px 30px rgba(2,6,23,.05);
      }
      #view-settings .settingsSurface + .settingsSurface,
      #view-settings .settingsSurface + .settingsMsgSubCard,
      #view-settings .settingsMsgSubCard + .settingsSurface,
      #view-settings .settingsMsgSubCard + .settingsMsgSubCard{margin-top:0}
      #view-settings .settingsSurface h4,
      #view-settings .settingsMsgSubCard h4{margin:0 0 8px;font-size:16px;line-height:1.35}
      #view-settings .settingsMsgSubCard .settingsMsgHint{margin:0 0 12px}
      #view-settings .settingsFormGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
      #view-settings .settingsIdentityTop{display:flex;flex-direction:column;gap:14px}
      #view-settings .settingsActionRow{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:2px}
      #view-settings .settingsActionRow .muted{font-size:12px}
      #view-settings .settingsInlineChip,
      #view-settings #professionalsCountHint,
      #view-settings #proceduresCountHint{
        display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:999px;
        border:1px solid rgba(56,189,248,.22);background:rgba(56,189,248,.08);color:var(--muted,#8b93a7);
        font-size:12px;line-height:1.2
      }
      #view-settings .settingsActionSurface{
        width:min(760px,100%);padding:26px 28px;display:flex;flex-direction:column;gap:14px
      }
      #view-settings .settingsActionSurface .settingsActionRow{margin-top:0}
      #view-settings .settingsActionSurface .btn{align-self:flex-start}
      #view-settings .settingsActionNote{font-size:12px;line-height:1.55;color:var(--muted,#8b93a7)}
      #view-settings .settingsPaneTitle{display:flex;flex-direction:column;gap:4px;margin-bottom:2px}
      #view-settings .settingsPaneTitle strong{font-size:18px;line-height:1.25}
      #view-settings .settingsPaneTitle small{font-size:12px;color:var(--muted,#8b93a7)}
      #view-settings textarea{min-height:120px}
      #view-settings #settingsBrandingCard .procGrid,
      #view-settings #clinicBrandingMergedBlock .procGrid{grid-template-columns:1.12fr .88fr!important;gap:18px}
      #view-settings .brandRow{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
      #view-settings .brandPreview{min-width:72px;min-height:72px;border-radius:18px;padding:8px;background:rgba(255,255,255,.04);border:1px solid var(--line,rgba(148,163,184,.18))}
      html.light #view-settings .settingsModuleTile,body.light #view-settings .settingsModuleTile,:root.light #view-settings .settingsModuleTile{background:rgba(255,255,255,.84);border-color:rgba(37,99,235,.12);box-shadow:0 13px 30px rgba(15,23,42,.07)}
      html.light #view-settings .settingsSurface,
      html.light #view-settings .settingsMsgSubCard,
      body.light #view-settings .settingsSurface,
      body.light #view-settings .settingsMsgSubCard,
      :root.light #view-settings .settingsSurface,
      :root.light #view-settings .settingsMsgSubCard{background:rgba(255,255,255,.88);border-color:rgba(37,99,235,.12);box-shadow:0 16px 34px rgba(15,23,42,.06)}
      html.light #view-settings .settingsModuleTile:hover,body.light #view-settings .settingsModuleTile:hover,:root.light #view-settings .settingsModuleTile:hover{background:#fff;border-color:rgba(14,165,233,.38);box-shadow:0 17px 36px rgba(14,116,144,.10)}
      html.light #view-settings .settingsModuleIcon,body.light #view-settings .settingsModuleIcon,:root.light #view-settings .settingsModuleIcon{background:linear-gradient(145deg,#eef6ff,#eefcf8);border-color:rgba(37,99,235,.16);color:#1677d2}
      @media(max-width:900px){
        #view-settings .settingsModulesHome{grid-template-columns:repeat(2,minmax(0,1fr));max-width:700px}
        #view-settings .settingsFormGrid,
        #view-settings #settingsBrandingCard .procGrid,
        #view-settings #clinicBrandingMergedBlock .procGrid{grid-template-columns:1fr!important}
      }
      @media(max-width:560px){
        #view-settings .settingsModulesHome{grid-template-columns:1fr;gap:14px}
        #view-settings .settingsModuleTile{min-height:150px}
        #view-settings .settingsModuleIcon{width:78px;height:78px}
        #view-settings .settingsModuleIcon svg{width:40px;height:40px}
        #view-settings.settingsModuleOpen > .card.settingsModuleActive{padding:18px 14px 28px!important}
        #view-settings.settingsModuleOpen > .card.settingsModuleActive > .settingsAccBody{gap:14px}
        #view-settings .settingsSurface,
        #view-settings .settingsMsgSubCard,
        #view-settings .settingsActionSurface{padding:16px}
      }
    `;
    document.head.appendChild(style);
  }


  function getBirthdayTemplateDefault(){
    return `Oi, {primeiroNome}! Feliz aniversário! 🥳\n\nA equipe da {clinica} deseja um novo ciclo cheio de saúde, alegria e muitos motivos pra sorrir.\n\nE pra comemorar com você, queremos te oferecer uma limpeza de cortesia. Se quiser aproveitar, posso ver um horário disponível pra você.`;
  }
  function settingsHost(){ return $("view-settings"); }
  function topLevelSettingsCards(){
    const host = settingsHost();
    if(!host) return [];
    return qsa(':scope > .card', host);
  }

  function isPrimaryClinicIdentityCard(card){
    return !!(card && (qs('#clinicDisplayName', card) || qs('#clinicOwnerEmail', card) || qs('#btnSaveClinicIdentity', card)));
  }

  function isBrandingIdentityCard(card){
    return !!(card && (card.id === 'settingsBrandingCard' || qs('#brandClinicName', card) || qs('#brandLogoInput', card) || qs('#btnSaveBranding', card)));
  }

  function primaryClinicIdentityCard(){
    const cards = topLevelSettingsCards();
    return cards.find(isPrimaryClinicIdentityCard)
      || cards.find(card=>{
        const title = String(inferCardTitle(card) || '').toLowerCase();
        return title.includes('identidade da clínica') && !isBrandingIdentityCard(card);
      })
      || null;
  }

  function allBrandingIdentityCards(){
    const host = settingsHost();
    if(!host) return [];
    const candidates = []
      .concat(qsa('#settingsBrandingCard', host))
      .concat(qsa('#brandClinicName', host).map(x=>x.closest('.card')).filter(Boolean))
      .concat(qsa('#brandLogoInput', host).map(x=>x.closest('.card')).filter(Boolean))
      .concat(qsa('#btnSaveBranding', host).map(x=>x.closest('.card')).filter(Boolean));

    return Array.from(new Set(candidates)).filter(Boolean);
  }

  function buildBrandingSubCardFrom(sourceCard){
    const sourceBody = qs(':scope > .settingsAccBody', sourceCard) || sourceCard;

    const sub = document.createElement('div');
    sub.className = 'settingsMsgSubCard';
    sub.id = 'clinicBrandingMergedBlock';

    const title = document.createElement('h4');
    title.textContent = 'Identidade da ficha e impressão';
    sub.appendChild(title);

    const hint = document.createElement('div');
    hint.className = 'settingsMsgHint';
    hint.innerHTML = 'Usada no cabeçalho da ficha do paciente, PDF/impressão e materiais gerados pelo Cronos.';
    sub.appendChild(hint);

    Array.from(sourceBody.childNodes).forEach(node=>{
      if(node.nodeType === 1 && node.tagName === 'H3') return;
      if(node.nodeType === 1 && node.classList?.contains('settingsAccHeader')) return;
      sub.appendChild(node);
    });

    return sub;
  }

  function mergeClinicIdentityCards(){
    const host = settingsHost();
    if(!host) return;

    const primary = primaryClinicIdentityCard();
    if(!primary) return;

    const primaryBody = qs(':scope > .settingsAccBody', primary) || primary;
    let merged = $('clinicBrandingMergedBlock');

    const outsideBrandingCards = allBrandingIdentityCards().filter(card=>{
      if(!card) return false;
      if(card === primary) return false;
      if(primary.contains(card)) return false;
      if(merged && merged.contains(card)) return false;
      return true;
    });

    if(outsideBrandingCards.length){
      const first = outsideBrandingCards.shift();
      const fresh = buildBrandingSubCardFrom(first);
      if(merged && merged.parentNode){
        merged.replaceWith(fresh);
      }else{
        primaryBody.appendChild(fresh);
      }
      merged = fresh;
      first.remove();
    }

    outsideBrandingCards.forEach(card=>card.remove());
  }

  function normalizeClinicIdentityArea(){
    mergeClinicIdentityCards();
  }
  function inferCardTitle(card){
    const direct = qs(':scope > h3', card);
    const wrapped = qs(':scope > .settingsAccHeader h3', card);
    const any = qs('h3', card);
    return String(direct?.textContent || wrapped?.textContent || any?.textContent || '').trim() || 'Configuração';
  }
  function cardSummary(card, title){
    const id = String(card.id || '');
    const low = String(title||'').toLowerCase();
    if(id === CARD_ID) return 'crie sequências manuais para o Hoje no Cronos';
    if(low.includes('identidade')) return 'nome exibido, e-mail do master, logo e identidade da ficha';
    if(low.includes('preferências de mensagens')) return 'WhatsApp, cobrança e aniversariantes';
    if(low.includes('segurança')) return 'senha e acesso do usuário';
    if(low.includes('profissionais')) return 'dentistas e profissionais clínicos da clínica';
    if(low.includes('procedimentos')) return 'catálogo usado na ficha do paciente';
    if(low.includes('plano e assinatura')) return 'plano atual, validade e pagamentos do Cronos';
    return '';
  }
  function closeOtherSettingsCards(except){
    topLevelSettingsCards().forEach(card=>{ if(card !== except) card.classList.remove('isOpen'); });
  }
  function setSettingsCardOpen(card, open){
    if(!card) return;
    if(open){ closeOtherSettingsCards(card); card.classList.add('isOpen'); }
    else card.classList.remove('isOpen');
  }
  function applyAccordionToSettingsCard(card){
    if(!card || card.dataset.settingsAccordion === '1') return;
    if(card.closest('.settingsMsgSubCard')) return;
    const title = inferCardTitle(card);
    const summary = cardSummary(card, title);
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'settingsAccHeader';
    header.innerHTML = `
      <span class="settingsAccTitle">
        <span class="settingsAccChevron">›</span>
        <span>
          <h3>${escapeHTML(title)}</h3>
          ${summary ? `<span class="settingsAccSummary">${escapeHTML(summary)}</span>` : ''}
        </span>
      </span>
    `;
    const body = document.createElement('div');
    body.className = 'settingsAccBody';
    Array.from(card.childNodes).forEach(node=>{
      if(node.nodeType === 1 && node.tagName === 'H3') return;
      body.appendChild(node);
    });
    card.innerHTML = '';
    card.classList.add('settingsAccCard');
    card.appendChild(header);
    card.appendChild(body);
    card.dataset.settingsAccordion = '1';
    header.addEventListener('click', ()=>setSettingsCardOpen(card, !card.classList.contains('isOpen')));
  }
  function applySettingsAccordion(){ topLevelSettingsCards().forEach(applyAccordionToSettingsCard); }
  function findSettingsCardByTextarea(id){ const ta = $(id); return ta?.closest?.('.card') || null; }
  function ensureBirthdayMessageBlock(prefBody){
    if(!prefBody || $('birthdayTemplate')) return;
    const db = load();
    const current = String(db?.settings?.birthdayTemplate || db?.settings?.waBirthdayTemplate || '').trim();
    const block = document.createElement('div');
    block.className = 'settingsMsgSubCard';
    block.id = 'birthdayTemplateSettingsBlock';
    block.innerHTML = `
      <h4>Mensagem de aniversariante</h4>
      <div class="settingsMsgHint">Usada no <b>Hoje no Cronos</b> para pacientes que fazem aniversário no dia. Variáveis: <b>{nome}</b>, <b>{primeiroNome}</b>, <b>{idade}</b>, <b>{clinica}</b>.</div>
      <textarea id="birthdayTemplate" placeholder="Mensagem padrão de aniversário">${escapeHTML(current || getBirthdayTemplateDefault())}</textarea>
      <div style="display:flex; gap:10px; margin-top:10px; align-items:center; flex-wrap:wrap">
        <button class="btn ok" id="btnSaveBirthdayTpl" type="button">Salvar aniversário</button>
        <button class="btn" id="btnResetBirthdayTpl" type="button">Restaurar padrão</button>
        <span class="muted" id="birthdayTplSaved" style="font-size:12px"></span>
      </div>`;
    prefBody.appendChild(block);
  }
  function bindBirthdayTemplateButtons(){
    const saveBtn = $('btnSaveBirthdayTpl');
    const resetBtn = $('btnResetBirthdayTpl');
    const ta = $('birthdayTemplate');
    const hint = $('birthdayTplSaved');
    if(!ta) return;
    try{
      const db = load();
      const current = String(db?.settings?.birthdayTemplate || '').trim();
      if(current && ta.value !== current) ta.value = current;
    }catch(_){ }
    if(saveBtn && saveBtn.dataset.bound !== '1'){
      saveBtn.dataset.bound = '1';
      saveBtn.onclick = ()=>{
        const db = load(); if(!db) return;
        db.settings = db.settings || {};
        db.settings.birthdayTemplate = String(ta.value || '').trim();
        saveBirthdaySetting(db);
        if(hint){ hint.textContent = 'Salvo.'; setTimeout(()=>hint.textContent='', 2000); }
        toast('Mensagem de aniversário salva ✅');
        try{ window.CRONOS_TODAY?.render?.(); }catch(_){ }
      };
    }
    if(resetBtn && resetBtn.dataset.bound !== '1'){
      resetBtn.dataset.bound = '1';
      resetBtn.onclick = ()=>{
        const db = load(); if(!db) return;
        db.settings = db.settings || {};
        db.settings.birthdayTemplate = '';
        ta.value = getBirthdayTemplateDefault();
        saveBirthdaySetting(db);
        if(hint){ hint.textContent = 'Padrão restaurado.'; setTimeout(()=>hint.textContent='', 2000); }
        toast('Padrão restaurado');
        try{ window.CRONOS_TODAY?.render?.(); }catch(_){ }
      };
    }
  }
  function groupMessagePreferences(){
    const host = settingsHost(); if(!host) return;
    const prefCard = findSettingsCardByTextarea('waTemplate'); if(!prefCard) return;
    const prefBody = qs(':scope > .settingsAccBody', prefCard) || prefCard;
    const chargeTextarea = $('waChargeTemplate');
    const chargeCard = chargeTextarea?.closest?.('.card') || null;
    if(chargeCard && chargeCard !== prefCard && host.contains(chargeCard)){
      const sub = document.createElement('div');
      sub.className = 'settingsMsgSubCard';
      sub.id = 'chargeTemplateSettingsBlock';
      Array.from(chargeCard.childNodes).forEach(node=>sub.appendChild(node));
      prefBody.appendChild(sub);
      chargeCard.remove();
    }
    ensureBirthdayMessageBlock(prefBody);
    bindBirthdayTemplateButtons();
  }
  const SETTINGS_MODULES = [
    {key:'identity',title:'Identidade da clínica',subtitle:'Nome, e-mail, logo e identidade da ficha',find:()=>primaryClinicIdentityCard(),icon:`<svg viewBox="0 0 24 24"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/><path d="M9 9h.01M15 9h.01M9 12h.01M15 12h.01"/></svg>`},
    {key:'billing',title:'Plano e assinatura',subtitle:'Plano atual, validade e pagamentos do Cronos',find:()=>$('cronosBillingSettingsCard'),icon:`<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9h18"/><path d="M7 15h4"/><path d="M16.5 13.5v3"/><path d="M15 15h3"/></svg>`},
    {key:'messages',title:'Preferências de mensagens',subtitle:'WhatsApp, cobrança e aniversariantes',find:()=>findSettingsCardByTextarea('waTemplate'),icon:`<svg viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M7.5 9h9M7.5 13h6"/></svg>`},
    {key:'flows',title:'Fluxos assistidos',subtitle:'Sequências manuais para o Hoje no Cronos',find:()=>$(CARD_ID),icon:`<svg viewBox="0 0 24 24"><rect x="3" y="3" width="6" height="6" rx="2"/><rect x="15" y="15" width="6" height="6" rx="2"/><path d="M9 6h4a4 4 0 0 1 4 4v5"/><path d="m14 12 3 3 3-3"/></svg>`},
    {key:'security',title:'Segurança do acesso',subtitle:'Senha e acesso do usuário',find:()=>topLevelSettingsCards().find(card=>inferCardTitle(card).toLowerCase().includes('segurança'))||null,icon:`<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><rect x="9" y="10" width="6" height="5" rx="1"/><path d="M10.5 10V8.5a1.5 1.5 0 0 1 3 0V10"/></svg>`},
    {key:'professionals',title:'Profissionais',subtitle:'Dentistas e profissionais clínicos',find:()=>$('settingsProfessionalsCard'),icon:`<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M16 11h6"/></svg>`},
    {key:'procedures',title:'Procedimentos odontológicos',subtitle:'Catálogo usado na ficha do paciente',find:()=>$('settingsProceduresCard'),icon:`<svg viewBox="0 0 24 24"><path d="M8.7 3.2c1.6 0 2.2 1 3.3 1s1.7-1 3.3-1c2.7 0 4.7 2.2 4.7 5 0 4.7-2.4 11.8-5.1 11.8-1.4 0-1.3-4.5-2.9-4.5S10.5 20 9.1 20C6.4 20 4 12.9 4 8.2c0-2.8 2-5 4.7-5z"/></svg>`}
  ];

  function settingsModuleMetaForCard(card){ return SETTINGS_MODULES.find(meta=>{ try{return meta.find?.()===card}catch(_){return false} }) || null; }

  function ensureSettingsModulesUI(){
    const host=settingsHost(); if(!host) return;
    /* Importante: inicializa uma vez. Nada aqui desmonta/remonta os cards existentes. */
    if(host.dataset.settingsModulesInit==='1') return;

    const home=document.createElement('div');
    home.id='settingsModulesHome'; home.className='settingsModulesHome';
    home.innerHTML=SETTINGS_MODULES.map(meta=>`<button type="button" class="settingsModuleTile" data-settings-module="${escapeHTML(meta.key)}"><span class="settingsModuleIcon">${meta.icon}</span><span class="settingsModuleName">${escapeHTML(meta.title)}</span></button>`).join('');

    const nav=document.createElement('div');
    nav.id='settingsModuleNav'; nav.className='settingsModuleNav';
    nav.innerHTML=`<button type="button" class="settingsModuleBack" data-settings-module-back><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>Configurações</button><div class="settingsModuleNavText"><strong data-settings-module-title>Configurações</strong><small data-settings-module-subtitle></small></div>`;

    const topbar=qs(':scope > .topbar',host);
    if(topbar){ topbar.insertAdjacentElement('afterend',home); home.insertAdjacentElement('afterend',nav); }
    else{ host.insertBefore(nav,host.firstChild); host.insertBefore(home,nav); }

    home.addEventListener('click',event=>{
      const btn=event.target.closest('[data-settings-module]'); if(!btn) return;
      const meta=SETTINGS_MODULES.find(x=>x.key===btn.dataset.settingsModule); if(!meta) return;
      let card=null; try{card=meta.find?.()}catch(_){}
      if(!card){ toast('Configuração indisponível','Este módulo ainda não terminou de carregar.'); return; }
      openSettingsModule(card,meta);
    });
    qs('[data-settings-module-back]',nav)?.addEventListener('click',closeSettingsModule);
    host.dataset.settingsModulesInit='1';
    host.classList.add('settingsModulesReady');
  }

  function openSettingsModule(card,metaOverride=null){
    const host=settingsHost(); if(!host||!card) return;
    const meta=metaOverride||settingsModuleMetaForCard(card)||{title:inferCardTitle(card),subtitle:cardSummary(card,inferCardTitle(card))};
    topLevelSettingsCards().forEach(c=>c.classList.remove('settingsModuleActive'));
    card.classList.add('settingsModuleActive','isOpen');
    const nav=$('settingsModuleNav');
    const title=nav?.querySelector('[data-settings-module-title]'); const sub=nav?.querySelector('[data-settings-module-subtitle]');
    if(title) title.textContent=meta.title||inferCardTitle(card); if(sub) sub.textContent=meta.subtitle||'';
    host.classList.add('settingsModuleOpen');
    try{window.scrollTo({top:0,behavior:'instant'})}catch(_){window.scrollTo(0,0)}
  }

  function closeSettingsModule(){
    const host=settingsHost(); if(!host) return;
    host.classList.remove('settingsModuleOpen');
    topLevelSettingsCards().forEach(c=>c.classList.remove('settingsModuleActive'));
    try{window.scrollTo({top:0,behavior:'instant'})}catch(_){window.scrollTo(0,0)}
  }

  function directChildren(node){ return Array.from(node?.children || []); }
  function wrapElements(elements, className, id=''){
    const nodes=(elements||[]).filter(Boolean);
    if(!nodes.length) return null;
    const parent=nodes[0]?.parentNode; if(!parent) return null;
    if(id){
      const existing=$(id);
      if(existing) return existing;
    }
    const wrap=document.createElement('div');
    wrap.className=className;
    if(id) wrap.id=id;
    parent.insertBefore(wrap,nodes[0]);
    nodes.forEach(node=>wrap.appendChild(node));
    return wrap;
  }
  function buildPaneTitle(title, subtitle=''){
    const box=document.createElement('div');
    box.className='settingsPaneTitle';
    box.innerHTML=`<strong>${escapeHTML(title||'')}</strong>${subtitle?`<small>${escapeHTML(subtitle)}</small>`:''}`;
    return box;
  }
  function normalizeSettingsLayoutInternals(){
    const host=settingsHost(); if(!host) return;

    const identity=primaryClinicIdentityCard();
    const identityBody=qs(':scope > .settingsAccBody', identity) || identity;
    if(identityBody && !$('settingsIdentityPrimaryPanel')){
      const kids=directChildren(identityBody);
      const block=kids.filter(node=>node.id!=='clinicBrandingMergedBlock').slice(0,4);
      const panel=wrapElements(block,'settingsSurface settingsIdentityTop','settingsIdentityPrimaryPanel');
      if(panel && !qs('.settingsPaneTitle', panel)) panel.prepend(buildPaneTitle('Identidade da clínica','Nome exibido, e-mail do master e dados base da clínica.'));
      const grid=qs('.twoCol', panel);
      if(grid) grid.classList.add('settingsFormGrid');
      const actionRow=Array.from(panel.children).find(node=>node.querySelector?.('#btnSaveClinicIdentity'));
      if(actionRow) actionRow.classList.add('settingsActionRow');
      const lead=Array.from(panel.children).find(node=>node.classList?.contains('muted'));
      if(lead) lead.classList.add('settingsSectionLead');
    }
    const branding=$('clinicBrandingMergedBlock');
    if(branding){
      branding.classList.add('settingsSurface');
      if(!qs('.settingsPaneTitle', branding)) branding.prepend(buildPaneTitle('Identidade da ficha e impressão','Cabeçalho do prontuário, PDF e materiais gerados pelo Cronos.'));
      const saveRow=Array.from(branding.children).find(node=>node.querySelector?.('#btnSaveBranding'));
      if(saveRow) saveRow.classList.add('settingsActionRow');
      const lead=Array.from(branding.children).find(node=>node.classList?.contains('settingsMsgHint') || node.classList?.contains('muted'));
      if(lead) lead.classList.add('settingsSectionLead');
    }

    const prefCard=findSettingsCardByTextarea('waTemplate');
    const prefBody=qs(':scope > .settingsAccBody', prefCard) || prefCard;
    if(prefBody && !$('settingsMessagesPrimaryPanel')){
      const kids=directChildren(prefBody);
      const block=[];
      for(const node of kids){
        if(node.classList?.contains('settingsMsgSubCard')) break;
        block.push(node);
      }
      const panel=wrapElements(block,'settingsSurface','settingsMessagesPrimaryPanel');
      if(panel && !qs('.settingsPaneTitle', panel)) panel.prepend(buildPaneTitle('WhatsApp padrão','Mensagem enviada ao lead quando o contato começa.'));
      const actionRow=Array.from(panel.children).find(node=>node.querySelector?.('#btnSavePrefs'));
      if(actionRow) actionRow.classList.add('settingsActionRow');
      const lead=Array.from(panel.children).find(node=>node.classList?.contains('muted'));
      if(lead) lead.classList.add('settingsSectionLead');
    }
    ['chargeTemplateSettingsBlock','birthdayTemplateSettingsBlock'].forEach(id=>{
      const block=$(id); if(!block) return;
      block.classList.add('settingsSurface');
      const actionRow=Array.from(block.children).find(node=>node.querySelector?.('button'));
      if(actionRow) actionRow.classList.add('settingsActionRow');
    });

    const security=topLevelSettingsCards().find(card=>String(inferCardTitle(card)||'').toLowerCase().includes('segurança'));
    const secBody=qs(':scope > .settingsAccBody', security) || security;
    if(secBody && !$('settingsSecurityActionPanel')){
      const panel=wrapElements(directChildren(secBody),'settingsSurface settingsActionSurface','settingsSecurityActionPanel');
      if(panel && !qs('.settingsPaneTitle', panel)) panel.prepend(buildPaneTitle('Segurança do acesso','Troca de senha do usuário logado sem depender do navegador.'));
      const lead=Array.from(panel.children).find(node=>node.classList?.contains('muted'));
      if(lead) lead.classList.add('settingsSectionLead');
      const actionRow=Array.from(panel.children).find(node=>node.querySelector?.('#btnChangeMyPassword'));
      if(actionRow){
        actionRow.classList.add('settingsActionRow');
        const note=Array.from(actionRow.children).find(node=>node.classList?.contains('muted'));
        if(note) note.classList.add('settingsActionNote');
      }
    }

    const billingCard=$('cronosBillingSettingsCard');
    const billingBody=qs(':scope > .settingsAccBody', billingCard) || billingCard;
    if(billingBody && !$('settingsBillingPanel')){
      const panel=wrapElements(directChildren(billingBody),'settingsSurface settingsActionSurface','settingsBillingPanel');
      if(panel && !qs('.settingsPaneTitle', panel)) panel.prepend(buildPaneTitle('Plano e assinatura','Plano atual, validade e pagamentos do Cronos.'));
      const actionRow=Array.from(panel?.children || []).find(node=>node.querySelector?.('#btnBillingOpen, #btnBillingRefresh'));
      if(actionRow) actionRow.classList.add('settingsActionRow');
    }

    [['settingsProfessionalsCard','Gerenciar profissionais','Controle clínico separado dos usuários de acesso.'],['settingsProceduresCard','Catálogo de procedimentos','Base mestre usada no prontuário do paciente.']].forEach(([id,title,subtitle])=>{
      const card=$(id); if(!card) return;
      const body=qs(':scope > .settingsAccBody', card) || card;
      const panelId=id+'Panel';
      if(!$(panelId)){
        const panel=wrapElements(directChildren(body),'settingsSurface settingsActionSurface',panelId);
        if(panel && !qs('.settingsPaneTitle', panel)) panel.prepend(buildPaneTitle(title,subtitle));
        const lead=Array.from(panel.children).find(node=>node.classList?.contains('muted'));
        if(lead) lead.classList.add('settingsSectionLead');
        const rows=Array.from(panel.children).filter(node=>node.querySelector?.('button'));
        rows.forEach(row=>row.classList.add('settingsActionRow'));
        const lastMuted=Array.from(panel.children).reverse().find(node=>node.classList?.contains('procCardHint'));
        if(lastMuted) lastMuted.classList.add('settingsActionNote');
      }
    });
  }

  function enhanceSettingsUI(){
    normalizeClinicIdentityArea();
    groupMessagePreferences();
    normalizeClinicIdentityArea();
    applySettingsAccordion();
    normalizeClinicIdentityArea();
    bindBirthdayTemplateButtons();
    ensureSettingsModulesUI();
    normalizeSettingsLayoutInternals();
  }
  function openSettingsCardById(id){
    const card=$(id); if(!card) return;
    enhanceSettingsUI();
    const meta=settingsModuleMetaForCard(card);
    if(meta) openSettingsModule(card,meta); else setSettingsCardOpen(card,true);
  }

  function ensureSettingsCard(force=false){
    const settings = $("view-settings");
    if(!settings) return;
    let card = $(CARD_ID);
    const visible = canSeeFlows();
    const open = visible && canOpenFlows();
    const accessSignature = `${visible ? 1 : 0}:${open ? 1 : 0}`;
    if(!visible){
      if(card) card.remove();
      return;
    }
    let created = false;
    if(!card){
      card = document.createElement("div");
      card.id = CARD_ID;
      card.className = "card flowSettingsCard";
      const charge = $("waChargeTemplate")?.closest?.(".card");
      if(charge && charge.parentNode === settings) charge.insertAdjacentElement("afterend", card);
      else settings.appendChild(card);
      created = true;
    }
    const accessChanged = card.dataset.flowAccessSignature !== accessSignature;
    if(created || force || !card.dataset.rendered || accessChanged){
      renderSettingsCard();
      card.dataset.rendered = "1";
      card.dataset.flowAccessSignature = accessSignature;
      setTimeout(()=>enhanceSettingsUI(), 0);
    }
  }

  function scheduleSettingsReadyRetry(){
    if(settingsReadyRetryTimer) return;
    if(settingsReadyRetryCount >= 120) return;
    settingsReadyRetryTimer = setTimeout(()=>{
      settingsReadyRetryTimer = null;
      settingsReadyRetryCount += 1;
      try{ ensureSettingsCard(true); }catch(_){}
    }, 500);
  }

  function clearSettingsReadyRetry(){
    if(settingsReadyRetryTimer){
      clearTimeout(settingsReadyRetryTimer);
      settingsReadyRetryTimer = null;
    }
    settingsReadyRetryCount = 0;
  }

  function renderSettingsCard(){
    const card = $(CARD_ID);
    if(!card) return;
    card.classList.remove('settingsAccCard','isOpen');
    delete card.dataset.settingsAccordion;
    const db = load();
    const a = actor();
    if(!canOpenFlows()){
      clearSettingsReadyRetry();
      card.innerHTML = `<h3>Fluxos assistidos</h3><div class="muted" style="line-height:1.5">Este recurso está bloqueado para esta clínica. Para liberar, entre em contato com o suporte.</div>`;
      return;
    }
    if(!db || !a){
      card.innerHTML = `<h3>Fluxos assistidos</h3><div class="muted">Carregando...</div>`;
      scheduleSettingsReadyRetry();
      return;
    }
    clearSettingsReadyRetry();
    const list = flows(db).filter(f=>!f.masterId || f.masterId===a.masterId);
    const activeCount = list.filter(f=>f.active !== false).length;
    const totalSteps = list.reduce((sum,f)=>sum + (Array.isArray(f.steps) ? f.steps.length : 0), 0);
    card.innerHTML = `
      <div class="flowIntroSurface">
        <div>
          <div class="flowIntroCopy">
            <div class="flowIntroIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="3" y="3" width="6" height="6" rx="2"/><rect x="15" y="15" width="6" height="6" rx="2"/><path d="M9 6h4a4 4 0 0 1 4 4v5"/><path d="m14 12 3 3 3-3"/></svg>
            </div>
            <div>
              <div class="flowEyebrow">Automação assistida</div>
              <div class="flowIntroTitle">Organize o acompanhamento sem automatizar o contato</div>
              <div class="flowIntroText">Monte sequências manuais por etapa. O Cronos lembra a equipe no dia certo, mantém o contexto do atendimento e deixa o envio sob controle humano.</div>
            </div>
          </div>
          <div class="flowOverview">
            <span class="flowStatChip"><b>${list.length}</b> ${list.length===1?'fluxo':'fluxos'}</span>
            <span class="flowStatChip"><b>${activeCount}</b> ${activeCount===1?'ativo':'ativos'}</span>
            <span class="flowStatChip"><b>${totalSteps}</b> ${totalSteps===1?'etapa':'etapas'} configuradas</span>
          </div>
        </div>
        <div class="flowActions">
          <button class="btn primary" type="button" onclick="CRONOS_FLUXOS.openEditor()">＋ Novo fluxo</button>
        </div>
      </div>
      <div class="flowSectionHead">
        <div>
          <h4>Fluxos configurados</h4>
          <div class="muted">Edite a sequência, altere o status ou crie um novo acompanhamento.</div>
        </div>
        ${list.length ? `<div class="flowSearchWrap">
          <div class="flowSearchBox">
            <svg class="flowSearchIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.7-3.7"/></svg>
            <input id="flowSettingsSearch" class="flowSearchInput" type="search" autocomplete="off" placeholder="Buscar fluxo, descrição ou etapa..." oninput="CRONOS_FLUXOS.filterSettingsFlows(this.value)"/>
            <button id="flowSettingsSearchClear" class="flowSearchClear" type="button" aria-label="Limpar busca" title="Limpar busca" onclick="CRONOS_FLUXOS.clearSettingsFlowSearch()">×</button>
          </div>
          <span id="flowSettingsSearchResult" class="flowSearchResult">${list.length} ${list.length===1?'fluxo':'fluxos'}</span>
        </div>` : ''}
      </div>
      <div class="flowGrid">
        ${list.length ? list.map(f=>renderFlowTemplateCard(f)).join("") : `<div class="flowEmpty"><div><strong>Nenhum fluxo criado</strong><span class="muted">Crie o primeiro para organizar os próximos contatos sem perder o timing.</span></div></div>`}
      </div>
      ${list.length ? `<div id="flowNoSearchResults" class="flowNoSearchResults"><div><strong>Nenhum fluxo encontrado</strong><span class="muted">Tente outro nome, descrição ou etapa.</span></div></div>` : ''}
    `;
    setTimeout(()=>enhanceSettingsUI(), 0);
  }

  function normalizeFlowSearchText(value){
    try{
      return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
    }catch(_){ return String(value||"").toLowerCase().trim(); }
  }

  function filterSettingsFlows(query=""){
    const card=$(CARD_ID);
    if(!card) return;
    const needle=normalizeFlowSearchText(query);
    const cards=Array.from(card.querySelectorAll(".flowGrid .flowCard"));
    let visible=0;
    cards.forEach(flowCard=>{
      const haystack=normalizeFlowSearchText(flowCard.dataset.flowSearch || flowCard.textContent || "");
      const match=!needle || haystack.includes(needle);
      flowCard.style.display=match ? "" : "none";
      if(match) visible += 1;
    });
    const result=$("flowSettingsSearchResult");
    if(result) result.textContent = needle ? `${visible} de ${cards.length}` : `${cards.length} ${cards.length===1?'fluxo':'fluxos'}`;
    const empty=$("flowNoSearchResults");
    if(empty) empty.classList.toggle("isVisible", !!needle && visible===0);
    const clear=$("flowSettingsSearchClear");
    if(clear) clear.classList.toggle("isVisible", !!query);
  }

  function clearSettingsFlowSearch(){
    const input=$("flowSettingsSearch");
    if(input){ input.value=""; input.focus(); }
    filterSettingsFlows("");
  }

  function renderFlowTemplateCard(f){
    const steps = Array.isArray(f.steps) ? f.steps : [];
    const active = f.active !== false;
    const ordered = steps.slice().sort((a,b)=>Number(a.dayOffset||0)-Number(b.dayOffset||0));
    const summary = ordered.map((s,i)=>`
      <span class="flowStepChip"><b>D+${Number(s.dayOffset||0)}</b><span>${escapeHTML(s.title || `Etapa ${i+1}`)}</span></span>
    `).join("");
    return `
      <div class="flowCard" data-flow-id="${escapeHTML(f.id)}" data-flow-search="${escapeHTML([f.name,f.description,...ordered.map(s=>`${s.title||''} ${s.message||''} ${s.internalNote||s.note||''}`)].join(' '))}">
        <div class="flowCardTop">
          <div class="flowCardIdentity">
            <div class="flowCardIcon" aria-hidden="true">↗</div>
            <div class="flowCardText">
              <div class="flowTitleRow">
                <div class="flowTitle">${escapeHTML(f.name || "Fluxo sem nome")}</div>
                <span class="flowStatusBadge ${active ? "isActive" : ""}">${active ? "Ativo" : "Inativo"}</span>
              </div>
              <div class="flowMeta">${escapeHTML(f.description || "Sem descrição")}</div>
            </div>
          </div>
        </div>
        ${summary ? `<div class="flowTimeline">${summary}</div>` : ""}
        <div class="flowCardFooter">
          <div class="flowMeta">${steps.length} ${steps.length===1?'etapa configurada':'etapas configuradas'}</div>
          <div class="flowActions">
            <button class="btn" type="button" onclick="CRONOS_FLUXOS.openEditor('${escapeHTML(f.id)}')">Editar</button>
            <button class="btn" type="button" onclick="CRONOS_FLUXOS.toggleFlow('${escapeHTML(f.id)}')">${active ? "Desativar" : "Ativar"}</button>
            <button class="btn danger" type="button" onclick="CRONOS_FLUXOS.deleteFlow('${escapeHTML(f.id)}')">Excluir</button>
          </div>
        </div>
      </div>
    `;
  }

  function stepEditorHTML(step={}, idx=0){
    return `
      <div class="flowStepBox" data-step-index="${idx}">
        <div class="flowStepHead">
          <div class="flowStepLabel"><span class="flowStepIndex">${idx+1}</span><b>Etapa ${idx+1}</b></div>
          <button class="btn danger" type="button" onclick="CRONOS_FLUXOS.removeStep(this)">Remover</button>
        </div>
        <div class="flowTwo">
          <div>
            <label>Título da etapa</label>
            <input class="flowStepTitle" value="${escapeHTML(step.title || `Mensagem ${idx+1}`)}" placeholder="Ex: Follow-up 1"/>
          </div>
          <div>
            <label>Intervalo</label>
            <input class="flowStepDays" type="number" min="0" value="${Number(step.dayOffset || 0)}"/>
            <div class="flowHelp">dias após início</div>
          </div>
        </div>
        <div style="margin-top:10px">
          <label>Mensagem para o paciente</label>
          <textarea class="flowStepMessage" placeholder="Oi, {primeiroNome}! ...">${escapeHTML(step.message || "")}</textarea>
          <div class="flowHelp">Variáveis: {nome}, {primeiroNome}, {tratamento}, {clinica}, {hoje}</div>
        </div>
        <div class="flowThree" style="margin-top:10px">
          <div>
            <label>Instrução interna opcional</label>
            <input class="flowStepNote" value="${escapeHTML(step.internalNote || step.note || "")}" placeholder="Ex: enviar vídeo depois da mensagem"/>
          </div>
          <div>
            <label>Link opcional</label>
            <input class="flowStepLink" value="${escapeHTML(step.link || "")}" placeholder="Drive, vídeo, página..."/>
          </div>
          <div>
            <label>Mídia/lembrete opcional</label>
            <input class="flowStepMedia" value="${escapeHTML(step.mediaHint || "")}" placeholder="Ex: vídeo implante.mp4"/>
          </div>
        </div>
      </div>
    `;
  }

  function openEditor(flowId=""){
    if(!canOpenFlows()) return denyFlowsAccess();
    const db = load();
    const a = actor();
    if(!db || !a) return;
    const existing = flowId ? getFlow(db, flowId) : null;
    const flow = existing ? JSON.parse(JSON.stringify(existing)) : {
      id:"",
      name:"",
      description:"",
      active:true,
      steps:[
        { title:"Mensagem inicial", dayOffset:0, message:"Oi, {primeiroNome}! Tudo bem? Passando para saber se você ainda tem interesse em conversar sobre {tratamento}.", internalNote:"", link:"", mediaHint:"" },
        { title:"Reforço", dayOffset:1, message:"Oi, {primeiroNome}! Conseguiu ver minha mensagem anterior? Posso te ajudar com alguma dúvida?", internalNote:"", link:"", mediaHint:"" },
        { title:"Última tentativa", dayOffset:3, message:"Oi, {primeiroNome}! Como não consegui falar com você, vou deixar sua ficha em aberto por aqui. Quando quiser retomar, é só me chamar. 😊", internalNote:"", link:"", mediaHint:"" }
      ]
    };

    openModalSafe({
      title: existing ? "Editar fluxo assistido" : "Novo fluxo assistido",
      sub: "Monte uma sequência manual. O Cronos cria as etapas futuras e joga no Hoje no Cronos.",
      maxWidth:"980px",
      bodyHTML: `
        <div class="flowEditor">
          <div class="flowEditorBasics">
            <div class="twoCol">
              <div>
                <label>Nome do fluxo *</label>
                <input id="flowName" value="${escapeHTML(flow.name || "")}" placeholder="Ex: Follow-up orçamento"/>
              </div>
              <div>
                <label>Status</label>
                <select id="flowActive">
                  <option value="1" ${flow.active!==false ? "selected" : ""}>Ativo</option>
                  <option value="0" ${flow.active===false ? "selected" : ""}>Inativo</option>
                </select>
              </div>
            </div>
            <div style="margin-top:12px">
              <label>Descrição opcional</label>
              <input id="flowDesc" value="${escapeHTML(flow.description || "")}" placeholder="Ex: sequência para paciente que recebeu orçamento e não respondeu"/>
            </div>
          </div>
          <div class="flowEditorSectionHead">
            <div>
              <h4>Etapas do fluxo</h4>
              <div class="flowHelp">Cada etapa entra no Hoje no Cronos conforme o intervalo definido.</div>
            </div>
            <button class="btn" type="button" onclick="CRONOS_FLUXOS.addStep()">＋ Adicionar etapa</button>
          </div>
          <div id="flowStepsWrap">${(flow.steps||[]).map((s,i)=>stepEditorHTML(s,i)).join("")}</div>
        </div>
      `,
      footHTML: `
        <button class="btn" type="button" onclick="CRONOS_FLUXOS.closeModal()">Cancelar</button>
        <button class="btn primary" type="button" onclick="CRONOS_FLUXOS.saveFlow('${escapeHTML(flowId)}')">Salvar fluxo</button>
      `,
      onMount:()=>{}
    });
  }

  function openModalSafe(opts){
    if(typeof window.openModal === "function") return window.openModal(opts);
    alert(opts.title || "Fluxos");
  }
  function closeModal(){
    try{ if(typeof window.closeModal === "function") return window.closeModal(); }catch(_){}
    const bg = $("modalBg");
    if(bg){ bg.classList.remove("show"); bg.setAttribute("aria-hidden","true"); }
  }
  function refreshStepIndexes(){
    qsa("#flowStepsWrap .flowStepBox").forEach((box, idx)=>{
      box.dataset.stepIndex = String(idx);
      const b = qs(".flowStepHead b", box);
      if(b) b.textContent = `Etapa ${idx+1}`;
      const badge = qs(".flowStepIndex", box);
      if(badge) badge.textContent = String(idx+1);
      const title = qs(".flowStepTitle", box);
      if(title && !String(title.value||"").trim()) title.value = `Mensagem ${idx+1}`;
    });
  }
  function addStep(){
    const wrap = $("flowStepsWrap");
    if(!wrap) return;
    const idx = qsa(".flowStepBox", wrap).length;
    wrap.insertAdjacentHTML("beforeend", stepEditorHTML({ title:`Mensagem ${idx+1}`, dayOffset:idx }, idx));
    refreshStepIndexes();
  }
  function removeStep(btn){
    const box = btn?.closest?.(".flowStepBox");
    if(!box) return;
    box.remove();
    refreshStepIndexes();
  }
  function readStepsFromModal(){
    return qsa("#flowStepsWrap .flowStepBox").map((box, idx)=>({
      id: box.dataset.stepId || uid("flowStep"),
      title: String(qs(".flowStepTitle", box)?.value || `Mensagem ${idx+1}`).trim(),
      dayOffset: Math.max(0, parseInt(qs(".flowStepDays", box)?.value || "0", 10) || 0),
      message: String(qs(".flowStepMessage", box)?.value || "").trim(),
      internalNote: String(qs(".flowStepNote", box)?.value || "").trim(),
      link: String(qs(".flowStepLink", box)?.value || "").trim(),
      mediaHint: String(qs(".flowStepMedia", box)?.value || "").trim()
    })).filter(s=>s.message || s.title || s.internalNote || s.link || s.mediaHint);
  }

  function saveFlow(flowId=""){
    if(!canOpenFlows()) return denyFlowsAccess();
    const db = load();
    const a = actor();
    if(!db || !a) return;
    const list = ensureStore(db);
    const name = String($("flowName")?.value || "").trim();
    if(!name) return toast("Informe o nome do fluxo");
    const steps = readStepsFromModal().filter(s=>String(s.message||"").trim());
    if(!steps.length) return toast("Adicione pelo menos uma etapa", "Cada fluxo precisa ter pelo menos uma mensagem para o paciente.");

    steps.sort((x,y)=>Number(x.dayOffset||0)-Number(y.dayOffset||0));
    const now = nowISO();
    let flow = flowId ? getFlow(db, flowId) : null;
    if(!flow){
      flow = { id: uid("flow"), masterId:a.masterId, createdAt:now };
      list.push(flow);
    }
    flow.name = name;
    flow.description = String($("flowDesc")?.value || "").trim();
    flow.active = String($("flowActive")?.value || "1") === "1";
    flow.steps = steps;
    flow.updatedAt = now;
    flow.masterId = flow.masterId || a.masterId;

    saveFlowSettings(db);
    toast("Fluxo salvo ✅", name);
    closeModal();
    renderSettingsCard();
    setTimeout(()=>{ const card=$(CARD_ID); if(card) card.classList.remove('isOpen'); }, 0);
  }

  function toggleFlow(flowId){
    if(!canOpenFlows()) return denyFlowsAccess();
    const db = load();
    const f = getFlow(db, flowId);
    if(!f) return;
    f.active = f.active === false ? true : false;
    f.updatedAt = nowISO();
    saveFlowSettings(db);
    renderSettingsCard();
    setTimeout(()=>openSettingsCardById(CARD_ID), 0);
  }
  function deleteFlow(flowId){
    if(!canOpenFlows()) return denyFlowsAccess();
    const db = load();
    const f = getFlow(db, flowId);
    if(!f) return;
    if(!confirm(`Excluir o fluxo "${f.name || "sem nome"}"?\n\nAs etapas já ativadas em pacientes continuam no histórico.`)) return;
    db.settings.assistedFlows = flows(db).filter(x=>String(x.id)!==String(flowId));
    saveFlowSettings(db);
    renderSettingsCard();
    setTimeout(()=>openSettingsCardById(CARD_ID), 0);
    toast("Fluxo excluído");
  }

  function flowButtonHTML(label=true){
    return `<svg class="cronos-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7h5a4 4 0 0 1 4 4v1"></path><path d="M10 4 7 7l3 3"></path><path d="M17 17h-5a4 4 0 0 1-4-4v-1"></path><path d="m14 20 3-3-3-3"></path><circle cx="7" cy="7" r="2"></circle><circle cx="17" cy="17" r="2"></circle></svg>${label ? `<span>Fluxo assistido</span>` : ``}`;
  }

  function extractEntryIdFromLeadCard(card){
    if(!card) return "";
    const sourceBtn = qs("[onclick*='openLeadEntry']", card) || qs("[data-ficha-entry]", card);
    let entryId = sourceBtn?.getAttribute?.("data-ficha-entry") || "";
    if(!entryId){
      const onclick = String(sourceBtn?.getAttribute?.("onclick") || "");
      const m = onclick.match(/openLeadEntry\(['\"]([^'\"]+)['\"]\)/);
      if(m) entryId = m[1];
    }
    return entryId || "";
  }

  function injectLeadButtons(root=document){
    if(!canOpenFlows()){
      qsa(".cronos-action-flow", root).forEach(btn=>btn.remove());
      qsa(".leadCard", root).forEach(card=>{ delete card.dataset.flowInjected; });
      return;
    }
    qsa(".leadCard", root).forEach(card=>{
      if(card.dataset.flowInjected === "1" && qs(".cronos-action-flow", card)) return;

      const entryId = extractEntryIdFromLeadCard(card);
      if(!entryId) return;

      // Cards novos: Fluxo assistido é ação auxiliar, junto da fileira horizontal.
      const secondaryActions = qs(".leadSecondaryActions", card);
      if(secondaryActions){
        qsa(".cronos-action-flow", secondaryActions).forEach(btn=>btn.remove());
        qsa(".cronos-action-flow", qs(".leadPrimaryActions", card) || card).forEach(btn=>btn.remove());

        const btn = document.createElement("button");
        btn.className = "leadActionSmall leadFlowSmall cronos-action-flow";
        btn.type = "button";
        btn.title = "Ativar fluxo assistido";
        btn.innerHTML = flowButtonHTML(false) + `<span>Fluxo</span>`;
        btn.addEventListener("click", (ev)=>{
          ev.preventDefault();
          ev.stopPropagation();
          openActivateFlow(entryId);
        });

        const taskBtn = Array.from(secondaryActions.querySelectorAll("button"))
          .find(b=>String(b.getAttribute("title") || "").toLowerCase().includes("tarefa"));
        if(taskBtn) secondaryActions.insertBefore(btn, taskBtn);
        else secondaryActions.appendChild(btn);

        card.dataset.flowInjected = "1";
        return;
      }

      // Fallback para cards antigos.
      const actionRow = qs(".leadActionsRow", card);
      if(!actionRow) return;
      qsa(".cronos-action-flow", actionRow).forEach(btn=>btn.remove());
      const btn = document.createElement("button");
      btn.className = "iconBtn flowLeadBtn cronos-action-flow";
      btn.type = "button";
      btn.title = "Ativar fluxo assistido";
      btn.innerHTML = flowButtonHTML(false);
      btn.addEventListener("click", (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        openActivateFlow(entryId);
      });
      actionRow.insertBefore(btn, actionRow.firstChild);
      card.dataset.flowInjected = "1";
    });
  }

  function patchLeadsRender(){
    try{
      if(typeof window.renderLeadsTable === "function" && !window.renderLeadsTable.__fluxosPatched){
        const original = window.renderLeadsTable;
        const wrapped = function(){
          const result = original.apply(this, arguments);
          setTimeout(()=>injectLeadButtons($("view-leads") || document), 0);
          return result;
        };
        wrapped.__fluxosPatched = true;
        window.renderLeadsTable = wrapped;
      }
    }catch(e){ console.warn("Fluxos: patch renderLeadsTable falhou", e); }
  }

  function activeRunsForEntry(db, entryId){
    return (db.flowRuns || []).filter(r=>String(r.entryId)===String(entryId) && r.active !== false);
  }
  function openActivateFlow(entryId){
    if(!canOpenFlows()) return denyFlowsAccess();
    const db = load();
    const a = actor();
    if(!db || !a) return;
    const entry = getEntry(db, entryId);
    if(!entry) return toast("Lead não encontrado");
    const c = getContact(db, entry);
    const available = flows(db).filter(f=>(!f.masterId || f.masterId===a.masterId) && f.active !== false && Array.isArray(f.steps) && f.steps.length);
    const runs = activeRunsForEntry(db, entryId);

    openModalSafe({
      title:"Ativar fluxo assistido",
      sub:`${c.name || "Paciente"} • ${treatmentLabel(entry) || "sem tratamento informado"}`,
      maxWidth:"760px",
      bodyHTML: `
        <div>
          ${runs.length ? `
            <div class="flowStepBox">
              <b>Fluxos ativos neste lead</b>
              <div style="margin-top:8px;display:grid;gap:8px">
                ${runs.map(r=>`<div class="flowRunBadge">${escapeHTML(r.flowName || r.name || "Fluxo")} • iniciado em ${fmtBR(r.startedAt || r.createdAt || "")}</div>`).join("")}
              </div>
            </div>
          ` : ""}
          <div class="twoCol">
            <div>
              <label>Escolha o fluxo</label>
              <select id="activateFlowId" onchange="CRONOS_FLUXOS.previewActivation('${escapeHTML(entryId)}')">
                ${available.length ? available.map(f=>`<option value="${escapeHTML(f.id)}">${escapeHTML(f.name)}</option>`).join("") : `<option value="">Nenhum fluxo ativo criado</option>`}
              </select>
            </div>
            <div>
              <label>Data de início</label>
              <input id="activateFlowStart" type="date" value="${todayISO()}" onchange="CRONOS_FLUXOS.previewActivation('${escapeHTML(entryId)}')"/>
            </div>
          </div>
          <div class="flowHelp" style="margin-top:8px">As etapas aparecem no Hoje no Cronos na data certa. Fluxo não envia nada sozinho; ele orienta a equipe.</div>
          <div id="activateFlowPreview" style="margin-top:12px"></div>
        </div>
      `,
      footHTML: `
        <button class="btn" type="button" onclick="CRONOS_FLUXOS.closeModal()">Cancelar</button>
        <button class="btn primary" type="button" onclick="CRONOS_FLUXOS.activateFlow('${escapeHTML(entryId)}')" ${available.length ? "" : "disabled"}>Ativar fluxo</button>
      `,
      onMount:()=>previewActivation(entryId)
    });
  }
  function previewActivation(entryId){
    const db = load();
    const flow = getFlow(db, $("activateFlowId")?.value || "");
    const box = $("activateFlowPreview");
    if(!box) return;
    if(!flow){
      box.innerHTML = `<div class="muted">Crie um fluxo ativo em Configurações primeiro.</div>`;
      return;
    }
    const start = $("activateFlowStart")?.value || todayISO();
    const steps = (flow.steps||[]).slice().sort((a,b)=>Number(a.dayOffset||0)-Number(b.dayOffset||0));
    box.innerHTML = `
      <div class="flowStepBox">
        <b>Prévia das tarefas geradas</b>
        <div style="display:grid;gap:8px;margin-top:10px">
          ${steps.map((s,i)=>`
            <div class="flowMeta"><b>${escapeHTML(s.title || `Etapa ${i+1}`)}</b> • ${fmtBR(addDaysISO(start, s.dayOffset || 0))} • D+${Number(s.dayOffset||0)}</div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function activateFlow(entryId){
    if(!canOpenFlows()) return denyFlowsAccess();
    const db = load();
    const a = actor();
    if(!db || !a) return;
    ensureStore(db);
    const entry = getEntry(db, entryId);
    if(!entry) return toast("Lead não encontrado");
    const flow = getFlow(db, $("activateFlowId")?.value || "");
    if(!flow) return toast("Escolha um fluxo");
    const start = $("activateFlowStart")?.value || todayISO();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)) return toast("Data inválida");
    const ordered = (flow.steps||[]).slice().sort((a,b)=>Number(a.dayOffset||0)-Number(b.dayOffset||0));
    if(!ordered.length) return toast("Fluxo sem etapas");

    const run = {
      id: uid("flowRun"),
      masterId: a.masterId,
      flowId: flow.id,
      flowName: flow.name,
      entryId: entry.id,
      contactId: entry.contactId || "",
      active: true,
      startedAt: start,
      createdAt: nowISO(),
      createdBy: a.name || a.email || a.username || "Cronos",
      steps: ordered.map((s, idx)=>({
        index: idx+1,
        stepId: s.id || uid("step"),
        title: s.title || `Mensagem ${idx+1}`,
        dayOffset: Number(s.dayOffset || 0),
        dueDate: addDaysISO(start, Number(s.dayOffset || 0)),
        message: applyVars(s.message || "", db, entry),
        rawMessage: s.message || "",
        internalNote: s.internalNote || s.note || "",
        link: s.link || "",
        mediaHint: s.mediaHint || "",
        done: false
      }))
    };

    db.flowRuns.push(run);
    entry.lastUpdateAt = nowISO();
    entry.flowLog = Array.isArray(entry.flowLog) ? entry.flowLog : [];
    entry.flowLog.push({ at:nowISO(), runId:run.id, flowId:flow.id, flowName:flow.name, by:run.createdBy, action:"activated" });

    save(db, { immediate:true });
    closeModal();
    toast("Fluxo ativado ✅", flow.name);
    try{ window.CRONOS_TODAY?.render?.(); }catch(_){}
    try{ window.CRONOS_TODAY?.updateNavCount?.(); }catch(_){}
  }

  function bootObserver(){
    const root = $("app") || document.body;
    if(!root || window.__CRONOS_FLUXOS_OBSERVER__) return;
    window.__CRONOS_FLUXOS_OBSERVER__ = true;
    const obs = new MutationObserver(()=>{
      try{
        ensureSettingsCard();
        enhanceSettingsUI();
        injectLeadButtons($("view-leads") || document);
      }catch(_){}
    });
    obs.observe(root, { childList:true, subtree:true });
  }

  async function boot(){
    for(let i=0;i<80;i++){
      if(document.body && hasCronos()) break;
      await sleep(150);
    }
    addStyles();
    patchLeadsRender();
    ensureSettingsCard();
    enhanceSettingsUI();
    injectLeadButtons($("view-leads") || document);
    bootObserver();
    setInterval(()=>{
      try{
        patchLeadsRender();
        ensureSettingsCard();
        enhanceSettingsUI();
        injectLeadButtons($("view-leads") || document);
      }catch(_){}
    }, 6000);
  }

  window.CRONOS_FLUXOS = {
    openEditor,
    saveFlow,
    addStep,
    removeStep,
    toggleFlow,
    deleteFlow,
    filterSettingsFlows,
    clearSettingsFlowSearch,
    renderSettingsCard,
    ensureSettingsCard,
    enhanceSettingsUI,
    normalizeClinicIdentityArea,
    openSettingsCardById,
    closeSettingsModule,
    injectLeadButtons,
    openActivateFlow,
    activateFlow,
    previewActivation,
    closeModal
  };

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
