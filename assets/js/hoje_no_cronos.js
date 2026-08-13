/* =========================================================
   Hoje no Cronos
   ========================================================= */
(function(){
  const VIEW = "todayCronos";
  const VIEW_ID = "view-todayCronos";
  const NAV_ID = "navHojeCronos";
  const STYLE_ID = "todayCronosStyle";
  const BOOT_FLAG = "__CRONOS_TODAY_BOOTED__";

  if(window[BOOT_FLAG]) return;
  window[BOOT_FLAG] = true;

  const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));
  const $ = (id)=>document.getElementById(id);
  const qs = (sel, root=document)=>root.querySelector(sel);
  const qsa = (sel, root=document)=>Array.from(root.querySelectorAll(sel));

  function uiIconSvg(name){
    const icons = {
      calendar:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"></rect><path d="M8 3.5v4"></path><path d="M16 3.5v4"></path><path d="M3.5 9.5h17"></path><path d="M8 13h3"></path><path d="M13 13h3"></path><path d="M8 16.5h3"></path></svg>`,
      tasks:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="16" rx="3"></rect><path d="M9 4.5h6"></path><path d="M8.5 10.5l1.5 1.5 3-3"></path><path d="M8.5 15.5l1.5 1.5 3-3"></path><path d="M14.5 10.5h2"></path><path d="M14.5 15.5h2"></path></svg>`,
      money:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="6" width="17" height="12" rx="3"></rect><circle cx="12" cy="12" r="3"></circle><path d="M7 12h.01"></path><path d="M17 12h.01"></path></svg>`,
      gift:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h16v10H4z"></path><path d="M12 10v10"></path><path d="M3 10h18"></path><path d="M12 10H8.5a2.5 2.5 0 1 1 0-5c2.1 0 3.5 2.3 3.5 5Z"></path><path d="M12 10h3.5a2.5 2.5 0 1 0 0-5C13.4 5 12 7.3 12 10Z"></path></svg>`,
      flow:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 6h6"></path><path d="M7 18h10"></path><path d="M7 12h10"></path><circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none"></circle><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"></circle><circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none"></circle></svg>`,
      mascot:`<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><defs><linearGradient id="cronosMascotBg" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse"><stop stop-color="#1677ff"></stop><stop offset="1" stop-color="#2ee6a6"></stop></linearGradient><linearGradient id="cronosMascotGlow" x1="14" y1="18" x2="50" y2="40" gradientUnits="userSpaceOnUse"><stop stop-color="#38bdf8"></stop><stop offset="1" stop-color="#67e8f9"></stop></linearGradient></defs><rect x="8" y="10" width="48" height="38" rx="16" fill="url(#cronosMascotBg)"></rect><rect x="14" y="16" width="36" height="26" rx="12" fill="#071326"></rect><path d="M23 27c2.1-4 5.8-4 8 0" stroke="url(#cronosMascotGlow)" stroke-width="4" stroke-linecap="round"></path><path d="M33 27c2.1-4 5.8-4 8 0" stroke="url(#cronosMascotGlow)" stroke-width="4" stroke-linecap="round"></path><path d="M24 34c5.2 5.5 10.8 5.5 16 0" stroke="url(#cronosMascotGlow)" stroke-width="4" stroke-linecap="round"></path><path d="M32 10V6" stroke="#8be9ff" stroke-width="3" stroke-linecap="round"></path><circle cx="32" cy="4" r="2.4" fill="#8be9ff"></circle><path d="M24 50h16" stroke="#86efac" stroke-width="4" stroke-linecap="round"></path><path d="M28 50v5" stroke="#86efac" stroke-width="4" stroke-linecap="round"></path><path d="M36 50v5" stroke="#86efac" stroke-width="4" stroke-linecap="round"></path></svg>`
    };
    return icons[name] || icons.tasks;
  }

  function headerIcon(name){
    return `<span class="todayHeadIcon" aria-hidden="true">${uiIconSvg(name)}</span>`;
  }

  function todayTitleIcon(){
    return `<span class="todayHeadIcon todayTitleSparkIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2l1.55 5.45L19 9l-5.45 1.55L12 16l-1.55-5.45L5 9l5.45-1.55L12 2Z"></path><path d="M19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15Z"></path></svg></span>`;
  }

  const DEFAULT_TODAY_SUGGESTION = {
    iconMode: "mascot",
    iconUrl: "",
    title: "Sugestão do Cronos",
    message: "Comece pelos {agendamentos_vencidos} agendamentos vencidos e pelas tarefas com WhatsApp disponível.",
    buttonText: "Entendi",
    buttonAction: "dismiss"
  };

  function getTodaySuggestionConfig(){
    return {
      ...DEFAULT_TODAY_SUGGESTION,
      ...(TODAY_STATE.todaySuggestion || {})
    };
  }

  function applyTemplate(text, vars){
    return String(text || "")
      .replaceAll("{agendamentos_vencidos}", String(vars.apptOverdueCount ?? 0))
      .replaceAll("{tarefas_abertas}", String(vars.tasksOpenCount ?? 0))
      .replaceAll("{recebimentos_pendentes}", String(vars.receiptsPendingCount ?? 0))
      .replaceAll("{total_atrasados}", String(vars.overdueCount ?? 0))
      .replaceAll("{data_hoje}", String(vars.todayDate || ""));
  }

  function renderSuggestionIcon(config){
    const mode = String(config.iconMode || "mascot");
    const url = String(config.iconUrl || "").trim();

    if(mode === "custom" && url){
      return `<img class="todaySuggestionImg" src="${escapeAttr(url)}" alt="Ícone da sugestão do Cronos" onerror="this.style.display='none';this.parentElement.classList.add('is-fallback');" />`;
    }

    if(mode === "logo"){
      return `<img class="todaySuggestionImg" src="../assets/brand/cronos-symbol-2d.png" alt="Cronos" onerror="this.style.display='none';this.parentElement.classList.add('is-fallback');" />`;
    }

    return uiIconSvg("mascot");
  }

  function escapeAttr(value){
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function suggestionButtonOnclick(action, text){
    const label = String(text || "").trim().toLowerCase();
    const a = String(action || (label === "entendi" ? "dismiss" : "overdue"));
    if(label === "entendi" || a === "dismiss") return `onclick="CRONOS_TODAY.dismissSuggestion(this)"`;
    if(a === "tasks") return `onclick="CRONOS_TODAY.setFilter('tasks')"`;
    if(a === "appointments") return `onclick="CRONOS_TODAY.setFilter('appointments')"`;
    if(a === "none") return "";
    return `onclick="CRONOS_TODAY.setFilter('overdue')"`;
  }

  async function loadTodaySuggestionSettings(){
    if(TODAY_STATE.todaySuggestionLoaded || TODAY_STATE.todaySuggestionLoading) return;
    TODAY_STATE.todaySuggestionLoading = true;
    try{
      if(!window.supabase || !window.supabase.createClient) throw new Error("Supabase indisponível.");
      const client = window.supabase.createClient(
        "https://nsqpslierpulanxvsxaw.supabase.co",
        "sb_publishable_gFddoL8aMpTWJE979hRgvg_dJVackKZ",
        { auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } }
      );
      const { data, error } = await client
        .from("today_cronos_settings")
        .select("suggestion_config, updated_at")
        .eq("id", "default")
        .maybeSingle();
      if(error) throw error;
      const cfg = data?.suggestion_config || {};
      TODAY_STATE.todaySuggestion = { ...DEFAULT_TODAY_SUGGESTION, ...cfg };
      TODAY_STATE.todaySuggestionLoaded = true;
      TODAY_STATE.todaySuggestionLoading = false;
      const view = document.getElementById(VIEW_ID);
      if(view && !view.classList.contains("hidden")) render({ defer:false });
    }catch(err){
      TODAY_STATE.todaySuggestion = TODAY_STATE.todaySuggestion || { ...DEFAULT_TODAY_SUGGESTION };
      TODAY_STATE.todaySuggestionLoaded = true;
      TODAY_STATE.todaySuggestionLoading = false;
      console.warn("Hoje no Cronos: configurações da sugestão não carregadas", err);
    }
  }

  const TODAY_STATE = window.__CRONOS_TODAY_STATE__ || {
    filter: "all",
    visible: { appointments: 3, tasks: 3, receipts: 3, flows: 3, birthdays: 3 },
    loading: false,
    cacheKey: "",
    cacheData: null,
    renderToken: 0,
    todaySuggestion: null,
    todaySuggestionLoaded: false,
    todaySuggestionLoading: false
  };
  window.__CRONOS_TODAY_STATE__ = TODAY_STATE;

  const TODAY_SNAPSHOT_KEY = "cronos_today_last_rendered_v30";

  const TODAY_SUGGESTION_DISMISS_PREFIX = "cronos_today_suggestion_dismissed_";

  function todaySuggestionDismissKey(){
    return TODAY_SUGGESTION_DISMISS_PREFIX + todayISO();
  }

  function isTodaySuggestionDismissed(){
    try{
      return localStorage.getItem(todaySuggestionDismissKey()) === "1";
    }catch(_){
      return !!TODAY_STATE.suggestionDismissed;
    }
  }

  function setTodaySuggestionDismissed(value){
    TODAY_STATE.suggestionDismissed = !!value;
    try{
      if(value) localStorage.setItem(todaySuggestionDismissKey(), "1");
      else localStorage.removeItem(todaySuggestionDismissKey());
    }catch(_){}
  }



  function saveTodaySnapshot(html){
    try{
      if(!html || String(html).includes("todaySkeleton")) return;
      sessionStorage.setItem(TODAY_SNAPSHOT_KEY, String(html));
    }catch(_){}
  }

  function loadTodaySnapshot(){
    try{
      const html = sessionStorage.getItem(TODAY_SNAPSHOT_KEY);
      return html && !String(html).includes("todaySkeleton") ? html : "";
    }catch(_){ return ""; }
  }

  if(!TODAY_STATE.lastRenderedHTML){
    TODAY_STATE.lastRenderedHTML = loadTodaySnapshot();
  }


  function markFilterChipInstant(filter){
    try{
      const f = filter || "all";
      const row = document.querySelector(`#${VIEW_ID} .todayChipRow`);
      if(!row) return;
      row.querySelectorAll(".todayKpi").forEach(btn=>{
        const isActive = String(btn.getAttribute("data-today-filter") || "") === String(f);
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }catch(_){}
  }

  function filterLabel(filter){
    const map = {
      all:"Todos",
      overdue:"Atrasados",
      appointments:"Agendamentos",
      tasks:"Tarefas",
      receipts:"Recebimentos",
      birthdays:"Aniversariantes",
      flows:"Fluxos"
    };
    return map[filter || "all"] || "Hoje no Cronos";
  }

  function filterIcon(filter){
    const map = {
      all:"list",
      overdue:"alert",
      appointments:"calendar",
      tasks:"tasks",
      receipts:"money",
      birthdays:"gift",
      flows:"flow"
    };
    return map[filter || "all"] || "list";
  }

  function setSectionsPending(filter){
    try{
      const f = filter || "all";
      const sections = document.querySelector(`#${VIEW_ID} .todaySections`);
      if(!sections) return;
      sections.setAttribute("data-focus", f);
      sections.classList.add("todaySectionsPending");
      const title = f === "all" ? "Atualizando Hoje no Cronos" : `Atualizando ${filterLabel(f)}`;
      sections.innerHTML = `
        <section class="todayCard todayFull todayLoadingCard" data-section="loading">
          <div class="todayCardHeader">
            <h3>${headerIcon(filterIcon(f))} ${escapeHTML(title)}</h3>
            <span class="todayCountBadge">...</span>
          </div>
          <div class="todayList todayLoadingList">
            <div class="todayPendingBox">
              <span class="todaySpinner"></span>
              <strong>Atualizando visão...</strong>
              <small>Carregando os dados selecionados.</small>
            </div>
          </div>
        </section>
      `;
    }catch(_){}
  }

  function setFilter(filter, ev){
    const f = filter || "all";
    TODAY_STATE.filter = f;
    TODAY_STATE.visible = { appointments: 3, tasks: 3, receipts: 3, flows: 3, birthdays: 3 };

    // Primeiro muda o visual do chip e tira o conteúdo antigo da tela.
    // Depois o Cronos renderiza a lista real.
    markFilterChipInstant(f);
    setSectionsPending(f);

    try{
      clearTimeout(TODAY_STATE.filterRenderTimer);
      TODAY_STATE.filterRenderTimer = setTimeout(()=>render(), 45);
    }catch(_){
      render();
    }
  }

  function showMore(section){
    TODAY_STATE.visible[section] = (TODAY_STATE.visible[section] || 3) + 3;
    render();
  }

  function showLess(section){
    TODAY_STATE.visible[section] = 3;
    render();
  }

  function filterSectionItems(section, items){
    const list = Array.isArray(items) ? items : [];
    const f = TODAY_STATE.filter || "all";

    if(f === "all") return list;
    if(f === "overdue") return list.filter(x=>x.overdue);

    return f === section ? list : [];
  }

  function updateButtonLoading(btn, isLoading){
    if(!btn) return;
    btn.disabled = !!isLoading;
    btn.innerHTML = isLoading ? `<span class="todaySpinner"></span> Atualizando...` : `Atualizar`;
  }

  function scrollCronosToTop(){
    try{ window.scrollTo({ top:0, left:0, behavior:"auto" }); }catch(_){ try{ window.scrollTo(0,0); }catch(__){} }
    try{ document.documentElement.scrollTop = 0; }catch(_){}
    try{ document.body.scrollTop = 0; }catch(_){}
    try{
      const main = document.querySelector(".main");
      if(main && typeof main.scrollTo === "function") main.scrollTo({ top:0, left:0, behavior:"auto" });
      else if(main) main.scrollTop = 0;
    }catch(_){}
  }

  function scheduleScrollCronosToTop(){
    scrollCronosToTop();
    requestAnimationFrame(()=>{
      scrollCronosToTop();
      requestAnimationFrame(scrollCronosToTop);
    });
  }

  function hasCronos(){
    return typeof window.loadDB === "function" && typeof window.currentActor === "function";
  }

  function localISODate(date=new Date()){
    const d = date instanceof Date ? date : new Date(date);
    if(isNaN(d)) return "";
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function todayISO(){
    try{
      if(typeof window.todayISO === "function") return window.todayISO();
    }catch(_){}
    return localISODate(new Date());
  }

  function nowISO(){
    return new Date().toISOString();
  }

  function cloneValue(value){
    try{
      if(typeof structuredClone === "function") return structuredClone(value);
    }catch(_){ }
    try{ return JSON.parse(JSON.stringify(value)); }
    catch(_){ return value && typeof value === "object" ? { ...value } : value; }
  }

  function fmtBR(iso){
    try{
      if(typeof window.fmtBR === "function") return window.fmtBR(iso);
    }catch(_){}
    if(!iso) return "—";
    const s = String(iso).slice(0,10);
    const [y,m,d] = s.split("-");
    return (y && m && d) ? `${d}/${m}/${y}` : String(iso);
  }

  function moneyBR(v){
    try{
      if(typeof window.moneyBR === "function") return window.moneyBR(v);
    }catch(_){}
    const n = Number(v || 0);
    return n.toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
  }

  function escapeHTML(v){
    try{
      if(typeof window.escapeHTML === "function") return window.escapeHTML(v);
    }catch(_){}
    return String(v ?? "").replace(/[&<>"']/g, m=>({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
  }

  function parseMoney(v){
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function toast(title, msg=""){
    try{
      if(typeof window.toast === "function") return window.toast(title, msg);
    }catch(_){}
    console.log("[Hoje no Cronos]", title, msg);
  }

  function canOpenToday(){
    try{
      if(typeof window.CRONOS_CAN_OPEN_MODULE === "function") return window.CRONOS_CAN_OPEN_MODULE("todayCronos") === true;
      if(typeof window.CRONOS_CAN_ACCESS_MODULE === "function") return window.CRONOS_CAN_ACCESS_MODULE("todayCronos") === true;
      return false;
    }catch(_){
      return false;
    }
  }

  function denyTodayAccess(){
    toast("Acesso restrito", "Seu nível de acesso não permite abrir Hoje no Cronos.");
  }

  function save(db, opts={ immediate:true }){
    try{ invalidateTodayCache(); }catch(_){}
    try{
      if(typeof window.saveDB === "function") return window.saveDB(db, opts);
    }catch(e){
      console.warn("Hoje no Cronos: falha ao salvar", e);
    }
  }

  function load(){
    try{ return window.loadDB(); }catch(_){ return null; }
  }

  function actor(){
    try{ return window.currentActor(); }catch(_){ return null; }
  }

  function getContact(db, entry){
    if(!entry) return {};
    return (db.contacts || []).find(c=>String(c.id)===String(entry.contactId)) || {};
  }

  function getContactById(db, contactId){
    if(!contactId) return {};
    return (db.contacts || []).find(c=>String(c.id)===String(contactId)) || {};
  }

  function contactName(db, entry){
    const c = getContact(db, entry);
    return c.name || entry.name || entry.lead || "(sem nome)";
  }

  function contactPhone(db, entry){
    const c = getContact(db, entry);
    return pickPhone(c) || pickPhone(entry);
  }

  function entrySortDate(e){
    return String(e?.lastUpdateAt || e?.apptDate || e?.firstContactAt || e?.monthKey || e?.createdAt || "");
  }

  function getTaskEntry(db, task){
    if(!db || !task) return null;

    const entryId = task.entryId || task.leadId || task.entry_id || task.lead_id || "";
    if(entryId){
      const found = (db.entries || []).find(x=>String(x.id) === String(entryId));
      if(found) return found;
    }

    const contactId = task.contactId || task.contact_id || "";
    if(contactId){
      const list = (db.entries || [])
        .filter(x=>String(x.contactId || "") === String(contactId))
        .sort((a,b)=>entrySortDate(b).localeCompare(entrySortDate(a)));
      if(list.length) return list[0];
    }

    const name = taskContactName(task) || task.patientName || task.contactName || task.leadName || task.nome || task.name || "";
    const target = normalizeText(name);
    if(target){
      const masterId = task?.masterId || actor()?.masterId || "";
      const match = (db.entries || []).find(e=>{
        if(masterId && e.masterId && e.masterId !== masterId) return false;
        const c = getContact(db, e);
        const n = normalizeText(c.name || e.name || e.lead || e.patientName || e.nome);
        return n && (n === target || n.includes(target) || target.includes(n));
      });
      if(match) return match;
    }

    return null;
  }

  function normalizeText(v){
    return String(v || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pickPhone(obj){
    if(!obj) return "";
    return obj.phone || obj.whatsapp || obj.telefone || obj.celular || obj.mobile || obj.phoneNumber || obj.tel || "";
  }

  function taskContactName(task){
    const raw = String(task?.title || task?.name || "").trim();
    if(!raw) return "";
    return raw
      .replace(/^(remarcar\s+falta|inadimplente|follow\-?up|retorno|cobrança|cobranca)\s*:\s*/i, "")
      .replace(/\s*[•-]\s*parcela\s+\d+\s*\/\s*\d+.*$/i, "")
      .replace(/\s*[•-]\s*parcelamento.*$/i, "")
      .split("•")[0]
      .trim();
  }

  function findPhoneByName(db, name, masterId=""){
    const target = normalizeText(name);
    if(!target) return "";

    const contacts = Array.isArray(db?.contacts) ? db.contacts : [];
    const entries = Array.isArray(db?.entries) ? db.entries : [];

    const contact = contacts.find(c=>{
      if(masterId && c.masterId && c.masterId !== masterId) return false;
      const n = normalizeText(c.name || c.nome || c.fullName);
      return n && (n === target || n.includes(target) || target.includes(n));
    });
    if(contact) return pickPhone(contact);

    const entry = entries.find(e=>{
      if(masterId && e.masterId && e.masterId !== masterId) return false;
      const n = normalizeText(e.name || e.lead || e.patientName || e.nome);
      return n && (n === target || n.includes(target) || target.includes(n));
    });
    if(entry) return contactPhone(db, entry);

    return "";
  }

  function taskPhone(db, task, entry){
    const direct = pickPhone(task);
    if(direct) return direct;

    const resolvedEntry = entry || getTaskEntry(db, task);
    if(resolvedEntry){
      const fromEntry = contactPhone(db, resolvedEntry);
      if(fromEntry) return fromEntry;
    }

    const contactId = task?.contactId || task?.contact_id || "";
    if(contactId){
      const c = getContactById(db, contactId);
      const fromContact = pickPhone(c);
      if(fromContact) return fromContact;
    }

    return findPhoneByName(db, taskContactName(task), task?.masterId || actor()?.masterId || "");
  }

  function waLink(phone, msg=""){
    const clean = (typeof window.CRONOS_PHONE_TO_WHATSAPP === "function")
      ? window.CRONOS_PHONE_TO_WHATSAPP(phone)
      : (()=>{
          const raw = String(phone || "").trim();
          const digits = raw.replace(/\D/g, "");
          if(!digits) return "";
          if(raw.startsWith("00")) return digits.slice(2);
          if(raw.startsWith("+")) return digits;
          if(digits.startsWith("55") && digits.length > 11) return digits;
          return "55" + digits;
        })();
    if(!clean) return "#";
    return `https://wa.me/${clean}?text=${encodeURIComponent(msg || "")}`;
  }

  async function copyText(text){
    try{
      await navigator.clipboard.writeText(String(text || ""));
      toast("Copiado ✅");
    }catch(_){
      const ta = document.createElement("textarea");
      ta.value = String(text || "");
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast("Copiado ✅");
    }
  }

  function addStyles(){
    if($(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${VIEW_ID}{
        --tc-card: rgba(18,22,33,.96);
        --tc-card-soft: rgba(24,31,46,.92);
        --tc-item: rgba(255,255,255,.055);
        --tc-text: #eef2ff;
        --tc-muted: rgba(222,231,255,.72);
        --tc-line: rgba(255,255,255,.13);
        --tc-primary: rgba(22,119,255,.23);
        --tc-primary-line: rgba(22,119,255,.55);
        padding:18px;
        width:100%;
        box-sizing:border-box;
        min-height:72vh;
        color:var(--tc-text);
      }
      html.light #${VIEW_ID}{
        --tc-card: rgba(255,255,255,.88);
        --tc-card-soft: rgba(255,255,255,.74);
        --tc-item: rgba(255,255,255,.66);
        --tc-text: #101827;
        --tc-muted: #5d6677;
        --tc-line: rgba(15,23,42,.13);
        --tc-primary: rgba(22,119,255,.13);
        --tc-primary-line: rgba(22,119,255,.50);
      }
      #${VIEW_ID}, #${VIEW_ID} *{box-sizing:border-box}
      .todayWrap{display:grid; gap:16px; border-radius:22px}
      .todayHero{
        display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap;
        padding:18px; border-radius:20px;
        background:linear-gradient(135deg, rgba(22,119,255,.14), rgba(255,255,255,.035)), var(--tc-card);
        border:1px solid var(--tc-line);
        box-shadow:var(--shadow, 0 12px 30px rgba(0,0,0,.16));
        color:var(--tc-text);
      }
      .todayHero h2{margin:0; font-size:24px}
      .todayHero p{margin:6px 0 0; color:var(--tc-muted); line-height:1.4}
      .todayGrid{display:grid; grid-template-columns:repeat(auto-fit,minmax(178px,1fr)); gap:8px}
      .todayKpi{
        width:100%;
        border:1px solid var(--tc-line);
        border-radius:14px;
        padding:10px 12px;
        background:rgba(255,255,255,.03);
        cursor:pointer;
        transition:.15s ease;
        text-align:left;
        color:var(--tc-text);
        font:inherit;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        min-height:46px;
      }
      .todayKpi:hover{transform:translateY(-1px); background:rgba(255,255,255,.05); filter:none}
      .todayKpi.active{
        border-color:var(--tc-primary-line);
        background:rgba(22,119,255,.14);
        box-shadow:0 8px 20px rgba(22,119,255,.15);
        outline:none;
      }
      html.light #${VIEW_ID} .todayKpi.active{
        border-color:rgba(37,99,235,.55);
        background:rgba(37,99,235,.10);
        box-shadow:0 10px 22px rgba(37,99,235,.12);
      }
      .todayKpi b{
        order:2;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:30px;
        min-height:24px;
        padding:2px 8px;
        border-radius:999px;
        border:1px solid var(--tc-line);
        background:rgba(255,255,255,.045);
        font-size:12px;
        line-height:1;
        color:var(--tc-text);
        margin:0;
      }
      .todayKpi span{order:1; color:var(--tc-text); font-size:13px; font-weight:760; min-width:0}
      .todayKpi.active b{border-color:var(--tc-primary-line); background:rgba(22,119,255,.16)}
      .todaySections{display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start}
      .todayCard{
        border:1px solid var(--tc-line);
        border-radius:18px;
        background:var(--tc-card);
        overflow:hidden;
        min-height:420px;
        color:var(--tc-text);
        box-shadow:var(--shadow, 0 10px 22px rgba(0,0,0,.10));
      }
      .todayCardHeader{
        display:flex; justify-content:space-between; align-items:center; gap:10px;
        padding:13px 14px;
        border-bottom:1px solid var(--tc-line);
        background:rgba(255,255,255,.035);
        color:var(--tc-text);
      }
      html.light #${VIEW_ID} .todayCardHeader{background:rgba(255,255,255,.38)}
      .todayCardHeader h3{margin:0; font-size:15px; color:var(--tc-text)}
      .todayCardHeader span{font-size:12px; color:var(--tc-muted)}
      .todayHeaderActions{display:flex;align-items:center;gap:8px;margin-left:auto}
      .todayMiniBtn{
        border:1px solid var(--tc-line);
        background:rgba(255,255,255,.06);
        color:var(--tc-muted);
        border-radius:999px;
        padding:5px 9px;
        cursor:pointer;
        font-size:11px;
        line-height:1;
      }
      .todayMiniBtn:hover{filter:brightness(1.08);color:var(--tc-text)}
      html.light #${VIEW_ID} .todayMiniBtn{background:rgba(255,255,255,.55)}
      .todayList{
        display:grid;
        gap:8px;
        padding:12px;
        max-height:360px;
        overflow:auto;
        overscroll-behavior:contain;
        scrollbar-gutter:stable;
      }
      .todayItem{
        border:1px solid var(--tc-line);
        border-radius:14px;
        padding:11px;
        background:var(--tc-item);
        display:grid;
        gap:8px;
        color:var(--tc-text);
      }
      .todayItemTop{display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap}
      .todayItemTitle{font-weight:900; color:var(--tc-text)}
      .todayItemMeta{font-size:12px; color:var(--tc-muted); line-height:1.4}
      .todayActions{display:flex; gap:7px; flex-wrap:wrap; align-items:center}
      .todayBtn{
        border:1px solid var(--tc-line);
        background:rgba(255,255,255,.075);
        color:var(--tc-text);
        border-radius:10px;
        padding:7px 10px;
        cursor:pointer;
        font-size:12px;
        text-decoration:none;
      }
      html.light #${VIEW_ID} .todayBtn{background:#e5e7eb; color:#334155; border-color:rgba(100,116,139,.32)}
      .todayBtn:hover{filter:brightness(1.08)}
      .todayBtn.primary{background:rgba(22,119,255,.18); border-color:rgba(22,119,255,.38)}
      .todayBtn.ok{background:rgba(34,197,94,.14); border-color:rgba(34,197,94,.35)}
      .todayBtn.warn{background:rgba(245,158,11,.14); border-color:rgba(245,158,11,.35)}
      .todayBtn.danger{background:rgba(239,68,68,.14); border-color:rgba(239,68,68,.35)}
      #${VIEW_ID} .todayBtn.wa,
      #${VIEW_ID} a.todayBtn[href*="wa.me"]{
        background:rgba(34,197,94,.18) !important;
        border-color:rgba(34,197,94,.46) !important;
        color:#dcfce7 !important;
        font-weight:800;
      }
      html.light #${VIEW_ID} .todayBtn.wa,
      body.light #${VIEW_ID} .todayBtn.wa,
      html.light #${VIEW_ID} a.todayBtn[href*="wa.me"],
      body.light #${VIEW_ID} a.todayBtn[href*="wa.me"]{
        background:linear-gradient(135deg, #16a34a, #22c55e) !important;
        border-color:#16a34a !important;
        color:#ffffff !important;
        box-shadow:0 8px 16px rgba(34,197,94,.18) !important;
      }
      #${VIEW_ID} .todayBtn.wa:hover,
      #${VIEW_ID} a.todayBtn[href*="wa.me"]:hover{filter:brightness(1.06)}
      .todayBadge{display:inline-flex; align-items:center; gap:6px; border:1px solid var(--tc-line); border-radius:999px; padding:4px 8px; font-size:11px; color:var(--tc-muted)}
      .todayEmpty{padding:18px; color:var(--tc-muted); text-align:center; border:1px dashed var(--tc-line); border-radius:14px; background:rgba(255,255,255,.035)}
      html.light #${VIEW_ID} .todayEmpty{background:rgba(255,255,255,.45)}
      .todayMore{display:flex;justify-content:center;padding:0 12px 12px;gap:8px}
      #${NAV_ID}{display:flex;align-items:center;justify-content:space-between;gap:8px}
      #${NAV_ID} .todayNavBadge{
        margin-left:auto;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        line-height:1;
      }
      #${NAV_ID} .todayNavBadge.empty{opacity:.55}
      .todaySpinner{width:13px;height:13px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;display:inline-block;vertical-align:-2px;animation:todaySpin .75s linear infinite}
      @keyframes todaySpin{to{transform:rotate(360deg)}}
      .todaySkeleton{display:grid;gap:16px}
      .todaySkeletonBlock{border:1px solid var(--tc-line);border-radius:18px;background:var(--tc-card);padding:16px;overflow:hidden}
      .todaySkeletonLine{height:13px;border-radius:999px;background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.13),rgba(255,255,255,.05));background-size:220% 100%;animation:todaySkeletonPulse 1s ease-in-out infinite;margin:9px 0}
      html.light #${VIEW_ID} .todaySkeletonLine{background:linear-gradient(90deg,rgba(15,23,42,.055),rgba(15,23,42,.12),rgba(15,23,42,.055));background-size:220% 100%}
      .todaySkeletonGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(178px,1fr));gap:8px}
      @keyframes todaySkeletonPulse{0%{background-position:120% 0}100%{background-position:-120% 0}}
      .todayFull{grid-column:1/-1}
      @media(max-width:1200px){.todayGrid{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.todaySections{grid-template-columns:1fr}}
      @media(max-width:720px){#${VIEW_ID}{padding:12px}.todayGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.todayHero h2{font-size:20px}}
    `;
    document.head.appendChild(style);

    if(!document.getElementById("cronosTodayV25LeadTaskFix")){
      const v25 = document.createElement("style");
      v25.id = "cronosTodayV25LeadTaskFix";
      v25.textContent = `
        #view-todayCronos .todayCard{height:420px!important;display:flex!important;flex-direction:column!important}
        #view-todayCronos .todayCardHeader{flex:0 0 auto!important}
        #view-todayCronos .todayList{height:318px!important;min-height:318px!important;max-height:318px!important;overflow:auto!important;align-content:start!important}
        #view-todayCronos .todayMore{flex:0 0 auto!important}
        #view-todayCronos .todayItem{min-height:118px!important}
        #view-todayCronos .todayItemTitle{line-height:1.22!important}
        #view-todayCronos .todayLeadLine b{color:#eef6ff}
        html.light #view-todayCronos .todayLeadLine b{color:#0f172a}
        #view-todayCronos .todaySections[data-focus]:not([data-focus="all"]) .todayCard{height:auto!important;min-height:420px!important}
        #view-todayCronos .todaySections[data-focus]:not([data-focus="all"]) .todayList{height:auto!important;min-height:420px!important;max-height:none!important;overflow:visible!important}
      `;
      document.head.appendChild(v25);
    }

    if(!document.getElementById("cronosTodayV26FlexibleCards")){
      const v26 = document.createElement("style");
      v26.id = "cronosTodayV26FlexibleCards";
      v26.textContent = `
        #view-todayCronos .todayList{
          align-content:start!important;
        }
        #view-todayCronos .todayItem{
          position:relative!important;
          min-height:126px!important;
          height:auto!important;
          overflow:visible!important;
          padding:13px 13px 12px!important;
        }
        #view-todayCronos .todayItemTop{
          position:relative!important;
          display:block!important;
          min-width:0!important;
          padding-right:112px!important;
        }
        #view-todayCronos .todayItemTop > div{
          min-width:0!important;
          max-width:100%!important;
        }
        #view-todayCronos .todayItemTitle{
          white-space:normal!important;
          overflow:visible!important;
          text-overflow:clip!important;
          overflow-wrap:anywhere!important;
          word-break:normal!important;
          line-height:1.22!important;
          max-width:100%!important;
          padding-right:0!important;
        }
        #view-todayCronos .todayItemMeta{
          white-space:normal!important;
          overflow-wrap:anywhere!important;
          word-break:normal!important;
          max-width:100%!important;
        }
        #view-todayCronos .todayBadge{
          position:absolute!important;
          top:0!important;
          right:0!important;
          z-index:2!important;
          max-width:104px!important;
          justify-content:center!important;
          white-space:nowrap!important;
        }
        #view-todayCronos .todayActions{
          position:relative!important;
          z-index:1!important;
        }
        #view-todayCronos .todayLeadLine.orphan{
          color:#fbbf24!important;
          font-weight:800!important;
        }
        #view-todayCronos .todaySections[data-focus="all"] .todayList{
          height:336px!important;
          min-height:336px!important;
          max-height:336px!important;
        }
        #view-todayCronos .todaySections[data-focus="all"] .todayCard{
          height:438px!important;
        }
        @media(max-width:980px){
          #view-todayCronos .todayItemTop{padding-right:0!important;padding-top:34px!important}
          #view-todayCronos .todayBadge{left:0!important;right:auto!important;top:0!important}
        }
      `;
      document.head.appendChild(v26);
    }

  }

  function findMainHost(){
    return qs(".main") || $("appView") || qs("main") || qs(".app") || document.body;
  }

  function ensureView(){
    let view = $(VIEW_ID);
    const host = findMainHost();

    if(view){
      if(host && view.parentNode !== host){
        host.appendChild(view);
      }
      return view;
    }

    view = document.createElement("section");
    view.id = VIEW_ID;
    view.className = "view hidden";
    view.style.display = "none";
    if(host.firstChild){
      host.insertBefore(view, host.firstChild);
    }else{
      host.appendChild(view);
    }
    return view;
  }

  function ensureNav(){
    // Durante revalidação silenciosa, preserve exatamente o estado visual atual.
    if(window.__CRONOS_ACCESS_UI_SUSPENDED__===true) return $(NAV_ID) || null;
    const existing = $(NAV_ID);
    if(existing){
      existing.classList.toggle("hidden", !canOpenToday());
      return;
    }

    const nav = qs(".nav") || qs("nav") || qs("#sidebar") || qs(".sidebar");
    if(!nav) return;

    const btn = document.createElement("button");
    btn.id = NAV_ID;
    btn.type = "button";
    btn.dataset.todayCronos = "1";
    btn.innerHTML = `<span>Hoje no Cronos</span><span id="todayNavBadge" class="todayNavBadge empty">0</span>`;
    btn.classList.toggle("hidden", !canOpenToday());
    const openToday = (ev)=>{
      try{
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
        ev?.stopImmediatePropagation?.();
      }catch(_){}
      if(!canOpenToday()){
        denyTodayAccess();
        return false;
      }
      window.CRONOS_TODAY.show();
      return false;
    };
    btn.addEventListener("pointerdown", openToday, true);
    btn.addEventListener("click", openToday, true);

    const dashBtn = qs('[data-view="dashboard"]', nav);
    if(dashBtn && dashBtn.parentNode === nav){
      dashBtn.insertAdjacentElement("afterend", btn);
    }else{
      nav.insertBefore(btn, nav.firstChild || null);
    }
    updateNavCount();
    syncNavBadgeStyle();
  }

  function restoreNativeViews(){
    const host = findMainHost();
    qsa('[data-today-hidden="1"]', host).forEach(v=>{
      if(v.id !== VIEW_ID){
        delete v.dataset.todayHidden;
      }
    });
  }

  function hideTodayView(){
    const view = $(VIEW_ID);
    if(view){
      view.classList.add("hidden");
      view.style.display = "none";
    }
    const navBtn = $(NAV_ID);
    if(navBtn){
      navBtn.classList.remove("active");
      try{ window.CRONOS_SET_NAV_ACTIVE_VISUAL?.(navBtn, false); }catch(_){ }
    }
  }

  function hideOtherViews(){
    const host = findMainHost();
    ensureView();

    qsa(':scope > *', host).forEach(v=>{
      if(v.id === VIEW_ID){
        v.classList.remove("hidden");
        v.style.display = "";
      }else{
        v.dataset.todayHidden = "1";
        v.classList.add("hidden");
        v.style.display = "none";
      }
    });

    qsa('[id^="view-"], .view', host).forEach(v=>{
      if(v.id === VIEW_ID){
        v.classList.remove("hidden");
        v.style.display = "";
      }else{
        v.dataset.todayHidden = "1";
        v.classList.add("hidden");
        v.style.display = "none";
      }
    });

    const today = $(VIEW_ID);
    if(today){
      today.style.display = "";
      today.style.position = "relative";
      today.style.zIndex = "5";
      today.style.minHeight = "70vh";
      today.style.background = "transparent";
    }

    try{
      if(typeof window.CRONOS_SYNC_NAV_ACTIVE === "function") window.CRONOS_SYNC_NAV_ACTIVE(b=>b.id === NAV_ID);
      else qsa(".nav button, nav button, [data-view]").forEach(b=>b.classList.toggle("active", b.id === NAV_ID));
    }catch(_){
      qsa(".nav button, nav button, [data-view]").forEach(b=>b.classList.toggle("active", b.id === NAV_ID));
    }
  }

  function bindNativeNavRecovery(){
    if(window.__CRONOS_TODAY_NATIVE_RECOVERY__) return;
    window.__CRONOS_TODAY_NATIVE_RECOVERY__ = true;

    function todayIsActuallyOpen(){
      const todayView = $(VIEW_ID);
      return !!(todayView && todayView.style.display !== "none" && !todayView.classList.contains("hidden"));
    }

    const recoverBeforeNativeClick = (ev)=>{
      const btn = ev.target?.closest?.('[data-view]');
      if(!btn || btn.id === NAV_ID) return;

      const todayBtnActive = $(NAV_ID)?.classList.contains("active");

      if(!todayIsActuallyOpen() && !todayBtnActive) return;

      restoreNativeViews();
      hideTodayView();

      try{
        const targetView = btn?.dataset?.view || "";
        const targetId = targetView ? `view-${targetView}` : "";
        const host = findMainHost();
        if(targetId){
          qsa('[id^="view-"], .view', host).forEach(v=>{
            if(v.id === targetId){
              v.classList.remove("hidden");
              v.style.display = "";
            }else if(v.id !== VIEW_ID){
              v.classList.add("hidden");
              v.style.display = "none";
            }
          });
          try{
            if(typeof window.CRONOS_SYNC_NAV_ACTIVE === "function") window.CRONOS_SYNC_NAV_ACTIVE(navBtn=>navBtn === btn);
            else qsa(".nav button, nav button, [data-view]").forEach(navBtn=>navBtn.classList.toggle("active", navBtn === btn));
          }catch(_){
            qsa(".nav button, nav button, [data-view]").forEach(navBtn=>navBtn.classList.toggle("active", navBtn === btn));
          }
        }
      }catch(_){}

      scheduleScrollCronosToTop();
    };

    document.addEventListener("pointerdown", recoverBeforeNativeClick, true);

    document.addEventListener("keydown", (ev)=>{
      if(ev.key !== "Enter" && ev.key !== " ") return;
      recoverBeforeNativeClick(ev);
    }, true);

    try{
      if(typeof window.showView === "function" && !window.showView.__todayCronosWrapped){
        const originalShowView = window.showView;
        const wrapped = function(view){
          const wasTodayOpen = todayIsActuallyOpen() || $(NAV_ID)?.classList.contains("active");

          if(view !== VIEW && wasTodayOpen){
            restoreNativeViews();
            hideTodayView();
          }

          const result = originalShowView.apply(this, arguments);
          if(view !== VIEW) scheduleScrollCronosToTop();
          return result;
        };
        wrapped.__todayCronosWrapped = true;
        window.showView = wrapped;
      }
    }catch(_){}

    try{
      if(typeof window.setActiveView === "function" && !window.setActiveView.__todayCronosScrollTopWrapped){
        const originalSetActiveView = window.setActiveView;
        const wrappedSetActiveView = function(view){
          const result = originalSetActiveView.apply(this, arguments);
          scheduleScrollCronosToTop();
          return result;
        };
        wrappedSetActiveView.__todayCronosScrollTopWrapped = true;
        window.setActiveView = wrappedSetActiveView;
      }
    }catch(_){}
  }

  function openLead(entryId){
    try{
      if(typeof window.openLeadEntry === "function") return window.openLeadEntry(entryId);
    }catch(_){}
    try{
      if(typeof window.openNewLead === "function") return window.openNewLead(entryId);
    }catch(_){}
    toast("Abrir lead", "Não encontrei a função de abrir lead nesta versão.");
  }

  function openReceipt(entryId, planId=""){
    try{
      if(typeof window.openNewFinancialInstallment === "function") return window.openNewFinancialInstallment(entryId, planId);
    }catch(_){}
    toast("Recebimentos", "Não encontrei a função de abrir recebimento nesta versão.");
  }

  async function setEntryStatus(entryId, status, extra={}){
    const db = load();
    const a = actor();
    if(!db || !a) return false;
    const e = (db.entries || []).find(x=>String(x.id)===String(entryId));
    if(!e){
      toast("Lead não encontrado");
      return false;
    }

    let updatedEntry;
    try{
      updatedEntry = typeof structuredClone === "function"
        ? structuredClone(e)
        : JSON.parse(JSON.stringify(e));
    }catch(_){
      updatedEntry = { ...e, statusLog:Array.isArray(e.statusLog) ? [...e.statusLog] : [] };
    }

    const old = updatedEntry.status || "";
    updatedEntry.status = status;
    updatedEntry.lastUpdateAt = nowISO();
    if(extra.apptDate !== undefined) updatedEntry.apptDate = extra.apptDate;
    if(extra.apptTime !== undefined) updatedEntry.apptTime = extra.apptTime;
    updatedEntry.statusLog = Array.isArray(updatedEntry.statusLog) ? updatedEntry.statusLog : [];
    updatedEntry.statusLog.push({ at:nowISO(), from:old, to:status, by:a.name || a.email || a.username || "Cronos" });

    try{
      let ok = false;
      if(typeof window.cronosPersistEntryUpsert === "function"){
        // Monta uma nova visão local com apenas este lead alterado. O helper central
        // grava um pacote V4 direcionado e nunca executa o diff da clínica inteira.
        const nextDB = {
          ...db,
          entries:(db.entries || []).map(item=>String(item?.id)===String(entryId) ? updatedEntry : item)
        };
        ok = await Promise.resolve(window.cronosPersistEntryUpsert(nextDB, updatedEntry, {
          immediate:true,
          keepPendingOnFailure:false,
          restoreOnFailure:true,
          silent:true
        }));
      }else{
        const previous = { ...e };
        Object.keys(e).forEach(key=>delete e[key]);
        Object.assign(e, updatedEntry);
        ok = await Promise.resolve(save(db, { immediate:true, silent:true }));
        if(!ok){
          Object.keys(e).forEach(key=>delete e[key]);
          Object.assign(e, previous);
        }
      }

      if(!ok){
        toast("Alteração não confirmada", "Não foi possível salvar o status do paciente.");
        render();
        return false;
      }

      toast("Atualizado ✅", `${status}`);
      render();
      try{ if(typeof window.renderAll === "function") window.renderAll(); }catch(_){}
      return true;
    }catch(error){
      console.error("Hoje no Cronos: falha ao salvar status direcionado", error);
      toast("Falha ao salvar", "O status não foi alterado. Tente novamente.");
      render();
      return false;
    }
  }

  async function markAppointmentNoShow(entryId){
    const statusOk = await setEntryStatus(entryId, "Faltou");
    if(!statusOk) return false;

    try{
      const db = load();
      const a = actor();
      const e = (db?.entries || []).find(x=>String(x.id)===String(entryId));
      if(!db || !a || !e) return false;
      const c = getContact(db, e);
      const currentTasks = Array.isArray(db.tasks) ? db.tasks : [];
      const key = `NO_SHOW:${e.id}:${todayISO()}`;

      if(!currentTasks.some(t=>t.key===key)){
        const createdTask = {
          id:`task_${key.replace(/[^a-zA-Z0-9_-]/g,"_")}`,
          key,
          masterId:a.masterId,
          entryId:e.id,
          contactId:e.contactId || "",
          title:`Remarcar falta: ${c.name || "paciente"}`,
          action:"WhatsApp",
          notes:"Paciente faltou. Enviar mensagem de remarcação humanizada.",
          done:false,
          createdAt:nowISO(),
          updatedAt:nowISO(),
          dueDate:todayISO(),
          phone:c.phone || "",
          wa:true,
          source:"todayCronos"
        };
        const nextDB = { ...db, tasks:[...currentTasks, createdTask] };
        let taskOk = false;
        if(typeof window.cronosPersistTaskUpsert === "function"){
          taskOk = await Promise.resolve(window.cronosPersistTaskUpsert(nextDB, createdTask, {
            immediate:true,
            keepPendingOnFailure:false,
            restoreOnFailure:true,
            silent:true
          }));
        }else{
          taskOk = await Promise.resolve(save(nextDB, { immediate:true, silent:true }));
        }

        if(taskOk){
          if(!window.CronosRepository?.isEnabled?.()){
            try{ window.recordTaskPatch?.(createdTask); }catch(_){ }
          }
        }else{
          toast("Falta registrada", "O status foi salvo, mas a tarefa automática de remarcação não pôde ser criada.");
        }
      }
    }catch(error){
      console.warn("Hoje no Cronos: status de falta salvo, mas a tarefa automática não foi criada", error);
      toast("Falta registrada", "O status foi salvo, mas a tarefa automática de remarcação falhou.");
    }
    render();
    return true;
  }

  async function rescheduleAppointment(entryId){
    const date = prompt("Nova data do agendamento (AAAA-MM-DD):", todayISO());
    if(!date) return false;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
      toast("Data inválida", "Use AAAA-MM-DD.");
      return false;
    }
    const time = prompt("Novo horário (HH:MM):", "09:00") || "";
    return await setEntryStatus(entryId, "Remarcou", { apptDate:date, apptTime:time });
  }

  async function persistTodayTask(taskId, mutate, successTitle, successMessage=""){
    const db = load();
    if(!db) return false;
    const current = (db.tasks || []).find(x=>String(x.id)===String(taskId));
    if(!current){
      toast("Tarefa não encontrada");
      return false;
    }

    const updated = cloneValue(current);
    try{ mutate(updated); }
    catch(error){
      console.error("Hoje no Cronos: alteração de tarefa inválida", error);
      toast("Não foi possível alterar", "A tarefa permaneceu como estava.");
      return false;
    }
    const nextDB = {
      ...db,
      tasks:(db.tasks || []).map(item=>String(item?.id)===String(taskId) ? updated : item)
    };

    let ok = false;
    try{
      if(typeof window.cronosPersistTaskUpsert === "function"){
        ok = await Promise.resolve(window.cronosPersistTaskUpsert(nextDB, updated, {
          immediate:true,
          keepPendingOnFailure:false,
          restoreOnFailure:true,
          silent:true
        }));
      }else{
        ok = await Promise.resolve(save(nextDB, { immediate:true, silent:true }));
      }
    }catch(error){
      console.error("Hoje no Cronos: falha ao salvar tarefa direcionada", error);
      ok = false;
    }

    if(!ok){
      toast("Alteração não confirmada", "A tarefa permaneceu como estava.");
      render();
      return false;
    }

    if(!window.CronosRepository?.isEnabled?.()){
      try{ window.recordTaskPatch?.(updated); }catch(_){ }
    }
    toast(successTitle, successMessage);
    render();
    try{ if(typeof window.renderTasks === "function") window.renderTasks(); }catch(_){ }
    return true;
  }

  async function markTaskDone(taskId){
    return await persistTodayTask(taskId, task=>{
      task.done = true;
      task.doneAt = nowISO();
      task.updatedAt = nowISO();
    }, "Tarefa concluída");
  }

  async function postponeTask(taskId){
    const date = prompt("Adiar para qual data? (AAAA-MM-DD):", todayISO());
    if(!date) return false;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
      toast("Data inválida", "Use AAAA-MM-DD.");
      return false;
    }
    return await persistTodayTask(taskId, task=>{
      task.dueDate = date;
      task.updatedAt = nowISO();
    }, "Tarefa adiada", fmtBR(date));
  }

  function payFinancial(entryId, planId, paymentId){
    try{
      if(typeof window.payFinancialPayment === "function"){
        window.payFinancialPayment(entryId, planId, paymentId);
        setTimeout(render, 250);
        return;
      }
    }catch(e){
      console.warn(e);
    }
    toast("Baixa", "Função de baixa do recebimento não encontrada.");
  }

  function payLegacy(entryId, number){
    try{
      if(typeof window.payInstallment === "function"){
        window.payInstallment(entryId, number);
        setTimeout(render, 250);
        return;
      }
    }catch(e){
      console.warn(e);
    }
    toast("Baixa", "Função de baixa legada não encontrada.");
  }

  function findFlowRunCollection(db, runId){
    for(const key of ["flowRuns", "assistedFlowRuns"]){
      const list = Array.isArray(db?.[key]) ? db[key] : [];
      if(list.some(run=>String(run?.id)===String(runId))) return { key, list };
    }
    const key = Array.isArray(db?.flowRuns) ? "flowRuns" : "assistedFlowRuns";
    return { key, list:Array.isArray(db?.[key]) ? db[key] : [] };
  }

  async function persistFlowRun(runId, mutate, successTitle){
    const db = load();
    if(!db) return false;
    const { key, list } = findFlowRunCollection(db, runId);
    const current = list.find(run=>String(run?.id)===String(runId));
    if(!current){
      toast("Fluxo não encontrado");
      return false;
    }

    const updated = cloneValue(current);
    try{ mutate(updated); }
    catch(error){
      console.error("Hoje no Cronos: alteração de fluxo inválida", error);
      toast("Etapa não encontrada", "O fluxo permaneceu como estava.");
      return false;
    }
    const nextRuns = list.map(run=>String(run?.id)===String(runId) ? updated : run);
    const nextDB = { ...db, [key]:nextRuns };
    let ok = false;

    try{
      if(typeof window.cronosPersistMetaPatch === "function"){
        ok = await Promise.resolve(window.cronosPersistMetaPatch(nextDB, { [key]:nextRuns }, {
          keepPendingOnFailure:false,
          restoreOnFailure:true,
          silent:true
        }));
      }else{
        ok = await Promise.resolve(save(nextDB, { immediate:true, silent:true }));
      }
    }catch(error){
      console.error("Hoje no Cronos: falha ao salvar fluxo direcionado", error);
      ok = false;
    }

    if(!ok){
      toast("Alteração não confirmada", "O fluxo permaneceu como estava.");
      render();
      return false;
    }

    toast(successTitle);
    render();
    return true;
  }

  async function markFlowStepDone(runId, stepIndex){
    return await persistFlowRun(runId, run=>{
      const step = (run.steps || []).find(s=>Number(s.index)===Number(stepIndex));
      if(!step) throw new Error("Etapa não encontrada");
      step.done = true;
      step.doneAt = nowISO();
      run.updatedAt = nowISO();
    }, "Etapa marcada como enviada ✅");
  }

  async function finishFlow(runId){
    return await persistFlowRun(runId, run=>{
      run.active = false;
      run.finishedAt = nowISO();
      run.updatedAt = nowISO();
    }, "Fluxo encerrado");
  }

  function paymentPaid(p){
    try{
      if(typeof window.financialPaymentPaid === "function") return window.financialPaymentPaid(p);
    }catch(_){}
    return !!p.paidAt || p.status === "PAGA" || p.paid === true;
  }

  function ensureFinancialPlans(entry){
    try{
      if(typeof window.ensureFinancialPlans === "function") return window.ensureFinancialPlans(entry);
    }catch(_){}
    if(!Array.isArray(entry.financialPlans)) entry.financialPlans = [];
    return entry.financialPlans;
  }

  function ensureInstallments(entry){
    try{
      if(typeof window.ensureInstallmentsForEntry === "function") return window.ensureInstallmentsForEntry(entry);
    }catch(_){}
  }

  function collectAppointments(db, a){
    const today = todayISO();
    const validStatuses = new Set(["Agendado","Remarcou"]);
    return (db.entries || [])
      .filter(e=>e.masterId === a.masterId)
      .filter(e=>e.apptDate && e.apptDate <= today)
      .filter(e=>validStatuses.has(String(e.status || "")))
      .sort((x,y)=>String(x.apptDate||"").localeCompare(String(y.apptDate||"")) || String(x.apptTime||"").localeCompare(String(y.apptTime||"")))
      .map(e=>({
        type:"appointment",
        id:`appt_${e.id}`,
        entry:e,
        date:e.apptDate,
        time:e.apptTime || "",
        overdue:e.apptDate < today
      }));
  }

  function collectTasks(db, a){
    const today = todayISO();
    return (db.tasks || [])
      .filter(t=>!t.masterId || t.masterId === a.masterId)
      .filter(t=>!t.done)
      .filter(t=>t.dueDate && t.dueDate <= today)
      .sort((x,y)=>String(x.dueDate||"").localeCompare(String(y.dueDate||"")) || String(x.createdAt||"").localeCompare(String(y.createdAt||"")))
      .map(t=>({
        type:"task",
        id:`task_${t.id}`,
        task:t,
        date:t.dueDate,
        overdue:t.dueDate < today
      }));
  }

  function collectReceipts(db, a){
    const today = todayISO();
    const rows = [];

    (db.entries || [])
      .filter(e=>e.masterId === a.masterId)
      .forEach(entry=>{
        const c = getContact(db, entry);

        ensureFinancialPlans(entry).forEach(plan=>{
          (plan.payments || []).forEach(p=>{
            if(paymentPaid(p)) return;
            if(!p.dueDate || p.dueDate > today) return;
            rows.push({
              type:"receipt",
              kind:"financial",
              id:`fin_${entry.id}_${plan.id}_${p.id}`,
              entry,
              contact:c,
              plan,
              payment:p,
              date:p.dueDate,
              overdue:p.dueDate < today
            });
          });
        });

        if(entry.installPlan && !entry.installPlan.migratedToFinancialPlanId){
          try{ ensureInstallments(entry); }catch(_){}
          (entry.installments || []).forEach(p=>{
            const paid = !!p.paidAt || p.status === "PAGA";
            if(paid) return;
            const due = p.dueDate || p.due || "";
            if(!due || due > today) return;
            rows.push({
              type:"receipt",
              kind:"legacy",
              id:`legacy_${entry.id}_${p.number}`,
              entry,
              contact:c,
              installment:p,
              date:due,
              overdue:due < today
            });
          });
        }
      });

    return rows.sort((x,y)=>String(x.date||"").localeCompare(String(y.date||"")));
  }


  function birthdayMonthDay(iso){
    const s = String(iso || "").trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
    return s.slice(5,10);
  }

  function ageOnDate(birthISO, dateISO){
    const b = String(birthISO || "").trim();
    const d = String(dateISO || todayISO()).trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(b) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
    const [by,bm,bd] = b.split("-").map(Number);
    const [dy,dm,dd] = d.split("-").map(Number);
    let age = dy - by;
    if(dm < bm || (dm === bm && dd < bd)) age -= 1;
    return (Number.isFinite(age) && age >= 0 && age < 130) ? String(age) : "";
  }

  function getClinicName(db, a){
    return (
      db?.settings?.clinicName ||
      db?.settings?.clinic ||
      db?.clinicName ||
      a?.clinicName ||
      a?.masterName ||
      "Mundo Odonto"
    );
  }

  function latestEntryForContact(db, contactId, masterId){
    return (db.entries || [])
      .filter(e=>String(e.contactId || "") === String(contactId || "") && (!masterId || e.masterId === masterId))
      .sort((x,y)=>String(y.lastUpdateAt || y.updatedAt || y.createdAt || y.firstContactAt || "").localeCompare(String(x.lastUpdateAt || x.updatedAt || x.createdAt || x.firstContactAt || "")))[0] || null;
  }

  function getBirthdayTemplate(db){
    const fallback = `Oi, {primeiroNome}! Feliz aniversário! 🥳\n\nA equipe da {clinica} deseja um novo ciclo cheio de saúde, alegria e muitos motivos pra sorrir.\n\nE pra comemorar com você, queremos te oferecer uma limpeza de cortesia. Se quiser aproveitar, posso ver um horário disponível pra você.`;
    const tpl = String(db?.settings?.birthdayTemplate || db?.settings?.waBirthdayTemplate || "").trim();
    return tpl || fallback;
  }

  function buildBirthdayMessage(db, contact, age){
    const nome = contact?.name || "";
    const primeiro = firstName(nome);
    return getBirthdayTemplate(db)
      .replaceAll("{nome}", String(nome || ""))
      .replaceAll("{primeiroNome}", String(primeiro || nome || ""))
      .replaceAll("{primeiro_nome}", String(primeiro || nome || ""))
      .replaceAll("{idade}", String(age || ""))
      .replaceAll("{clinica}", String(getClinicName(db, actor()) || ""));
  }

  async function editBirthdayTemplate(){
    const db = load();
    if(!db) return;
    db.settings = db.settings || {};
    const current = getBirthdayTemplate(db);
    const previous = db.settings.birthdayTemplate;
    const next = prompt("Mensagem padrão para aniversariantes:", current);
    if(next == null) return;

    const value = String(next || "").trim();
    db.settings.birthdayTemplate = value;

    let ok = false;
    try{
      if(window.CronosRepository?.isEnabled?.() && typeof window.CronosRepository.updateSettings === "function"){
        ok = await window.CronosRepository.updateSettings(
          { birthdayTemplate:value },
          { keepPendingOnFailure:false }
        );
      }else{
        ok = await Promise.resolve(save(db, { immediate:true }));
      }
    }catch(error){
      console.error("Hoje no Cronos: falha ao salvar mensagem de aniversário.", error);
      ok = false;
    }

    if(!ok){
      if(previous === undefined) delete db.settings.birthdayTemplate;
      else db.settings.birthdayTemplate = previous;
      toast("Não foi possível salvar", "A mensagem anterior foi mantida.");
      render();
      return;
    }

    toast("Mensagem de aniversário salva ✅");
    render();
  }

  function collectBirthdays(db, a){
    const md = birthdayMonthDay(todayISO());
    if(!md) return [];

    return (db.contacts || [])
      .filter(c=>c.masterId === a.masterId)
      .filter(c=>birthdayMonthDay(c.birthDate) === md)
      .sort((x,y)=>String(x.name || "").localeCompare(String(y.name || "")))
      .map(c=>{
        const entry = latestEntryForContact(db, c.id, a.masterId);
        return {
          type:"birthday",
          id:`birthday_${c.id}`,
          contact:c,
          entry,
          date:todayISO(),
          overdue:false,
          age:ageOnDate(c.birthDate, todayISO())
        };
      });
  }

  function collectFlows(db, a){
    const today = todayISO();
    const runs = (db.flowRuns || db.assistedFlowRuns || []).filter(r=>(!r.masterId || r.masterId === a.masterId) && r.active !== false);
    const rows = [];
    runs.forEach(run=>{
      (run.steps || []).forEach(step=>{
        if(step.done) return;
        const due = step.dueDate || step.date || "";
        if(!due || due > today) return;
        const entry = (db.entries || []).find(e=>String(e.id)===String(run.entryId));
        if(!entry) return;
        rows.push({
          type:"flow",
          id:`flow_${run.id}_${step.index}`,
          run,
          step,
          entry,
          date:due,
          overdue:due < today
        });
      });
    });
    return rows.sort((x,y)=>String(x.date||"").localeCompare(String(y.date||"")));
  }



  function hasAppointmentHistory(entry){
    if(!entry) return false;

    const status = String(entry.status || "").trim();
    const activeStatus = ["Agendado","Remarcou"];
    const resolvedStatus = ["Compareceu","Faltou","Fechou","Concluído"];

    if(activeStatus.includes(status)) return true;

    if(resolvedStatus.includes(status) && (entry.apptDate || entry.apptTime)) return true;

    const log = Array.isArray(entry.statusLog) ? entry.statusLog : [];

    const hadScheduled = log.some(l=>{
      const from = String(l?.from || "").trim();
      const to = String(l?.to || "").trim();
      return activeStatus.includes(from) || activeStatus.includes(to);
    });

    const hadResolved = log.some(l=>{
      const to = String(l?.to || "").trim();
      return resolvedStatus.includes(to);
    });

    return hadScheduled && hadResolved;
  }

  window.hasAppointmentHistory = hasAppointmentHistory;

  function patchDashboardAppointmentKpi(){
    try{
      const rows = (typeof window.filteredEntries === "function") ? window.filteredEntries() : [];
      if(!Array.isArray(rows)) return;

      const totalBase = rows.length || 0;
      const apptHist = rows.filter(hasAppointmentHistory).length;
      const pct = totalBase ? `${((apptHist / totalBase) * 100).toFixed(1).replace(".", ",")}%` : "0%";

      const kpi = document.getElementById("kpiAppt");
      const pctEl = document.getElementById("kpiApptPct");
      if(kpi) kpi.textContent = String(apptHist);
      if(pctEl) pctEl.textContent = pct;
    }catch(e){
      console.warn("Hoje no Cronos: não consegui ajustar KPI de agendados", e);
    }
  }

  function patchDashboardAppointmentHistory(){
    try{
      if(typeof window.__kpiBucket === "function" && !window.__kpiBucket.__todayCronosPatched){
        const originalBucket = window.__kpiBucket;
        const patchedBucket = function(key, rows){
          if(String(key) === "sched"){
            return (Array.isArray(rows) ? rows : []).filter(hasAppointmentHistory);
          }
          return originalBucket.apply(this, arguments);
        };
        patchedBucket.__todayCronosPatched = true;
        window.__kpiBucket = patchedBucket;
      }

      if(typeof window.renderDashboard === "function" && !window.renderDashboard.__todayCronosApptPatched){
        const originalRenderDashboard = window.renderDashboard;
        const wrappedRenderDashboard = function(){
          const result = originalRenderDashboard.apply(this, arguments);
          patchDashboardAppointmentKpi();
          return result;
        };
        wrappedRenderDashboard.__todayCronosApptPatched = true;
        window.renderDashboard = wrappedRenderDashboard;
      }

      patchDashboardAppointmentKpi();
    }catch(e){
      console.warn("Hoje no Cronos: patch de histórico de agendados falhou", e);
    }
  }


  function dashboardRowsIgnoringKpi(){
    try{
      if(typeof window.filteredEntries !== "function") return null;
      const prev = window.__KPI_ACTIVE;
      window.__KPI_ACTIVE = null;
      const rows = window.filteredEntries();
      window.__KPI_ACTIVE = prev;
      return Array.isArray(rows) ? rows : null;
    }catch(e){
      try{ window.__KPI_ACTIVE = window.__KPI_ACTIVE; }catch(_){}
      return null;
    }
  }

  function fixSidebarDashboardCount(){
    try{
      const pill = document.getElementById("pillTotal");
      if(!pill) return;
      const rows = dashboardRowsIgnoringKpi();
      if(!rows) return;
      pill.textContent = String(rows.length);
    }catch(e){
      console.warn("Hoje no Cronos: contador do Dashboard indisponível", e);
    }
  }

  function patchSidebarCounts(){
    try{
      if(typeof window.updateSidebarPills === "function" && !window.updateSidebarPills.__todayCronosSidebarPatched){
        const originalUpdateSidebarPills = window.updateSidebarPills;
        const wrappedUpdateSidebarPills = function(){
          const result = originalUpdateSidebarPills.apply(this, arguments);
          setTimeout(fixSidebarDashboardCount, 0);
          return result;
        };
        wrappedUpdateSidebarPills.__todayCronosSidebarPatched = true;
        window.updateSidebarPills = wrappedUpdateSidebarPills;
      }
      setTimeout(fixSidebarDashboardCount, 0);
    }catch(e){
      console.warn("Hoje no Cronos: patch do contador lateral falhou", e);
    }
  }


  function normalizePhoneLocal(v){
    return String(v || "").replace(/\D/g, "");
  }

  function markLeadFormContactAsUpdated(db){
    try{
      const birthEl = document.getElementById("lf_birth");
      const nameEl = document.getElementById("lf_name");
      const phoneEl = document.getElementById("lf_phone");
      if(!birthEl || !nameEl || !phoneEl || !db || !Array.isArray(db.contacts)) return;

      const birth = String(birthEl.value || "").trim();
      const name = String(nameEl.value || "").trim();
      const phone = normalizePhoneLocal(phoneEl.value || "");
      const selectedId = String(nameEl.dataset?.contactId || phoneEl.dataset?.contactId || "").trim();
      const now = new Date().toISOString();

      let contact = null;

      if(selectedId){
        contact = db.contacts.find(c=>String(c.id) === selectedId);
      }

      if(!contact){
        contact = db.contacts.find(c=>
          String(c.name || "").trim() === name &&
          normalizePhoneLocal(c.phone || "") === phone
        );
      }

      if(!contact && phone){
        const matches = db.contacts.filter(c=>normalizePhoneLocal(c.phone || "") === phone);
        if(matches.length === 1) contact = matches[0];
      }

      if(!contact) return;

      contact.updatedAt = now;
      contact.lastModifiedAt = now;
      contact.birthDate = birth;
      const cpfEl = document.getElementById("lf_cpf");
      if(cpfEl) contact.cpf = String(cpfEl.value || "").replace(/\D/g, "");
    }catch(e){
      console.warn("Hoje no Cronos: não consegui marcar contato como atualizado", e);
    }
  }

  function patchBirthDateCloudSync(){
    try{
      if(typeof window.saveDB !== "function" || window.saveDB.__todayBirthSyncPatched) return;

      const originalSaveDB = window.saveDB;
      const wrappedSaveDB = function(db, options){
        try{ markLeadFormContactAsUpdated(db); }catch(_){}
        return originalSaveDB.apply(this, arguments);
      };

      wrappedSaveDB.__todayBirthSyncPatched = true;
      window.saveDB = wrappedSaveDB;
    }catch(e){
      console.warn("Hoje no Cronos: patch de sincronização do nascimento falhou", e);
    }
  }

  function weekdayBR(dateISO){
    try{
      const d = new Date(`${dateISO}T12:00:00`);
      const label = d.toLocaleDateString("pt-BR", { weekday:"long" });
      return label ? label.charAt(0).toUpperCase() + label.slice(1) : "";
    }catch(_){ return ""; }
  }

  function renderTodaySkeleton(){
    addStyles();
    const view = ensureView();
    view.innerHTML = `
      <div class="todayWrap todaySkeleton" aria-busy="true">
        <div class="todayHero">
          <div style="min-width:260px;flex:1">
            <h2>Hoje no Cronos</h2>
            <p>Preparando agenda diária sem travar a tela.</p>
            <div class="todaySkeletonLine" style="width:220px"></div>
          </div>
          <div class="todayActions"><button class="todayBtn primary" disabled><span class="todaySpinner"></span> Carregando...</button></div>
        </div>
        <div class="todaySkeletonGrid">
          ${Array.from({length:6}).map(()=>`<div class="todayKpi"><span><span class="todaySkeletonLine" style="width:110px"></span></span><b>...</b></div>`).join("")}
        </div>
        <div class="todaySections">
          ${Array.from({length:4}).map(()=>`
            <section class="todaySkeletonBlock">
              <div class="todaySkeletonLine" style="width:42%;height:16px"></div>
              <div class="todaySkeletonLine" style="width:92%"></div>
              <div class="todaySkeletonLine" style="width:78%"></div>
              <div class="todaySkeletonLine" style="width:84%"></div>
            </section>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderLimitedSection(section, items, renderer){
    const list = Array.isArray(items) ? items : [];
    const limit = TODAY_STATE.visible[section] || 3;
    const shown = list.slice(0, limit);
    const html = renderer(shown);
    const hasMore = list.length > limit;
    const canLess = limit > 3 && list.length > 3;
    return `
      <div class="todayList">${html}</div>
      ${hasMore || canLess ? `
        <div class="todayMore">
          ${hasMore ? `<button class="todayBtn primary" onclick="CRONOS_TODAY.showMore('${section}')">Ver mais (${list.length - limit})</button>` : ""}
          ${canLess ? `<button class="todayBtn" onclick="CRONOS_TODAY.showLess('${section}')">Ver menos</button>` : ""}
        </div>
      ` : ""}
    `;
  }





  function installV94Refinements(){
    if(document.getElementById('cronosTodayV94Refinements')) return;
    const style = document.createElement('style');
    style.id = 'cronosTodayV94Refinements';
    style.textContent = `
      #view-todayCronos .todaySections[data-focus]:not([data-focus="all"]) .todayCard{overflow:visible!important;min-height:0!important}
      #view-todayCronos .todaySections[data-focus]:not([data-focus="all"]) .todayList{max-height:none!important;overflow:visible!important;overscroll-behavior:auto!important;scrollbar-gutter:auto!important}
      #view-todayCronos .todayList:has(> .todayEmpty){min-height:300px!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:24px!important}
      #view-todayCronos .todaySections[data-focus]:not([data-focus="all"]) .todayList:has(> .todayEmpty){min-height:430px!important}
      #view-todayCronos .todayEmpty{position:relative!important;width:min(520px,88%)!important;margin:auto!important;padding:20px 22px!important;border-radius:24px 24px 24px 10px!important;border:1px solid rgba(25,198,255,.30)!important;border-style:solid!important;background:linear-gradient(135deg,rgba(22,119,255,.15),rgba(46,230,166,.10)),rgba(255,255,255,.045)!important;text-align:center!important;font-weight:760!important;line-height:1.45!important}
      #view-todayCronos .todayEmpty::before,#view-todayCronos .todayEmpty::after{content:""!important;position:absolute!important;display:block!important;border-radius:999px!important;border:1px solid rgba(25,198,255,.24)!important;background:rgba(255,255,255,.045)!important}
      #view-todayCronos .todayEmpty::before{width:15px!important;height:15px!important;left:32px!important;bottom:-13px!important}
      #view-todayCronos .todayEmpty::after{width:8px!important;height:8px!important;left:20px!important;bottom:-25px!important}
    `;
    document.head.appendChild(style);
  }



  function installTodayV27Fixes(){
    if(document.getElementById("cronosTodayV27Fixes")) return;
    const style = document.createElement("style");
    style.id = "cronosTodayV27Fixes";
    style.textContent = `
      #view-todayCronos .todaySections[data-focus="all"] .todayCard{
        height:auto!important;
        min-height:438px!important;
        max-height:none!important;
        overflow:visible!important;
        display:flex!important;
        flex-direction:column!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayList{
        height:auto!important;
        min-height:0!important;
        max-height:430px!important;
        overflow:auto!important;
        padding-bottom:16px!important;
        align-content:start!important;
      }
      #view-todayCronos .todayCardHeader{
        flex:0 0 auto!important;
      }
      #view-todayCronos .todayMore{
        position:relative!important;
        z-index:3!important;
        flex:0 0 auto!important;
        background:linear-gradient(180deg,rgba(6,13,31,0),rgba(6,13,31,.62) 30%,rgba(6,13,31,.76))!important;
        padding-top:8px!important;
      }
      html.light #view-todayCronos .todayMore{
        background:linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,.82) 30%,rgba(255,255,255,.92))!important;
      }
      #view-todayCronos .todayItem{
        display:flex!important;
        flex-direction:column!important;
        gap:10px!important;
        min-height:auto!important;
        height:auto!important;
        overflow:visible!important;
        padding:14px!important;
      }
      #view-todayCronos .todayItemTop{
        position:relative!important;
        display:block!important;
        min-width:0!important;
        padding-right:114px!important;
      }
      #view-todayCronos .todayItemTop > div{
        min-width:0!important;
        width:100%!important;
      }
      #view-todayCronos .todayItemTitle{
        white-space:normal!important;
        overflow:visible!important;
        text-overflow:clip!important;
        overflow-wrap:anywhere!important;
        line-height:1.22!important;
        max-width:100%!important;
      }
      #view-todayCronos .todayItemMeta{
        white-space:normal!important;
        overflow-wrap:anywhere!important;
        line-height:1.35!important;
      }
      #view-todayCronos .todayBadge{
        position:absolute!important;
        top:0!important;
        right:0!important;
        z-index:2!important;
        max-width:106px!important;
        justify-content:center!important;
        white-space:nowrap!important;
      }
      #view-todayCronos .todayActions{
        margin-top:2px!important;
        display:flex!important;
        flex-wrap:wrap!important;
        gap:7px!important;
        position:relative!important;
        z-index:1!important;
      }
      #view-todayCronos .todayLeadLine.orphan{
        color:#fbbf24!important;
        font-weight:850!important;
      }
      #view-todayCronos .todaySections[data-focus]:not([data-focus="all"]) .todayCard{
        height:auto!important;
        min-height:420px!important;
        overflow:visible!important;
      }
      #view-todayCronos .todaySections[data-focus]:not([data-focus="all"]) .todayList{
        height:auto!important;
        min-height:0!important;
        max-height:none!important;
        overflow:visible!important;
        padding-bottom:18px!important;
      }
      @media(max-width:980px){
        #view-todayCronos .todayItemTop{padding-right:0!important;padding-top:34px!important}
        #view-todayCronos .todayBadge{left:0!important;right:auto!important;top:0!important}
      }
    `;
    document.head.appendChild(style);
  }


  function installTodayV28CardScrollFix(){
    if(document.getElementById("cronosTodayV28CardScrollFix")) return;
    const style = document.createElement("style");
    style.id = "cronosTodayV28CardScrollFix";
    style.textContent = `
      /* V28: o card mestre fica estável; quem cresce é o item interno e a lista rola */
      #view-todayCronos .todaySections[data-focus="all"]{
        align-items:start!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayCard{
        height:438px!important;
        min-height:438px!important;
        max-height:438px!important;
        overflow:hidden!important;
        display:flex!important;
        flex-direction:column!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayCardHeader{
        flex:0 0 auto!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayList{
        flex:1 1 auto!important;
        height:auto!important;
        min-height:0!important;
        max-height:none!important;
        overflow-y:auto!important;
        overflow-x:hidden!important;
        padding:10px 12px 12px!important;
        align-content:start!important;
        scrollbar-gutter:stable!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayMore{
        flex:0 0 auto!important;
        position:relative!important;
        z-index:4!important;
        padding:8px 12px 12px!important;
        background:linear-gradient(180deg,rgba(6,13,31,0),rgba(6,13,31,.78) 34%,rgba(6,13,31,.92))!important;
      }
      html.light #view-todayCronos .todaySections[data-focus="all"] .todayMore{
        background:linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,.88) 34%,rgba(255,255,255,.96))!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayItem{
        height:auto!important;
        min-height:138px!important;
        max-height:none!important;
        overflow:visible!important;
        display:flex!important;
        flex-direction:column!important;
        justify-content:flex-start!important;
        gap:10px!important;
        padding:14px!important;
        margin-bottom:10px!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayItemTop{
        position:relative!important;
        display:block!important;
        min-width:0!important;
        padding-right:116px!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayItemTitle{
        white-space:normal!important;
        overflow:visible!important;
        text-overflow:clip!important;
        overflow-wrap:anywhere!important;
        line-height:1.22!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayItemMeta{
        white-space:normal!important;
        overflow-wrap:anywhere!important;
        line-height:1.34!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayBadge{
        position:absolute!important;
        top:0!important;
        right:0!important;
        z-index:3!important;
        max-width:108px!important;
        white-space:nowrap!important;
        justify-content:center!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayActions{
        display:flex!important;
        flex-wrap:wrap!important;
        gap:7px!important;
        margin-top:auto!important;
        position:relative!important;
        z-index:2!important;
      }

      /* Quando clica num filtro específico, aí sim pode respirar e ocupar a página */
      #view-todayCronos .todaySections[data-focus]:not([data-focus="all"]) .todayCard{
        height:auto!important;
        min-height:420px!important;
        max-height:none!important;
        overflow:visible!important;
      }
      #view-todayCronos .todaySections[data-focus]:not([data-focus="all"]) .todayList{
        height:auto!important;
        min-height:0!important;
        max-height:none!important;
        overflow:visible!important;
      }

      @media(max-width:980px){
        #view-todayCronos .todaySections[data-focus="all"] .todayCard{
          height:auto!important;
          min-height:360px!important;
          max-height:none!important;
          overflow:visible!important;
        }
        #view-todayCronos .todaySections[data-focus="all"] .todayList{
          max-height:none!important;
          overflow:visible!important;
        }
        #view-todayCronos .todaySections[data-focus="all"] .todayItemTop{
          padding-right:0!important;
          padding-top:34px!important;
        }
        #view-todayCronos .todaySections[data-focus="all"] .todayBadge{
          left:0!important;
          right:auto!important;
        }
      }
    `;
    document.head.appendChild(style);
  }


  function installTodayV29CacheFix(){
    if(document.getElementById("cronosTodayV29CacheFix")) return;
    const style = document.createElement("style");
    style.id = "cronosTodayV29CacheFix";
    style.textContent = `
      #view-todayCronos .todayWrap[aria-busy="true"]{
        opacity:.92;
      }
      #view-todayCronos .todaySkeleton{
        animation:todaySoftIn .12s ease-out both;
      }
      @keyframes todaySoftIn{
        from{opacity:.0; transform:translateY(4px)}
        to{opacity:1; transform:translateY(0)}
      }
    `;
    document.head.appendChild(style);
  }


  function installTodayV31InnerCardAutoHeight(){
    if(document.getElementById("cronosTodayV31InnerCardAutoHeight")) return;
    const style = document.createElement("style");
    style.id = "cronosTodayV31InnerCardAutoHeight";
    style.textContent = `
      /* V31: card mestre fixo; cards internos crescem e a lista rola */
      #view-todayCronos .todaySections[data-focus="all"] .todayCard{
        height:438px!important;
        min-height:438px!important;
        max-height:438px!important;
        overflow:hidden!important;
        display:flex!important;
        flex-direction:column!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayCardHeader{
        flex:0 0 auto!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayList{
        display:flex!important;
        flex-direction:column!important;
        gap:10px!important;
        flex:1 1 auto!important;
        min-height:0!important;
        height:auto!important;
        max-height:none!important;
        overflow-y:auto!important;
        overflow-x:hidden!important;
        padding:10px 12px 14px!important;
        align-content:initial!important;
        grid-auto-rows:auto!important;
        scrollbar-gutter:stable!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayItem{
        flex:0 0 auto!important;
        box-sizing:border-box!important;
        width:100%!important;
        height:auto!important;
        min-height:0!important;
        max-height:none!important;
        overflow:visible!important;
        display:flex!important;
        flex-direction:column!important;
        justify-content:flex-start!important;
        gap:10px!important;
        padding:14px!important;
        margin:0!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayItemTop{
        flex:0 0 auto!important;
        position:relative!important;
        display:block!important;
        min-width:0!important;
        width:100%!important;
        padding-right:116px!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayItemTop > div{
        min-width:0!important;
        width:100%!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayItemTitle{
        display:block!important;
        white-space:normal!important;
        overflow:visible!important;
        text-overflow:clip!important;
        overflow-wrap:anywhere!important;
        word-break:normal!important;
        line-height:1.22!important;
        max-width:100%!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayItemMeta{
        display:block!important;
        white-space:normal!important;
        overflow:visible!important;
        text-overflow:clip!important;
        overflow-wrap:anywhere!important;
        word-break:normal!important;
        line-height:1.34!important;
        max-width:100%!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayBadge{
        position:absolute!important;
        top:0!important;
        right:0!important;
        z-index:3!important;
        max-width:108px!important;
        white-space:nowrap!important;
        justify-content:center!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayActions{
        flex:0 0 auto!important;
        display:flex!important;
        flex-wrap:wrap!important;
        align-items:center!important;
        gap:7px!important;
        margin-top:2px!important;
        padding-bottom:2px!important;
        position:relative!important;
        z-index:2!important;
        overflow:visible!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayBtn{
        flex:0 0 auto!important;
      }
      #view-todayCronos .todaySections[data-focus="all"] .todayMore{
        flex:0 0 auto!important;
        position:relative!important;
        z-index:4!important;
        padding:8px 12px 12px!important;
        margin-top:0!important;
        background:linear-gradient(180deg,rgba(6,13,31,0),rgba(6,13,31,.78) 34%,rgba(6,13,31,.92))!important;
      }
      html.light #view-todayCronos .todaySections[data-focus="all"] .todayMore{
        background:linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,.88) 34%,rgba(255,255,255,.96))!important;
      }

      /* Filtro específico pode abrir a página inteira */
      #view-todayCronos .todaySections[data-focus]:not([data-focus="all"]) .todayCard{
        height:auto!important;
        min-height:420px!important;
        max-height:none!important;
        overflow:visible!important;
      }
      #view-todayCronos .todaySections[data-focus]:not([data-focus="all"]) .todayList{
        display:flex!important;
        flex-direction:column!important;
        height:auto!important;
        min-height:0!important;
        max-height:none!important;
        overflow:visible!important;
      }
      @media(max-width:980px){
        #view-todayCronos .todaySections[data-focus="all"] .todayCard{
          height:auto!important;
          min-height:360px!important;
          max-height:none!important;
          overflow:visible!important;
        }
        #view-todayCronos .todaySections[data-focus="all"] .todayList{
          max-height:none!important;
          overflow:visible!important;
        }
        #view-todayCronos .todaySections[data-focus="all"] .todayItemTop{
          padding-right:0!important;
          padding-top:34px!important;
        }
        #view-todayCronos .todaySections[data-focus="all"] .todayBadge{
          left:0!important;
          right:auto!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function installTodayPriorityDesign(){
    if(document.getElementById('cronosTodayPriorityDesign')) return;
    const style = document.createElement('style');
    style.id = 'cronosTodayPriorityDesign';
    style.textContent = `
      #view-todayCronos{--tc-bg:#060d1f;--tc-blue:#1677ff;--tc-cyan:#19c6ff;--tc-green:#2ee6a6;--tc-red:#ff5a7a;--tc-orange:#f59e0b;--tc-purple:#a855f7}
      #view-todayCronos .todayWrap{gap:14px!important;max-width:100%;}
      #view-todayCronos .todayHero{padding:0!important;background:transparent!important;border:none!important;box-shadow:none!important;align-items:center!important}
      #view-todayCronos .todayHeroMain h2{font-size:28px!important;line-height:1.08!important;letter-spacing:-.035em!important;margin:0!important}
      #view-todayCronos .todayHeroMain p{max-width:680px!important;margin:7px 0 0!important;color:var(--tc-muted)!important}
      #view-todayCronos .todayDateLine{display:inline-flex!important;align-items:center!important;gap:8px!important;margin-top:10px!important;color:#8ec5ff!important;font-weight:850!important;font-size:13px!important}
      html.light #view-todayCronos .todayDateLine{color:#2563eb!important}
      #view-todayCronos .todayRefreshTop{border-radius:14px!important;padding:10px 14px!important;background:rgba(22,119,255,.10)!important;border-color:rgba(25,198,255,.24)!important;color:#cfe8ff!important}
      html.light #view-todayCronos .todayRefreshTop{background:#eef6ff!important;color:#1d4ed8!important;border-color:rgba(37,99,235,.18)!important}
      #view-todayCronos .todayTopGrid{display:grid!important;grid-template-columns:minmax(0,1fr) 310px!important;gap:16px!important;align-items:stretch!important}
      #view-todayCronos .todayPriorityCard,#view-todayCronos .todaySuggestionCard{border:1px solid var(--tc-line)!important;border-radius:20px!important;background:linear-gradient(135deg,rgba(22,119,255,.13),rgba(25,198,255,.045) 48%,rgba(46,230,166,.06)),var(--tc-card)!important;box-shadow:0 16px 44px rgba(0,0,0,.20)!important;padding:16px!important;color:var(--tc-text)!important}
      html.light #view-todayCronos .todayPriorityCard,html.light #view-todayCronos .todaySuggestionCard{background:linear-gradient(135deg,rgba(37,99,235,.09),rgba(20,184,214,.055),rgba(45,212,191,.05)),rgba(255,255,255,.90)!important;box-shadow:0 10px 30px rgba(15,23,42,.07)!important}
      #view-todayCronos .todayPriorityTitle,#view-todayCronos .todaySuggestionTitle{display:flex!important;align-items:center!important;gap:8px!important;margin:0 0 12px!important;font-size:14px!important;font-weight:950!important;color:var(--tc-text)!important}
      #view-todayCronos .todayPriorityGrid{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:10px!important;align-items:stretch!important}
      #view-todayCronos .todayPriorityTile{position:relative!important;overflow:hidden!important;border:1px solid var(--tc-line)!important;border-radius:16px!important;background:rgba(255,255,255,.035)!important;padding:13px 13px 15px!important;min-height:104px!important;display:grid!important;grid-template-columns:auto 1fr!important;gap:10px!important;align-items:start!important}
      html.light #view-todayCronos .todayPriorityTile{background:rgba(255,255,255,.70)!important}
      #view-todayCronos .todayPriorityTile:after{content:""!important;position:absolute!important;left:0!important;right:0!important;bottom:0!important;height:3px!important;background:var(--tile-color,#19c6ff)!important;box-shadow:0 0 18px var(--tile-color,#19c6ff)!important}
      #view-todayCronos .todayPriorityIcon{width:36px!important;height:36px!important;border-radius:12px!important;display:grid!important;place-items:center!important;font-size:18px!important;background:color-mix(in srgb,var(--tile-color,#19c6ff) 18%,transparent)!important;color:var(--tile-color,#19c6ff)!important;border:1px solid color-mix(in srgb,var(--tile-color,#19c6ff) 35%,transparent)!important}\n      #view-todayCronos .todayPriorityIcon svg{width:18px!important;height:18px!important;display:block!important}
      #view-todayCronos .todayPriorityValue{font-size:26px!important;font-weight:950!important;line-height:1!important;color:var(--tc-text)!important}
      #view-todayCronos .todayPriorityLabel{font-size:12px!important;color:var(--tc-muted)!important;line-height:1.35!important;margin-top:5px!important}
      #view-todayCronos .todayPriorityBtn{grid-column:4!important;align-self:end!important;justify-content:center!important;border-radius:14px!important;background:linear-gradient(135deg,#1677ff,#19c6ff)!important;border-color:rgba(25,198,255,.38)!important;color:#fff!important;font-weight:950!important;box-shadow:0 14px 28px rgba(22,119,255,.20)!important}
      #view-todayCronos .todaySuggestionCard{display:grid!important;grid-template-rows:auto 1fr auto!important;gap:10px!important}
      #view-todayCronos .todaySuggestionBody{display:grid!important;grid-template-columns:54px 1fr!important;gap:12px!important;align-items:center!important;color:var(--tc-text)!important;font-weight:780!important;line-height:1.35!important;font-size:13px!important}
      #view-todayCronos .todayRobot{width:54px!important;height:54px!important;border-radius:18px!important;display:grid!important;place-items:center!important;background:linear-gradient(135deg,rgba(22,119,255,.24),rgba(46,230,166,.12))!important;border:1px solid rgba(25,198,255,.18)!important;font-size:28px!important;overflow:hidden!important;padding:8px!important}\n      #view-todayCronos .todayRobot svg{width:100%!important;height:100%!important;display:block!important}\n      #view-todayCronos .todayRobot .todaySuggestionImg{width:100%!important;height:100%!important;object-fit:contain!important;display:block!important}\n      #view-todayCronos .todayRobot.is-fallback:after{content:\"\"!important;width:100%!important;height:100%!important;display:block!important;background:linear-gradient(135deg,#1677ff,#2ee6a6)!important;border-radius:14px!important;opacity:.35!important}
      #view-todayCronos .todaySuggestionCard .todayBtn{justify-content:center!important;text-align:center!important;border-radius:13px!important;font-weight:900!important;color:#9ed8ff!important}
      #view-todayCronos .todayGrid.todayChipRow{display:flex!important;gap:9px!important;flex-wrap:wrap!important;align-items:center!important}
      #view-todayCronos .todayGrid.todayChipRow .todayKpi{width:auto!important;min-height:38px!important;min-width:auto!important;display:inline-flex!important;flex:0 0 auto!important;border-radius:12px!important;padding:8px 11px!important;background:rgba(255,255,255,.035)!important}
      #view-todayCronos .todayGrid.todayChipRow .todayKpi.active{background:linear-gradient(135deg,rgba(22,119,255,.95),rgba(25,198,255,.86))!important;border-color:rgba(25,198,255,.45)!important;color:#fff!important;box-shadow:0 14px 30px rgba(22,119,255,.20)!important}
      #view-todayCronos .todayGrid.todayChipRow .todayKpi b{order:2!important;margin-left:5px!important;min-width:24px!important;min-height:22px!important;background:rgba(255,255,255,.10)!important}
      #view-todayCronos .todayGrid.todayChipRow .todayKpi span{font-weight:880!important;white-space:nowrap!important}
      #view-todayCronos .todaySections{grid-template-columns:1fr 1fr!important;gap:16px!important}
      #view-todayCronos .todayCard{min-height:0!important;border-radius:18px!important;background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012)),var(--tc-card)!important;box-shadow:0 14px 34px rgba(0,0,0,.18)!important}
      #view-todayCronos .todayCardHeader{padding:14px 16px!important;background:linear-gradient(135deg,rgba(22,119,255,.13),rgba(25,198,255,.07))!important}
      #view-todayCronos .todayCardHeader h3{font-size:17px!important;font-weight:950!important;letter-spacing:-.02em!important;display:flex!important;align-items:center!important;gap:8px!important}\n      #view-todayCronos .todayHeadIcon{width:22px!important;height:22px!important;border-radius:8px!important;display:inline-grid!important;place-items:center!important;background:linear-gradient(135deg,rgba(22,119,255,.18),rgba(25,198,255,.10))!important;border:1px solid rgba(25,198,255,.18)!important;color:#67e8f9!important;flex:0 0 auto!important}\n      #view-todayCronos .todayHeadIcon svg{width:14px!important;height:14px!important;display:block!important}
      #view-todayCronos .todayCardHeader .todayCountBadge,#view-todayCronos .todayCardHeader>span{min-width:28px!important;height:24px!important;border-radius:999px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;border:1px solid var(--tc-line)!important;background:rgba(255,255,255,.06)!important;color:var(--tc-text)!important;font-weight:900!important}
      #view-todayCronos .todayList{gap:8px!important;padding:12px!important;max-height:318px!important}
      #view-todayCronos .todayItem{position:relative!important;overflow:hidden!important;border-radius:14px!important;padding:11px 11px 11px 15px!important;background:rgba(255,255,255,.035)!important;border-color:rgba(183,212,255,.12)!important}
      #view-todayCronos .todayItem:before{content:""!important;position:absolute!important;left:0!important;top:0!important;bottom:0!important;width:3px!important;background:var(--urgency,#19c6ff)!important;box-shadow:0 0 16px var(--urgency,#19c6ff)!important}
      #view-todayCronos .todayUrgency-overdue{--urgency:#ef4444!important}.todayUrgency-today{--urgency:#fbbf24!important}.todayUrgency-receipt{--urgency:#2ee6a6!important}.todayUrgency-birthday{--urgency:#a855f7!important}.todayUrgency-flow{--urgency:#19c6ff!important}
      #view-todayCronos .todayItemTitle{font-size:14px!important;letter-spacing:-.01em!important}
      #view-todayCronos .todayBadge{font-weight:900!important;color:var(--badge-color,var(--tc-muted))!important;border-color:color-mix(in srgb,var(--badge-color,#19c6ff) 30%,transparent)!important;background:color-mix(in srgb,var(--badge-color,#19c6ff) 12%,transparent)!important}
      #view-todayCronos .todayBadge.overdue{--badge-color:#ef4444!important}.todayBadge.today{--badge-color:#fbbf24!important}.todayBadge.ok{--badge-color:#2ee6a6!important}.todayBadge.info{--badge-color:#19c6ff!important}.todayBadge.purple{--badge-color:#a855f7!important}
      #view-todayCronos .todayActions{gap:7px!important}
      #view-todayCronos .todayBtn{display:inline-flex!important;align-items:center!important;gap:6px!important;border-radius:10px!important;font-size:11.5px!important;font-weight:850!important;padding:7px 10px!important;background:rgba(255,255,255,.045)!important}
      #view-todayCronos .todayBtn.primary{background:rgba(22,119,255,.16)!important;border-color:rgba(22,119,255,.40)!important;color:#b8dcff!important}
      #view-todayCronos .todayBtn.ok{background:rgba(46,230,166,.12)!important;border-color:rgba(46,230,166,.34)!important;color:#b7ffe5!important}
      #view-todayCronos .todayBtn.warn{background:rgba(245,158,11,.12)!important;border-color:rgba(245,158,11,.36)!important;color:#ffdca8!important}
      #view-todayCronos .todayBtn.danger{background:rgba(239,68,68,.12)!important;border-color:rgba(239,68,68,.36)!important;color:#fecaca!important}
      #view-todayCronos .todayMore{padding:0 12px 12px!important}.todayMore .todayBtn{min-width:210px!important;justify-content:center!important;color:#8bd3ff!important}
      html.light #view-todayCronos .todayItem{background:rgba(255,255,255,.74)!important;border-color:rgba(37,99,235,.11)!important}html.light #view-todayCronos .todayBtn{background:#f8fafc!important;color:#334155!important}html.light #view-todayCronos .todayBtn.primary{background:#eaf4ff!important;color:#1d4ed8!important}html.light #view-todayCronos .todayBtn.ok{background:#ecfdf5!important;color:#047857!important}html.light #view-todayCronos .todayBtn.warn{background:#fffbeb!important;color:#b45309!important}html.light #view-todayCronos .todayBtn.danger{background:#fff1f2!important;color:#be123c!important}
      @media(max-width:1240px){#view-todayCronos .todayTopGrid{grid-template-columns:1fr!important}#view-todayCronos .todayPriorityGrid{grid-template-columns:repeat(2,minmax(0,1fr))!important}#view-todayCronos .todayPriorityBtn{grid-column:auto!important}}
      @media(max-width:920px){#view-todayCronos .todaySections{grid-template-columns:1fr!important}#view-todayCronos .todayPriorityGrid{grid-template-columns:1fr!important}}
    `;
    document.head.appendChild(style);
  }

  function syncNavBadgeStyle(){
    try{
      const badge = $("todayNavBadge");
      const ref =
        document.getElementById("pillTotal") ||
        document.getElementById("pillKanban") ||
        document.getElementById("pillTasks") ||
        document.getElementById("pillUsers");

      if(!badge || !ref) return;

      const cs = getComputedStyle(ref);
      const props = [
        "backgroundColor","borderTopColor","borderRightColor","borderBottomColor","borderLeftColor",
        "borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth",
        "borderTopStyle","borderRightStyle","borderBottomStyle","borderLeftStyle",
        "borderRadius","color","fontSize","fontWeight","boxShadow","minWidth","height","paddingTop",
        "paddingRight","paddingBottom","paddingLeft"
      ];

      props.forEach(p=>{
        try{ badge.style[p] = cs[p]; }catch(_){}
      });

      badge.style.display = "inline-flex";
      badge.style.alignItems = "center";
      badge.style.justifyContent = "center";
      badge.style.marginLeft = "auto";
      badge.style.lineHeight = "1";
      badge.style.fontFamily = cs.fontFamily || "inherit";
    }catch(_){}
  }

  function todayCollectionsCacheKey(db, a){
    const version = Number(window.__CRONOS_DATA_VERSION__ || 0);
    const contactsLen = Array.isArray(db?.contacts) ? db.contacts.length : 0;
    const entriesLen = Array.isArray(db?.entries) ? db.entries.length : 0;
    const tasksLen = Array.isArray(db?.tasks) ? db.tasks.length : 0;
    const paymentsLen = Array.isArray(db?.payments) ? db.payments.length : 0;
    const flowRunsLen = Array.isArray(db?.flowRuns || db?.assistedFlowRuns) ? (db.flowRuns || db.assistedFlowRuns || []).length : 0;
    return [a?.masterId || "", todayISO(), version, contactsLen, entriesLen, tasksLen, paymentsLen, flowRunsLen].join("|");
  }

  function invalidateTodayCache(){
    TODAY_STATE.cacheKey = "";
    TODAY_STATE.cacheData = null;
  }

  function getTodayCollections(options={}){
    const db = load();
    const a = actor();
    if(!db || !a) return { total:0, overdue:0, appointments:[], tasks:[], receipts:[], flows:[], birthdays:[], db:null, actor:null };
    const key = todayCollectionsCacheKey(db, a);
    if(!options.force && TODAY_STATE.cacheKey === key && TODAY_STATE.cacheData){
      return TODAY_STATE.cacheData;
    }

    const appointments = collectAppointments(db, a);
    const tasks = collectTasks(db, a);
    const receipts = collectReceipts(db, a);
    const flows = collectFlows(db, a);
    const birthdays = collectBirthdays(db, a);
    const all = [...appointments, ...tasks, ...receipts, ...flows, ...birthdays];

    const data = {
      key,
      db,
      actor:a,
      total: all.length,
      overdue: all.filter(x=>x.overdue).length,
      appointments,
      tasks,
      receipts,
      flows,
      birthdays
    };
    TODAY_STATE.cacheKey = key;
    TODAY_STATE.cacheData = data;
    return data;
  }

  function updateNavCount(){
    try{
      const badge = $("todayNavBadge");
      if(!badge) return;
      const data = getTodayCollections();
      badge.textContent = String(data.total || 0);
      badge.title = `${data.total || 0} ação(ões) no Hoje no Cronos` + (data.overdue ? ` • ${data.overdue} atrasada(s)` : "");
      badge.classList.toggle("empty", !data.total);
      syncNavBadgeStyle();
    }catch(_){}
  }

  function renderItemActionsForLead(db, entry){
    // Acesso rápido ao lead
    return `
      <button class="todayBtn primary" onclick="CRONOS_TODAY.openLead('${escapeHTML(entry.id)}')">Abrir lead</button>
    `;
  }

  function renderAppointments(items, db){
    if(!items.length) return `<div class="todayEmpty">Nenhum agendamento pendente para hoje. O caos tirou folga, aparentemente.</div>`;
    return items.map(item=>{
      const e = item.entry;
      const c = getContact(db, e);
      const meta = item.overdue
        ? `⚠️ Agendamento vencido • ${fmtBR(item.date)} ${item.time ? `às ${escapeHTML(item.time)}` : ""} • Status: ${escapeHTML(e.status || "")}`
        : `🔔 Paciente agendado para hoje${item.time ? ` às ${escapeHTML(item.time)}` : ""} • Status: ${escapeHTML(e.status || "")}`;
      return `
        <div class="todayItem ${item.overdue ? "todayUrgency-overdue" : "todayUrgency-today"}">
          <div class="todayItemTop">
            <div>
              <div class="todayItemTitle">${escapeHTML(c.name || "(sem nome)")}</div>
              <div class="todayItemMeta">${meta}</div>
            </div>
            <span class="todayBadge ${item.overdue ? "overdue" : "today"}">${item.overdue ? "Vencido" : "Hoje"}</span>
          </div>
          <div class="todayActions">
            <button class="todayBtn ok" onclick="CRONOS_TODAY.compareceu('${escapeHTML(e.id)}')">Compareceu</button>
            <button class="todayBtn danger" onclick="CRONOS_TODAY.faltou('${escapeHTML(e.id)}')">Faltou</button>
            <button class="todayBtn warn" onclick="CRONOS_TODAY.remarcar('${escapeHTML(e.id)}')">Remarcou</button>
            ${renderItemActionsForLead(db, e)}
          </div>
        </div>
      `;
    }).join("");
  }



  function isoFromBRDate(v){
    const s = String(v || "").trim();
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(!m) return s;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  function isInstallmentTask(t){
    const key = String(t?.key || "").toUpperCase();
    const type = String(t?.type || "").toLowerCase();
    const title = String(t?.title || "").toLowerCase();
    const notes = String(t?.notes || t?.desc || "").toLowerCase();
    return (
      key.startsWith("INST:") ||
      key.startsWith("FININST:") ||
      type === "installment" ||
      title.startsWith("inadimplente:") ||
      (notes.includes("venc:") && notes.includes("r$"))
    );
  }

  function getChargeTemplate(db){
    const tplDefault = `Oi {primeiroNome}! 😊\nTudo bem?\n\nPassando para lembrar que consta uma parcela do seu tratamento com vencimento em {vencimento}, no valor de {valor}.\n\nSe já tiver realizado o pagamento, pode desconsiderar esta mensagem. Caso precise de ajuda, estou por aqui.`;
    const tpl = db?.settings?.waChargeTemplate ? String(db.settings.waChargeTemplate).trim() : "";
    return tpl || tplDefault;
  }

  function parseChargeFromTask(task){
    const title = String(task?.title || "");
    const notes = String(task?.notes || task?.desc || "");
    const out = {
      number: "",
      total: "",
      amount: 0,
      dueDate: task?.dueDate || "",
      payMethod: "",
      planTitle: ""
    };

    const titleParcel = title.match(/Parcela\s+(\d+)\s*\/\s*(\d+)/i);
    if(titleParcel){
      out.number = titleParcel[1];
      out.total = titleParcel[2];
    }

    const parts = notes.split("•").map(x=>x.trim()).filter(Boolean);
    const vencPart = parts.find(p=>/^Venc:/i.test(p));
    if(vencPart){
      out.dueDate = isoFromBRDate(vencPart.replace(/^Venc:\s*/i, "").trim());
    }

    const moneyPart = parts.find(p=>/R\$\s*[\d.,]+/i.test(p));
    if(moneyPart){
      const raw = (moneyPart.match(/R\$\s*([\d.,]+)/i) || [])[1] || "";
      out.amount = Number(raw.replace(/\./g, "").replace(",", ".")) || 0;
    }

    const methodPart = parts[2] || "";
    if(methodPart) out.payMethod = methodPart;

    const planMatch = title.match(/•\s*(.*?)\s*•\s*Parcela/i);
    if(planMatch) out.planTitle = planMatch[1].trim();

    return out;
  }

  function chargeInfoFromTask(db, task, entry){
    const fallback = parseChargeFromTask(task);
    if(!entry) return fallback;

    const key = String(task?.key || "");

    if(key.startsWith("FININST:")){
      const parts = key.split(":");
      const planId = parts[2] || task?.financialPlanId || "";
      const paymentId = parts[3] || task?.financialPaymentId || "";
      const plans = Array.isArray(entry.financialPlans) ? entry.financialPlans : [];
      const plan = plans.find(p=>String(p.id)===String(planId));
      const pay = plan?.payments?.find?.(p=>String(p.id)===String(paymentId));
      if(pay){
        return {
          number: pay.number || fallback.number || "",
          total: pay.total || fallback.total || "",
          amount: parseMoney(pay.amount || fallback.amount || 0),
          dueDate: pay.dueDate || fallback.dueDate || "",
          payMethod: pay.payMethod || fallback.payMethod || "",
          planTitle: plan?.title || fallback.planTitle || ""
        };
      }
    }

    if(key.startsWith("INST:")){
      const parts = key.split(":");
      const due = parts[2] || fallback.dueDate || "";
      const number = parts[3] || fallback.number || "";
      const inst = (entry.installments || []).find(p=>{
        const sameNumber = String(p.number || "") === String(number || "");
        const sameDue = String(p.dueDate || p.due || "") === String(due || "");
        return (sameNumber && (!due || sameDue)) || (sameDue && (!number || sameNumber));
      });
      if(inst){
        return {
          number: inst.number || fallback.number || "",
          total: inst.total || fallback.total || "",
          amount: parseMoney(inst.amount || fallback.amount || 0),
          dueDate: inst.dueDate || inst.due || fallback.dueDate || "",
          payMethod: inst.payMethod || entry.installPlan?.payMethod || fallback.payMethod || "",
          planTitle: entry.installPlan?.title || entry.treatment || fallback.planTitle || ""
        };
      }
    }

    return fallback;
  }

  function buildChargeMessage(db, task, entry){
    const c = entry ? getContact(db, entry) : {};
    const nome = c.name || task?.contactName || "";
    const primeiro = firstName(nome);
    const info = chargeInfoFromTask(db, task, entry);
    const tpl = getChargeTemplate(db);

    return tpl
      .replaceAll("{nome}", String(nome || ""))
      .replaceAll("{primeiroNome}", String(primeiro || nome || ""))
      .replaceAll("{primeiro_nome}", String(primeiro || nome || ""))
      .replaceAll("{parcela}", String(info.number || ""))
      .replaceAll("{total}", String(info.total || ""))
      .replaceAll("{valor}", moneyBR(info.amount || 0))
      .replaceAll("{vencimento}", info.dueDate ? fmtBR(info.dueDate) : "")
      .replaceAll("{forma}", String(info.payMethod || ""))
      .replaceAll("{titulo}", String(info.planTitle || ""))
      .replaceAll("{tratamento}", String(info.planTitle || entry?.treatment || ""));
  }

  function firstName(fullName){
    const s = String(fullName || "").trim();
    if(!s) return "";
    return s.split(/\s+/)[0];
  }

  function isNoShowTask(t){
    const key = String(t?.key || "").toUpperCase();
    const title = String(t?.title || "").toLowerCase();
    const notes = String(t?.notes || t?.desc || "").toLowerCase();
    return (
      key.startsWith("NO_SHOW:") ||
      title.startsWith("remarcar falta") ||
      notes.includes("paciente faltou")
    );
  }

  function buildNoShowPatientMessage(db, task, entry){
    const c = entry ? getContact(db, entry) : {};
    const nome = firstName(c.name || task?.contactName || "");
    const data = entry?.apptDate || task?.apptDate || task?.date || "";
    const hora = entry?.apptTime || task?.apptTime || "";
    const quando = data ? `${fmtBR(data)}${hora ? ` às ${hora}` : ""}` : "do seu horário";

    return `Oi${nome ? `, ${nome}` : ""}! Tudo bem?\n\nVi aqui que você não conseguiu comparecer ao seu horário do dia ${quando}. Aconteceu algum imprevisto?\n\nSe ainda fizer sentido pra você, posso te ajudar a remarcar um novo horário por aqui.`;
  }

  function taskPatientMessage(db, task, entry){
    if(isNoShowTask(task)){
      return buildNoShowPatientMessage(db, task, entry);
    }
    if(isInstallmentTask(task)){
      return buildChargeMessage(db, task, entry);
    }
    return task?.message || task?.notes || task?.desc || task?.title || "";
  }

  function openTaskWhats(taskId){
    const db = load();
    if(!db) return toast("WhatsApp", "Não consegui carregar os dados agora.");

    const task = (db.tasks || []).find(x=>String(x.id) === String(taskId));
    if(!task) return toast("WhatsApp", "Tarefa não encontrada.");

    const entry = getTaskEntry(db, task);
    const msg = taskPatientMessage(db, task, entry);
    const phone = taskPhone(db, task, entry);

    if(phone){
      window.open(waLink(phone, msg), "_blank");
      return;
    }

    if(entry && typeof window.openWhats === "function"){
      if(msg) copyText(msg);
      try{
        window.openWhats(entry.id);
        return;
      }catch(_){}
    }

    if(msg) copyText(msg);
    toast("Telefone não encontrado", "Copiei a mensagem, mas esse registro ainda não tem telefone vinculado.");
  }

  function renderTasksList(items, db){
    if(!items.length) return `<div class="todayEmpty">Nenhuma tarefa vencida para hoje. Milagre administrativo detectado.</div>`;
    return items.map(item=>{
      const t = item.task;
      const e = getTaskEntry(db, t);
      const c = e ? getContact(db, e) : getContactById(db, t.contactId || t.contact_id || "");
      const leadName = c?.name || e?.name || e?.lead || t.leadName || t.contactName || t.patientName || "";
      const phone = taskPhone(db, t, e);
      const msg = taskPatientMessage(db, t, e);
      const internalNote = t.message || t.notes || t.desc || "";
      const canUseWhats = !!phone || !!e || !!msg || !!t.wa || String(t.action || "").toLowerCase().includes("whatsapp");
      return `
        <div class="todayItem ${item.overdue ? "todayUrgency-overdue" : "todayUrgency-today"}">
          <div class="todayItemTop">
            <div>
              <div class="todayItemTitle">${escapeHTML(t.title || "Tarefa")}</div>
              ${leadName ? `<div class="todayItemMeta todayLeadLine">Lead: <b>${escapeHTML(leadName)}</b>${phone ? ` • ${escapeHTML(String(phone).replace(/\D/g,""))}` : ""}</div>` : `<div class="todayItemMeta todayLeadLine orphan">Tarefa sem lead vinculado</div>`}
              <div class="todayItemMeta">${item.overdue ? "Atrasada" : "Hoje"} • ${fmtBR(t.dueDate)} ${t.action ? `• ${escapeHTML(t.action)}` : ""}</div>
              ${internalNote ? `<div class="todayItemMeta">${escapeHTML(isNoShowTask(t) ? msg : internalNote).slice(0,260)}</div>` : ""}
            </div>
            <span class="todayBadge ${item.overdue ? "overdue" : "today"}">${item.overdue ? "Atrasada" : "Hoje"}</span>
          </div>
          <div class="todayActions">
            <button class="todayBtn ok" onclick="CRONOS_TODAY.doneTask('${escapeHTML(t.id)}')">Marcar feito</button>
            <button class="todayBtn warn" onclick="CRONOS_TODAY.postponeTask('${escapeHTML(t.id)}')">Adiar</button>
            ${msg ? `<button class="todayBtn" onclick="CRONOS_TODAY.copy(${JSON.stringify(msg).replace(/"/g,'&quot;')})">Copiar</button>` : ""}
            ${canUseWhats ? `<button class="todayBtn wa" onclick="CRONOS_TODAY.openTaskWhats('${escapeHTML(t.id)}')">WhatsApp</button>` : ""}
            ${e ? `<button class="todayBtn primary" onclick="CRONOS_TODAY.openLead('${escapeHTML(e.id)}')">Abrir lead</button>` : ""}
          </div>
        </div>
      `;
    }).join("");
  }


  function buildDirectReceiptChargeMessage(db, entry, plan, payment, legacyInstallment){
    const c = entry ? getContact(db, entry) : {};
    const taskLike = {
      key: legacyInstallment ? `INST:${entry?.id || ""}:${legacyInstallment.dueDate || legacyInstallment.due || ""}:${legacyInstallment.number || ""}` : `FININST:${entry?.id || ""}:${plan?.id || ""}:${payment?.id || ""}`,
      type: "installment",
      title: legacyInstallment
        ? `Inadimplente: ${c.name || ""} • Parcela ${legacyInstallment.number || ""}/${legacyInstallment.total || ""}`
        : `Inadimplente: ${c.name || ""} • ${plan?.title || "Recebimento"} • Parcela ${payment?.number || ""}/${payment?.total || ""}`,
      notes: legacyInstallment
        ? `Venc: ${fmtBR(legacyInstallment.dueDate || legacyInstallment.due || "")} • ${moneyBR(legacyInstallment.amount || 0)} • ${legacyInstallment.payMethod || entry?.installPlan?.payMethod || "—"}`
        : `Venc: ${fmtBR(payment?.dueDate || "")} • ${moneyBR(payment?.amount || 0)} • ${payment?.payMethod || "—"}`,
      dueDate: legacyInstallment ? (legacyInstallment.dueDate || legacyInstallment.due || "") : (payment?.dueDate || "")
    };
    return buildChargeMessage(db, taskLike, entry);
  }

  function renderReceipts(items, db){
    if(!items.length) return `<div class="todayEmpty">Nenhum recebimento vencendo ou atrasado. O boleto hoje acordou comportado.</div>`;
    return items.map(item=>{
      const e = item.entry;
      const name = item.contact?.name || contactName(db, e);
      if(item.kind === "financial"){
        const p = item.payment;
        const plan = item.plan;
        return `
          <div class="todayItem ${item.overdue ? "todayUrgency-overdue" : "todayUrgency-receipt"}">
            <div class="todayItemTop">
              <div>
                <div class="todayItemTitle">${escapeHTML(name)} • ${moneyBR(p.amount)}</div>
                <div class="todayItemMeta">${item.overdue ? "⚠️ Atrasado" : "Vence hoje"} • ${fmtBR(p.dueDate)} • ${escapeHTML(plan.title || "Recebimento")} • Parcela ${escapeHTML(p.number || "")}/${escapeHTML(p.total || "")}</div>
              </div>
              <span class="todayBadge ${item.overdue ? "overdue" : "ok"}">${item.overdue ? "Atrasado" : "Vence hoje"}</span>
            </div>
            <div class="todayActions">
              <button class="todayBtn ok" onclick="CRONOS_TODAY.payFinancial('${escapeHTML(e.id)}','${escapeHTML(plan.id)}','${escapeHTML(p.id)}')">Dar baixa</button>
              <button class="todayBtn primary" onclick="CRONOS_TODAY.openReceipt('${escapeHTML(e.id)}','${escapeHTML(plan.id)}')">Abrir recebimento</button>
              <button class="todayBtn" onclick="CRONOS_TODAY.copy(${JSON.stringify(buildDirectReceiptChargeMessage(db, e, plan, p, null)).replace(/"/g,'&quot;')})">Copiar</button>
              ${contactPhone(db,e) ? `<a class="todayBtn wa" target="_blank" href="${waLink(contactPhone(db,e), buildDirectReceiptChargeMessage(db, e, plan, p, null))}">WhatsApp</a>` : ""}
              <button class="todayBtn primary" onclick="CRONOS_TODAY.openLead('${escapeHTML(e.id)}')">Abrir lead</button>
            </div>
          </div>
        `;
      }

      const p = item.installment;
      return `
        <div class="todayItem ${item.overdue ? "todayUrgency-overdue" : "todayUrgency-receipt"}">
          <div class="todayItemTop">
            <div>
              <div class="todayItemTitle">${escapeHTML(name)} • ${moneyBR(p.amount)}</div>
              <div class="todayItemMeta">${item.overdue ? "⚠️ Atrasado" : "Vence hoje"} • ${fmtBR(p.dueDate || p.due)} • Parcela ${escapeHTML(p.number || "")}/${escapeHTML(p.total || "")}</div>
            </div>
            <span class="todayBadge ${item.overdue ? "overdue" : "ok"}">${item.overdue ? "Atrasado" : "Vence hoje"}</span>
          </div>
          <div class="todayActions">
            <button class="todayBtn ok" onclick="CRONOS_TODAY.payLegacy('${escapeHTML(e.id)}', ${Number(p.number || 0)})">Dar baixa</button>
            <button class="todayBtn primary" onclick="CRONOS_TODAY.openReceipt('${escapeHTML(e.id)}')">Abrir recebimento</button>
            <button class="todayBtn" onclick="CRONOS_TODAY.copy(${JSON.stringify(buildDirectReceiptChargeMessage(db, e, null, null, p)).replace(/"/g,'&quot;')})">Copiar</button>
            ${contactPhone(db,e) ? `<a class="todayBtn wa" target="_blank" href="${waLink(contactPhone(db,e), buildDirectReceiptChargeMessage(db, e, null, null, p))}">WhatsApp</a>` : ""}
            <button class="todayBtn primary" onclick="CRONOS_TODAY.openLead('${escapeHTML(e.id)}')">Abrir lead</button>
          </div>
        </div>
      `;
    }).join("");
  }


  function renderBirthdays(items, db){
    if(!items.length){
      return `<div class="todayEmpty">Nenhum aniversariante hoje. O bolo foi cancelado, mas o Cronos está atento.</div>`;
    }

    return items.map(item=>{
      const c = item.contact || {};
      const e = item.entry || null;
      const msg = buildBirthdayMessage(db, c, item.age);
      return `
        <div class="todayItem todayUrgency-birthday">
          <div class="todayItemTop">
            <div>
              <div class="todayItemTitle">${escapeHTML(c.name || "(sem nome)")}</div>
              <div class="todayItemMeta">🎉 Aniversário hoje${item.age ? ` • ${escapeHTML(item.age)} anos` : ""}</div>
              <div class="todayItemMeta">Mensagem pronta para envio 🎈</div>
            </div>
            <span class="todayBadge purple">Aniversário</span>
          </div>
          <div class="todayActions">
            <button class="todayBtn" onclick="CRONOS_TODAY.copy(${JSON.stringify(msg).replace(/"/g,'&quot;')})">Copiar</button>
            ${c.phone ? `<a class="todayBtn wa" target="_blank" href="${waLink(c.phone, msg)}">WhatsApp</a>` : ""}
            ${e ? `<button class="todayBtn primary" onclick="CRONOS_TODAY.openLead('${escapeHTML(e.id)}')">Abrir lead</button>` : ""}
          </div>
        </div>
      `;
    }).join("");
  }

  function renderFlows(items, db){
    if(!items.length){
      return `<div class="todayEmpty">Nenhum fluxo assistido vencendo hoje. Silêncio raro, mas o Cronos não dorme no ponto.</div>`;
    }
    return items.map(item=>{
      const e = item.entry;
      const c = getContact(db, e);
      const step = item.step;
      const msg = String(
        step.message ||
        step.text ||
        step.whatsappMessage ||
        step.waMessage ||
        step.messageText ||
        step.msg ||
        step.body ||
        step.content ||
        step.copy ||
        ""
      ).trim();
      const internalNote = step.internalNote || step.note || step.instruction || "";
      const mediaHint = step.mediaHint || step.media || step.fileHint || "";
      const link = step.link || step.mediaUrl || "";
      return `
        <div class="todayItem ${item.overdue ? "todayUrgency-overdue" : "todayUrgency-flow"}">
          <div class="todayItemTop">
            <div>
              <div class="todayItemTitle">${escapeHTML(c.name || "(sem nome)")} • ${escapeHTML(item.run.flowName || item.run.name || "Fluxo")}</div>
              <div class="todayItemMeta">${item.overdue ? "⚠️ Atrasado" : "Hoje"} • etapa ${escapeHTML(step.index || "")} • ${escapeHTML(step.title || "Mensagem do fluxo")}</div>
              ${msg ? `<div class="todayItemMeta">${escapeHTML(msg).slice(0,220)}</div>` : ""}
              ${internalNote ? `<div class="todayItemMeta"><b>Obs. interna:</b> ${escapeHTML(internalNote).slice(0,180)}</div>` : ""}
              ${mediaHint ? `<div class="todayItemMeta"><b>Mídia/lembrete:</b> ${escapeHTML(mediaHint).slice(0,160)}</div>` : ""}
              ${link ? `<div class="todayItemMeta"><b>Link:</b> ${escapeHTML(link).slice(0,180)}</div>` : ""}
            </div>
            <span class="todayBadge info">Fluxo</span>
          </div>
          <div class="todayActions">
            ${msg ? `<button class="todayBtn" onclick="CRONOS_TODAY.copy(${JSON.stringify(msg).replace(/"/g,'&quot;')})">Copiar mensagem</button>` : ""}
            ${(() => {
              const flowPhone = contactPhone(db,e) || c.phone || e.phone || e.telefone || e.whatsapp || e.whatsApp || e.celular || e.mobile;
              if(!flowPhone) return "";
              const flowMsg = msg || "";
              return `<a class="todayBtn wa" target="_blank" href="${waLink(flowPhone, flowMsg)}">WhatsApp</a>`;
            })()}
            ${link ? `<a class="todayBtn" target="_blank" href="${escapeHTML(link)}">Abrir link</a>` : ""}
            <button class="todayBtn ok" onclick="CRONOS_TODAY.doneFlow('${escapeHTML(item.run.id)}', ${Number(step.index || 0)})">Marcar enviado</button>
            <button class="todayBtn danger" onclick="CRONOS_TODAY.finishFlow('${escapeHTML(item.run.id)}')">Encerrar fluxo</button>
            ${renderItemActionsForLead(db, e)}
          </div>
        </div>
      `;
    }).join("");
  }

  function render(options={}){
    addStyles();
    installV94Refinements();
    installTodayPriorityDesign();
    installTodayV27Fixes();
    installTodayV28CardScrollFix();
    installTodayV29CacheFix();
    installTodayV31InnerCardAutoHeight();
    installTodayV76Polish();
    installTodayV77TitleAndSuggestionFixes();
    installTodayV78PriorityGradient();
    installTodayV79ModuleChipGradient();
    installTodayV80ButtonAndChipPolish();
    installTodayV81InstantChipClick();
    installTodayV82PendingContentState();
    loadTodaySuggestionSettings();
    ensureNav();
    const view = ensureView();
    const db = load();
    const a = actor();

    if(!db || !a){
      view.innerHTML = `<div class="todayEmpty">Cronos ainda está carregando. Respira, jovem padawan do boleto.</div>`;
      return;
    }

    const runRender = (force=false)=>{
      const data = getTodayCollections({ force });
      const db = data.db || load();
      const appointmentsAll = data.appointments || [];
      const tasksAll = data.tasks || [];
      const receiptsAll = data.receipts || [];
      const flowsAll = data.flows || [];
      const birthdaysAll = data.birthdays || [];
      const overdueCount = Number(data.overdue || 0);
      const total = Number(data.total || 0);

      const appointments = filterSectionItems("appointments", appointmentsAll);
      const tasks = filterSectionItems("tasks", tasksAll);
      const receipts = filterSectionItems("receipts", receiptsAll);
      const flows = filterSectionItems("flows", flowsAll);
      const birthdays = filterSectionItems("birthdays", birthdaysAll);

      const activeFilter = TODAY_STATE.filter || "all";
      const kpiCls = (f)=>`todayKpi ${activeFilter===f ? "active" : ""}`;
      setTimeout(updateNavCount, 0);

      const apptOverdueCount = appointmentsAll.filter(x=>x.overdue).length;
      const taskOverdueCount = tasksAll.filter(x=>x.overdue).length;
      const receiptOverdueCount = receiptsAll.filter(x=>x.overdue).length;
      const flowOverdueCount = flowsAll.filter(x=>x.overdue).length;
      const urgentCount = apptOverdueCount + taskOverdueCount + receiptOverdueCount + flowOverdueCount;
      const hasActionableSuggestion = appointmentsAll.length > 0 || tasksAll.length > 0 || receiptsAll.length > 0 || flowsAll.length > 0;
      const hideSuggestionCard = isTodaySuggestionDismissed() || !hasActionableSuggestion;
      const weekDay = weekdayBR(todayISO());
      const showOverdue = activeFilter === "overdue";
      const showAppointments = activeFilter === "all" || activeFilter === "appointments" || showOverdue;
      const showTasks = activeFilter === "all" || activeFilter === "tasks" || showOverdue;
      const showReceipts = activeFilter === "all" || activeFilter === "receipts" || showOverdue;
      const showFlows = activeFilter === "all" || activeFilter === "flows" || showOverdue;
      const showBirthdays = activeFilter === "all" || activeFilter === "birthdays";

      view.innerHTML = `
        <div class="todayWrap">
          <div class="todayHero">
            <div class="todayHeroMain">
              <h2>Hoje no Cronos</h2>
              <p>Acompanhe follow-ups, agendamentos, tarefas e recebimentos que não podem virar fóssil administrativo.</p>
              <div class="todayDateLine">▣ ${fmtBR(todayISO())}${weekDay ? ` • ${weekDay}` : ""}</div>
            </div>
            <div class="todayActions">
              <button id="todayRefreshBtn" class="todayBtn todayRefreshTop" onclick="CRONOS_TODAY.refresh(this)">↻ Atualizar</button>
            </div>
          </div>

          <div class="todayTopGrid ${hideSuggestionCard ? "todaySuggestionIsDismissed" : ""}">
            <section class="todayPriorityCard">
              <div class="todayPriorityTitle">${todayTitleIcon()}<span>Prioridades de hoje</span></div>
              <div class="todayPriorityGrid">
                <div class="todayPriorityTile" style="--tile-color:#ff5a7a"><div class="todayPriorityIcon">${uiIconSvg("calendar")}</div><div><div class="todayPriorityValue">${apptOverdueCount}</div><div class="todayPriorityLabel">Agendamentos vencidos</div></div></div>
                <div class="todayPriorityTile" style="--tile-color:#f59e0b"><div class="todayPriorityIcon">${uiIconSvg("tasks")}</div><div><div class="todayPriorityValue">${tasksAll.length}</div><div class="todayPriorityLabel">Tarefas abertas</div></div></div>
                <div class="todayPriorityTile" style="--tile-color:#2ee6a6"><div class="todayPriorityIcon">${uiIconSvg("money")}</div><div><div class="todayPriorityValue">${receiptsAll.length}</div><div class="todayPriorityLabel">Recebimentos pendentes</div></div></div>
                <button class="todayBtn todayPriorityBtn" onclick="CRONOS_TODAY.setFilter('overdue')">Ver urgentes primeiro ›</button>
              </div>
            </section>
            ${hasActionableSuggestion ? `<aside class="todaySuggestionCard">
              ${(()=>{ const sug = getTodaySuggestionConfig(); const sugVars = { apptOverdueCount, tasksOpenCount: tasksAll.length, receiptsPendingCount: receiptsAll.length, overdueCount, todayDate: fmtBR(todayISO()) }; return `
              <div class="todaySuggestionTitle">${todayTitleIcon()}<span>${escapeAttr(sug.title || DEFAULT_TODAY_SUGGESTION.title)}</span></div>
              <div class="todaySuggestionBody"><div class="todayRobot">${renderSuggestionIcon(sug)}</div><div>${escapeAttr(applyTemplate(sug.message || DEFAULT_TODAY_SUGGESTION.message, sugVars))}</div></div>
              <button class="todayBtn" ${suggestionButtonOnclick(sug.buttonAction, sug.buttonText || DEFAULT_TODAY_SUGGESTION.buttonText)}>${escapeAttr(sug.buttonText || DEFAULT_TODAY_SUGGESTION.buttonText)}</button>`; })()}
            </aside>` : ""}
          </div>

          <div class="todayGrid todayChipRow">
            <button class="${kpiCls('all')}" data-today-filter="all" onclick="CRONOS_TODAY.setFilter('all', event)"><span>Todos</span><b>${total}</b></button>
            <button class="${kpiCls('overdue')}" data-today-filter="overdue" onclick="CRONOS_TODAY.setFilter('overdue', event)"><span>Atrasados</span><b>${overdueCount}</b></button>
            <button class="${kpiCls('appointments')}" data-today-filter="appointments" onclick="CRONOS_TODAY.setFilter('appointments', event)"><span>Agendamentos</span><b>${appointmentsAll.length}</b></button>
            <button class="${kpiCls('tasks')}" data-today-filter="tasks" onclick="CRONOS_TODAY.setFilter('tasks', event)"><span>Tarefas</span><b>${tasksAll.length}</b></button>
            <button class="${kpiCls('receipts')}" data-today-filter="receipts" onclick="CRONOS_TODAY.setFilter('receipts', event)"><span>Recebimentos</span><b>${receiptsAll.length}</b></button>
            <button class="${kpiCls('birthdays')}" data-today-filter="birthdays" onclick="CRONOS_TODAY.setFilter('birthdays', event)"><span>Aniversariantes</span><b>${birthdaysAll.length}</b></button>
            <button class="${kpiCls('flows')}" data-today-filter="flows" onclick="CRONOS_TODAY.setFilter('flows', event)"><span>Fluxos</span><b>${flowsAll.length}</b></button>
          </div>

          <div class="todaySections" data-focus="${activeFilter}">
            ${showAppointments ? `
            <section class="todayCard ${activeFilter !== "all" ? "todayFull" : ""}" data-section="appointments">
              <div class="todayCardHeader"><h3>${headerIcon("calendar")} Agendamentos vencidos / de hoje</h3><span class="todayCountBadge">${appointments.length}</span></div>
              ${renderLimitedSection('appointments', appointments, (shown)=>renderAppointments(shown, db))}
            </section>` : ""}

            ${showTasks ? `
            <section class="todayCard ${activeFilter !== "all" ? "todayFull" : ""}" data-section="tasks">
              <div class="todayCardHeader"><h3>${headerIcon("tasks")} Tarefas atrasadas / de hoje</h3><span class="todayCountBadge">${tasks.length}</span></div>
              ${renderLimitedSection('tasks', tasks, (shown)=>renderTasksList(shown, db))}
            </section>` : ""}

            ${showReceipts ? `
            <section class="todayCard ${activeFilter !== "all" ? "todayFull" : ""}" data-section="receipts">
              <div class="todayCardHeader"><h3>${headerIcon("money")} Recebimentos vencendo</h3><span class="todayCountBadge">${receipts.length}</span></div>
              ${renderLimitedSection('receipts', receipts, (shown)=>renderReceipts(shown, db))}
            </section>` : ""}

            ${showBirthdays ? `
            <section class="todayCard ${activeFilter !== "all" ? "todayFull" : ""}" data-section="birthdays">
              <div class="todayCardHeader">
                <h3>${headerIcon("gift")} Aniversariantes e retornos</h3>
                <div class="todayHeaderActions">
                  <button class="todayMiniBtn" onclick="CRONOS_TODAY.editBirthdayTemplate()">Editar mensagem</button>
                  <span>${birthdays.length}</span>
                </div>
              </div>
              ${renderLimitedSection('birthdays', birthdays, (shown)=>renderBirthdays(shown, db))}
            </section>` : ""}

            ${showFlows ? `
            <section class="todayCard ${activeFilter !== "all" ? "todayFull" : ""}" data-section="flows">
              <div class="todayCardHeader"><h3>${headerIcon("flow")} Fluxos assistidos</h3><span class="todayCountBadge">${flows.length}</span></div>
              ${renderLimitedSection('flows', flows, (shown)=>renderFlows(shown, db))}
            </section>` : ""}
          </div>
        </div>
      `;
      try{
        TODAY_STATE.lastRenderedHTML = view.innerHTML;
        TODAY_STATE.lastRenderedAt = Date.now();
        saveTodaySnapshot(view.innerHTML);
      }catch(_){}
    };

    if(options.defer){
      const hasValidCache = TODAY_STATE.cacheData && TODAY_STATE.cacheKey === todayCollectionsCacheKey(db, a);
      if(hasValidCache){
        runRender(false);
        return;
      }
      TODAY_STATE.renderToken = (TODAY_STATE.renderToken || 0) + 1;
      const token = TODAY_STATE.renderToken;
      const hasUsableContent = !!(view.innerHTML && !view.querySelector(".todaySkeleton"));
      if(!hasUsableContent){
        if(TODAY_STATE.lastRenderedHTML){
          view.innerHTML = TODAY_STATE.lastRenderedHTML;
        }else{
          renderTodaySkeleton();
        }
      }
      const later = ()=>{
        if(token !== TODAY_STATE.renderToken) return;
        try{ runRender(!!options.force); }
        catch(err){
          console.error("Hoje no Cronos: falha ao renderizar", err);
          view.innerHTML = `<div class="todayEmpty">Não consegui carregar o Hoje no Cronos agora. Atualiza daqui a pouco, que nem todo caos precisa virar drama.</div>`;
        }
      };
      if(typeof requestAnimationFrame === "function") requestAnimationFrame(()=>setTimeout(later, 0));
      else setTimeout(later, 0);
      return;
    }

    runRender(!!options.force);
  }

  function show(){
    if(!canOpenToday()){
      denyTodayAccess();
      return;
    }
    addStyles();
    installV94Refinements();
    installTodayPriorityDesign();
    installTodayV27Fixes();
    installTodayV28CardScrollFix();
    installTodayV29CacheFix();
    installTodayV31InnerCardAutoHeight();
    ensureNav();
    const view = ensureView();
    hideOtherViews();
    // Primeiro clique não pode ficar com tela vazia.
    // Se já existe snapshot, mostra na hora. Se não existe, mostra skeleton imediatamente.
    const isBlank = !String(view.innerHTML || "").trim();
    const isSkeleton = !!view.querySelector(".todaySkeleton");
    if(TODAY_STATE.lastRenderedHTML && (isBlank || isSkeleton)){
      view.innerHTML = TODAY_STATE.lastRenderedHTML;
    }else if(isBlank){
      renderTodaySkeleton();
    }
    scheduleScrollCronosToTop();
    clearTimeout(TODAY_STATE.showTimer);
    TODAY_STATE.showTimer = setTimeout(()=>render({ defer:true }), 20);
  }


  function dismissSuggestion(btn){
    try{
      setTodaySuggestionDismissed(true);
      const grid = btn?.closest?.(".todayTopGrid");
      if(grid) grid.classList.add("todaySuggestionIsDismissed");
      render({ defer:false });
    }catch(_){}
  }

  function refresh(btn){
    invalidateTodayCache();
    updateButtonLoading(btn || $("todayRefreshBtn"), true);
    setTimeout(()=>{
      try{
        render({ force:true, defer:true });
        toast("Hoje no Cronos atualizado ✅");
      }finally{
        setTimeout(()=>updateButtonLoading($("todayRefreshBtn"), false), 120);
      }
    }, 80);
  }

  window.CRONOS_TODAY = {
    show,
    render,
    refresh,
    dismissSuggestion,
    setFilter,
    showMore,
    showLess,
    updateNavCount,
    invalidateTodayCache,
    syncNavBadgeStyle,
    patchDashboardAppointmentKpi,
    fixSidebarDashboardCount,
    editBirthdayTemplate,
    patchBirthDateCloudSync,
    openLead,
    openReceipt,
    compareceu:(id)=>setEntryStatus(id, "Compareceu"),
    faltou:markAppointmentNoShow,
    remarcar:rescheduleAppointment,
    doneTask:markTaskDone,
    postponeTask,
    payFinancial,
    payLegacy,
    copy:copyText,
    openTaskWhats,
    doneFlow:markFlowStepDone,
    finishFlow
  };


  function installTodayV76Polish(){
    if(document.getElementById('cronosTodayV76Polish')) return;
    const style = document.createElement('style');
    style.id = 'cronosTodayV76Polish';
    style.textContent = `
      /* === CRONOS V76 — Hoje no Cronos: polimento claro/escuro === */
      #view-todayCronos{
        --today-danger:#ef4444;
        --today-danger-soft:rgba(239,68,68,.12);
        --today-danger-border:rgba(239,68,68,.34);
        --today-danger-text:#fecaca;
      }
      html.light #view-todayCronos,
      :root.light #view-todayCronos,
      body.light #view-todayCronos{
        --today-danger-text:#dc2626;
      }

      #view-todayCronos .todayTopGrid{
        align-items:stretch!important;
      }

      #view-todayCronos .todayPriorityCard,
      #view-todayCronos .todaySuggestionCard{
        border-radius:22px!important;
        border-color:rgba(148,163,184,.16)!important;
      }
      :root:not(.light) #view-todayCronos .todayPriorityCard,
      html:not(.light) #view-todayCronos .todayPriorityCard,
      body:not(.light) #view-todayCronos .todayPriorityCard,
      :root:not(.light) #view-todayCronos .todaySuggestionCard,
      html:not(.light) #view-todayCronos .todaySuggestionCard,
      body:not(.light) #view-todayCronos .todaySuggestionCard{
        background:
          radial-gradient(520px 220px at 18% 0%, rgba(37,99,235,.14), transparent 64%),
          linear-gradient(180deg, rgba(255,255,255,.046), rgba(255,255,255,.018)),
          rgba(15,23,42,.40)!important;
        border-color:rgba(148,163,184,.16)!important;
        box-shadow:0 16px 42px rgba(2,8,23,.20)!important;
      }
      :root.light #view-todayCronos .todayPriorityCard,
      html.light #view-todayCronos .todayPriorityCard,
      body.light #view-todayCronos .todayPriorityCard,
      :root.light #view-todayCronos .todaySuggestionCard,
      html.light #view-todayCronos .todaySuggestionCard,
      body.light #view-todayCronos .todaySuggestionCard{
        background:
          linear-gradient(180deg, rgba(255,255,255,.96), rgba(255,255,255,.84)),
          radial-gradient(520px 220px at 20% 0%, rgba(37,99,235,.06), transparent 64%)!important;
        border-color:rgba(37,99,235,.12)!important;
        box-shadow:0 10px 28px rgba(15,23,42,.065)!important;
      }

      /* Ver urgentes deixa de parecer botão jogado no chão */
      #view-todayCronos .todayPriorityGrid{
        grid-template-columns:repeat(3,minmax(0,1fr)) auto!important;
        align-items:end!important;
      }
      #view-todayCronos .todayPriorityBtn{
        grid-column:4!important;
        align-self:end!important;
        min-height:42px!important;
        height:42px!important;
        margin:0!important;
        padding:0 14px!important;
        white-space:nowrap!important;
        background:rgba(37,99,235,.10)!important;
        color:#93c5fd!important;
        border-color:rgba(96,165,250,.30)!important;
        box-shadow:none!important;
      }
      html.light #view-todayCronos .todayPriorityBtn,
      :root.light #view-todayCronos .todayPriorityBtn,
      body.light #view-todayCronos .todayPriorityBtn{
        background:#eef6ff!important;
        color:#1d4ed8!important;
        border-color:rgba(37,99,235,.24)!important;
      }
      #view-todayCronos .todayPriorityBtn:hover{
        filter:brightness(1.04)!important;
      }

      /* urgência é vermelho, não rosa */
      #view-todayCronos .todayPriorityTile:first-child{
        --tile-color:var(--today-danger)!important;
      }
      #view-todayCronos .todayUrgency-overdue{
        --urgency:var(--today-danger)!important;
      }
      #view-todayCronos .todayBadge.overdue{
        --badge-color:var(--today-danger)!important;
      }
      #view-todayCronos .todayBtn.danger{
        background:var(--today-danger-soft)!important;
        border-color:var(--today-danger-border)!important;
        color:var(--today-danger-text)!important;
      }
      html.light #view-todayCronos .todayBtn.danger,
      :root.light #view-todayCronos .todayBtn.danger,
      body.light #view-todayCronos .todayBtn.danger{
        background:#fef2f2!important;
        border-color:rgba(239,68,68,.22)!important;
        color:#dc2626!important;
      }

      #view-todayCronos .todayItem:before{
        width:3px!important;
        box-shadow:0 0 14px color-mix(in srgb, var(--urgency,#19c6ff) 55%, transparent)!important;
      }

      html.light #view-todayCronos .todayHero,
      :root.light #view-todayCronos .todayHero,
      body.light #view-todayCronos .todayHero{
        background:
          radial-gradient(680px 300px at 24% 0%, rgba(59,130,246,.10), transparent 65%),
          radial-gradient(560px 260px at 90% 8%, rgba(20,184,166,.10), transparent 70%)!important;
      }

      #view-todayCronos .todaySuggestionDismissed{
        opacity:.35!important;
        transform:scale(.995)!important;
      }
      #view-todayCronos .todaySuggestionDismissed .todaySuggestionBody,
      #view-todayCronos .todaySuggestionDismissed .todayBtn{
        display:none!important;
      }
      #view-todayCronos .todaySuggestionDismissed .todaySuggestionTitle::after{
        content:" entendido";
        color:var(--tc-muted);
        font-weight:750;
      }

      @media(max-width:1240px){
        #view-todayCronos .todayPriorityGrid{
          grid-template-columns:repeat(2,minmax(0,1fr))!important;
        }
        #view-todayCronos .todayPriorityBtn{
          grid-column:auto!important;
          width:100%!important;
        }
      }
      @media(max-width:720px){
        #view-todayCronos .todayPriorityGrid{
          grid-template-columns:1fr!important;
        }
      }
    `;
    document.head.appendChild(style);
  }



  function installTodayV77TitleAndSuggestionFixes(){
    if(document.getElementById('cronosTodayV77TitleAndSuggestionFixes')) return;
    const style = document.createElement('style');
    style.id = 'cronosTodayV77TitleAndSuggestionFixes';
    style.textContent = `
      /* === CRONOS V77 — títulos com SVG + sugestão persistente === */
      #view-todayCronos .todayPriorityTitle,
      #view-todayCronos .todaySuggestionTitle,
      #view-todayCronos .todayCardHeader h3{
        display:flex!important;
        align-items:center!important;
        gap:8px!important;
      }

      #view-todayCronos .todayHeadIcon{
        width:24px!important;
        height:24px!important;
        border-radius:10px!important;
        display:inline-flex!important;
        align-items:center!important;
        justify-content:center!important;
        flex:0 0 auto!important;
        color:#93c5fd!important;
        background:rgba(96,165,250,.10)!important;
        border:1px solid rgba(96,165,250,.20)!important;
      }
      #view-todayCronos .todayHeadIcon svg{
        width:15px!important;
        height:15px!important;
        display:block!important;
        fill:none!important;
        stroke:currentColor!important;
        stroke-width:2.15!important;
        stroke-linecap:round!important;
        stroke-linejoin:round!important;
      }
      html.light #view-todayCronos .todayHeadIcon,
      :root.light #view-todayCronos .todayHeadIcon,
      body.light #view-todayCronos .todayHeadIcon{
        color:#2563eb!important;
        background:rgba(37,99,235,.08)!important;
        border-color:rgba(37,99,235,.15)!important;
      }

      /* Ver urgentes primeiro sai da quarta coluna vazia e vira ação do topo do card */
      #view-todayCronos .todayPriorityCard{
        position:relative!important;
      }
      #view-todayCronos .todayPriorityCard .todayPriorityTitle{
        padding-right:190px!important;
        min-height:34px!important;
      }
      #view-todayCronos .todayPriorityGrid{
        grid-template-columns:repeat(3,minmax(0,1fr))!important;
        align-items:stretch!important;
      }
      #view-todayCronos .todayPriorityBtn{
        position:absolute!important;
        top:14px!important;
        right:16px!important;
        grid-column:auto!important;
        width:auto!important;
        min-width:170px!important;
        height:34px!important;
        min-height:34px!important;
        padding:0 13px!important;
        margin:0!important;
        border-radius:12px!important;
        white-space:nowrap!important;
        align-self:auto!important;
        font-size:11.5px!important;
        box-shadow:none!important;
      }

      /* Entendi persiste no dia e a sugestão some de verdade */
      #view-todayCronos .todayTopGrid.todaySuggestionIsDismissed{
        grid-template-columns:1fr!important;
      }
      #view-todayCronos .todayTopGrid.todaySuggestionIsDismissed .todaySuggestionCard{
        display:none!important;
      }

      @media(max-width:1240px){
        #view-todayCronos .todayPriorityCard .todayPriorityTitle{
          padding-right:0!important;
        }
        #view-todayCronos .todayPriorityBtn{
          position:static!important;
          width:100%!important;
          min-width:0!important;
          margin-top:0!important;
        }
        #view-todayCronos .todayPriorityGrid{
          grid-template-columns:repeat(2,minmax(0,1fr))!important;
        }
      }
      @media(max-width:720px){
        #view-todayCronos .todayPriorityGrid{
          grid-template-columns:1fr!important;
        }
      }
    `;
    document.head.appendChild(style);
  }



  function installTodayV78PriorityGradient(){
    if(document.getElementById('cronosTodayV78PriorityGradient')) return;
    const style = document.createElement('style');
    style.id = 'cronosTodayV78PriorityGradient';
    style.textContent = `
      /* === CRONOS V78 — KPIs do Hoje com degradê dos módulos === */
      #view-todayCronos .todayPriorityTile{
        background:
          linear-gradient(135deg, rgba(22,119,255,.22) 0%, rgba(25,198,255,.14) 56%, rgba(46,230,166,.10) 100%),
          rgba(15,23,42,.26)!important;
        border-color:rgba(96,165,250,.18)!important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.05), 0 12px 28px rgba(2,8,23,.10)!important;
      }
      html.light #view-todayCronos .todayPriorityTile,
      :root.light #view-todayCronos .todayPriorityTile,
      body.light #view-todayCronos .todayPriorityTile{
        background:
          linear-gradient(135deg, rgba(37,99,235,.18) 0%, rgba(14,165,233,.12) 58%, rgba(16,185,129,.10) 100%),
          rgba(255,255,255,.92)!important;
        border-color:rgba(37,99,235,.14)!important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.55), 0 8px 20px rgba(15,23,42,.055)!important;
      }
      #view-todayCronos .todayPriorityTile:hover{
        filter:brightness(1.015)!important;
        transform:translateY(-1px)!important;
      }
      #view-todayCronos .todayPriorityTile:after{
        height:3px!important;
      }
    `;
    document.head.appendChild(style);
  }





  function installTodayV82PendingContentState(){
    if(document.getElementById('cronosTodayV82PendingContentState')) return;
    const style = document.createElement('style');
    style.id = 'cronosTodayV82PendingContentState';
    style.textContent = `
      /* === CRONOS V82 — conteúdo inferior não mostra aba antiga durante troca === */
      #view-todayCronos .todaySectionsPending{
        opacity:1!important;
      }
      #view-todayCronos .todayLoadingCard{
        min-height:260px!important;
        height:auto!important;
      }
      #view-todayCronos .todayLoadingCard .todayList,
      #view-todayCronos .todayLoadingList{
        min-height:210px!important;
        height:210px!important;
        max-height:none!important;
        display:grid!important;
        place-items:center!important;
        overflow:hidden!important;
      }
      #view-todayCronos .todayPendingBox{
        display:flex!important;
        flex-direction:column!important;
        align-items:center!important;
        justify-content:center!important;
        gap:8px!important;
        padding:22px!important;
        min-width:240px!important;
        border:1px solid rgba(96,165,250,.18)!important;
        border-radius:18px!important;
        background:rgba(255,255,255,.035)!important;
        color:var(--tc-text)!important;
        text-align:center!important;
      }
      #view-todayCronos .todayPendingBox strong{
        font-size:13px!important;
        font-weight:900!important;
      }
      #view-todayCronos .todayPendingBox small{
        color:var(--tc-muted)!important;
        font-size:12px!important;
      }
      html.light #view-todayCronos .todayPendingBox,
      :root.light #view-todayCronos .todayPendingBox,
      body.light #view-todayCronos .todayPendingBox{
        background:#f8fbff!important;
        border-color:rgba(37,99,235,.14)!important;
      }
    `;
    document.head.appendChild(style);
  }

  function installTodayV81InstantChipClick(){
    if(document.getElementById('cronosTodayV81InstantChipClick')) return;
    const style = document.createElement('style');
    style.id = 'cronosTodayV81InstantChipClick';
    style.textContent = `
      /* === CRONOS V81 — clique imediato nos chips do Hoje === */
      #view-todayCronos .todayGrid.todayChipRow .todayKpi{
        transition:
          transform .05s linear,
          background .03s linear,
          border-color .03s linear,
          box-shadow .03s linear,
          color .03s linear!important;
      }
      #view-todayCronos .todayGrid.todayChipRow .todayKpi.active{
        transition:
          transform .05s linear,
          background .03s linear,
          border-color .03s linear,
          box-shadow .03s linear,
          color .03s linear!important;
      }
    `;
    document.head.appendChild(style);
  }

  function installTodayV80ButtonAndChipPolish(){
    if(document.getElementById('cronosTodayV80ButtonAndChipPolish')) return;
    const style = document.createElement('style');
    style.id = 'cronosTodayV80ButtonAndChipPolish';
    style.textContent = `
      /* === CRONOS V80 — chips mais imediatos + botões alinhados === */
      #view-todayCronos .todayGrid.todayChipRow .todayKpi{
        transition:background-color .06s linear, background .06s linear, border-color .06s linear, color .06s linear, box-shadow .06s linear, transform .06s linear!important;
      }
      #view-todayCronos .todayGrid.todayChipRow .todayKpi:hover{
        transform:translateY(-1px)!important;
      }
      #view-todayCronos .todayActions{
        display:flex!important;
        align-items:center!important;
        flex-wrap:wrap!important;
        gap:8px!important;
      }
      #view-todayCronos .todayActions > .todayBtn,
      #view-todayCronos .todayActions > a.todayBtn,
      #view-todayCronos .todayActions > button.todayBtn{
        display:inline-flex!important;
        align-items:center!important;
        justify-content:center!important;
        min-height:34px!important;
        height:34px!important;
        padding:0 12px!important;
        line-height:1!important;
        white-space:nowrap!important;
        text-decoration:none!important;
        vertical-align:middle!important;
      }
      #view-todayCronos .todayActions > .todayBtn.wa,
      #view-todayCronos .todayActions > a.todayBtn.wa,
      #view-todayCronos .todayActions > a.todayBtn[href*="wa.me"]{
        min-height:34px!important;
        height:34px!important;
        padding:0 12px!important;
      }
      html.light #view-todayCronos .todayActions > .todayBtn,
      html.light #view-todayCronos .todayActions > a.todayBtn,
      body.light #view-todayCronos .todayActions > .todayBtn,
      body.light #view-todayCronos .todayActions > a.todayBtn{
        box-shadow:none!important;
      }
    `;
    document.head.appendChild(style);
  }

  function installTodayV79ModuleChipGradient(){
    if(document.getElementById('cronosTodayV79ModuleChipGradient')) return;
    const style = document.createElement('style');
    style.id = 'cronosTodayV79ModuleChipGradient';
    style.textContent = `
      /* === CRONOS V79 — chips clicáveis do Hoje no Cronos com degradê do módulo === */
      html.light #view-todayCronos .todayGrid.todayChipRow .todayKpi.active,
      :root.light #view-todayCronos .todayGrid.todayChipRow .todayKpi.active,
      body.light #view-todayCronos .todayGrid.todayChipRow .todayKpi.active{
        color:#ffffff!important;
        -webkit-text-fill-color:#ffffff!important;
        border-color:rgba(37,99,235,.64)!important;
        background:linear-gradient(135deg,#2563eb 0%,#0ea5e9 48%,#14b8a6 100%)!important;
        box-shadow:0 14px 30px rgba(37,99,235,.21),0 6px 16px rgba(20,184,166,.13),inset 0 0 0 1px rgba(255,255,255,.20)!important;
        transform:translateY(-1px)!important;
      }
      html.light #view-todayCronos .todayGrid.todayChipRow .todayKpi.active span,
      :root.light #view-todayCronos .todayGrid.todayChipRow .todayKpi.active span,
      body.light #view-todayCronos .todayGrid.todayChipRow .todayKpi.active span{
        color:#ffffff!important;
      }
      html.light #view-todayCronos .todayGrid.todayChipRow .todayKpi.active b,
      :root.light #view-todayCronos .todayGrid.todayChipRow .todayKpi.active b,
      body.light #view-todayCronos .todayGrid.todayChipRow .todayKpi.active b{
        color:#ffffff!important;
        -webkit-text-fill-color:#ffffff!important;
        background:rgba(255,255,255,.20)!important;
        border-color:rgba(255,255,255,.32)!important;
        box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)!important;
      }

      html:not(.light) #view-todayCronos .todayGrid.todayChipRow .todayKpi.active,
      :root:not(.light) #view-todayCronos .todayGrid.todayChipRow .todayKpi.active,
      body:not(.light) #view-todayCronos .todayGrid.todayChipRow .todayKpi.active{
        color:#f4fbff!important;
        -webkit-text-fill-color:#f4fbff!important;
        border-color:rgba(25,198,255,.50)!important;
        background:linear-gradient(135deg,rgba(22,119,255,.48) 0%,rgba(25,198,255,.38) 48%,rgba(46,230,166,.34) 100%),rgba(15,23,42,.58)!important;
        box-shadow:0 9px 18px rgba(22,119,255,.13),inset 0 0 0 1px rgba(255,255,255,.07)!important;
        transform:translateY(-1px)!important;
      }
      html:not(.light) #view-todayCronos .todayGrid.todayChipRow .todayKpi.active span,
      :root:not(.light) #view-todayCronos .todayGrid.todayChipRow .todayKpi.active span,
      body:not(.light) #view-todayCronos .todayGrid.todayChipRow .todayKpi.active span{
        color:#f4fbff!important;
      }
      html:not(.light) #view-todayCronos .todayGrid.todayChipRow .todayKpi.active b,
      :root:not(.light) #view-todayCronos .todayGrid.todayChipRow .todayKpi.active b,
      body:not(.light) #view-todayCronos .todayGrid.todayChipRow .todayKpi.active b{
        color:#f4fbff!important;
        -webkit-text-fill-color:#f4fbff!important;
        background:rgba(255,255,255,.12)!important;
        border-color:rgba(255,255,255,.12)!important;
        box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)!important;
      }
    `;
    document.head.appendChild(style);
  }

  async function boot(){
    for(let i=0;i<80;i++){
      if(document.body && hasCronos()) break;
      await sleep(150);
    }

    addStyles();
    installTodayPriorityDesign();
    installTodayV27Fixes();
    installTodayV28CardScrollFix();
    installTodayV29CacheFix();
    installTodayV31InnerCardAutoHeight();
    loadTodaySuggestionSettings();
    setTimeout(()=>{ try{ getTodayCollections({ force:true }); updateNavCount(); }catch(_){} }, 650);
    ensureView();
    ensureNav();
    bindNativeNavRecovery();
    patchDashboardAppointmentHistory();
    patchSidebarCounts();
    patchBirthDateCloudSync();
    restoreNativeViews();
    hideTodayView();

    let maintenanceVersion = Number(window.__CRONOS_DATA_VERSION__ || 0);
    let maintenanceDay = todayISO();

    const runMaintenance = (force=false)=>{
      if(document.hidden) return;
      const version = Number(window.__CRONOS_DATA_VERSION__ || 0);
      const day = todayISO();
      const shellMissing = !$(NAV_ID) || !$(VIEW_ID);

      // Com bases grandes, varrer DOM e coleções em intervalo fixo travava filtros.
      // Só refaz o trabalho quando os dados/dia mudarem ou o shell tiver sumido.
      if(!force && !shellMissing && version === maintenanceVersion && day === maintenanceDay){
        return;
      }

      maintenanceVersion = version;
      maintenanceDay = day;
      try{
        ensureNav();
        ensureView();
        bindNativeNavRecovery();
        patchBirthDateCloudSync();
        updateNavCount();
        syncNavBadgeStyle();
      }catch(_){}
    };

    const scheduleMaintenance = ()=>{
      setTimeout(()=>{
        const runner = ()=>runMaintenance(false);
        if(typeof window.requestIdleCallback === "function"){
          window.requestIdleCallback(runner, { timeout:1800 });
        }else{
          runner();
        }
        scheduleMaintenance();
      }, 30000);
    };

    ["cronos:persistence-saved", "cronos:persistence-hydrated", "cronos:data-changed"].forEach(type=>{
      try{ window.addEventListener(type, ()=>runMaintenance(true)); }catch(_){ }
    });
    document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) runMaintenance(false); });
    scheduleMaintenance();
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }
})();
