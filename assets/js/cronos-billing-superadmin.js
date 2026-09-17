(function(){
  'use strict';
  const BUILD='billing-admin-v1-45-2-delete-test-plan-20260917';
  const ENDPOINT='billing-admin';
  const DELETE_PLAN_ENDPOINT='billing-plan-delete';
  const FEATURES=[
    ['dashboard','Dashboard'],['todayCronos','Hoje no Cronos'],['performance','Performance'],['leads','Leads'],['kanban','Funil'],['tasks','Tarefas'],['agenda','Agenda'],['installments','Recebimentos'],['creditSimulator','Simulador de Crédito'],['riskAnalysis','Análise de Risco'],['flows','Fluxos Assistidos'],['intraoral','Exame Digital / Câmera intraoral'],['users','Usuários'],['settings','Configurações']
  ];
  let shared=null,overview=null,detailTimer=null;
  function publishBillingSnapshots(extra){
    const map={...(window.__CRONOS_BILLING_CLINIC_SNAPSHOTS__||{})};
    for(const sub of (overview?.finance?.subscriptions||[])){
      if(sub?.clinic_id) map[String(sub.clinic_id)]={...(map[String(sub.clinic_id)]||{}),subscription:sub};
    }
    if(extra?.clinic_id) map[String(extra.clinic_id)]={...extra};
    window.__CRONOS_BILLING_CLINIC_SNAPSHOTS__=map;
    try{window.setCronosBillingClinicSnapshots?.(map);}catch(_){ }
  }
  function S(){return shared||(shared=window.__CRONOS_SUPERADMIN_SHARED__||null);}
  function esc(v){return S()?.escapeHtml?S().escapeHtml(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function brl(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function dateBR(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('pt-BR');}
  function isoIn(days){const d=new Date();d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);}
  function notify(msg,type='info'){S()?.toast?.(msg,type,3200);}
  function call(payload){if(!S()?.callEdgeFunction)throw new Error('Superadmin ainda não está pronto.');return S().callEdgeFunction(ENDPOINT,payload);}
  function callDeletePlan(payload){if(!S()?.callEdgeFunction)throw new Error('Superadmin ainda não está pronto.');return S().callEdgeFunction(DELETE_PLAN_ENDPOINT,payload);}
  function loading(btn,text,fn){return S()?.withButtonLoading?S().withButtonLoading(btn,text,fn):fn();}

  function injectStyles(){if(document.getElementById('billingAdminStyles'))return;const st=document.createElement('style');st.id='billingAdminStyles';st.textContent=`
    .billing-admin-card{padding:18px}.billing-admin-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}.billing-admin-head h3{margin:0 0 6px}.billing-plan-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}.billing-plan-card{padding:15px;border:1px solid rgba(255,255,255,.07);border-radius:16px;background:rgba(255,255,255,.025)}.billing-plan-card.off{opacity:.58}.billing-plan-price{font-size:22px;font-weight:950;margin:8px 0}.billing-feature-chips{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.billing-feature-chip{font-size:11px;padding:5px 8px;border-radius:999px;background:rgba(148,163,184,.12);color:#cbd5e1}.billing-feature-chip.ok{background:rgba(52,211,153,.12);color:#86efac}.billing-feature-chip.lock{background:rgba(251,191,36,.13);color:#fde68a}.billing-feature-chip.hide{background:rgba(100,116,139,.18);color:#cbd5e1}.billing-admin-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.billing-provider-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.billing-provider-grid .full{grid-column:1/-1}.billing-admin-modal-bg{position:fixed;inset:0;z-index:11000;background:rgba(2,6,23,.72);display:none;align-items:center;justify-content:center;padding:18px}.billing-admin-modal-bg.show{display:flex}.billing-admin-modal{width:min(880px,96vw);max-height:92vh;overflow:auto;border-radius:22px;background:#0b1220;border:1px solid rgba(148,163,184,.18);box-shadow:0 30px 100px rgba(0,0,0,.5);padding:18px}.billing-feature-editor{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.billing-feature-row{display:grid;grid-template-columns:1fr 140px;gap:8px;align-items:center;padding:9px;border:1px solid rgba(255,255,255,.06);border-radius:12px}.billing-fin-table{overflow:auto;margin-top:14px}.billing-fin-table table{min-width:760px}.billing-kpi-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:14px}.billing-kpi{border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px;background:rgba(255,255,255,.025)}.billing-kpi small{display:block;color:var(--muted);margin-bottom:5px}.billing-kpi strong{font-size:17px}.billing-clinic-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.billing-clinic-grid .full{grid-column:1/-1}
    @media(max-width:900px){.billing-plan-grid,.billing-provider-grid,.billing-feature-editor,.billing-kpi-grid,.billing-clinic-grid{grid-template-columns:1fr}.billing-provider-grid .full,.billing-clinic-grid .full{grid-column:auto}}
  `;document.head.appendChild(st);}

  function ensurePlanMount(){const mount=document.getElementById('superPlansMount');if(!mount)return null;let card=document.getElementById('billingPlansAdminCard');if(card)return card;card=document.createElement('div');card.id='billingPlansAdminCard';card.className='card section-gap';card.innerHTML=`<div class="billing-admin-card"><div class="billing-admin-head"><div><h3>Planos comerciais e assinatura</h3><div class="helper">Cadastre valores, ciclo anual e módulos de cada plano. Quando o pagamento for confirmado, o plano passa a controlar acesso e módulos automaticamente.</div></div><div class="actions"><button class="btn btn-ghost" id="billingPlansRefresh" type="button">Atualizar</button><button class="btn btn-primary" id="billingPlanNew" type="button">Novo plano</button></div></div><div id="billingPlansGrid" class="billing-plan-grid"><div class="helper">Carregando...</div></div></div>`;mount.prepend(card);card.querySelector('#billingPlansRefresh').onclick=e=>loading(e.currentTarget,'Atualizando...',loadOverview);card.querySelector('#billingPlanNew').onclick=()=>openPlanEditor(null);return card;}
  function planCard(p){const features=p.features||{};const enabled=FEATURES.filter(([k])=>features[k]==='enabled').length;const locked=FEATURES.filter(([k])=>features[k]==='locked').length;return `<div class="billing-plan-card ${p.active===false?'off':''}"><div style="display:flex;justify-content:space-between;gap:10px"><div><strong style="font-size:18px">${esc(p.name)}</strong><div class="helper">${esc(p.code)}</div></div><span class="feature-chip ${p.active===false?'locked':'ok'}">${p.active===false?'Inativo':'Ativo'}</span></div><div class="billing-plan-price">${brl(p.price_monthly)}<span class="helper"> / mês</span></div>${p.price_yearly!=null?`<div class="helper">Anual: ${brl(p.price_yearly)}</div>`:''}<div class="helper" style="margin-top:7px">${esc(p.description||'Sem descrição')}</div><div class="billing-feature-chips"><span class="billing-feature-chip ok">${enabled} liberados</span><span class="billing-feature-chip lock">${locked} bloqueados</span><span class="billing-feature-chip">${Number(p.included_users||0)} usuários incluídos</span></div><div class="billing-admin-actions"><button class="btn btn-ghost" data-billing-edit="${esc(p.id)}">Editar</button><button class="btn ${p.active===false?'btn-success':'btn-warning'}" data-billing-toggle="${esc(p.id)}" data-active="${p.active===false?'true':'false'}">${p.active===false?'Ativar':'Desativar'}</button><button class="btn btn-danger" data-billing-delete="${esc(p.id)}" data-plan-code="${esc(p.code)}" data-plan-name="${esc(p.name)}">Excluir</button></div></div>`;}
  function renderPlans(){
    const card=ensurePlanMount(),grid=card?.querySelector('#billingPlansGrid');if(!grid)return;
    const plans=overview?.plans||[];
    grid.innerHTML=plans.length?plans.map(planCard).join(''):'<div class="helper">Nenhum plano cadastrado.</div>';
    grid.querySelectorAll('[data-billing-edit]').forEach(b=>b.onclick=()=>openPlanEditor(plans.find(p=>p.id===b.dataset.billingEdit)));
    grid.querySelectorAll('[data-billing-toggle]').forEach(b=>b.onclick=()=>loading(b,'Salvando...',async()=>{await call({action:'toggle_plan',id:b.dataset.billingToggle,active:b.dataset.active==='true'});await loadOverview();notify('Plano atualizado.','success');}));
    grid.querySelectorAll('[data-billing-delete]').forEach(b=>b.onclick=async()=>{
      const id=b.dataset.billingDelete,code=String(b.dataset.planCode||''),name=String(b.dataset.planName||'este plano');
      try{
        const info=await loading(b,'Verificando...',()=>callDeletePlan({mode:'inspect',id,confirm_code:code}));
        const refs=info?.refs||{};
        const subscriptions=Number(refs.subscriptions||0),invoices=Number(refs.invoices||0),paidInvoices=Number(refs.paid_invoices||0);
        if(subscriptions===0&&invoices===0){
          if(!confirm(`Excluir definitivamente o plano "${name}"?\n\nEssa ação não pode ser desfeita.`))return;
          await loading(b,'Excluindo...',()=>callDeletePlan({mode:'delete',id,confirm_code:code}));
          await loadOverview();notify('Plano excluído definitivamente.','success');return;
        }
        if(info?.can_purge_test_data===true){
          const warning=[
            `O plano "${name}" é um plano de teste inativo, mas ainda possui dados vinculados:`,
            subscriptions?`• ${subscriptions} assinatura(s)`:null,
            invoices?`• ${invoices} fatura(s)`:null,
            paidInvoices?`• ${paidInvoices} fatura(s) paga(s)/confirmada(s)`:null,
            '',
            'Para excluir o plano, o Cronos também precisará apagar esses vínculos de TESTE.',
            'Isso não pode ser desfeito.'
          ].filter(v=>v!==null).join('\n');
          if(!confirm(warning))return;
          const typed=prompt(`Confirmação final: digite exatamente o código do plano para apagar o plano e os dados de teste vinculados:\n\n${code}`,'');
          if(String(typed||'').trim()!==code){notify('Exclusão cancelada: código de confirmação diferente.','warning');return;}
          await loading(b,'Excluindo...',()=>callDeletePlan({mode:'delete',id,confirm_code:code,purge_test_data:true,confirmation_phrase:typed}));
          await loadOverview();notify('Plano de teste e vínculos de teste excluídos.','success');return;
        }
        alert(info?.message||`O plano "${name}" ainda possui vínculos e não pode ser excluído. Desative-o ou remova/reassocie os vínculos primeiro.`);
      }catch(e){
        console.error('Falha ao excluir plano',e);
        const msg=e?.message||String(e||'Falha ao excluir plano.');
        alert(`Não foi possível excluir o plano.\n\n${msg}`);
        notify(msg,'error');
      }
    });
  }

  async function loadOverview(){try{overview=await call({action:'overview'});publishBillingSnapshots();renderPlans();renderProvider();renderFinance();return overview;}catch(e){console.error(e);const grid=document.querySelector('#billingPlansGrid');if(grid)grid.innerHTML=`<div class="helper" style="grid-column:1/-1">Não foi possível carregar os planos: ${esc(e.message||String(e))}<br><button class="btn btn-ghost" id="billingPlansRetry" type="button" style="margin-top:10px">Tentar novamente</button></div>`;document.getElementById('billingPlansRetry')?.addEventListener('click',()=>loadOverview().catch(()=>{}));notify(e.message||String(e),'error');throw e;}}
  function watch(){document.addEventListener('click',e=>{const nav=e.target.closest?.('[data-super-view]');if(!nav)return;setTimeout(()=>{const view=nav.dataset.superView;if(view==='plans'||view==='finance'||view==='settings')loadOverview().catch(()=>{});},80);});const root=document.getElementById('detailContent');if(root){new MutationObserver(()=>{clearTimeout(detailTimer);detailTimer=setTimeout(()=>{if(S()?.state?.selectedClinicId&&!S()?.state?.selectedClinicDetails?.__loading)loadClinicBilling();},120);}).observe(root,{childList:true,subtree:false});}}
  function boot(){injectStyles();ensurePlanMount();ensureProviderCard();ensureFinanceCard();watch();loadOverview().catch(()=>{});if(S()?.state?.selectedClinicId)loadClinicBilling();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,180));else setTimeout(boot,180);
  window.CronosBillingSuperadmin={BUILD,loadOverview,loadClinicBilling,getClinicSnapshot:(id)=>window.__CRONOS_BILLING_CLINIC_SNAPSHOTS__?.[String(id)]||null};
})();
