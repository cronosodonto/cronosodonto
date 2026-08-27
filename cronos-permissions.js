(function(){
  'use strict';

  const VERSION = 'v463.2.4-rc5.19-acl-resilient';
  const ROLES = ['MASTER','GERENTE','SECRETARIA','CRC','DENTISTA'];

  // Digital) só entram no catálogo quando forem promovidos da fase de teste.
  const CATALOG = [
    {key:'dashboard.view', module:'dashboard', label:'Dashboard', group:'Módulos'},
    {key:'todayCronos.view', module:'todayCronos', label:'Hoje no Cronos', group:'Módulos'},
    {key:'leads.view', module:'leads', label:'Leads', group:'Módulos'},
    {key:'kanban.view', module:'kanban', label:'Funil', group:'Módulos'},
    {key:'tasks.view', module:'tasks', label:'Tarefas', group:'Módulos'},
    {key:'installments.view', module:'installments', label:'Recebimentos', group:'Módulos'},
    {key:'creditSimulator.view', module:'creditSimulator', label:'Simulador de Crédito', group:'Módulos'},
    {key:'performance.view', module:'performance', label:'Performance', group:'Módulos'},
    {key:'users.view', module:'users', label:'Usuários', group:'Módulos'},
    {key:'settings.view', module:'settings', label:'Configurações', group:'Módulos'},
    {key:'records.edit', module:'system', label:'Editar registros', group:'Ações'},
    {key:'records.delete', module:'system', label:'Excluir registros', group:'Ações'},
    {key:'installments.manage', module:'installments', label:'Criar e alterar recebimentos', group:'Ações'},
    {key:'financial.sensitive', module:'installments', label:'Ações financeiras sensíveis', group:'Ações'},
    {key:'tasks.delete', module:'tasks', label:'Excluir tarefas', group:'Ações'},
    {key:'ficha.edit', module:'leads', label:'Alterar ficha / prontuário', group:'Ações'},
    {key:'leads.delete', module:'leads', label:'Excluir contatos e leads', group:'Ações'},
    {key:'users.manage', module:'users', label:'Gerenciar usuários', group:'Ações'},
    {key:'masters.manage', module:'users', label:'Gerenciar Masters', group:'Ações'},
    {key:'exam.view', module:'exam', label:'Visualizar Exame Digital', group:'Exame Digital'},
    {key:'exam.capture', module:'exam', label:'Capturar / importar imagens', group:'Exame Digital'},
    {key:'exam.delete', module:'exam', label:'Excluir imagens', group:'Exame Digital'}
  ];

  const ROLE_DEFAULTS = {
    MASTER: {
      'dashboard.view':true,'todayCronos.view':true,'leads.view':true,'kanban.view':true,'tasks.view':true,
      'installments.view':true,'creditSimulator.view':true,'performance.view':true,'users.view':true,'settings.view':true,
      'records.edit':true,'records.delete':true,'installments.manage':true,'financial.sensitive':true,'tasks.delete':true,'ficha.edit':true,'leads.delete':true,'users.manage':true,'masters.manage':false,
      'exam.view':true,'exam.capture':true,'exam.delete':true
    },
    GERENTE: {
      'dashboard.view':true,'todayCronos.view':true,'leads.view':true,'kanban.view':true,'tasks.view':true,
      'installments.view':true,'creditSimulator.view':true,'performance.view':true,'users.view':true,'settings.view':true,
      'records.edit':true,'records.delete':true,'installments.manage':true,'financial.sensitive':true,'tasks.delete':true,'ficha.edit':true,'leads.delete':true,'users.manage':false,'masters.manage':false,
      'exam.view':true,'exam.capture':false,'exam.delete':false
    },
    SECRETARIA: {
      'dashboard.view':false,'todayCronos.view':true,'leads.view':true,'kanban.view':true,'tasks.view':true,
      'installments.view':true,'creditSimulator.view':false,'performance.view':false,'users.view':false,'settings.view':false,
      'records.edit':true,'records.delete':true,'installments.manage':true,'financial.sensitive':false,'tasks.delete':false,'ficha.edit':true,'leads.delete':true,'users.manage':false,'masters.manage':false,
      'exam.view':true,'exam.capture':false,'exam.delete':false
    },
    CRC: {
      'dashboard.view':false,'todayCronos.view':true,'leads.view':true,'kanban.view':true,'tasks.view':true,
      'installments.view':false,'creditSimulator.view':false,'performance.view':false,'users.view':false,'settings.view':false,
      'records.edit':true,'records.delete':false,'installments.manage':false,'financial.sensitive':false,'tasks.delete':false,'ficha.edit':false,'leads.delete':false,'users.manage':false,'masters.manage':false,
      'exam.view':true,'exam.capture':false,'exam.delete':false
    },
    DENTISTA: {
      'dashboard.view':false,'todayCronos.view':false,'leads.view':true,'kanban.view':true,'tasks.view':false,
      'installments.view':false,'creditSimulator.view':false,'performance.view':false,'users.view':false,'settings.view':false,
      'records.edit':false,'records.delete':false,'installments.manage':false,'financial.sensitive':false,'tasks.delete':false,'ficha.edit':false,'leads.delete':false,'users.manage':false,'masters.manage':false,
      'exam.view':true,'exam.capture':true,'exam.delete':true
    }
  };

  const MODULE_PERMISSION = {
    dashboard:'dashboard.view', todayCronos:'todayCronos.view', leads:'leads.view', kanban:'kanban.view', tasks:'tasks.view',
    installments:'installments.view', creditSimulator:'creditSimulator.view', performance:'performance.view',
    users:'users.view', settings:'settings.view'
  };

  let effective = null;
  let source = 'default';
  let actorKey = '';
  let loaded = false;
  let validated = false;
  let revision = 0;
  let lastDiagnostic = null;

  function setDiagnostic(value={}){
    try{
      lastDiagnostic = JSON.parse(JSON.stringify({ at:new Date().toISOString(), ...value }));
    }catch(_){
      lastDiagnostic = { at:new Date().toISOString(), phase:String(value?.phase || 'unknown') };
    }
  }

  function emitAclUpdated(reason){
    revision += 1;
    const detail = Object.freeze({
      revision,
      reason:String(reason || 'changed'),
      source,
      loaded:loaded === true,
      validated:validated === true
    });
    try{
      document.dispatchEvent(new CustomEvent('cronos:acl-updated', { detail }));
    }catch(_){
      try{
        const event = document.createEvent('CustomEvent');
        event.initCustomEvent('cronos:acl-updated', false, false, detail);
        document.dispatchEvent(event);
      }catch(__){ }
    }
  }

  function roleKey(role){
    const key = String(role || '').trim().toUpperCase();
    return ROLES.includes(key) ? key : 'DENTISTA';
  }
  function cloneDefault(role){ return {...(ROLE_DEFAULTS[roleKey(role)] || ROLE_DEFAULTS.DENTISTA)}; }
  function denyAll(){ return Object.fromEntries(CATALOG.map(item=>[item.key,false])); }

  function cacheKey(actor){
    const clinic = String(window.CLOUD_CLINIC_OWNER_UID || window.CLOUD_OWNER_UID || '').trim();
    const uid = String(actor?.authUid || actor?.id || '').trim();
    return `cronos_acl_v462::${clinic || 'clinic'}::${uid || roleKey(actor?.role)}`;
  }
  function readCache(actor){
    try{
      const raw = localStorage.getItem(cacheKey(actor));
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      if(!parsed || typeof parsed.permissions !== 'object') return null;
      return parsed;
    }catch(_){ return null; }
  }
  function writeCache(actor, permissions, resolvedSource){
    try{ localStorage.setItem(cacheKey(actor), JSON.stringify({savedAt:Date.now(),role:roleKey(actor?.role),source:resolvedSource||'remote',permissions})); }catch(_){ }
  }

  function setEffective(actor, permissions, resolvedSource, options={}){
    const base = options.trustedRoleDefaults === true ? cloneDefault(actor?.role) : denyAll();
    effective = {...base};
    if(permissions && typeof permissions === 'object'){
      Object.keys(permissions).forEach(k => {
        if(Object.prototype.hasOwnProperty.call(base,k)) effective[k] = permissions[k] === true;
      });
    }
    source = resolvedSource || 'default';
    actorKey = `${roleKey(actor?.role)}:${actor?.id || actor?.authUid || ''}`;
    loaded = true;
    validated = resolvedSource === 'database' || resolvedSource === 'trusted-support';
    emitAclUpdated(options.reason || resolvedSource || 'changed');
    return effective;
  }

  function permissionMapFromRpcRows(rows){
    const map = {};
    (Array.isArray(rows)?rows:[]).forEach(row=>{
      const key=String(row?.permission_key||row?.key||'').trim();
      if(key) map[key]=row?.allowed===true||row?.enabled===true;
    });
    return map;
  }

  async function hydrateForActor(actor, options={}){
    if(!actor) throw new Error('Ator ausente ao resolver permissões.');
    const key=`${roleKey(actor.role)}:${actor.id||actor.authUid||''}`;
    if(validated && loaded && actorKey===key && options.force!==true){
      emitAclUpdated('hydrate-current');
      return effective;
    }

    // O cache local nunca concede acesso. Ele é mantido apenas como diagnóstico e
    // é substituído depois que a RPC confirma a ACL da sessão atual.
    setEffective(actor,null,'unvalidated',{reason:'hydrate-start'});

    try{
      const client=(typeof supabaseClient!=='undefined'&&supabaseClient)?supabaseClient:window.supabaseClient;
      if(!client||typeof client.rpc!=='function') throw new Error('Cliente de permissões indisponível.');
      const loadRows=async()=>{
        const response=await client.rpc('cronos_get_my_permissions');
        const {data,error}=response||{};
        if(error){
          const wrapped=error instanceof Error?error:new Error(String(error?.message||error||'Falha ao validar permissões.'));
          try{
            if(error?.code) wrapped.code=error.code;
            const status=Number(response?.status||error?.status||0);
            if(Number.isFinite(status)&&status>0) wrapped.httpStatus=status;
          }catch(_){ }
          throw wrapped;
        }
        const rows=Array.isArray(data)?data:(Array.isArray(data?.permissions)?data.permissions:[]);
        if(!rows.length){
          const contractError=new Error('A RPC não retornou a matriz de permissões.');
          contractError.code='ACL_EMPTY_RESPONSE';
          throw contractError;
        }
        return rows;
      };
      const retry=typeof window.CRONOS_RUN_SAFE_READ_WITH_RETRY==='function'
        ? window.CRONOS_RUN_SAFE_READ_WITH_RETRY
        : async operation=>await operation({attempt:1,maxAttempts:1});
      const rows=await retry(loadRows,{
        label:'acl-permissions',
        maxAttempts:3,
        refreshSessionOnUnauthorized:true,
        onRetry:({attempt,error})=>setDiagnostic({
          phase:'retrying',
          attempt,
          code:String(error?.code||error?.name||''),
          message:String(error?.message||error||'Falha temporária.')
        })
      });
      setEffective(actor,permissionMapFromRpcRows(rows),'database',{reason:'hydrate-valid'});
      writeCache(actor,effective,'database');
      setDiagnostic({phase:'validated',source:'database',permissions:rows.length});
      return effective;
    }catch(error){
      setEffective(actor,null,'unavailable',{reason:'hydrate-unavailable'});
      try{ localStorage.removeItem(cacheKey(actor)); }catch(_){ }
      setDiagnostic({
        phase:'failed',
        code:String(error?.code||error?.name||''),
        attempts:Number(error?.cronosAttempts||1),
        message:String(error?.message||error||'Falha desconhecida.')
      });
      console.error('Cronos ACL V463.2.4: validação indisponível; acesso negado.',error?.message||error);
      throw error;
    }
  }

  function useTrustedRoleDefaultsForSupport(actor){
    if(!actor || actor.isSupport !== true) throw new Error('Contexto de suporte inválido.');
    return setEffective(actor,cloneDefault(actor.role),'trusted-support',{trustedRoleDefaults:true});
  }

  function reset(options={}){
    if(options.clearCache === true){
      try{
        for(let i=localStorage.length-1;i>=0;i--){
          const key=localStorage.key(i);
          if(key && key.startsWith('cronos_acl_v462::')) localStorage.removeItem(key);
        }
      }catch(_){ }
    }
    effective=null;
    source='unvalidated';
    actorKey='';
    loaded=false;
    validated=false;
    lastDiagnostic=null;
    emitAclUpdated('reset');
  }

  function getMap(){ return effective || denyAll(); }
  function can(permissionKey,actor){
    const key=String(permissionKey||'').trim();
    return !!key && getMap(actor?.role)[key]===true;
  }
  function canModule(moduleKey,actor){
    const permission=MODULE_PERMISSION[String(moduleKey||'')];
    return permission ? can(permission,actor) : false;
  }
  function legacyPerms(role,options={}){
    const map=getMap(role);
    const views=Object.entries(MODULE_PERMISSION).filter(([,perm])=>map[perm]===true).map(([module])=>module);
    return {
      viewAll:true,
      edit:map['records.edit']===true,
      delete:map['records.delete']===true,
      manageUsers:map['users.manage']===true,
      manageMasters:options.primaryMaster===true ? true : map['masters.manage']===true,
      views
    };
  }

  window.CronosPermissions={
    VERSION,ROLES,CATALOG,ROLE_DEFAULTS,MODULE_PERMISSION,
    hydrateForActor,useTrustedRoleDefaultsForSupport,reset,can,canModule,legacyPerms,
    defaultsForRole:cloneDefault,
    getCatalog:()=>CATALOG.map(x=>({...x})),
    getRoleDefaults:()=>Object.fromEntries(ROLES.map(role=>[role,cloneDefault(role)])),
    getEffectiveMap:()=>({...getMap()}),getSource:()=>source,isValidated:()=>validated===true,getRevision:()=>revision,
    getDiagnostics:()=>lastDiagnostic?{...lastDiagnostic}:null
  };
})();
