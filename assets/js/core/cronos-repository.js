// Cronos Repository v4.9.0 — conflito terminal com recibo e zero reenvio manual
/*
 * CronosRepository V4 — persistência central, transacional e concorrente.
 *
 * Regras:
 * - o servidor é a única fonte oficial;
 * - cache local nunca é mesclado silenciosamente com a nuvem;
 * - cada entidade possui versão própria;
 * - alterações de uma mesma ação são confirmadas em uma única transação;
 * - operation_id torna reenvios idempotentes;
 * - conflitos não sobrescrevem dados: são rejeitados e exibidos ao usuário.
 */
(function initCronosRepository(global){
  "use strict";

  // Evita que duas inclusões acidentais do mesmo arquivo criem dois processadores
  // independentes dentro da mesma aba.
  if(global.__CRONOS_REPOSITORY_V448_ACTIVE__){
    console.warn("Cronos V448: inicialização duplicada do repositório ignorada.");
    return;
  }
  global.__CRONOS_REPOSITORY_V448_ACTIVE__ = true;

  const COLLECTIONS = Object.freeze(["contacts", "entries", "tasks", "payments", "activityLog"]);
  const STORAGE_PREFIX = "cronos_v4_pending";
  const CONFLICT_PREFIX = "cronos_v4_conflict";
  const UNCERTAIN_PREFIX = "cronos_v4_uncertain";
  const COMMIT_LEASE_PREFIX = "cronos_v4_commit_lease";
  const QUEUE_STORAGE_VERSION = 6;
  const RPC_TIMEOUT_MS = 20000;
  const MERGE_TIMEOUT_MS = 60000;
  const LOAD_TIMEOUT_MS = 30000;
  // A interface salva alterações pontuais. Operações em massa pertencem às Edge
  // Functions/RPCs administrativas em lotes, nunca ao autosave do navegador.
  const MAX_BROWSER_MUTATION_ENTITIES = 500;
  const COMMIT_LEASE_MS = 45000;
  const COMMIT_LEASE_SETTLE_MS = 90;
  const TAB_ID = global.crypto?.randomUUID
    ? global.crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const state = {
    client: null,
    clinicId: "",
    enabled: false,
    loaded: false,
    baseline: null,
    working: null,
    versions: emptyVersions(),
    workingVersions: emptyVersions(),
    queue: [],
    processing: false,
    blocked: false,
    activeOperationId: "",
    lastError: null,
    waiters: new Map()
  };

  let operationalLoadPromise = null;
  let operationalLoadClinicId = "";

  class CronosPersistenceError extends Error {
    constructor(message, options={}){
      super(String(message || "Falha de persistência."));
      this.name = "CronosPersistenceError";
      this.code = options.code || "PERSISTENCE_ERROR";
      this.cause = options.cause;
      this.operationId = options.operationId || "";
      this.details = options.details || null;
      this.conflict = options.conflict === true;
    }
  }

  function emptyVersions(){
    return { contacts:{}, entries:{}, tasks:{}, payments:{}, activityLog:{}, meta:0 };
  }

  function clone(value){
    if(value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function freshState(){
    return {
      masters:[], users:[], contacts:[], entries:[], tasks:[], payments:[],
      activityLog:[], settings:{}, version:"v4", createdAt:new Date().toISOString()
    };
  }

  function normalizeState(value){
    const input = value && typeof value === "object" ? value : {};
    const out = { ...freshState(), ...clone(input) };
    COLLECTIONS.forEach(name=>{ if(!Array.isArray(out[name])) out[name] = []; });
    if(!Array.isArray(out.masters)) out.masters = [];
    if(!Array.isArray(out.users)) out.users = [];
    if(!Array.isArray(out.activityLog)) out.activityLog = [];
    if(!out.settings || typeof out.settings !== "object" || Array.isArray(out.settings)) out.settings = {};
    return out;
  }

  function normalizeVersions(value){
    const input = value && typeof value === "object" ? value : {};
    const out = emptyVersions();
    COLLECTIONS.forEach(name=>{
      const map = input[name] && typeof input[name] === "object" ? input[name] : {};
      Object.keys(map).forEach(id=>{ out[name][String(id)] = Number(map[id] || 0); });
    });
    out.meta = Number(input.meta || 0);
    return out;
  }

  function getClient(){
    return state.client || global.__CRONOS_SUPABASE_CLIENT__ || null;
  }

  function newOperationId(){
    if(global.crypto?.randomUUID) return global.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char=>{
      const random = Math.random() * 16 | 0;
      const value = char === "x" ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }

  function sleep(ms){ return new Promise(resolve=>setTimeout(resolve, ms)); }

  function storageKey(){
    return `${STORAGE_PREFIX}:${String(state.clinicId || "unknown")}`;
  }

  function countChangedEntities(changes){
    if(!changes || typeof changes !== "object") return 0;
    let total = changes.meta ? 1 : 0;
    COLLECTIONS.forEach(name=>{
      total += Array.isArray(changes?.[name]?.upserts) ? changes[name].upserts.length : 0;
      total += Array.isArray(changes?.[name]?.deletes) ? changes[name].deletes.length : 0;
    });
    return total;
  }

  function isOversizedBrowserMutation(mutation){
    return countChangedEntities(mutation?.changes) > MAX_BROWSER_MUTATION_ENTITIES;
  }

  function persistQueue(){
    if(!state.clinicId) return false;
    try{
      if(!state.queue.length){
        localStorage.removeItem(storageKey());
        return true;
      }
      localStorage.setItem(storageKey(), JSON.stringify({ version:QUEUE_STORAGE_VERSION, queue:state.queue }));
      return true;
    }catch(error){
      console.error("Cronos V4: não foi possível preservar a fila local.", error);
      notify("Não foi possível preparar o salvamento", "O navegador não conseguiu criar a cópia temporária. Tente novamente.");
      return false;
    }
  }

  function readQueue(){
    if(!state.clinicId) return { queue:[], legacy:false };
    try{
      const raw = localStorage.getItem(storageKey());
      const parsed = raw ? JSON.parse(raw) : null;
      const storedVersion = Number(parsed?.version || 0);
      const valid = Array.isArray(parsed?.queue)
        ? parsed.queue.filter(item=>item?.operationId && item?.changes)
        : [];
      const safe = valid.filter(item=>!isOversizedBrowserMutation(item));
      if(safe.length !== valid.length){
        console.warn("Cronos V4: fila antiga com alteração em massa foi descartada. Imports devem usar a rotina administrativa em lotes.");
      }
      if(!safe.length){
        try{ localStorage.removeItem(storageKey()); }catch(_){ }
        return { queue:[], legacy:false };
      }
      return {
        queue:safe,
        // reconciliadas com a nuvem, mas nunca reenviadas automaticamente.
        legacy:storedVersion < QUEUE_STORAGE_VERSION
      };
    }catch(error){
      console.warn("Cronos V4: fila local inválida foi ignorada.", error);
      try{ localStorage.removeItem(storageKey()); }catch(_){ }
      return { queue:[], legacy:false };
    }
  }

  function conflictStorageKey(){
    return `${CONFLICT_PREFIX}:${String(state.clinicId || "unknown")}`;
  }

  function archiveConflict(mutation, error){
    if(!state.clinicId) return false;
    try{
      const existingRaw = localStorage.getItem(conflictStorageKey());
      const existing = existingRaw ? JSON.parse(existingRaw) : null;
      const records = Array.isArray(existing?.records) ? existing.records : [];
      records.push({
        archivedAt:new Date().toISOString(),
        clinicId:state.clinicId,
        operationId:String(mutation?.operationId || ""),
        changes:clone(mutation?.changes || {}),
        error:{
          code:String(error?.code || "VERSION_CONFLICT"),
          message:String(error?.message || error || "Conflito de versão."),
          details:error?.details || null
        }
      });
      localStorage.setItem(conflictStorageKey(), JSON.stringify({ version:4, records:records.slice(-20) }));
      return true;
    }catch(archiveError){
      console.error("Cronos V4: não foi possível arquivar o conflito localmente.", archiveError);
      return false;
    }
  }

  function getConflictArchive(){
    if(!state.clinicId) return [];
    try{
      const raw = localStorage.getItem(conflictStorageKey());
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed?.records) ? clone(parsed.records) : [];
    }catch(_){
      return [];
    }
  }

  function clearConflictArchive(){
    if(!state.clinicId) return false;
    try{
      localStorage.removeItem(conflictStorageKey());
      return true;
    }catch(_){
      return false;
    }
  }

  function uncertainStorageKey(){
    return `${UNCERTAIN_PREFIX}:${String(state.clinicId || "unknown")}`;
  }

  function archiveUncertainMutations(mutations, error, reason="UNCONFIRMED_OPERATION"){
    if(!state.clinicId) return false;
    const list = Array.isArray(mutations) ? mutations.filter(Boolean) : [];
    if(!list.length) return true;
    try{
      const existingRaw = localStorage.getItem(uncertainStorageKey());
      const existing = existingRaw ? JSON.parse(existingRaw) : null;
      const records = Array.isArray(existing?.records) ? existing.records : [];
      list.forEach(mutation=>{
        records.push({
          archivedAt:new Date().toISOString(),
          clinicId:state.clinicId,
          reason:String(reason || "UNCONFIRMED_OPERATION"),
          operationId:String(mutation?.operationId || ""),
          createdAt:String(mutation?.createdAt || ""),
          changes:clone(mutation?.changes || {}),
          error:{
            code:String(error?.code || "UNCONFIRMED_OPERATION"),
            status:Number(error?.status || error?.statusCode || 0),
            message:String(error?.message || error || "Operação não confirmada."),
            details:error?.details || null
          }
        });
      });
      localStorage.setItem(uncertainStorageKey(), JSON.stringify({ version:1, records:records.slice(-30) }));
      return true;
    }catch(archiveError){
      console.error("Cronos V4: não foi possível arquivar a operação incerta localmente.", archiveError);
      return false;
    }
  }

  function getUncertainArchive(){
    if(!state.clinicId) return [];
    try{
      const raw = localStorage.getItem(uncertainStorageKey());
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed?.records) ? clone(parsed.records) : [];
    }catch(_){
      return [];
    }
  }

  function clearUncertainArchive(){
    if(!state.clinicId) return false;
    try{
      localStorage.removeItem(uncertainStorageKey());
      return true;
    }catch(_){
      return false;
    }
  }

  function notify(title, message){
    try{
      if(typeof global.toast === "function") global.toast(title, message || "");
    }catch(_){ }
  }

  let indicatorHideTimer = null;
  function updateIndicator(kind, text){
    try{
      if(!global.document?.body) return;
      let node = global.document.getElementById("cronosPersistenceIndicator");
      if(!node){
        node = global.document.createElement("div");
        node.id = "cronosPersistenceIndicator";
        node.setAttribute("role", "status");
        node.setAttribute("aria-live", "polite");
        node.style.cssText = [
          "position:fixed", "right:18px", "bottom:18px", "z-index:100000",
          "display:none", "align-items:center", "gap:8px", "padding:9px 12px",
          "border-radius:12px", "font:700 12px/1.2 system-ui,-apple-system,Segoe UI,sans-serif",
          "box-shadow:0 10px 30px rgba(15,23,42,.22)", "backdrop-filter:blur(12px)",
          "transition:opacity .2s ease, transform .2s ease"
        ].join(";");
        node.innerHTML = '<span data-v4-dot style="width:8px;height:8px;border-radius:999px;display:block"></span><span data-v4-text></span>';
        global.document.body.appendChild(node);
      }
      if(indicatorHideTimer){ clearTimeout(indicatorHideTimer); indicatorHideTimer = null; }
      const palette = {
        saving:["rgba(15,23,42,.94)", "#fff", "#38bdf8"],
        saved:["rgba(6,78,59,.94)", "#fff", "#34d399"],
        error:["rgba(127,29,29,.96)", "#fff", "#fca5a5"],
        pending:["rgba(120,53,15,.96)", "#fff", "#fbbf24"]
      }[kind] || ["rgba(15,23,42,.94)", "#fff", "#94a3b8"];
      node.style.background = palette[0];
      node.style.color = palette[1];
      node.querySelector("[data-v4-dot]").style.background = palette[2];
      node.querySelector("[data-v4-text]").textContent = String(text || "");
      // O indicador da persistência comunica somente estados que exigem espera
      // ou atenção. A confirmação final da ação já é exibida pelo toast do módulo.
      // Mostrar os dois no mesmo canto gerava avisos duplicados e sobrepostos.
      if(kind === "saved"){
        node.querySelector("[data-v4-text]").textContent = String(text || "Salvo");
        node.style.opacity = "0";
        node.style.transform = "translateY(6px)";
        node.style.display = "none";
        return;
      }

      node.style.display = "flex";
      node.style.opacity = "1";
      node.style.transform = "translateY(0)";
    }catch(_){ }
  }

  function emit(type, detail={}){
    try{ global.dispatchEvent(new CustomEvent(type, { detail })); }catch(_){ }
  }

  function metaFromState(db){
    const meta = clone(normalizeState(db));
    COLLECTIONS.forEach(name=>{ delete meta[name]; });
    delete meta.lastMergedAt;
    delete meta.lastLocalPatchAppliedAt;
    return meta;
  }

  function fingerprint(value){
    try{ return JSON.stringify(value); }catch(_){ return String(value); }
  }

  function mapById(list){
    const map = new Map();
    (Array.isArray(list) ? list : []).forEach(item=>{
      const id = String(item?.id || "").trim();
      if(id) map.set(id, item);
    });
    return map;
  }

  function buildCollectionChanges(name, beforeList, afterList, versionMap){
    const before = mapById(beforeList);
    const after = mapById(afterList);
    const upserts = [];
    const deletes = [];

    after.forEach((item, id)=>{
      const previous = before.get(id);
      if(!previous || fingerprint(previous) !== fingerprint(item)){
        upserts.push({
          payload: clone(item),
          expected_version: Number(versionMap?.[id] || 0)
        });
      }
    });

    before.forEach((_, id)=>{
      if(!after.has(id)){
        deletes.push({ id, expected_version:Number(versionMap?.[id] || 0) });
      }
    });

    return { upserts, deletes };
  }

  function buildChanges(beforeState, afterState, versions){
    const before = normalizeState(beforeState);
    const after = normalizeState(afterState);
    const changes = {};

    COLLECTIONS.forEach(name=>{
      const part = buildCollectionChanges(name, before[name], after[name], versions[name]);
      if(part.upserts.length || part.deletes.length) changes[name] = part;
    });

    const beforeMeta = metaFromState(before);
    const afterMeta = metaFromState(after);
    if(fingerprint(beforeMeta) !== fingerprint(afterMeta)){
      changes.meta = { payload:afterMeta, expected_version:Number(versions.meta || 0) };
    }

    return changes;
  }

  function hasChanges(changes){
    if(!changes || typeof changes !== "object") return false;
    if(changes.meta) return true;
    return COLLECTIONS.some(name=>
      Array.isArray(changes?.[name]?.upserts) && changes[name].upserts.length ||
      Array.isArray(changes?.[name]?.deletes) && changes[name].deletes.length
    );
  }

  function applyChanges(targetState, changes){
    const out = normalizeState(targetState);
    COLLECTIONS.forEach(name=>{
      const part = changes?.[name];
      if(!part) return;
      const map = mapById(out[name]);
      (part.upserts || []).forEach(item=>{
        const payload = clone(item?.payload || {});
        const id = String(payload?.id || "").trim();
        if(id) map.set(id, payload);
      });
      (part.deletes || []).forEach(item=>{
        const id = String(item?.id || "").trim();
        if(id) map.delete(id);
      });
      out[name] = Array.from(map.values());
    });
    if(changes?.meta?.payload){
      const meta = clone(changes.meta.payload);
      COLLECTIONS.forEach(name=>{ meta[name] = out[name]; });
      return normalizeState(meta);
    }
    return out;
  }

  function predictVersions(versions, changes){
    const next = normalizeVersions(versions);
    COLLECTIONS.forEach(name=>{
      const part = changes?.[name];
      if(!part) return;
      (part.upserts || []).forEach(item=>{
        const id = String(item?.payload?.id || "");
        if(id) next[name][id] = Number(item.expected_version || 0) + 1;
      });
      (part.deletes || []).forEach(item=>{
        const id = String(item?.id || "");
        if(id) next[name][id] = Number(item.expected_version || 0) + 1;
      });
    });
    if(changes?.meta) next.meta = Number(changes.meta.expected_version || 0) + 1;
    return next;
  }

  function mergeServerVersions(current, returned){
    const out = normalizeVersions(current);
    const input = returned && typeof returned === "object" ? returned : {};
    COLLECTIONS.forEach(name=>{
      const map = input[name] && typeof input[name] === "object" ? input[name] : {};
      Object.keys(map).forEach(id=>{ out[name][id] = Number(map[id] || 0); });
    });
    if(input.meta != null) out.meta = Number(input.meta || 0);
    return out;
  }

  function emptyCoverage(){
    return { contacts:{}, entries:{}, tasks:{}, payments:{}, activityLog:{}, meta:0 };
  }

  function registerMutationCoverage(coverage, changes){
    COLLECTIONS.forEach(name=>{
      const part = changes?.[name];
      if(!part) return;
      (part.upserts || []).forEach(item=>{
        const id = String(item?.payload?.id || "").trim();
        if(id) coverage[name][id] = Math.max(Number(coverage[name][id] || 0), Number(item?.expected_version || 0));
      });
      (part.deletes || []).forEach(item=>{
        const id = String(item?.id || "").trim();
        if(id) coverage[name][id] = Math.max(Number(coverage[name][id] || 0), Number(item?.expected_version || 0));
      });
    });
    if(changes?.meta){
      coverage.meta = Math.max(Number(coverage.meta || 0), Number(changes.meta.expected_version || 0));
    }
  }

  function mutationReflectedOrSuperseded(serverState, mutation, coverage=emptyCoverage()){
    const current = normalizeState(serverState);
    const changes = mutation?.changes || {};

    for(const name of COLLECTIONS){
      const part = changes?.[name];
      if(!part) continue;
      const map = mapById(current[name]);

      for(const item of (part.upserts || [])){
        const payload = item?.payload || {};
        const id = String(payload?.id || "").trim();
        if(!id) return false;
        const exact = map.has(id) && fingerprint(map.get(id)) === fingerprint(payload);
        const superseded = Number(coverage?.[name]?.[id] || 0) >= Number(item?.expected_version || 0) + 1;
        if(!exact && !superseded) return false;
      }

      for(const item of (part.deletes || [])){
        const id = String(item?.id || "").trim();
        if(!id) return false;
        const exact = !map.has(id);
        const superseded = Number(coverage?.[name]?.[id] || 0) >= Number(item?.expected_version || 0) + 1;
        if(!exact && !superseded) return false;
      }
    }

    if(changes?.meta){
      const exactMeta = fingerprint(metaFromState(current)) === fingerprint(changes.meta.payload || {});
      const supersededMeta = Number(coverage?.meta || 0) >= Number(changes.meta.expected_version || 0) + 1;
      if(!exactMeta && !supersededMeta) return false;
    }

    return true;
  }

  function reconcileRestoredQueue(serverState, queue){
    const list = Array.isArray(queue) ? queue : [];
    if(!list.length) return { pending:[], confirmed:[] };

    const coverage = emptyCoverage();
    const confirmed = [];
    const pending = [];

    for(let index=list.length - 1; index>=0; index--){
      const mutation = list[index];
      if(mutationReflectedOrSuperseded(serverState, mutation, coverage)){
        confirmed.push(mutation);
        registerMutationCoverage(coverage, mutation.changes);
      }else{
        pending.push(mutation);
      }
    }

    confirmed.reverse();
    pending.reverse();
    return { pending, confirmed };
  }

  function rebuildWorking(){
    state.working = clone(state.baseline || freshState());
    state.workingVersions = normalizeVersions(state.versions);
    state.queue.forEach(mutation=>{
      state.working = applyChanges(state.working, mutation.changes);
      state.workingVersions = predictVersions(state.workingVersions, mutation.changes);
    });
  }

  function isNetworkError(error){
    const message = String(error?.message || error?.details || error || "").toLowerCase();
    const status = Number(error?.status || error?.statusCode || 0);
    return status === 408 || status === 425 || status === 429 || status >= 500 ||
      message.includes("fetch") || message.includes("network") || message.includes("timeout") ||
      message.includes("connection") || message.includes("temporar");
  }

  function isInfrastructureBusyError(error){
    const code = String(error?.code || "").toUpperCase();
    const status = Number(error?.status || error?.statusCode || 0);
    const message = String(error?.message || error?.details || error || "").toLowerCase();
    return code === "RPC_TIMEOUT" || code === "ABORT_ERR" || code === "ABORTERROR" ||
      code === "PGRST003" || status === 408 || status === 429 || status === 502 || status === 503 || status === 504 ||
      message.includes("aborted") || message.includes("aborterror") ||
      message.includes("connection pool") || message.includes("timed out acquiring connection") ||
      message.includes("server overloaded") || message.includes("database is overloaded");
  }

  function isConflictError(error){
    const code = String(error?.code || "");
    const message = String(error?.message || error?.details || "");
    return code === "40001" || message.includes("CONFLITO_V4");
  }

  function rpcTimeoutError(label, cause=null){
    const error = new CronosPersistenceError(`${label || "Operação"} excedeu o tempo de resposta.`, {
      code:"RPC_TIMEOUT",
      cause
    });
    error.status = 408;
    return error;
  }

  function withTimeout(promise, timeoutMs, label){
    const ms = Math.max(1000, Number(timeoutMs || 0));
    let timer = null;
    const timeout = new Promise((_, reject)=>{
      timer = setTimeout(()=>reject(rpcTimeoutError(label)), ms);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(()=>{
      if(timer) clearTimeout(timer);
    });
  }

  async function rpc(name, args, options={}){
    const client = getClient();
    if(!client?.rpc) throw new CronosPersistenceError("Cliente do Supabase indisponível.", { code:"SUPABASE_UNAVAILABLE" });
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || LOAD_TIMEOUT_MS));
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timedOut = false;
    let timer = null;
    let request = client.rpc(name, args);
    const supportsAbort = Boolean(controller && typeof request?.abortSignal === "function");

    // O Promise.race antigo desistia da espera, mas deixava a requisição viva.
    // Quando disponível, abortSignal encerra o fetch em andamento e impede que
    // uma segunda RPC seja disparada enquanto a primeira ainda ocupa o banco.
    if(supportsAbort){
      request = request.abortSignal(controller.signal);
      timer = setTimeout(()=>{
        timedOut = true;
        try{ controller.abort(); }catch(_){ }
      }, timeoutMs);
    }

    try{
      const response = supportsAbort
        ? await request
        : await withTimeout(request, timeoutMs, name);
      if(timer){ clearTimeout(timer); timer = null; }
      const { data, error } = response || {};
      if(timedOut || controller?.signal?.aborted) throw rpcTimeoutError(name, error || null);
      if(error) throw error;
      return data;
    }catch(error){
      if(timedOut || controller?.signal?.aborted) throw rpcTimeoutError(name, error);
      throw error;
    }finally{
      if(timer) clearTimeout(timer);
    }
  }

  async function fetchOfficialSnapshot(){
    const data = await rpc("cronos_v4_load_operational_state", { p_clinic_id:state.clinicId }, { timeoutMs:LOAD_TIMEOUT_MS });
    if(data?.enabled !== true) return null;
    return {
      state:normalizeState(data?.state || freshState()),
      versions:normalizeVersions(data?.versions || {})
    };
  }

  async function reconcileUncertainMutation(mutation){
    try{
      const official = await fetchOfficialSnapshot();
      if(!official) return null;
      if(!mutationReflectedOrSuperseded(official.state, mutation, emptyCoverage())) return null;
      return {
        __reconciled:true,
        state:official.state,
        versions:official.versions
      };
    }catch(error){
      console.warn("Cronos V4: não foi possível reconciliar uma resposta incerta.", error);
      return null;
    }
  }

  async function checkStatus(options={}){
    const clinicId = String(options.clinicId || state.clinicId || global.__CRONOS_CLINIC_ID__ || "").trim();
    if(!clinicId) return { enabled:false };
    state.clinicId = clinicId;
    const data = await rpc("cronos_v4_status", { p_clinic_id:clinicId });
    state.enabled = data?.enabled === true;
    return data || { enabled:false };
  }

  async function loadOperationalStateInternal(options={}){
    const clinicId = String(options.clinicId || state.clinicId || global.__CRONOS_CLINIC_ID__ || "").trim();
    if(!clinicId) return { enabled:false, state:null };
    state.clinicId = clinicId;

    const data = await rpc("cronos_v4_load_operational_state", { p_clinic_id:clinicId }, { timeoutMs:LOAD_TIMEOUT_MS });
    state.enabled = data?.enabled === true;
    state.loaded = state.enabled;
    state.blocked = false;
    state.lastError = null;

    if(!state.enabled){
      state.baseline = null;
      state.working = null;
      state.versions = emptyVersions();
      state.workingVersions = emptyVersions();
      state.queue = [];
      return { enabled:false, state:null };
    }

    // A V4 é a única autoridade de persistência. Filas V2 antigas podem conter
    // milhares de contatos/leads e estourar a quota do localStorage ao sair da página.
    try{
      const legacyKeys = [];
      for(let i=0; i<localStorage.length; i++){
        const key = String(localStorage.key(i) || "");
        if(key.endsWith(":pending_v2_patches") || key.endsWith(":pending_task_patches_v21")){
          legacyKeys.push(key);
        }
      }
      legacyKeys.forEach(key=>localStorage.removeItem(key));
    }catch(_){ }

    state.baseline = normalizeState(data?.state || freshState());
    state.versions = normalizeVersions(data?.versions || {});

    const restored = options.restorePending === false
      ? { queue:[], legacy:false }
      : readQueue();
    const reconciled = options.restorePending === false
      ? { pending:[], confirmed:[] }
      : reconcileRestoredQueue(state.baseline, restored.queue);

    // navegador ser fechado. O estado oficial é consultado, itens já refletidos
    // são aceitos e todo o restante vai para quarentena para revisão manual.
    const quarantined = reconciled.pending;
    state.queue = [];
    if(quarantined.length){
      archiveUncertainMutations(
        quarantined,
        { code:"RESTORED_QUEUE_QUARANTINED", message:"Fila encontrada na abertura e não reenviada." },
        "RESTORED_QUEUE_NOT_REPLAYED"
      );
      console.warn("Cronos V448: fila restaurada colocada em quarentena; nenhum commit foi reenviado.", {
        clinicId:state.clinicId,
        tabId:TAB_ID,
        count:quarantined.length,
        operationIds:quarantined.map(item=>String(item?.operationId || ""))
      });
    }
    // Sempre apaga a fila ativa persistida após a reconciliação. O arquivo de
    // quarentena permanece disponível em diagnostics/getUncertainArchive.
    persistQueue();
    rebuildWorking();

    if(reconciled.confirmed.length){
      emit("cronos:persistence-reconciled", { count:reconciled.confirmed.length });
      updateIndicator("saved", "Salvo");
    }

    if(quarantined.length){
      emit("cronos:persistence-error", {
        error:new CronosPersistenceError("Uma alteração antiga foi colocada em quarentena e não foi reenviada.", { code:"RESTORED_QUEUE_QUARANTINED" }),
        mutation:null
      });
      updateIndicator("pending", "Alteração antiga em quarentena");
      notify(
        "Alteração antiga não reenviada",
        "O Cronos conferiu a nuvem e bloqueou o reenvio automático. Revise o registro antes de refazer a ação."
      );
    }

    return { enabled:true, state:clone(state.working), versions:clone(state.workingVersions) };
  }

  async function loadOperationalState(options={}){
    const clinicId = String(options.clinicId || state.clinicId || global.__CRONOS_CLINIC_ID__ || "").trim();
    if(!clinicId) return { enabled:false, state:null };

    if(operationalLoadPromise && operationalLoadClinicId === clinicId){
      return operationalLoadPromise;
    }

    const promise = loadOperationalStateInternal({ ...options, clinicId });
    operationalLoadPromise = promise;
    operationalLoadClinicId = clinicId;
    try{
      return await promise;
    }finally{
      if(operationalLoadPromise === promise){
        operationalLoadPromise = null;
        operationalLoadClinicId = "";
      }
    }
  }

  function resolveWaiter(operationId, value){
    const waiter = state.waiters.get(operationId);
    if(!waiter) return;
    state.waiters.delete(operationId);
    try{ waiter.resolve(value); }catch(_){ }
  }

  function commitLeaseKey(){
    return `${COMMIT_LEASE_PREFIX}:${String(state.clinicId || "unknown")}`;
  }

  function commitLockName(){
    return `cronos-v4-commit:${String(state.clinicId || "unknown")}`;
  }

  function commitBusyError(details={}){
    const error = new CronosPersistenceError(
      "Outra aba do Cronos já está enviando uma alteração para esta clínica.",
      { code:"COMMIT_BUSY_OTHER_TAB", details }
    );
    error.status = 409;
    return error;
  }

  function isCommitBusyError(error){
    return String(error?.code || "").toUpperCase() === "COMMIT_BUSY_OTHER_TAB";
  }

  function readCommitLease(){
    try{
      const raw = localStorage.getItem(commitLeaseKey());
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : null;
    }catch(_){
      return null;
    }
  }

  function releaseCommitLease(candidate){
    try{
      const current = readCommitLease();
      if(current?.owner === candidate?.owner && current?.nonce === candidate?.nonce){
        localStorage.removeItem(commitLeaseKey());
      }
    }catch(_){ }
  }

  async function withFallbackCommitLease(mutation, task){
    const now = Date.now();
    const existing = readCommitLease();
    if(existing && Number(existing.expiresAt || 0) > now && existing.owner !== TAB_ID){
      throw commitBusyError({ owner:existing.owner, operationId:existing.operationId, expiresAt:existing.expiresAt });
    }

    const candidate = {
      owner:TAB_ID,
      nonce:newOperationId(),
      operationId:String(mutation?.operationId || ""),
      acquiredAt:now,
      expiresAt:now + COMMIT_LEASE_MS
    };

    try{
      localStorage.setItem(commitLeaseKey(), JSON.stringify(candidate));
      // Duas leituras espaçadas reduzem a janela de corrida nos navegadores sem
      // Web Locks. Chrome/Edge modernos usam a trava nativa abaixo.
      await sleep(COMMIT_LEASE_SETTLE_MS + Math.floor(Math.random() * 70));
      let current = readCommitLease();
      if(current?.owner !== TAB_ID || current?.nonce !== candidate.nonce){
        throw commitBusyError({ owner:current?.owner || "", operationId:current?.operationId || "" });
      }
      await sleep(COMMIT_LEASE_SETTLE_MS);
      current = readCommitLease();
      if(current?.owner !== TAB_ID || current?.nonce !== candidate.nonce){
        throw commitBusyError({ owner:current?.owner || "", operationId:current?.operationId || "" });
      }
      return await task();
    }finally{
      releaseCommitLease(candidate);
    }
  }

  async function withClinicCommitLock(mutation, task){
    const lockManager = global.navigator?.locks;
    if(lockManager?.request){
      let callbackStarted = false;
      try{
        return await lockManager.request(
          commitLockName(),
          { mode:"exclusive", ifAvailable:true },
          async lock=>{
            callbackStarted = true;
            if(!lock) throw commitBusyError({ lock:"web-locks", operationId:mutation?.operationId || "" });
            return task();
          }
        );
      }catch(error){
        // Se o callback começou, o erro veio do próprio commit. Nunca fazemos
        // fallback nesse caso, pois isso enviaria a mesma operação uma segunda vez.
        if(callbackStarted || isCommitBusyError(error)) throw error;
        console.warn("Cronos V448: Web Locks indisponível; usando trava local de compatibilidade.", error);
      }
    }
    return withFallbackCommitLease(mutation, task);
  }

  function traceCommit(stage, mutation, extra={}){
    const detail = {
      version:"V448",
      stage:String(stage || ""),
      clinicId:state.clinicId,
      tabId:TAB_ID,
      operationId:String(mutation?.operationId || ""),
      source:String(mutation?.source || "frontend_action"),
      queueLength:state.queue.length,
      at:new Date().toISOString(),
      ...extra
    };
    try{ console.info(`Cronos V448 commit ${detail.stage}`, detail); }catch(_){ }
    emit("cronos:persistence-trace", detail);
  }

  async function commitMutation(mutation){
    // devolver um conflito terminal como JSON 200 para neutralizar clientes
    // antigos que insistem na mesma operação sem gerar milhares de erros SQL.
    try{
      const result = await rpc("cronos_v4_commit_changes", {
        p_clinic_id:state.clinicId,
        p_operation_id:mutation.operationId,
        p_changes:mutation.changes
      }, { timeoutMs:RPC_TIMEOUT_MS });

      if(result?.ok === false && (result?.conflict === true || String(result?.code || "") === "CONFLITO_V4")){
        const controlledConflict = new CronosPersistenceError(
          String(result?.message || "CONFLITO_V4: pacote com versão antiga."),
          {
            code:"40001",
            operationId:mutation.operationId,
            details:result,
            conflict:true
          }
        );
        controlledConflict.status = 409;
        throw controlledConflict;
      }

      return result;
    }catch(error){
      if(isNetworkError(error) && !isInfrastructureBusyError(error)){
        const reconciled = await reconcileUncertainMutation(mutation);
        if(reconciled) return reconciled;
      }
      throw error;
    }
  }


  async function processQueue(){
    if(state.processing || state.blocked || !state.enabled || !state.queue.length) return;
    state.processing = true;
    emit("cronos:persistence-saving", { count:state.queue.length });

    try{
      while(state.queue.length && !state.blocked){
        const mutation = state.queue[0];
        const suppressVisualFeedback = mutation?.suppressVisualFeedback === true;
        if(!suppressVisualFeedback) updateIndicator("saving", "Salvando...");
        try{
          if(state.activeOperationId){
            throw new CronosPersistenceError("Já existe um commit ativo nesta aba.", {
              code:"COMMIT_ALREADY_ACTIVE",
              details:{ activeOperationId:state.activeOperationId }
            });
          }
          state.activeOperationId = mutation.operationId;
          traceCommit("dispatch", mutation);
          let result;
          try{
            result = await withClinicCommitLock(mutation, ()=>commitMutation(mutation));
            traceCommit("confirmed", mutation);
          }finally{
            state.activeOperationId = "";
          }
          if(result?.__reconciled && result?.state){
            state.baseline = normalizeState(result.state);
            state.versions = normalizeVersions(result.versions || {});
          }else{
            state.baseline = applyChanges(state.baseline, mutation.changes);
            state.versions = mergeServerVersions(state.versions, result?.versions || {});
          }
          state.queue.shift();
          persistQueue();
          resolveWaiter(mutation.operationId, true);
          emit("cronos:persistence-saved", { operationId:mutation.operationId, result });
          if(!suppressVisualFeedback) updateIndicator("saved", "Salvo");
        }catch(error){
          state.lastError = error;
          const conflict = isConflictError(error);
          console.error("Cronos V4: operação não confirmada.", error);

          const infrastructureBusy = isInfrastructureBusyError(error);
          const commitBusy = isCommitBusyError(error);
          traceCommit("failed", mutation, { code:String(error?.code || ""), infrastructureBusy, conflict, commitBusy });
          if(conflict){
            // Um pacote com versão antiga nunca é repetido. Quando o wrapper do
            // banco devolve o snapshot oficial, ele substitui a base local antes
            // de limpar a fila, evitando que um cliente antigo finja que salvou.
            const conflictPayload = error?.details;
            if(conflictPayload?.__reconciled && conflictPayload?.state){
              state.baseline = normalizeState(conflictPayload.state);
              state.versions = normalizeVersions(conflictPayload.versions || {});
            }
            archiveConflict(mutation, error);
            const affected = state.queue.splice(0);
            persistQueue();
            state.blocked = true;
            rebuildWorking();
            affected.forEach(item=>resolveWaiter(item.operationId, false));
          }else if(commitBusy){
            // A ação desta aba não chegou ao servidor. Removemos a cópia local,
            // revertemos a interface e exigimos atualização antes de tentar de novo.
            const affected = state.queue.splice(0);
            persistQueue();
            state.blocked = true;
            rebuildWorking();
            affected.forEach(item=>resolveWaiter(item.operationId, false));
          }else if(infrastructureBusy){
            // Timeout/504 têm resultado incerto: a chamada pode ainda estar sendo
            // finalizada no servidor. Nunca repetimos nem preservamos uma fila ativa
            // que ressuscitaria no próximo login. Arquivamos, revertimos a interface
            // e exigimos recarga para conferir o estado oficial.
            const affected = state.queue.splice(0);
            archiveUncertainMutations(affected, error, "INFRASTRUCTURE_TIMEOUT");
            persistQueue();
            state.blocked = true;
            rebuildWorking();
            affected.forEach(item=>resolveWaiter(item.operationId, false));
          }else if(mutation.keepPendingOnFailure === false){
            state.queue.shift();
            persistQueue();
            rebuildWorking();
            resolveWaiter(mutation.operationId, false);
          }else{
            state.blocked = true;
            resolveWaiter(mutation.operationId, false);
          }

          const wrapped = new CronosPersistenceError(
            conflict
              ? "Este registro foi alterado em outro computador. Recarregue antes de salvar novamente."
              : commitBusy
                ? "Outra aba já estava salvando esta clínica. A ação desta aba foi cancelada antes de chegar ao banco."
                : infrastructureBusy
                  ? "O banco demorou além do limite e a alteração não foi repetida automaticamente."
                  : "Não foi possível salvar a alteração.",
            {
              code:conflict ? "VERSION_CONFLICT" : (error?.code || "RPC_ERROR"),
              cause:error,
              operationId:mutation.operationId,
              details:error?.details || null,
              conflict
            }
          );
          state.lastError = wrapped;
          emit(conflict ? "cronos:persistence-conflict" : "cronos:persistence-error", { error:wrapped, mutation });
          if(!suppressVisualFeedback){
            updateIndicator(
              conflict || infrastructureBusy || commitBusy ? "error" : "pending",
              conflict
                ? "Conflito: recarregue a página"
                : commitBusy
                  ? "Outra aba está salvando"
                  : infrastructureBusy
                    ? "Tempo excedido: recarregue"
                    : "Não foi possível salvar"
            );
            notify(
              conflict
                ? "Alteração concorrente detectada"
                : commitBusy
                  ? "Outra aba está salvando"
                  : infrastructureBusy
                    ? "Salvamento não confirmado"
                    : "Alteração ainda não confirmada",
              conflict
                ? "Outro computador atualizou o mesmo registro. Recarregue a página para evitar sobrescrever dados."
                : commitBusy
                  ? "A ação desta aba foi cancelada antes do envio. Aguarde a outra aba terminar e recarregue os dados."
                  : infrastructureBusy
                    ? "O Cronos interrompeu a espera e não repetirá a operação sozinho. Recarregue para conferir o estado oficial antes de tentar novamente."
                    : "O Cronos preservou a tentativa neste computador. Confira sua conexão antes de sair."
            );
          }
          break;
        }
      }
    }finally{
      state.processing = false;
      if(!state.queue.length) emit("cronos:persistence-idle", {});
    }
  }

  async function enqueueChanges(changes, options={}){
    if(!state.enabled) return false;
    if(!state.loaded || !state.working){
      throw new CronosPersistenceError("Persistência V4 ainda não foi carregada.", { code:"V4_NOT_LOADED" });
    }
    if(state.activeOperationId){
      notify("Salvamento em andamento", "Aguarde a alteração atual ser confirmada antes de fazer outra ação.");
      return false;
    }
    if(state.blocked){
      notify("Alteração bloqueada", "Recarregue a página antes de fazer outra alteração. Nenhum dado antigo será sobrescrito.");
      return false;
    }
    if(!hasChanges(changes)) return true;

    const changedEntities = countChangedEntities(changes);
    if(changedEntities > MAX_BROWSER_MUTATION_ENTITIES && options.allowBulk !== true){
      const error = new CronosPersistenceError(
        `Alteração em massa bloqueada no navegador (${changedEntities} entidades).`,
        { code:"BULK_MUTATION_BLOCKED", details:{ changedEntities } }
      );
      state.lastError = error;
      console.error("Cronos V4: autosave em massa bloqueado para proteger o banco.", error);
      updateIndicator("error", "Atualização em massa bloqueada");
      notify("Atualização automática bloqueada", "Os dados carregaram, mas o navegador tentou reenviar a clínica inteira. Recarregue após atualizar o Cronos.");
      emit("cronos:persistence-error", { error, mutation:null });
      return false;
    }

    const operationId = options.operationId || newOperationId();
    const mutation = {
      operationId,
      changes,
      keepPendingOnFailure:options.keepPendingOnFailure !== false,
      source:String(options.source || options.reason || "frontend_action"),
      suppressVisualFeedback:options.suppressVisualFeedback === true,
      createdAt:new Date().toISOString()
    };

    state.queue.push(mutation);
    state.working = applyChanges(state.working, changes);
    state.workingVersions = predictVersions(state.workingVersions, changes);
    if(!persistQueue()){
      state.queue = state.queue.filter(item=>item.operationId !== operationId);
      rebuildWorking();
      updateIndicator("error", "Não foi possível preparar o salvamento");
      return false;
    }

    if(state.blocked){
      notify("Alteração preservada localmente", "A fila está bloqueada por uma falha anterior. Recarregue quando a conexão estiver estável.");
      return false;
    }

    const promise = new Promise(resolve=>{
      state.waiters.set(operationId, { resolve });
    });
    processQueue();
    return promise;
  }

  async function saveOperationalState(db, options={}){
    if(!state.enabled) return false;
    if(!state.loaded || !state.working){
      throw new CronosPersistenceError("Persistência V4 ainda não foi carregada.", { code:"V4_NOT_LOADED" });
    }
    const current = normalizeState(db);
    const changes = buildChanges(state.working, current, state.workingVersions);
    return enqueueChanges(changes, options);
  }

  async function updateMeta(patch, options={}){
    if(!state.enabled || !state.loaded || !state.working){
      throw new CronosPersistenceError("Persistência V4 ainda não foi carregada.", { code:"V4_NOT_LOADED" });
    }
    if(!patch || typeof patch !== "object" || Array.isArray(patch)){
      throw new CronosPersistenceError("Metadados inválidos para salvar.", { code:"INVALID_META_PATCH" });
    }

    const meta = metaFromState(state.working);
    Object.keys(patch).forEach(key=>{
      const value = patch[key];
      if(value === undefined) delete meta[key];
      else meta[key] = clone(value);
    });

    return enqueueChanges({
      meta:{
        payload:meta,
        expected_version:Number(state.workingVersions?.meta || 0)
      }
    }, options);
  }

  async function updateSettings(patch, options={}){
    if(!patch || typeof patch !== "object" || Array.isArray(patch)){
      throw new CronosPersistenceError("Configurações inválidas para salvar.", { code:"INVALID_SETTINGS_PATCH" });
    }

    const currentMeta = metaFromState(state.working || freshState());
    const settings = currentMeta.settings && typeof currentMeta.settings === "object" && !Array.isArray(currentMeta.settings)
      ? clone(currentMeta.settings)
      : {};

    Object.keys(patch).forEach(key=>{
      const value = patch[key];
      if(value === undefined) delete settings[key];
      else settings[key] = clone(value);
    });

    return updateMeta({ settings }, options);
  }

  async function upsertTask(task, options={}){
    const payload = clone(task || {});
    const id = String(payload?.id || "").trim();
    if(!id){
      throw new CronosPersistenceError("Tarefa inválida para salvar.", { code:"INVALID_TASK_ID" });
    }
    const expected = Number(state.workingVersions?.tasks?.[id] || 0);
    return enqueueChanges({
      tasks:{ upserts:[{ payload, expected_version:expected }], deletes:[] }
    }, options);
  }

  async function deleteTask(taskId, options={}){
    const id = String(taskId || "").trim();
    if(!id){
      throw new CronosPersistenceError("Tarefa inválida para excluir.", { code:"INVALID_TASK_ID" });
    }
    const expected = Number(state.workingVersions?.tasks?.[id] || 0);
    return enqueueChanges({
      tasks:{ upserts:[], deletes:[{ id, expected_version:expected }] }
    }, options);
  }

  function buildTargetedBatchChanges(batch){
    if(!batch || typeof batch !== "object" || Array.isArray(batch)){
      throw new CronosPersistenceError("Pacote direcionado inválido.", { code:"INVALID_TARGETED_BATCH" });
    }

    const changes = {};
    COLLECTIONS.forEach(name=>{
      const part = batch[name];
      if(!part) return;

      const upsertMap = new Map();
      (Array.isArray(part.upserts) ? part.upserts : []).forEach(item=>{
        const payload = clone(item?.payload && typeof item.payload === "object" ? item.payload : item);
        const id = String(payload?.id || "").trim();
        if(!id){
          throw new CronosPersistenceError(`Entidade ${name} sem ID no pacote direcionado.`, { code:"INVALID_TARGETED_ENTITY" });
        }
        upsertMap.set(id, payload);
      });

      const deleteSet = new Set();
      (Array.isArray(part.deletes) ? part.deletes : []).forEach(item=>{
        const id = String(typeof item === "string" ? item : (item?.id || "")).trim();
        if(!id){
          throw new CronosPersistenceError(`Exclusão ${name} sem ID no pacote direcionado.`, { code:"INVALID_TARGETED_DELETE" });
        }
        deleteSet.add(id);
      });

      upsertMap.forEach((_, id)=>{
        if(deleteSet.has(id)){
          throw new CronosPersistenceError(`A entidade ${name}/${id} não pode ser salva e excluída na mesma ação.`, { code:"TARGETED_BATCH_COLLISION" });
        }
      });

      const upserts = Array.from(upsertMap.entries()).map(([id, payload])=>({
        payload,
        expected_version:Number(state.workingVersions?.[name]?.[id] || 0)
      }));
      const deletes = Array.from(deleteSet).map(id=>({
        id,
        expected_version:Number(state.workingVersions?.[name]?.[id] || 0)
      }));

      if(upserts.length || deletes.length) changes[name] = { upserts, deletes };
    });

    if(batch.meta && typeof batch.meta === "object" && !Array.isArray(batch.meta)){
      const payload = clone(
        batch.meta.payload && typeof batch.meta.payload === "object" && !Array.isArray(batch.meta.payload)
          ? batch.meta.payload
          : batch.meta
      );
      changes.meta = {
        payload,
        expected_version:Number(state.workingVersions?.meta || 0)
      };
    }

    return changes;
  }

  async function commitTargetedBatch(batch, options={}){
    if(!state.enabled || !state.loaded || !state.working){
      throw new CronosPersistenceError("Persistência V4 ainda não foi carregada.", { code:"V4_NOT_LOADED" });
    }
    const changes = buildTargetedBatchChanges(batch);
    return enqueueChanges(changes, options);
  }

  async function mergeContactsCascade(batch, options={}){
    if(!state.enabled || !state.loaded || !state.working){
      throw new CronosPersistenceError("Persistência V4 ainda não foi carregada.", { code:"V4_NOT_LOADED" });
    }
    if(state.blocked){
      throw new CronosPersistenceError(
        "Existe uma alteração com conflito. Recarregue a página antes de mesclar.",
        { code:"PERSISTENCE_BLOCKED" }
      );
    }
    if(state.processing || state.queue.length || state.activeOperationId){
      await waitUntilIdle({ timeoutMs:Number(options.waitTimeoutMs || 12000) });
    }

    const changes = buildTargetedBatchChanges(batch);
    const contactUpserts = changes?.contacts?.upserts || [];
    const contactDeletes = changes?.contacts?.deletes || [];
    if(contactUpserts.length !== 1 || contactDeletes.length !== 1){
      throw new CronosPersistenceError(
        "A mesclagem deve conter exatamente um contato principal e um contato duplicado.",
        { code:"INVALID_MERGE_BATCH" }
      );
    }

    const primaryContactId = String(contactUpserts[0]?.payload?.id || "").trim();
    const secondaryContactId = String(contactDeletes[0]?.id || "").trim();
    if(!primaryContactId || !secondaryContactId || primaryContactId === secondaryContactId){
      throw new CronosPersistenceError("Contatos inválidos para mesclagem.", { code:"INVALID_MERGE_CONTACTS" });
    }

    const operationId = String(options.operationId || newOperationId());
    updateIndicator("saving", "Mesclando...");
    emit("cronos:persistence-saving", {
      operationId,
      command:"merge_contacts_cascade",
      primaryContactId,
      secondaryContactId
    });

    try{
      const lockMutation = { operationId, source:"merge_contacts_cascade" };
      state.activeOperationId = operationId;
      traceCommit("dispatch", lockMutation);
      let result;
      try{
        result = await withClinicCommitLock(lockMutation, ()=>rpc("cronos_v4_merge_contacts", {
          p_clinic_id:state.clinicId,
          p_operation_id:operationId,
          p_changes:changes
        }, { timeoutMs:MERGE_TIMEOUT_MS }));
        traceCommit("confirmed", lockMutation);
      }catch(error){
        traceCommit("failed", lockMutation, { code:String(error?.code || "") });
        throw error;
      }finally{
        state.activeOperationId = "";
      }

      if(result?.ok === false){
        throw new CronosPersistenceError(
          String(result?.message || "O servidor recusou a mesclagem."),
          {
            code:String(result?.code || "MERGE_SERVER_REJECTED"),
            operationId,
            details:result?.detail || result?.details || null,
            conflict:result?.conflict === true
          }
        );
      }

      // Mesclagem é uma ação destrutiva e rara. Não aceitamos mais apenas o
      // retorno da RPC como prova: antes de exibir sucesso, recarregamos o
      // estado oficial e confirmamos que o cadastro duplicado realmente saiu.
      // Isso elimina o falso positivo em que a UI dizia "Mesclado" e, ao
      // reabrir o Lead, o duplicado reaparecia.
      let official;
      try{
        official = await fetchOfficialSnapshot();
      }catch(verifyError){
        const wrappedVerify = new CronosPersistenceError(
          "A mesclagem foi enviada, mas o Cronos não conseguiu confirmar o resultado no servidor. Recarregue a página antes de tentar novamente.",
          {
            code:"MERGE_VERIFICATION_UNAVAILABLE",
            cause:verifyError,
            operationId
          }
        );
        throw wrappedVerify;
      }

      if(!official){
        throw new CronosPersistenceError(
          "O servidor não devolveu o estado oficial após a mesclagem.",
          { code:"MERGE_VERIFICATION_EMPTY", operationId }
        );
      }

      const officialState = normalizeState(official.state || freshState());
      const primaryExists = officialState.contacts.some(c=>String(c?.id || "") === primaryContactId);
      const secondaryExists = officialState.contacts.some(c=>String(c?.id || "") === secondaryContactId);
      const danglingEntries = officialState.entries
        .filter(e=>String(e?.contactId || "") === secondaryContactId)
        .map(e=>String(e?.id || ""))
        .filter(Boolean);

      if(!primaryExists || secondaryExists || danglingEntries.length){
        throw new CronosPersistenceError(
          secondaryExists
            ? "O servidor respondeu à mesclagem, mas o cadastro duplicado ainda existe. O Cronos não vai marcar a operação como concluída."
            : (!primaryExists
              ? "O servidor não confirmou o cadastro principal após a mesclagem."
              : "Ainda existem Leads vinculados ao cadastro duplicado após a mesclagem."),
          {
            code:"MERGE_NOT_PERSISTED",
            operationId,
            details:{ primaryContactId, secondaryContactId, primaryExists, secondaryExists, danglingEntries }
          }
        );
      }

      // A partir daqui, a tela passa a usar exatamente o snapshot que o banco
      // devolveu, em vez de uma projeção local da operação.
      state.baseline = officialState;
      state.versions = normalizeVersions(official.versions || {});
      rebuildWorking();

      state.lastError = null;
      state.blocked = false;
      emit("cronos:persistence-saved", {
        operationId,
        command:"merge_contacts_cascade",
        primaryContactId,
        secondaryContactId,
        result
      });
      updateIndicator("saved", "Mesclado");

      return {
        ...(result && typeof result === "object" ? result : {}),
        ok:result?.ok !== false,
        operationId,
        state:clone(state.working),
        versions:clone(state.workingVersions)
      };
    }catch(error){
      const conflict = isConflictError(error);
      const confirmationTimeout = String(error?.code || "").toUpperCase() === "RPC_TIMEOUT";
      const missingRpc = /cronos_v4_merge_contacts|schema cache|function/i.test(String(error?.message || ""))
        && /not found|could not find|schema cache/i.test(String(error?.message || ""));
      const wrapped = new CronosPersistenceError(
        conflict
          ? "Um dos cadastros foi alterado em outro computador. Recarregue antes de mesclar."
          : missingRpc
            ? "A rotina SQL de mesclagem ainda não foi instalada no Supabase."
            : confirmationTimeout
              ? "A confirmação da mesclagem demorou além do esperado. Recarregue a página para conferir o resultado antes de tentar novamente."
              : String(error?.message || "Não foi possível mesclar os cadastros."),
        {
          code:conflict
            ? "VERSION_CONFLICT"
            : (missingRpc
              ? "MERGE_RPC_NOT_INSTALLED"
              : (confirmationTimeout ? "MERGE_CONFIRMATION_TIMEOUT" : (error?.code || "MERGE_CASCADE_ERROR"))),
          cause:error,
          operationId,
          details:error?.details || null,
          conflict
        }
      );
      state.lastError = wrapped;
      emit(conflict ? "cronos:persistence-conflict" : "cronos:persistence-error", {
        error:wrapped,
        command:"merge_contacts_cascade",
        primaryContactId,
        secondaryContactId
      });
      updateIndicator("error", conflict ? "Conflito: recarregue a página" : (confirmationTimeout ? "Confirmação pendente: recarregue" : "Falha ao mesclar"));
      throw wrapped;
    }
  }

  function adoptHydratedState(db, options={}){
    if(!state.enabled || !state.loaded) return false;
    if(state.processing || state.queue.length || state.activeOperationId){
      console.warn("Cronos V4: estado hidratado não foi adotado porque existe alteração pendente.");
      return false;
    }

    const normalized = normalizeState(db);
    state.baseline = clone(normalized);
    state.working = clone(normalized);
    state.workingVersions = normalizeVersions(state.versions);
    state.blocked = false;
    state.lastError = null;

    if(options.clearIndicator !== false){
      try{ updateIndicator("saved", "Salvo"); }catch(_){ }
    }
    emit("cronos:persistence-hydrated", { reason:String(options.reason || "client_normalization") });
    return true;
  }

  async function deleteLeadCascade(leadId, options={}){
    const id = String(leadId || "").trim();
    if(!id){
      throw new CronosPersistenceError("Lead inválido para exclusão.", { code:"INVALID_LEAD_ID" });
    }
    if(!state.enabled || !state.loaded || !state.working){
      throw new CronosPersistenceError("Persistência V4 ainda não foi carregada.", { code:"V4_NOT_LOADED" });
    }
    if(state.processing || state.queue.length || state.blocked || state.activeOperationId){
      throw new CronosPersistenceError(
        "Existe outra alteração sendo salva. Aguarde antes de excluir.",
        { code:"PENDING_MUTATION" }
      );
    }

    const lead = (state.working.entries || []).find(item=>String(item?.id || "") === id);
    if(!lead){
      throw new CronosPersistenceError("Lead não encontrado no estado confirmado.", { code:"LEAD_NOT_FOUND" });
    }

    const contactId = String(lead?.contactId || "").trim();
    const expectedLeadVersion = Number(state.workingVersions?.entries?.[id] || 0);
    const expectedContactVersion = contactId
      ? Number(state.workingVersions?.contacts?.[contactId] || 0)
      : null;

    if(expectedLeadVersion < 1){
      throw new CronosPersistenceError("A versão do Lead não foi carregada. Recarregue a página.", { code:"LEAD_VERSION_MISSING" });
    }

    const operationId = String(options.operationId || newOperationId());
    updateIndicator("saving", "Excluindo...");
    emit("cronos:persistence-saving", { operationId, command:"delete_lead_cascade" });

    try{
      const lockMutation = { operationId, source:"delete_lead_cascade" };
      state.activeOperationId = operationId;
      traceCommit("dispatch", lockMutation);
      let result;
      try{
        result = await withClinicCommitLock(lockMutation, ()=>rpc("cronos_v4_delete_lead_cascade", {
          p_clinic_id:state.clinicId,
          p_lead_id:id,
          p_expected_lead_version:expectedLeadVersion,
          p_expected_contact_version:expectedContactVersion,
          p_operation_id:operationId
        }));
        traceCommit("confirmed", lockMutation);
      }catch(error){
        traceCommit("failed", lockMutation, { code:String(error?.code || "") });
        throw error;
      }finally{
        state.activeOperationId = "";
      }

      // O comando pode apagar entidades que não estavam no diff local. Por isso
      // a interface sempre recarrega o estado oficial após a confirmação.
      const refreshed = await loadOperationalState({
        clinicId:state.clinicId,
        restorePending:false
      });

      state.lastError = null;
      state.blocked = false;
      emit("cronos:persistence-saved", {
        operationId,
        command:"delete_lead_cascade",
        result
      });
      updateIndicator("saved", "Excluído");

      return {
        ...(result && typeof result === "object" ? result : {}),
        ok:result?.ok !== false,
        state:clone(refreshed?.state || state.working),
        versions:clone(refreshed?.versions || state.workingVersions)
      };
    }catch(error){
      const conflict = isConflictError(error);
      const wrapped = new CronosPersistenceError(
        conflict
          ? "Este Lead foi alterado em outro computador. Recarregue antes de excluir."
          : String(error?.message || "Não foi possível excluir."),
        {
          code:conflict ? "VERSION_CONFLICT" : (error?.code || "DELETE_CASCADE_ERROR"),
          cause:error,
          operationId,
          details:error?.details || null,
          conflict
        }
      );
      state.lastError = wrapped;
      emit(conflict ? "cronos:persistence-conflict" : "cronos:persistence-error", {
        error:wrapped,
        command:"delete_lead_cascade",
        leadId:id
      });
      updateIndicator("error", conflict ? "Conflito: recarregue a página" : "Falha ao excluir");
      throw wrapped;
    }
  }

  function setClient(client){ state.client = client || null; }

  function setClinicId(clinicId){
    const next = String(clinicId || "").trim();
    if(next === state.clinicId) return;
    state.clinicId = next;
    state.enabled = false;
    state.loaded = false;
    state.baseline = null;
    state.working = null;
    state.versions = emptyVersions();
    state.workingVersions = emptyVersions();
    state.queue = [];
    state.processing = false;
    state.blocked = false;
    state.activeOperationId = "";
    operationalLoadPromise = null;
    operationalLoadClinicId = "";
  }

  function clearContext(){ setClinicId(""); }
  function isEnabled(){ return state.enabled === true; }
  function hasPending(){ return state.queue.length > 0 || state.processing || Boolean(state.activeOperationId); }

  async function waitUntilIdle(options={}){
    const timeoutMs = Math.max(500, Number(options.timeoutMs || 12000));
    const startedAt = Date.now();
    if(state.blocked){
      throw new CronosPersistenceError(
        "Existe uma alteração com conflito. Recarregue a página antes de continuar.",
        { code:"PERSISTENCE_BLOCKED" }
      );
    }
    while(state.processing || state.queue.length || state.activeOperationId){
      if(state.blocked){
        throw new CronosPersistenceError(
          "Existe uma alteração com conflito. Recarregue a página antes de continuar.",
          { code:"PERSISTENCE_BLOCKED" }
        );
      }
      if(Date.now() - startedAt >= timeoutMs){
        throw new CronosPersistenceError(
          "O salvamento anterior ainda não terminou. Aguarde alguns segundos e tente novamente.",
          { code:"PENDING_MUTATION_TIMEOUT" }
        );
      }
      try{ updateIndicator("saving", "Finalizando alteração anterior..."); }catch(_){ }
      await sleep(120);
    }
    return { ok:true };
  }

  function discardPending(){
    state.queue = [];
    state.blocked = false;
    persistQueue();
    rebuildWorking();
    emit("cronos:persistence-idle", {});
  }

  function retryPending(){
    // Compatibilidade segura: versões antigas chamavam este método pelo botão
    const affected = state.queue.splice(0);
    if(affected.length){
      archiveUncertainMutations(
        affected,
        { code:"MANUAL_RETRY_DISABLED", message:"Reenvio manual desativado para impedir loops." },
        "MANUAL_RETRY_QUARANTINED"
      );
    }
    persistQueue();
    state.blocked = false;
    rebuildWorking();
    affected.forEach(item=>resolveWaiter(item.operationId, false));
    emit("cronos:persistence-idle", { quarantined:affected.length, retryDisabled:true });
    return Promise.resolve({ ok:false, retryDisabled:true, quarantined:affected.length });
  }

  function diagnostics(){
    return {
      version:"4.9.1",
      tabId:TAB_ID,
      clinicId:state.clinicId,
      enabled:state.enabled,
      loaded:state.loaded,
      pending:state.queue.length,
      processing:state.processing,
      blocked:state.blocked,
      activeOperationId:state.activeOperationId,
      lastError:state.lastError ? String(state.lastError.message || state.lastError) : null,
      archivedConflicts:getConflictArchive().length,
      archivedUncertain:getUncertainArchive().length
    };
  }

  try{
    global.addEventListener("beforeunload", event=>{
      if(hasPending()){
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }catch(_){ }

  global.CronosRepository = Object.freeze({
    __cronosRepositoryVersion:"4.9.1",
    __tabId:TAB_ID,
    CronosPersistenceError,
    setClient,
    setClinicId,
    clearContext,
    checkStatus,
    loadOperationalState,
    saveOperationalState,
    updateMeta,
    updateSettings,
    upsertTask,
    deleteTask,
    commitTargetedBatch,
    mergeContactsCascade,
    adoptHydratedState,
    deleteLeadCascade,
    isEnabled,
    hasPending,
    waitUntilIdle,
    retryPending,
    discardPending,
    getConflictArchive,
    clearConflictArchive,
    getUncertainArchive,
    clearUncertainArchive,
    newOperationId,
    diagnostics
  });
})(window);
