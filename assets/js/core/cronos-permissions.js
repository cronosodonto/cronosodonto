(function(){
  'use strict';

  const VERSION = 'v462.3-final-candidate';
  const ROLES = ['MASTER','GERENTE','SECRETARIA','CRC','DENTISTA'];

  // V462.1 cobre a matriz que já existia na V460. Recursos novos (como Exame
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
    {key:'masters.manage', module:'users', label:'Gerenciar Masters', group:'Ações'}
  ];

  // Espelha a V460, com a única correção já aprovada: Dentista sem Dashboard.
  const ROLE_DEFAULTS = {
    MASTER: {
      'dashboard.view':true,'todayCronos.view':true,'leads.view':true,'kanban.view':true,'tasks.view':true,
      'installments.view':true,'creditSimulator.view':true,'performance.view':true,'users.view':true,'settings.view':true,
      'records.edit':true,'records.delete':true,'installments.manage':true,'financial.sensitive':true,'tasks.delete':true,'ficha.edit':true,'leads.delete':true,'users.manage':true,'masters.manage':false
    },
    GERENTE: {
      'dashboard.view':true,'todayCronos.view':true,'leads.view':true,'kanban.view':true,'tasks.view':true,
      'installments.view':true,'creditSimulator.view':true,'performance.view':true,'users.view':true,'settings.view':true,
      'records.edit':true,'records.delete':true,'installments.manage':true,'financial.sensitive':true,'tasks.delete':true,'ficha.edit':true,'leads.delete':true,'users.manage':false,'masters.manage':false
    },
    SECRETARIA: {
      'dashboard.view':false,'todayCronos.view':true,'leads.view':true,'kanban.view':true,'tasks.view':true,
      'installments.view':true,'creditSimulator.view':false,'performance.view':false,'users.view':false,'settings.view':false,
      'records.edit':true,'records.delete':true,'installments.manage':true,'financial.sensitive':false,'tasks.delete':false,'ficha.edit':true,'leads.delete':true,'users.manage':false,'masters.manage':false
    },
    CRC: {
      'dashboard.view':false,'todayCronos.view':true,'leads.view':true,'kanban.view':true,'tasks.view':true,
      'installments.view':false,'creditSimulator.view':false,'performance.view':false,'users.view':false,'settings.view':false,
      'records.edit':true,'records.delete':false,'installments.manage':false,'financial.sensitive':false,'tasks.delete':false,'ficha.edit':false,'leads.delete':false,'users.manage':false,'masters.manage':false
    },
    DENTISTA: {
      'dashboard.view':false,'todayCronos.view':false,'leads.view':true,'kanban.view':true,'tasks.view':false,
      'installments.view':false,'creditSimulator.view':false,'performance.view':false,'users.view':false,'settings.view':false,
      'records.edit':false,'records.delete':false,'installments.manage':false,'financial.sensitive':false,'tasks.delete':false,'ficha.edit':false,'leads.delete':false,'users.manage':false,'masters.manage':false
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

  function roleKey(role){
    const key = String(role || '').trim().toUpperCase();
    return ROLES.includes(key) ? key : 'DENTISTA';
  }
  function cloneDefault(role){ return {...(ROLE_DEFAULTS[roleKey(role)] || ROLE_DEFAULTS.DENTISTA)}; }

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

  function setEffective(actor, permissions, resolvedSource){
    const base = cloneDefault(actor?.role);
    effective = {...base};
    if(permissions && typeof permissions === 'object'){
      Object.keys(permissions).forEach(k => {
        if(Object.prototype.hasOwnProperty.call(base,k)) effective[k] = permissions[k] === true;
      });
    }
    source = resolvedSource || 'default';
    actorKey = `${roleKey(actor?.role)}:${actor?.id || actor?.authUid || ''}`;
    loaded = true;
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
    if(!actor) return null;
    const key=`${roleKey(actor.role)}:${actor.id||actor.authUid||''}`;
    if(loaded && actorKey===key && options.force!==true) return effective;

    const cached=readCache(actor);
    if(cached?.permissions) setEffective(actor,cached.permissions,cached.source||'cache');
    else setEffective(actor,null,'default');

    try{
      const client=(typeof supabaseClient!=='undefined'&&supabaseClient)?supabaseClient:window.supabaseClient;
      if(!client||typeof client.rpc!=='function') return effective;
      const {data,error}=await client.rpc('cronos_get_my_permissions');
      if(error) throw error;
      const rows=Array.isArray(data)?data:(Array.isArray(data?.permissions)?data.permissions:[]);
      if(!rows.length) return effective;
      setEffective(actor,permissionMapFromRpcRows(rows),'database');
      writeCache(actor,effective,'database');
      return effective;
    }catch(error){
      console.warn('Cronos ACL V462: usando padrão global local.',error?.message||error);
      return effective;
    }
  }

  function getMap(role){ return effective || cloneDefault(role); }
  function can(permissionKey,actor){
    const key=String(permissionKey||'').trim();
    return !!key && getMap(actor?.role)[key]===true;
  }
  function canModule(moduleKey,actor){
    const permission=MODULE_PERMISSION[String(moduleKey||'')];
    return permission ? can(permission,actor) : true;
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
    hydrateForActor,can,canModule,legacyPerms,
    defaultsForRole:cloneDefault,
    getCatalog:()=>CATALOG.map(x=>({...x})),
    getRoleDefaults:()=>Object.fromEntries(ROLES.map(role=>[role,cloneDefault(role)])),
    getEffectiveMap:()=>({...getMap()}),getSource:()=>source
  };
})();
