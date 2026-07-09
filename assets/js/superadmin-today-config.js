
(function(){
  const shared = window.__CRONOS_SUPERADMIN_SHARED__;
  if(!shared || !shared.supabaseClient) return;

  const client = shared.supabaseClient;
  const toast = shared.toast || function(){};
  const TABLE = "today_cronos_settings";

  const DEFAULT = {
    iconMode: "mascot",
    iconUrl: "",
    title: "Sugestão do Cronos",
    message: "Comece pelos {agendamentos_vencidos} agendamentos vencidos e pelas tarefas com WhatsApp disponível.",
    buttonText: "Entendi",
    buttonAction: "overdue"
  };

  function qs(id){ return document.getElementById(id); }

  function esc(str){
    return String(str || "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

  function normalize(cfg){
    const raw = cfg && typeof cfg === "object" ? cfg : {};
    return {
      ...DEFAULT,
      ...raw,
      iconMode: ["mascot","logo","custom"].includes(raw.iconMode) ? raw.iconMode : DEFAULT.iconMode,
      buttonAction: ["overdue","tasks","appointments","none"].includes(raw.buttonAction) ? raw.buttonAction : DEFAULT.buttonAction
    };
  }

  function readForm(){
    const val = (id, fallback="") => String(qs(id)?.value || fallback).trim();
    return normalize({
      iconMode: val("todaySuggestionIconMode", DEFAULT.iconMode),
      iconUrl: val("todaySuggestionIconUrl", ""),
      title: val("todaySuggestionTitle", DEFAULT.title),
      message: val("todaySuggestionMessage", DEFAULT.message),
      buttonText: val("todaySuggestionButtonText", DEFAULT.buttonText),
      buttonAction: val("todaySuggestionButtonAction", DEFAULT.buttonAction)
    });
  }

  function fillForm(cfg){
    const safe = normalize(cfg);
    const set = (id, value) => { const el = qs(id); if(el) el.value = value || ""; };
    set("todaySuggestionIconMode", safe.iconMode);
    set("todaySuggestionIconUrl", safe.iconUrl);
    set("todaySuggestionTitle", safe.title);
    set("todaySuggestionMessage", safe.message);
    set("todaySuggestionButtonText", safe.buttonText);
    set("todaySuggestionButtonAction", safe.buttonAction);
    renderPreview();
  }

  function applyTemplate(text){
    return String(text || "")
      .replaceAll("{agendamentos_vencidos}", "2")
      .replaceAll("{tarefas_abertas}", "18")
      .replaceAll("{recebimentos_pendentes}", "6")
      .replaceAll("{total_atrasados}", "26")
      .replaceAll("{data_hoje}", "03/07/2026");
  }

  function renderPreview(){
    const cfg = readForm();
    const title = qs("todaySuggestionPreview")?.querySelector(".today-preview-title");
    const icon = qs("todaySuggestionPreviewIcon");
    const msg = qs("todaySuggestionPreviewMessage");
    const btn = qs("todaySuggestionPreviewBtn");

    if(title) title.textContent = `✦ ${cfg.title || DEFAULT.title}`;
    if(msg) msg.textContent = applyTemplate(cfg.message || DEFAULT.message);
    if(btn) btn.textContent = cfg.buttonText || DEFAULT.buttonText;

    if(icon){
      if(cfg.iconMode === "custom" && cfg.iconUrl){
        icon.innerHTML = `<img src="${esc(cfg.iconUrl)}" alt="Ícone personalizado" onerror="this.remove();this.parentElement.textContent='🤖';" />`;
      }else if(cfg.iconMode === "logo"){
        icon.innerHTML = `<img src="../assets/brand/cronos-symbol-2d.png" alt="Cronos" />`;
      }else{
        icon.textContent = "🤖";
      }
    }
  }

  async function load(){
    try{
      const { data, error } = await client
        .from(TABLE)
        .select("suggestion_config, updated_at")
        .eq("id", "default")
        .maybeSingle();

      if(error) throw error;

      fillForm(data?.suggestion_config || DEFAULT);
      const status = qs("todaySuggestionStatus");
      if(status) status.textContent = data ? "Configurações carregadas." : "Ainda sem configuração salva. Usando padrão.";
    }catch(error){
      fillForm(DEFAULT);
      const status = qs("todaySuggestionStatus");
      if(status) status.textContent = "Não consegui carregar. Rode o site-chat-setup.sql atualizado para criar a tabela today_cronos_settings.";
      console.warn("today config load", error);
    }
  }

  async function save(){
    const cfg = readForm();
    try{
      const { error } = await client
        .from(TABLE)
        .upsert({
          id: "default",
          suggestion_config: cfg,
          updated_at: new Date().toISOString()
        }, { onConflict: "id" });

      if(error) throw error;
      toast("Sugestão do Hoje no Cronos salva.", "success", 2400);
      await load();
    }catch(error){
      toast("Não consegui salvar a sugestão.", "error", 2800);
      console.warn("today config save", error);
    }
  }

  function reset(){
    fillForm(DEFAULT);
    toast("Padrão restaurado na tela. Clique em salvar para aplicar.", "success", 2600);
  }

  function bind(){
    document.addEventListener("input", (ev)=>{
      if(ev.target && ev.target.closest && ev.target.closest("[id^='todaySuggestion']")) renderPreview();
    });
    document.addEventListener("change", (ev)=>{
      if(ev.target && ev.target.closest && ev.target.closest("[id^='todaySuggestion']")) renderPreview();
    });
    document.addEventListener("click", (ev)=>{
      if(ev.target.closest("#btnTodaySuggestionSave")){ save(); return; }
      if(ev.target.closest("#btnTodaySuggestionReset")){ reset(); return; }
    });
    load();
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", bind);
  }else{
    bind();
  }

  window.CRONOS_TODAY_CONFIG_ADMIN = { load, save, reset };
})();
