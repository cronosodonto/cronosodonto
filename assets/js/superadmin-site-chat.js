
(function(){
  function normalizeWhatsappNumber(value){
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    return digits;
  }

  const shared = window.__CRONOS_SUPERADMIN_SHARED__;
  if (!shared || !shared.supabaseClient) return;

  const client = shared.supabaseClient;
  const toast = shared.toast || function(){};
  const SETTINGS_TABLE = 'site_chat_settings';
  const ADMIN_ENDPOINT = 'permissions-admin';
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
    ]
  };

  function defaultSettings(){
    return {
      avatar_url: 'assets/brand/cronos-symbol-2d.png',
      whatsapp: '',
      whatsapp_message: 'Olá! Vim pelo site do Cronos Odonto e quero saber mais sobre o sistema.',
      flow_config: { ...DEFAULT_FLOW, quickActions: [...DEFAULT_FLOW.quickActions] }
    };
  }

  function normalizeFlow(flow){
    const raw = (flow && typeof flow === 'object') ? flow : {};
    const merged = { ...DEFAULT_FLOW, ...raw };
    merged.quickActions = Array.isArray(raw.quickActions) && raw.quickActions.length
      ? raw.quickActions.map((item)=>String(item || '').trim()).filter(Boolean)
      : [...DEFAULT_FLOW.quickActions];
    return merged;
  }

  function fillLandingSettingsForm(settings){
    const safe = settings || defaultSettings();
    const flow = normalizeFlow(safe.flow_config);
    const setVal = (id, value) => {
      const el = qs(id);
      if (el) el.value = value || '';
    };

    setVal('siteChatAvatarUrl', safe.avatar_url || 'assets/brand/cronos-symbol-2d.png');
    setVal('siteChatWhatsapp', normalizeWhatsappNumber(safe.whatsapp || ''));
    setVal('siteChatWhatsappMessage', safe.whatsapp_message || defaultSettings().whatsapp_message);

    setVal('siteChatFlowWelcome1', flow.welcome1);
    setVal('siteChatFlowWelcome2', flow.welcome2);
    setVal('siteChatFlowAskInterest', flow.askInterest);
    setVal('siteChatFlowAskClinic', flow.askClinic);
    setVal('siteChatFlowAskPhone', flow.askPhone);
    setVal('siteChatFlowAskCity', flow.askCity);
    setVal('siteChatFlowAskFree', flow.askFreeMessage);
    setVal('siteChatFlowHandoff', flow.handoffMessage);
    setVal('siteChatFlowAttendantLabel', flow.attendantLabel);
    setVal('siteChatFlowQuickActions', (flow.quickActions || []).join('\n'));

    const preview = qs('siteChatSettingsPreview');
    if (preview) {
      const phone = normalizeWhatsappNumber(safe.whatsapp || '');
      preview.textContent = phone
        ? `Chat configurado. WhatsApp da landing: ${phone}. Fluxo com ${(flow.quickActions || []).length} botão(ões) rápido(s).`
        : 'Fluxo carregado. WhatsApp da landing ainda não configurado.';
    }
  }

  function readLandingSettingsForm(){
    const val = (id, fallback='') => String(qs(id)?.value || fallback).trim();
    const actions = val('siteChatFlowQuickActions')
      .split(/\n+/)
      .map((item)=>item.trim())
      .filter(Boolean);

    return {
      avatar_url: val('siteChatAvatarUrl', 'assets/brand/cronos-symbol-2d.png') || 'assets/brand/cronos-symbol-2d.png',
      whatsapp: normalizeWhatsappNumber(val('siteChatWhatsapp')),
      whatsapp_message: val('siteChatWhatsappMessage', defaultSettings().whatsapp_message),
      flow_config: {
        welcome1: val('siteChatFlowWelcome1', DEFAULT_FLOW.welcome1),
        welcome2: val('siteChatFlowWelcome2', DEFAULT_FLOW.welcome2),
        askInterest: val('siteChatFlowAskInterest', DEFAULT_FLOW.askInterest),
        askClinic: val('siteChatFlowAskClinic', DEFAULT_FLOW.askClinic),
        askPhone: val('siteChatFlowAskPhone', DEFAULT_FLOW.askPhone),
        askCity: val('siteChatFlowAskCity', DEFAULT_FLOW.askCity),
        askFreeMessage: val('siteChatFlowAskFree', DEFAULT_FLOW.askFreeMessage),
        handoffMessage: val('siteChatFlowHandoff', DEFAULT_FLOW.handoffMessage),
        attendantLabel: val('siteChatFlowAttendantLabel', DEFAULT_FLOW.attendantLabel),
        quickActions: actions.length ? actions : [...DEFAULT_FLOW.quickActions]
      }
    };
  }


  const state = {
    rows: [],
    search: '',
    status: 'all',
    selectedId: null,
    bound: false,
    poll: null,
    loadPromise: null,
    mutationVersion: 0
  };

  function qs(id){ return document.getElementById(id); }
  function fmtDate(iso){
    try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch(_) { return '-'; }
  }
  function esc(str){
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function selectedRow(){ return state.rows.find((row)=>row.id === state.selectedId) || null; }
  function callAdmin(payload){
    if (typeof shared.callEdgeFunction !== 'function') throw new Error('Conector seguro do Super Admin indisponível.');
    return shared.callEdgeFunction(ADMIN_ENDPOINT, payload);
  }

  function load(showToast){
    if (state.loadPromise) return state.loadPromise;
    const loadVersion = state.mutationVersion;
    let stale = false;
    const list = qs('siteChatList');
    if (list) list.innerHTML = '<div class="sitechat-empty">Carregando chats do site...</div>';
    state.loadPromise = (async()=>{
      try {
        const result = await callAdmin({ action: 'site_chat_list' });
        if (loadVersion !== state.mutationVersion) { stale = true; return; }
        state.rows = Array.isArray(result?.rows) ? result.rows : [];
        if (!state.rows.some((row)=>row.id === state.selectedId)) state.selectedId = state.rows[0]?.id || null;
        renderList();
        renderDetail();
        if (showToast) toast('Chats do site atualizados.', 'success', 2200);
      } catch (error) {
        if (list) list.innerHTML = '<div class="sitechat-empty">Não foi possível carregar os chats do site. Verifique a configuração do serviço.</div>';
        const empty = qs('siteChatDetailEmpty');
        const detail = qs('siteChatDetail');
        if (detail) detail.classList.add('hidden');
        if (empty) empty.classList.remove('hidden');
        console.warn('superadmin site chat load', error);
      } finally {
        state.loadPromise = null;
        if (stale) setTimeout(()=>load(false), 0);
      }
    })();
    return state.loadPromise;
  }

  function filteredRows(){
    const q = state.search.trim().toLowerCase();
    return state.rows.filter((row)=>{
      const blob = [row.dentist_name, row.clinic_name, row.city, row.phone, row.interest, row.last_message].filter(Boolean).join(' ').toLowerCase();
      const okSearch = !q || blob.includes(q);
      const okStatus = state.status === 'all' || String(row.status || 'novo') === state.status;
      return okSearch && okStatus;
    });
  }

  function renderList(){
    const list = qs('siteChatList');
    if (!list) return;
    const rows = filteredRows();
    if (!rows.length) {
      list.innerHTML = '<div class="sitechat-empty">Nenhum chat encontrado com esse filtro.</div>';
      return;
    }
    list.innerHTML = rows.map((row)=>{
      const active = row.id === state.selectedId ? 'active' : '';
      const unread = Number(row.unread_admin || 0);
      return `<button type="button" class="sitechat-list-item ${active}" data-site-chat-id="${row.id}">
        <div class="sitechat-list-head"><strong>${esc(row.dentist_name || 'Dentista sem nome')}</strong>${unread ? `<span class="sitechat-counter">${unread}</span>` : ''}</div>
        <div class="sitechat-list-sub">${esc(row.clinic_name || 'Clínica não informada')}</div>
        <div class="sitechat-list-snippet">${esc(row.last_message || 'Sem mensagens ainda.')}</div>
        <div class="sitechat-list-meta"><span>${esc(row.status || 'novo')}</span><span>${fmtDate(row.updated_at || row.created_at)}</span></div>
      </button>`;
    }).join('');
  }

  function renderDetail(){
    const empty = qs('siteChatDetailEmpty');
    const detail = qs('siteChatDetail');
    const row = selectedRow();
    if (!detail || !empty) return;
    if (!row) {
      detail.classList.add('hidden');
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    detail.classList.remove('hidden');

    qs('siteChatDentist').textContent = row.dentist_name || 'Dentista sem nome';
    qs('siteChatClinic').textContent = row.clinic_name || 'Clínica não informada';
    qs('siteChatMeta').textContent = `${row.city || 'Cidade não informada'} • ${row.phone || 'Sem WhatsApp'} • ${row.interest || 'Interesse não informado'}`;
    qs('siteChatStatus').value = row.status || 'novo';

    const trans = Array.isArray(row.transcript) ? row.transcript : [];
    qs('siteChatTranscript').innerHTML = trans.length ? trans.map((msg)=>{
      const role = msg.sender === 'visitor' ? 'visitor' : (msg.sender === 'admin' ? 'admin' : 'bot');
      const author = role === 'visitor' ? 'Dentista' : (role === 'admin' ? 'Equipe Cronos' : 'Cronos');
      return `<article class="sitechat-msg ${role}"><div class="sitechat-msg-meta"><strong>${author}</strong><span>${fmtDate(msg.at)}</span></div><div class="sitechat-msg-bubble">${esc(msg.text).replace(/\n/g,'<br>')}</div></article>`;
    }).join('') : '<div class="sitechat-empty">Sem mensagens nessa conversa.</div>';

    if (Number(row.unread_admin || 0) > 0) markRead(row.id);
  }

  async function markRead(id){
    try {
      await callAdmin({ action: 'site_chat_mark_read', id });
      state.mutationVersion += 1;
      const row = state.rows.find((item)=>item.id === id);
      if (row) row.unread_admin = 0;
      renderList();
    } catch (_) {}
  }

  async function sendReply(){
    const row = selectedRow();
    const input = qs('siteChatReply');
    if (!row || !input) return;
    const text = String(input.value || '').trim();
    if (!text) return;
    try {
      const result = await callAdmin({ action: 'site_chat_reply', id: row.id, text });
      if (!result?.row?.id) throw new Error('Resposta do serviço sem a conversa atualizada.');
      state.mutationVersion += 1;
      const index = state.rows.findIndex((item)=>item.id === row.id);
      if (index >= 0) state.rows[index] = result.row;
      input.value = '';
      renderList();
      renderDetail();
      toast('Resposta enviada para o chat do site.', 'success', 2200);
    } catch (error) {
      toast('Não consegui enviar a resposta.', 'error', 2600);
      console.warn('superadmin site chat send', error);
    }
  }

  async function changeStatus(value){
    const row = selectedRow();
    if (!row) return;
    try {
      const result = await callAdmin({ action: 'site_chat_status', id: row.id, status: value });
      if (!result?.row?.id) throw new Error('Resposta do serviço sem a conversa atualizada.');
      state.mutationVersion += 1;
      const index = state.rows.findIndex((item)=>item.id === row.id);
      if (index >= 0) state.rows[index] = result.row;
      renderList();
      renderDetail();
    } catch (error) {
      toast('Não foi possível atualizar o status.', 'error', 2400);
    }
  }

  function buildWhatsUrl(){
    const row = selectedRow();
    if (!row || !row.phone) return '';
    const digits = normalizeWhatsappNumber(row.phone);
    if (!digits) return '';
    return `https://wa.me/${digits}`;
  }


  async function loadLandingSettings(){
    try {
      const { data, error } = await client
        .from(SETTINGS_TABLE)
        .select('avatar_url, whatsapp, whatsapp_message, flow_config, updated_at')
        .eq('id', 'default')
        .maybeSingle();
      if (error) throw error;
      fillLandingSettingsForm(data || defaultSettings());
    } catch (error) {
      fillLandingSettingsForm(defaultSettings());
      const preview = qs('siteChatSettingsPreview');
      if (preview) preview.textContent = 'Não foi possível carregar as configurações do chat. Verifique a configuração do serviço.';
      console.warn('site chat settings load', error);
    }
  }

  async function saveLandingSettings(){
    const settings = readLandingSettingsForm();
    try {
      await callAdmin({ action: 'site_chat_settings_save', settings });
      toast('Configurações do chat salvas.', 'success', 2400);
      await loadLandingSettings();
    } catch (error) {
      toast('Não consegui salvar as configurações do chat.', 'error', 3000);
      console.warn('site chat settings save', error);
    }
  }

  async function useSupportWhatsapp(){
    try {
      let settings = null;
      if (shared.loadSupportSettingsCloud) settings = await shared.loadSupportSettingsCloud(false);
      if (!settings && shared.loadSupportSettings) settings = shared.loadSupportSettings();
      const phone = normalizeWhatsappNumber(settings?.whatsapp || '');
      if (!phone) {
        toast('Não encontrei WhatsApp salvo no suporte.', 'error', 2600);
        return;
      }
      const field = qs('siteChatWhatsapp');
      if (field) field.value = phone;
      toast('WhatsApp do suporte aplicado no chat da landing.', 'success', 2200);
    } catch (error) {
      toast('Não consegui puxar o WhatsApp do suporte.', 'error', 2600);
    }
  }


  function bind(){
    if (state.bound) return;
    state.bound = true;

    document.addEventListener('click', (ev)=>{
      const rowBtn = ev.target.closest('[data-site-chat-id]');
      if (rowBtn) {
        state.selectedId = rowBtn.dataset.siteChatId;
        renderList();
        renderDetail();
        return;
      }
      if (ev.target.closest('#btnSiteChatRefresh')) { load(true); return; }
      if (ev.target.closest('#btnSiteChatSaveSettings')) { saveLandingSettings(); return; }
      if (ev.target.closest('#btnSiteChatUseSupportWhatsapp')) { useSupportWhatsapp(); return; }
      if (ev.target.closest('#btnSiteChatResetFlow')) { fillLandingSettingsForm({ ...readLandingSettingsForm(), flow_config: { ...DEFAULT_FLOW, quickActions: [...DEFAULT_FLOW.quickActions] } }); toast('Fluxo padrão restaurado na tela. Clique em salvar para aplicar.', 'success', 2600); return; }
      if (ev.target.closest('#btnSiteChatSend')) { sendReply(); return; }
      if (ev.target.closest('#btnSiteChatCopyPhone')) {
        const row = selectedRow();
        const value = row && row.phone ? row.phone : '';
        navigator.clipboard.writeText(value || '').then(()=>toast('WhatsApp copiado.', 'success', 1800)).catch(()=>{});
        return;
      }
      if (ev.target.closest('#btnSiteChatOpenWhatsapp')) {
        const url = buildWhatsUrl();
        if (url) window.open(url, '_blank', 'noopener');
        else toast('Esse lead não informou WhatsApp ainda.', 'error', 2200);
      }
    });

    document.addEventListener('input', (ev)=>{
      if (ev.target.id === 'siteChatSearch') { state.search = ev.target.value || ''; renderList(); }
    });
    document.addEventListener('change', (ev)=>{
      if (ev.target.id === 'siteChatFilterStatus') { state.status = ev.target.value || 'all'; renderList(); }
      if (ev.target.id === 'siteChatStatus') { changeStatus(ev.target.value || 'novo'); }
    });
    document.addEventListener('keydown', (ev)=>{
      if (ev.target.id === 'siteChatReply' && (ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        sendReply();
      }
    });

    state.poll = setInterval(()=>{
      const current = document.querySelector('[data-super-panel="siteChats"]');
      if (current && !current.classList.contains('hidden')) load(false);
    }, 10000);
  }

  bind();
  loadLandingSettings();
  window.CRONOS_SITECHAT_ADMIN = { load, loadLandingSettings };
})();
