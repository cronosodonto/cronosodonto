/* =========================================================
   HOJE NO CRONOS — módulo separado
   Versão: today_v21_flow_stage1_whatsapp
   Coloque este arquivo DEPOIS do app.js principal.
   Ele não altera o app.js; injeta a tela e o menu em runtime.
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

  const TODAY_STATE = window.__CRONOS_TODAY_STATE__ || {
    filter: "all",
    visible: { appointments: 3, tasks: 3, receipts: 3, flows: 3, birthdays: 3 },
    loading: false
  };
  window.__CRONOS_TODAY_STATE__ = TODAY_STATE;

  function setFilter(filter){
    TODAY_STATE.filter = filter || "all";
    TODAY_STATE.visible = { appointments: 3, tasks: 3, receipts: 3, flows: 3, birthdays: 3 };
    render();
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

    // Ao clicar em uma KPI específica, os outros cards continuam na tela,
    // mas ficam zerados. Isso mantém o layout estável.
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

  function todayISO(){
    try{
      if(typeof window.todayISO === "function") return window.todayISO();
    }catch(_){}
    return new Date().toISOString().slice(0,10);
  }

  function nowISO(){
    return new Date().toISOString();
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

  function save(db, opts={ immediate:true }){
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

  function contactName(db, entry){
    const c = getContact(db, entry);
    return c.name || entry.name || entry.lead || "(sem nome)";
  }

  function contactPhone(db, entry){
    const c = getContact(db, entry);
    return c.phone || entry.phone || entry.telefone || "";
  }

  function waLink(phone, msg=""){
    const clean = String(phone || "").replace(/\D/g,"");
    if(!clean) return "#";
    return `https://wa.me/55${clean}?text=${encodeURIComponent(msg || "")}`;
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
        --tc-primary: rgba(124,92,255,.23);
        --tc-primary-line: rgba(124,92,255,.55);
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
        --tc-primary: rgba(124,92,255,.13);
        --tc-primary-line: rgba(124,92,255,.50);
      }
      #${VIEW_ID}, #${VIEW_ID} *{box-sizing:border-box}
      .todayWrap{display:grid; gap:16px; border-radius:22px}
      .todayHero{
        display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap;
        padding:18px; border-radius:20px;
        background:linear-gradient(135deg, rgba(124,92,255,.14), rgba(255,255,255,.035)), var(--tc-card);
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
        background:rgba(124,92,255,.14);
        box-shadow:0 8px 20px rgba(124,92,255,.15);
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
      .todayKpi.active b{border-color:var(--tc-primary-line); background:rgba(124,92,255,.16)}
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
      html.light #${VIEW_ID} .todayBtn{background:rgba(255,255,255,.62)}
      .todayBtn:hover{filter:brightness(1.08)}
      .todayBtn.primary{background:rgba(124,92,255,.18); border-color:rgba(124,92,255,.38)}
      .todayBtn.ok{background:rgba(34,197,94,.14); border-color:rgba(34,197,94,.35)}
      .todayBtn.warn{background:rgba(245,158,11,.14); border-color:rgba(245,158,11,.35)}
      .todayBtn.danger{background:rgba(239,68,68,.14); border-color:rgba(239,68,68,.35)}
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
      .todayFull{grid-column:1/-1}
      @media(max-width:1200px){.todayGrid{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.todaySections{grid-template-columns:1fr}}
      @media(max-width:720px){#${VIEW_ID}{padding:12px}.todayGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.todayHero h2{font-size:20px}}
    `;
    document.head.appendChild(style);
  }

  function findMainHost(){
    // O Cronos usa .main como área real das telas.
    // Se o Hoje no Cronos for colocado no body, o botão fica ativo mas a tela parece vazia.
    return qs(".main") || $("appView") || qs("main") || qs(".app") || document.body;
  }

  function ensureView(){
    let view = $(VIEW_ID);
    const host = findMainHost();

    if(view){
      // Garante que a tela esteja dentro da área principal certa.
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
    if($(NAV_ID)) return;

    const nav = qs(".nav") || qs("nav") || qs("#sidebar") || qs(".sidebar");
    if(!nav) return;

    const btn = document.createElement("button");
    btn.id = NAV_ID;
    btn.type = "button";
    // Não usamos data-view aqui.
    // O Cronos principal bloqueia views que não estão em APP_VIEWS e mostrava "acesso restrito".
    // Então este botão fica fora do roteador principal e chama a tela pelo módulo próprio.
    btn.dataset.todayCronos = "1";
    btn.innerHTML = `<span>Hoje no Cronos</span><span id="todayNavBadge" class="todayNavBadge empty">0</span>`;
    const openToday = (ev)=>{
      try{
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
        ev?.stopImmediatePropagation?.();
      }catch(_){}
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
    // Só limpa a marcação feita pelo Hoje no Cronos.
    // O roteador principal decide qual tela nativa deve ser exibida; reabrir todas aqui gerava piscadas.
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
    if(navBtn) navBtn.classList.remove("active");
  }

  function hideOtherViews(){
    const host = findMainHost();
    ensureView();

    // Esconde qualquer conteúdo nativo direto dentro da área principal.
    // Isso remove os filtros do Dashboard que apareciam no fim da tela.
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

    // Também cobre estruturas por id view-*.
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

    qsa(".nav button, nav button, [data-view]").forEach(b=>{
      // v90: seleção única também para módulos injetados fora do roteador
      // (Hoje no Cronos e Simulador não usam data-view). Antes, ao voltar
      // do Simulador para o Hoje, os dois botões podiam ficar ativos.
      b.classList.toggle("active", b.id === NAV_ID);
    });
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

      // Só mexe quando estamos SAINDO do Hoje no Cronos.
      // E faz isso antes do roteador nativo agir, para não deixar a tela limpa por 1s.
      if(!todayIsActuallyOpen() && !todayBtnActive) return;

      restoreNativeViews();
      hideTodayView();
      scheduleScrollCronosToTop();
    };

    // pointerdown acontece antes do click do roteador do Cronos.
    // Removi o listener de click duplicado e os setTimeouts que causavam piscada.
    document.addEventListener("pointerdown", recoverBeforeNativeClick, true);

    // Acesso por teclado no menu.
    document.addEventListener("keydown", (ev)=>{
      if(ev.key !== "Enter" && ev.key !== " ") return;
      recoverBeforeNativeClick(ev);
    }, true);

    // Se algum código chamar showView diretamente, também recupera as telas nativas.
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

  function setEntryStatus(entryId, status, extra={}){
    const db = load();
    const a = actor();
    if(!db || !a) return;
    const e = (db.entries || []).find(x=>String(x.id)===String(entryId));
    if(!e) return toast("Lead não encontrado");
    const old = e.status || "";
    e.status = status;
    e.lastUpdateAt = nowISO();
    if(extra.apptDate !== undefined) e.apptDate = extra.apptDate;
    if(extra.apptTime !== undefined) e.apptTime = extra.apptTime;
    e.statusLog = Array.isArray(e.statusLog) ? e.statusLog : [];
    e.statusLog.push({ at:nowISO(), from:old, to:status, by:a.name || a.email || a.username || "Cronos" });
    save(db, { immediate:true });
    toast("Atualizado ✅", `${status}`);
    render();
    try{ if(typeof window.renderAll === "function") window.renderAll(); }catch(_){}
  }

  function markAppointmentNoShow(entryId){
    setEntryStatus(entryId, "Faltou");
    try{
      const db = load();
      const a = actor();
      const e = (db.entries || []).find(x=>String(x.id)===String(entryId));
      if(!db || !a || !e) return;
      const c = getContact(db, e);
      db.tasks = Array.isArray(db.tasks) ? db.tasks : [];
      const key = `NO_SHOW:${e.id}:${todayISO()}`;
      if(!db.tasks.some(t=>String(t.key||"")===key)){
        db.tasks.push({
          id: `task_${key.replace(/[^a-zA-Z0-9_-]/g,"_")}`,
          key,
          masterId:a.masterId,
          entryId:e.id,
          contactId:e.contactId || "",
          title:`Remarcar falta: ${c.name || "paciente"}`,
          action:"WhatsApp",
          notes:"Paciente faltou. Enviar mensagem de remarcação humanizada.",
          done:false,
          createdAt:nowISO(),
          dueDate:todayISO(),
          phone:c.phone || "",
          wa:true,
          source:"todayCronos"
        });
        save(db, { immediate:true });
      }
    }catch(_){}
    render();
  }

  function rescheduleAppointment(entryId){
    const date = prompt("Nova data do agendamento (AAAA-MM-DD):", todayISO());
    if(!date) return;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast("Data inválida", "Use AAAA-MM-DD.");
    const time = prompt("Novo horário (HH:MM):", "09:00") || "";
    setEntryStatus(entryId, "Remarcou", { apptDate:date, apptTime:time });
  }

  function markTaskDone(taskId){
    const db = load();
    const a = actor();
    if(!db || !a) return;
    const t = (db.tasks || []).find(x=>String(x.id)===String(taskId));
    if(!t) return toast("Tarefa não encontrada");
    t.done = true;
    t.doneAt = nowISO();
    t.updatedAt = nowISO();
    save(db, { immediate:true });
    toast("Tarefa concluída ✅");
    render();
    try{ if(typeof window.renderTasks === "function") window.renderTasks(); }catch(_){}
  }

  function postponeTask(taskId){
    const date = prompt("Adiar para qual data? (AAAA-MM-DD):", todayISO());
    if(!date) return;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast("Data inválida", "Use AAAA-MM-DD.");
    const db = load();
    const t = (db.tasks || []).find(x=>String(x.id)===String(taskId));
    if(!t) return toast("Tarefa não encontrada");
    t.dueDate = date;
    t.updatedAt = nowISO();
    save(db, { immediate:true });
    toast("Tarefa adiada ✅", fmtBR(date));
    render();
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

  function markFlowStepDone(runId, stepIndex){
    const db = load();
    const run = (db.flowRuns || db.assistedFlowRuns || []).find(r=>String(r.id)===String(runId));
    if(!run) return toast("Fluxo não encontrado");
    const step = (run.steps || []).find(s=>Number(s.index)===Number(stepIndex));
    if(!step) return toast("Etapa não encontrada");
    step.done = true;
    step.doneAt = nowISO();
    run.updatedAt = nowISO();
    save(db, { immediate:true });
    toast("Etapa marcada como enviada ✅");
    render();
  }

  function finishFlow(runId){
    const db = load();
    const run = (db.flowRuns || db.assistedFlowRuns || []).find(r=>String(r.id)===String(runId));
    if(!run) return toast("Fluxo não encontrado");
    run.active = false;
    run.finishedAt = nowISO();
    save(db, { immediate:true });
    toast("Fluxo encerrado");
    render();
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

  function editBirthdayTemplate(){
    const db = load();
    if(!db) return;
    db.settings = db.settings || {};
    const current = getBirthdayTemplate(db);
    const next = prompt("Mensagem padrão para aniversariantes:", current);
    if(next == null) return;
    db.settings.birthdayTemplate = String(next || "").trim();
    save(db, { immediate:true });
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

    // 1) Agendamento ainda ativo: conta.
    if(activeStatus.includes(status)) return true;

    // 2) Agendamento resolvido: conta somente se ainda existir evidência de data/hora.
    // Assim, se alguém só colocou data para inflar número e depois removeu, não conta.
    if(resolvedStatus.includes(status) && (entry.apptDate || entry.apptTime)) return true;

    const log = Array.isArray(entry.statusLog) ? entry.statusLog : [];

    // 3) Histórico confiável: só conta se houve um agendamento e depois um desfecho real.
    // Passar por "Agendado" e depois remover NÃO conta sozinho.
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
      // Ajusta o bucket da KPI "Agendados" para histórico, não só status atual.
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

      // Depois que o Dashboard renderizar, corrige o número e a porcentagem de Agendados.
      if(typeof window.renderDashboard === "function" && !window.renderDashboard.__todayCronosApptPatched){
        const originalRenderDashboard = window.renderDashboard;
        const wrappedRenderDashboard = function(){
          const result = originalRenderDashboard.apply(this, arguments);
          setTimeout(patchDashboardAppointmentKpi, 0);
          return result;
        };
        wrappedRenderDashboard.__todayCronosApptPatched = true;
        window.renderDashboard = wrappedRenderDashboard;
      }

      // Se já estiver no dashboard, aplica agora.
      setTimeout(patchDashboardAppointmentKpi, 0);
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
      console.warn("Hoje no Cronos: não consegui corrigir contador do Dashboard", e);
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

      // O bug era: CPF/nascimento salvava localmente, mas no merge com a nuvem
      // o contato antigo vencia por não existir updatedAt no contato local.
      // Marcando updatedAt, a versão recém-editada vence corretamente no Supabase.
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
      #view-todayCronos .todayEmpty{position:relative!important;width:min(520px,88%)!important;margin:auto!important;padding:20px 22px!important;border-radius:24px 24px 24px 10px!important;border:1px solid rgba(196,181,253,.30)!important;border-style:solid!important;background:linear-gradient(135deg,rgba(88,28,135,.15),rgba(67,56,202,.10)),rgba(255,255,255,.045)!important;text-align:center!important;font-weight:760!important;line-height:1.45!important}
      #view-todayCronos .todayEmpty::before,#view-todayCronos .todayEmpty::after{content:""!important;position:absolute!important;display:block!important;border-radius:999px!important;border:1px solid rgba(196,181,253,.24)!important;background:rgba(255,255,255,.045)!important}
      #view-todayCronos .todayEmpty::before{width:15px!important;height:15px!important;left:32px!important;bottom:-13px!important}
      #view-todayCronos .todayEmpty::after{width:8px!important;height:8px!important;left:20px!important;bottom:-25px!important}
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

      // Copia a aparência REAL dos contadores nativos do menu.
      // Assim o Hoje no Cronos não fica com "bolinha de outra família".
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

  function getTodayCollections(){
    const db = load();
    const a = actor();
    if(!db || !a) return { total:0, overdue:0, appointments:[], tasks:[], receipts:[], flows:[] };

    const appointments = collectAppointments(db, a);
    const tasks = collectTasks(db, a);
    const receipts = collectReceipts(db, a);
    const flows = collectFlows(db, a);
    const birthdays = collectBirthdays(db, a);
    const all = [...appointments, ...tasks, ...receipts, ...flows, ...birthdays];

    return {
      total: all.length,
      overdue: all.filter(x=>x.overdue).length,
      appointments,
      tasks,
      receipts,
      flows,
      birthdays
    };
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
    /*
      v63 — remove o WhatsApp genérico de apoio.
      O botão com mensagem real deve vir do contexto correto: fluxo, tarefa, cobrança etc.
      Aqui fica só o acesso ao lead para evitar duplicidade tipo “Oi, tudo bem?” perdido no meio da operação.
    */
    return `
      <button class="todayBtn" onclick="CRONOS_TODAY.openLead('${escapeHTML(entry.id)}')">Abrir lead</button>
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
        <div class="todayItem">
          <div class="todayItemTop">
            <div>
              <div class="todayItemTitle">${escapeHTML(c.name || "(sem nome)")}</div>
              <div class="todayItemMeta">${meta}</div>
            </div>
            <span class="todayBadge">${item.overdue ? "Agendamento vencido" : "Notificação de hoje"}</span>
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

    // Novo recebimento: FININST:entryId:planId:paymentId
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

    // Parcelamento legado: INST:entryId:due:number
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

  function renderTasksList(items, db){
    if(!items.length) return `<div class="todayEmpty">Nenhuma tarefa vencida para hoje. Milagre administrativo detectado.</div>`;
    return items.map(item=>{
      const t = item.task;
      const e = (db.entries || []).find(x=>String(x.id)===String(t.entryId));
      const phone = t.phone || (e ? contactPhone(db, e) : "");
      const msg = taskPatientMessage(db, t, e);
      const internalNote = t.message || t.notes || t.desc || t.title || "";
      return `
        <div class="todayItem">
          <div class="todayItemTop">
            <div>
              <div class="todayItemTitle">${escapeHTML(t.title || "Tarefa")}</div>
              <div class="todayItemMeta">${item.overdue ? "⚠️ Atrasada" : "Hoje"} • ${fmtBR(t.dueDate)} ${t.action ? `• ${escapeHTML(t.action)}` : ""}</div>
              ${internalNote ? `<div class="todayItemMeta">${escapeHTML(isNoShowTask(t) ? msg : internalNote).slice(0,260)}</div>` : ""}
            </div>
            <span class="todayBadge">${escapeHTML(t.type || t.source || "Tarefa")}</span>
          </div>
          <div class="todayActions">
            <button class="todayBtn ok" onclick="CRONOS_TODAY.doneTask('${escapeHTML(t.id)}')">Marcar feito</button>
            <button class="todayBtn warn" onclick="CRONOS_TODAY.postponeTask('${escapeHTML(t.id)}')">Adiar</button>
            ${msg ? `<button class="todayBtn" onclick="CRONOS_TODAY.copy(${JSON.stringify(msg).replace(/"/g,'&quot;')})">Copiar</button>` : ""}
            ${phone ? `<a class="todayBtn" target="_blank" href="${waLink(phone, msg)}">WhatsApp</a>` : ""}
            ${e ? `<button class="todayBtn" onclick="CRONOS_TODAY.openLead('${escapeHTML(e.id)}')">Abrir lead</button>` : ""}
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
          <div class="todayItem">
            <div class="todayItemTop">
              <div>
                <div class="todayItemTitle">${escapeHTML(name)} • ${moneyBR(p.amount)}</div>
                <div class="todayItemMeta">${item.overdue ? "⚠️ Atrasado" : "Vence hoje"} • ${fmtBR(p.dueDate)} • ${escapeHTML(plan.title || "Recebimento")} • Parcela ${escapeHTML(p.number || "")}/${escapeHTML(p.total || "")}</div>
              </div>
              <span class="todayBadge">Recebimento</span>
            </div>
            <div class="todayActions">
              <button class="todayBtn ok" onclick="CRONOS_TODAY.payFinancial('${escapeHTML(e.id)}','${escapeHTML(plan.id)}','${escapeHTML(p.id)}')">Dar baixa</button>
              <button class="todayBtn primary" onclick="CRONOS_TODAY.openReceipt('${escapeHTML(e.id)}','${escapeHTML(plan.id)}')">Abrir recebimento</button>
              <button class="todayBtn" onclick="CRONOS_TODAY.copy(${JSON.stringify(buildDirectReceiptChargeMessage(db, e, plan, p, null)).replace(/"/g,'&quot;')})">Copiar</button>
              ${contactPhone(db,e) ? `<a class="todayBtn" target="_blank" href="${waLink(contactPhone(db,e), buildDirectReceiptChargeMessage(db, e, plan, p, null))}">WhatsApp</a>` : ""}
              <button class="todayBtn" onclick="CRONOS_TODAY.openLead('${escapeHTML(e.id)}')">Abrir lead</button>
            </div>
          </div>
        `;
      }

      const p = item.installment;
      return `
        <div class="todayItem">
          <div class="todayItemTop">
            <div>
              <div class="todayItemTitle">${escapeHTML(name)} • ${moneyBR(p.amount)}</div>
              <div class="todayItemMeta">${item.overdue ? "⚠️ Atrasado" : "Vence hoje"} • ${fmtBR(p.dueDate || p.due)} • Parcela ${escapeHTML(p.number || "")}/${escapeHTML(p.total || "")}</div>
            </div>
            <span class="todayBadge">Recebimento legado</span>
          </div>
          <div class="todayActions">
            <button class="todayBtn ok" onclick="CRONOS_TODAY.payLegacy('${escapeHTML(e.id)}', ${Number(p.number || 0)})">Dar baixa</button>
            <button class="todayBtn primary" onclick="CRONOS_TODAY.openReceipt('${escapeHTML(e.id)}')">Abrir recebimento</button>
            <button class="todayBtn" onclick="CRONOS_TODAY.copy(${JSON.stringify(buildDirectReceiptChargeMessage(db, e, null, null, p)).replace(/"/g,'&quot;')})">Copiar</button>
            ${contactPhone(db,e) ? `<a class="todayBtn" target="_blank" href="${waLink(contactPhone(db,e), buildDirectReceiptChargeMessage(db, e, null, null, p))}">WhatsApp</a>` : ""}
            <button class="todayBtn" onclick="CRONOS_TODAY.openLead('${escapeHTML(e.id)}')">Abrir lead</button>
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
        <div class="todayItem">
          <div class="todayItemTop">
            <div>
              <div class="todayItemTitle">${escapeHTML(c.name || "(sem nome)")}</div>
              <div class="todayItemMeta">🎉 Aniversário hoje${item.age ? ` • ${escapeHTML(item.age)} anos` : ""}</div>
              <div class="todayItemMeta">Mensagem pronta para envio 🎈</div>
            </div>
            <span class="todayBadge">Aniversariante</span>
          </div>
          <div class="todayActions">
            <button class="todayBtn" onclick="CRONOS_TODAY.copy(${JSON.stringify(msg).replace(/"/g,'&quot;')})">Copiar</button>
            ${c.phone ? `<a class="todayBtn" target="_blank" href="${waLink(c.phone, msg)}">WhatsApp</a>` : ""}
            ${e ? `<button class="todayBtn" onclick="CRONOS_TODAY.openLead('${escapeHTML(e.id)}')">Abrir lead</button>` : ""}
          </div>
        </div>
      `;
    }).join("");
  }

  function renderFlows(items, db){
    if(!items.length){
      return `<div class="todayEmpty">Nenhum fluxo assistido vencendo hoje. Silêncio raro, mas o Cronos não dorme no ponto</div>`;
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
        <div class="todayItem">
          <div class="todayItemTop">
            <div>
              <div class="todayItemTitle">${escapeHTML(c.name || "(sem nome)")} • ${escapeHTML(item.run.flowName || item.run.name || "Fluxo")}</div>
              <div class="todayItemMeta">${item.overdue ? "⚠️ Atrasado" : "Hoje"} • etapa ${escapeHTML(step.index || "")} • ${escapeHTML(step.title || "Mensagem do fluxo")}</div>
              ${msg ? `<div class="todayItemMeta">${escapeHTML(msg).slice(0,220)}</div>` : ""}
              ${internalNote ? `<div class="todayItemMeta"><b>Obs. interna:</b> ${escapeHTML(internalNote).slice(0,180)}</div>` : ""}
              ${mediaHint ? `<div class="todayItemMeta"><b>Mídia/lembrete:</b> ${escapeHTML(mediaHint).slice(0,160)}</div>` : ""}
              ${link ? `<div class="todayItemMeta"><b>Link:</b> ${escapeHTML(link).slice(0,180)}</div>` : ""}
            </div>
            <span class="todayBadge">Fluxo assistido</span>
          </div>
          <div class="todayActions">
            ${msg ? `<button class="todayBtn" onclick="CRONOS_TODAY.copy(${JSON.stringify(msg).replace(/"/g,'&quot;')})">Copiar mensagem</button>` : ""}
            ${(() => {
              const flowPhone = contactPhone(db,e) || c.phone || e.phone || e.telefone || e.whatsapp || e.whatsApp || e.celular || e.mobile;
              if(!flowPhone) return "";
              const flowMsg = msg || "";
              return `<a class="todayBtn" target="_blank" href="${waLink(flowPhone, flowMsg)}">WhatsApp</a>`;
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

  function render(){
    addStyles();
    installV94Refinements();
    ensureNav();
    const view = ensureView();
    const db = load();
    const a = actor();

    if(!db || !a){
      view.innerHTML = `<div class="todayEmpty">Cronos ainda está carregando. Respira, jovem padawan do boleto.</div>`;
      return;
    }

    const appointmentsAll = collectAppointments(db, a);
    const tasksAll = collectTasks(db, a);
    const receiptsAll = collectReceipts(db, a);
    const flowsAll = collectFlows(db, a);
    const birthdaysAll = collectBirthdays(db, a);

    const overdueCount =
      appointmentsAll.filter(x=>x.overdue).length +
      tasksAll.filter(x=>x.overdue).length +
      receiptsAll.filter(x=>x.overdue).length +
      flowsAll.filter(x=>x.overdue).length;

    const total = appointmentsAll.length + tasksAll.length + receiptsAll.length + flowsAll.length + birthdaysAll.length;

    const appointments = filterSectionItems("appointments", appointmentsAll);
    const tasks = filterSectionItems("tasks", tasksAll);
    const receipts = filterSectionItems("receipts", receiptsAll);
    const flows = filterSectionItems("flows", flowsAll);
    const birthdays = filterSectionItems("birthdays", birthdaysAll);

    const activeFilter = TODAY_STATE.filter || "all";
    const kpiCls = (f)=>`todayKpi ${activeFilter===f ? "active" : ""}`;
    setTimeout(updateNavCount, 0);

    view.innerHTML = `
      <div class="todayWrap">
        <div class="todayHero">
          <div>
            <h2>Hoje no Cronos</h2>
            <p>Agenda de ação diária: follow-ups, agendamentos, tarefas e recebimentos que não podem virar fóssil administrativo.</p>
            <p><b>${fmtBR(todayISO())}</b> • ${total} item(ns) para acompanhar</p>
          </div>
          <div class="todayActions">
            <button id="todayRefreshBtn" class="todayBtn primary" onclick="CRONOS_TODAY.refresh(this)">Atualizar</button>
          </div>
        </div>

        <div class="todayGrid">
          <button class="${kpiCls('all')}" onclick="CRONOS_TODAY.setFilter('all')"><b>${total}</b><span>Total de ações</span></button>
          <button class="${kpiCls('appointments')}" onclick="CRONOS_TODAY.setFilter('appointments')"><b>${appointmentsAll.length}</b><span>Agendamentos</span></button>
          <button class="${kpiCls('tasks')}" onclick="CRONOS_TODAY.setFilter('tasks')"><b>${tasksAll.length}</b><span>Tarefas</span></button>
          <button class="${kpiCls('receipts')}" onclick="CRONOS_TODAY.setFilter('receipts')"><b>${receiptsAll.length}</b><span>Recebimentos</span></button>
          <button class="${kpiCls('birthdays')}" onclick="CRONOS_TODAY.setFilter('birthdays')"><b>${birthdaysAll.length}</b><span>Aniversariantes</span></button>
          <button class="${kpiCls('flows')}" onclick="CRONOS_TODAY.setFilter('flows')"><b>${flowsAll.length}</b><span>Fluxos assistidos</span></button>
        </div>

        <div class="todaySections" data-focus="${activeFilter}">
          ${activeFilter === "all" || activeFilter === "appointments" ? `
          <section class="todayCard ${activeFilter !== "all" ? "todayFull" : ""}" data-section="appointments">
            <div class="todayCardHeader"><h3>Agendamentos / notificações</h3><span>${appointments.length}</span></div>
            ${renderLimitedSection('appointments', appointments, (shown)=>renderAppointments(shown, db))}
          </section>` : ""}

          ${activeFilter === "all" || activeFilter === "tasks" ? `
          <section class="todayCard ${activeFilter !== "all" ? "todayFull" : ""}" data-section="tasks">
            <div class="todayCardHeader"><h3>Tarefas de hoje / atrasadas</h3><span>${tasks.length}</span></div>
            ${renderLimitedSection('tasks', tasks, (shown)=>renderTasksList(shown, db))}
          </section>` : ""}

          ${activeFilter === "all" || activeFilter === "receipts" ? `
          <section class="todayCard ${activeFilter !== "all" ? "todayFull" : ""}" data-section="receipts">
            <div class="todayCardHeader"><h3>Recebimentos vencendo / atrasados</h3><span>${receipts.length}</span></div>
            ${renderLimitedSection('receipts', receipts, (shown)=>renderReceipts(shown, db))}
          </section>` : ""}

          ${activeFilter === "all" || activeFilter === "birthdays" ? `
          <section class="todayCard ${activeFilter !== "all" ? "todayFull" : ""}" data-section="birthdays">
            <div class="todayCardHeader">
              <h3>Aniversariantes do dia</h3>
              <div class="todayHeaderActions">
                <button class="todayMiniBtn" onclick="CRONOS_TODAY.editBirthdayTemplate()">Editar mensagem</button>
                <span>${birthdays.length}</span>
              </div>
            </div>
            ${renderLimitedSection('birthdays', birthdays, (shown)=>renderBirthdays(shown, db))}
          </section>` : ""}

          ${activeFilter === "all" || activeFilter === "flows" ? `
          <section class="todayCard ${activeFilter !== "all" ? "todayFull" : ""}" data-section="flows">
            <div class="todayCardHeader"><h3>Fluxos assistidos</h3><span>${flows.length}</span></div>
            ${renderLimitedSection('flows', flows, (shown)=>renderFlows(shown, db))}
          </section>` : ""}
        </div>
      </div>
    `;
  }

  function show(){
    addStyles();
    installV94Refinements();
    ensureNav();
    ensureView();
    hideOtherViews();
    render();
    scheduleScrollCronosToTop();
  }


  function refresh(btn){
    updateButtonLoading(btn || $("todayRefreshBtn"), true);
    setTimeout(()=>{
      try{
        render();
        toast("Hoje no Cronos atualizado ✅");
      }finally{
        updateButtonLoading($("todayRefreshBtn"), false);
      }
    }, 350);
  }

  window.CRONOS_TODAY = {
    show,
    render,
    refresh,
    setFilter,
    showMore,
    showLess,
    updateNavCount,
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
    doneFlow:markFlowStepDone,
    finishFlow
  };

  async function boot(){
    for(let i=0;i<80;i++){
      if(document.body && hasCronos()) break;
      await sleep(150);
    }

    addStyles();
    ensureView();
    ensureNav();
    bindNativeNavRecovery();
    patchDashboardAppointmentHistory();
    patchSidebarCounts();
    patchBirthDateCloudSync();
    restoreNativeViews();
    hideTodayView();

    // Reinjeta caso o Cronos redesenhe a tela/menu.
    setInterval(()=>{
      try{
        ensureNav();
        ensureView();
        bindNativeNavRecovery();
        patchBirthDateCloudSync();

        // Rotina leve: contador do Hoje no Cronos + estilo do badge.
        // Os patches pesados rodam no boot e nas renderizações, não em todo ciclo.
        updateNavCount();
        syncNavBadgeStyle();

        // Não renderiza automaticamente enquanto a tela está aberta.
        // Isso evitava a rolagem interna voltar sozinha para o topo.

      }catch(_){}
    }, 12000);
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }
})();
