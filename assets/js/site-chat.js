
(function(){
  const CONFIG = {
    supabaseUrl: 'https://nsqpslierpulanxvsxaw.supabase.co',
    anonKey: 'sb_publishable_gFddoL8aMpTWJE979hRgvg_dJVackKZ',
    table: 'site_chat_leads',
    settingsTable: 'site_chat_settings',
    storageKey: 'cronos-site-chat-v1',
    whatsappNumber: String((window.CRONOS_SITE_CHAT_CONFIG && window.CRONOS_SITE_CHAT_CONFIG.whatsappNumber) || '').replace(/\D/g, ''),
    whatsappMessage: (window.CRONOS_SITE_CHAT_CONFIG && window.CRONOS_SITE_CHAT_CONFIG.whatsappMessage) || 'Olá! Vim pelo site do Cronos Odonto e quero saber mais sobre o sistema.',
    pollMs: 9000
  };

  const DEFAULT_FLOW = {
    welcome1: 'Olá! Eu sou o Cronos 👋',
    welcome2: 'Posso te ajudar a entender se o sistema faz sentido para a sua clínica. Primeiro: qual o seu nome?',
    askInterest: 'Prazer, Dr(a). {nome}. Como você quer seguir?',
    askClinic: 'Perfeito. Qual o nome da sua clínica?',
    askPhone: 'Boa. Agora me passa seu WhatsApp com DDD para a equipe te retornar.',
    askCity: 'E de qual cidade/estado você fala?',
    askFreeMessage: 'Se quiser, me diga rapidinho o que você quer resolver na clínica. Ou clique em “Falar com atendente” que eu já aviso a equipe pelo Superadmin.',
    handoffMessage: 'Perfeito. Já deixei sua conversa marcada para atendimento humano no Superadmin. A equipe Cronos vai continuar daqui.',
    attendantLabel: 'Falar com atendente',
    quickActions: [
      'Quero uma demonstração',
      'Quero saber valores',
      'Quero entender como funciona',
      'Quero falar com alguém'
    ],
    closing: 'Pronto ✅ Seus dados já foram enviados para o Superadmin do Cronos. Se preferir, também dá para seguir pelo WhatsApp.'
  };

  const STRINGS = {
    ...DEFAULT_FLOW,
    askInterestMessage(name){
      const template = String(this.askInterest || DEFAULT_FLOW.askInterest);
      return template.replaceAll('{nome}', name || 'Doutor(a)').replaceAll('[NOME]', name || 'Doutor(a)');
    },
    offline: 'O chat está quase lá, mas a tabela do Supabase ainda não foi preparada. Rode o arquivo site-chat-setup.sql para ativar tudo.'
  };

  function applyFlowConfig(flowConfig){
    const flow = (flowConfig && typeof flowConfig === 'object') ? flowConfig : {};
    Object.keys(DEFAULT_FLOW).forEach((key)=>{
      if (key === 'quickActions') {
        if (Array.isArray(flow.quickActions) && flow.quickActions.length) {
          STRINGS.quickActions = flow.quickActions.map((item)=>String(item || '').trim()).filter(Boolean);
        }
        return;
      }
      if (typeof flow[key] === 'string' && flow[key].trim()) {
        STRINGS[key] = flow[key].trim();
      }
    });
  }

  if (!window.supabase || !document.body) return;
  const client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.anonKey);
  let siteSettings = {
    avatarUrl: 'assets/brand/cronos-symbol-2d.png',
    whatsappNumber: CONFIG.whatsappNumber,
    whatsappMessage: CONFIG.whatsappMessage
  };

  const persisted = loadPersisted();
  const state = {
    sessionKey: persisted.sessionKey || cryptoRandomKey(),
    leadId: persisted.leadId || null,
    transcript: Array.isArray(persisted.transcript) ? persisted.transcript : [],
    unreadBadge: persisted.unreadBadge == null ? 0 : persisted.unreadBadge,
    visitorName: persisted.visitorName || '',
    clinicName: persisted.clinicName || '',
    city: persisted.city || '',
    phone: persisted.phone || '',
    interest: persisted.interest || '',
    currentStep: persisted.currentStep || 'name',
    status: persisted.status || 'novo',
    panelOpen: false,
    pollTimer: null
  };

  let settingsReady = Promise.resolve(siteSettings);

  injectMarkup();
  const els = bindElements();
  hydrateUi();
  bindEvents();
  bootstrapConversation();
  startPolling();
  settingsReady = loadPublicSettings()
    .then((settings)=>{ syncWidgetSettings(); return settings || siteSettings; })
    .catch((err)=>{ console.warn('site chat settings bootstrap', err); syncWidgetSettings(); return siteSettings; });
  syncWhatsAppButton();

  function injectMarkup(){
    if (document.getElementById('cronosFloatingDock')) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="cronos-float-dock" id="cronosFloatingDock">
        <button type="button" class="cronos-fab cronos-fab-chat" id="cronosChatFab" aria-label="Abrir chat do Cronos">
          <img data-cronos-avatar src="assets/brand/cronos-symbol-2d.png" alt="Cronos" />
          <span class="cronos-fab-badge" id="cronosChatBadge">1</span>
          <span class="cronos-fab-ping"></span>
        </button>
        <a class="cronos-fab cronos-fab-whatsapp" id="cronosWhatsappFab" href="#" aria-label="Falar pelo WhatsApp">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.198.297-.768.966-.94 1.164-.173.198-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.787-1.48-1.76-1.653-2.058-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479s1.065 2.875 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.693.626.711.226 1.359.194 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347Zm-5.421 7.617h-.005a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.448 4.436-9.884 9.888-9.884a9.82 9.82 0 0 1 6.99 2.9 9.83 9.83 0 0 1 2.893 6.995c-.003 5.45-4.436 9.883-9.886 9.883Z"></path></svg>
        </a>
      </div>
      <section class="cronos-chat-panel hidden" id="cronosChatPanel" aria-live="polite">
        <div class="cronos-chat-head">
          <div class="cronos-chat-brand">
            <img data-cronos-avatar src="assets/brand/cronos-symbol-2d.png" alt="Cronos" />
            <div>
              <strong>Cronos</strong>
              <span>Atendimento inicial da landing</span>
            </div>
          </div>
          <button type="button" class="cronos-chat-close" id="cronosChatClose" aria-label="Fechar chat">×</button>
        </div>
        <div class="cronos-chat-status hidden" id="cronosChatStatus"></div>
        <div class="cronos-chat-body" id="cronosChatBody"></div>
        <div class="cronos-chat-quick hidden" id="cronosQuickActions"></div>
        <form class="cronos-chat-form" id="cronosChatForm">
          <input type="text" id="cronosChatInput" class="cronos-chat-input" placeholder="Escreva sua resposta..." autocomplete="off" />
          <button type="submit" class="cronos-chat-send">Enviar</button>
        </form>
      </section>
    `;
    document.body.appendChild(wrapper);
  }

  function bindElements(){
    return {
      fab: document.getElementById('cronosChatFab'),
      badge: document.getElementById('cronosChatBadge'),
      panel: document.getElementById('cronosChatPanel'),
      close: document.getElementById('cronosChatClose'),
      body: document.getElementById('cronosChatBody'),
      quick: document.getElementById('cronosQuickActions'),
      form: document.getElementById('cronosChatForm'),
      input: document.getElementById('cronosChatInput'),
      status: document.getElementById('cronosChatStatus'),
      whatsapp: document.getElementById('cronosWhatsappFab')
    };
  }

  function hydrateUi(){
    renderBadge();
    renderTranscript();
    renderQuickActions();
  }

  function bootstrapConversation(){
    if (state.transcript.length) return;
    pushMessage('bot', STRINGS.welcome1, false);
    pushMessage('bot', STRINGS.welcome2, false);
    state.unreadBadge = 1;
    renderBadge();
    persistState();
  }

  function bindEvents(){
    if (els.fab) els.fab.addEventListener('click', ()=>togglePanel(true));
    if (els.close) els.close.addEventListener('click', ()=>togglePanel(false));
    if (els.form) els.form.addEventListener('submit', onSubmit);
    if (els.quick) els.quick.addEventListener('click', onQuickClick);
    if (els.whatsapp) {
      els.whatsapp.addEventListener('click', async function(ev){
        ev.preventDefault();
        try { await settingsReady; } catch (_) {}
        const phone = getConfiguredWhatsappNumber();
        if (phone) {
          clearStatus();
          const url = buildWhatsappUrl(phone);
          els.whatsapp.href = url;
          els.whatsapp.target = '_blank';
          els.whatsapp.rel = 'noopener noreferrer';
          window.open(url, '_blank', 'noopener,noreferrer');
          return;
        }
        togglePanel(true);
        flashStatus('O WhatsApp oficial ainda não foi configurado. Enquanto isso, manda por aqui mesmo.', 'warn');
      });
    }
  }

  async function onSubmit(ev){
    ev.preventDefault();
    const value = String(els.input.value || '').trim();
    if (!value) return;
    els.input.value = '';
    await processVisitorInput(value);
  }

  async function onQuickClick(ev){
    const btn = ev.target.closest('[data-quick-value]');
    if (!btn) return;
    const label = btn.dataset.quickValue || btn.textContent.trim();
    if (!label) return;

    if (label === (STRINGS.attendantLabel || DEFAULT_FLOW.attendantLabel)) {
      pushMessage('visitor', label, true);
      state.status = 'em_atendimento';
      state.currentStep = 'done';
      renderQuickActions();
      pushMessage('bot', STRINGS.handoffMessage || DEFAULT_FLOW.handoffMessage, false);
      await syncLead();
      return;
    }

    pushMessage('visitor', label, true);
    state.interest = label;
    state.currentStep = 'clinic';
    renderQuickActions();
    pushMessage('bot', STRINGS.askClinic, false);
    await syncLead();
  }

  function togglePanel(open){
    state.panelOpen = !!open;
    if (els.panel) els.panel.classList.toggle('hidden', !open);
    const dock = document.getElementById('cronosFloatingDock');
    if (dock) dock.classList.toggle('is-chat-open', open);
    if (open) {
      state.unreadBadge = 0;
      renderBadge();
      persistState();
      setTimeout(()=>els.input && els.input.focus(), 80);
    }
  }

  async function processVisitorInput(value){
    pushMessage('visitor', value, true);
    if (state.currentStep === 'name') {
      state.visitorName = value;
      state.currentStep = 'interest';
      renderQuickActions();
      pushMessage('bot', STRINGS.askInterestMessage(firstName(value)), false);
      await syncLead();
      return;
    }
    if (state.currentStep === 'clinic') {
      state.clinicName = value;
      state.currentStep = 'phone';
      pushMessage('bot', STRINGS.askPhone, false);
      await syncLead();
      return;
    }
    if (state.currentStep === 'phone') {
      state.phone = value;
      state.currentStep = 'city';
      pushMessage('bot', STRINGS.askCity, false);
      await syncLead();
      return;
    }
    if (state.currentStep === 'city') {
      state.city = value;
      state.currentStep = 'free_message';
      pushMessage('bot', STRINGS.askFreeMessage, false);
      renderQuickActions();
      await syncLead();
      return;
    }
    if (state.currentStep === 'free_message') {
      state.currentStep = 'done';
      pushMessage('bot', STRINGS.closing, false);
      await syncLead();
      renderQuickActions();
      return;
    }
    await syncLead();
  }

  function renderQuickActions(){
    if (!els.quick) return;

    if (state.currentStep === 'interest') {
      els.quick.classList.remove('hidden');
      const actions = (Array.isArray(STRINGS.quickActions) && STRINGS.quickActions.length)
        ? STRINGS.quickActions
        : DEFAULT_FLOW.quickActions;
      els.quick.innerHTML = actions.map((item)=>`<button type="button" class="cronos-quick-btn" data-quick-value="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('');
      return;
    }

    if (state.currentStep === 'free_message') {
      els.quick.classList.remove('hidden');
      const actions = [STRINGS.attendantLabel || DEFAULT_FLOW.attendantLabel];
      els.quick.innerHTML = actions.map((item)=>`<button type="button" class="cronos-quick-btn cronos-quick-attendant" data-quick-value="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('');
      return;
    }

    els.quick.classList.add('hidden');
    els.quick.innerHTML = '';
  }

  function renderTranscript(){
    if (!els.body) return;
    els.body.innerHTML = state.transcript.map((msg)=>{
      const role = msg.sender === 'visitor' ? 'visitor' : (msg.sender === 'admin' ? 'admin' : 'bot');
      const author = role === 'visitor' ? 'Você' : (role === 'admin' ? 'Equipe Cronos' : 'Cronos');
      const text = escapeHtml(msg.text).replace(/\n/g, '<br>');
      return `<article class="cronos-msg ${role}"><div class="cronos-msg-meta"><strong>${author}</strong><span>${formatTime(msg.at)}</span></div><div class="cronos-msg-bubble">${text}</div></article>`;
    }).join('');
    els.body.scrollTop = els.body.scrollHeight;
  }

  function pushMessage(sender, text, persistNow){
    state.transcript.push({ id: cryptoRandomKey(), sender, text: String(text || '').trim(), at: new Date().toISOString() });
    if (!state.panelOpen && sender !== 'visitor') state.unreadBadge = Math.min(9, (Number(state.unreadBadge) || 0) + 1);
    renderBadge();
    persistState();
    renderTranscript();
    if (persistNow) syncLead();
  }

  function renderBadge(){
    if (!els.badge) return;
    const count = Number(state.unreadBadge) || 0;
    els.badge.textContent = count > 9 ? '9+' : String(count || 1);
    els.badge.classList.toggle('hidden', count <= 0);
  }

  async function loadPublicSettings(){
    try {
      const { data, error } = await client
        .from(CONFIG.settingsTable)
        .select('avatar_url, whatsapp, whatsapp_number, phone, telefone, whatsapp_message, wa_message, flow_config, updated_at')
        .eq('id', 'default')
        .maybeSingle();
      if (error || !data) return siteSettings;
      applyFlowConfig(data.flow_config);
      siteSettings = {
        avatarUrl: data.avatar_url || 'assets/brand/cronos-symbol-2d.png',
        whatsappNumber: String(data.whatsapp || data.whatsapp_number || data.phone || data.telefone || CONFIG.whatsappNumber || '').replace(/\D/g, ''),
        whatsappMessage: data.whatsapp_message || data.wa_message || CONFIG.whatsappMessage
      };
      return siteSettings;
    } catch (error) {
      console.warn('site chat settings', error);
      return siteSettings;
    }
  }

  function syncWidgetSettings(){
    const avatar = siteSettings.avatarUrl || 'assets/brand/cronos-symbol-2d.png';
    document.querySelectorAll('[data-cronos-avatar]').forEach((img)=>{
      img.src = avatar;
    });
    syncWhatsAppButton();
  }

  function getConfiguredWhatsappNumber(){
    return String(
      (siteSettings && siteSettings.whatsappNumber) ||
      CONFIG.whatsappNumber ||
      ''
    ).replace(/\D/g, '');
  }

  function buildWhatsappUrl(phone){
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const msg = (siteSettings && siteSettings.whatsappMessage) || CONFIG.whatsappMessage || '';
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
  }

  function syncWhatsAppButton(){
    if (!els.whatsapp) return;
    const phone = getConfiguredWhatsappNumber();
    if (phone) {
      els.whatsapp.href = buildWhatsappUrl(phone);
      els.whatsapp.target = '_blank';
      els.whatsapp.rel = 'noopener noreferrer';
      clearStatus();
    } else {
      els.whatsapp.href = '#';
      els.whatsapp.removeAttribute('target');
      els.whatsapp.removeAttribute('rel');
    }
  }

  async function syncLead(){
    persistState();
    const payload = buildPayload();
    try {
      const { data, error } = await client
        .from(CONFIG.table)
        .upsert(payload, { onConflict: 'session_key' })
        .select('id, transcript, status')
        .single();
      if (error) throw error;
      if (data && data.id) state.leadId = data.id;
      if (data && Array.isArray(data.transcript) && data.transcript.length >= state.transcript.length) state.transcript = data.transcript;
      if (data && data.status) state.status = data.status;
      persistState();
      clearStatus();
      renderTranscript();
      return data;
    } catch (error) {
      flashStatus(STRINGS.offline, 'warn');
      console.warn('site chat sync', error);
      return null;
    }
  }

  function buildPayload(){
    const last = state.transcript[state.transcript.length - 1] || {};
    return {
      session_key: state.sessionKey,
      dentist_name: state.visitorName || null,
      clinic_name: state.clinicName || null,
      city: state.city || null,
      phone: state.phone || null,
      interest: state.interest || null,
      status: state.status || 'novo',
      source: 'landing-page',
      current_step: state.currentStep || 'name',
      page_url: location.href,
      last_message: last.text || null,
      transcript: state.transcript,
      unread_admin: state.transcript.filter((msg)=>msg.sender === 'visitor').length,
      unread_visitor: 0,
      updated_at: new Date().toISOString()
    };
  }

  async function pollLead(){
    if (!state.sessionKey) return;
    try {
      const { data, error } = await client.from(CONFIG.table).select('id, transcript, status, unread_visitor').eq('session_key', state.sessionKey).maybeSingle();
      if (error || !data) return;
      state.leadId = data.id || state.leadId;
      state.status = data.status || state.status;
      const incoming = Array.isArray(data.transcript) ? data.transcript : [];
      if (incoming.length > state.transcript.length) {
        const newAdmin = incoming.slice(state.transcript.length).filter((msg)=>msg.sender === 'admin');
        state.transcript = incoming;
        if (newAdmin.length && !state.panelOpen) state.unreadBadge = Math.min(9, (Number(state.unreadBadge) || 0) + newAdmin.length);
        persistState();
        renderBadge();
        renderTranscript();
      }
      if (state.panelOpen && data.unread_visitor > 0) {
        await client.from(CONFIG.table).update({ unread_visitor: 0 }).eq('session_key', state.sessionKey);
      }
    } catch (error) {
      console.warn('site chat poll', error);
    }
  }

  function startPolling(){
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(pollLead, CONFIG.pollMs);
  }

  function flashStatus(text, type){
    if (!els.status) return;
    els.status.textContent = text;
    els.status.className = `cronos-chat-status ${type || 'info'}`;
    els.status.classList.remove('hidden');
  }

  function clearStatus(){
    if (!els.status) return;
    els.status.textContent = '';
    els.status.className = 'cronos-chat-status hidden';
  }

  function persistState(){
    localStorage.setItem(CONFIG.storageKey, JSON.stringify({
      sessionKey: state.sessionKey,
      leadId: state.leadId,
      transcript: state.transcript,
      unreadBadge: state.unreadBadge,
      visitorName: state.visitorName,
      clinicName: state.clinicName,
      city: state.city,
      phone: state.phone,
      interest: state.interest,
      currentStep: state.currentStep,
      status: state.status
    }));
  }

  function loadPersisted(){
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function cryptoRandomKey(){
    try { return crypto.randomUUID(); } catch (_) { return `cronos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
  }

  function formatTime(iso){
    try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return '--:--'; }
  }

  function firstName(name){
    return String(name || '').trim().split(/\s+/)[0] || 'Doutor(a)';
  }

  function escapeHtml(str){
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
