/* =========================================================
   CRONOS FLUXOS ASSISTIDOS — módulo separado
   Versão: fluxos_v7_identity_dedupe_real
   Coloque este arquivo DEPOIS do app.js e do hoje_no_cronos.js.
   ========================================================= */
(function(){
  const BOOT_FLAG = "__CRONOS_FLUXOS_BOOTED__";
  if(window[BOOT_FLAG]) return;
  window[BOOT_FLAG] = true;

  const STYLE_ID = "cronosFluxosStyle";
  const CARD_ID = "cronosFlowSettingsCard";
  const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));
  const $ = (id)=>document.getElementById(id);
  const qs = (sel, root=document)=>root.querySelector(sel);
  const qsa = (sel, root=document)=>Array.from(root.querySelectorAll(sel));

  function hasCronos(){
    return typeof window.loadDB === "function" && typeof window.currentActor === "function" && typeof window.saveDB === "function";
  }

  function load(){ try{ return window.loadDB(); }catch(_){ return null; } }
  function actor(){ try{ return window.currentActor(); }catch(_){ return null; } }
  function save(db, opts={ immediate:true }){ try{ return window.saveDB(db, opts); }catch(e){ console.warn("Fluxos: falha ao salvar", e); } }
  function toast(title, msg=""){
    try{ if(typeof window.toast === "function") return window.toast(title, msg); }catch(_){}
    console.log("[Fluxos]", title, msg);
  }
  function escapeHTML(v){
    try{ if(typeof window.escapeHTML === "function") return window.escapeHTML(v); }catch(_){}
    return String(v ?? "").replace(/[&<>\"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }
  function todayISO(){
    try{ if(typeof window.todayISO === "function") return window.todayISO(); }catch(_){}
    return new Date().toISOString().slice(0,10);
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
    return dt.toISOString().slice(0,10);
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
      .flowHeader{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
      .flowGrid{display:grid;gap:10px;margin-top:12px}
      .flowCard{border:1px solid var(--line,rgba(255,255,255,.12));border-radius:16px;padding:12px;background:rgba(255,255,255,.035)}
      .flowCardTop{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}
      .flowTitle{font-weight:900;font-size:15px}
      .flowMeta{font-size:12px;color:var(--muted,#8b93a7);line-height:1.35;margin-top:4px}
      .flowActions{display:flex;gap:7px;flex-wrap:wrap;align-items:center}
      .flowStepBox{border:1px solid var(--line,rgba(255,255,255,.12));border-radius:14px;padding:12px;margin:10px 0;background:rgba(255,255,255,.035)}
      .flowStepHead{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px}
      .flowStepHead b{font-size:13px}
      .flowHelp{font-size:12px;color:var(--muted,#8b93a7);line-height:1.45}
      .flowTwo{display:grid;grid-template-columns:1fr 150px;gap:10px}
      .flowThree{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
      .flowEditor textarea{min-height:90px}
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
      @media(max-width:760px){.flowTwo,.flowThree{grid-template-columns:1fr}.settingsAccSummary{max-width:190px}.settingsAccTitle h3{font-size:15px}}
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

    if(!merged && outsideBrandingCards.length){
      const first = outsideBrandingCards.shift();
      merged = buildBrandingSubCardFrom(first);
      primaryBody.appendChild(merged);
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
    if(low.includes('procedimentos')) return 'catálogo usado na ficha do paciente';
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
        save(db, { immediate:true });
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
        save(db, { immediate:true });
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
  function enhanceSettingsUI(){
    normalizeClinicIdentityArea();
    groupMessagePreferences();
    normalizeClinicIdentityArea();
    applySettingsAccordion();
    normalizeClinicIdentityArea();
    bindBirthdayTemplateButtons();
  }
  function openSettingsCardById(id){
    const card = $(id); if(!card) return;
    enhanceSettingsUI();
    setSettingsCardOpen(card, true);
  }

  function ensureSettingsCard(force=false){
    const settings = $("view-settings");
    if(!settings) return;
    let card = $(CARD_ID);
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
    if(created || force || !card.dataset.rendered){
      renderSettingsCard();
      card.dataset.rendered = "1";
      setTimeout(()=>enhanceSettingsUI(), 0);
    }
  }

  function renderSettingsCard(){
    const card = $(CARD_ID);
    if(!card) return;
    // Sempre que redesenha, remove a casca antiga do accordion; depois o enhanceSettingsUI recria.
    // Sem isso, depois de salvar o primeiro fluxo o card ficava aberto/sem seta.
    card.classList.remove('settingsAccCard','isOpen');
    delete card.dataset.settingsAccordion;
    const db = load();
    const a = actor();
    if(!db || !a){
      card.innerHTML = `<h3>Fluxos assistidos</h3><div class="muted">Carregando...</div>`;
      return;
    }
    const list = flows(db).filter(f=>!f.masterId || f.masterId===a.masterId);
    card.innerHTML = `
      <div class="flowHeader">
        <div>
          <h3 style="margin:0">Fluxos assistidos</h3>
          <div class="muted" style="line-height:1.5;margin-top:6px">
            Crie sequências de mensagens manuais. O Cronos lembra o dia certo; a equipe copia, abre o WhatsApp e marca como enviado.
          </div>
        </div>
        <div class="flowActions">
          <button class="btn primary" type="button" onclick="CRONOS_FLUXOS.openEditor()">➕ Novo fluxo</button>
        </div>
      </div>
      <div class="flowGrid">
        ${list.length ? list.map(f=>renderFlowTemplateCard(f)).join("") : `<div class="muted" style="padding:12px;border:1px dashed var(--line);border-radius:14px">Nenhum fluxo criado ainda. O caos está sem roteiro, por enquanto.</div>`}
      </div>
    `;
    setTimeout(()=>enhanceSettingsUI(), 0);
  }

  function renderFlowTemplateCard(f){
    const steps = Array.isArray(f.steps) ? f.steps : [];
    const active = f.active !== false;
    const ordered = steps.slice().sort((a,b)=>Number(a.dayOffset||0)-Number(b.dayOffset||0));
    const summary = ordered.map((s,i)=>`D+${Number(s.dayOffset||0)}: ${escapeHTML(s.title || `Etapa ${i+1}`)}`).join(" • ");
    return `
      <div class="flowCard" data-flow-id="${escapeHTML(f.id)}">
        <div class="flowCardTop">
          <div>
            <div class="flowTitle">${escapeHTML(f.name || "Fluxo sem nome")}</div>
            <div class="flowMeta">${escapeHTML(f.description || "Sem descrição")}</div>
            <div class="flowMeta">${steps.length} etapa(s) • ${active ? "Ativo" : "Inativo"}</div>
            ${summary ? `<div class="flowMeta">${summary}</div>` : ""}
          </div>
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
          <b>Etapa ${idx+1}</b>
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
          <div style="margin-top:10px">
            <label>Descrição opcional</label>
            <input id="flowDesc" value="${escapeHTML(flow.description || "")}" placeholder="Ex: sequência para paciente que recebeu orçamento e não respondeu"/>
          </div>
          <div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <h4 style="margin:0">Etapas do fluxo</h4>
            <button class="btn" type="button" onclick="CRONOS_FLUXOS.addStep()">➕ Adicionar etapa</button>
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

    save(db, { immediate:true });
    toast("Fluxo salvo ✅", name);
    closeModal();
    renderSettingsCard();
    setTimeout(()=>{ const card=$(CARD_ID); if(card) card.classList.remove('isOpen'); }, 0);
  }

  function toggleFlow(flowId){
    const db = load();
    const f = getFlow(db, flowId);
    if(!f) return;
    f.active = f.active === false ? true : false;
    f.updatedAt = nowISO();
    save(db,{ immediate:true });
    renderSettingsCard();
    setTimeout(()=>openSettingsCardById(CARD_ID), 0);
  }
  function deleteFlow(flowId){
    const db = load();
    const f = getFlow(db, flowId);
    if(!f) return;
    if(!confirm(`Excluir o fluxo "${f.name || "sem nome"}"?\n\nAs etapas já ativadas em pacientes continuam no histórico.`)) return;
    db.settings.assistedFlows = flows(db).filter(x=>String(x.id)!==String(flowId));
    save(db,{ immediate:true });
    renderSettingsCard();
    setTimeout(()=>openSettingsCardById(CARD_ID), 0);
    toast("Fluxo excluído");
  }

  function injectLeadButtons(root=document){
    qsa(".leadCard", root).forEach(card=>{
      if(card.dataset.flowInjected === "1") return;
      const actionRow = qs(".leadActionsRow", card);
      if(!actionRow) return;
      const sourceBtn = qs("[onclick*='openLeadEntry']", actionRow) || qs("[data-ficha-entry]", actionRow);
      let entryId = sourceBtn?.getAttribute?.("data-ficha-entry") || "";
      if(!entryId){
        const onclick = String(sourceBtn?.getAttribute?.("onclick") || "");
        const m = onclick.match(/openLeadEntry\(['\"]([^'\"]+)['\"]\)/);
        if(m) entryId = m[1];
      }
      if(!entryId) return;
      const btn = document.createElement("button");
      btn.className = "iconBtn flowLeadBtn cronos-action-flow";
      btn.type = "button";
      btn.title = "Ativar fluxo assistido";
      btn.innerHTML = `<svg class="cronos-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7h5a4 4 0 0 1 4 4v1"></path><path d="M10 4 7 7l3 3"></path><path d="M17 17h-5a4 4 0 0 1-4-4v-1"></path><path d="m14 20 3-3-3-3"></path><circle cx="7" cy="7" r="2"></circle><circle cx="17" cy="17" r="2"></circle></svg>`;
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
    renderSettingsCard,
    ensureSettingsCard,
    enhanceSettingsUI,
    normalizeClinicIdentityArea,
    openSettingsCardById,
    injectLeadButtons,
    openActivateFlow,
    activateFlow,
    previewActivation,
    closeModal
  };

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
