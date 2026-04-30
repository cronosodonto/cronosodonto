function debounce(fn, delay){
  let t;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(()=>fn.apply(this,args), delay||300);
  };
}


window.__CRONOS_SESSION_CHECKING__ = true;
window.__CRONOS_BOOTING__ = true;

(function(){
  function showToast(title, message, type = 'info') {
    try {
      const prefix = type ? `[${String(type).toUpperCase()}]` : '[INFO]';
      console.log(prefix, title || '', message || '');
    } catch (e) {}
  }

  function fallbackBeforeBoot(msg){
    try{
      if(window.__CRONOS_SESSION_CHECKING__ || window.__CRONOS_BOOTING__) return;
      var boot=document.getElementById('bootSplashView');
      var a=document.getElementById('authView');
      var b=document.getElementById('appView');
      if(boot) boot.classList.add('hidden');
      if(a) a.classList.remove('hidden');
      if(b) b.classList.add('hidden');
      showToast(msg || 'Falha ao iniciar.');
    }catch(e){}
  }

  function handleErr(msg){
    if(window.__CRONOS_BOOTED){
      showToast(msg || 'Erro inesperado.');
      return;
    }
    fallbackBeforeBoot(msg);
  }

  window.addEventListener('error', function(e){ handleErr(e && e.message); });
  window.addEventListener('unhandledrejection', function(e){
    var r = e && e.reason;
    handleErr(r && (r.message || r) );
  });

  
  setTimeout(function(){
    if(window.__CRONOS_BOOTED || window.__CRONOS_SESSION_CHECKING__ || window.__CRONOS_BOOTING__) return;
    var boot=document.getElementById('bootSplashView');
    var a=document.getElementById('authView');
    var b=document.getElementById('appView');
    if(boot && !boot.classList.contains('hidden')) return;
    if(a && b && a.classList.contains('hidden') && b.classList.contains('hidden')){
      fallbackBeforeBoot('Boot não exibiu nenhuma tela (fallback automático).');
    }
  }, 6500);
})();

/* =========================
   Recebimentos e parcelas
   ========================= */

function parseMoney(v){
  const n = Number(v);
  return (isFinite(n) && !isNaN(n)) ? n : 0;
}
function parseBRNum(v){
  const s = String(v ?? "").trim();
  if(!s) return null;
  const n = Number(s.replace(/\./g, "").replace(/,/g, ".").replace(/[^0-9.-]/g, ""));
  return (isFinite(n) && !isNaN(n)) ? n : null;
}
function isoDate(d){ return (d instanceof Date) ? d.toISOString().slice(0,10) : String(d||"").slice(0,10); }
function addMonthsISO(iso, k){
  const [y,m,d] = iso.split("-").map(x=>parseInt(x,10));
  const dt = new Date(y, (m-1)+k, d||1);
  return isoDate(dt);
}
function monthKeyOf(iso){ return (iso||"").slice(0,7); }

function ensureInstallmentsForEntry(entry){
  entry.installments = entry.installments || [];

  if(entry.installPlan && (!Array.isArray(entry.installments) || entry.installments.length===0)){
    try{ buildInstallments(entry); }catch(e){ console.warn("buildInstallments falhou:", e); }
  }

  (entry.installments||[]).forEach(p=>{
    if(p.due && !p.dueDate) p.dueDate = p.due;
    if(p.paid && !p.paidAt) p.paidAt = p.paid;
    const hoje = new Date();
const dataParcela = new Date(p.dueDate || p.due || 0);

const forma = (p.payMethod || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

if (forma.includes("credito")) {
  if (dataParcela <= hoje && !p.paidAt) {
    p.paidAt = new Date().toISOString();
    p.status = "PAGA";
  }
}
    if(!p.payMethod && entry.installPlan?.payMethod) p.payMethod = entry.installPlan.payMethod;
    if(!p.total && entry.installPlan?.n) p.total = parseInt(entry.installPlan.n||0,10) || p.total || 0;
    if(!p.status){
      p.status = p.paidAt ? "PAGA" : "PENDENTE";
    }
    if(p.paidAt && p.status!=="PAGA") p.status="PAGA";
  });
}

function buildInstallments(entry){
  const plan = entry.installPlan;
  if(!plan) return;
  const amt = parseMoney(plan.amount);
  const n = Math.max(1, parseInt(plan.n||1,10));
  const each = n ? (amt / n) : 0;
  let first = plan.firstDue;
  if(!first){
    const today = new Date();
    const next = new Date(today.getFullYear(), today.getMonth()+1, today.getDate());
    first = isoDate(next);
  }
  entry.installments = [];
  for(let i=1;i<=n;i++){
    entry.installments.push({
      number:i,
      total:n,
      amount: Number(each.toFixed(2)),
      dueDate: addMonthsISO(first, i-1),
      status:"PENDENTE",
      paidAt:"",
      payMethod: plan.payMethod || ""
    });
  }
}

function isAutomaticInstallmentTask(t){
  if(!t || typeof t !== "object") return false;
  const key = String(t.key || "");
  const type = String(t.type || "");
  const title = String(t.title || t.name || "");
  const notes = String(t.notes || t.desc || "");
  return (
    key.startsWith("INST:") ||
    key.startsWith("FININST:") ||
    type === "installment" ||
    title.startsWith("Inadimplente:") ||
    (
      notes.includes("Parcela") &&
      (t.entryId || t.wa === true || String(t.action || "").toLowerCase().includes("whatsapp"))
    )
  );
}

function stableInstallmentTaskId(key){
  return `task_${String(key || "").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function scrubInstallmentTasksForMaster(db, masterId){
  db.tasks = Array.isArray(db.tasks) ? db.tasks : [];
  db.entries = Array.isArray(db.entries) ? db.entries : [];
  db.contacts = Array.isArray(db.contacts) ? db.contacts : [];

  if(!masterId) return {before: db.tasks.length, after: db.tasks.length, removed: 0, created: 0};

  const before = db.tasks.length;
  const today = todayISO();
  const contactsById = new Map((db.contacts||[])
    .filter(c=>c.masterId===masterId)
    .map(c=>[c.id,c]));

  db.tasks = db.tasks.filter(t=>{
    if(t?.masterId && t.masterId !== masterId) return true;
    return !isAutomaticInstallmentTask(t);
  });

  const createdKeys = new Set();
  const rebuilt = [];

  (db.entries||[])
    .filter(e=>e.masterId===masterId && e.installPlan && !e.installPlan.migratedToFinancialPlanId)
    .forEach(e=>{
      ensureInstallmentsForEntry(e);
      (e.installments||[]).forEach(p=>{
        const due = p.dueDate || p.due || "";
        const isPaid = !!p.paidAt || p.status === "PAGA";
        const isLate = !!due && due < today && !isPaid;

        if(!isLate) return;

        const key = `INST:${e.id}:${due}:${p.number}`;
        if(createdKeys.has(key)) return;
        createdKeys.add(key);

        const c = contactsById.get(e.contactId) || {name:"(sem nome)", phone:""};
        const title = `Inadimplente: ${c.name} • Parcela ${p.number}/${p.total}`;
        const notes = `Venc: ${fmtBR(due)} • ${moneyBR(p.amount)} • ${p.payMethod||e.installPlan.payMethod||"—"}`;

        rebuilt.push({
          id: stableInstallmentTaskId(key),
          masterId,
          key,
          type: "installment",
          entryId: e.id,
          contactId: e.contactId || "",
          title,
          action: "WhatsApp",
          notes,
          done: false,
          createdAt: new Date().toISOString(),
          dueDate: due,
          phone: c.phone || "",
          wa: true,
          autoGenerated: true
        });
      });
    });


  (db.entries||[])
    .filter(e=>e.masterId===masterId)
    .forEach(e=>{
      const plans = ensureFinancialPlans(e);
      if(!plans.length) return;
      const c = contactsById.get(e.contactId) || {name:"(sem nome)", phone:""};
      plans.forEach(plan=>{
        (plan.payments||[]).forEach(p=>{
          const due = p.dueDate || "";
          const isPaid = financialPaymentPaid(p);
          const isLate = !!due && due < today && !isPaid;
          if(!isLate) return;

          const key = `FININST:${e.id}:${plan.id}:${p.id}`;
          if(createdKeys.has(key)) return;
          createdKeys.add(key);

          rebuilt.push({
            id: stableInstallmentTaskId(key),
            masterId,
            key,
            type: "installment",
            entryId: e.id,
            contactId: e.contactId || "",
            financialPlanId: plan.id,
            financialPaymentId: p.id,
            title: `Inadimplente: ${c.name} • ${plan.title || "Orçamento"} • Parcela ${p.number||""}/${p.total||""}`,
            action: "WhatsApp",
            notes: `Venc: ${fmtBR(due)} • ${moneyBR(p.amount)} • ${p.payMethod || "—"}`,
            done: false,
            createdAt: new Date().toISOString(),
            dueDate: due,
            phone: c.phone || "",
            wa: true,
            autoGenerated: true
          });
        });
      });
    });

  db.tasks.push(...rebuilt);

  const seen = new Set();
  db.tasks = db.tasks.filter(t=>{
    const semanticKey = isAutomaticInstallmentTask(t)
      ? String(t.key || t.id || "")
      : String(t.id || t.key || `${t.masterId||""}|${t.title||""}|${t.dueDate||""}|${t.notes||""}`);
    if(!semanticKey) return true;
    if(seen.has(semanticKey)) return false;
    seen.add(semanticKey);
    return true;
  });

  return {before, after: db.tasks.length, removed: before - (db.tasks.length - rebuilt.length), created: rebuilt.length};
}

function scrubInstallmentTasksForAllMasters(db){
  const masterIds = new Set();
  (db.masters||[]).forEach(m=>{ if(m?.id) masterIds.add(String(m.id)); });
  (db.users||[]).forEach(u=>{ if(u?.masterId) masterIds.add(String(u.masterId)); });
  (db.entries||[]).forEach(e=>{ if(e?.masterId) masterIds.add(String(e.masterId)); });

  const stats = [];
  masterIds.forEach(masterId=>{
    stats.push({masterId, ...scrubInstallmentTasksForMaster(db, masterId)});
  });
  return stats;
}

function syncInstallmentTasks(db, actor){
  const masterId = actor?.masterId;
  if(!masterId) return;
  return scrubInstallmentTasksForMaster(db, masterId);
}

function installmentsKPIs(db, actor, monthKey){
  const today = todayISO();
  const masterId = actor?.masterId;
  const entries = (db.entries||[]).filter(e=>e.masterId===masterId && e.installPlan && !e.installPlan.migratedToFinancialPlanId);
  let monthSum=0, monthN=0, lateSum=0, lateN=0, futureSum=0, futureN=0;

  entries.forEach(e=>{
    ensureInstallmentsForEntry(e);
    (e.installments||[]).forEach(p=>{
      const due = p.dueDate;
      const paid = !!p.paidAt || p.status==="PAGA";
      if(paid) return;
      if(due && monthKeyOf(due)===monthKey){ monthSum += p.amount; monthN++; }
      if(due && due < today){ lateSum += p.amount; lateN++; }
      if(due && due > today){ futureSum += p.amount; futureN++; }
    });
  });

  (db.entries||[])
    .filter(e=>e.masterId===masterId)
    .forEach(e=>{
      ensureFinancialPlans(e).forEach(plan=>{
        (plan.payments||[]).forEach(p=>{
          const due = p.dueDate;
          const paid = financialPaymentPaid(p);
          if(paid) return;
          if(due && monthKeyOf(due)===monthKey){ monthSum += parseMoney(p.amount); monthN++; }
          if(due && due < today){ lateSum += parseMoney(p.amount); lateN++; }
          if(due && due > today){ futureSum += parseMoney(p.amount); futureN++; }
        });
      });
    });

  return {monthSum, monthN, lateSum, lateN, futureSum, futureN};
}

function entryInstallmentSummary(entry){
  ensureInstallmentsForEntry(entry);
  const today = todayISO();
  const pending = (entry.installments||[]).filter(p=>!(p.paidAt||p.status==="PAGA"));
  const paidCount = (entry.installments||[]).length - pending.length;
  let nextDue = "";
  pending.sort((a,b)=> (a.dueDate||"").localeCompare(b.dueDate||""));
  if(pending.length) nextDue = pending[0].dueDate || "";
  const lateCount = pending.filter(p=>p.dueDate && p.dueDate < today).length;
  return {paidCount, total:(entry.installments||[]).length, nextDue, lateCount};
}


/* Recebimentos */

function ensureFinancialPlans(entry){
  if(!entry) return [];
  if(!Array.isArray(entry.financialPlans)) entry.financialPlans = [];
  entry.financialPlans.forEach(plan=>{
    if(!plan.id) plan.id = uid("budget");
    if(!plan.createdAt) plan.createdAt = new Date().toISOString();
    if(!plan.status) plan.status = "Aguardando";
    if(!Array.isArray(plan.payments)) plan.payments = [];
    renumberFinancialPlanPayments(plan);
  });
  return entry.financialPlans;
}

function ensureFichaForRecebimentos(entry){
  if(!entry) return {plano:[], odontograma:{}, avaliacoes:[]};
  if(!entry.ficha || typeof entry.ficha !== "object"){
    entry.ficha = { plano: [], odontograma: {}, avaliacoes: [] };
  }
  if(!Array.isArray(entry.ficha.plano)) entry.ficha.plano = [];
  if(!entry.ficha.odontograma || typeof entry.ficha.odontograma !== "object") entry.ficha.odontograma = {};
  if(!Array.isArray(entry.ficha.avaliacoes)) entry.ficha.avaliacoes = [];

  if(!entry.ficha.avaliacoes.length){
    const evalDate = String(entry.firstContactAt || entry.monthKey || todayISO()).slice(0,10);
    entry.ficha.avaliacoes.push({
      id: "eval_1",
      label: "Avaliação 1",
      date: /^\d{4}-\d{2}-\d{2}$/.test(evalDate) ? evalDate : todayISO(),
      createdAt: new Date().toISOString()
    });
  }
  if(!entry.ficha.activeEvaluationId){
    entry.ficha.activeEvaluationId = entry.ficha.avaliacoes[entry.ficha.avaliacoes.length - 1]?.id || "eval_1";
  }

  const firstEval = entry.ficha.avaliacoes[0] || { id:"eval_1", label:"Avaliação 1", date: todayISO() };
  entry.ficha.plano.forEach(item=>{
    if(!item.id) item.id = uid("plan");
    if(!item.avaliacaoId) item.avaliacaoId = firstEval.id;
    if(!item.avaliacaoLabel) item.avaliacaoLabel = firstEval.label || "Avaliação 1";
    if(!item.avaliacaoData) item.avaliacaoData = firstEval.date || todayISO();
    if(item.recebimentoId && !item.financialPlanId) item.financialPlanId = item.recebimentoId;
    if(item.financialPlanId && !item.recebimentoId) item.recebimentoId = item.financialPlanId;
  });

  return entry.ficha;
}

function getFinancialPlanForFichaItemInRecebimentos(entry, item){
  const planId = String(item?.financialPlanId || item?.recebimentoId || "").trim();
  if(!entry || !planId) return null;
  return ensureFinancialPlans(entry).find(p=>String(p.id)===planId) || null;
}

function isFichaItemAvailableForRecebimentos(entry, item){
  const plan = getFinancialPlanForFichaItemInRecebimentos(entry, item);
  if(plan) return false;
  if(item?.pago) return false;
  return true;
}


function legacyInstallmentAlreadyMigrated(entry){
  return !!(entry?.installPlan && entry.installPlan.migratedToFinancialPlanId);
}

function migrateLegacyInstallmentsToFinancialPlan(entry){
  if(!entry || !entry.installPlan) return null;

  try{ ensureInstallmentsForEntry(entry); }catch(_){}

  const legacyInstallments = Array.isArray(entry.installments) ? entry.installments : [];
  const hasLegacyInstallments = legacyInstallments.length > 0;
  const entryAmount = parseMoney(entry.installPlan?.entryAmount || 0);

  if(!hasLegacyInstallments && !entryAmount) return null;

  const plans = ensureFinancialPlans(entry);
  const existingId = entry.installPlan.migratedToFinancialPlanId;
  let existingPlan = existingId ? plans.find(p=>String(p.id)===String(existingId)) : null;
  if(!existingPlan){
    existingPlan = plans.find(p=>p.source === "legacyInstallments" || p.legacyInstallPlan === true);
  }
  if(existingPlan){
    entry.installPlan.migratedToFinancialPlanId = existingPlan.id;
    renumberFinancialPlanPayments(existingPlan);
    return existingPlan;
  }

  const legacyAmount = parseMoney(entry.installPlan?.amount || 0);
  const legacyTotalFromFields = entryLegacyFinancialTotal(entry);
  const legacyTotalFromParts = legacyAmount + entryAmount;
  const legacyTotalFromInstallments = legacyInstallments.reduce((sum,p)=>sum + parseMoney(p.amount), 0) + entryAmount;
  const total = legacyTotalFromFields || legacyTotalFromParts || legacyTotalFromInstallments || 0;
  const payMethod = entry.installPlan?.payMethod || "";

  const planId = `legacy_${String(entry.id || uid("entry")).replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  const payments = [];

  if(entryAmount > 0){
    const paidLegacy = parseMoney(entry.valuePaid ?? entry.valorPago ?? entry.valorRecebido ?? entry.totalRecebido ?? 0);
    const entryPaid = paidLegacy >= entryAmount;
    const entryDate = entry.lastPaymentDate || entry.firstContactAt || (entry.monthKey ? `${String(entry.monthKey).slice(0,7)}-01` : todayISO());
    payments.push({
      id: `legacy_entry_${String(entry.id || "").replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      amount: entryAmount,
      dueDate: entryDate,
      payMethod,
      notes: "Entrada migrada do cadastro antigo",
      status: entryPaid ? "PAGA" : "PENDENTE",
      paidAt: entryPaid ? entryDate : "",
      cashDate: entryPaid ? entryDate : "",
      createdAt: new Date().toISOString(),
      source: "legacyEntry"
    });
  }

  legacyInstallments.forEach((p, idx)=>{
    const paid = !!p.paidAt || p.status === "PAGA" || p.paid === true;
    const dueDate = p.dueDate || p.due || addMonthsISO(entry.installPlan?.firstDue || todayISO(), idx);
    payments.push({
      id: p.id ? `legacy_${String(p.id).replace(/[^a-zA-Z0-9_-]/g, "_")}` : `legacy_${String(entry.id || "").replace(/[^a-zA-Z0-9_-]/g, "_")}_${idx+1}`,
      amount: parseMoney(p.amount),
      dueDate,
      payMethod: p.payMethod || payMethod,
      notes: p.notes || "Parcela migrada do cadastro antigo",
      status: paid ? "PAGA" : "PENDENTE",
      paidAt: paid ? (p.paidAt || p.paid || "") : "",
      cashDate: paid ? (p.cashDate || p.paidAt || p.paid || "") : "",
      createdAt: p.createdAt || new Date().toISOString(),
      source: "legacyInstallment"
    });
  });

  const plan = {
    id: planId,
    title: "Parcelamento legado",
    dentist: "",
    amount: total,
    status: "Aprovado",
    createdAt: entry.installPlan?.createdAt || entry.firstContactAt || new Date().toISOString(),
    createdBy: "Migração automática",
    source: "legacyInstallments",
    legacyInstallPlan: true,
    payments
  };

  renumberFinancialPlanPayments(plan);
  plans.push(plan);
  entry.installPlan.migratedToFinancialPlanId = plan.id;
  return plan;
}


function renumberFinancialPlanPayments(plan){
  if(!plan || !Array.isArray(plan.payments)) return;
  plan.payments.sort((a,b)=>String(a.dueDate||"").localeCompare(String(b.dueDate||"")) || String(a.createdAt||"").localeCompare(String(b.createdAt||"")));
  const total = plan.payments.length;
  plan.payments.forEach((p,idx)=>{
    if(!p.id) p.id = uid("pay");
    p.number = idx + 1;
    p.total = total;
    if(!p.status) p.status = p.paidAt ? "PAGA" : "PENDENTE";
    if(p.paidAt && p.status !== "PAGA") p.status = "PAGA";
    if(!p.cashDate && p.paidAt) p.cashDate = String(p.paidAt).slice(0,10);
  });
}

function financialPlanTotalFromFicha(entry){
  try{
    const items = Array.isArray(entry?.ficha?.plano) ? entry.ficha.plano : [];
    return items.reduce((sum,item)=> sum + parseMoney(item.valorFechado ?? item.valorBase ?? 0), 0);
  }catch(_){
    return 0;
  }
}

function entryLegacyFinancialTotal(entry){
  const candidates = [
    entry?.valueClosed, entry?.valueBudget, entry?.valueEstimated, entry?.value,
    entry?.budgetValue, entry?.proposalValue
  ];
  for(const v of candidates){
    const n = parseMoney(v);
    if(n > 0) return n;
  }
  return 0;
}

function suggestedFinancialPlanTotal(entry){
  const ficha = financialPlanTotalFromFicha(entry);
  if(ficha > 0) return ficha;
  return entryLegacyFinancialTotal(entry);
}

function financialPaymentPaid(payment){
  return !!payment?.paidAt || payment?.status === "PAGA" || payment?.paid === true;
}


/* =========================
   Caixa unificado (v84 - legado no ano original)
   Regra oficial: dinheiro conta no mês da baixa/data de caixa; legado histórico entra no mês do lead quando não houver baixa detalhada naquele mesmo mês.
   Fonte usada por Dashboard, Performance e Recebimentos para não virar Babel financeira.
   Lead legado/manual antigo entra com data real; se não houver data, usa o mês original do lead como âncora histórica, sem jogar no mês atual.
   ========================= */
function cronosPaymentCashISO(payment, allowLegacyDueFallback=false){
  const iso = pickISOFlexible(
    payment?.cashDate ||
    payment?.paidAt ||
    payment?.paymentDate ||
    payment?.paidDate ||
    payment?.date ||
    payment?.paid ||
    ""
  );
  if(iso) return iso;
  return allowLegacyDueFallback ? pickISOFlexible(payment?.dueDate || payment?.due || payment?.vencimento || "") : "";
}
function cronosLegacyManualPaymentNeedsMonthRepair(payment){
  const desc = String(payment?.desc || payment?.description || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim();
  const source = String(payment?.source || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim();

  return (
    !payment?.financialPlanId &&
    !payment?.financialPaymentId &&
    !payment?.legacyInstallmentNumber &&
    !payment?.cashDate &&
    !payment?.paidAt &&
    !payment?.paymentDate &&
    !payment?.paidDate &&
    !payment?.status &&
    !source &&
    (desc === "pagamento manual" || desc === "resgate / pagamento manual")
  );
}
function cronosPaymentOfficialISO(payment, entry=null, allowLegacyDueFallback=false){
  const rawISO = cronosPaymentCashISO(payment, allowLegacyDueFallback);
  if(!rawISO) return "";

  const needsRepair = cronosLegacyManualPaymentNeedsMonthRepair(payment);
  const entryMonth = cronosLegacySafeMonthKeyFromEntry(entry);

  if(needsRepair && !entryMonth){
    return "";
  }

  if(needsRepair && entryMonth){
    const rawMonth = rawISO.slice(0,7);
    if(rawMonth !== entryMonth){
      const y = Number(entryMonth.slice(0,4));
      const m = Number(entryMonth.slice(5,7));
      const rawDay = Number(rawISO.slice(8,10));
      const maxDay = new Date(y, m, 0).getDate();
      const safeDay = String(Math.min(Math.max(rawDay || 1, 1), maxDay)).padStart(2, "0");
      return `${entryMonth}-${safeDay}`;
    }
  }
  return rawISO;
}
function cronosPaymentDateRepairInfo(payment, entry=null, allowLegacyDueFallback=false){
  const originalISO = cronosPaymentCashISO(payment, allowLegacyDueFallback);
  const officialISO = cronosPaymentOfficialISO(payment, entry, allowLegacyDueFallback);
  const needsRepair = cronosLegacyManualPaymentNeedsMonthRepair(payment);
  const entryMonth = cronosLegacySafeMonthKeyFromEntry(entry);
  if(originalISO && !officialISO && needsRepair && !entryMonth){
    return {
      originalISO,
      officialISO: "",
      entryMonth: "",
      reason: "Pagamento manual legado sem mês original do lead: fora do caixa mensal"
    };
  }
  if(originalISO && officialISO && originalISO !== officialISO){
    return {
      originalISO,
      officialISO,
      entryMonth,
      reason: "Pagamento manual legado reancorado para o mês original do lead"
    };
  }
  return null;
}
function cronosPaymentAmount(payment){
  return parseMoney(payment?.value ?? payment?.amount ?? payment?.valor ?? payment?.total ?? 0);
}
function cronosMonthFromISOValue(raw){
  const iso = pickISOFlexible(raw);
  return iso ? iso.slice(0,7) : "";
}
function cronosValidMonthKey(raw){
  const mk = String(raw || "").trim().slice(0,7);
  return /^\d{4}-\d{2}$/.test(mk) ? mk : "";
}
function cronosLegacySafeMonthKeyFromEntry(entry){
  if(!entry) return "";

  const explicitMonth = [
    entry.originalMonthKey,
    entry.legacyMonthKey,
    entry.paymentMonthKey,
    entry.receivedMonthKey,
    entry.cashMonthKey,
    entry.baixaMonthKey,
    entry.legacyPaymentMonthKey,
    entry.originalPaymentMonthKey,
    entry.monthKeyOriginal,
    entry.mesOriginal,
    entry.mesPagamentoOriginal
  ].map(cronosValidMonthKey).find(Boolean);
  if(explicitMonth) return explicitMonth;

  const dateFields = [
    entry.originalPaymentDate,
    entry.legacyPaymentDate,
    entry.dataPagamentoOriginal,
    entry.dataRecebimentoOriginal,
    entry.originalPaidAt,
    entry.legacyPaidAt,
    entry.originalCashDate,
    entry.legacyCashDate,
    entry.dataPagamento,
    entry.dataRecebimento,
    entry.pagoEm,
    entry.recebidoEm,
    entry.paymentDate,
    entry.paidDate,
    entry.datePaid,
    entry.cashDate,
    entry.receivedDate,
    entry.receivedAt,
    entry.receiptDate,
    entry.baixaDate,
    entry.dataBaixa,
    entry.paymentAt,
    entry.paidAt,
    entry.paidOn,
    entry.firstContactAt,
    entry.createdAt,
    entry.createdISO,
    entry.dataCadastro,
    entry.cadastroEm,
    entry.legacyCreatedAt,
    entry.originalCreatedAt,
    entry.apptDate,
    entry.date
  ];
  for(const raw of dateFields){
    const mk = cronosMonthFromISOValue(raw);
    if(mk) return mk;
  }

  return "";
}
function cronosLegacySafeAnchorISO(entry){
  const mk = cronosLegacySafeMonthKeyFromEntry(entry);
  return mk ? { iso: `${mk}-01`, monthKey: mk, reason: "Legado sem data exata preservado no mês/ano original detectado; não usa o ano atual" } : null;
}
function cronosEntryLegacyPaymentISO(entry){
  const entryMonth = cronosLegacySafeMonthKeyFromEntry(entry);
  const candidates = [
    ["dataPagamento", entry?.dataPagamento],
    ["dataRecebimento", entry?.dataRecebimento],
    ["pagoEm", entry?.pagoEm],
    ["recebidoEm", entry?.recebidoEm],
    ["paymentDate", entry?.paymentDate],
    ["paidDate", entry?.paidDate],
    ["datePaid", entry?.datePaid],
    ["cashDate", entry?.cashDate],
    ["receivedDate", entry?.receivedDate],
    ["receivedAt", entry?.receivedAt],
    ["receiptDate", entry?.receiptDate],
    ["baixaDate", entry?.baixaDate],
    ["dataBaixa", entry?.dataBaixa],
    ["paymentAt", entry?.paymentAt],
    ["paidAt", entry?.paidAt],
    ["paidOn", entry?.paidOn],
    ["lastPaymentDate", entry?.lastPaymentDate]
  ];
  const valid = [];
  for(const [field, raw] of candidates){
    const iso = pickISOFlexible(raw);
    if(iso) valid.push({ field, iso });
  }

  if(!valid.length) return "";

  if(entryMonth){
    const sameMonth = valid.find(x=>String(x.iso).slice(0,7) === entryMonth);
    if(sameMonth) return sameMonth.iso;

    const explicit = valid.find(x=>x.field !== "lastPaymentDate");
    if(explicit) return explicit.iso;

    const last = valid.find(x=>x.field === "lastPaymentDate");
    if(last?.iso){
      const y = Number(entryMonth.slice(0,4));
      const m = Number(entryMonth.slice(5,7));
      const rawDay = Number(String(last.iso).slice(8,10));
      const maxDay = new Date(y, m, 0).getDate();
      const safeDay = String(Math.min(Math.max(rawDay || 1, 1), maxDay)).padStart(2, "0");
      return `${entryMonth}-${safeDay}`;
    }
    return "";
  }

  const explicit = valid.find(x=>x.field !== "lastPaymentDate");
  return explicit?.iso || "";
}
function cronosSameMasterPayment(payment, masterId, entryById, contactById, entriesByContact){
  if(!masterId) return true;
  if(payment?.masterId && payment.masterId === masterId) return true;
  if(payment?.masterId && payment.masterId !== masterId) return false;
  const entryId = String(payment?.entryId || "");
  if(entryId){
    const e = entryById.get(entryId);
    return !!e && (!e.masterId || e.masterId === masterId);
  }
  const contactId = String(payment?.contactId || "");
  if(contactId){
    if(contactById.has(contactId)) return true;
    if(entriesByContact.has(contactId)) return true;
  }
  return false;
}
function cronosPatientNameForPayment(obj, entry, contactById){
  const contactId = String(obj?.contactId || entry?.contactId || "");
  const c = contactId ? contactById.get(contactId) : null;
  return c?.name || obj?.contactName || obj?.name || entry?.name || entry?.lead || "Sem paciente vinculado";
}
function buildCronosReceivedEvents(db=loadDB(), actor=currentActor(), options={}){
  const masterId = actor?.masterId || actor?.clinicId || "";
  const today = todayISO();
  const fromISO = pickISOFlexible(options.fromISO || options.from || "");
  const toISO = pickISOFlexible(options.toISO || options.to || "");
  const untilToday = options.untilToday !== false;
  const includeLegacyDueFallback = options.includeLegacyDueFallback === true;
  const includeUndatedLegacyByEntryMonth = options.includeUndatedLegacyByEntryMonth !== false;

  const entries = (db?.entries || []).filter(e=>!masterId || !e.masterId || e.masterId===masterId);
  const contacts = (db?.contacts || []).filter(c=>!masterId || !c.masterId || c.masterId===masterId);
  const entryById = new Map(entries.map(e=>[String(e.id), e]));
  const contactById = new Map(contacts.map(c=>[String(c.id), c]));
  const entriesByContact = new Map();
  entries.forEach(e=>{
    const cid = String(e.contactId || "");
    if(cid && !entriesByContact.has(cid)) entriesByContact.set(cid, e);
  });

  const events = [];
  const skippedDuplicates = [];
  const skippedLegacy = [];
  const seen = new Set();
  const seenLoose = new Map();
  const planLinks = new Set();
  const legacyLinks = new Set();
  const detailedEntryIds = new Set();
  const detailedContactIds = new Set();

  function centsKey(value){
    return String(Math.round(parseMoney(value) * 100));
  }
  function normalizeTextKey(value){
    return String(value || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function canonicalPatientKey(meta={}){
    const entryId = String(meta.entryId || "").trim();
    if(entryId) return `entry:${entryId}`;
    const contactId = String(meta.contactId || "").trim();
    if(contactId) return `contact:${contactId}`;
    return `patient:${normalizeTextKey(meta.patient || "Sem paciente")}`;
  }
  function sourceGroup(source=""){
    const s = normalizeTextKey(source);
    if(s.includes("caixa") || s.includes("recebimento")) return "cash";
    if(s.includes("plano") || s.includes("financeiro") || s.includes("orcamento")) return "plan";
    if(s.includes("parcelamento") || s.includes("legado")) return "legacy";
    if(s.includes("lead")) return "lead";
    return s || "other";
  }
  function loosePaymentKey(amount, iso, meta={}){
    return `${canonicalPatientKey(meta)}|${String(iso||"").slice(0,10)}|${centsKey(amount)}`;
  }

  function inRange(iso){
    if(!iso) return false;
    if(untilToday && iso > today) return false;
    if(fromISO && iso < fromISO) return false;
    if(toISO && iso > toISO) return false;
    return true;
  }
  function addEvent(key, amount, iso, meta={}){
    amount = parseMoney(amount);
    iso = pickISOFlexible(iso);
    if(!amount || !inRange(iso)) return false;
    const safeKey = String(key || `${iso}:${amount}:${meta.entryId||""}:${meta.contactId||""}:${meta.desc||meta.source||""}`);
    if(seen.has(safeKey)) return false;

    const group = sourceGroup(meta.source || meta.desc || "Recebimento");
    const looseKey = loosePaymentKey(amount, iso, meta);
    const previous = seenLoose.get(looseKey);
    if(previous){
      skippedDuplicates.push({
        skippedKey: safeKey,
        keptKey: previous.key,
        looseKey,
        amount,
        iso,
        patient: meta.patient || previous.patient || "Sem paciente vinculado",
        skippedSource: meta.source || meta.desc || group,
        keptSource: previous.source || previous.group,
        group
      });
      return false;
    }

    seen.add(safeKey);
    const entryId = String(meta.entryId || "");
    const contactId = String(meta.contactId || "");
    if(entryId) detailedEntryIds.add(entryId);
    if(contactId) detailedContactIds.add(contactId);
    const ev = {
      key: safeKey,
      looseKey,
      id: String(meta.id || safeKey),
      amount,
      value: amount,
      iso,
      monthKey: iso.slice(0,7),
      entryId,
      contactId,
      patient: meta.patient || "Sem paciente vinculado",
      method: String(meta.method || ""),
      source: String(meta.source || "Recebimento"),
      sourceGroup: group,
      desc: String(meta.desc || meta.source || "Recebimento").trim(),
      dateRepair: meta.dateRepair || null,
      raw: meta.raw || null
    };
    events.push(ev);
    seenLoose.set(looseKey, ev);
    return true;
  }

  (db?.payments || []).forEach((p, idx)=>{
    if(!cronosSameMasterPayment(p, masterId, entryById, contactById, entriesByContact)) return;
    const status = String(p?.status || "").toUpperCase();
    if(status && status !== "PAGA" && p?.paid !== true && !p?.paidAt && !p?.cashDate && !p?.date) return;
    const amount = cronosPaymentAmount(p);
    const entryId = String(p?.entryId || "");
    const contactId = String(p?.contactId || "");
    const entry = entryId ? entryById.get(entryId) : (contactId ? entriesByContact.get(contactId) : null);
    const iso = cronosPaymentOfficialISO(p, entry, includeLegacyDueFallback);
    const dateRepair = cronosPaymentDateRepairInfo(p, entry, includeLegacyDueFallback);
    const patient = cronosPatientNameForPayment(p, entry, contactById);
    if(!iso && cronosLegacyManualPaymentNeedsMonthRepair(p)){
      skippedLegacy.push({
        entryId: entryId || entry?.id || "",
        contactId: contactId || entry?.contactId || "",
        patient,
        amount,
        reason: dateRepair?.reason || "Pagamento manual legado sem data/mês confiável: fora do caixa mensal",
        source: "Pagamento manual legado órfão",
        raw: p
      });
      return;
    }
    const financialPlanId = String(p?.financialPlanId || "");
    const financialPaymentId = String(p?.financialPaymentId || "");
    if(entryId && financialPlanId && financialPaymentId){
      planLinks.add(`${entryId}|${financialPlanId}|${financialPaymentId}`);
    }
    const legacyNum = p?.legacyInstallmentNumber || ((String(p?.desc || "").match(/Parcela\s+(\d+)\//i)||[])[1] || "");
    if(entryId && legacyNum){
      legacyLinks.add(`${entryId}|${legacyNum}`);
    }
    addEvent(`cash:${p?.id || idx}:${entryId}:${contactId}:${iso}:${amount}`, amount, iso, {
      id: p?.id,
      entryId: entryId || entry?.id || "",
      contactId: contactId || entry?.contactId || "",
      patient,
      method: p?.method || p?.payMethod || "",
      source: p?.source || "Caixa/Recebimentos",
      desc: p?.desc || p?.description || "Lançamento no caixa/recebimentos",
      dateRepair,
      raw: p
    });
  });

  entries.forEach(entry=>{
    const patient = cronosPatientNameForPayment({}, entry, contactById);
    ensureFinancialPlans(entry).forEach((plan, planIdx)=>{
      const isLegacyAdapterPlan = legacyPlanShouldBeSkippedAsAdapter(entry, plan);
      (plan.payments || []).forEach((p, idx)=>{
        if(!financialPaymentPaid(p)) return;
        const planId = String(plan.id || planIdx);
        const paymentId = String(p.id || idx);
        const link = `${String(entry.id)}|${planId}|${paymentId}`;
        if(planLinks.has(link)) return;
        const iso = cronosPaymentCashISO(p, includeLegacyDueFallback || isLegacyAdapterPlan);
        const amount = cronosPaymentAmount(p);
        const sourceName = isLegacyAdapterPlan ? (plan.title || "Parcelamento legado estruturado") : (plan.title || "Plano financeiro");
        const added = addEvent(`fin:${entry.id}:${planId}:${paymentId}:${iso}:${amount}`, amount, iso, {
          entryId: entry.id,
          contactId: entry.contactId || "",
          patient,
          method: p.payMethod || "",
          source: sourceName,
          desc: `${sourceName} • pagamento ${p.number || idx+1}/${p.total || (plan.payments||[]).length}`,
          raw: p
        });
        if(added) planLinks.add(link);
      });
    });
  });

  entries.forEach(entry=>{
    if(entry?.installPlan?.migratedToFinancialPlanId) return;
    const patient = cronosPatientNameForPayment({}, entry, contactById);
    (entry.installments || []).forEach((p, idx)=>{
      if(!(p?.paidAt || p?.cashDate || p?.paid || String(p?.status || "").toUpperCase()==="PAGA")) return;
      const legacyNum = String(p.number || idx+1);
      if(legacyLinks.has(`${String(entry.id)}|${legacyNum}`)) return;
      const iso = cronosPaymentCashISO(p, includeLegacyDueFallback);
      const amount = cronosPaymentAmount(p);
      addEvent(`legacyInst:${entry.id}:${legacyNum}:${iso}:${amount}`, amount, iso, {
        entryId: entry.id,
        contactId: entry.contactId || "",
        patient,
        method: p.payMethod || entry.installPlan?.payMethod || "",
        source: "Parcelamento legado",
        desc: `Parcela ${legacyNum}/${p.total || ""}`,
        raw: p
      });
    });
  });

  function hasDetailedForEntryInMonth(eid, cid, mk){
    if(!mk) return false;
    return events.some(ev=>{
      const sameEntry = eid && String(ev.entryId || "") === String(eid);
      const sameContact = cid && String(ev.contactId || "") === String(cid);
      return (sameEntry || sameContact) && String(ev.iso || "").slice(0,7) === mk;
    });
  }

  entries.forEach(entry=>{
    const eid = String(entry.id || "");
    const cid = String(entry.contactId || "");
    const patient = cronosPatientNameForPayment({}, entry, contactById);

    const legacyISO = cronosEntryLegacyPaymentISO(entry);
    if(legacyISO){
      const legacyMonth = String(legacyISO).slice(0,7);
      if(hasDetailedForEntryInMonth(eid, cid, legacyMonth)) return;
      const paidDated = getEntryCashPaidValue(entry);
      if(!paidDated) return;
      addEvent(`entryPaid:${eid}:${cid}:${legacyISO}:${paidDated}`, paidDated, legacyISO, {
        entryId: eid,
        contactId: cid,
        patient,
        method: entry.payMethod || entry.paymentMethod || "",
        source: "Lead legado datado",
        desc: "Valor pago salvo no lead — data real de pagamento",
        raw: entry
      });
      return;
    }

    const legacyAnchor = cronosLegacySafeAnchorISO(entry);
    const entryMonth = legacyAnchor?.monthKey || "";
    const paidUndated = getEntryHistoricalValuePaidOnly(entry);
    if(!paidUndated){
      const maybe = getEntryStrictUndatedLegacyPaidValue(entry);
      if(maybe){
        skippedLegacy.push({ entryId:eid, contactId:cid, patient, amount:maybe, reason:"Valor legado sem data ignorado por não ser valuePaid histórico seguro", source:"Lead legado sem data", raw:entry });
      }
      return;
    }

    if(includeUndatedLegacyByEntryMonth && /^\d{4}-\d{2}$/.test(entryMonth)){
      if(hasDetailedForEntryInMonth(eid, cid, entryMonth)) return;
      const anchoredISO = legacyAnchor?.iso || `${entryMonth}-01`;
      addEvent(`entryPaidMonthV84:${eid}:${cid}:${entryMonth}:${paidUndated}`, paidUndated, anchoredISO, {
        entryId: eid,
        contactId: cid,
        patient,
        method: entry.payMethod || entry.paymentMethod || "",
        source: "Lead legado valuePaid",
        desc: "ValuePaid legado recuperado no mês/ano original detectado",
        dateRepair: {
          originalISO: "",
          officialISO: anchoredISO,
          entryMonth,
          reason: legacyAnchor?.reason || "Legado sem data exata preservado fora do ano atual"
        },
        raw: entry
      });
      return;
    }

    skippedLegacy.push({
      entryId: eid,
      contactId: cid,
      patient,
      amount: paidUndated,
      reason: "Lead legado com valuePaid, mas sem mês original confiável: fora do caixa mensal",
      source: "Lead legado sem mês",
      raw: entry
    });
  });

  events.sort((a,b)=>String(a.iso).localeCompare(String(b.iso)) || String(a.patient).localeCompare(String(b.patient)));
  Object.defineProperty(events, "skippedDuplicates", {
    value: skippedDuplicates,
    enumerable: false,
    configurable: true
  });
  Object.defineProperty(events, "skippedLegacy", {
    value: skippedLegacy,
    enumerable: false,
    configurable: true
  });
  return events;
}
function getReceivedEventsForPeriod(db=loadDB(), actor=currentActor(), fromISO="", toISO="", options={}){
  return buildCronosReceivedEvents(db, actor, {...options, fromISO, toISO});
}
function summarizeReceivedEvents(events=[]){
  return (events || []).reduce((acc, ev)=>{
    acc.total += parseMoney(ev.amount);
    acc.count += 1;
    return acc;
  }, {total:0, count:0});
}
function summarizeReceivedForMonth(db=loadDB(), actor=currentActor(), monthKey=monthKeyOf(todayISO()), options={}){
  const [y,m] = String(monthKey || monthKeyOf(todayISO())).split("-").map(Number);
  const fromISO = `${y}-${String(m).padStart(2,"0")}-01`;
  const toISO = `${y}-${String(m).padStart(2,"0")}-${String(new Date(y, m, 0).getDate()).padStart(2,"0")}`;
  return summarizeReceivedEvents(getReceivedEventsForPeriod(db, actor, fromISO, toISO, options));
}
window.buildCronosReceivedEvents = buildCronosReceivedEvents;
window.getReceivedEventsForPeriod = getReceivedEventsForPeriod;
window.summarizeReceivedForMonth = summarizeReceivedForMonth;
window.cronosAuditRecebidos = function(monthKey){
  const mk = String(monthKey || monthKeyOf(todayISO())).slice(0,7);
  const y = Number(mk.slice(0,4));
  const m = Number(mk.slice(5,7));
  const fromISO = `${y}-${String(m).padStart(2,"0")}-01`;
  const toISO = `${y}-${String(m).padStart(2,"0")}-${String(new Date(y,m,0).getDate()).padStart(2,"0")}`;
  const events = getReceivedEventsForPeriod(loadDB(), currentActor(), fromISO, toISO, { includeLegacyDueFallback:false, includeUndatedLegacyByEntryMonth:true });
  const rows = events.map((ev, idx)=>({
    n: idx+1,
    data: fmtBR(ev.iso),
    paciente: ev.patient,
    valor: moneyBR(ev.amount),
    fonte: ev.source,
    detalhe: ev.desc,
    dataOriginal: ev.dateRepair?.originalISO ? fmtBR(ev.dateRepair.originalISO) : "",
    correcao: ev.dateRepair?.reason || "",
    chave: ev.looseKey || ev.key
  }));
  const skipped = (events.skippedDuplicates || []).map((ev, idx)=>({
    n: idx+1,
    data: fmtBR(ev.iso),
    paciente: ev.patient,
    valor: moneyBR(ev.amount),
    ignorado: ev.skippedSource,
    mantido: ev.keptSource,
    chave: ev.looseKey
  }));
  const legacySkipped = (events.skippedLegacy || []).map((ev, idx)=>({
    n: idx+1,
    paciente: ev.patient,
    valor: moneyBR(ev.amount),
    fonte: ev.source || "Lead/pagamento legado",
    motivo: ev.reason
  }));
  const total = events.reduce((s,ev)=>s+parseMoney(ev.amount),0);
  console.log(`CRONOS AUDITORIA RECEBIDOS ${mk}: ${moneyBR(total)} em ${events.length} baixa(s).`);
  console.table(rows);
  if(skipped.length){
    console.warn(`Duplicidades ignoradas: ${skipped.length}`);
    console.table(skipped);
  }else{
    console.log("Nenhuma duplicidade ignorada.");
  }
  if(legacySkipped.length){
    console.warn(`Valores legados sem data real fora do caixa mensal: ${legacySkipped.length}`);
    console.table(legacySkipped);
  }
  return { total, count: events.length, rows, skipped, legacySkipped };
};
window.cronosAuditRecebidosPorFonte = function(monthKey){
  const mk = String(monthKey || monthKeyOf(todayISO())).slice(0,7);
  const fromISO = `${mk}-01`;
  const toISO = endOfMonthISO(mk);
  const events = getReceivedEventsForPeriod(loadDB(), currentActor(), fromISO, toISO, { includeLegacyDueFallback:false, includeUndatedLegacyByEntryMonth:true });
  const by = new Map();
  (events || []).forEach(ev=>{
    const key = ev.source || ev.sourceGroup || 'Sem fonte';
    const item = by.get(key) || { fonte:key, total:0, baixas:0 };
    item.total += parseMoney(ev.amount);
    item.baixas += 1;
    by.set(key, item);
  });
  const rows = Array.from(by.values()).map(x=>({ ...x, totalBR: moneyBR(x.total) })).sort((a,b)=>b.total-a.total);
  console.table(rows);
  return rows;
};

window.cronosAuditRecebidosTotalPorFonte = function(){
  const events = buildCronosReceivedEvents(loadDB(), currentActor(), { includeLegacyDueFallback:false, includeUndatedLegacyByEntryMonth:true, untilToday:true });
  const by = new Map();
  (events || []).forEach(ev=>{
    const key = ev.source || ev.sourceGroup || 'Sem fonte';
    const item = by.get(key) || { fonte:key, total:0, baixas:0 };
    item.total += parseMoney(ev.amount);
    item.baixas += 1;
    by.set(key, item);
  });
  const rows = Array.from(by.values()).map(x=>({ ...x, totalBR: moneyBR(x.total) })).sort((a,b)=>b.total-a.total);
  const total = rows.reduce((sum,x)=>sum+parseMoney(x.total),0);
  console.log(`CRONOS AUDITORIA TOTAL RECEBIDO (v83): ${moneyBR(total)} em ${(events||[]).length} baixa(s).`);
  console.table(rows);
  if(events.skippedDuplicates?.length){
    console.warn(`Adaptadores/duplicidades ignorados: ${events.skippedDuplicates.length}`);
  }
  return { total, totalBR: moneyBR(total), count:(events||[]).length, rows, skippedDuplicates:events.skippedDuplicates||[], skippedLegacy:events.skippedLegacy||[] };
};

window.cronosAuditPacientePagamentos = function(nome){
  const termo = String(nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const db = loadDB();
  const actor = currentActor();
  const masterId = actor?.masterId || actor?.clinicId || "";
  const contacts = (db?.contacts || []).filter(c=>!masterId || !c.masterId || c.masterId===masterId);
  const entries = (db?.entries || []).filter(e=>!masterId || !e.masterId || e.masterId===masterId);
  const contactById = new Map(contacts.map(c=>[String(c.id), c]));
  const entryById = new Map(entries.map(e=>[String(e.id), e]));
  const entriesByContact = new Map();
  entries.forEach(e=>{ const cid = String(e.contactId||""); if(cid && !entriesByContact.has(cid)) entriesByContact.set(cid, e); });
  const norm = v=>String(v||"").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const rows = [];
  (db?.payments || []).forEach((p,idx)=>{
    const entry = p?.entryId ? entryById.get(String(p.entryId)) : (p?.contactId ? entriesByContact.get(String(p.contactId)) : null);
    const patient = cronosPatientNameForPayment(p, entry, contactById);
    if(termo && !norm(patient).includes(termo)) return;
    const oficial = cronosPaymentOfficialISO(p, entry, false);
    const original = cronosPaymentCashISO(p, false);
    rows.push({
      n: idx+1,
      paciente: patient,
      valor: moneyBR(cronosPaymentAmount(p)),
      dataOriginal: original ? fmtBR(original) : "",
      dataUsadaNoCaixa: oficial ? fmtBR(oficial) : "",
      mesLead: String(entry?.monthKey || ""),
      desc: p?.desc || p?.description || "",
      source: p?.source || "",
      status: p?.status || "",
      entryId: p?.entryId || "",
      paymentId: p?.id || ""
    });
  });
  console.table(rows);
  return rows;
};

function financialPlanTotals(plan){
  plan = plan || {};
  const total = parseMoney(plan.amount || plan.total || 0);
  const payments = Array.isArray(plan.payments) ? plan.payments : [];
  const scheduled = payments.reduce((s,p)=>s+parseMoney(p.amount),0);
  const paid = payments.filter(financialPaymentPaid).reduce((s,p)=>s+parseMoney(p.amount),0);
  const pending = payments.filter(p=>!financialPaymentPaid(p)).reduce((s,p)=>s+parseMoney(p.amount),0);
  const remainingToSchedule = Math.max(0, total - scheduled);
  const openBalance = Math.max(0, total - paid);
  return {total, scheduled, paid, pending, remainingToSchedule, openBalance};
}

function financialPlanNextDue(plan){
  const pending = (plan?.payments || []).filter(p=>!financialPaymentPaid(p) && p.dueDate);
  pending.sort((a,b)=>String(a.dueDate||"").localeCompare(String(b.dueDate||"")));
  return pending[0]?.dueDate || "";
}

function financialPlanStatusLabel(plan){
  const st = String(plan?.status || "Aguardando");
  if(st.toLowerCase().includes("aprov")) return `<span class="badge ok">Aprovado</span>`;
  if(st.toLowerCase().includes("reprov")) return `<span class="badge late">Reprovado</span>`;
  if(st.toLowerCase().includes("concl")) return `<span class="badge ok">Concluído</span>`;
  return `<span class="badge pending">Aguardando</span>`;
}

function getFinancialPlan(db, entryId, planId){
  const entry = (db.entries||[]).find(e=>String(e.id)===String(entryId));
  if(!entry) return {entry:null, plan:null};
  const plan = ensureFinancialPlans(entry).find(p=>String(p.id)===String(planId));
  return {entry, plan};
}

function ensureNewInstallmentButton(){
  try{
    const list = el("instList");
    if(!list || el("instNewFlowBar")) return;
    const bar = document.createElement("div");
    bar.id = "instNewFlowBar";
    bar.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0 16px;padding:12px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.03)";
    bar.innerHTML = `
      <div>
        <div style="font-weight:900">Recebimentos</div>
        <div class="muted" style="font-size:12px">Escolha o paciente, vincule procedimentos da ficha e lance pagamentos à vista ou parcelados.</div>
      </div>
      <button class="btn primary" type="button" onclick="openNewFinancialInstallment()">+ Novo recebimento</button>
    `;
    list.parentNode.insertBefore(bar, list);
  }catch(e){
    console.warn("Não foi possível inserir botão de novo recebimento:", e);
  }
}

function buildFinancialPlanCards(db, actor, mk, q, filter, today){
  const contactsById = new Map((db.contacts||[]).filter(c=>c.masterId===actor.masterId).map(c=>[String(c.id),c]));
  const rows = [];
  (db.entries||[])
    .filter(e=>e.masterId===actor.masterId)
    .forEach(entry=>{
      const plans = ensureFinancialPlans(entry);
      if(!plans.length) return;
      const contact = contactsById.get(String(entry.contactId)) || {name:"(sem nome)", phone:""};
      const hay = `${contact.name||""} ${contact.phone||""}`.toLowerCase();
      if(q && !hay.includes(q)) return;

      plans.forEach(plan=>{
        renumberFinancialPlanPayments(plan);
        const payments = Array.isArray(plan.payments) ? plan.payments : [];
        const monthPayments = payments.filter(p=>{
          const paid = financialPaymentPaid(p);
          const cashISO = cronosPaymentCashISO(p, false);
          const dueISO = p?.dueDate || p?.due || "";
          if(paid) return cashISO && monthKeyOf(cashISO) === mk;
          return dueISO && monthKeyOf(dueISO) === mk;
        });
        if(!monthPayments.length) return;

        let paidSum=0, pendingSum=0, lateSum=0, futureSum=0;
        let paidCount=0, pendingCount=0, lateCount=0, futureCount=0;

        monthPayments.forEach(p=>{
          const paid = financialPaymentPaid(p);
          const amount = parseMoney(p.amount);
          if(paid){
            const cashISO = cronosPaymentCashISO(p, false);
            if(cashISO && monthKeyOf(cashISO) === mk){ paidSum += amount; paidCount++; }
            return;
          }
          pendingSum += amount; pendingCount++;
          if(p.dueDate && p.dueDate < today){ lateSum += amount; lateCount++; }
          else { futureSum += amount; futureCount++; }
        });

        if(filter === "paid" && paidCount <= 0) return;
        if(filter === "dueMonth" && pendingCount <= 0) return;
        if(filter === "late" && lateCount <= 0) return;
        if(filter === "open" && futureCount <= 0) return;

        rows.push({entry, contact, plan, monthPayments, paidSum, pendingSum, lateSum, futureSum, paidCount, pendingCount, lateCount, futureCount});
      });
    });

  rows.sort((A,B)=>{
    const aRank = A.lateCount>0 ? 3 : A.pendingCount>0 ? 2 : A.paidCount>0 ? 1 : 0;
    const bRank = B.lateCount>0 ? 3 : B.pendingCount>0 ? 2 : B.paidCount>0 ? 1 : 0;
    if(aRank !== bRank) return bRank - aRank;
    const ad = cronosPaymentCashISO(A.monthPayments[0], false) || A.monthPayments[0]?.dueDate || "9999-99-99";
    const bd = cronosPaymentCashISO(B.monthPayments[0], false) || B.monthPayments[0]?.dueDate || "9999-99-99";
    return ad.localeCompare(bd);
  });

  if(!rows.length) return "";

  return `
    <div style="margin-bottom:10px;font-weight:900">Novo modelo de orçamentos</div>
    ${rows.map(({entry, contact, plan, monthPayments, paidSum, pendingSum, lateSum, futureSum, paidCount, pendingCount, lateCount, futureCount})=>{
      const totals = financialPlanTotals(plan);
      const nextDue = financialPlanNextDue(plan);
      const rowId = `finrow_${entry.id}_${plan.id}`;
      const badges = [];
      if(paidCount) badges.push(`<span class="badge ok">✅ ${paidCount} paga(s)</span>`);
      if(lateCount) badges.push(`<span class="badge late">⚠️ ${lateCount} atrasada(s)</span>`);
      if(futureCount) badges.push(`<span class="badge pending">🕒 ${futureCount} pendente(s)</span>`);
      const periodDetails = monthPayments.map(p=>{
        const paid = financialPaymentPaid(p);
        const cashISO = cronosPaymentCashISO(p, false);
        const late = !paid && p.dueDate && p.dueDate < today;
        const statusChip = paid ? `<span class="badge ok">PAGA</span>` : (late ? `<span class="badge late">ATRASADA</span>` : `<span class="badge pending">PENDENTE</span>`);
        const dateTxt = paid ? `Pago: ${fmtBR(cashISO || p.paidAt || p.cashDate || "")}` : `Venc: ${fmtBR(p.dueDate)}`;
        return `<div class="chip">${p.number||""}/${p.total||""} • ${dateTxt} • <b>${moneyBR(p.amount)}</b> ${statusChip}</div>`;
      }).join("");

      return `
        <div class="instRow" id="${rowId}">
          <div class="instHead">
            <div style="min-width:0">
              <div class="instName">${escapeHTML(contact.name)} <span class="muted" style="font-weight:600">• ${escapeHTML(contact.phone||"")}</span></div>
              <div class="instMeta">
                <span class="chip">Orçamento: <b>${escapeHTML(plan.title || "Plano financeiro")}</b></span>
                ${financialPlanStatusLabel(plan)}
                <span class="chip">Total: <b>${moneyBR(totals.total)}</b></span>
                <span class="chip">Lançado: <b>${moneyBR(totals.scheduled)}</b></span>
                <span class="chip">Pago: <b>${moneyBR(totals.paid)}</b></span>
                <span class="chip">Saldo aberto: <b>${moneyBR(totals.openBalance)}</b></span>
                <span class="chip">Próx.: <b>${nextDue ? fmtBR(nextDue) : "—"}</b></span>
                ${badges.join(" ")}
              </div>
              <div class="instMeta">
                <span class="chip">Pagas no mês: <b>${moneyBR(paidSum)}</b></span>
                <span class="chip">Pendentes no mês: <b>${moneyBR(pendingSum)}</b></span>
                <span class="chip">Atrasado no mês: <b>${moneyBR(lateSum)}</b></span>
                <span class="chip">Futuro no mês: <b>${moneyBR(futureSum)}</b></span>
              </div>
              <div class="instMeta" style="margin-top:8px">${periodDetails}</div>
            </div>
            <div class="instBtns">
              <button class="btn" onclick="openLeadEntry('${entry.id}')">Abrir lead</button>
              <button class="btn primary" onclick="openNewFinancialInstallment('${entry.id}','${plan.id}')">Gerenciar</button>
              <button class="btn" data-toggle-inst="${rowId}" onclick="toggleFinancialPlanRow('${rowId}')">Ver pagamentos</button>
            </div>
          </div>
          <div class="instBody">
            ${renderFinancialPaymentTable(entry, plan, contact)}
          </div>
        </div>
      `;
    }).join("")}
    <div style="height:10px"></div>
  `;
}

function renderFinancialPaymentTable(entry, plan, contact){
  renumberFinancialPlanPayments(plan);
  const today = todayISO();
  const canSensitive = canManageFinancialSensitiveActions();
  const rows = (plan.payments||[]).map(p=>{
    const paid = financialPaymentPaid(p);
    const late = !paid && p.dueDate && p.dueDate < today;
    const st = paid ? `<span class="badge ok">PAGO</span>` : (late ? `<span class="badge late">ATRASADO</span>` : `<span class="badge pending">PENDENTE</span>`);
    const action = paid
      ? (canSensitive
          ? `<a class="miniLink" href="javascript:void(0)" onclick="undoFinancialPayment('${entry.id}','${plan.id}','${p.id}')">Desfazer</a>`
          : `<span class="muted" style="font-size:12px">Pago</span>`)
      : `<button type="button" class="btn ok" onclick="payFinancialPayment('${entry.id}','${plan.id}','${p.id}')">Dar baixa</button>`;
    const transfer = (paid && canSensitive) ? `<a class="miniLink" href="javascript:void(0)" onclick="transferFinancialPaymentCashDate('${entry.id}','${plan.id}','${p.id}')">Transferir data</a>` : "";
    const cashISO = cronosPaymentCashISO(p, false);
    const deleteBtn = canSensitive ? `<button type="button" class="miniBtn danger" onclick="deleteFinancialPayment('${entry.id}','${plan.id}','${p.id}')" title="Excluir pagamento">🗑️</button>` : "";
    return `
      <tr>
        <td class="mono">${p.number||""}/${p.total||""}</td>
        <td class="mono">${p.dueDate?fmtBR(p.dueDate):"—"}</td>
        <td class="mono">${moneyBR(p.amount)}</td>
        <td>${escapeHTML(p.payMethod || "—")}</td>
        <td>${st}${cashISO ? `<div class="muted" style="font-size:12px">caixa: ${fmtBR(cashISO)}</div>` : ""}</td>
        <td style="white-space:nowrap; display:flex; gap:10px; align-items:center; flex-wrap:wrap">${action} ${transfer} ${deleteBtn}</td>
      </tr>
    `;
  }).join("");
  return `
    <table class="instTable financialPaymentTable" style="width:auto;min-width:720px;max-width:820px;table-layout:fixed">
      <colgroup>
        <col style="width:72px">
        <col style="width:112px">
        <col style="width:128px">
        <col style="width:145px">
        <col style="width:125px">
        <col style="width:138px">
      </colgroup>
      <thead><tr>
        <th>Parcela</th><th>Venc.</th><th>Valor</th><th>Forma</th><th>Status</th><th>Ações</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="muted">Nenhum pagamento lançado nesse orçamento.</td></tr>`}</tbody>
    </table>
  `;
}

function toggleFinancialPlanRow(rowId){
  window.__instOpen = window.__instOpen || {};
  const row = el(rowId);
  if(!row) return;
  row.classList.toggle("open");
  window.__instOpen[rowId] = row.classList.contains("open");
  const btn = row.querySelector(`[data-toggle-inst="${rowId}"]`);
  if(btn) btn.textContent = row.classList.contains("open") ? "Fechar pagamentos" : "Ver pagamentos";
}

function findFinancePaymentRecord(db, entryId, planId, paymentId){
  return (db.payments||[]).find(p=>String(p.entryId)===String(entryId) && String(p.financialPlanId)===String(planId) && String(p.financialPaymentId)===String(paymentId));
}

function canManageFinancialSensitiveActions(actor=currentActor()){
  const role = String(actor?.role || "").toUpperCase();
  return !!actor && (actor.isPrimaryMaster === true || role === "MASTER" || role === "GERENTE");
}

function blockedFinancialSensitiveAction(){
  toast("Acesso limitado", "Só gerente e Master podem aprovar, desfazer baixa, transferir data ou excluir recebimentos/parcelas.");
  return false;
}


function askPaymentCashDate({title="Data do pagamento", subtitle="", defaultDate=todayISO()}={}){
  return new Promise(resolve=>{
    const old = document.getElementById("cronosCashDateModal");
    if(old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = "cronosCashDateModal";
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(6px)";
    overlay.innerHTML = `
      <div style="width:min(420px,96vw);border:1px solid var(--line);border-radius:20px;background:var(--panel);box-shadow:var(--shadow);padding:18px;color:var(--text)">
        <div style="font-size:18px;font-weight:900;margin-bottom:6px">${escapeHTML(title)}</div>
        <div class="muted" style="font-size:13px;line-height:1.4;margin-bottom:14px">${escapeHTML(subtitle || "Escolha o dia em que o dinheiro realmente entrou no caixa.")}</div>
        <label class="muted" style="display:block;font-size:12px;margin-bottom:6px">Data do pagamento / caixa</label>
        <input id="cronosCashDateInput" class="input" type="date" value="${escapeHTML(String(defaultDate || todayISO()).slice(0,10))}" style="width:100%">
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;flex-wrap:wrap">
          <button type="button" class="btn" id="cronosCashDateCancel">Cancelar</button>
          <button type="button" class="btn primary" id="cronosCashDateConfirm">Confirmar baixa</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = document.getElementById("cronosCashDateInput");
    const finish = (val)=>{
      overlay.remove();
      resolve(val);
    };
    document.getElementById("cronosCashDateCancel")?.addEventListener("click", ()=>finish(null));
    document.getElementById("cronosCashDateConfirm")?.addEventListener("click", ()=>{
      const v = String(input?.value || "").slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(v)){
        try{ toast("Data inválida", "Escolha uma data válida no calendário."); }catch(_){}
        return;
      }
      finish(v);
    });
    overlay.addEventListener("click", ev=>{
      if(ev.target === overlay) finish(null);
    });
    input?.focus();
    if(input?.showPicker){
      setTimeout(()=>{ try{ input.showPicker(); }catch(_){} }, 120);
    }
  });
}

async function payFinancialPayment(entryId, planId, paymentId){
  const actor = currentActor();
  const db = loadDB();
  const {entry, plan} = getFinancialPlan(db, entryId, planId);
  if(!entry || !plan) return toast("Erro", "Recebimento não encontrado.");
  const payment = (plan.payments||[]).find(p=>String(p.id)===String(paymentId));
  if(!payment) return toast("Erro", "Pagamento não encontrado.");
  if(financialPaymentPaid(payment)) return toast("Já foi", "Esse pagamento já está baixado.");

  const payDate = await askPaymentCashDate({
    title: "Dar baixa no pagamento",
    subtitle: `${plan.title || "Plano financeiro"} • ${moneyBR(payment.amount)}${payment.dueDate ? ` • venc. ${fmtBR(payment.dueDate)}` : ""}`,
    defaultDate: todayISO()
  });
  if(!payDate) return;

  payment.status = "PAGA";
  payment.paidAt = payDate;
  payment.cashDate = payDate;

  db.payments = db.payments || [];
  let rec = findFinancePaymentRecord(db, entryId, planId, paymentId);
  if(!rec){
    rec = {
      id: uid("p"),
      masterId: actor.masterId,
      entryId,
      contactId: entry.contactId || "",
      financialPlanId: planId,
      financialPaymentId: paymentId,
      at: new Date().toISOString(),
      date: payDate,
      paidAt: payDate,
      cashDate: payDate,
      status: "PAGA",
      value: parseMoney(payment.amount),
      method: payment.payMethod || "",
      desc: `Orçamento: ${plan.title || "Plano financeiro"} • Pagamento ${payment.number || ""}/${payment.total || ""}`,
      source: "financialPlan"
    };
    db.payments.push(rec);
  }else{
    rec.date = payDate;
    rec.paidAt = payDate;
    rec.cashDate = payDate;
    rec.status = "PAGA";
    rec.at = new Date().toISOString();
    rec.value = parseMoney(payment.amount);
    rec.method = payment.payMethod || rec.method || "";
  }

  syncInstallmentTasks(db, actor);
  if(Array.isArray(plan.fichaItemIds)){
    const fullyPaid = financialPlanIsFullyPaid(plan);
    ensureFicha(entry).plano.forEach(item=>{
      if(plan.fichaItemIds.map(String).includes(String(item.id))){
        item.pago = !!fullyPaid;
        item.financeStatus = fullyPaid ? "pago" : "em_pagamento";
      }
    });
  }

  saveDB(db, { immediate:true });
  toast("Baixa feita ✅", `${moneyBR(payment.amount)} • caixa em ${fmtBR(payDate)}`);
  renderAll();
}
function undoFinancialPayment(entryId, planId, paymentId){
  const actor = currentActor();
  if(!canManageFinancialSensitiveActions(actor)) return blockedFinancialSensitiveAction();
  const db = loadDB();
  const {entry, plan} = getFinancialPlan(db, entryId, planId);
  if(!entry || !plan) return toast("Erro", "Recebimento não encontrado.");
  const payment = (plan.payments||[]).find(p=>String(p.id)===String(paymentId));
  if(!payment) return toast("Erro", "Pagamento não encontrado.");

  payment.status = "PENDENTE";
  payment.paidAt = "";
  payment.cashDate = "";
  db.payments = (db.payments||[]).filter(p=>!(String(p.entryId)===String(entryId) && String(p.financialPlanId)===String(planId) && String(p.financialPaymentId)===String(paymentId)));

  if(Array.isArray(plan.fichaItemIds)){
    ensureFicha(entry).plano.forEach(item=>{
      if(plan.fichaItemIds.map(String).includes(String(item.id))){
        item.pago = false;
        item.financeStatus = "em_pagamento";
      }
    });
  }

  syncInstallmentTasks(db, actor);
  saveDB(db, { immediate:true });
  toast("Baixa desfeita", "Pagamento voltou para pendente.");
  renderAll();
}

async function transferFinancialPaymentCashDate(entryId, planId, paymentId){
  const actor = currentActor();
  if(!canManageFinancialSensitiveActions(actor)) return blockedFinancialSensitiveAction();
  const db = loadDB();
  const {plan} = getFinancialPlan(db, entryId, planId);
  if(!plan) return toast("Erro", "Recebimento não encontrado.");
  const payment = (plan.payments||[]).find(p=>String(p.id)===String(paymentId));
  if(!payment || !financialPaymentPaid(payment)) return toast("Transferência", "Só dá para transferir pagamento baixado.");
  const current = cronosPaymentCashISO(payment, false) || todayISO();
  const next = await askPaymentCashDate({
    title: "Transferir data do caixa",
    subtitle: `${plan.title || "Plano financeiro"} • ${moneyBR(payment.amount)}. Escolha em que mês/dia esse pagamento deve contar.`,
    defaultDate: current
  });
  if(!next) return;

  payment.cashDate = next;
  payment.paidAt = next;
  const rec = findFinancePaymentRecord(db, entryId, planId, paymentId);
  if(rec){
    rec.date = next;
    rec.cashDate = next;
    rec.paidAt = next;
    rec.status = "PAGA";
    rec.at = `${next}T12:00:00.000`;
  }
  saveDB(db, { immediate:true });
  toast("Data transferida ✅", `Caixa: ${fmtBR(next)}`);
  renderAll();
}
function deleteFinancialPayment(entryId, planId, paymentId){
  const actor = currentActor();
  if(!canManageFinancialSensitiveActions(actor)) return blockedFinancialSensitiveAction();
  if(!confirm("Excluir este pagamento/parcela?")) return;
  const db = loadDB();
  const {entry, plan} = getFinancialPlan(db, entryId, planId);
  if(!entry || !plan) return toast("Erro", "Recebimento não encontrado.");

  const before = Array.isArray(plan.payments) ? plan.payments.length : 0;
  plan.payments = (plan.payments||[]).filter(p=>String(p.id)!==String(paymentId));
  const after = plan.payments.length;
  if(before === after) return toast("Atenção", "Não encontrei essa parcela para excluir.");

  renumberFinancialPlanPayments(plan);
  db.payments = (db.payments||[]).filter(p=>!(String(p.entryId)===String(entryId) && String(p.financialPlanId)===String(planId) && String(p.financialPaymentId)===String(paymentId)));
  syncInstallmentTasks(db, actor);
  const cloudPromise = saveDB(db, { immediate:true });
  toast("Pagamento removido");
  try{ renderNewFinancialInstallmentApp(); }catch(_){}
  try{ renderInstallmentsView(); }catch(_){}
  try{ renderDashboard(); }catch(_){}
  Promise.resolve(cloudPromise).catch(err=>console.warn("Falha ao salvar exclusão de pagamento:", err));
}

function openNewFinancialInstallment(entryId="", planId=""){
  let finalPlanId = String(planId||"");
  try{
    if(entryId){
      const db = loadDB();
      const entry = (db.entries||[]).find(e=>String(e.id)===String(entryId));
      const migratedPlan = entry ? migrateLegacyInstallmentsToFinancialPlan(entry) : null;
      const plans = entry ? ensureFinancialPlans(entry) : [];
      const passedPlanExists = finalPlanId && plans.some(p=>String(p.id)===String(finalPlanId));
      if(migratedPlan && (!finalPlanId || !passedPlanExists)){
        finalPlanId = String(migratedPlan.id);
      }else if(!finalPlanId && plans.length){
        finalPlanId = String(plans[0].id);
      }
      if(migratedPlan){
        try{ syncInstallmentTasks(db, currentActor()); }catch(_){}
        saveDB(db, { immediate:true });
      }
    }
  }catch(e){ console.warn("Migração legado ao abrir recebimento falhou:", e); }

  const st = {
    search:"",
    entryId: String(entryId||""),
    planId: finalPlanId
  };
  window.__newFinancialInstallmentState = st;
  openModal({
    title: entryId ? "Gerenciar recebimento" : "Novo recebimento",
    sub: entryId ? "Veja recebimentos existentes, parcelas e vínculos com a ficha." : "Crie recebimentos à vista, parcelados ou vinculados à ficha do paciente.",
    bodyHTML:'<div id="newFinancialInstallmentApp" style="width:100%"></div>',
    footHTML:'<button class="btn" onclick="closeModal()">Fechar</button>',
    onMount: renderNewFinancialInstallmentApp,
    maxWidth:'min(99vw, 1280px)',
    width:'min(99vw, 1280px)'
  });
}


function renderFinancialPlanPaymentEditor(entry, selectedPlan, contact, remaining){
  if(!entry || !selectedPlan) return "";
  return `
    <div class="card selectedPlanPaymentEditor" style="box-shadow:none;margin-top:12px;padding:12px;border-radius:16px;background:rgba(255,255,255,.025);border:1px solid var(--line)">
      <h3 style="margin:0 0 10px">3. Lançar parcelas</h3>
      <div class="newPayLayout" style="display:grid;grid-template-columns:max-content max-content;gap:12px;align-items:end;max-width:max-content">
        <div style="display:grid;gap:10px;min-width:0">
          <div class="newPayTopGrid" style="display:grid;grid-template-columns:145px 165px 125px 78px;gap:10px;align-items:end">
            <div style="min-width:0">
              <label>Vencimento inicial</label>
              <input id="newPayDue" type="date" value="${todayISO()}">
            </div>
            <div style="min-width:0">
              <label>Forma</label>
              <select id="newPayMethod">
                <option>Carnê/Boleto</option>
                <option>Pix</option>
                <option>Dinheiro</option>
                <option>Cartão de crédito</option>
                <option>Cartão de débito</option>
              </select>
            </div>
            <div style="min-width:0">
              <label>Valor</label>
              <input id="newPayAmount" type="number" step="0.01" value="${remaining ? Number(remaining.toFixed(2)) : ""}" placeholder="0,00">
            </div>
            <div style="min-width:0">
              <label>Qtd.</label>
              <input id="newPayCount" type="number" min="1" step="1" value="1">
            </div>
          </div>

          <div class="newPayObsGrid" style="display:grid;grid-template-columns:130px 280px;gap:10px;align-items:start">
            <div style="min-width:0">
              <label>Status inicial</label>
              <select id="newPayStatus">
                <option value="PENDENTE">Pendente</option>
                <option value="PAGA">Pago</option>
              </select>
            </div>
            <div style="min-width:0">
              <label>Observação</label>
              <textarea id="newPayObs" rows="1" placeholder="Opcional" style="resize:vertical;min-height:44px;max-height:160px;width:100%;box-sizing:border-box"></textarea>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:8px;align-items:end;align-self:end;flex-wrap:wrap;justify-content:flex-start">
          <button type="button" class="btn primary" style="width:auto;white-space:nowrap;padding-inline:14px" onclick="CRONOS_NEW_FIN_UI.addPayment()">Adicionar parcela</button>
          <button type="button" class="btn" style="width:auto;white-space:nowrap;padding-inline:14px" onclick="CRONOS_NEW_FIN_UI.fillRemaining()">Usar saldo restante</button>
        </div>
      </div>
      <div style="margin-top:14px">${renderFinancialPaymentTable(entry, selectedPlan, contact)}</div>
    </div>
  `;
}

function renderNewFinancialInstallmentApp(){
  const box = el("newFinancialInstallmentApp");
  if(!box) return;
  const actor = currentActor();
  const db = loadDB();
  const st = window.__newFinancialInstallmentState || {search:"",entryId:"",planId:""};
  const contactsById = new Map((db.contacts||[]).filter(c=>c.masterId===actor.masterId).map(c=>[String(c.id),c]));
  const entry = (db.entries||[]).find(e=>String(e.id)===String(st.entryId));
  const contact = entry ? contactsById.get(String(entry.contactId)) : null;
  const plans = entry ? ensureFinancialPlans(entry) : [];
  let selectedPlan = plans.find(p=>String(p.id)===String(st.planId)) || null;
  if(entry && !selectedPlan && plans.length){
    selectedPlan = plans[0];
    st.planId = String(selectedPlan.id);
    window.__newFinancialInstallmentState = st;
  }
  const canSensitive = canManageFinancialSensitiveActions();
  const q = String(st.search||"").trim().toLowerCase();

  const suggestions = !entry && q
    ? (db.entries||[])
        .filter(e=>e.masterId===actor.masterId)
        .map(e=>({entry:e, contact:contactsById.get(String(e.contactId)) || {name:"(sem nome)", phone:""}}))
        .filter(x=>`${x.contact.name||""} ${x.contact.phone||""}`.toLowerCase().includes(q))
        .slice(0,10)
    : [];

  const fichaForRecebimentos = entry ? ensureFichaForRecebimentos(entry) : null;
  const fichaSelectableItems = fichaForRecebimentos ? fichaForRecebimentos.plano.filter(item=>isFichaItemAvailableForRecebimentos(entry, item)) : [];
  const selectedNewFinFichaIds = new Set(Array.isArray(st.fichaItemIds) ? st.fichaItemIds.map(String) : []);
  const selectedNewFinFichaItems = fichaSelectableItems.filter(item=>selectedNewFinFichaIds.has(String(item.id)));
  const selectedNewFinFichaTotal = selectedNewFinFichaItems.reduce((sum,item)=>sum + Number(item.valorFechado || 0), 0);
  const defaultTotal = selectedNewFinFichaTotal || (entry ? suggestedFinancialPlanTotal(entry) : 0);
  const totals = selectedPlan ? financialPlanTotals(selectedPlan) : null;
  const remaining = totals ? totals.remainingToSchedule : 0;

  box.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr;gap:14px">
      <div class="card" style="box-shadow:none">
        <h3 style="margin:0 0 10px">1. Paciente</h3>
        ${entry ? `
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
            <div>
              <div style="font-weight:900">${escapeHTML(contact?.name || "(sem nome)")}</div>
              <div class="muted">${escapeHTML(contact?.phone || "")} • Lead ${escapeHTML(String(entry.id||""))}</div>
            </div>
            <button type="button" class="btn small" onclick="CRONOS_NEW_FIN_UI.clearPatient()">Trocar paciente</button>
          </div>
        ` : `
          <label>Buscar paciente/lead</label>
          <input id="newFinSearch" value="${escapeHTML(st.search||"")}" placeholder="Digite nome ou telefone" oninput="CRONOS_NEW_FIN_UI.search(this.value)">
          <div style="display:grid;gap:8px;margin-top:10px">
            ${suggestions.length ? suggestions.map(x=>`
              <button type="button" class="btn" style="text-align:left;justify-content:flex-start" onpointerdown="return CRONOS_NEW_FIN_UI.selectPatientFromEvent(event,'${escapeHTML(x.entry.id)}')" onclick="return CRONOS_NEW_FIN_UI.selectPatientFromEvent(event,'${escapeHTML(x.entry.id)}')">
                <b>${escapeHTML(x.contact.name || "(sem nome)")}</b> <span class="muted">• ${escapeHTML(x.contact.phone||"")} • ${monthLabel(x.entry.monthKey||new Date().toISOString().slice(0,7))}</span>
              </button>
            `).join("") : `<div class="muted">Digite para encontrar um lead já cadastrado.</div>`}
          </div>
        `}
      </div>

      ${entry ? `
        <div class="card" style="box-shadow:none">
          <h3 style="margin:0 0 10px">2. Recebimentos do paciente</h3>
          <div class="small muted" style="margin-top:-6px;margin-bottom:10px">Recebimentos já existentes aparecem aqui mesmo que não tenham vindo da ficha.</div>
          ${fichaSelectableItems.length ? `
            <div style="border:1px solid var(--line);border-radius:14px;padding:10px;background:rgba(255,255,255,.025);margin-bottom:12px">
              <div style="font-weight:900;margin-bottom:6px">Procedimentos disponíveis da ficha</div>
              <div class="small muted" style="margin-bottom:8px">Selecione um ou mais procedimentos para gerar um recebimento vinculado. Os que já estão pagos ou em pagamento não aparecem aqui.</div>
              <div style="display:grid;gap:8px;max-height:190px;overflow:auto">
                ${fichaSelectableItems.map(item=>`
                  <label class="recebFichaItem" style="display:grid;grid-template-columns:28px minmax(0,1fr) 120px;align-items:center;gap:10px;border:1px solid var(--line);border-radius:14px;padding:10px 12px;background:rgba(255,255,255,.035);cursor:pointer">
                    <input type="checkbox" style="margin:0;width:18px;height:18px" ${selectedNewFinFichaIds.has(String(item.id)) ? 'checked' : ''} onchange="CRONOS_NEW_FIN_UI.toggleFichaItem('${escapeHTML(item.id)}')">
                    <span style="min-width:0;display:block">
                      <b style="display:block;white-space:normal;line-height:1.25">${escapeHTML(item.procedimento || '—')}</b>
                      <span class="small muted">${escapeHTML(item.avaliacaoLabel || 'Avaliação')} • ${fmtBR(item.avaliacaoData || '')}${item.dente ? ` • Dente ${escapeHTML(item.dente)}` : ''}${item.face ? ` • Face ${escapeHTML(item.face)}` : ''}</span>
                    </span>
                    <b class="mono" style="text-align:right;white-space:nowrap">${moneyBR(item.valorFechado || 0)}</b>
                  </label>
                `).join('')}
              </div>
              <div class="small" style="margin-top:8px">Selecionado: <b>${selectedNewFinFichaItems.length}</b> item(ns) • <b>${moneyBR(selectedNewFinFichaTotal)}</b></div>
            </div>
          ` : `<div class="muted" style="margin-bottom:12px">Nenhum procedimento da ficha sem recebimento. Se o paciente já tinha parcelas antigas, elas aparecem na lista de recebimentos abaixo. Você também pode criar recebimento avulso manual.</div>`}

          <div class="newBudgetGrid" style="display:grid;grid-template-columns:170px 300px 125px;gap:10px;align-items:end;max-width:620px">
            <div style="min-width:0">
              <label>Título</label>
              <input id="newFinTitle" value="${selectedNewFinFichaItems.length ? 'Recebimento da ficha' : 'Recebimento avulso'}" placeholder="Ex: Recebimento">
            </div>
            <div style="min-width:0">
              <label>Dentista avaliador</label>
              <input id="newFinDentist" placeholder="Opcional">
            </div>
            <div style="min-width:0">
              <label>Valor total</label>
              <input id="newFinTotal" type="number" step="0.01" value="${Number(defaultTotal || 0) || ""}" placeholder="0,00">
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
            <button class="btn ok" onclick="CRONOS_NEW_FIN_UI.createPlan()">Criar recebimento</button>
          </div>

          ${plans.some(p=>p.source === "legacyInstallments" || p.legacyInstallPlan) ? `
            <div class="muted" style="margin-top:10px;border:1px solid var(--line);border-radius:12px;padding:10px;background:rgba(255,255,255,.025)">
              Recebimento/parcelamento antigo encontrado e migrado. As parcelas antigas aparecem aqui mesmo sem vínculo com ficha.
            </div>
          ` : ""}

          <div style="display:grid;gap:8px;margin-top:14px">
            ${plans.length ? plans.map(plan=>{
              const t = financialPlanTotals(plan);
              const active = selectedPlan && String(selectedPlan.id)===String(plan.id);
              return `
                <div style="border:1px solid var(--line);border-radius:14px;padding:10px;background:${active ? 'rgba(124,92,255,.12)' : 'rgba(255,255,255,.03)'}">
                  <div>
                    <b>${escapeHTML(plan.title||"Plano financeiro")}</b> ${financialPlanStatusLabel(plan)}
                    <div class="muted" style="font-size:12px">${escapeHTML(plan.dentist||"Sem avaliador")} • ${fmtBR(String(plan.createdAt||"").slice(0,10))}</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
                      <span class="chip">Total: <b>${moneyBR(t.total)}</b></span>
                      <span class="chip">Lançado: <b>${moneyBR(t.scheduled)}</b></span>
                      <span class="chip">Pago: <b>${moneyBR(t.paid)}</b></span>
                      <span class="chip">Saldo a lançar: <b>${moneyBR(t.remainingToSchedule)}</b></span>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px">
                      <button type="button" class="btn small ${active?'primary':''}" onclick="CRONOS_NEW_FIN_UI.selectPlan('${escapeHTML(plan.id)}')">${active?'Selecionado':'Selecionar'}</button>
                      ${canSensitive ? `<button type="button" class="btn small" onclick="CRONOS_NEW_FIN_UI.approvePlan('${escapeHTML(plan.id)}')">Aprovar</button>` : ""}
                      ${canSensitive ? `<button type="button" class="btn small danger" onclick="CRONOS_NEW_FIN_UI.removePlan('${escapeHTML(plan.id)}')">Excluir</button>` : ""}
                    </div>
                    ${active ? renderFinancialPlanPaymentEditor(entry, plan, contact, t.remainingToSchedule) : ""}
                  </div>
                </div>
              `;
            }).join("") : `<div class="muted">Nenhum recebimento criado para este lead ainda.</div>`}
          </div>
        </div>
      ` : ""}
      ${""}
    </div>
  `;
}

window.CRONOS_NEW_FIN_UI = {
  search(v){
    window.__newFinancialInstallmentState = Object.assign(window.__newFinancialInstallmentState || {}, {search:String(v||""), entryId:"", planId:""});
    renderNewFinancialInstallmentApp();
    requestAnimationFrame(()=>{ try{ el("newFinSearch")?.focus(); el("newFinSearch")?.setSelectionRange(String(v||"").length,String(v||"").length); }catch(_){} });
  },
  selectPatientFromEvent(ev, entryId){
    try{
      if(ev){
        ev.preventDefault?.();
        ev.stopPropagation?.();
      }
    }catch(_){}
    this.selectPatient(entryId);
    return false;
  },
  selectPatient(entryId){
    try{
      const db = loadDB();
      const entry = (db.entries||[]).find(e=>String(e.id)===String(entryId));
      let migratedPlan = null;
      if(entry){
        ensureFichaForRecebimentos(entry);
        migratedPlan = migrateLegacyInstallmentsToFinancialPlan(entry);
        if(migratedPlan){
          try{ syncInstallmentTasks(db, currentActor()); }catch(_){}
          saveDB(db, { immediate:true });
        }
      }
      const plans = entry ? ensureFinancialPlans(entry) : [];
      const firstExistingPlanId = plans.length ? String(plans[0].id) : "";
      window.__newFinancialInstallmentState = Object.assign(window.__newFinancialInstallmentState || {}, {
        entryId:String(entryId),
        planId:migratedPlan ? String(migratedPlan.id) : firstExistingPlanId,
        fichaItemIds:[]
      });
      renderNewFinancialInstallmentApp();
      try{ renderInstallmentsView(); }catch(_){}
    }catch(err){
      console.error("Erro ao selecionar paciente em Recebimentos:", err);
      toast("Erro ao abrir paciente", "O clique chegou, mas o Cronos encontrou erro ao carregar a ficha/recebimentos.");
    }
  },
  clearPatient(){
    window.__newFinancialInstallmentState = {search:"", entryId:"", planId:""};
    renderNewFinancialInstallmentApp();
  },
  toggleFichaItem(itemId){
    const st = window.__newFinancialInstallmentState || {};
    st.fichaItemIds = Array.isArray(st.fichaItemIds) ? st.fichaItemIds : [];
    const id = String(itemId || '');
    const idx = st.fichaItemIds.indexOf(id);
    if(idx >= 0) st.fichaItemIds.splice(idx,1); else st.fichaItemIds.push(id);
    window.__newFinancialInstallmentState = st;
    renderNewFinancialInstallmentApp();
  },
  createPlan(){
    const actor = currentActor();
    const db = loadDB();
    const st = window.__newFinancialInstallmentState || {};
    const entry = (db.entries||[]).find(e=>String(e.id)===String(st.entryId));
    if(!entry) return toast("Paciente", "Selecione um paciente primeiro.");
    const ficha = ensureFichaForRecebimentos(entry);
    const selectedIds = Array.from(new Set((Array.isArray(st.fichaItemIds) ? st.fichaItemIds : []).map(String).filter(Boolean)));
    const selectedItems = ficha.plano.filter(item=>selectedIds.includes(String(item.id)) && isFichaItemAvailableForRecebimentos(entry, item));
    const selectedTotal = selectedItems.reduce((sum,item)=>sum + Number(item.valorFechado || 0), 0);
    const amount = selectedTotal || parseMoney(val("newFinTotal"));
    if(amount <= 0) return toast("Valor", "Informe o valor total do recebimento.");
    const plan = {
      id: uid("budget"),
      title: String(val("newFinTitle") || (selectedItems.length ? "Recebimento da ficha" : "Recebimento avulso")).trim() || "Recebimento",
      dentist: String(val("newFinDentist") || "").trim(),
      amount,
      status: "Aguardando",
      createdAt: new Date().toISOString(),
      createdBy: actor?.name || "",
      source: selectedItems.length ? "ficha" : "manual",
      fichaItemIds: selectedItems.map(item=>String(item.id)),
      evaluationIds: Array.from(new Set(selectedItems.map(item=>item.avaliacaoId).filter(Boolean))),
      payments: []
    };
    ensureFinancialPlans(entry).push(plan);
    selectedItems.forEach(item=>{
      item.financialPlanId = plan.id;
      item.recebimentoId = plan.id;
      item.financeStatus = "recebimento_criado";
      item.pago = false;
    });
    window.__newFinancialInstallmentState.planId = plan.id;
    window.__newFinancialInstallmentState.fichaItemIds = [];
    saveDB(db, { immediate:true });
    toast("Orçamento criado ✅", `${plan.title} • ${moneyBR(plan.amount)}`);
    renderNewFinancialInstallmentApp();
    renderInstallmentsView();
  },
  selectPlan(planId){
    window.__newFinancialInstallmentState = Object.assign(window.__newFinancialInstallmentState || {}, {planId:String(planId)});
    renderNewFinancialInstallmentApp();
  },
  approvePlan(planId){
    const actor = currentActor();
    if(!canManageFinancialSensitiveActions(actor)) return blockedFinancialSensitiveAction();
    const db = loadDB();
    const st = window.__newFinancialInstallmentState || {};
    const {plan} = getFinancialPlan(db, st.entryId, planId);
    if(!plan) return;
    plan.status = "Aprovado";
    saveDB(db, { immediate:true });
    renderNewFinancialInstallmentApp();
    renderInstallmentsView();
  },
  removePlan(planId){
    const actor = currentActor();
    if(!canManageFinancialSensitiveActions(actor)) return blockedFinancialSensitiveAction();
    if(!confirm("Excluir este recebimento e todos os pagamentos vinculados?")) return;
    const db = loadDB();
    const st = window.__newFinancialInstallmentState || {};
    const entry = (db.entries||[]).find(e=>String(e.id)===String(st.entryId));
    if(!entry) return;
    const removedPlan = ensureFinancialPlans(entry).find(p=>String(p.id)===String(planId));
    entry.financialPlans = ensureFinancialPlans(entry).filter(p=>String(p.id)!==String(planId));
    db.payments = (db.payments||[]).filter(p=>!(String(p.entryId)===String(entry.id) && String(p.financialPlanId)===String(planId)));
    if(entry.installPlan && String(entry.installPlan.migratedToFinancialPlanId||"")===String(planId)){
      delete entry.installPlan.migratedToFinancialPlanId;
    }
    if(String(st.planId)===String(planId)) st.planId = "";
    syncInstallmentTasks(db, actor);
    saveDB(db, { immediate:true });
    toast(removedPlan?.source === "legacyInstallments" ? "Recebimento legado removido" : "Recebimento removido");
    renderNewFinancialInstallmentApp();
    renderInstallmentsView();
  },
  fillRemaining(){
    const db = loadDB();
    const st = window.__newFinancialInstallmentState || {};
    const {plan} = getFinancialPlan(db, st.entryId, st.planId);
    if(!plan) return;
    const t = financialPlanTotals(plan);
    setVal("newPayAmount", Number(t.remainingToSchedule.toFixed(2)));
  },
  addPayment(){
    const actor = currentActor();
    const db = loadDB();
    const st = window.__newFinancialInstallmentState || {};
    const {entry, plan} = getFinancialPlan(db, st.entryId, st.planId);
    if(!entry || !plan) return toast("Orçamento", "Selecione um orçamento.");
    const due = val("newPayDue") || todayISO();
    const method = val("newPayMethod") || "";
    const amount = parseMoney(val("newPayAmount"));
    const count = Math.max(1, parseInt(val("newPayCount") || "1", 10) || 1);
    const status = val("newPayStatus") || "PENDENTE";
    const obs = String(val("newPayObs") || "").trim();
    if(amount <= 0) return toast("Valor", "Informe o valor do pagamento.");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(due)) return toast("Data", "Informe uma data válida.");

    plan.payments = Array.isArray(plan.payments) ? plan.payments : [];
    const base = Math.floor((amount / count) * 100) / 100;
    let accumulated = 0;
    for(let i=1;i<=count;i++){
      let value = i === count ? Number((amount - accumulated).toFixed(2)) : Number(base.toFixed(2));
      accumulated += value;
      const dueDate = addMonthsISO(due, i-1);
      const paid = status === "PAGA";
      const p = {
        id: uid("pay"),
        amount: value,
        dueDate,
        payMethod: method,
        notes: obs,
        status: paid ? "PAGA" : "PENDENTE",
        paidAt: paid ? todayISO() : "",
        cashDate: paid ? todayISO() : "",
        createdAt: new Date().toISOString()
      };
      plan.payments.push(p);
    }
    renumberFinancialPlanPayments(plan);

    if(status === "PAGA"){
      db.payments = db.payments || [];
      plan.payments.filter(p=>p.status==="PAGA" && !findFinancePaymentRecord(db, entry.id, plan.id, p.id)).forEach(p=>{
        db.payments.push({
          id: uid("p"),
          masterId: actor.masterId,
          entryId: entry.id,
          contactId: entry.contactId || "",
          financialPlanId: plan.id,
          financialPaymentId: p.id,
          at: new Date().toISOString(),
          date: p.cashDate || todayISO(),
          value: parseMoney(p.amount),
          method: p.payMethod || "",
          desc: `Orçamento: ${plan.title || "Plano financeiro"} • Pagamento ${p.number || ""}/${p.total || ""}`,
          source: "financialPlan"
        });
      });
    }

    syncInstallmentTasks(db, actor);
    saveDB(db, { immediate:true });
    toast("Pagamento lançado ✅", `${count} parcela(s) • ${moneyBR(amount)}`);
    renderNewFinancialInstallmentApp();
    renderInstallmentsView();
  }
};


function renderInstallmentsView(){
  const actor = currentActor();
  if(!actor){ showAuth(); return; }
  const db = loadDB();

  (db.tasks||[]).forEach(t=>{
    if(!t.masterId) t.masterId = actor.masterId;
    if(!t.entryId && typeof t.key==="string" && (t.key.startsWith("INST:") || t.key.startsWith("FININST:"))){
      const parts = t.key.split(":");
      if(parts.length>=3) t.entryId = parts[1];
    }
    if(!t.title && t.name) t.title = t.name;
    if(!t.notes && t.desc) t.notes = t.desc;
    if(!t.action && t.wa) t.action = "WhatsApp";
    if(t.done==null && t.status!=null){
      t.done = (String(t.status).toLowerCase().includes("feito") || String(t.status).toLowerCase().includes("done") || String(t.status).toLowerCase().includes("concl"));
    }
    if(t.done==null) t.done = false;
  });
  (db.payments||[]).forEach(p=>{
    if(!p.masterId) p.masterId = actor.masterId;
    if(!p.date && p.at) p.date = String(p.at).slice(0,10);
  });

  const mm = el("instMonth");
  const nowMK = new Date().toISOString().slice(0,7);
  if(mm && !mm.value) mm.value = nowMK;

  const mk = mm?.value || nowMK;
  const q = (el("instSearch")?.value||"").trim().toLowerCase();
  const filter = (el("instFilter")?.value||"all");
  const today = todayISO();
  const canSensitive = canManageFinancialSensitiveActions(actor);

  const k = installmentsKPIs(db, actor, mk);
  const kReceived = summarizeReceivedForMonth(db, actor, mk);
  el("kpiInstMonth").textContent = moneyBR(kReceived.total);
  el("kpiInstMonthN").textContent = `${kReceived.count} baixa(s)`;
  el("kpiInstLate").textContent = moneyBR(k.lateSum);
  el("kpiInstLateN").textContent = `${k.lateN} parcelas`;
  el("kpiInstFuture").textContent = moneyBR(k.futureSum);
  el("kpiInstFutureN").textContent = `${k.futureN} parcelas`;

  const pill = el("pillInst");
  if(pill) pill.textContent = String(k.lateN || 0);

  const contactsById = new Map((db.contacts||[]).filter(c=>c.masterId===actor.masterId).map(c=>[c.id,c]));
  const entries = (db.entries||[]).filter(e=>e.masterId===actor.masterId && e.installPlan && !e.installPlan.migratedToFinancialPlanId);

  window.__instHistoryState = window.__instHistoryState || { page:1, sig:"" };
  const stateSig = `${mk}|${filter}|${q}`;
  if(window.__instHistoryState.sig !== stateSig){
    window.__instHistoryState.sig = stateSig;
    window.__instHistoryState.page = 1;
  }

  const rows = [];
  entries.forEach(e=>{
    ensureInstallmentsForEntry(e);
    const c = contactsById.get(e.contactId) || {name:"(sem nome)", phone:""};
    const hay = `${c.name} ${c.phone}`.toLowerCase();
    if(q && !hay.includes(q)) return;

    const monthInstallments = (e.installments||[]).filter(p=>{
      const paid = !!p.paidAt || !!p.cashDate || p.status === "PAGA";
      const cashISO = cronosPaymentCashISO(p, false);
      const dueISO = p?.dueDate || p?.due || "";
      if(paid) return cashISO && monthKeyOf(cashISO) === mk;
      return dueISO && monthKeyOf(dueISO) === mk;
    });
    if(!monthInstallments.length) return;

    let monthPaidSum=0, monthPendingSum=0, monthLateSum=0, monthFutureSum=0;
    let monthPaidCount=0, monthPendingCount=0, monthLateCount=0, monthFutureCount=0;

    monthInstallments.forEach(p=>{
      const paid = !!p.paidAt || !!p.cashDate || p.status === "PAGA";
      const cashISO = cronosPaymentCashISO(p, false);
      if(paid){
        if(cashISO && monthKeyOf(cashISO) === mk){
          monthPaidSum += parseMoney(p.amount);
          monthPaidCount++;
        }
        return;
      }
      monthPendingSum += parseMoney(p.amount);
      monthPendingCount++;
      if(p.dueDate && p.dueDate < today){
        monthLateSum += parseMoney(p.amount);
        monthLateCount++;
      } else {
        monthFutureSum += parseMoney(p.amount);
        monthFutureCount++;
      }
    });

    if(filter === "paid" && monthPaidCount <= 0) return;
    if(filter === "dueMonth" && monthPendingCount <= 0) return;
    if(filter === "late" && monthLateCount <= 0) return;
    if(filter === "open" && monthFutureCount <= 0) return;

    const overall = entryInstallmentSummary(e);
    rows.push({
      e, c, overall,
      monthInstallments,
      monthPaidSum, monthPendingSum, monthLateSum, monthFutureSum,
      monthPaidCount, monthPendingCount, monthLateCount, monthFutureCount,
    });
  });

  rows.sort((A,B)=>{
    const aRank = A.monthLateCount>0 ? 3 : A.monthPendingCount>0 ? 2 : A.monthPaidCount>0 ? 1 : 0;
    const bRank = B.monthLateCount>0 ? 3 : B.monthPendingCount>0 ? 2 : B.monthPaidCount>0 ? 1 : 0;
    if(aRank !== bRank) return bRank - aRank;
    const aBol = ((A.e.installPlan?.payMethod||"")==="Boleto")?1:0;
    const bBol = ((B.e.installPlan?.payMethod||"")==="Boleto")?1:0;
    if(aBol!==bBol) return bBol-aBol;
    const aDate = (cronosPaymentCashISO(A.monthInstallments[0], false) || A.monthInstallments[0]?.dueDate || "9999-99-99");
    const bDate = (cronosPaymentCashISO(B.monthInstallments[0], false) || B.monthInstallments[0]?.dueDate || "9999-99-99");
    return aDate.localeCompare(bDate);
  });

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(totalPages, Math.max(1, window.__instHistoryState.page || 1));
  window.__instHistoryState.page = currentPage;
  const start = (currentPage - 1) * pageSize;
  const pagedRows = rows.slice(start, start + pageSize);

  const list = el("instList");
  if(!list) return;
  ensureNewInstallmentButton();
  const financialCardsHtml = buildFinancialPlanCards(db, actor, mk, q, filter, today);

  if(!rows.length && !financialCardsHtml){
    list.innerHTML = `<div class="muted">Nenhum recebimento encontrado para o mês e filtro selecionados.</div>`;
    return;
  }

  const cardsHtml = pagedRows.map(({e,c,overall,monthInstallments,monthPaidSum,monthPendingSum,monthLateSum,monthFutureSum,monthPaidCount,monthPendingCount,monthLateCount,monthFutureCount})=>{
    const pm = e.installPlan?.payMethod || "—";
    const each = e.installPlan?.each ? moneyBR(e.installPlan.each) : moneyBR((parseMoney(e.installPlan.amount)||0)/Math.max(1,parseInt(e.installPlan.n||1,10)));
    const next = overall.nextDue ? fmtBR(overall.nextDue) : "—";
    const rowId = `instrow_${e.id}`;

    const badges = [];
    if(monthPaidCount > 0) badges.push(`<span class="badge ok">✅ ${monthPaidCount} paga(s)</span>`);
    if(monthLateCount > 0) badges.push(`<span class="badge late">⚠️ ${monthLateCount} atrasada(s)</span>`);
    if(monthFutureCount > 0) badges.push(`<span class="badge pending">🕒 ${monthFutureCount} pendente(s)</span>`);
    if(!badges.length && monthPendingCount > 0) badges.push(`<span class="badge pending">🕒 ${monthPendingCount} pendente(s)</span>`);

    const periodDetails = monthInstallments.map(p=>{
      const paid = !!p.paidAt || !!p.cashDate || p.status === "PAGA";
      const cashISO = cronosPaymentCashISO(p, false);
      const late = !paid && p.dueDate && p.dueDate < today;
      const statusChip = paid
        ? `<span class="badge ok">PAGA</span>`
        : late
          ? `<span class="badge late">ATRASADA</span>`
          : `<span class="badge pending">PENDENTE</span>`;
      const dateTxt = paid ? `Pago: ${fmtBR(cashISO || p.paidAt || p.cashDate || "")}` : `Venc: ${fmtBR(p.dueDate)}`;
      return `<div class="chip">${p.number}/${p.total} • ${dateTxt} • <b>${moneyBR(p.amount)}</b> ${statusChip}</div>`;
    }).join("");

    return `
      <div class="instRow" id="${rowId}">
        <div class="instHead">
          <div style="min-width:0">
            <div class="instName">${escapeHTML(c.name)} <span class="muted" style="font-weight:600">• ${escapeHTML(c.phone||"")}</span></div>
            <div class="instMeta">
              <span class="chip">Parcelas gerais: <b>${overall.paidCount}/${overall.total}</b></span>
              <span class="chip">Forma: <b>${escapeHTML(pm)}</b></span>
              <span class="chip">Próx.: <b>${escapeHTML(next)}</b></span>
              <span class="chip">Parcela: <b>${each}</b></span>
              ${badges.join(" ")}
            </div>
            <div class="instMeta">
              <span class="chip">Pagas no mês: <b>${moneyBR(monthPaidSum)}</b></span>
              <span class="chip">Pendentes no mês: <b>${moneyBR(monthPendingSum)}</b></span>
              <span class="chip">Atrasado no mês: <b>${moneyBR(monthLateSum)}</b></span>
              <span class="chip">Futuro no mês: <b>${moneyBR(monthFutureSum)}</b></span>
            </div>
            <div class="instMeta" style="margin-top:8px">${periodDetails}</div>
          </div>
          <div class="instBtns">
            <button class="btn" onclick="openLeadEntry('${e.id}')">Abrir lead</button>
            <button class="btn primary" data-toggle-inst="${e.id}" onclick="toggleInstRow('${e.id}')">Ver parcelas</button>
            ${canSensitive ? `<button class="btn danger" onclick="deleteInstallmentPlan('${e.id}')">Excluir</button>` : ""}
          </div>
        </div>
        <div class="instBody">
          ${renderInstallmentTable(e,c)}
        </div>
      </div>
    `;
  }).join("");

  const pagerHtml = totalPages > 1 ? `
    <div class="instPager" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px;">
      <div class="muted">Página ${currentPage} de ${totalPages} • ${rows.length} registro(s)</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn small" ${currentPage<=1 ? 'disabled' : ''} onclick="window.__instHistoryState.page=Math.max(1,(window.__instHistoryState.page||1)-1);renderInstallmentsView();">Anterior</button>
        <button class="btn small" ${currentPage>=totalPages ? 'disabled' : ''} onclick="window.__instHistoryState.page=Math.min(${totalPages},(window.__instHistoryState.page||1)+1);renderInstallmentsView();">Próxima</button>
      </div>
    </div>
  ` : '';

  list.innerHTML = financialCardsHtml + cardsHtml + pagerHtml;

  try{
    window.__instOpen = window.__instOpen || {};
    Object.keys(window.__instOpen).forEach(id=>{
      const rr = el(id) || el(`instrow_${id}`);
      if(rr && window.__instOpen[id]) rr.classList.add("open");
      updateInstallmentToggleLabel(id);
      const fbtn = rr ? rr.querySelector(`[data-toggle-inst="${id}"]`) : null;
      if(fbtn) fbtn.textContent = rr.classList.contains("open") ? "Fechar pagamentos" : "Ver pagamentos";
    });
  }catch(e){}
}

function updateInstallmentToggleLabel(entryId){
  const row = el(`instrow_${entryId}`);
  const btn = row ? row.querySelector(`[data-toggle-inst="${entryId}"]`) : null;
  if(!btn) return;
  btn.textContent = row.classList.contains("open") ? "Fechar parcelas" : "Ver parcelas";
}

function toggleInstRow(entryId){
  window.__instOpen = window.__instOpen || {};
  const row = el(`instrow_${entryId}`);
  if(!row) return;
  row.classList.toggle("open");
  window.__instOpen[entryId] = row.classList.contains("open");
  updateInstallmentToggleLabel(entryId);
}

function renderInstallmentTable(entry, contact){
  ensureInstallmentsForEntry(entry);
  const today = todayISO();
  const canSensitive = canManageFinancialSensitiveActions();
  const pmDefault = entry.installPlan?.payMethod || "";
  const rows = (entry.installments||[]).map(p=>{
    const paid = !!p.paidAt || !!p.cashDate || p.status==="PAGA";
    const late = !paid && p.dueDate && p.dueDate < today;
    const st = paid ? `<span class="badge ok">PAGO</span>` : (late ? `<span class="badge late">ATRASADO</span>` : `<span class="badge pending">PENDENTE</span>`);
    const action = paid
      ? (canSensitive ? `<a class="miniLink" href="javascript:void(0)" onclick="undoInstallmentPay('${entry.id}', ${p.number})">Desfazer</a>` : `<span class="muted" style="font-size:12px">Pago</span>`)
      : `<button class="btn ok" onclick="payInstallment('${entry.id}', ${p.number})">Dar baixa</button>`;
    const transfer = (paid && canSensitive) ? `<a class="miniLink" href="javascript:void(0)" onclick="transferInstallmentCashDate('${entry.id}', ${p.number})">Transferir data</a>` : "";
    const wa = !paid ? `<a class="miniLink waChargeBtn" href="${waChargeLink(contact.phone, contact.name, entry, p)}" target="_blank">Cobrar</a>` : "";
    const deleteBtn = canSensitive ? `<button class="miniBtn danger" onclick="deleteInstallment('${entry.id}', ${p.number})" title="Excluir parcela">🗑️</button>` : "";
    const cashISO = cronosPaymentCashISO(p, false);
    return `
      <tr>
        <td class="mono">${p.number}/${p.total}</td>
        <td class="mono">${p.dueDate?fmtBR(p.dueDate):"—"}</td>
        <td class="mono">${moneyBR(p.amount)}</td>
        <td>${escapeHTML(p.payMethod||pmDefault||"—")}</td>
        <td>${st} ${cashISO?`<div class="muted" style="font-size:12px">caixa: ${fmtBR(cashISO)}</div>`:""}</td>
        <td style="white-space:nowrap; display:flex; gap:10px; align-items:center; flex-wrap:wrap">${action} ${transfer} ${wa} ${deleteBtn}</td>
      </tr>
    `;
  }).join("");

  return `
    <table class="instTable">
      <thead><tr>
        <th>Parcela</th><th>Venc.</th><th>Valor</th><th>Forma</th><th>Status</th><th>Ações</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function waChargeLink(phone, nome, entry, parcela){
  const clean = String(phone||"").replace(/\D/g,"");
  const p = parcela || {};
  const db = loadDB();
  const tplDefault = `Oi {nome}! 😊\nSó pra lembrar: a parcela {parcela}/{total} de {valor} vence em {vencimento}. Posso te ajudar por aqui?`;
  const tpl = (db.settings && db.settings.waChargeTemplate) ? String(db.settings.waChargeTemplate) : tplDefault;

  const msg = tpl
    .replaceAll("{nome}", String(nome||""))
    .replaceAll("{parcela}", String(p.number||""))
    .replaceAll("{total}", String(p.total||""))
    .replaceAll("{valor}", moneyBR(p.amount||0))
    .replaceAll("{vencimento}", p.dueDate?fmtBR(p.dueDate):"");

  return `https://wa.me/55${clean}?text=${encodeURIComponent(msg)}`;
}

async function payInstallment(entryId, number){
  window.__instOpen = window.__instOpen || {};
  window.__instOpen[entryId] = true;
  const actor = currentActor();
  const db = loadDB();
  const entry = (db.entries||[]).find(e=>e.id===entryId);
  if(!entry) return toast("Erro", "Entrada não encontrada");
  ensureInstallmentsForEntry(entry);
  const p = (entry.installments||[]).find(x=>x.number===number);
  if(!p) return toast("Erro", "Parcela não encontrada");
  if(p.paidAt || p.cashDate || p.status==="PAGA") return toast("Já foi", "Essa parcela já está baixada.");

  const payDate = await askPaymentCashDate({
    title: "Dar baixa na parcela",
    subtitle: `Parcela ${number}/${p.total} • ${moneyBR(p.amount)}${p.dueDate ? ` • venc. ${fmtBR(p.dueDate)}` : ""}`,
    defaultDate: todayISO()
  });
  if(!payDate) return;

  p.paidAt = payDate;
  p.cashDate = payDate;
  p.status = "PAGA";

  entry.valuePaid = parseMoney(entry.valuePaid) + parseMoney(p.amount);
  entry.valueClosed = (entry.status==="Fechou") ? entry.valuePaid : null;

  db.payments = db.payments || [];
  db.payments.push({
    id: uid("p"),
    masterId: actor.masterId,
    entryId,
    contactId: entry.contactId,
    at: new Date().toISOString(),
    date: payDate,
    paidAt: payDate,
    cashDate: payDate,
    status: "PAGA",
    value: p.amount,
    method: p.payMethod || entry.installPlan?.payMethod || "",
    desc: `Parcela ${p.number}/${p.total}`,
    source: "legacyInstallment",
    legacyInstallmentNumber: p.number
  });

  saveDB(db);
  toast("Baixa feita ✅", `Parcela ${number}/${p.total} • ${moneyBR(p.amount)} • caixa em ${fmtBR(payDate)}`);
  try {
    syncInstallmentTasks(db, actor);
    saveDB(db);
  } catch {}
  renderAll();
}
function undoInstallmentPay(entryId, number){
  const actor = currentActor();
  if(!canManageFinancialSensitiveActions(actor)) return blockedFinancialSensitiveAction();
  const db = loadDB();
  const entry = (db.entries||[]).find(e=>e.id===entryId);
  if(!entry) return toast("Erro", "Entrada não encontrada");
  ensureInstallmentsForEntry(entry);
  const p = (entry.installments||[]).find(x=>x.number===number);
  if(!p) return toast("Erro", "Parcela não encontrada");
  if(!(p.paidAt || p.cashDate || p.status==="PAGA")) return toast("Nada a desfazer", "Essa parcela não está paga.");
  const amt = parseMoney(p.amount);
  entry.valuePaid = Math.max(0, parseMoney(entry.valuePaid) - amt);
  p.paidAt = "";
  p.cashDate = "";
  p.status = "PENDENTE";
  db.payments = db.payments || [];
  const idx = db.payments.findIndex(x=>x.entryId===entryId && x.value===amt && (String(x.legacyInstallmentNumber||"")===String(number) || (x.desc||"").includes(`Parcela ${number}/`)));
  if(idx>=0) db.payments.splice(idx,1);

  saveDB(db);
  toast("Baixa desfeita", `Parcela ${number}/${p.total} voltou para pendente.`);
  try{ syncInstallmentTasks(db, actor); saveDB(db);}catch{}
  setTimeout(() => {
  if (typeof renderAll === "function") renderAll();
}, 50);
}


async function transferInstallmentCashDate(entryId, number){
  const actor = currentActor();
  if(!canManageFinancialSensitiveActions(actor)) return blockedFinancialSensitiveAction();
  const db = loadDB();
  const entry = (db.entries||[]).find(e=>e.id===entryId);
  if(!entry) return toast("Erro", "Entrada não encontrada");
  ensureInstallmentsForEntry(entry);
  const p = (entry.installments||[]).find(x=>x.number===number);
  if(!p) return toast("Erro", "Parcela não encontrada");
  if(!(p.paidAt || p.cashDate || p.status==="PAGA")) return toast("Transferência", "Só dá para transferir parcela baixada.");
  const current = cronosPaymentCashISO(p, false) || todayISO();
  const next = await askPaymentCashDate({
    title: "Transferir data da baixa",
    subtitle: `Parcela ${number}/${p.total} • ${moneyBR(p.amount)}. Escolha em que mês/dia esse pagamento deve contar.`,
    defaultDate: current
  });
  if(!next) return;

  p.cashDate = next;
  p.paidAt = next;

  const amt = parseMoney(p.amount);
  db.payments = db.payments || [];
  const rec = db.payments.find(x=>String(x.entryId)===String(entryId) && parseMoney(x.value)===amt && (String(x.legacyInstallmentNumber||"")===String(number) || String(x.desc||"").includes(`Parcela ${number}/`)));
  if(rec){
    rec.date = next;
    rec.cashDate = next;
    rec.paidAt = next;
    rec.status = "PAGA";
    rec.at = `${next}T12:00:00.000`;
  }

  saveDB(db, { immediate:true });
  toast("Data transferida ✅", `Caixa: ${fmtBR(next)}`);
  renderAll();
}

function normalizeInstallmentsAfterMutation(entry){
  entry.installments = Array.isArray(entry.installments) ? entry.installments : [];
  const total = entry.installments.length;

  if(!total){
    entry.installPlan = null;
    entry.installments = [];
    return;
  }

  entry.installments = entry.installments
    .sort((a,b)=> String(a?.dueDate||"").localeCompare(String(b?.dueDate||"")) || Number(a?.number||0) - Number(b?.number||0))
    .map((p, idx)=> ({
      ...p,
      number: idx + 1,
      total
    }));

  if(entry.installPlan){
    const totalAmount = entry.installments.reduce((sum, parcela)=> sum + parseMoney(parcela.amount), 0);
    entry.installPlan.n = total;
    entry.installPlan.amount = Number(totalAmount.toFixed(2));
    entry.installPlan.each = total ? Number((totalAmount / total).toFixed(2)) : 0;
    entry.installPlan.firstDue = entry.installments[0]?.dueDate || entry.installPlan.firstDue || "";
  }
}

function persistInstallmentMutation(db, actor, entryId, successMsg, successSub=""){
  try{
    syncInstallmentTasks(db, actor);
  }catch(_){ }
  saveDB(db, { immediate:true });
  window.__instOpen = window.__instOpen || {};
  if(entryId) window.__instOpen[entryId] = true;
  toast(successMsg, successSub);
  renderAll();
}

function deleteInstallmentPlan(entryId){
  const actor = currentActor();
  if(!canManageFinancialSensitiveActions(actor)) return blockedFinancialSensitiveAction();
  if(!actor?.perms?.edit) return toast("Sem permissão");
  const db = loadDB();
  const entry = (db.entries||[]).find(e=>e.id===entryId);
  if(!entry || !entry.installPlan) return toast("Parcelamento não encontrado");
  ensureInstallmentsForEntry(entry);
  const contact = (db.contacts||[]).find(c=>c.id===entry.contactId);
  const totalParcelas = (entry.installments||[]).length;
  if(!confirm(`Excluir todo o recebimento de ${contact?.name || 'este paciente'}?

Isso vai remover ${totalParcelas} parcela(s), pagamentos lançados por parcelas e tarefas automáticas vinculadas.`)) return;

  const removedPaid = (entry.installments||[])
    .filter(p=>p.paidAt || p.status === "PAGA")
    .reduce((sum, p)=> sum + parseMoney(p.amount), 0);

  if(removedPaid > 0){
    entry.valuePaid = Math.max(0, parseMoney(entry.valuePaid) - removedPaid);
    entry.valueClosed = entry.status === "Fechou" ? entry.valuePaid : null;
  }

  db.payments = (db.payments||[]).filter(pay=>!(pay.entryId===entryId && String(pay.desc||"").startsWith("Parcela ")));
  entry.installPlan = null;
  entry.installments = [];

  persistInstallmentMutation(db, actor, null, "Parcelamento excluído", `${totalParcelas} parcela(s) removida(s).`);
}

function deleteInstallment(entryId, number){
  const actor = currentActor();
  if(!canManageFinancialSensitiveActions(actor)) return blockedFinancialSensitiveAction();
  if(!actor?.perms?.edit) return toast("Sem permissão");
  const db = loadDB();
  const entry = (db.entries||[]).find(e=>e.id===entryId);
  if(!entry || !entry.installPlan) return toast("Parcelamento não encontrado");
  ensureInstallmentsForEntry(entry);
  const idx = (entry.installments||[]).findIndex(p=>Number(p.number)===Number(number));
  if(idx < 0) return toast("Parcela não encontrada");

  const parcela = entry.installments[idx];
  const oldNumber = Number(parcela.number || number);
  const oldTotal = Number(parcela.total || entry.installments.length || 0);

  if(!confirm(`Excluir a parcela ${oldNumber}/${oldTotal}?`)) return;

  if(parcela.paidAt || parcela.status === "PAGA"){
    const amt = parseMoney(parcela.amount);
    entry.valuePaid = Math.max(0, parseMoney(entry.valuePaid) - amt);
    entry.valueClosed = entry.status === "Fechou" ? entry.valuePaid : null;
    db.payments = (db.payments||[]).filter(pay=>!(pay.entryId===entryId && Number(pay.value||0)===amt && String(pay.desc||"").includes(`Parcela ${oldNumber}/`)));
  }

  entry.installments.splice(idx, 1);
  normalizeInstallmentsAfterMutation(entry);
  persistInstallmentMutation(db, actor, entryId, "Parcela excluída", `A parcela ${oldNumber}/${oldTotal} foi removida.`);
}


window.cronosSepararContatoDoLead = function(entryId, novoNome){
  const actor = currentActor && currentActor();
  const db = loadDB();
  const entry = (db.entries||[]).find(e=>String(e.id)===String(entryId));
  if(!entry) return console.warn("Lead não encontrado:", entryId);
  const oldContact = (db.contacts||[]).find(c=>String(c.id)===String(entry.contactId)) || {};
  const newContact = {
    ...oldContact,
    id: (crypto.randomUUID ? crypto.randomUUID() : uid("c")),
    name: novoNome || oldContact.name || "",
    masterId: oldContact.masterId || actor?.masterId || entry.masterId || "",
    firstSeenAt: entry.firstContactAt || oldContact.firstSeenAt || todayISO(),
    lastSeenAt: todayISO()
  };
  db.contacts.push(newContact);
  entry.contactId = newContact.id;
  saveDB(db, { immediate:true });
  try{ renderAll(); }catch(_){}
  console.log("Contato separado para o lead.", {entryId, oldContactId: oldContact.id, newContactId: newContact.id, newContact});
  return newContact;
};

window.cronosLimparTarefasParcelamentoAgora = function(){
  const actor = currentActor && currentActor();
  if(!actor) return console.warn("Sem usuário logado.");
  const db = loadDB();
  const before = Array.isArray(db.tasks) ? db.tasks.length : 0;
  const stats = syncInstallmentTasks(db, actor) || {};
  const after = Array.isArray(db.tasks) ? db.tasks.length : 0;
  saveDB(db, { immediate:true });
  try{ renderAll(); }catch(_){}
  console.log("Cronos: tarefas de recebimento higienizadas.", {before, after, stats});
  try{ toast("Tarefas higienizadas", `Antes: ${before} • Depois: ${after}`); }catch(_){}
  return {before, after, stats};
};


/* Recebimentos */
const __renderAll = typeof renderAll === "function" ? renderAll : function(){};
renderAll = function(){
  try{
    const actor = currentActor();
    const db = loadDB();
    (db.entries||[]).forEach(e=>{ if(e.installPlan){ ensureInstallmentsForEntry(e); }});
    if(actor) { try{ syncInstallmentTasks(db, actor); }catch{} saveDB(db, { skipCloud:true }); }
  }catch(e){}
  __renderAll();
  try{ relabelInstallmentsToRecebimentos(); }catch(e){}
  try{
    if(qs('[data-view="installments"].active')) renderInstallmentsView();
  }catch(e){}
};

const __showView = typeof showView === "function" ? showView : function(){};
showView = function(view){
  if(typeof setActiveView === "function"){
    setActiveView(view);
  }else{
    __showView(view);
  }
  try{ relabelInstallmentsToRecebimentos(); }catch(e){}

  console.log("VIEW:", view);
  if(view==="dashboard"){
    setTimeout(() => {
      renderDashboard();
    }, 50);
  }
  if(view==="installments" && typeof renderInstallmentsView === "function"){
    renderInstallmentsView();
  }
  if(view==="kanban"){
    setTimeout(() => {
      renderKanban();
    }, 50);
  }
}

document.addEventListener("DOMContentLoaded", ()=>{
  try{ relabelInstallmentsToRecebimentos(); }catch(e){}
  const mm = el("instMonth");
  const ss = el("instSearch");
  const ff = el("instFilter");
  mm?.addEventListener("change", ()=>renderInstallmentsView());
  ss?.addEventListener("input", ()=>renderInstallmentsView());
  ff?.addEventListener("change", ()=>renderInstallmentsView());
});

function getSmallLogoDataURI(){
  try{
    const db = loadDB ? loadDB() : null;
    const actor = currentActor ? currentActor() : null;
    const clinicId = actor?.masterId || actor?.clinicId || null;
    const branding = db?.settings?.clinicBranding || {};
    const perClinic = clinicId && branding?.byClinic ? branding.byClinic[String(clinicId)] : null;
    if(perClinic?.logoDataUri) return perClinic.logoDataUri;
    if(branding?.defaultLogoDataUri) return branding.defaultLogoDataUri;
  }catch(_){ }
  const img = qs("#brandIcon img");
  if(img && img.src) return img.src;
  const im2 = qs(".brandMark img");
  if(im2 && im2.src) return im2.src;
  return "";
}

/* =========================
   Cronos
   ========================= */

const DBKEY = "cronoscrm_phase1_db";
const SESSIONKEY = "cronoscrm_phase1_session";
const THEMEKEY = "cronoscrm_theme";
window.__KPI_ACTIVE = null; // filtro do KPI clicável

const ROLES = ["MASTER","GERENTE","SECRETARIA","DENTISTA"];

const STATUS_LIST = [
  "Agendado","Compareceu","Fechou","Remarcou","Conversando","Faltou","Sem resposta",
  "Número incorreto","Achou caro","Não tem interesse","Mora longe","Mora em outra cidade",
  "Fechou em outro lugar","Msg não entregue","Desmarcou"
, "Concluído"];

const ORIGINS = [
  "Instagram orgânico","Instagram patrocinado","Fachada da clínica","Pós-tratamento",
  "Follow-up","Paciente de retorno","Outros"
];

const TREATMENTS = [
  "Implante unitário","Prótese protocolo","HOF","Ortodontia","Endodontia","Clínica geral","Outros"
];

const POSITIVE = new Set(["Agendado","Compareceu","Fechou","Remarcou","Conversando","Concluído"]);
const DISQUALIFIED = new Set(["Número incorreto","Achou caro","Não tem interesse","Mora longe","Mora em outra cidade","Fechou em outro lugar","Msg não entregue","Mensagem não entregue"]);
const APP_VIEWS = ["dashboard","leads","kanban","tasks","installments","users","settings"];
const AUX_MODULES = ["todayCronos","creditSimulator","performance"];
const ALL_ACCESS_MODULES = [...APP_VIEWS, ...AUX_MODULES];

const PERMS = {
  MASTER:     {viewAll:true, edit:true, delete:true, manageUsers:true, manageMasters:false, views:[...ALL_ACCESS_MODULES]},
  GERENTE:    {viewAll:true, edit:true, delete:true, manageUsers:false, manageMasters:false, views:["dashboard","todayCronos","leads","kanban","tasks","installments","creditSimulator","performance"]},
  SECRETARIA: {viewAll:true, edit:true, delete:true, manageUsers:false, manageMasters:false, views:["todayCronos","leads","kanban","tasks","installments","creditSimulator"]},
  DENTISTA:   {viewAll:true, edit:false, delete:false, manageUsers:false, manageMasters:false, views:["dashboard","leads","kanban"]},
};

function actorAccessModules(actor=currentActor()){
  if(!actor) return [...ALL_ACCESS_MODULES];
  const views = Array.isArray(actor?.perms?.views) && actor.perms.views.length ? actor.perms.views : ["dashboard"];
  return [...new Set(views.filter(v=>ALL_ACCESS_MODULES.includes(v)))];
}
function actorAllowedViews(actor=currentActor()){
  return actorAccessModules(actor).filter(v=>APP_VIEWS.includes(v));
}
function canAccessView(view, actor=currentActor()){
  return actorAllowedViews(actor).includes(view);
}
function canAccessModule(moduleKey, actor=currentActor()){
  const key = String(moduleKey || "");
  if(APP_VIEWS.includes(key)) return canAccessView(key, actor);
  return actorAccessModules(actor).includes(key);
}
function firstAllowedView(actor=currentActor()){
  return actorAllowedViews(actor)[0] || "dashboard";
}
function applyRoleVisibility(actor=currentActor()){
  APP_VIEWS.forEach(view=>{
    const btn = qs(`.nav button[data-view="${view}"]`);
    if(btn) btn.classList.toggle("hidden", !canAccessView(view, actor));
  });

  [
    { id:"navHojeCronos", module:"todayCronos" },
    { id:"navCreditoSimulator", module:"creditSimulator" },
    { id:"navPerformance", module:"performance" }
  ].forEach(item=>{
    const btn = el(item.id);
    if(btn) btn.classList.toggle("hidden", !canAccessModule(item.module, actor));
  });

  const canEdit = !!actor?.perms?.edit;
  const canUsers = canAccessView("users", actor) && !!actor?.perms?.manageUsers;
  const canSettings = canAccessView("settings", actor);

  ["btnNewLeadSide","btnNewLeadTop","btnNewLeadList","btnNewLeadKanban","btnNewTask","btnNewFinancialInstallment"].forEach(id=>{
    const node = el(id);
    if(node) node.classList.toggle("hidden", !canEdit);
  });

  const btnNewUser = el("btnNewUser");
  if(btnNewUser) btnNewUser.classList.toggle("hidden", !canUsers);

  ["btnBackup","btnSavePrefs","btnSaveClinicIdentity","btnResetChargeTpl"].forEach(id=>{
    const node = el(id);
    if(node) node.classList.toggle("hidden", !canSettings);
  });
}
window.CRONOS_CAN_ACCESS_MODULE = canAccessModule;
window.CRONOS_APPLY_ROLE_VISIBILITY = applyRoleVisibility;

const el = (id)=>document.getElementById(id);

function showBootSplash(message="Sincronizando seu ambiente..."){
  const boot = document.getElementById("bootSplashView");
  const text = document.getElementById("bootSplashText");
  if(text && message) text.textContent = message;
  if(boot) boot.classList.remove("hidden");
}
function hideBootSplash(){
  const boot = document.getElementById("bootSplashView");
  if(boot) boot.classList.add("hidden");
}
const qs = (sel,root=document)=>root.querySelector(sel);
const qsa = (sel,root=document)=>Array.from(root.querySelectorAll(sel));

function relabelInstallmentsToRecebimentos(){
  try{
    const replaceTextNodes = (root)=>{
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while(walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(n=>{
        if(String(n.nodeValue||"").includes("Parcelamentos")){
          n.nodeValue = String(n.nodeValue).replace(/Parcelamentos/g, "Recebimentos");
        }
        if(String(n.nodeValue||"").includes("Parcelamento")){
          n.nodeValue = String(n.nodeValue).replace(/Parcelamento/g, "Recebimento");
        }
      });
    };

    document.querySelectorAll('[data-view="installments"], #view-installments, [id*="inst"], [class*="inst"]').forEach(node=>{
      try{ replaceTextNodes(node); }catch(_){}
    });

    const nav = document.querySelector('[data-view="installments"]');
    if(nav){
      replaceTextNodes(nav);
      if(nav.textContent && nav.textContent.trim().toLowerCase().includes("parcelamento")){
        nav.innerHTML = nav.innerHTML.replace(/Parcelamentos/g, "Recebimentos").replace(/Parcelamento/g, "Recebimento");
      }
    }
  }catch(_){}
}

  const qv = (sel, root=document, fallback="") => {
    const e = qs(sel, root);
    return e && typeof e.value !== "undefined" ? e.value : fallback;
  };

function val(id, fallback=""){
  const x = el(id);
  return x ? x.value : fallback;
}
function setVal(id, v){
  const x = el(id);
  if(x) x.value = v;
}


function toast(msg, sub=""){
  const t = el("toast");
  t.innerHTML = `<div>${escapeHTML(msg)}</div>${sub?`<div class="small">${escapeHTML(sub)}</div>`:""}`;
  t.classList.add("show");
  clearTimeout(toast._tm);
  toast._tm = setTimeout(()=>t.classList.remove("show"), 2800);
}

function escapeHTML(s){
  return String(s??"").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    "\"":"&quot;",
    "'":"&#039;"
  }[m]));
}

function uid(prefix="id"){ return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`; }

function todayISO(){
  const d = new Date();
  const tz = d.getTimezoneOffset()*60000;
  return new Date(d - tz).toISOString().slice(0,10);
}
function parseISO(s){ return s ? new Date(s+"T00:00:00") : null; }
function fmtBR(s){
  if(!s) return "—";
  const [y,m,d] = s.split("-");
  return `${d}/${m}/${y}`;
}
function moneyBR(v){
  const n = Number(v||0);
  return n.toLocaleString("pt-BR", {style:"currency", currency:"BRL"});
}

function normPhone(s){
  return String(s||"").replace(/\D/g,"");
}
function monthKeyFromDate(iso){
  if(!iso) return new Date().toISOString().slice(0,7);
  return iso.slice(0,7);
}
function monthLabel(key){
  const [y,m] = key.split("-");
  const nomes = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  return `${nomes[Number(m)-1]} ${y}`;
}
function formatCPF(v){
  const s = String(v||"").replace(/\D/g,"").slice(0,11);
  if(s.length !== 11) return String(v||"").trim();
  return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}
function calcAgeFromISO(iso){
  const s = String(iso||"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y,m,d] = s.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  const passed = (now.getMonth()+1 > m) || ((now.getMonth()+1 === m) && now.getDate() >= d);
  if(!passed) age -= 1;
  return (Number.isFinite(age) && age >= 0 && age < 130) ? age : null;
}
function birthWithAgeLabel(iso){
  const s = String(iso||"").trim();
  if(!s) return "";
  const birth = fmtBR(s);
  const age = calcAgeFromISO(s);
  return age == null ? birth : `${birth} · ${age} anos`;
}

/* -------- Tema claro/escuro -------- */
function applyTheme(theme){
  const root = document.documentElement;
  if(theme === "light"){
    root.classList.add("light");
    setThemeIcons("☾");
  }else{
    root.classList.remove("light");
    setThemeIcons("☼");
  }
  localStorage.setItem(THEMEKEY, theme);

  const syncInjectedThemeBits = ()=>{
    try{
      if(window.CRONOS_TODAY){
        if(typeof window.CRONOS_TODAY.updateNavCount === "function") window.CRONOS_TODAY.updateNavCount();
        if(typeof window.CRONOS_TODAY.syncNavBadgeStyle === "function") window.CRONOS_TODAY.syncNavBadgeStyle();
      }
    }catch(_){ }
  };
  try{
    syncInjectedThemeBits();
    requestAnimationFrame(syncInjectedThemeBits);
    setTimeout(syncInjectedThemeBits, 40);
    setTimeout(syncInjectedThemeBits, 140);
    setTimeout(syncInjectedThemeBits, 260);
  }catch(_){ }
}
function setThemeIcons(icon){
  const a = el("themeToggle"); const b = el("themeToggleAuth");
  if(a) a.innerHTML = `<small>${icon}</small>`;
  if(b) b.innerHTML = `<small>${icon}</small>`;
}
function repaintDashboardChartsForTheme(){
  try{
    const dash = el("view-dashboard");
    if(!dash || dash.classList.contains("hidden")) return;
    requestAnimationFrame(()=>{
      try{ renderDashboardCharts(filteredEntries()); }catch(_){ try{ renderDashboard(); }catch(__){} }
    });
  }catch(_){ }
}
function toggleTheme(){
  const cur = localStorage.getItem(THEMEKEY) || "dark";
  applyTheme(cur === "dark" ? "light" : "dark");
  repaintDashboardChartsForTheme();
}

/* -------- Estrutura de dados --------
db = {
  masters: [{id,name,email,passHash,createdAt}],
  users: [{id,masterId,name,username,email,passHash,role,createdAt}],
  contacts: [{id, masterId, name, phone, cpf, birthDate, firstSeenAt, lastSeenAt}],
  entries: [{id, masterId, contactId, monthKey, firstContactAt, lastUpdateAt, status, origin, originOther,
            treatment, treatmentOther, city, notes, apptDate, apptTime, callAttempts, callResult,
            tags:[], statusLog:[{at,from,to,by}]}],
  settings: {}
}
*/
function freshDB(){
  return { masters:[], users:[], contacts:[], entries:[], tasks:[], payments:[], settings:{ waTemplate: "Oi {nome}! Vi seu interesse em {tratamento}. Posso te ajudar por aqui? 😊" }, version:"cloud_v1", createdAt:new Date().toISOString() };
}

const CLOUD_TABLE = "clinic_state";
const CLOUD_MEMBERS_TABLE = "clinic_members";
let DB = null;
let CLOUD_DB_READY = false;
let CLOUD_ROW_ID = null;
let CLOUD_OWNER_UID = null;
let CLOUD_OWNER_EMAIL = "";
let CLOUD_CLINIC_OWNER_UID = null;
let CLOUD_CLINIC_OWNER_EMAIL = "";
let CLOUD_ACCESS_KIND = "guest"; // owner | member | guest
let CLOUD_MEMBER_INFO = null;
let __cloudSaveTimer = null;
let __cloudSavePromise = null;
let __cloudToastSuppressedUntil = 0;

function suppressCloudFailureToasts(ms=6000){
  __cloudToastSuppressedUntil = Math.max(__cloudToastSuppressedUntil || 0, Date.now() + Number(ms || 0));
}

function shouldSuppressCloudFailureToast(){
  return Date.now() < (__cloudToastSuppressedUntil || 0)
    || CLOUD_ACCESS_KIND === "member_pending"
    || CLOUD_ACCESS_KIND === "member_inactive"
    || window.__CRONOS_LOGIN_BUSY__ === true;
}

function cancelPendingCloudSync(){
  if(__cloudSaveTimer){
    clearTimeout(__cloudSaveTimer);
    __cloudSaveTimer = null;
  }
}

const SUPPORT_STORAGE_KEY = "cronos_support_context";
const SUPPORT_DBKEY = "cronos_support_db";

function getSupportContext(){
  try{
    return JSON.parse(sessionStorage.getItem(SUPPORT_STORAGE_KEY) || "null");
  }catch(_){
    return null;
  }
}
function setSupportContext(ctx){
  if(!ctx){
    sessionStorage.removeItem(SUPPORT_STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(SUPPORT_STORAGE_KEY, JSON.stringify(ctx));
}
function getSupportDB(){
  try{
    return normalizeDBShape(JSON.parse(sessionStorage.getItem(SUPPORT_DBKEY) || "null"));
  }catch(_){
    return null;
  }
}
function setSupportDB(db){
  if(!db){
    sessionStorage.removeItem(SUPPORT_DBKEY);
    return;
  }
  sessionStorage.setItem(SUPPORT_DBKEY, JSON.stringify(normalizeDBShape(db)));
}
function clearSupportContext(){
  sessionStorage.removeItem(SUPPORT_STORAGE_KEY);
  sessionStorage.removeItem(SUPPORT_DBKEY);
}
function isSupportMode(){
  return !!getSupportContext();
}

async function maybeInitSupportMode(){
  const params = new URLSearchParams(location.search);
  const supportToken = params.get("support_token");
  if(!supportToken) return getSupportContext();

  const res = await fetch(`${supabaseUrl}/functions/v1/resolve-support-access`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": supabaseKey
    },
    body: JSON.stringify({ support_token: supportToken })
  });

  const json = await res.json().catch(() => ({}));
  if(!res.ok){
    throw new Error(json?.error || "Falha ao validar o acesso de suporte.");
  }

  setSupportContext(json.support || null);
  if(json?.support?.data){
    setSupportDB(json.support.data);
  }

  history.replaceState({}, "", location.pathname);
  return json.support || null;
}


const ACCESS_STATUS_ENDPOINT = "get-clinic-access-state";
const CREATE_CLINIC_USER_ENDPOINT = "create-clinic-user";
const DEFAULT_RENEWAL_MESSAGE = "Olá! Meu acesso ao Cronos expirou e quero renovar.";
let CLINIC_ACCESS_STATE = null;

function parseAccessDate(value){
  if(!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function startOfLocalDay(date){
  if(!date) return null;
  const copy = new Date(date);
  copy.setHours(0,0,0,0);
  return copy;
}
function daysUntilCalendar(endDate){
  if(!endDate) return null;
  const today = startOfLocalDay(new Date());
  const endDay = startOfLocalDay(endDate);
  return Math.round((endDay.getTime() - today.getTime()) / 86400000);
}
function normalizeAccessStatus(value){
  return String(value || "active").trim().toLowerCase();
}
function buildRenewalWhatsappUrl(access){
  const phone = String(access?.renewal_phone || "").replace(/\D/g, "");
  if(!phone) return "";
  const clinicName = String(access?.clinic_name || "").trim();
  const slug = String(access?.slug || "").trim();
  const template = String(access?.renewal_message || DEFAULT_RENEWAL_MESSAGE);
  const message = template
    .replaceAll("{clinica}", clinicName)
    .replaceAll("{slug}", slug)
    .replaceAll("{clinic_name}", clinicName);
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
function clearClinicAccessState(){
  CLINIC_ACCESS_STATE = null;
}
async function fetchClinicAccessState(force=false){
  if(isSupportMode()) return null;
  const cachedAccess = CLINIC_ACCESS_STATE;
  if(cachedAccess && !force){
    return cachedAccess;
  }
  if(typeof supabaseClient === "undefined" || !supabaseClient?.auth) return null;
  const sessionResp = await supabaseClient.auth.getSession();
  const session = sessionResp?.data?.session;
  if(!session?.access_token) return null;

  try{
    const res = await fetch(`${supabaseUrl}/functions/v1/${ACCESS_STATUS_ENDPOINT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
        "apikey": supabaseKey
      },
      body: JSON.stringify({})
    });
    const json = await res.json().catch(() => ({}));
    if(!res.ok){
      throw new Error(json?.error || "Falha ao validar o período de acesso.");
    }
    CLINIC_ACCESS_STATE = json?.access || null;
    return CLINIC_ACCESS_STATE;
  }catch(error){
    console.error("Falha ao consultar período de acesso:", error);
    toast("Aviso", "Não foi possível validar o período de acesso agora.");
    return null;
  }
}
function evaluateClinicAccessState(access){
  if(!access) return { mode: "allow", warn: false, daysLeft: null, access: null };
  const now = new Date();
  const status = normalizeAccessStatus(access.status);
  const startsAt = parseAccessDate(access.access_starts_at);
  const endsAt = parseAccessDate(access.access_ends_at);

  if(status === "blocked" || status === "inactive"){
    return { mode: "blocked", warn: false, daysLeft: null, access, startsAt, endsAt };
  }
  if(startsAt && now < startsAt){
    return { mode: "scheduled", warn: false, daysLeft: null, access, startsAt, endsAt };
  }
  if(endsAt && now > endsAt){
    return { mode: "expired", warn: false, daysLeft: -1, access, startsAt, endsAt };
  }

  const daysLeft = endsAt ? daysUntilCalendar(endsAt) : null;
  if(daysLeft !== null && [3,2,1,0].includes(daysLeft)){
    return { mode: "allow", warn: true, daysLeft, access, startsAt, endsAt };
  }

  return { mode: "allow", warn: false, daysLeft, access, startsAt, endsAt };
}
function fmtDateTimeLocal(value){
  if(!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if(Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    day:"2-digit", month:"2-digit", year:"numeric",
    hour:"2-digit", minute:"2-digit"
  });
}
function renderAccessMeta(decision){
  const rows = [];
  const access = decision?.access || {};
  if(access?.clinic_name){
    rows.push(`<div><strong>Clínica:</strong> ${escapeHTML(String(access.clinic_name))}</div>`);
  }
  if(decision?.startsAt){
    rows.push(`<div><strong>Início:</strong> ${fmtDateTimeLocal(decision.startsAt)}</div>`);
  }
  if(decision?.endsAt){
    rows.push(`<div><strong>Validade:</strong> ${fmtDateTimeLocal(decision.endsAt)}</div>`);
  }
  return rows.join("") || `<div>Nenhuma informação adicional disponível.</div>`;
}
function hideAccessNotice(){
  el("accessNoticeModal")?.classList.remove("show");
}
function showAccessNotice(decision){
  if(!decision?.warn) return;
  const access = decision.access || {};
  const daysLeft = Number(decision.daysLeft);
  const title = daysLeft === 0
    ? "Seu acesso expira hoje"
    : `Seu acesso expira em ${daysLeft} ${daysLeft === 1 ? "dia" : "dias"}`;
  const text = daysLeft === 0
    ? "Renove hoje para evitar o bloqueio do sistema."
    : "Renove com antecedência para evitar interrupções no uso do Cronos.";

  el("accessNoticeTitle").textContent = title;
  el("accessNoticeText").textContent = text;
  el("accessNoticeDays").textContent = daysLeft === 0
    ? "⏳ Expira hoje"
    : `⏳ Faltam ${daysLeft} ${daysLeft === 1 ? "dia" : "dias"}`;

  const waUrl = buildRenewalWhatsappUrl(access);
  const waBtn = el("btnAccessNoticeWhatsapp");
  if(waBtn){
    if(waUrl){
      waBtn.href = waUrl;
      waBtn.classList.remove("hidden");
    }else{
      waBtn.classList.add("hidden");
      waBtn.removeAttribute("href");
    }
  }

  el("accessNoticeModal").classList.add("show");
}
function showAccessGate(decision){
  hideBootSplash();
  const access = decision?.access || {};
  const mode = decision?.mode || "blocked";

  el("authView").classList.add("hidden");
  el("appView").classList.add("hidden");
  el("accessGateView").classList.remove("hidden");
  hideAccessNotice();

  const badgeMap = { expired: "⛔", blocked: "🔒", scheduled: "⏳" };
  const titleMap = {
    expired: "Seu acesso expirou",
    blocked: "Seu acesso está bloqueado",
    scheduled: "Seu acesso ainda não iniciou"
  };
  const textMap = {
    expired: "Para voltar a usar o Cronos, renove seu acesso com nossa equipe e envie o comprovante de pagamento.",
    blocked: "Entre em contato com nossa equipe para regularizar e reativar seu acesso ao Cronos.",
    scheduled: "Seu período de acesso ainda não começou. Fale com nossa equipe se precisar antecipar ou confirmar a liberação."
  };

  el("accessGateBadge").textContent = badgeMap[mode] || "⏳";
  el("accessGateTitle").textContent = titleMap[mode] || "Acesso indisponível";
  el("accessGateSubtitle").textContent = access?.clinic_name ? `Clínica: ${access.clinic_name}` : "Verifique o período de acesso da clínica.";
  el("accessGateText").textContent = textMap[mode] || "Seu acesso está temporariamente indisponível.";
  el("accessGateMeta").innerHTML = renderAccessMeta(decision);

  const renewBtn = el("btnRenewAccessWhatsapp");
  const waUrl = buildRenewalWhatsappUrl(access);
  if(renewBtn){
    if(waUrl){
      renewBtn.href = waUrl;
      renewBtn.classList.remove("hidden");
    }else{
      renewBtn.classList.add("hidden");
      renewBtn.removeAttribute("href");
    }
  }
}
function hideAccessGate(){
  el("accessGateView")?.classList.add("hidden");
}
async function applyClinicAccessRules(){
  if(isSupportMode()){
    hideAccessGate();
    hideAccessNotice();
    clearClinicAccessState();
    return { mode:"allow", warn:false, support:true };
  }
  const access = await fetchClinicAccessState(true);
  const decision = evaluateClinicAccessState(access);
  if(decision.mode !== "allow"){
    showAccessGate(decision);
    return decision;
  }
  hideAccessGate();
  if(decision.warn){
    showAccessNotice(decision);
  }else{
    hideAccessNotice();
  }
  return decision;
}

function resetCloudContext(){
  CLOUD_DB_READY = false;
  CLOUD_ROW_ID = null;
  CLOUD_OWNER_UID = null;
  CLOUD_OWNER_EMAIL = "";
  CLOUD_CLINIC_OWNER_UID = null;
  CLOUD_CLINIC_OWNER_EMAIL = "";
  CLOUD_ACCESS_KIND = "guest";
  CLOUD_MEMBER_INFO = null;
}

function normalizeDBShape(db){
  const base = freshDB();
  const out = (db && typeof db === "object") ? { ...base, ...db } : base;
  if(!Array.isArray(out.masters)) out.masters = [];
  if(!Array.isArray(out.users)) out.users = [];
  if(!Array.isArray(out.contacts)) out.contacts = [];
  if(!Array.isArray(out.entries)) out.entries = [];
  if(!Array.isArray(out.tasks)) out.tasks = [];
  if(!Array.isArray(out.payments)) out.payments = [];
  if(!out.settings || typeof out.settings !== "object") out.settings = {};
  if(typeof out.settings.waTemplate !== "string" || !out.settings.waTemplate.trim()){
    out.settings.waTemplate = base.settings.waTemplate;
  }
  if(!out.version) out.version = "cloud_v2";
  if(!out.createdAt) out.createdAt = new Date().toISOString();
  return out;
}

function getLegacyLocalDB(){
  const raw = localStorage.getItem(DBKEY);
  if(!raw) return null;
  try{ return normalizeDBShape(JSON.parse(raw)); }catch(_){ return null; }
}

async function getCurrentSupabaseUser(){
  if(typeof supabaseClient === "undefined" || !supabaseClient?.auth) return null;
  try{
    const { data, error } = await supabaseClient.auth.getUser();
    if(error) return null;
    return data?.user || null;
  }catch(_){
    return null;
  }
}

function normalizeUsername(value){
  return String(value || "").trim().toLowerCase();
}

function usernameToSyntheticEmail(username){
  const clean = normalizeUsername(username).replace(/[^a-z0-9._-]/g, "");
  if(!clean) return "";
  return `${clean}@users.cronos.local`;
}

function resolveUserLoginEmail(login){
  const raw = String(login || "").trim().toLowerCase();
  if(!raw) return "";
  if(raw.includes("@")) return raw;
  return usernameToSyntheticEmail(raw);
}

function ensureMasterRecordByEmail(db, email, fallbackName=""){
  db = normalizeDBShape(db);
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if(!normalizedEmail) return db;

  let master = (db.masters || []).find(m => (String(m?.email || "").toLowerCase() === normalizedEmail) || m?.id === normalizedEmail);
  if(!master){
    master = {
      id: normalizedEmail,
      name: fallbackName || normalizedEmail.split("@")[0],
      email: normalizedEmail,
      createdAt: new Date().toISOString()
    };
    db.masters.unshift(master);
  }else{
    master.id = normalizedEmail;
    master.email = normalizedEmail;
    if(!master.name) master.name = fallbackName || normalizedEmail.split("@")[0];
    if(!master.createdAt) master.createdAt = new Date().toISOString();
  }

  return db;
}

function getMasterRecordByEmail(db, email){
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return (db?.masters || []).find(m => String(m?.email || "").toLowerCase() === normalizedEmail || m?.id === normalizedEmail) || null;
}

function ensureMemberMirror(db, membership){
  db = normalizeDBShape(db);
  if(!membership) return db;

  const ownerEmail = String(CLOUD_CLINIC_OWNER_EMAIL || "").trim().toLowerCase();
  if(ownerEmail){
    ensureMasterRecordByEmail(db, ownerEmail);
  }
  const masterId = ownerEmail || membership.owner_uid;

  let userRow = (db.users || []).find(u => u?.authUid === membership.auth_uid)
    || (db.users || []).find(u => masterId && u?.masterId === masterId && membership.username && normalizeUsername(u?.username) === normalizeUsername(membership.username))
    || (db.users || []).find(u => masterId && u?.masterId === masterId && String(u?.loginEmail || u?.email || "").trim().toLowerCase() === String(membership.email || "").trim().toLowerCase());

  const visibleEmail = String(membership.email || "").endsWith("@users.cronos.local") ? "" : String(membership.email || "");

  if(!userRow){
    userRow = {
      id: uid("u"),
      authUid: membership.auth_uid,
      masterId,
      name: membership.name || membership.username || "Usuário",
      username: membership.username || "",
      email: visibleEmail,
      loginEmail: String(membership.email || "").trim().toLowerCase(),
      role: membership.role || "SECRETARIA",
      active: membership.active !== false,
      pendingApproval: membership.pending_approval === true,
      blockedReason: membership.blocked_reason || null,
      createdAt: new Date().toISOString()
    };
    db.users.push(userRow);
  }else{
    userRow.authUid = membership.auth_uid;
    userRow.masterId = userRow.masterId || masterId;
    userRow.name = membership.name || userRow.name || membership.username || "Usuário";
    userRow.username = membership.username || userRow.username || "";
    userRow.email = visibleEmail || userRow.email || "";
    userRow.loginEmail = String(membership.email || userRow.loginEmail || userRow.email || "").trim().toLowerCase();
    userRow.role = membership.role || userRow.role || "SECRETARIA";
    userRow.active = membership.active !== false;
    userRow.pendingApproval = membership.pending_approval === true;
    userRow.blockedReason = membership.blocked_reason || null;
  }

  return db;
}

async function getClinicMembershipByAuthUid(authUid){
  if(typeof supabaseClient === "undefined" || !supabaseClient) return null;
  if(!authUid) return null;

  const { data, error } = await supabaseClient
    .from(CLOUD_MEMBERS_TABLE)
    .select("id, owner_uid, auth_uid, email, username, name, role, active, pending_approval, blocked_reason, created_at, updated_at")
    .eq("auth_uid", authUid)
    .maybeSingle();

  if(error && error.code !== "PGRST116"){
    console.error("Erro ao carregar vínculo do usuário:", error);
    return null;
  }

  return data || null;
}

async function resolveClinicAccessContext(user){
  if(!user) return null;

  const ownerEmail = String(user.email || "").trim().toLowerCase();
  const isInternalUser = String(user?.user_metadata?.cronos_kind || "").toLowerCase() === "member"
    || ownerEmail.endsWith("@users.cronos.local");

  const ownerResp = await supabaseClient
    .from(CLOUD_TABLE)
    .select("id, owner_uid, owner_email, clinic_name, data, updated_at")
    .eq("owner_uid", user.id)
    .maybeSingle();

  if(ownerResp.error && ownerResp.error.code !== "PGRST116"){
    throw ownerResp.error;
  }

  if(ownerResp.data){
    return {
      kind: "owner",
      ownerUid: user.id,
      ownerEmail: String(ownerResp.data.owner_email || ownerEmail || "").trim().toLowerCase(),
      row: ownerResp.data,
      member: null
    };
  }

  const membership = await getClinicMembershipByAuthUid(user.id);
  if(membership){
    const rowResp = await supabaseClient
      .from(CLOUD_TABLE)
      .select("id, owner_uid, owner_email, clinic_name, data, updated_at")
      .eq("owner_uid", membership.owner_uid)
      .maybeSingle();

    if(rowResp.error && rowResp.error.code !== "PGRST116"){
      throw rowResp.error;
    }

    const memberOwnerEmail = String(rowResp.data?.owner_email || "").trim().toLowerCase();

    if(membership.active === false){
      return {
        kind: membership.pending_approval ? "member_pending" : "member_inactive",
        ownerUid: membership.owner_uid,
        ownerEmail: memberOwnerEmail,
        row: rowResp.data || null,
        member: membership
      };
    }

    return {
      kind: "member",
      ownerUid: membership.owner_uid,
      ownerEmail: memberOwnerEmail,
      row: rowResp.data || null,
      member: membership
    };
  }

  return {
    kind: isInternalUser ? "member_orphan" : "orphan",
    ownerUid: isInternalUser ? null : user.id,
    ownerEmail: isInternalUser ? "" : ownerEmail,
    row: null,
    member: null
  };
}

async function applyCloudAccessContext(user){
  const ctx = await resolveClinicAccessContext(user);

  if(!ctx){
    resetCloudContext();
    return null;
  }

  CLOUD_OWNER_UID = user?.id || null;
  CLOUD_OWNER_EMAIL = String(user?.email || "").trim().toLowerCase();
  CLOUD_CLINIC_OWNER_UID = ctx.ownerUid || null;
  CLOUD_CLINIC_OWNER_EMAIL = String(ctx.ownerEmail || "").trim().toLowerCase();
  CLOUD_ACCESS_KIND = ctx.kind || "guest";
  CLOUD_MEMBER_INFO = ctx.member || null;
  CLOUD_ROW_ID = ctx.row?.id || null;

  return ctx;
}

function buildClinicStatePayload(db, user){
  const ownerUid = CLOUD_CLINIC_OWNER_UID || user.id;
  const ownerEmail = String(CLOUD_CLINIC_OWNER_EMAIL || user.email || "").trim().toLowerCase();
  const normalized = ensureMasterRecordByEmail(normalizeDBShape(db), ownerEmail);
  const master = getMasterRecordByEmail(normalized, ownerEmail) || normalized.masters[0] || {};
  return {
    owner_uid: ownerUid,
    owner_email: ownerEmail,
    clinic_name: master.name || (ownerEmail ? ownerEmail.split("@")[0] : "Clínica"),
    data: normalized
  };
}


function __cronosItemTime(item){
  if(!item || typeof item !== "object") return 0;
  const candidates = [item.updatedAt, item.lastUpdateAt, item.at, item.createdAt, item.lastSeenAt, item.firstSeenAt, item.date, item.dueDate];
  for(const v of candidates){
    if(!v) continue;
    const t = Date.parse(String(v).length === 10 ? String(v)+"T00:00:00" : String(v));
    if(Number.isFinite(t)) return t;
  }
  return 0;
}
function __cronosMergeArrayById(cloudArr, localArr){
  const out = new Map();
  (Array.isArray(cloudArr) ? cloudArr : []).forEach(item=>{
    if(!item || typeof item !== "object") return;
    const id = String(item.id || item.key || "").trim();
    if(id) out.set(id, item);
  });
  (Array.isArray(localArr) ? localArr : []).forEach(item=>{
    if(!item || typeof item !== "object") return;
    const id = String(item.id || item.key || "").trim();
    if(!id){
      out.set(`__noid_${Math.random()}_${Date.now()}`, item);
      return;
    }
    const prev = out.get(id);
    if(!prev){
      out.set(id, item);
      return;
    }
    const localTime = __cronosItemTime(item);
    const cloudTime = __cronosItemTime(prev);
    out.set(id, localTime >= cloudTime ? item : prev);
  });
  return Array.from(out.values());
}
function mergeCloudAndLocalDB(cloudDB, localDB){
  const cloud = normalizeDBShape(cloudDB || freshDB());
  const local = normalizeDBShape(localDB || freshDB());
  const merged = normalizeDBShape({ ...cloud, ...local });
  merged.masters = __cronosMergeArrayById(cloud.masters, local.masters);
  merged.users = __cronosMergeArrayById(cloud.users, local.users);
  merged.contacts = __cronosMergeArrayById(cloud.contacts, local.contacts);
  merged.entries = __cronosMergeArrayById(cloud.entries, local.entries);
  merged.tasks = __cronosMergeArrayById(cloud.tasks, local.tasks);
  merged.payments = __cronosMergeArrayById(cloud.payments, local.payments);
  merged.settings = { ...(cloud.settings || {}), ...(local.settings || {}) };
  merged.version = local.version || cloud.version || "cloud_v2";
  merged.createdAt = cloud.createdAt || local.createdAt || new Date().toISOString();
  merged.lastMergedAt = new Date().toISOString();

  try{ scrubInstallmentTasksForAllMasters(merged); }catch(e){ console.warn("Falha ao higienizar tarefas no merge:", e); }

  return normalizeDBShape(merged);
}

async function flushCloudSave(dbToSave){
  const user = await getCurrentSupabaseUser();
  if(!user) return false;

  const ctx = await applyCloudAccessContext(user);
  const ownerEmail = String(ctx?.ownerEmail || user.email || "").trim().toLowerCase();

  let normalized = ensureMasterRecordByEmail(normalizeDBShape(dbToSave || DB || freshDB()), ownerEmail);
  if(ctx?.row?.data){
    normalized = mergeCloudAndLocalDB(ctx.row.data, normalized);
    normalized = ensureMasterRecordByEmail(normalized, ownerEmail);
  }
  if(CLOUD_MEMBER_INFO){
    normalized = ensureMemberMirror(normalized, CLOUD_MEMBER_INFO);
  }

  try{ scrubInstallmentTasksForAllMasters(normalized); }catch(e){ console.warn("Falha ao higienizar tarefas antes da nuvem:", e); }

  DB = normalized;
  localStorage.setItem(DBKEY, JSON.stringify(normalized));

  const payload = buildClinicStatePayload(normalized, user);

  let data = null;
  let error = null;

  if(ctx?.kind === "member"){
    const resp = await supabaseClient
      .from(CLOUD_TABLE)
      .update({
        owner_email: payload.owner_email,
        clinic_name: payload.clinic_name,
        data: payload.data
      })
      .eq("owner_uid", payload.owner_uid)
      .select("id, updated_at")
      .single();
    data = resp.data;
    error = resp.error;
  }else{
    const resp = await supabaseClient
      .from(CLOUD_TABLE)
      .upsert(payload, { onConflict: "owner_uid" })
      .select("id, updated_at")
      .single();
    data = resp.data;
    error = resp.error;
  }

  if(error){
    console.error("Erro ao salvar no Supabase:", error);
    if(!shouldSuppressCloudFailureToast()){
      toast("Falha ao salvar na nuvem", "Os dados ficaram no navegador e podem ser sincronizados depois.");
    }
    return false;
  }

  CLOUD_ROW_ID = data?.id || CLOUD_ROW_ID;
  CLOUD_DB_READY = true;
  return true;
}

function scheduleCloudSave(immediate=false){
  if(typeof supabaseClient === "undefined" || !supabaseClient?.auth) return Promise.resolve(false);
  if(__cloudSaveTimer){
    clearTimeout(__cloudSaveTimer);
    __cloudSaveTimer = null;
  }
  const run = ()=>{
    __cloudSavePromise = flushCloudSave(DB).catch(err=>{
      console.error("Erro na sincronização com a nuvem:", err);
      return false;
    });
    return __cloudSavePromise;
  };
  if(immediate){
    return run();
  }
  __cloudSaveTimer = setTimeout(run, 650);
  return Promise.resolve(true);
}

async function ensureCloudDBLoaded(force=false){
  if(DB && CLOUD_DB_READY && !force) return DB;

  if(isSupportMode()){
    const support = getSupportContext();
    if(!support){
      DB = normalizeDBShape(freshDB());
      return DB;
    }

    let loaded = normalizeDBShape(getSupportDB() || support.data || freshDB());
    const supportEmail = String(support.owner_email || "").trim().toLowerCase();
    if(supportEmail){
      loaded = ensureMasterRecordByEmail(loaded, supportEmail, support.clinic_name || "");
      const master = getMasterRecordByEmail(loaded, supportEmail) || loaded.masters?.[0];
      if(master && support.clinic_name){
        master.name = support.clinic_name;
      }
    }

    DB = loaded;
    setSupportDB(DB);
    CLOUD_DB_READY = true;
    CLOUD_ROW_ID = support.clinic_id || null;
    CLOUD_OWNER_UID = null;
    CLOUD_OWNER_EMAIL = "";
    CLOUD_CLINIC_OWNER_UID = support.owner_uid || null;
    CLOUD_CLINIC_OWNER_EMAIL = String(support.owner_email || "").trim().toLowerCase();
    CLOUD_ACCESS_KIND = "support";
    CLOUD_MEMBER_INFO = null;
    return DB;
  }

  const user = await getCurrentSupabaseUser();
  if(!user){
    resetCloudContext();
    DB = normalizeDBShape(getLegacyLocalDB() || freshDB());
    return DB;
  }

  let ctx = null;
  try{
    ctx = await applyCloudAccessContext(user);
  }catch(error){
    console.error("Erro ao carregar dados da nuvem:", error);
    toast("Falha ao carregar da nuvem", "Usando o backup local por enquanto.");
    DB = normalizeDBShape(getLegacyLocalDB() || freshDB());
    return DB;
  }

  if(ctx?.row?.data){
    let loaded = ensureMasterRecordByEmail(normalizeDBShape(ctx.row.data), ctx.ownerEmail || user.email || "");
    const cloudClinicName = String(ctx.row.clinic_name || "").trim();
    if(cloudClinicName){
      const master = getMasterRecordByEmail(loaded, ctx.ownerEmail || user.email || "") || loaded.masters?.[0];
      if(master) master.name = cloudClinicName;
    }
    if(ctx.member){
      loaded = ensureMemberMirror(loaded, ctx.member);
    }
    DB = loaded;
    CLOUD_DB_READY = true;
    localStorage.setItem(DBKEY, JSON.stringify(DB));
    return DB;
  }

  if(ctx?.kind === "member" || ctx?.kind === "member_orphan"){
    DB = normalizeDBShape(getLegacyLocalDB() || freshDB());
    DB = ensureMasterRecordByEmail(DB, ctx.ownerEmail || "");
    DB = ensureMemberMirror(DB, ctx.member);
    CLOUD_DB_READY = false;
    localStorage.setItem(DBKEY, JSON.stringify(DB));
    toast("Acesso sem base da clínica", "Peça para o master entrar primeiro para criar a base na nuvem.");
    return DB;
  }

  DB = ensureMasterRecordByEmail(normalizeDBShape(getLegacyLocalDB() || freshDB()), ctx?.ownerEmail || user.email || "");
  localStorage.setItem(DBKEY, JSON.stringify(DB));

  const created = await flushCloudSave(DB);
  CLOUD_DB_READY = !!created;
  return DB;
}

function loadDB(){
  if(DB) return DB;
  if(isSupportMode()){
    DB = normalizeDBShape(getSupportDB() || freshDB());
    return DB;
  }
  DB = normalizeDBShape(getLegacyLocalDB() || freshDB());
  return DB;
}
function saveDB(db, options={}){
  DB = normalizeDBShape(db);

  if(isSupportMode()){
    setSupportDB(DB);
    try{
      updateSidebarPills();
    }catch(e){}
    return;
  }

  localStorage.setItem(DBKEY, JSON.stringify(DB));

  try{
    updateSidebarPills();
  }catch(e){}

  if(options.skipCloud) return Promise.resolve(false);
  return scheduleCloudSave(!!options.immediate);
}

function createIsolatedSupabaseClient(){
  return window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `cronos-temp-${Date.now()}-${Math.random()}`
    }
  });
}

async function createCloudUserIdentity({ name, username, email, password }){
  const explicitEmail = String(email || "").trim().toLowerCase();
  const normalizedUsername = normalizeUsername(username);
  const loginEmail = normalizedUsername ? usernameToSyntheticEmail(normalizedUsername) : explicitEmail;

  if(!loginEmail){
    throw new Error("Informe um usuário ou e-mail para o login.");
  }

  const tempClient = createIsolatedSupabaseClient();
  const { data, error } = await tempClient.auth.signUp({
    email: loginEmail,
    password,
    options: {
      data: {
        display_name: name || "",
        username: normalizedUsername || "",
        cronos_kind: "member"
      }
    }
  });

  try{ await tempClient.auth.signOut(); }catch(_){}

  if(error) throw error;
  if(!data?.user?.id){
    throw new Error("Não foi possível criar o acesso do usuário.");
  }

  return {
    authUid: data.user.id,
    loginEmail,
    explicitEmail,
    username: normalizedUsername
  };
}

async function insertClinicMemberRecord({ authUid, loginEmail, username, name, role }){
  const owner = await getCurrentSupabaseUser();
  if(!owner) throw new Error("Faça login como master para cadastrar usuários.");

  const payload = {
    owner_uid: owner.id,
    auth_uid: authUid,
    email: String(loginEmail || "").trim().toLowerCase(),
    username: username || null,
    name,
    role,
    active: true
  };

  const { error } = await supabaseClient.from(CLOUD_MEMBERS_TABLE).insert(payload);
  if(error) throw error;
  return payload;
}

async function updateClinicMemberRecord(userRow, { name, role }){
  if(!userRow?.authUid) return;
  const owner = await getCurrentSupabaseUser();
  if(!owner) throw new Error("Sessão do master não encontrada.");

  const { error } = await supabaseClient
    .from(CLOUD_MEMBERS_TABLE)
    .update({
      name,
      role,
      active: true
    })
    .eq("owner_uid", owner.id)
    .eq("auth_uid", userRow.authUid);

  if(error) throw error;
}

async function deactivateClinicMemberRecord(userRow){
  if(!userRow?.authUid) return;
  const owner = await getCurrentSupabaseUser();
  if(!owner) throw new Error("Sessão do master não encontrada.");

  const { error } = await supabaseClient
    .from(CLOUD_MEMBERS_TABLE)
    .update({ active: false })
    .eq("owner_uid", owner.id)
    .eq("auth_uid", userRow.authUid);

  if(error) throw error;
}

async function syncCurrentCloudActor(){
  if(typeof supabaseClient === "undefined"){
    console.log("Supabase ainda não carregou, tentando novamente...");
    setTimeout(syncCurrentCloudActor, 500);
    return null;
  }

  const user = await getCurrentSupabaseUser();
  if(isSupportMode()){
    let db = await ensureCloudDBLoaded(false);
    const support = getSupportContext();
    if(!support) return null;
    const supportEmail = String(support.owner_email || "").trim().toLowerCase();
    db = ensureMasterRecordByEmail(db, supportEmail, support.clinic_name || "");
    const master = getMasterRecordByEmail(db, supportEmail) || db.masters[0];
    if(master && support.clinic_name) master.name = support.clinic_name;
    DB = db;
    setSupportDB(DB);
    return { kind: "support", id: support.owner_uid || supportEmail };
  }

  if(!user) return null;

  let db = await ensureCloudDBLoaded(false);

  const ownerEmail = String(CLOUD_CLINIC_OWNER_EMAIL || user.email || "").trim().toLowerCase();
  db = ensureMasterRecordByEmail(db, ownerEmail);

  if(CLOUD_ACCESS_KIND === "owner"){
    const master = getMasterRecordByEmail(db, ownerEmail) || db.masters[0];
    if(master){
      saveSession({ kind: "master", id: master.id });
      saveDB(db, { skipCloud:true });
      return { kind: "master", id: master.id };
    }
  }

  if(CLOUD_MEMBER_INFO){
    db = ensureMemberMirror(db, CLOUD_MEMBER_INFO);
  } else if(CLOUD_ACCESS_KIND === "member_orphan" || CLOUD_ACCESS_KIND === "member_pending" || CLOUD_ACCESS_KIND === "member_inactive"){
    return null;
  }

  let memberRow = (db.users || []).find(u => u?.authUid === user.id)
    || (db.users || []).find(u => String(u?.loginEmail || u?.email || "").trim().toLowerCase() === String(user.email || "").trim().toLowerCase());

  if(memberRow){
    memberRow.authUid = user.id;
    memberRow.loginEmail = memberRow.loginEmail || String(user.email || "").trim().toLowerCase();
    saveSession({ kind: "user", id: memberRow.id });
    saveDB(db, { skipCloud:true });
    return { kind: "user", id: memberRow.id };
  }

  return null;
}
function migrateDBValues(db){
  let changed = false;
  (db.entries||[]).forEach(e=>{
    if(e && e.valueBudget==null && e.valueEstimated!=null){
      e.valueBudget = e.valueEstimated;
      changed = true;
    }
    if(e && e.valuePaid==null && e.valueClosed!=null){
      e.valuePaid = e.valueClosed;
      changed = true;
    }
  });
  return changed;
}

function getPrefs(){
  const db = loadDB();
  if(!db.settings) db.settings = {};
  if(typeof db.settings.waTemplate !== "string" || !db.settings.waTemplate.trim()){
    db.settings.waTemplate = "Oi {nome}! Vi seu interesse em {tratamento}. Posso te ajudar por aqui? 😊";
    saveDB(db, { skipCloud:true });
  }
  return db.settings;
}

function applyTemplate(tpl, vars){
  return String(tpl||"")
    .replaceAll("{nome}", vars.nome||"")
    .replaceAll("{tratamento}", vars.tratamento||"")
    .trim();
}

function normalizePhoneBR(phone){
  const digits = String(phone||"").replace(/\D+/g,"");
  if(!digits) return "";
  if(digits.startsWith("55")) return digits;
  return "55"+digits;
}

function openWhatsAppForEntry(entryId){
  const db = loadDB();
  const e = db.entries.find(x=>x.id===entryId);
  const c = db.contacts.find(x=>x.id===e?.contactId);
  const phone = normalizePhoneBR(c?.phone||"");
  if(!phone){
    toast("Sem telefone válido para WhatsApp.");
    return;
  }
  const treatment = (e?.treatment==="Outros") ? (e?.treatmentOther||"Outros") : (e?.treatment||"");
  const tpl = getPrefs().waTemplate;
  const msg = applyTemplate(tpl, { nome: c?.name||"", tratamento: treatment });
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
}

function loadSession(){
  const raw = localStorage.getItem(SESSIONKEY);
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch{ return null; }
}
function saveSession(s){ localStorage.setItem(SESSIONKEY, JSON.stringify(s)); }
function clearSession(){ localStorage.removeItem(SESSIONKEY); }

async function hashPass(p){
  try{
    if (window.crypto?.subtle){
      const enc = new TextEncoder().encode(p);
      const buf = await crypto.subtle.digest("SHA-256", enc);
      return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
    }
  }catch(e){}
  let h = 2166136261;
  for (let i=0;i<p.length;i++){ h ^= p.charCodeAt(i); h = Math.imul(h, 16777619); }
  return "fnv1a_" + (h>>>0).toString(16);
}

/* -------- Autenticação -------- */
function currentActor(){
  const db = loadDB();

  if(isSupportMode()){
    const support = getSupportContext();
    const supportEmail = String(support?.owner_email || support?.master_email || "").trim().toLowerCase();
    const fallbackName = String(support?.clinic_name || "").trim();
    let master = getMasterRecordByEmail(db, supportEmail) || db.masters?.[0];

    if(!master){
      const syntheticId = supportEmail || `support:${String(support?.clinic_id || "clinic")}`;
      master = {
        id: syntheticId,
        name: fallbackName || "Modo suporte",
        email: supportEmail || "",
        createdAt: new Date().toISOString()
      };
      db.masters.unshift(master);
      setSupportDB(db);
      DB = db;
    }

    if(fallbackName) master.name = fallbackName;
    if(supportEmail && !master.email) master.email = supportEmail;

    return {
      kind:"master",
      id:master.id,
      masterId:master.id,
      name:master.name,
      email:master.email || supportEmail || "",
      role:"MASTER",
      isPrimaryMaster:true,
      isSupport:true,
      perms: {...PERMS.MASTER, manageMasters:true}
    };
  }

  const s = loadSession();
  if(!s) return null;
  if(s.kind==="master"){
    const m = db.masters.find(x=>x.id===s.id);
    if(!m) return null;
    return {kind:"master", id:m.id, masterId:m.id, name:m.name, email:m.email, role:"MASTER", isPrimaryMaster:true, isSupport:false, perms: {...PERMS.MASTER, manageMasters:true} };
  }
  if(s.kind==="user"){
    const u = db.users.find(x=>x.id===s.id);
    if(!u) return null;
    if(u.pendingApproval === true || u.active === false){
      window.__CRONOS_ACCESS_BLOCK__ = {
        title: u.pendingApproval ? "Aguardando liberação" : "Acesso bloqueado",
        message: String(u.blockedReason || (u.pendingApproval
          ? "Seu usuário foi criado, mas ainda depende da aprovação do superadmin."
          : "Esse usuário está inativo e precisa ser liberado pelo superadmin."))
      };
      return null;
    }
    window.__CRONOS_ACCESS_BLOCK__ = null;
    return {kind:"user", id:u.id, masterId:u.masterId, name:u.name, email:(u.email || u.loginEmail || ""), username:u.username, role:u.role, isPrimaryMaster:false, isSupport:false, perms: (PERMS[u.role] || PERMS.DENTISTA)};
  }
  return null;
}


function roleLabelPt(role){
  const map = {
    MASTER: "Master",
    GERENTE: "Gerente",
    SECRETARIA: "Secretária",
    DENTISTA: "Dentista"
  };
  return map[String(role || "").toUpperCase()] || String(role || "Usuário");
}

function setLoginLoading(isLoading, message="Entrando no Cronos..."){
  window.__CRONOS_LOGIN_BUSY__ = !!isLoading;

  const card = document.querySelector("#authView .authCard");
  const hint = el("authLoadingHint");
  const hintText = el("authLoadingText");
  const btn = el("btnLogin");
  const btnCreate = el("btnCreateMaster");
  const authMode = el("authMode");
  const authLogin = el("authLogin");
  const authPass = el("authPass");
  const authLabel = el("authAccessLabel");
  const authModeWrap = el("authModeWrap");
  const authLoginWrap = authLogin?.parentElement;
  const authPassWrap = authPass?.parentElement;
  const authButtons = btn?.parentElement;

  if(card) card.classList.toggle("loading", !!isLoading);

  if(hint){
    hint.classList.toggle("hidden", !isLoading);
  }
  if(hintText && message){
    hintText.textContent = message;
  }

  [authMode, authLogin, authPass, btnCreate].forEach(node=>{
    if(node) node.disabled = !!isLoading;
  });

  [authModeWrap, authLoginWrap, authPassWrap, authButtons].forEach(node=>{
    if(!node) return;
    node.classList.toggle("hidden", !!isLoading);
  });

  if(authLabel && !isSupportMode()){
    authLabel.textContent = isLoading ? "Validando acesso" : "Acesso da Clínica";
  }

  if(btn){
    btn.disabled = !!isLoading;
    btn.classList.toggle("loading", !!isLoading);
    btn.innerHTML = isLoading
      ? '<span class="btnSpinner"><span class="spinner" aria-hidden="true"></span></span>Entrando...'
      : 'Entrar';
  }
}


function setSupportEntryLoading(isLoading, message="Modo suporte • Validando acesso e carregando a clínica..."){
  const authLabel = el("authAccessLabel");
  const supportHint = el("supportEntryHint");
  const supportText = el("supportEntryText");
  const authModeWrap = el("authModeWrap");
  const authMasterWrap = el("authMasterNameWrap");
  const authLogin = el("authLogin")?.parentElement;
  const authPass = el("authPass")?.parentElement;
  const authButtons = el("btnLogin")?.parentElement;

  if(isLoading){
    setLoginLoading(false);
  }

  if(authLabel){
    authLabel.textContent = isLoading ? "Modo suporte" : "Acesso da Clínica";
  }
  if(supportHint){
    supportHint.classList.toggle("hidden", !isLoading);
  }
  if(supportText && message){
    supportText.textContent = message;
  }

  [authModeWrap, authMasterWrap, authLogin, authPass, authButtons].forEach(node=>{
    if(!node) return;
    node.classList.toggle("hidden", !!isLoading);
  });
}

function triggerLoginSubmit(){
  if(window.__CRONOS_LOGIN_BUSY__) return;
  const btn = el("btnLogin");
  if(btn) btn.click();
}

function bindLoginEnterSubmit(){
  ["authLogin","authPass","authMode"].forEach(id=>{
    const node = el(id);
    if(!node || node.dataset.enterBound === "1") return;
    node.dataset.enterBound = "1";
    node.addEventListener("keydown", (ev)=>{
      if(ev.key === "Enter"){
        ev.preventDefault();
        triggerLoginSubmit();
      }
    });
  });
}

function refreshAuthMasters(){
  const db = loadDB();
  const sel = el("authMasterSelect");
  if(!sel) return;
  sel.innerHTML = db.masters.length
    ? db.masters.map(m=>`<option value="${m.id}">${escapeHTML(m.name)} (${escapeHTML(m.email)})</option>`).join("")
    : `<option value="">(Nenhum master cadastrado)</option>`;
  sel.disabled = (el("authMode").value === "master");
}

function showAuth(){
  hideBootSplash();
  window.__CRONOS_SESSION_CHECKING__ = false;
  window.__CRONOS_BOOTING__ = false;
  el("authView").classList.remove("hidden");
  el("appView").classList.add("hidden");
  hideAccessGate();
  hideAccessNotice();

  const supportTokenPresent = new URLSearchParams(location.search).has("support_token");
  const supportPending = supportTokenPresent || (!currentActor() && isSupportMode());

  if(supportPending){
    setSupportEntryLoading(true, "Modo suporte • Validando acesso e carregando a clínica...");
  }else{
    setSupportEntryLoading(false);
    setLoginLoading(false);
  }

  const exitBtn = el("btnExitSupport");
  if(exitBtn) exitBtn.classList.add("hidden");
  syncThemeButtons();
  window.__CRONOS_BOOTED = true;
}

function showApp(actor){
  hideBootSplash();
  window.__CRONOS_SESSION_CHECKING__ = false;
  window.__CRONOS_BOOTING__ = false;
  window.__CRONOS_ACCESS_BLOCK__ = null;
  setSupportEntryLoading(false);
  el("authView").classList.add("hidden");
  el("appView").classList.remove("hidden");
  hideAccessGate();
  el("brandName").textContent = "Cronos Odonto";
  const support = getSupportContext();
  const clinicLabel = actor?.isSupport
    ? (support?.clinic_name || actor.name || "Clínica")
    : (actor.kind==="master" ? actor.name : masterName(actor.masterId));
  el("brandSub").textContent = actor?.isSupport ? `Clínica: ${clinicLabel} • Modo suporte` : `Clínica: ${clinicLabel}`;
  el("whoami").textContent = actor?.isSupport
    ? `Modo suporte ativo • ${support?.owner_email || actor.email || "sem e-mail"}`
    : `Bem-vindo, ${actor.name} • ${roleLabelPt(actor.role)}`;
  const exitBtn = el("btnExitSupport");
  if(exitBtn) exitBtn.classList.toggle("hidden", !actor?.isSupport);
  syncThemeButtons();
  applyRoleVisibility(actor);

  try{
    const db = loadDB();
    const before = Array.isArray(db.tasks) ? db.tasks.length : 0;
    const stats = syncInstallmentTasks(db, actor) || {};
    const after = Array.isArray(db.tasks) ? db.tasks.length : 0;
    saveDB(db, { immediate:true });
    if(before !== after && !window.__CRONOS_TASK_REPAIR_TOASTED__){
      window.__CRONOS_TASK_REPAIR_TOASTED__ = true;
      toast("Tarefas higienizadas", `Antes: ${before} • Depois: ${after}`);
    }
  }catch(e){
    console.warn("Falha ao higienizar tarefas no boot:", e);
  }

  window.__CRONOS_BOOTED = true;
}

function syncThemeButtons(){
  const cur = localStorage.getItem(THEMEKEY) || "dark";
  applyTheme(cur);
}

function masterName(masterId){
  const db = loadDB();
  const m = db.masters.find(x=>x.id===masterId);
  return m ? m.name : "—";
}

/* -------- Filtros principais -------- */
const FILTERKEY = "cronoscrm_phase1_filters";
function loadFilters(){
  const raw = localStorage.getItem(FILTERKEY);
  const now = new Date();
  const def = {
    year: String(now.getFullYear()),
    monthKey: now.toISOString().slice(0,7), // YYYY-MM or "all"
    search:"",
    status:"",
    treatment:"",
    origin:"",
    periodFrom:"",
    periodTo:"",
    order:"recent"
  };
  if(!raw) return def;
  try{
    const parsed = JSON.parse(raw) || {};
    const out = {...def, ...parsed};
    if(!out.year){
      const mk = String(out.monthKey||def.monthKey);
      out.year = mk && mk!=="all" ? mk.slice(0,4) : def.year;
    }
    if(!out.periodFrom && (parsed.firstFrom||parsed.apptFrom)) out.periodFrom = parsed.firstFrom || parsed.apptFrom || "";
    if(!out.periodTo && (parsed.firstTo||parsed.apptTo)) out.periodTo = parsed.firstTo || parsed.apptTo || "";
    if(!out.order) out.order = "recent";
    if(!out.monthKey || out.monthKey === "all"){
      out.monthKey = def.monthKey;
      out.year = def.year;
    }
    return out;
  }catch{
    return def;
  }
}
function saveFilters(f){ localStorage.setItem(FILTERKEY, JSON.stringify(f)); }

function getUIFilters(){
  return {
    year: val("fYear", String(new Date().getFullYear())),
    monthKey: val("fMonth", new Date().toISOString().slice(0,7)), // YYYY-MM or "all"
    search: val("fSearch","").trim(),
    status: val("fStatus",""),
    campaign: val("fCampaign",""),
    treatment: val("fTreatment",""),
    origin: val("fOrigin",""),
    periodFrom: val("fPeriodFrom",""),
    periodTo: val("fPeriodTo",""),
    order: val("fOrder","recent")
  };
}
function setUIFilters(f){
  const now = new Date();
  setVal("fYear", f.year || String(now.getFullYear()));
  setVal("fMonth", f.monthKey || now.toISOString().slice(0,7));
  setVal("fSearch", f.search || "");
  setVal("fStatus", f.status || "");
  setVal("fCampaign", f.campaign || "");
  setVal("fTreatment", f.treatment || "");
  setVal("fOrigin", f.origin || "");
  setVal("fPeriodFrom", f.periodFrom || "");
  setVal("fPeriodTo", f.periodTo || "");
  setVal("fOrder", f.order || "recent");
}

function ensureYearOptions(){
  const db = loadDB();
  const actor = currentActor();
  const now = new Date();
  const currentYear = now.getFullYear();

  const ySet = new Set([String(currentYear)]);
  if(actor){
    (db.entries||[])
      .filter(e=>e.masterId===actor.masterId)
      .forEach(e=>{
        const mk = String(e.monthKey||"").slice(0,7);
        if(!mk) return;
        const y = mk.slice(0,4);
        if(y) ySet.add(y);
      });
  }

  const years = Array.from(ySet).sort((a,b)=>Number(b)-Number(a)); // desc
  el("fYear").innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join("");

  const f = loadFilters ? loadFilters() : null;
  const desired = (getUIFilters()?.year) || (f?.year) || String(currentYear);
  if(el("fYear").value !== desired) el("fYear").value = desired;
}

function ensureMonthOptions(){
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthKey = `${currentYear}-${String(now.getMonth()+1).padStart(2,"0")}`;

  const selectedYear = Number(val("fYear", String(currentYear))) || currentYear;

  const months = [];
  months.push({ value: "all", label: "Todos" });

  for(let m=1; m<=12; m++){
    const mk = `${selectedYear}-${String(m).padStart(2,"0")}`;
    months.push({ value: mk, label: monthLabel(mk) });
  }

  el("fMonth").innerHTML = months.map(o=>`<option value="${o.value}">${o.label}</option>`).join("");

  const f = loadFilters ? loadFilters() : {};
  const desiredMk = (getUIFilters()?.monthKey) || f.monthKey || currentMonthKey;

  let finalMk = desiredMk;
  if(finalMk !== "all"){
    const y = String(finalMk).slice(0,4);
    if(Number(y)!==selectedYear){
      finalMk = (selectedYear===currentYear) ? currentMonthKey : "all";
    }
  }

  if(el("fMonth").value !== finalMk) el("fMonth").value = finalMk;
}


function fillSelectOptions(){
  el("fStatus").innerHTML = `<option value="">Todos</option>` + STATUS_LIST.map(s=>`<option value="${s}">${s}</option>`).join("");
  el("fOrigin").innerHTML = `<option value="">Todos</option>` + ORIGINS.map(o=>`<option value="${o}">${o}</option>`).join("");
  el("fTreatment").innerHTML = `<option value="">Todos</option>` + TREATMENTS.map(t=>`<option value="${t}">${t}</option>`).join("");
}

/* -------- Acesso aos dados -------- */
function filteredEntries(){
  const db = loadDB();
  const actor = currentActor();
  if(!actor) return [];

  const f = getUIFilters();

  const rawSearch = String(el("fSearch")?.value ?? f.search ?? "").trim();

  function normText(v){
    return String(v ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  const search = normText(rawSearch);
  const searchDigits = String(rawSearch || "").replace(/\D/g, "");
  const hasGlobalLeadSearch = !!search || !!searchDigits;

  const periodFrom = parseISO(f.periodFrom);
  const periodTo = parseISO(f.periodTo);

  function inRangeISO(d, a, b){
    if(!d) return false;
    const dt = parseISO(d);
    if(a && dt < a) return false;
    if(b && dt > b) return false;
    return true;
  }

  function entryRefDate(e){
    return e.firstContactAt || e.apptDate || e.createdAt || e.updatedAt || (e.monthKey ? (String(e.monthKey).slice(0,7) + "-01") : "");
  }

  const contactsById = new Map((db.contacts || []).map(c=>[String(c.id), c]));

  let rows = (db.entries || [])
    .filter(e=>e.masterId === actor.masterId);

  if(hasGlobalLeadSearch){
    rows = rows.filter(e=>{
      const c = contactsById.get(String(e.contactId || "")) || {};
      const hayText = normText([
        c.name, c.phone, c.cpf,
        e.name, e.lead, e.nome, e.phone, e.telefone,
        e.city, e.notes, e.originOther, e.treatmentOther,
        e.status, e.origin, e.treatment,
        e.monthKey, monthLabel(String(e.monthKey || "").slice(0,7) || ""),
        ...(Array.isArray(e.tags) ? e.tags : [])
      ].filter(Boolean).join(" "));

      const hayDigits = [
        c.phone, c.cpf,
        e.phone, e.telefone, e.contato
      ].filter(Boolean).join(" ").replace(/\D/g, "");

      const textOk = search ? hayText.includes(search) : false;
      const digitsOk = searchDigits ? hayDigits.includes(searchDigits) : false;
      return textOk || digitsOk;
    });
  }else{
    rows = rows.filter(e=>{
      if(f.monthKey && f.monthKey !== "all"){
        return e.monthKey === f.monthKey;
      }
      const y = String(e.monthKey || "").slice(0,4);
      if(f.year && y !== String(f.year)) return false;
      return true;
    });
  }

  if(f.periodFrom || f.periodTo){
    rows = rows.filter(e=>inRangeISO(entryRefDate(e), periodFrom, periodTo));
  }

  rows = rows
    .filter(e=> !f.status || e.status===f.status)
    .filter(e=>{
      if(!f.campaign) return true;
      const inCampaign = Array.isArray(e?.tags) && e.tags.includes("Campanha");
      return f.campaign === "yes" ? inCampaign : !inCampaign;
    })
    .filter(e=> !f.treatment || e.treatment===f.treatment)
    .filter(e=> !f.origin || e.origin===f.origin);

  try{
    const order = f.order || "recent";
    const nameOf = (e)=> (contactsById.get(String(e.contactId||""))?.name || "").toLowerCase();
    const dateOf = (e)=> parseISO(entryRefDate(e)) || new Date(0);

    if(order==="recent") rows.sort((a,b)=> dateOf(b) - dateOf(a));
    else if(order==="old") rows.sort((a,b)=> dateOf(a) - dateOf(b));
    else if(order==="az") rows.sort((a,b)=> nameOf(a).localeCompare(nameOf(b)));
    else if(order==="za") rows.sort((a,b)=> nameOf(b).localeCompare(nameOf(a)));
  }catch(_){}

  return rows;
}

function getContact(contactId){
  const db = loadDB();
  return db.contacts.find(c=>c.id===contactId) || null;
}

/* -------- Renderização da interface -------- */
function updateSidebarPills(){
  const db = loadDB();
  const actor = currentActor();
  if(!actor) return;
  const allMonth = filteredEntries();
  const total = allMonth.length;
  const hotCount = allMonth.filter(e=>e.tags?.includes("Prioridade: Quente")).length;
  const usersCount = db.users.filter(u=>u.masterId===actor.masterId).length + 1; // master
  el("pillTotal").textContent = String(total);
  el("pillHot").textContent = `${hotCount} hot`;
  el("pillUsers").textContent = String(usersCount);

const currentMonth = new Date().toISOString().slice(0,7);
const currentMonthTasks = (db.tasks||[]).filter(t=>t.masterId===actor.masterId && t.done!==true && String(t.dueDate||"").slice(0,7)===currentMonth);
const tasksOpen = currentMonthTasks.length;
const overdue = currentMonthTasks.filter(t=>t.dueDate && (new Date(t.dueDate+"T00:00:00") < new Date(new Date().toISOString().slice(0,10)+"T00:00:00"))).length;
const pillK = el("pillKanban"); if(pillK) pillK.textContent = String(total);
const pillT = el("pillTasks"); if(pillT) pillT.textContent = overdue ? `${overdue} ⚠️` : String(tasksOpen);

}


const STATUS_UI_LABELS = {
  "Conversando":"Em conversa",
  "Agendado":"Agendados",
  "Compareceu":"Compareceram",
  "Fechou":"Fechados",
  "Remarcou":"Remarcados",
  "Faltou":"Faltaram",
  "Desmarcou":"Desmarcados",
  "Sem resposta":"Sem resposta",
  "Msg não entregue":"Mensagens não entregues",
  "Mensagem não entregue":"Mensagens não entregues",
  "Número incorreto":"Números incorretos",
  "Achou caro":"Acharam caro",
  "Não tem interesse":"Sem interesse",
  "Mora longe":"Moram longe",
  "Mora em outra cidade":"Moram em outra cidade",
  "Fechou em outro lugar":"Fecharam em outro lugar",
  "Concluído":"Concluídos"
};

function dashStatusLabel(status){
  return STATUS_UI_LABELS[String(status||"").trim()] || String(status||"—");
}
function getDashStatusFilter(){
  return String(window.__DASH_STATUS_ACTIVE || "");
}
function setDashStatusFilter(status){
  const next = String(status||"");
  window.__DASH_STATUS_ACTIVE = (getDashStatusFilter()===next) ? "" : next;
  renderDashboard();
}

function getEntryBudgetValue(e){
  if(!e) return 0;

  try{
    const plans = Array.isArray(e.financialPlans) ? e.financialPlans : [];
    const totalPlans = plans.reduce((sum,p)=>sum + Number(p.amount || p.total || 0), 0);
    if(totalPlans > 0) return totalPlans;
  }catch(_){}

  try{
    const items = Array.isArray(e?.ficha?.plano) ? e.ficha.plano : [];
    const fichaTotal = items.reduce((sum,item)=>sum + Number(item.valorFechado ?? item.valorBase ?? 0), 0);
    if(fichaTotal > 0) return fichaTotal;
  }catch(_){}

  return (e.valueBudget!=null && !isNaN(Number(e.valueBudget)))
    ? Number(e.valueBudget)
    : ((e.valueEstimated!=null && !isNaN(Number(e.valueEstimated))) ? Number(e.valueEstimated) : 0);
}
function getEntryPaidValue(e){
  if(!e) return 0;

  try{
    const plans = Array.isArray(e.financialPlans) ? e.financialPlans : [];
    const totalPaidPlans = plans.reduce((sum,p)=>{
      const pays = Array.isArray(p.payments) ? p.payments : [];
      return sum + pays
        .filter(pay=>!!pay.paidAt || pay.status === "PAGA" || pay.paid === true)
        .reduce((s,pay)=>s + Number(pay.amount || 0), 0);
    }, 0);
    if(totalPaidPlans > 0) return totalPaidPlans;
  }catch(_){}

  return (e.valuePaid!=null && !isNaN(Number(e.valuePaid)))
    ? Number(e.valuePaid)
    : ((e.valueClosed!=null && !isNaN(Number(e.valueClosed))) ? Number(e.valueClosed) : 0);
}


function getEntryCashPaidValue(e){
  if(!e) return 0;

  const paidCandidates = [
    e.totalRecebido,
    e.valuePaid,
    e.paidValue,
    e.valorPago,
    e.valorRecebido,
    e.receivedValue,
    e.amountPaid,
    e.paidAmount,
    e.totalPaid,
    e.receivedAmount
  ];
  for(const v of paidCandidates){
    const n = parseMoney(v);
    if(n > 0) return n;
  }
  return 0;
}

function getEntryStrictUndatedLegacyPaidValue(e){
  if(!e) return 0;

  const paidCandidates = [
    e.totalRecebido,
    e.paidValue,
    e.valorPago,
    e.valorRecebido,
    e.receivedValue,
    e.received,
    e.amountPaid,
    e.paidAmount,
    e.totalPaid,
    e.receivedAmount
  ];
  for(const v of paidCandidates){
    const n = parseMoney(v);
    if(n > 0) return n;
  }
  return 0;
}
function getEntryHistoricalValuePaidOnly(e){
  if(!e) return 0;
  const paidCandidates = [
    e.valuePaid,
    e.valorPago,
    e.valorRecebido,
    e.totalRecebido,
    e.paidValue,
    e.receivedValue,
    e.amountPaid,
    e.paidAmount,
    e.totalPaid,
    e.receivedAmount
  ];
  for(const v of paidCandidates){
    const n = parseMoney(v);
    if(n > 0) return n;
  }
  return 0;
}

function entryHasLegacyOriginalPaidValue(e){
  return getEntryCashPaidValue(e) > 0 ||
    parseMoney(e?.valuePaidGross) > 0 ||
    parseMoney(e?.valorPagoBruto) > 0 ||
    parseMoney(e?.valueClosedGross) > 0;
}
function getEntryUnsafeGrossPaidValue(e){
  return Math.max(
    parseMoney(e?.valuePaidGross),
    parseMoney(e?.valorPagoBruto),
    parseMoney(e?.valueClosedGross)
  );
}
function isAutoMigratedLegacyPlan(plan){
  const source = String(plan?.source || "").toLowerCase();
  const title = String(plan?.title || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return !!(
    plan?.legacyInstallPlan === true ||
    source === "legacyinstallments" ||
    source === "legacyinstallment" ||
    source === "legacyentry" ||
    title.includes("parcelamento legado")
  );
}
function legacyPlanShouldBeSkippedAsAdapter(entry, plan){
  if(!isAutoMigratedLegacyPlan(plan)) return false;
  const hasOriginalInstallments = Array.isArray(entry?.installments) && entry.installments.length > 0;
  const hasOriginalPaid = entryHasLegacyOriginalPaidValue(entry);
  const hasLegacyInstallPlan = !!entry?.installPlan;
  return hasOriginalInstallments || hasOriginalPaid || hasLegacyInstallPlan;
}
function pickISOFlexible(raw){
  if(raw instanceof Date) return raw.toISOString().slice(0,10);
  if(typeof raw === "number"){
    const d = new Date(raw);
    return isNaN(d) ? "" : d.toISOString().slice(0,10);
  }
  if(typeof raw === "string"){
    const s = raw.trim();
    if(!s) return "";
    if(/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(s)) return s.slice(0,10);
    const mm = s.match(/^([0-3]?\d)\/([0-1]?\d)\/([12]\d{3})(?:\s+.*)?$/);
    if(mm){
      const dd = String(mm[1]).padStart(2,'0');
      const mo = String(mm[2]).padStart(2,'0');
      const yyyy = mm[3];
      return `${yyyy}-${mo}-${dd}`;
    }
    const d = new Date(s);
    if(!isNaN(d)) return d.toISOString().slice(0,10);
  }
  return "";
}
function getDashboardEntryDate(e){
  return pickISOFlexible(
    e?.apptDate ||
    e?.firstContactAt ||
    e?.firstContact ||
    e?.createdAt ||
    e?.createdISO ||
    e?.lastUpdateAt ||
    e?.updatedAt ||
    e?.appointmentAt ||
    e?.agendamentoAt ||
    e?.date ||
    (e?.monthKey ? `${String(e.monthKey).slice(0,7)}-01` : "")
  );
}
function dashboardDateInRange(iso, fromISO, toISO){
  if(!iso) return false;
  if(fromISO && iso < fromISO) return false;
  if(toISO && iso > toISO) return false;
  return true;
}
function getDashboardPaymentsForRows(db, actor, rows){
  const ids = new Set((rows||[]).map(e=>String(e?.id||"")).filter(Boolean));
  const contactIds = new Set((rows||[]).map(e=>String(e?.contactId||"")).filter(Boolean));
  return (db?.payments||[])
    .filter(p=>!actor || !p.masterId || p.masterId===actor.masterId)
    .filter(p=>{
      const entryId = String(p?.entryId||"");
      const contactId = String(p?.contactId||"");
      if(ids.size){
        if(entryId && ids.has(entryId)) return true;
        if(!entryId && contactId && contactIds.has(contactId)) return true;
        return false;
      }
      return true;
    })
    .map(p=>({ ...p, __iso: pickISOFlexible(p?.date || p?.at || p?.paidAt || "") }))
    .filter(p=>p.__iso);
}
function buildDashboardRevenueData(rows, db, actor, filters){
  const todayISO = new Date().toISOString().slice(0,10);
  const currentMonthKey = todayISO.slice(0,7);
  const currentYear = todayISO.slice(0,4);
  const monthNamesShort = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const fromISO = String(filters?.periodFrom||"").trim();
  const toISO = String(filters?.periodTo||"").trim();

  const entries = Array.isArray(db?.entries) ? db.entries : [];
  const contacts = Array.isArray(db?.contacts) ? db.contacts : [];

  const entryKey = (obj)=>{
    const entryId = String(obj?.entryId || obj?.id || "").trim();
    if(entryId) return `entry:${entryId}`;
    const contactId = String(obj?.contactId || "").trim();
    if(contactId) return `contact:${contactId}`;
    return "";
  };

  const findEntryFrom = (obj)=>{
    const entryId = String(obj?.entryId || obj?.id || "").trim();
    if(entryId){
      const e = entries.find(x=>String(x?.id||"")===entryId);
      if(e) return e;
    }
    const contactId = String(obj?.contactId || "").trim();
    if(contactId){
      return entries.find(x=>String(x?.contactId||"")===contactId) || null;
    }
    return null;
  };

  const contactNameFrom = (obj)=>{
    const entry = findEntryFrom(obj);
    const contactId = String(obj?.contactId || entry?.contactId || "").trim();
    const contact = contactId ? contacts.find(c=>String(c?.id||"")===contactId) : null;
    return contact?.name || obj?.contactName || obj?.name || entry?.name || "Sem paciente vinculado";
  };

  const detailItem = (kind, value, obj, iso, desc)=>({
    kind,
    value: Number(value||0),
    iso: iso || "",
    patient: contactNameFrom(obj),
    desc: String(desc || obj?.desc || obj?.description || "").trim(),
    method: String(obj?.method || obj?.payMethod || "").trim(),
    entryId: String(obj?.entryId || obj?.id || "").trim(),
    contactId: String(obj?.contactId || "").trim(),
    source: String(obj?.source || "").trim()
  });

  function computeMonthData(monthKey, monthRows){
    const daysInMonth = new Date(Number(monthKey.slice(0,4)), Number(monthKey.slice(5,7)), 0).getDate();
    const grossSeries = Array.from({length: daysInMonth}, ()=>0);
    const receivedSeries = Array.from({length: daysInMonth}, ()=>0);
    const grossDetails = Array.from({length: daysInMonth}, ()=>[]);
    const receivedDetails = Array.from({length: daysInMonth}, ()=>[]);
    const isCurrentMonth = monthKey === currentMonthKey;
    const monthRowsSafe = (monthRows||[]).filter(e=>String(e?.monthKey||"")===monthKey);
    const monthStartISO = `${monthKey}-01`;
    const monthEndISO = `${monthKey}-${String(daysInMonth).padStart(2,"0")}`;
    const effectiveFromISO = fromISO && fromISO > monthStartISO ? fromISO : monthStartISO;
    const effectiveToISO = toISO && toISO < monthEndISO ? toISO : monthEndISO;
    const monthPaymentsAll = getReceivedEventsForPeriod(db, actor, effectiveFromISO, effectiveToISO, { includeLegacyDueFallback:false, includeUndatedLegacyByEntryMonth:true });

    (monthRowsSafe||[]).forEach(e=>{
      const budget = getEntryBudgetValue(e);
      if(!budget) return;
      const iso = getDashboardEntryDate(e);
      if(!iso || iso.slice(0,7)!==monthKey) return;
      if((fromISO || toISO) && !dashboardDateInRange(iso, fromISO, toISO)) return;
      const day = Number(iso.slice(8,10));
      if(day>=1 && day<=daysInMonth){
        grossSeries[day-1] += budget;
        grossDetails[day-1].push(detailItem("gross", budget, e, iso, "Orçamento/plano do lead"));
      }
    });

    let monthPayments = monthPaymentsAll;
    if(isCurrentMonth) monthPayments = monthPayments.filter(p=>p.iso <= todayISO);

    monthPayments.forEach(p=>{
      const val = Number(p.value || p.amount || 0);
      const iso = p.iso || p.__iso || "";
      const day = Number(String(iso).slice(8,10));
      if(day>=1 && day<=daysInMonth){
        receivedSeries[day-1] += val;
        receivedDetails[day-1].push(detailItem("received", val, p, iso, p.desc || "Lançamento no caixa/recebimentos"));
      }
    });

    return { grossSeries, receivedSeries, grossDetails, receivedDetails };
  }

  if(filters?.monthKey && filters.monthKey !== "all"){
    const monthKey = filters.monthKey;
    const labels = Array.from({length: new Date(Number(monthKey.slice(0,4)), Number(monthKey.slice(5,7)), 0).getDate()}, (_,i)=>String(i+1).padStart(2,"0"));
    const monthData = computeMonthData(monthKey, rows || []);

    return {
      mode: "daily",
      axisLabelPrefix: "Dia",
      labels,
      grossSeries: monthData.grossSeries,
      receivedSeries: monthData.receivedSeries,
      grossDetails: monthData.grossDetails,
      receivedDetails: monthData.receivedDetails,
      totalReceived: monthData.receivedSeries.reduce((sum,v)=>sum + (Number(v)||0), 0),
      titleText: "Receita (R$) por dia",
      hintText: "(bruto/orçado por dia • recebido por dia • clique no ponto para ver a origem)"
    };
  }

  const selectedYear = String(filters?.year || currentYear);
  const labels = monthNamesShort.slice();
  const grossSeries = Array.from({length: 12}, ()=>0);
  const receivedSeries = Array.from({length: 12}, ()=>0);
  const grossDetails = Array.from({length: 12}, ()=>[]);
  const receivedDetails = Array.from({length: 12}, ()=>[]);

  for(let monthIndex=0; monthIndex<12; monthIndex++){
    const monthKey = `${selectedYear}-${String(monthIndex+1).padStart(2,"0")}`;
    const monthRows = (rows||[]).filter(e=>String(e?.monthKey||"")===monthKey);
    const monthData = computeMonthData(monthKey, monthRows);
    grossSeries[monthIndex] = monthData.grossSeries.reduce((sum,v)=>sum + (Number(v)||0), 0);
    receivedSeries[monthIndex] = monthData.receivedSeries.reduce((sum,v)=>sum + (Number(v)||0), 0);
    grossDetails[monthIndex] = monthData.grossDetails.flat();
    receivedDetails[monthIndex] = monthData.receivedDetails.flat();
  }

  return {
    mode: "monthly",
    axisLabelPrefix: "Mês",
    labels,
    grossSeries,
    receivedSeries,
    grossDetails,
    receivedDetails,
    totalReceived: receivedSeries.reduce((sum,v)=>sum + (Number(v)||0), 0),
    titleText: "Receita (R$) por mês",
    hintText: "(bruto/orçado por mês • recebido por mês • clique no ponto para ver a origem)"
  };
}
function renderDashboard(){
  const rows = filteredEntries();
  const dashKpiActive = String(window.__KPI_ACTIVE || "");
  const rowsForDashboardDetail = (typeof __dashboardRowsByKpi === "function") ? __dashboardRowsByKpi(dashKpiActive, rows) : rows;
  const byStatus = new Map();
  const byStatusValue = new Map(); // soma R$ em aberto (orçado - pago) por status
  let totalBudget = 0;
  let totalOpen = 0;
  let positive = 0, dq = 0, appt = 0;

  const actor = currentActor();
  const db = loadDB();
  const dashRevenue = buildDashboardRevenueData(rows, db, actor, getUIFilters());
  const totalPaid = dashRevenue.totalReceived;

  const isRescueEntry = (e)=> Array.isArray(e?.tags) && e.tags.includes("Resgatado");
  const totalBase = rows.length || 0;

  rows.forEach(e=>{
    const budget = isRescueEntry(e) ? 0 : getEntryBudgetValue(e);
    const paid = getEntryPaidValue(e);
    const open = Math.max(0, (budget||0) - (paid||0));

    totalBudget += (budget||0);
    if(open) totalOpen += open;
  });

  rowsForDashboardDetail.forEach(e=>{
    const budget = isRescueEntry(e) ? 0 : getEntryBudgetValue(e);
    const paid = getEntryPaidValue(e);
    const open = Math.max(0, (budget||0) - (paid||0));
    byStatus.set(e.status, (byStatus.get(e.status)||0) + 1);
    byStatusValue.set(e.status, (byStatusValue.get(e.status)||0) + (open||0));
  });

  rows.forEach(e=>{
    if(POSITIVE.has(e.status)) positive++;
    if(DISQUALIFIED.has(e.status)) dq++;
    if(e && (e.status==='Agendado' || e.status==='Remarcou')) appt++;
  });

  const pctBaseNum = (n)=> totalBase ? `${((Number(n||0)/totalBase)*100).toFixed(1).replace('.',',')}%` : '0%';
  const pctBudgetNum = (n)=> totalBudget ? `${((Number(n||0)/totalBudget)*100).toFixed(1).replace('.',',')}%` : '0%';

  el("kpiTotal").textContent = totalBase;
  el("kpiPositive").textContent = positive;
  el("kpiDQ").textContent = dq;
  el("kpiAppt").textContent = appt;

  const kpiTotalPct = el('kpiTotalPct');
  if(kpiTotalPct) kpiTotalPct.textContent = '100%';
  const kpiPositivePct = el('kpiPositivePct');
  if(kpiPositivePct) kpiPositivePct.textContent = pctBaseNum(positive);
  const kpiDQPct = el('kpiDQPct');
  if(kpiDQPct) kpiDQPct.textContent = pctBaseNum(dq);
  const kpiApptPct = el('kpiApptPct');
  if(kpiApptPct) kpiApptPct.textContent = pctBaseNum(appt);

  try{
    const budgetCount = rows.reduce((acc,e)=>{
      const b = isRescueEntry(e) ? 0 : getEntryBudgetValue(e);
      return acc + ((b && b>0) ? 1 : 0);
    }, 0);
    const avg = budgetCount ? (totalBudget / budgetCount) : 0;
    const kpiAvg = el("kpiBudgetAvg");
    if(kpiAvg) kpiAvg.textContent = moneyBR(avg);
  }catch(_){ }

  const kpiBudget = el("kpiBudgetTotal");
  if(kpiBudget) kpiBudget.textContent = moneyBR(totalBudget);
  const kpiClosed = el("kpiClosedValue");
  if(kpiClosed) kpiClosed.textContent = moneyBR(totalPaid);
  const kpiOpen = el("kpiOpenValue");
  if(kpiOpen) kpiOpen.textContent = moneyBR(totalOpen);
  const kpiReceivedPct = el('kpiReceivedPct');
  if(kpiReceivedPct) kpiReceivedPct.textContent = pctBudgetNum(totalPaid);
  const kpiOpenPct = el('kpiOpenPct');
  if(kpiOpenPct) kpiOpenPct.textContent = pctBudgetNum(totalOpen);

  const grid = el("dashByStatusGrid");
  const ordered = STATUS_LIST.map(s=>[s, byStatus.get(s)||0]).filter(([_,n])=>n>0);
  let dashStatusActive = getDashStatusFilter();
  if(dashStatusActive && !ordered.some(([s])=>s===dashStatusActive)){
    window.__DASH_STATUS_ACTIVE = "";
    dashStatusActive = "";
  }

  grid.innerHTML = `
    <div class="sgHead">Status</div>
    <div class="sgHead center">Total</div>
    <div class="sgHead right">Valor em aberto</div>
  `;
  if(!ordered.length){
    const a=document.createElement("div"); a.className="muted"; a.style.gridColumn="1 / -1"; a.style.padding="12px";
    a.textContent="Sem leads no filtro atual.";
    grid.appendChild(a);
  } else {
    ordered.forEach(([s,n])=>{
      const active = dashStatusActive===s;
      const activeStyle = active ? "background:rgba(96,165,250,.14); box-shadow:inset 0 0 0 1px rgba(96,165,250,.35);" : "";
      const row = document.createElement("div"); row.className="sgRow";
      const c1=document.createElement("div");
      c1.textContent = dashStatusLabel(s);
      c1.style.cursor = "pointer";
      c1.style.fontWeight = active ? "800" : "600";
      c1.style.transition = "all .15s ease";
      c1.style.cssText += activeStyle;
      c1.dataset.dashStatus = s;
      c1.title = "Clique para filtrar os leads abaixo por este status";

      const c2=document.createElement("div");
      c2.className="center nowrap";
      c2.innerHTML="<b>"+String(n)+"</b>";
      c2.style.cursor = "pointer";
      c2.style.transition = "all .15s ease";
      c2.style.cssText += activeStyle;
      c2.dataset.dashStatus = s;
      c2.title = "Clique para filtrar os leads abaixo por este status";

      const c3=document.createElement("div");
      c3.className="right nowrap";
      c3.innerHTML="<b>"+moneyBR(byStatusValue.get(s)||0)+"</b>";
      c3.style.cursor = "pointer";
      c3.style.transition = "all .15s ease";
      c3.style.cssText += activeStyle;
      c3.dataset.dashStatus = s;
      c3.title = "Clique para filtrar os leads abaixo por este status";

      row.appendChild(c1); row.appendChild(c2); row.appendChild(c3);
      grid.appendChild(row);
    });

    const hint = document.createElement("div");
    hint.style.gridColumn = "1 / -1";
    hint.style.padding = "10px 12px";
    hint.style.display = "flex";
    hint.style.justifyContent = "space-between";
    hint.style.alignItems = "center";
    hint.style.gap = "10px";
    hint.innerHTML = `
      <div class="muted" style="font-size:12px">
        ${dashKpiActive && dashKpiActive !== "total" ? `Indicador ativo: <b>${escapeHTML(__kpiTitle(dashKpiActive))}</b>. Clique em Total para limpar.` : "Clique em um status para filtrar os leads abaixo."}
      </div>
      ${dashStatusActive ? `<button type="button" id="btnDashStatusClear" class="miniBtn">Mostrar todos</button>` : `<div class="muted" style="font-size:12px">Filtro atual: Todos</div>`}
    `;
    grid.appendChild(hint);
  }
  grid.querySelectorAll("[data-dash-status]").forEach(node=>{
    node.onclick = ()=> setDashStatusFilter(node.dataset.dashStatus || "");
    node.onkeydown = (ev)=>{
      if(ev.key==="Enter" || ev.key===" "){
        ev.preventDefault();
        setDashStatusFilter(node.dataset.dashStatus || "");
      }
    };
    node.tabIndex = 0;
    node.setAttribute("role","button");
  });
  const btnDashStatusClear = el("btnDashStatusClear");
  if(btnDashStatusClear){
    btnDashStatusClear.onclick = ()=>{
      window.__DASH_STATUS_ACTIVE = "";
      renderDashboard();
    };
  }
  try{ grid.dataset.rendered="1"; }catch(_){ }




 const dashStatusActivePreview = getDashStatusFilter();
const sortedRows = rowsForDashboardDetail
  .slice()
  .sort((a,b)=>(b.lastUpdateAt||"").localeCompare(a.lastUpdateAt||""));

const previewSource = dashStatusActivePreview
  ? sortedRows.filter(e=>String(e.status||"")===dashStatusActivePreview)
  : sortedRows;

const totalPrev = previewSource.length;
const previewLimit = window.DASH_PREVIEW_LIMIT || 10;
const prev = previewSource.slice(0, previewLimit);

const box = el("dashPreview");
if(!prev.length){
  box.innerHTML = `<div class="muted">Nenhum lead encontrado${dashStatusActivePreview ? ` para <b>${escapeHTML(dashStatusLabel(dashStatusActivePreview))}</b>` : ""}.</div>`;
} else {
  box.innerHTML =
    prev.map(e=>{
      const c = db.contacts.find(x=>x.id===e.contactId);
      const tagRes = e.tags?.includes("Resgatado") ? `<span class="tagPill">♻️ Resgatado</span>` : "";
      return `
        <div class="card" style="padding:10px; margin-bottom:10px">
          <div style="display:flex; justify-content:space-between; gap:10px">
            <div>
              <div style="font-weight:800">${escapeHTML(c?.name||"—")}</div>
              <div class="muted" style="font-size:12px; margin-top:2px">
                ${escapeHTML(c?.phone||"—")} • ${escapeHTML(e.status||"—")}
              </div>
            </div>
            <div style="display:flex; gap:8px; align-items:start">
              ${tagRes}
              <button class="miniBtn" onclick="openLeadEntry('${e.id}')">Abrir</button>
            </div>
          </div>
        </div>
      `;
    }).join("")
    +
    `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:8px">
        <div class="muted" style="font-size:12px">
          Mostrando ${prev.length} de ${totalPrev} leads${dashStatusActivePreview ? ` • Status: ${escapeHTML(dashStatusLabel(dashStatusActivePreview))}` : ""}
        </div>
        ${
          totalPrev > previewLimit
            ? `<button id="btnDashPreviewMore" class="miniBtn">Ver mais</button>`
            : `<div class="muted" style="font-size:12px">Todos os leads exibidos</div>`
        }
      </div>
    `;

  const btnMore = el("btnDashPreviewMore");
  if(btnMore){
    btnMore.onclick = () => {
      window.DASH_PREVIEW_LIMIT = (window.DASH_PREVIEW_LIMIT || 10) + 10;
      renderAll();
    };
  }
}

try{ __bindKpiClicks(); }catch(_){}

requestAnimationFrame(()=>renderDashboardCharts(rows));
}
function statusDotClass(status){
  const s = (status||"").trim();
  const map = {
    "Conversando":"st-yellow",
    "Agendado":"st-blue",
    "Compareceu":"st-green",
    "Fechou":"st-purple",
    "Remarcou":"st-orange",
    "Faltou":"st-red",
    "Desmarcou":"st-red",
    "Sem resposta":"st-gray",
    "Msg não entregue":"st-gray",
    "Número incorreto":"st-gray",
    "Achou caro":"st-red",
    "Não tem interesse":"st-red",
    "Fechou em outro lugar":"st-red",
    "Concluído":"st-green"
  };
  return map[s] || "st-gray";
}
function chipStatus(e){
  const st = e.status||"—";
  const cls = statusDotClass(st);
  return `<span class="chip"><span class="dot ${cls}"></span>${escapeHTML(st)}</span>`;
}
function chipOrigin(e){
  const v = e.origin==="Outros" ? (e.originOther||"Outros") : e.origin;
  return `<span class="chip">${escapeHTML(v||"—")}</span>`;
}
function chipTreatment(e){
  const v = e.treatment==="Outros" ? (e.treatmentOther||"Outros") : e.treatment;
  return `<span class="chip">${escapeHTML(v||"—")}</span>`;
}

window.DASH_PREVIEW_LIMIT = 10;

/* -------- Dashboard charts (Canvas, sem biblioteca) -------- */
function renderDashboardCharts(rows){
  const line = el("chartRevenueLine");
  const bar = el("chartStatusBars");
  if(!line || !bar) return;

  const actor = currentActor();
  const db = loadDB();
  const revenueData = buildDashboardRevenueData(rows, db, actor, getUIFilters());

  const by = new Map();
  rows.forEach(e=> by.set(e.status||"—", (by.get(e.status||"—")||0)+1));
  const statusPairs = Array.from(by.entries()).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const barLabels = statusPairs.map(([s])=>s);
  const barValues = statusPairs.map(([_,n])=>n);

  const __doDrawDashCharts = () => {
    drawMultiLineChart(line, revenueData.labels, [
      { name:"Recebido", values: revenueData.receivedSeries, details: revenueData.receivedDetails, color:"rgba(46,229,157,0.9)", fill:true },
      { name:"Bruto/Orçado", values: revenueData.grossSeries, details: revenueData.grossDetails, color:"rgba(255,90,90,0.9)", dash:[6,6], fill:false }
    ], { yPrefix: "", showPoints: false, showMaxLabel: false, axisLabelPrefix: revenueData.axisLabelPrefix || "Dia" });

    const valueEl = document.getElementById("lineChartValue");
    if(valueEl) valueEl.textContent = moneyBR(revenueData.totalReceived);

    const titleEl = document.getElementById("lineChartTitleText");
    if(titleEl) titleEl.textContent = revenueData.titleText;

    const hintEl = document.getElementById("lineChartHint");
    if(hintEl) hintEl.textContent = revenueData.hintText;

    drawBarChart(bar, barLabels, barValues);
  };

  requestAnimationFrame(() => {
    __doDrawDashCharts();
    setTimeout(__doDrawDashCharts, 120);
  });
}
function clearCanvas(canvas){
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  let w = rect.width;
  let h = rect.height;

  if(w < 50) w = (canvas.parentElement?.getBoundingClientRect().width) || 600;
  if(h < 50) h = 180;

  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  return {ctx, w, h};
}

function drawLineChart(canvas, labels, values, opt={}){
  const {ctx,w,h} = clearCanvas(canvas);
const css = getComputedStyle(document.documentElement);
const textColor = css.getPropertyValue('--text').trim();
const mutedColor = css.getPropertyValue('--muted').trim();
  const pad = 28;
  const top = 64;// reserva p/ legenda (mais espaço p/ não sobrepor)
  const maxV = Math.max(1, ...values);
  const minV = 0;

  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = mutedColor;
  ctx.beginPath();
  ctx.moveTo(pad, top);
  ctx.lineTo(pad, h-pad);
  ctx.lineTo(w-10, h-pad);
  ctx.stroke();

  ctx.strokeStyle = "rgba(30,120,255,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v,i)=>{
    const x = pad + (i*(w-pad-10))/Math.max(1, values.length-1);
    const y = (h-pad) - ((v-minV)*(h-pad-top))/Math.max(1, (maxV-minV));
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();

  ctx.fillStyle = textColor || "1f2937";
  ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  const step = Math.ceil(labels.length/8);
  for(let i=0;i<labels.length;i+=step){
    const x = pad + (i*(w-pad-10))/Math.max(1, labels.length-1);
    ctx.fillText(labels[i], x-8, h-10);
  }
  ctx.fillText((opt.yPrefix||"")+moneyBR(maxV).replace(/R\$\s*/,""), 10, 18);
}

function drawMultiLineChart(canvas, labels, series, opt={}){
  if(!canvas) return;

  const css = getComputedStyle(document.documentElement);
  const isLight = document.documentElement.classList.contains("light");
  const textColor = css.getPropertyValue('--text').trim() || (isLight ? "#0f172a" : "#e8eef7");
  const mutedColor = css.getPropertyValue('--muted').trim() || (isLight ? "#334155" : "#aab4c3");
  const gridColor = isLight ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.18)";
  const axisColor = isLight ? "rgba(15,23,42,0.20)" : "rgba(255,255,255,0.28)";
  const labelColor = isLight ? "rgba(15,23,42,0.78)" : "rgba(232,238,246,0.88)";
  const legendTextColor = isLight ? "rgba(15,23,42,0.90)" : "rgba(232,238,246,0.96)";

  const w0 = canvas.clientWidth || canvas.width || 0;
  const h0 = canvas.clientHeight || canvas.height || 0;
  if(w0===0 || h0===0) return;

  const {ctx,w,h} = clearCanvas(canvas);

  const padL = 34;
  const padR = 18;
  const padB = 30;
  const topBase = 64; // legenda + respiro

  const all = (series||[]).flatMap(s=>s.values||[]).filter(v=>typeof v==="number" && !isNaN(v));
  let minV = Math.min(...(all.length?all:[0]));
  let maxV = Math.max(...(all.length?all:[1]));
  if(!isFinite(minV)) minV = 0;
  if(!isFinite(maxV)) maxV = 1;
  if(maxV === minV) maxV = minV + 1;

  const range = Math.max(1, maxV - minV);
  const padRange = range * 0.12; // 12% de folga
  minV = Math.max(0, minV - padRange);
  maxV = maxV + padRange;

  const plotLeft = padL;
  const plotRight = w - padR;
  const plotTop = topBase;
  const plotBottom = h - padB;

  const X = (i,n) => plotLeft + (i*(plotRight-plotLeft))/Math.max(1, n-1);
  const Y = (v)   => plotBottom - ((v-minV)*(plotBottom-plotTop))/Math.max(1e-9, (maxV-minV));

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = gridColor;
  const gridLines = 4;
  for(let g=0; g<=gridLines; g++){
    const yy = plotTop + (g*(plotBottom-plotTop))/gridLines;
    ctx.beginPath();
    ctx.moveTo(plotLeft, yy);
    ctx.lineTo(plotRight, yy);
    ctx.stroke();
  }
  ctx.strokeStyle = axisColor;
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotTop);
  ctx.lineTo(plotLeft, plotBottom);
  ctx.lineTo(plotRight, plotBottom);
  ctx.stroke();
  ctx.restore();

  function drawSmoothPath(values){
    const n = values.length;
    if(n===0) return;
    const pts = values.map((v,i)=>({x:X(i,n), y:Y(v)}));
    if(n<3){
      ctx.beginPath();
      pts.forEach((p,i)=> i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      return pts;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for(let i=0;i<n-1;i++){
      const p0 = pts[i-1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i+1];
      const p3 = pts[i+2] || p2;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    return pts;
  }

  (series||[]).forEach((s, si)=>{
    const values = (s.values||[]).map(v=>Number(v)||0);
    if(values.length===0) return;

    ctx.save();
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = s.color || "rgba(30,120,255,0.9)";
    if(Array.isArray(s.dash)) ctx.setLineDash(s.dash); else ctx.setLineDash([]);

    const pts = drawSmoothPath(values);

    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.stroke();

    if(s.fill){
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.18;
      const grad = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
      grad.addColorStop(0, (s.color||"rgba(46,229,157,0.9)").replace("0.9","0.22"));
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.lineTo(pts[pts.length-1].x, plotBottom);
      ctx.lineTo(pts[0].x, plotBottom);
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.strokeStyle = s.color || "rgba(46,229,157,0.9)";
    ctx.lineWidth = 2;
    if(opt.showPoints){
    pts.forEach((p,i)=>{
      const isLast = (i===pts.length-1);
      const r = isLast ? 6 : 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI*2);
      ctx.fill();
      ctx.stroke();
    });
  }
ctx.restore();
  });

  ctx.save();
  ctx.fillStyle = labelColor;
  ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  const step = Math.ceil(labels.length/7);
  for(let i=0;i<labels.length;i+=step){
    const x = X(i, labels.length);
    ctx.fillText(labels[i], x-10, h-10);
  }

  if(opt.showMaxLabel !== false){
    ctx.fillStyle = labelColor;
    ctx.fillText((opt.yPrefix||"")+moneyBR(maxV).replace(/R\$\s*/,""), 10, 18);
  }
  ctx.restore();
  ctx.save();
  let x = plotLeft, y = 22;
  const maxX = plotRight;
  series.forEach(s=>{
    const name = s.name||"";
    ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const need = 18 + ctx.measureText(name).width + 18;
    if(x + need > maxX){ x = plotLeft; y += 18; }
    ctx.fillStyle = s.color || "rgba(30,120,255,0.9)";
    ctx.fillRect(x, y, 12, 3);
    if(Array.isArray(s.dash)){
      ctx.save();
      ctx.strokeStyle = s.color || "rgba(30,120,255,0.9)";
      ctx.setLineDash(s.dash);
      ctx.beginPath();
      ctx.moveTo(x, y+6);
      ctx.lineTo(x+12, y+6);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = legendTextColor;
    ctx.fillText(name, x+16, y+7);
    x += need;
  });
  ctx.restore();

  try{
    canvas.__chartData = {
      type:"multiLine",
      labels: labels,
      series: (series||[]).map(s=>({
        name:s.name,
        values:(s.values||[]),
        details:(Array.isArray(s.details) ? s.details : []),
        color:(s.color||"rgba(30,120,255,0.9)"),
        dash:(Array.isArray(s.dash)?s.dash:null)
      })),
      pad: plotLeft, top: plotTop, w: w, h: h,
      yPrefix: (opt.yPrefix||"R$ "),
      axisLabelPrefix: (opt.axisLabelPrefix||"Dia"),
      plotLeft, plotRight, plotTop, plotBottom,
      minV, maxV
    };
    __bindChartHoverOnce(canvas);
    return maxV;
  }catch(_){}
  return 0;
}

function drawBarChart(canvas, labels, values){
  if(!canvas) return;
  const w0 = canvas.clientWidth || canvas.width || 0;
  const h0 = canvas.clientHeight || canvas.height || 0;
  if(w0===0 || h0===0) return;

  const isLight = document.documentElement.classList.contains("light");
  const labelColor = isLight ? "rgba(15,23,42,0.82)" : "rgba(232,238,246,0.92)";
  const axisColor = isLight ? "rgba(15,23,42,0.18)" : "rgba(255,255,255,0.26)";

  const {ctx,w,h} = clearCanvas(canvas);
  const pad = 28;
  const top = 56;// mais área útil p/ barras
  const maxV = Math.max(1, ...values);
  const n = values.length || 1;
  const barW = (w - pad - 10) / n;
  const rects = [];

  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, top);
  ctx.lineTo(pad, h-pad);
  ctx.lineTo(w-10, h-pad);
  ctx.stroke();

  for(let i=0;i<n;i++){
    const v = values[i]||0;
    const bh = ((v)* (h-pad-top)) / maxV;
    const x = pad + i*barW + 6;
    const y = (h-pad) - bh;
    ctx.fillStyle = "rgba(30,120,255,0.7)";
    ctx.fillRect(x, y, Math.max(6, barW-12), bh);
    rects.push({x:x, y:y, w:Math.max(6, barW-12), h:bh, label:labels[i]||"", value:values[i]||0});
    ctx.fillStyle = labelColor;
    ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const lab = (labels[i]||"").slice(0,12);
    ctx.fillText(lab, x, h-10);
  }

  try{
    canvas.__chartData = { type:"bar", rects: rects };
    __bindChartHoverOnce(canvas);
  }catch(_){}

}

let currentPage = 1;
const leadsPerPage = 50;


function renderLeadsPagination(totalLeads, totalPages){
  const wrap = document.getElementById('leadsPagination');
  if(!wrap) return;
  if(!totalLeads){
    wrap.innerHTML = `<span class="muted">Mostrando 0 de 0 leads</span>`;
    return;
  }

  const startItem = ((currentPage - 1) * leadsPerPage) + 1;
  const endItem = Math.min(totalLeads, currentPage * leadsPerPage);

  const pages = [];
  const addPage = (p) => {
    if(p >= 1 && p <= totalPages && !pages.includes(p)) pages.push(p);
  };

  addPage(1);
  for(let p = currentPage - 2; p <= currentPage + 2; p++) addPage(p);
  addPage(totalPages);
  pages.sort((a,b)=>a-b);

  const parts = [];
  for(let i=0; i<pages.length; i++){
    const p = pages[i];
    const prev = pages[i-1];
    if(i>0 && p - prev > 1){
      parts.push(`<span class="muted">…</span>`);
    }
    parts.push(
      p === currentPage
        ? `<button class="btn primary" type="button" data-page="${p}" aria-current="page">${p}</button>`
        : `<button class="btn ghost" type="button" data-page="${p}">${p}</button>`
    );
  }

  wrap.innerHTML = `
    <div class="muted" style="margin-right:auto">Mostrando ${startItem}-${endItem} de ${totalLeads} leads</div>
    <button class="btn ghost" type="button" data-page="prev" ${currentPage <= 1 ? 'disabled' : ''}>← Anterior</button>
    ${parts.join('')}
    <button class="btn ghost" type="button" data-page="next" ${currentPage >= totalPages ? 'disabled' : ''}>Próxima →</button>
  `;

  wrap.querySelectorAll('button[data-page]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const token = btn.dataset.page;
      if(token === 'prev' && currentPage > 1){
        currentPage--;
      }else if(token === 'next' && currentPage < totalPages){
        currentPage++;
      }else if(/^\d+$/.test(token)){
        currentPage = Number(token);
      }else{
        return;
      }
      renderLeadsTable(filteredEntries());
    });
  });
}

function renderLeadsTable(list){
  const cardsWrap = document.getElementById('leadsCards');
  const tbody = document.getElementById('leadsTbody'); // fallback antigo (se existir)
  const db = loadDB();
  const _contactsById = new Map((db.contacts||[]).map(c=>[String(c.id), c]));
  const _getContact = (cid)=> _contactsById.get(String(cid||''));

  const target = cardsWrap || tbody;
  if(!target) return;

  const fullList = Array.isArray(list) ? [...list] : [];

  const totalLeads = fullList.length;
  const totalPages = Math.max(1, Math.ceil(totalLeads / leadsPerPage));

  if (currentPage > totalPages) currentPage = 1;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * leadsPerPage;
  const end = start + leadsPerPage;

  list = fullList.slice(start, end);

  const cardsHtml = (list||[]).map((e)=>{
    const c = e?.contactId ? _getContact(e.contactId) : null;

    const name = escapeHTML(c?.name || e.name || e.lead || e.nome || '—');

    const phoneRaw = String(c?.phone || e.phone || e.contato || e.telefone || '').trim();
    const phoneDigits = phoneRaw.replace(/\D/g,'');
    const phonePretty = phoneDigits ? phoneDigits : '—';

    const prioridadeRaw = (e.priority || e.prioridade || e.temperature || e.temperatura || e.temp || e.pri || '').toString().trim();
    let prioridade = prioridadeRaw;
    const priNorm = String(prioridadeRaw).trim().toLowerCase();
    if (priNorm === '2' || priNorm === 'hot' || priNorm === 'quente' || priNorm === 'q') prioridade = 'Quente';
    else if (priNorm === '1' || priNorm === 'warm' || priNorm === 'morno' || priNorm === 'm') prioridade = 'Morno';
    else if (priNorm === '0' || priNorm === 'cold' || priNorm === 'frio' || priNorm === 'f') prioridade = 'Frio';

    const tagsArr = ([]
      .concat(Array.isArray(e.tags) ? e.tags : (Array.isArray(e.tag) ? e.tag : (e.tag ? [e.tag] : [])))
      .concat(Array.isArray(c?.tags) ? c.tags : (Array.isArray(c?.tag) ? c.tag : (c?.tag ? [c.tag] : [])))
      .map(String));
    if (!prioridade && tagsArr.length) {
      const tagPref = tagsArr.find(t => /^\s*prioridade\s*:/i.test(String(t || '')));
      if (tagPref) prioridade = String(tagPref).split(':').slice(1).join(':').trim();
    }

    const priClass = (() => {
      const p = (prioridade||'').toLowerCase();
      if (p.includes('quente')) return 'hot';
      if (p.includes('morno')) return 'warm';
      if (p.includes('frio')) return 'cold';
      return 'neutral';
    })();

    const priBadge = prioridade ? `<span class="badge ${priClass}">${escapeHTML(prioridade)}</span>` : '';

    const tratamento = escapeHTML((e.treatment || e.tratamento || e.procedimento || e.trat || c?.treatment || c?.tratamento || '')||'') || '—';
    const origem = escapeHTML((e.source || e.origem || e.origin || c?.source || c?.origem || c?.origin || '')||'') || '—';

    const apptDate = (e.apptDate || e.agendamentoData || e.appointmentDate || c?.apptDate || c?.agendamentoData || c?.appointmentDate || '').toString().trim();
    const apptTime = (e.apptTime || e.agendamentoHora || e.appointmentTime || c?.apptTime || c?.agendamentoHora || c?.appointmentTime || '').toString().trim();
    const apptText = (apptDate || apptTime) ? `${escapeHTML(apptDate)}${apptTime ? ' ' + escapeHTML(apptTime) : ''}` : '—';

    const budgetVal = Number((e.valueBudget ?? e.budget ?? e.orcamento ?? e.valorOrcamento ?? 0)) || 0;
    const paidVal   = Number((e.valuePaid ?? e.value_paid ?? e.valorPago ?? e.valor_pago ?? e.paid ?? e.pago ?? e.received ?? 0)) || 0;
    const openVal   = Number((e.open ?? e.emAberto ?? e.aberto ?? (budgetVal - paidVal))) || 0;

    const statusPill = chipStatus(e);

    const id = e.id ?? e._id ?? '';
    const idAttr = escapeHTML(String(id));


    const svgFicha = `<svg class="cronos-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="3" width="16" height="18" rx="3"></rect><path d="M8 8h8"></path><path d="M8 12h8"></path><path d="M8 16h5"></path></svg>`;
    const svgEdit  = `<svg class="cronos-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path><path d="M15 5l4 4"></path></svg>`;
    const svgOk    = `<svg class="cronos-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="4" width="16" height="16" rx="4"></rect><path d="m8.5 12.5 2.4 2.4 4.8-5"></path></svg>`;
    const svgTrash = `<svg class="cronos-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 14h10l1-14"></path><path d="M9 7V4h6v3"></path></svg>`;
    const svgWhats = `<svg class="cronos-whatsapp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.34 4.96L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.51 2 12.04 2Zm0 18.15h-.01a8.22 8.22 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 0 1-1.25-4.38c0-4.55 3.7-8.25 8.25-8.25a8.25 8.25 0 0 1 8.25 8.25c0 4.55-3.7 8.24-8.26 8.24Zm4.52-6.18c-.25-.12-1.47-.72-1.7-.81-.23-.08-.4-.12-.57.13-.17.25-.65.81-.8.98-.15.17-.3.19-.55.06-.25-.12-1.05-.39-2-1.24-.74-.66-1.24-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.3.37-.45.12-.15.17-.25.25-.42.08-.17.04-.32-.02-.45-.06-.12-.57-1.37-.78-1.88-.21-.5-.42-.43-.57-.44h-.49c-.17 0-.45.06-.68.32-.23.25-.89.87-.89 2.12 0 1.25.91 2.46 1.04 2.63.12.17 1.79 2.73 4.34 3.83.61.26 1.08.42 1.45.54.61.19 1.16.16 1.6.1.49-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.15-1.18-.06-.1-.23-.16-.48-.28Z"/></svg>`;

    const btnFicha = `<button type="button" class="iconBtn btnFicha cronos-action-ficha" data-ficha-entry="${idAttr}" title="Ficha" onpointerdown="return CRONOS_OPEN_FICHA_BTN(event,'${idAttr}')" onclick="return CRONOS_OPEN_FICHA_BTN(event,'${idAttr}')">${svgFicha}</button>`;
    const btnEdit  = `<button class="iconBtn cronos-action-edit" title="Abrir" onclick="openLeadEntry('${idAttr}')">${svgEdit}</button>`;
    const btnOk    = `<button class="iconBtn cronos-action-ok" title="Marcar OK" onclick="markOK('${idAttr}')">${svgOk}</button>`;
    const btnMsg   = `<button class="iconBtn cronos-whatsapp-icon-only" title="WhatsApp" onclick="openWhats('${idAttr}')">${svgWhats}</button>`;
    const btnDel   = `<button class="iconBtn danger cronos-action-delete" title="Excluir" onclick="deleteLead('${idAttr}')">${svgTrash}</button>`;

    return `
      <div class="leadCard">
        <div class="leadCardTop">
          <div class="leadTitle">
            <div class="leadNameRow">
              <div class="name">${name}</div>
              ${priBadge}
            </div>
            <div class="leadMeta">
              <span>${escapeHTML(phonePretty)}</span>
              <span>•</span>
              <span>${statusPill}</span>
            </div>
          </div>

          <div class="leadActionsRow">
            ${btnFicha}${btnEdit}${btnOk}${btnMsg}${btnDel}
          </div>
        </div>

        <div class="leadGrid">
          <div class="kv"><div class="k">Tratamento</div><div class="v">${tratamento}</div></div>
          <div class="kv"><div class="k">Agendamento</div><div class="v">${apptText}</div></div>
          <div class="kv"><div class="k">Origem</div><div class="v">${origem}</div></div>
          <div class="kv"><div class="k">Valores</div><div class="v">Pago: ${moneyBR(paidVal)}<br>Em aberto: ${moneyBR(Math.max(0, openVal))}</div></div>
        </div>
      </div>
    `;
  }).join('');

  if(cardsWrap){
    cardsWrap.innerHTML = cardsHtml || `<div class="muted">Nenhum lead encontrado.</div>`;
  }else{
    tbody.innerHTML = cardsHtml || `<tr><td colspan="6" class="emptyCell">Nenhum lead encontrado.</td></tr>`;
  }

  renderLeadsPagination(totalLeads, totalPages);
}




function openChangeMyPassword(){
  const actor = currentActor();
  if(!actor) return toast("Sessão não encontrada");
  openModal({
    title: "Alterar minha senha",
    sub: "Essa alteração vale para o acesso logado agora.",
    bodyHTML: `
      <div class="twoCol">
        <div>
          <label>Nova senha</label>
          <input id="myPass1" type="password" placeholder="Digite a nova senha"/>
        </div>
        <div>
          <label>Confirmar senha</label>
          <input id="myPass2" type="password" placeholder="Repita a nova senha"/>
        </div>
      </div>
      <div class="muted" style="font-size:12px; margin-top:10px">Use pelo menos 6 caracteres para não dar palco pro caos.</div>
    `,
    footHTML: `
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn ok" id="btnSaveMyPassword">Salvar nova senha</button>
    `,
    onMount: ()=>{
      el("btnSaveMyPassword").addEventListener("click", async ()=>{
        const pass1 = val("myPass1").trim();
        const pass2 = val("myPass2").trim();
        if(!pass1 || pass1.length < 6) return toast("Senha fraca", "Usa pelo menos 6 caracteres.");
        if(pass1 !== pass2) return toast("As senhas não batem");

        try{
          if(typeof supabaseClient !== "undefined" && supabaseClient?.auth?.updateUser){
            const { error } = await supabaseClient.auth.updateUser({ password: pass1 });
            if(error) throw error;
          }else{
            const db = loadDB();
            const s = loadSession();
            if(s?.kind === "user"){
              const userRow = (db.users||[]).find(u=>u.id===s.id);
              if(!userRow) throw new Error("Usuário local não encontrado.");
              userRow.passHash = await hashPass(pass1);
              saveDB(db, { immediate:true });
            }else{
              throw new Error("Sessão cloud não disponível para atualizar a senha.");
            }
          }

          closeModal();
          toast("Senha atualizada ✅", "A nova senha já vale para o seu próximo login.");
        }catch(err){
          console.error("Falha ao alterar a própria senha:", err);
          toast("Falha ao alterar senha", String(err?.message || "Tente novamente."));
        }
      });
    }
  });
}

function renderSettings(){
  const actor = currentActor();
  if(actor && !canAccessView("settings", actor)) return;
  const prefs = getPrefs();
  const ta = el("waTemplate");
  if(ta) ta.value = prefs.waTemplate || "";
  const taCharge = el("waChargeTemplate");
  if(taCharge) taCharge.value = (prefs && prefs.waChargeTemplate) ? String(prefs.waChargeTemplate) : "";
  const db = loadDB();
  const master = db.masters.find(m=>m.id===actor?.masterId);
  const clinicInput = el("clinicDisplayName");
  const clinicHint = el("clinicDisplayNameHint");
  const ownerEmailInput = el("clinicOwnerEmail");
  if(clinicInput){
    clinicInput.value = master?.name || "";
    const canEditClinicName = !!(actor && actor.kind === "master");
    clinicInput.disabled = !canEditClinicName;
    if(clinicHint){
      clinicHint.textContent = canEditClinicName
        ? "Esse nome aparece no topo, relatórios e identificação principal da clínica."
        : "Só o master principal pode alterar o nome exibido da clínica.";
    }
    const btnClinic = el("btnSaveClinicIdentity");
    if(btnClinic){
      btnClinic.disabled = !canEditClinicName;
      btnClinic.title = canEditClinicName ? "" : "Só o master principal pode alterar a identidade da clínica.";
    }
  }
  if(ownerEmailInput){
    ownerEmailInput.value = master?.email || actor?.email || "";
  }
}

function renderUsers(){
  const actor = currentActor();
  if(actor && !canAccessView("users", actor)) return;
  const db = loadDB();
  const tbody = el("usersTbody");
  const master = db.masters.find(m=>m.id===actor.masterId);
  const users = db.users.filter(u=>u.masterId===actor.masterId);

  const rows = [
    {
      kind:"MASTER",
      name: master?.name || "Master",
      login: master?.email || "—",
      role: "MASTER",
      master: master?.name || "—",
      createdAt: master?.createdAt || "",
      active: true,
      pendingApproval: false,
      blockedReason: null
    },
    ...users.map(u=>({
      kind:"USER",
      id: u.id,
      name: u.name,
      login: u.username ? `${u.username} / ${u.email||""}` : (u.email||""),
      role: u.role,
      master: master?.name || "—",
      createdAt: u.createdAt,
      active: u.active !== false,
      pendingApproval: u.pendingApproval === true,
      blockedReason: u.blockedReason || null
    }))
  ];

  tbody.innerHTML = rows.map(r=>{
    const canManage = actor.perms.manageUsers;
    const isPending = r.kind === "USER" && r.pendingApproval === true;
    const isInactive = r.kind === "USER" && !isPending && r.active === false;
    const rowClass = isPending ? "userRowPending" : (isInactive ? "userRowInactive" : "");
    const statusChip = isPending
      ? `<span class="chip chipWarn">Aguardando aprovação</span>${r.blockedReason ? `<div class="muted" style="margin-top:6px">${escapeHTML(r.blockedReason)}</div>` : ``}`
      : (isInactive
          ? `<span class="chip chipDanger">Bloqueado</span>${r.blockedReason ? `<div class="muted" style="margin-top:6px">${escapeHTML(r.blockedReason)}</div>` : ``}`
          : `<span class="chip"><span class="dot ${r.role==="MASTER"?"ok":"warm"}"></span>${r.role}</span>`);
    return `
      <tr class="${rowClass}">
        <td><b>${escapeHTML(r.name)}</b></td>
        <td class="mono">${escapeHTML(r.login)}</td>
        <td>${statusChip}</td>
        <td>${escapeHTML(r.master)}</td>
        <td class="nowrap">${r.createdAt ? new Date(r.createdAt).toLocaleString("pt-BR") : "—"}</td>
        <td class="nowrap">
          ${r.kind==="USER" && canManage ? ( (r.role==="MASTER" && !actor.perms.manageMasters) ? `<span class="muted">—</span>` : `
            <button class="miniBtn" onclick="openUserEdit('${r.id}')">✏️</button>
            <button class="miniBtn danger" onclick="deleteUser('${r.id}')">🗑️</button>
          ` ) : `<span class="muted">—</span>`}
        </td>
      </tr>
    `;
  }).join("");
}

/* -------- Navigation -------- */
const CRONOS_CLOUD_SYNC_MIN_INTERVAL_MS = 4000;
window.__CRONOS_LAST_CLOUD_PULL_AT__ = window.__CRONOS_LAST_CLOUD_PULL_AT__ || 0;
window.__CRONOS_PENDING_CLOUD_PULL__ = window.__CRONOS_PENDING_CLOUD_PULL__ || null;
window.__CRONOS_CLOUD_PULL_IN_FLIGHT__ = window.__CRONOS_CLOUD_PULL_IN_FLIGHT__ || null;

async function refreshCloudDataNow({ force=false, reason="" } = {}){
  const now = Date.now();
  if(window.__CRONOS_CLOUD_PULL_IN_FLIGHT__ && !force){
    return window.__CRONOS_CLOUD_PULL_IN_FLIGHT__;
  }
  if(!force && DB && (now - (window.__CRONOS_LAST_CLOUD_PULL_AT__ || 0) < CRONOS_CLOUD_SYNC_MIN_INTERVAL_MS)){
    return DB;
  }
  const run = (async ()=>{
    try{
      await ensureCloudDBLoaded(true);
      await syncCurrentCloudActor();
      window.__CRONOS_LAST_CLOUD_PULL_AT__ = Date.now();
      return DB;
    }finally{
      window.__CRONOS_CLOUD_PULL_IN_FLIGHT__ = null;
    }
  })();
  window.__CRONOS_CLOUD_PULL_IN_FLIGHT__ = run;
  return run;
}

function scheduleCloudRefresh(reason="", { force=false, delay=120 } = {}){
  if(window.__CRONOS_PENDING_CLOUD_PULL__){
    clearTimeout(window.__CRONOS_PENDING_CLOUD_PULL__);
    window.__CRONOS_PENDING_CLOUD_PULL__ = null;
  }
  window.__CRONOS_PENDING_CLOUD_PULL__ = setTimeout(()=>{
    window.__CRONOS_PENDING_CLOUD_PULL__ = null;
    refreshCloudDataNow({ force, reason }).catch(err=>console.error("Falha no refresh cloud:", err));
  }, Math.max(0, Number(delay)||0));
}

function setLoadingButtonState(btn, isLoading){
  if(!btn) return;
  const label = btn.dataset.label || btn.textContent.trim() || "Atualizar";
  if(isLoading){
    btn.disabled = true;
    btn.classList.add("loading");
    btn.innerHTML = `<span class="btnSpinner"><span class="spinner"></span></span>${escapeHTML(label)}`;
    return;
  }
  btn.disabled = false;
  btn.classList.remove("loading");
  btn.innerHTML = escapeHTML(label);
}

async function runManualCloudRefresh(btn, { installmentsOnly=false } = {}){
  try{
    setLoadingButtonState(btn, true);
    await refreshCloudDataNow({ force:true, reason: installmentsOnly ? "installments_button" : "manual_button" });
    if(installmentsOnly){
      renderInstallmentsView();
      updateSidebarPills();
    }else{
      renderAll();
    }
    toast("Atualizado", "Dados verificados na nuvem.");
  }catch(error){
    console.error("Falha ao atualizar manualmente:", error);
    toast("Falha ao atualizar", "Não foi possível buscar os dados agora.");
  }finally{
    setLoadingButtonState(btn, false);
  }
}

function closeAuxiliaryViews(){
  ["view-todayCronos", "view-creditSimulator"].forEach(id=>{
    const node = el(id);
    if(node){
      node.classList.add("hidden");
      node.style.display = "none";
    }
  });
  ["navHojeCronos", "navCreditoSimulator"].forEach(id=>{
    const btn = el(id);
    if(btn) btn.classList.remove("active");
  });
  qsa('[data-today-hidden="1"], [data-credito-hidden="1"]').forEach(node=>{
    delete node.dataset.todayHidden;
    delete node.dataset.creditoHidden;
  });
}


function renderActiveViewOnly(view){
  try{ updateSidebarPills(); }catch(_){ }

  if(view === "dashboard"){
    try{ renderDashboard(); }catch(_){ }
    return;
  }
  if(view === "leads"){
    try{
      renderLeadsTable(filteredEntries());

      setTimeout(()=>{
        try{
          const viewNode = document.getElementById("view-leads");
          const cards = document.getElementById("leadsCards");
          const tbody = document.getElementById("leadsTbody");
          const visible = viewNode && !viewNode.classList.contains("hidden") && viewNode.style.display !== "none";
          const emptyCards = cards && !String(cards.innerHTML || "").trim();
          const emptyTable = tbody && !String(tbody.innerHTML || "").trim();
          if(visible && (emptyCards || emptyTable)){
            renderLeadsTable(filteredEntries());
          }
        }catch(err){ console.warn("Leads: retry visual falhou", err); }
      }, 80);
    }catch(err){
      console.error("Leads: falha ao renderizar", err);
      setTimeout(()=>{ try{ renderLeadsTable(filteredEntries()); }catch(_){ } }, 120);
    }
    return;
  }
  if(view === "kanban"){
    try{ renderKanban(); }catch(_){ }
    return;
  }
  if(view === "tasks"){
    try{ renderTasks(); }catch(_){ }
    return;
  }
  if(view === "installments"){
    try{ renderInstallmentsView(); }catch(_){ }
    return;
  }
  if(view === "users"){
    try{ renderUsers(); }catch(_){ }
    return;
  }
  if(view === "settings"){
    try{ renderSettings(); }catch(_){ }
    return;
  }

  try{ renderAll(); }catch(_){ }
}

function setActiveView(view){
  if(!view || !APP_VIEWS.includes(view)){
    if(view === "todayCronos" && window.CRONOS_TODAY && typeof window.CRONOS_TODAY.show === "function"){
      window.CRONOS_TODAY.show();
    }else if((view === "creditSimulator" || view === "simulador") && window.CRONOS_CREDITO && typeof window.CRONOS_CREDITO.show === "function"){
      window.CRONOS_CREDITO.show();
    }
    return;
  }

  closeAuxiliaryViews();

  const actor = currentActor();
  let targetView = view;

  if(actor && !canAccessView(targetView, actor)){
    const fallback = firstAllowedView(actor);
    if(view !== fallback){
      toast("Acesso restrito", `Seu nível ${actor.role} não pode abrir ${view}.`);
    }
    targetView = fallback;
  }

  applyRoleVisibility(actor);
  qsa(".nav button").forEach(b=> b.classList.toggle("active", b.dataset.view===targetView));
  APP_VIEWS.forEach(v=>{
    const node = el(`view-${v}`);
    if(node){
      node.classList.toggle("hidden", v!==targetView);
      node.style.display = "";
    }
  });

  const sticky = el("stickyFilters");
  if(sticky){
    const viewsWithGlobalFilters = new Set(["dashboard","leads","kanban"]);
    sticky.classList.toggle("hidden", !viewsWithGlobalFilters.has(targetView));
    sticky.style.display = "";
  }

  renderActiveViewOnly(targetView);
}

/* -------- Modal helpers -------- */
function openModal({title, sub="", bodyHTML="", footHTML="", onMount=null, maxWidth="720px", width=null}){
  el("modalTitle").textContent = title;
  el("modalSub").textContent = sub;
  el("modalBody").innerHTML = bodyHTML;
  el("modalFoot").innerHTML = footHTML;
  const __modalInner = document.querySelector('#modalBg .modalInner');
  if(__modalInner){
    __modalInner.style.maxWidth = maxWidth || '720px';
    __modalInner.style.width = width || '';
  }
  el("modalBg").classList.add("show");
  el("modalBg").setAttribute("aria-hidden","false");
  if(typeof onMount==="function") onMount();
}
function closeModal(){
  el("modalBg").classList.remove("show");
  el("modalBg").setAttribute("aria-hidden","true");
  const __modalInner = document.querySelector('#modalBg .modalInner');
  if(__modalInner){
    __modalInner.style.maxWidth = '720px';
    __modalInner.style.width = '';
  }
}
el("modalClose").addEventListener("click", closeModal);
el("modalBg").addEventListener("click", (e)=>{ if(e.target===el("modalBg")) closeModal(); });

/* -------- Lead create/edit -------- */
function leadEntryFormHTML(entry, contact, mode, suggestHTML){
  const e = entry || {};
  const c = contact || {};
  const isNew = mode==="new";
  const actor = currentActor();
  const ro = !actor.perms.edit;

  function opt(list, cur){
    return list.map(v=>`<option ${cur===v?"selected":""} value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join("");
  }


  const __toArr = (v)=> Array.isArray(v) ? v : (v ? [v] : []);
  const __uniq = (arr)=> Array.from(new Set((arr||[]).map(x=>String(x||"").trim()).filter(Boolean)));
  const __manualTagsForUI = __uniq([]
    .concat(__toArr(e.tags))
    .concat(__toArr(e.tag))
    .concat(__toArr(c.tags))
    .concat(__toArr(c.tag))
    .filter(t=>!String(t||"").startsWith("Prioridade:"))
    .filter(t=>String(t||"")!=="Campanha")
  );

  return `
    <div class="twoCol">
      <div class="suggest">
        <label>Nome *</label>
        <input id="lf_name" ${ro?"disabled":""} value="${escapeHTML(c.name||"")}" placeholder="Ex: Jorge" autocomplete="off"/>
        <div class="suggestBox" id="leadSuggest">${suggestHTML||""}</div>
        <div class="help muted" style="font-size:12px">Se já existir, clique na sugestão pra carregar.</div>
      </div>

      <div class="suggest">
        <label>Telefone/WhatsApp *</label>
        <input id="lf_phone" ${ro?"disabled":""} value="${escapeHTML(c.phone||"")}" placeholder="Ex: 98999990000" autocomplete="off"/>
      </div>

      <div>
        <label>CPF</label>
        <input id="lf_cpf" ${ro?"disabled":""} value="${escapeHTML(formatCPF(c.cpf||""))}" placeholder="Ex: 123.456.789-00" autocomplete="off"/>
      </div>

      <div>
        <label>Data de nascimento</label>
        <input id="lf_birth" type="date" ${ro?"disabled":""} value="${escapeHTML(c.birthDate||"")}"/>
      </div>

      <div>
        <label>Data do 1º contato (mês)</label>
        <input id="lf_first" type="date" ${ro?"disabled":""} value="${escapeHTML(e.firstContactAt || todayISO())}"/>
      </div>

      <div>
        <label>Mês/Ano</label>
        <input id="lf_month" ${isNew?"":"disabled"} value="${escapeHTML(e.monthKey || ((val("fMonth") && val("fMonth")!=="all") ? val("fMonth") : new Date().toISOString().slice(0,7)))}" class="mono"/>
        <div class="help muted" style="font-size:12px">Formato: YYYY-MM (ex: 2026-01).</div>
      </div>

      <div>
        <label>Status</label>
        <select id="lf_status" ${ro?"disabled":""}>${opt(STATUS_LIST, e.status || "Conversando")}</select>
      </div>

      
      

      <div>
        <label>Origem</label>
        <select id="lf_origin" ${ro?"disabled":""}>${opt(ORIGINS, e.origin || "Instagram orgânico")}</select>
      </div>

      <div id="originOtherWrap" class="${(e.origin==="Outros")?"":"hidden"}">
        <label>Qual origem?</label>
        <input id="lf_originOther" ${ro?"disabled":""} placeholder="Descreva a origem" value="${escapeHTML(e.originOther||"")}"/>
      </div>

      <div>
        <label>Tratamento</label>
        <select id="lf_treatment" ${ro?"disabled":""}>${opt(TREATMENTS, e.treatment || "Clínica geral")}</select>
      </div>

      <div id="treatOtherWrap" class="${(e.treatment==="Outros")?"":"hidden"}">
        <label>Qual tratamento?</label>
        <input id="lf_treatOther" ${ro?"disabled":""} placeholder="Descreva o tratamento" value="${escapeHTML(e.treatmentOther||"")}"/>
      </div>


<div>
        <label>Agendamento (data)</label>
        <input id="lf_apptDate" type="date" ${ro?"disabled":""} value="${escapeHTML(e.apptDate||"")}"/>
      </div>

      <div>
        <label>Agendamento (hora)</label>
        <input id="lf_apptTime" type="time" ${ro?"disabled":""} value="${escapeHTML(e.apptTime||"")}"/>
      </div>

      <div>
        <label>Tentativas de ligação</label>
        <select id="lf_calls" ${ro?"disabled":""}>
          ${["","1","2","3","Mais","Mensagem enviada"].map(v=>`<option value="${v}" ${(String(e.callAttempts||"")===v)?"selected":""}>${v||"—"}</option>`).join("")}
        </select>
      </div>

      <div>
        <label>Resultado da ligação</label>
        <select id="lf_callResult" ${ro?"disabled":""}>
          ${["","Atendeu na 1ª","Atendeu na 2ª","Atendeu na 3ª","Não atendeu","Respondeu mensagem"].map(v=>`<option value="${v}" ${(String(e.callResult||"")===v)?"selected":""}>${v||"—"}</option>`).join("")}
        </select>
      </div>

      <div class="twoCol" style="grid-column:1/-1">
        <div>
          <label>Tag manual</label>
          <input id="lf_tag" ${ro?"disabled":""} placeholder="Ex: ticket alto, retorno, resgate..." />
          <div class="help muted" style="font-size:12px">Enter adiciona tag.</div>
          <div id="lf_tag_list" class="tagList">${(__manualTagsForUI||[]).map(t=>`<span class="tagPill">${escapeHTML(t)}</span>`).join("")}</div>
        </div>
        <div>
          <label>Prioridade</label>
          <select id="lf_priority" ${ro?"disabled":""}>
            ${["Frio","Morno","Quente"].map(v=>`<option value="${v}" ${(e.tags||[]).includes("Prioridade: "+v)?"selected":""}>${v}</option>`).join("")}
          </select>
        </div>
      </div>

      <div style="grid-column:1/-1">
        <label style="display:flex; align-items:center; gap:10px; color:var(--text); margin-bottom:0">
          <input id="lf_campaign" type="checkbox" ${ro?"disabled":""} ${((e.tags||[]).includes("Campanha"))?"checked":""} style="width:auto; flex:0 0 auto"/>
          <span style="font-size:13px; font-weight:700">Lead em campanha</span>
        </label>
      </div>

      <div style="grid-column:1/-1">
        <label>Observações</label>
        <textarea id="lf_notes" ${ro?"disabled":""} placeholder="Contexto, objeções, próximo passo...">${escapeHTML(e.notes||"")}</textarea>
      </div>

      <div style="grid-column:1/-1">
        <div class="muted" style="font-size:12px; display:flex; gap:10px; flex-wrap:wrap">
          <span class="tagPill">1º contato global: <b>${c.firstSeenAt ? fmtBR(c.firstSeenAt.slice(0,10)) : "—"}</b></span>
          <span class="tagPill">Últ. atualização (mês): <b>${e.lastUpdateAt ? fmtBR(e.lastUpdateAt.slice(0,10)) : "—"}</b></span>
          ${(e.tags||[]).includes("Resgatado") ? `<span class="tagPill">♻️ Resgatado</span>` : ``}
        </div>
      </div>

      <div style="grid-column:1/-1">
        <div class="muted" style="font-size:12px">Histórico (meses):</div>
        <div id="lf_history" class="muted" style="font-size:12px; margin-top:6px"></div>
      </div>
    </div>
  `;
}

function buildSuggestList(actor, typedName, typedPhone){
  const db = loadDB();
  const phoneN = normPhone(typedPhone);
  const nameN = (typedName||"").trim().toLowerCase();
  if(!phoneN && nameN.length < 2) return "";
  const contacts = db.contacts
    .filter(c=>c.masterId===actor.masterId)
    .filter(c=>{
      const byPhone = phoneN ? c.phone.includes(phoneN) : false;
      const byName = nameN ? (c.name||"").toLowerCase().includes(nameN) : false;
      return byPhone || byName;
    })
    .slice(0,10);

  if(!contacts.length) return "";
  return contacts.map(c=>{
    const entries = db.entries.filter(e=>e.contactId===c.id).sort((a,b)=>b.monthKey.localeCompare(a.monthKey));
    const last = entries[0];
    const lastTxt = last ? `${monthLabel(last.monthKey)} • ${last.status}` : "—";
    return `
      <div class="suggestItem" data-contact="${c.id}">
        <b>${escapeHTML(c.name)} • ${escapeHTML(c.phone)}</b>
        <small>${escapeHTML(lastTxt)}</small>
      </div>
    `;
  }).join("");
}

function openNewLead(){
  const actor = currentActor();
  if(!actor){ toast("Sessão expirada", "Faça login novamente."); showAuth(); return; }
  if(!actor.perms.edit || !canAccessView("leads", actor)) return toast("Sem permissão", "Seu nível não pode criar leads.");
  let monthKey = val("fMonth", new Date().toISOString().slice(0,7));
  if(!monthKey || monthKey === "all") monthKey = new Date().toISOString().slice(0,7);
  const entry = { monthKey, firstContactAt: todayISO(), status:"Conversando", origin:"Instagram orgânico", treatment:"Clínica geral", tags:[] };
  const contact = { name:"", phone:"", cpf:"", birthDate:"", firstSeenAt:"", lastSeenAt:"" };

  openModal({
    title: "Novo Lead",
    sub: "Se já existir, selecione a sugestão. Se existir e já tiver neste mês, ele abre pra editar.",
    bodyHTML: leadEntryFormHTML(entry, contact, "new", ""),
    footHTML: `
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn ok" id="btnSaveLead">Salvar</button>
    `,
    onMount: ()=>{
      wireLeadModal(actor, null, true);
      qs("#lf_name").focus();
    }
  });
}

function openLeadEntry(entryId){
  const actor = currentActor();
  if(!actor){ toast("Sessão expirada", "Faça login novamente."); showAuth(); return; }
  const db = loadDB();
  const entry = db.entries.find(e=>e.id===entryId);
  if(!entry) return toast("Lead não encontrado");
  const contact = db.contacts.find(c=>c.id===entry.contactId);

  openModal({
    title: "Editar Lead",
    sub: "Atualize o que precisar. Histórico fica salvo.",
    bodyHTML: leadEntryFormHTML(entry, contact, "edit", ""),
    footHTML: `
      <button class="btn" onclick="closeModal()">Fechar</button>
      ${actor.perms.edit ? `<button class="btn ok" id="btnSaveLead">Salvar</button>` : ``}
    `,
    onMount: ()=>{
      wireLeadModal(actor, entryId, false);
      fillHistory(contact.id);
    }
  });
}



function printLeadEntry(entryId){
  const actor = currentActor();
  const db = loadDB();
  const e = db.entries.find(x=>x.id===entryId);
  if(!e) return toast("Lead não encontrado");
  const c = db.contacts.find(x=>x.id===e.contactId);
  const master = db.masters.find(m=>m.id===actor.masterId);

  const logo = getSmallLogoDataURI ? getSmallLogoDataURI() : "";
  const title = `Ficha do Lead • ${escapeHTML(c?.name||"")}`;
  const htmlDoc = `
<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  body{font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 26px; color:#111;}
  .head{display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:16px; border-bottom:1px solid #ddd; padding-bottom:12px;}
  .brand{display:flex; align-items:center; gap:10px;}
  .brand img{width:34px; height:34px;}
  h1{font-size:18px; margin:0;}
  .sub{font-size:12px; color:#555; margin-top:2px;}
  .grid{display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:14px;}
  .card{border:1px solid #ddd; border-radius:12px; padding:12px;}
  .label{font-size:11px; color:#555; text-transform:uppercase; letter-spacing:.04em;}
  .val{margin-top:6px; font-size:14px;}
  .mono{font-variant-numeric: tabular-nums;}
  .tags{margin-top:8px;}
  .pill{display:inline-block; padding:3px 8px; border:1px solid #ddd; border-radius:999px; font-size:12px; margin: 2px 4px 0 0;}
  table{width:100%; border-collapse:collapse; margin-top:10px;}
  th,td{border-bottom:1px solid #eee; text-align:left; padding:8px 6px; font-size:12px; vertical-align:top;}
  th{color:#444;}
  .muted{color:#666;}
  @media print{ body{margin: 16mm;} }

/* ===== Access guard / renewal ===== */
.accessGateCard{
  width:min(560px, 100%);
  border:1px solid var(--line);
  border-radius:26px;
  background: linear-gradient(180deg, rgba(255,255,255,.05), transparent 42%), var(--panel);
  box-shadow: var(--shadow);
  padding:20px 18px;
}
.accessGateHeader{
  display:flex;
  align-items:center;
  gap:12px;
  margin-bottom:12px;
}
.accessGateBadge{
  width:44px;
  height:44px;
  border-radius:999px;
  display:grid;
  place-items:center;
  font-size:20px;
  background: rgba(255,255,255,.05);
  border:1px solid var(--line);
}
.accessGateTitle{
  margin:0;
  font-size:26px;
  line-height:1.02;
  letter-spacing:-.02em;
}
.accessGateText{
  margin:10px 0 0;
  color:var(--muted);
  line-height:1.5;
}
.accessGateMeta{
  margin-top:14px;
  padding:12px 14px;
  border-radius:16px;
  border:1px solid var(--line);
  background: rgba(255,255,255,.03);
  color:var(--text);
  display:grid;
  gap:8px;
}
.accessGateActions{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  margin-top:16px;
}
.accessGateActions .btn{
  flex:1 1 220px;
  justify-content:center;
}
.accessNotice{
  width:min(560px, 100%);
  border:1px solid var(--line);
  border-radius:22px;
  background: var(--panel2);
  box-shadow: 0 20px 60px rgba(17,24,39,.15);
  padding:18px 16px;
}
.accessNoticeHead{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  margin-bottom:10px;
}
.accessNoticeHead h3{
  margin:0;
  font-size:20px;
}
.accessNoticeText{
  color:var(--muted);
  line-height:1.5;
  margin:0 0 14px;
}
.accessNoticeActions{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  justify-content:flex-end;
}
.accessNoticeDays{
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:6px 10px;
  border-radius:999px;
  border:1px solid var(--line);
  background: rgba(255,255,255,.04);
  color:var(--text);
  font-size:12px;
  font-weight:700;
}

</style>
</head>
<body>
  <div class="head">
    <div class="brand">
      ${logo?`<img src="${logo}" alt="Cronos"/>`:``}
      <div>
        <h1>${escapeHTML(master?.name||"Clínica")} • Ficha do Paciente</h1>
        <div class="sub">Gerado em ${new Date().toLocaleString("pt-BR")} • Mês: <span class="mono">${escapeHTML(e.monthKey||"")}</span></div>
      </div>
    </div>
    <div class="muted" style="font-size:12px">Cronos</div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="label">Paciente</div>
      <div class="val"><b>${escapeHTML(c?.name||"—")}</b></div>
      <div class="val muted">${escapeHTML(c?.phone||"—")}</div>
      ${e.city?`<div class="val muted">${escapeHTML(e.city)}</div>`:``}
      <div class="tags">${(e.tags||[]).map(t=>`<span class="pill">${escapeHTML(t)}</span>`).join("")}</div>
    </div>
    <div class="card">
      <div class="label">Status</div>
      <div class="val"><b>${escapeHTML(e.status||"—")}</b></div>
      <div class="val muted">Origem: ${escapeHTML(e.originOther?`${e.origin} — ${e.originOther}`: (e.origin||"—"))}</div>
      <div class="val muted">Tratamento: ${escapeHTML(e.treatmentOther?`${e.treatment} — ${e.treatmentOther}`:(e.treatment||"—"))}</div>
    </div>

    <div class="card">
      <div class="label">Datas</div>
      <div class="val">1º contato: <span class="mono">${fmtBR(e.firstContactAt||"")}</span></div>
      <div class="val">Última atualização: <span class="mono">${fmtBR(e.lastUpdateAt||"")}</span></div>
      <div class="val">Agendamento: <span class="mono">${e.apptDate?`${fmtBR(e.apptDate)} ${e.apptTime||""}`.trim():"—"}</span></div>
    </div>

    <div class="card">
      <div class="label">Ligações</div>
      <div class="val">Tentativas: <span class="mono">${escapeHTML(e.callAttempts||"—")}</span></div>
      <div class="val">Resultado: <span class="mono">${escapeHTML(e.callResult||"—")}</span></div>
    </div>

    <div class="card">
      <div class="label">Valores</div>
      <div class="val">Orçamento: <span class="mono">${(e.valueBudget!=null)?moneyBR(Number(e.valueBudget)):( (e.valueEstimated!=null)?moneyBR(Number(e.valueEstimated)):"—")}</span></div>
      <div class="val">Pago: <span class="mono">${(e.valuePaid!=null)?moneyBR(Number(e.valuePaid)):( (e.valueClosed!=null)?moneyBR(Number(e.valueClosed)):"—")}</span></div>
      <div class="val">Em aberto: <span class="mono">${(()=>{ const b=(e.valueBudget!=null && !isNaN(Number(e.valueBudget)))?Number(e.valueBudget):((e.valueEstimated!=null && !isNaN(Number(e.valueEstimated)))?Number(e.valueEstimated):0); const p=(e.valuePaid!=null && !isNaN(Number(e.valuePaid)))?Number(e.valuePaid):((e.valueClosed!=null && !isNaN(Number(e.valueClosed)))?Number(e.valueClosed):0); const o=Math.max(0,(b||0)-(p||0)); return o?moneyBR(o):"—"; })()}</span></div>
    </div>

    <div class="card" style="grid-column:1/-1">
      <div class="label">Observações</div>
      <div class="val">${escapeHTML(e.notes||"—")}</div>
    </div>

    <div class="card" style="grid-column:1/-1">
      <div class="label">Histórico (por mês)</div>
      <table>
        <thead><tr><th>Mês</th><th>Status</th><th>Agendamento</th><th class="mono">Orçamento</th><th class="mono">Pago</th><th class="mono">Em aberto</th></tr></thead>
        <tbody>
          ${db.entries.filter(x=>x.masterId===actor.masterId && x.contactId===c?.id).sort((a,b)=>b.monthKey.localeCompare(a.monthKey)).map(x=>`
            <tr>
              <td class="mono">${escapeHTML(x.monthKey||"")}</td>
              <td>${escapeHTML(x.status||"")}</td>
              <td class="mono">${x.apptDate?`${fmtBR(x.apptDate)} ${x.apptTime||""}`.trim():"—"}</td>
              <td class="mono">${(x.valueBudget!=null && !isNaN(Number(x.valueBudget)))?moneyBR(Number(x.valueBudget)):( (x.valueEstimated!=null && !isNaN(Number(x.valueEstimated)))?moneyBR(Number(x.valueEstimated)):"—")}</td><td class="mono">${(x.valuePaid!=null && !isNaN(Number(x.valuePaid)))?moneyBR(Number(x.valuePaid)):( (x.valueClosed!=null && !isNaN(Number(x.valueClosed)))?moneyBR(Number(x.valueClosed)):"—")}</td><td class="mono">${(()=>{ const b=(x.valueBudget!=null && !isNaN(Number(x.valueBudget)))?Number(x.valueBudget):((x.valueEstimated!=null && !isNaN(Number(x.valueEstimated)))?Number(x.valueEstimated):0); const p=(x.valuePaid!=null && !isNaN(Number(x.valuePaid)))?Number(x.valuePaid):((x.valueClosed!=null && !isNaN(Number(x.valueClosed)))?Number(x.valueClosed):0); const o=Math.max(0,(b||0)-(p||0)); return o?moneyBR(o):"—"; })()}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  </div>

<script>window.onload=()=>{ setTimeout(()=>window.print(), 250); };<\/script>

<div id="chartTooltip" aria-hidden="true"></div>

<div id="kpiModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modalInner" style="max-width:720px">
    <div class="modalHeader">
      <div>
        <div class="muted" style="font-size:12px">KPIs</div>
        <div id="kpiModalTitle" style="font-size:18px; font-weight:800">Detalhes</div>
      </div>
      <button class="btn" id="kpiModalClose">Fechar</button>
    </div>
    <div class="modalBody" style="padding-top:10px">
      <div class="muted" id="kpiModalSub" style="margin-bottom:10px"></div>
      <div id="kpiModalList" class="stack" style="gap:10px"></div>
    </div>
  </div>
</div>

</body>
</html>`;
  const w = window.open("", "_blank");
  if(!w) return toast("Popup bloqueado", "Permita popups para imprimir.");
  w.document.open();
  w.document.write(htmlDoc);
  w.document.close();
}

function fillHistory(contactId){
  const db = loadDB();
  const entries = db.entries.filter(e=>e.contactId===contactId).sort((a,b)=>b.monthKey.localeCompare(a.monthKey));
  const box = qs("#lf_history");
  if(!box) return;
  box.innerHTML = entries.map(e=>{
    const s = `${monthLabel(e.monthKey)} • ${e.status} • 1º ${fmtBR(e.firstContactAt)}`;
    return `<span class="tagPill">${escapeHTML(s)}</span>`;
  }).join(" ");
}

function wireLeadModal(actor, editingEntryId, isNew){
  const db = loadDB();
  const suggestBox = el("leadSuggest");

  const originSel = el("lf_origin");
  const treatSel = el("lf_treatment");
  const toggleOrigin = ()=> el("originOtherWrap").classList.toggle("hidden", originSel.value!=="Outros");
  const toggleTreat = ()=> el("treatOtherWrap").classList.toggle("hidden", treatSel.value!=="Outros");
  originSel?.addEventListener("change", toggleOrigin);
  treatSel?.addEventListener("change", toggleTreat);

  const budgetInp = el("lf_value_budget");
  const paidInp = el("lf_value_paid");
  const openEl = el("lf_open_value");
  const updateOpen = ()=>{
    if(!openEl) return;
    const b = (budgetInp && budgetInp.value!=="") ? Number(budgetInp.value) : null;
    const p = (paidInp && paidInp.value!=="") ? Number(paidInp.value) : null;
    if(b==null && p==null){ openEl.textContent = "—"; return; }
    const open = Math.max(0, (b||0) - (p||0));
    openEl.textContent = moneyBR(open);
  };
  budgetInp?.addEventListener("input", updateOpen);
  paidInp?.addEventListener("input", updateOpen);
  updateOpen();


  const pmSel = el("lf_pay_method");
  const entryAmt = el("lf_entry_amount");
  const instAmt = el("lf_inst_amount");
  const instN = el("lf_inst_n");
  const instEach = el("lf_inst_each");
  const instFirst = el("lf_inst_firstdue");

  const fillPlan = ()=>{
    try{
      const db2 = loadDB();
      let curEntry = null;
      if(editingEntryId) curEntry = db2.entries.find(e=>e.id===editingEntryId);
      if(curEntry && curEntry.installPlan){
        pmSel && (pmSel.value = curEntry.installPlan.payMethod||"");
        entryAmt && (entryAmt.value = curEntry.installPlan.entryAmount!=null ? curEntry.installPlan.entryAmount : "");
        instAmt && (instAmt.value = curEntry.installPlan.amount!=null ? curEntry.installPlan.amount : "");
        instN && (instN.value = curEntry.installPlan.n!=null ? curEntry.installPlan.n : "");
        instFirst && (instFirst.value = curEntry.installPlan.firstDue||"");
      }
    }catch(e){}
  };

  const calcEach = ()=>{
    if(!instEach) return;
    const a = instAmt && instAmt.value!=="" ? Number(instAmt.value) : 0;
    const n = instN && instN.value!=="" ? Math.max(1, parseInt(instN.value,10)) : 0;
    if(a>0 && n>0) instEach.textContent = moneyBR(a/n);
    else instEach.textContent = "—";
  };
  instAmt?.addEventListener("input", calcEach);
  instN?.addEventListener("input", calcEach);
  calcEach();
  fillPlan();


  const nameInp = el("lf_name");
  const phoneInp = el("lf_phone");
  const showSuggest = ()=>{
    const html = buildSuggestList(actor, nameInp.value, phoneInp.value);
    if(!html){ suggestBox.classList.remove("show"); suggestBox.innerHTML=""; return; }
    suggestBox.innerHTML = html;
    suggestBox.classList.add("show");
    qsa(".suggestItem", suggestBox).forEach(it=>{
      it.addEventListener("click", ()=>{
        const cid = it.getAttribute("data-contact");
        loadExistingContactIntoModal(cid, actor, isNew);
      });
    });
  };
  nameInp?.addEventListener("input", ()=>{ showSuggest(); });
  phoneInp?.addEventListener("input", ()=>{ showSuggest(); });

  [nameInp, phoneInp].forEach(inp=>{
    inp?.addEventListener("blur", ()=>setTimeout(()=>suggestBox.classList.remove("show"), 180));
    inp?.addEventListener("focus", ()=>showSuggest());
  });

  const tagInp = el("lf_tag");
  const tagListEl = el("lf_tag_list");

  const __uniqTags = (arr)=> Array.from(new Set((arr||[]).map(x=>String(x||"").trim()).filter(Boolean)));

  const __renderTagList = ()=>{
    if(!tagListEl) return;
    const cur = __uniqTags(JSON.parse(tagInp?.dataset.tags||"[]"));
    if(cur.length===0){
      tagListEl.innerHTML = "";
      return;
    }
    tagListEl.innerHTML = cur.map((t,i)=>`<span class="tagPill" data-i="${i}">${escapeHTML(t)}<button type="button" class="tagRemove" data-i="${i}" aria-label="Remover tag">×</button></span>`).join("");
  };

  if(tagListEl){
    tagListEl.addEventListener("click", (e)=>{
      const btn = e.target?.closest?.(".tagRemove");
      if(!btn) return;
      e.preventDefault();
      const i = parseInt(btn.dataset.i, 10);
      let cur = [];
      try{ cur = __uniqTags(JSON.parse(tagInp?.dataset.tags||"[]")); }catch(_){ cur = []; }
      if(Number.isNaN(i) || i<0 || i>=cur.length) return;
      cur.splice(i,1);
      if(tagInp) tagInp.dataset.tags = JSON.stringify(cur);
      __renderTagList();
    });
  }



  try{
    const db3 = loadDB();
    let ent = null;
    let cont = null;
    if(editingEntryId){
      ent = db3.entries.find(x=>x.id===editingEntryId) || null;
      cont = ent ? db3.contacts.find(cc=>cc.id===ent.contactId) : null;
    }
    const saved = ([])
      .concat(Array.isArray(ent?.tags)?ent.tags:(ent?.tags?[ent.tags]:[]))
      .concat(Array.isArray(ent?.tag)?ent.tag:(ent?.tag?[ent.tag]:[]))
.map(x=>String(x||"").trim())
      .filter(Boolean)
      .filter(t=>!t.startsWith("Prioridade:"))
      .filter(t=>t!=="Campanha");
    if(tagInp){
      tagInp.dataset.tags = JSON.stringify(__uniqTags(saved));
    }
  }catch(_){}
  __renderTagList();

  tagInp?.addEventListener("keydown", (e)=>{
    if(e.key==="Enter"){
      e.preventDefault();
      const v = (tagInp.value||"").trim();
      if(!v) return;
      tagInp.value="";
      const cur = __uniqTags(JSON.parse(tagInp.dataset.tags||"[]").concat([v]));
      tagInp.dataset.tags = JSON.stringify(cur);
      __renderTagList();
      toast("Tag adicionada", v);
    }
  });

  const btn = el("btnSaveLead");
  btn?.addEventListener("click", async ()=>{
    if(!actor.perms.edit) return toast("Sem permissão", "Seu nível não permite editar.");

    const name = val("lf_name").trim();
    const phone = normPhone(val("lf_phone"));
    if(!name || !phone) return toast("Nome e telefone são obrigatórios");

    let monthKey = (val("lf_month","") || val("fMonth", new Date().toISOString().slice(0,7))).trim();
    if(!monthKey || monthKey === "all") monthKey = new Date().toISOString().slice(0,7);
    if(!/^\d{4}-\d{2}$/.test(monthKey)) return toast("Mês inválido", "Use YYYY-MM (ex: 2026-01)");

    const now = new Date().toISOString();

    const selectedId = String(el("lf_name")?.dataset.contactId || el("lf_phone")?.dataset.contactId || "").trim();
    const contactDraft = {
      id: null,
      masterId: actor.masterId,
      name,
      phone,
      cpf: String(val("lf_cpf") || "").replace(/\D/g, ""),
      birthDate: val("lf_birth") || "",
      firstSeenAt: val("lf_first") || todayISO(),
      lastSeenAt: val("lf_first") || todayISO()
    };

    let existingIndex = -1;
    let shouldSplitSharedContact = false;
    const editingEntryRef = editingEntryId ? db.entries.find(e=>String(e.id)===String(editingEntryId)) : null;

    if(editingEntryRef?.contactId){
      existingIndex = db.contacts.findIndex(c=>String(c.id)===String(editingEntryRef.contactId));
    }else if(selectedId){
      existingIndex = db.contacts.findIndex(c=>String(c.id)===String(selectedId) && c.masterId===actor.masterId);
    }

    const samePhoneContacts = db.contacts.filter(c=>
      c.masterId === actor.masterId &&
      String(c.phone || "") === String(phone || "")
    );

    if(isNew && !selectedId && samePhoneContacts.length){
      const names = samePhoneContacts.map(c=>c.name).filter(Boolean).slice(0,3).join(", ");
      const continuar = confirm(
        "Já existe contato com esse mesmo telefone.\n\n" +
        (names ? "Contato(s): " + names + "\n\n" : "") +
        "OK = cadastrar como OUTRO paciente usando o mesmo número.\n" +
        "Cancelar = voltar e escolher uma sugestão existente."
      );
      if(!continuar) return;
      existingIndex = -1;
    }

    if(editingEntryRef && existingIndex >= 0){
      const oldContact = db.contacts[existingIndex];
      const linkedCount = db.entries.filter(e=>String(e.contactId)===String(oldContact.id)).length;
      const personalChanged =
        String(oldContact.name || "") !== String(contactDraft.name || "") ||
        String(oldContact.phone || "") !== String(contactDraft.phone || "") ||
        String(oldContact.cpf || "") !== String(contactDraft.cpf || "") ||
        String(oldContact.birthDate || "") !== String(contactDraft.birthDate || "");

      if(linkedCount > 1 && personalChanged){
        shouldSplitSharedContact = confirm(
          "Este contato está vinculado a " + linkedCount + " leads.\n\n" +
          "OK = separar ESTE lead como outro paciente, mantendo o mesmo telefone.\n" +
          "Cancelar = atualizar o contato compartilhado em todos os leads vinculados."
        );
        if(shouldSplitSharedContact){
          existingIndex = -1;
        }
      }
    }

    let contact;
    if(existingIndex >= 0){
      db.contacts[existingIndex].name = contactDraft.name;
      db.contacts[existingIndex].phone = contactDraft.phone;
      db.contacts[existingIndex].cpf = contactDraft.cpf;
      db.contacts[existingIndex].birthDate = contactDraft.birthDate;
      db.contacts[existingIndex].lastSeenAt = contactDraft.lastSeenAt;
      if(!db.contacts[existingIndex].firstSeenAt) db.contacts[existingIndex].firstSeenAt = contactDraft.firstSeenAt;
      contact = db.contacts[existingIndex];
    }else{
      contact = {
        ...contactDraft,
        id: (crypto.randomUUID ? crypto.randomUUID() : uid("c"))
      };
      db.contacts.push(contact);
    }

    const status = val("lf_status");
    const origin = val("lf_origin");
    const originOther = origin==="Outros" ? val("lf_originOther").trim() : "";
    const treatment = val("lf_treatment");
    const treatmentOther = treatment==="Outros" ? val("lf_treatOther").trim() : "";
    const city = val("lf_city").trim();
    const firstContactAt = val("lf_first") || todayISO();
    const apptDate = val("lf_apptDate") || "";
    const apptTime = val("lf_apptTime") || "";
    const callAttempts = val("lf_calls") || "";
    const callResult = val("lf_callResult") || "";
    const notes = val("lf_notes").trim();
    const hasLegacyFinancialFields = !!(el("lf_value_budget") || el("lf_value_paid") || el("lf_payment_date") || el("lf_pay_method"));
    const hasLegacyBudgetField = !!el("lf_value_budget");
    const hasLegacyPaidField = !!el("lf_value_paid");
    const payMethod = hasLegacyFinancialFields ? val("lf_pay_method","").trim() : "";

    const valueBudgetRaw = hasLegacyBudgetField ? el("lf_value_budget")?.value : "";
    const valueBudget = hasLegacyBudgetField ? parseBRNum(valueBudgetRaw) : null;
    const valuePaidRaw = hasLegacyPaidField ? el("lf_value_paid")?.value : "";
    const valuePaid = hasLegacyPaidField ? parseBRNum(valuePaidRaw) : null;
    const paymentDate = hasLegacyFinancialFields ? (val("lf_payment_date") || "") : "";
    const campaign = !!el("lf_campaign")?.checked;

    let manualTags = [];
    try{ manualTags = JSON.parse((tagInp?.dataset.tags)||"[]") || []; }catch(_){ manualTags = []; }
    const pendingTag = (tagInp?.value||"").trim();
    if(pendingTag){
      manualTags = Array.from(new Set([...(manualTags||[]), pendingTag]));
      if(tagInp){ tagInp.value=""; tagInp.dataset.tags = JSON.stringify(manualTags); }
    }
    const prio = val("lf_priority");
    let tags = [];
    if(prio) tags.push("Prioridade: " + prio);
    tags.push(...manualTags);

    const realToday = todayISO();
    const rescueDate = paymentDate || realToday;
    const rescueMonthKey = String(rescueDate).slice(0,7);
    const hadBefore = db.entries.some(e=>e.masterId===actor.masterId && e.contactId===contact.id && e.monthKey !== rescueMonthKey);
    const existingThisMonth = db.entries.find(e=>e.masterId===actor.masterId && e.contactId===contact.id && e.monthKey === monthKey);

    if(isNew && existingThisMonth){
      saveDB(db);
      toast("Esse lead já existe neste mês", "Abrindo pra editar.");
      closeModal();
      openLeadEntry(existingThisMonth.id);
      return;
    }

    let entry;
    if(editingEntryId){
      entry = db.entries.find(e=>e.id===editingEntryId);
      if(!entry) return toast("Erro", "Entrada não encontrada");
      entry.contactId = contact.id;
    }else{
      entry = { id: uid("e"), masterId: actor.masterId, contactId: contact.id, monthKey, statusLog: [], tags: [] };
      db.entries.push(entry);
    }

    const originalMonthKey = String(entry.monthKey || monthKey || "");
    const originalStatus = String(entry.status || "");
    const originalPaidBase = (entry.valuePaidGross!=null && !isNaN(Number(entry.valuePaidGross)))
      ? Number(entry.valuePaidGross)
      : getEntryPaidValue(entry);
    const originalPaidShown = getEntryPaidValue(entry);
    const isCrossMonthFinancialEdit = !!editingEntryId && originalMonthKey && originalMonthKey !== rescueMonthKey;
    const paidNow = (hasLegacyPaidField && valuePaid!=null && !isNaN(Number(valuePaid))) ? Number(valuePaid) : originalPaidBase;
    const paidDelta = hasLegacyPaidField ? Math.max(0, Number((paidNow - originalPaidBase).toFixed(2))) : 0;
    const hasExplicitLegacyPaymentDate = !!paymentDate;
    const shouldRegisterRescue = hasLegacyPaidField && hasExplicitLegacyPaymentDate && isCrossMonthFinancialEdit && status === "Fechou" && paidDelta > 0;
    const shouldRegisterDirectPayment = hasLegacyPaidField && hasExplicitLegacyPaymentDate && !shouldRegisterRescue && status === "Fechou" && paidDelta > 0;

    const fromStatus = shouldRegisterRescue ? originalStatus : (entry.status || "");
    const toStatus = shouldRegisterRescue ? originalStatus : status;

    entry.monthKey = editingEntryId ? (originalMonthKey || monthKey) : monthKey;
    entry.firstContactAt = firstContactAt;
    entry.lastUpdateAt = now;
    entry.status = shouldRegisterRescue ? originalStatus : status;
    entry.origin = origin;
    entry.originOther = originOther;
    entry.treatment = treatment;
    entry.treatmentOther = treatmentOther;
    entry.city = city;
    entry.notes = notes;
    if(hasLegacyBudgetField){
      entry.valueBudget = valueBudget;
      entry.valueEstimated = valueBudget;
    }
    entry.apptDate = apptDate;
    entry.apptTime = apptTime;
    entry.callAttempts = callAttempts;
    entry.callResult = callResult;

    if(shouldRegisterRescue){
      entry.valuePaid = (originalPaidShown || null);
      entry.valueClosed = (originalStatus === "Fechou") ? (originalPaidShown || null) : null;
      entry.valuePaidGross = paidNow;
      entry.valueClosedGross = paidNow;
      entry.lastPaymentDate = rescueDate;
    }else if(hasLegacyPaidField){
      entry.valuePaid = valuePaid;
      entry.valueClosed = (status==="Fechou") ? valuePaid : null;
      entry.valuePaidGross = valuePaid;
      entry.valueClosedGross = (status==="Fechou") ? valuePaid : null;
      if(shouldRegisterDirectPayment || (paidNow>0 && hasExplicitLegacyPaymentDate)) entry.lastPaymentDate = rescueDate;
    }

    const preserved = (entry.tags||[]).filter(t=>String(t)==="Resgatado");
    entry.tags = Array.from(new Set([...preserved, ...tags, ...(campaign ? ["Campanha"] : [])]));
    if(!editingEntryId && hadBefore){
      entry.tags = Array.from(new Set([...(entry.tags||[]), "Resgatado"]));
    }

    if(fromStatus !== toStatus){
      entry.statusLog = entry.statusLog || [];
      entry.statusLog.push({ at: now, from: fromStatus, to: toStatus, by: actor.name });
    }

    if(shouldRegisterRescue){
      let rescueEntry = db.entries.find(e=>
        e.masterId===actor.masterId &&
        e.contactId===contact.id &&
        e.monthKey===rescueMonthKey &&
        Array.isArray(e.tags) && e.tags.includes("Resgatado")
      );

      const rescuePrevPaid = rescueEntry ? getEntryPaidValue(rescueEntry) : 0;
      const rescuePrevStatus = rescueEntry ? String(rescueEntry.status || "") : "";
      if(!rescueEntry){
        rescueEntry = { id: uid("e"), masterId: actor.masterId, contactId: contact.id, monthKey: rescueMonthKey, statusLog: [], tags: [] };
        db.entries.push(rescueEntry);
      }

      rescueEntry.firstContactAt = rescueEntry.firstContactAt || rescueDate;
      rescueEntry.lastUpdateAt = now;
      rescueEntry.status = status;
      rescueEntry.origin = origin;
      rescueEntry.originOther = originOther;
      rescueEntry.treatment = treatment;
      rescueEntry.treatmentOther = treatmentOther;
      rescueEntry.city = city;
      rescueEntry.notes = notes;
      rescueEntry.valueBudget = rescueEntry.valueBudget ?? valueBudget ?? null;
      rescueEntry.valueEstimated = rescueEntry.valueBudget;
      rescueEntry.valuePaid = Number((rescuePrevPaid + paidDelta).toFixed(2));
      rescueEntry.valueClosed = (status==="Fechou") ? rescueEntry.valuePaid : null;
      rescueEntry.valuePaidGross = rescueEntry.valuePaid;
      rescueEntry.valueClosedGross = rescueEntry.valueClosed;
      rescueEntry.lastPaymentDate = rescueDate;
      rescueEntry.apptDate = rescueDate;
      rescueEntry.apptTime = rescueEntry.apptTime || now.slice(11,16);
      rescueEntry.callAttempts = callAttempts;
      rescueEntry.callResult = callResult;
      rescueEntry.tags = Array.from(new Set([...(rescueEntry.tags||[]), ...tags, "Resgatado", ...(campaign ? ["Campanha"] : [])]));

      if(rescuePrevStatus !== status || !rescuePrevStatus){
        rescueEntry.statusLog = rescueEntry.statusLog || [];
        rescueEntry.statusLog.push({ at: now, from: rescuePrevStatus, to: status, by: actor.name });
      }

      db.payments = db.payments || [];
      db.payments.push({
        id: uid("p"),
        masterId: actor.masterId,
        entryId: rescueEntry.id,
        contactId: contact.id,
        at: now,
        date: rescueDate,
        paidAt: rescueDate,
        cashDate: rescueDate,
        status: "PAGA",
        value: paidDelta,
        method: payMethod || "",
        desc: "Resgate / pagamento manual",
        source: "leadManualConfirmed"
      });
    }

    if(shouldRegisterDirectPayment){
      db.payments = db.payments || [];
      db.payments.push({
        id: uid("p"),
        masterId: actor.masterId,
        entryId: entry.id,
        contactId: contact.id,
        at: now,
        date: rescueDate,
        paidAt: rescueDate,
        cashDate: rescueDate,
        status: "PAGA",
        value: paidDelta,
        method: payMethod || "",
        desc: "Pagamento manual",
        source: "leadManualConfirmed"
      });
    }

    /* ===== Parcelamento antigo removido do cadastro do lead =====
       Novo fluxo fica em: Recebimentos > + Novo recebimento.
       Mantemos entry.installPlan existente intacto para não quebrar histórico legado. */
    if(el("lf_inst_amount") || el("lf_inst_n") || el("lf_entry_amount")){
      const entryAmtRaw = el("lf_entry_amount")?.value;
      const entryAmount = parseBRNum(entryAmtRaw) || 0;
      const instAmtRaw = el("lf_inst_amount")?.value;
      const instAmount = parseBRNum(instAmtRaw) || 0;
      const instNRaw = el("lf_inst_n")?.value;
      const instN = (instNRaw!==undefined && instNRaw!==null && instNRaw!=="") ? parseInt(instNRaw,10) : 0;
      const firstDue = val("lf_inst_firstdue","").trim();

      if(entryAmount>0 && (valuePaid==null || isNaN(valuePaid))){
        entry.valuePaid = entryAmount;
        entry.valueClosed = (status==="Fechou") ? entry.valuePaid : null;
      }

      if(instAmount>0 && instN>0){
        entry.installPlan = { amount: instAmount, n: instN, firstDue: firstDue, payMethod: payMethod, entryAmount: entryAmount, each: Number((instAmount/instN).toFixed(2)) };
        buildInstallments(entry);
      }
    }

    const cloudPromise = saveDB(db, { immediate:true });
    closeModal();
    ensureMonthOptions(); // in case new month
    const savedMonthLabel = (typeof rescueMonthKey !== "undefined" && shouldRegisterRescue) ? `${monthLabel(rescueMonthKey)} • Resgatado` : monthLabel(monthKey);
    toast("Lead salvo ✅", `${name} • ${savedMonthLabel} • sincronizando na nuvem...`);
    renderAll();

    Promise.resolve(cloudPromise).then((cloudOk)=>{
      if(cloudOk){
        toast("Salvo na nuvem ✅", `${name} • ${savedMonthLabel}`);
        try{ renderAll(); }catch(_){}
      }else{
        toast("Lead salvo neste navegador", `${name} • ${savedMonthLabel} • a nuvem não confirmou agora`);
      }
    }).catch((err)=>{
      console.error("Falha ao confirmar lead na nuvem:", err);
      toast("Lead salvo neste navegador", `${name} • ${savedMonthLabel} • a nuvem não confirmou agora`);
    });
  });
}

function loadExistingContactIntoModal(contactId, actor, isNew){
  const db = loadDB();
  const c = db.contacts.find(x=>x.id===contactId);
  if(!c) return;

  let monthKey = (val("lf_month","") || val("fMonth", new Date().toISOString().slice(0,7))).trim();
  if(!monthKey || monthKey === "all") monthKey = new Date().toISOString().slice(0,7);
  const entries = (db.entries||[])
    .filter(e=>e.masterId===actor.masterId && e.contactId===c.id)
    .sort((a,b)=>{
      const da = String(a.lastUpdateAt || a.firstContactAt || a.monthKey || "");
      const dbb = String(b.lastUpdateAt || b.firstContactAt || b.monthKey || "");
      return dbb.localeCompare(da);
    });

  const existing = entries.find(e=>e.monthKey===monthKey);
  const latest = entries[0] || null;

  const targetEntry = existing || latest;
  if(targetEntry){
    closeModal();
    openLeadEntry(targetEntry.id);
    return;
  }

  const setIf = (id, value)=>{
    const node = el(id);
    if(!node) return;
    node.value = value == null ? "" : String(value);
  };

  setIf("lf_name", c.name || latest?.name || "");
  setIf("lf_phone", c.phone || "");
  setIf("lf_cpf", formatCPF(c.cpf || ""));
  setIf("lf_birth", c.birthDate || "");
  if(el("lf_name")) el("lf_name").dataset.contactId = String(c.id || "");
  if(el("lf_phone")) el("lf_phone").dataset.contactId = String(c.id || "");

  if(latest){
    setIf("lf_first", latest.firstContactAt || c.firstSeenAt || todayISO());
    setIf("lf_month", latest.monthKey || monthKey || "");
    setIf("lf_status", latest.status || "Conversando");
    setIf("lf_origin", latest.origin || "Instagram orgânico");
    setIf("lf_originOther", latest.originOther || "");
    setIf("lf_treatment", latest.treatment || "Clínica geral");
    setIf("lf_treatOther", latest.treatmentOther || "");
    setIf("lf_apptDate", latest.apptDate || "");
    setIf("lf_apptTime", latest.apptTime || "");
    setIf("lf_calls", latest.callAttempts || "");
    setIf("lf_callResult", latest.callResult || "");
    setIf("lf_notes", latest.notes || "");

    const tags = Array.isArray(latest.tags) ? latest.tags : [];
    const prioTag = tags.find(t=>String(t||"").startsWith("Prioridade: ")) || "";
    const prio = prioTag ? prioTag.replace(/^Prioridade:\s*/, "") : "";
    setIf("lf_priority", prio);

    const manualTags = tags
      .map(t=>String(t||"").trim())
      .filter(Boolean)
      .filter(t=>!t.startsWith("Prioridade:"))
      .filter(t=>t!=="Campanha");

    const tagInp = el("lf_tag");
    const tagListEl = el("lf_tag_list");
    if(tagInp) tagInp.dataset.tags = JSON.stringify(Array.from(new Set(manualTags)));
    const campaignChk = el("lf_campaign");
    if(campaignChk) campaignChk.checked = tags.includes("Campanha");
    if(tagListEl){
      const uniq = Array.from(new Set(manualTags));
      tagListEl.innerHTML = uniq.map((t,i)=>`<span class="tagPill" data-i="${i}">${escapeHTML(t)}<button type="button" class="tagRemove" data-i="${i}" aria-label="Remover tag">×</button></span>`).join("");
    }
  }else{
    setIf("lf_first", c.firstSeenAt || todayISO());
    const campaignChk = el("lf_campaign");
    if(campaignChk) campaignChk.checked = false;
  }

  ["lf_origin","lf_treatment"].forEach(id=>el(id)?.dispatchEvent(new Event("change", { bubbles:true })));

  fillHistory(c.id);
  document.querySelectorAll(".suggestBox.show").forEach(box=>box.classList.remove("show"));
  toast("Cadastro carregado", latest ? "Dados anteriores preenchidos automaticamente." : "Contato existente carregado para novo registro.");
}

/* -------- Delete -------- */

function toggleLeadDone(entryId){
  const db = loadDB();
  const e = db.entries.find(x=>x.id===entryId);
  if(!e) return;
  if(e.status==="Concluído"){
    e.status = e._prevStatus || "Conversando";
    delete e._prevStatus;
  }else{
    e._prevStatus = e.status || "Conversando";
    e.status = "Concluído";
  }
  e.lastUpdateAt = new Date().toISOString();
  saveDB(db);
  renderAll();
}


/* ===== Ações rápidas (aba Leads em cards) =====
   ✅ markOK: marca como "Fechou"
   💬 openWhats: abre WhatsApp do lead (template simples)
   🗑️ deleteLead: wrapper para deleteEntry
*/
function markOK(entryId){
  try{
    const actor = currentActor();
    if(!actor){ toast("Sessão expirada", "Faça login novamente."); showAuth(); return; }
    if(!actor.perms.edit) return toast("Sem permissão", "Seu nível não permite editar.");
    const db = loadDB();
    const entry = (db.entries||[]).find(e=>String(e.id)===String(entryId));
    if(!entry) return toast("Erro", "Lead não encontrado.");

    const fromStatus = String(entry.status||"");
    let toStatus = "Concluído";

    if(fromStatus === "Concluído"){
      const back = entry._prevStatus || entry.prevStatus || "";
      if(back && back !== "Concluído"){
        toStatus = back;
      }else{
        toStatus = "Sem resposta";
      }
      entry._prevStatus = null;
      entry.prevStatus = null;
    }else{
      entry._prevStatus = fromStatus;
      entry.prevStatus = fromStatus;
      toStatus = "Concluído";
    }

    entry.status = toStatus;
    entry.lastUpdateAt = new Date().toISOString();

    const vp = parseMoney(entry.valuePaid);
    entry.valueClosed = vp || null;

    entry.statusLog = entry.statusLog || [];
    if(fromStatus !== toStatus){
      entry.statusLog.push({ at: entry.lastUpdateAt, from: fromStatus, to: toStatus, by: actor.name });
    }

    saveDB(db);
    toast("Status atualizado", (toStatus==="Concluído") ? "Marcado como Concluído ✅" : `Voltou para: ${toStatus}`);
    renderAll();
  }catch(e){
    console.error(e);
    toast("Erro", "Não foi possível marcar OK.");
  }
}


function openWhats(entryId){
  try{
    const actor = currentActor();
    if(!actor){ toast("Sessão expirada", "Faça login novamente."); showAuth(); return; }
    const db = loadDB();
    const entry = (db.entries||[]).find(e=>String(e.id)===String(entryId));
    if(!entry) return toast("Erro", "Lead não encontrado.");
    const contact = (db.contacts||[]).find(c=>c.id===entry.contactId) || {};
    const phone = String(contact.phone||entry.phone||"").replace(/\D/g,'');
    if(!phone) return toast("Sem telefone", "Esse lead não tem telefone.");
    const tpl = (db.settings && db.settings.waTemplate) ? String(db.settings.waTemplate) : "Oi {nome}! Vi seu interesse. Posso te ajudar?";
    const msg = tpl
      .replaceAll("{nome}", String(contact.name||entry.name||""))
      .replaceAll("{tratamento}", String(entry.treatment==="Outros" ? (entry.treatmentOther||"") : (entry.treatment||"")));
    const url = `https://wa.me/55${phone}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  }catch(e){
    console.error(e);
    toast("Erro", "Não foi possível abrir o WhatsApp.");
  }
}

function deleteLead(entryId){
  return deleteEntry(entryId);
}

function deleteEntry(entryId){
  const actor = currentActor();
  if(!actor.perms.delete) return toast("Sem permissão", "Seu nível não permite excluir.");
  const db = loadDB();
  const e = db.entries.find(x=>x.id===entryId);
  if(!e) return;
  const c = db.contacts.find(x=>x.id===e.contactId);
  if(!confirm(`Excluir lead do mês ${monthLabel(e.monthKey)}? (${c?.name||"—"})`)) return;
  db.entries = db.entries.filter(x=>x.id!==entryId);
  saveDB(db);
  toast("Excluído", "Entrada removida.");
  renderAll();
}

/* -------- Users CRUD -------- */
function userFormHTML(user){
  const u = user || {name:"", username:"", email:"", role:"SECRETARIA"};
  const isCloudUser = !!u.authUid;
  const visibleEmail = (u.email && !String(u.email).endsWith("@users.cronos.local")) ? u.email : "";
  return `
    <div class="twoCol">
      <div>
        <label>Nome</label>
        <input id="uf_name" value="${escapeHTML(u.name||"")}" placeholder="Ex: Ana"/>
      </div>
      <div>
        <label>Nível</label>
        <select id="uf_role">
          ${( (currentActor()?.perms?.manageMasters) ? ROLES : ROLES.filter(r=>r!=="MASTER") ).map(r=>`<option value="${r}" ${u.role===r?"selected":""}>${r}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Usuário / login</label>
        <input id="uf_username" value="${escapeHTML(u.username||"")}" placeholder="Ex: secretaria1" ${isCloudUser ? "disabled" : ""}/>
      </div>
      <div>
        <label>E-mail (opcional)</label>
        <input id="uf_email" value="${escapeHTML(visibleEmail||"")}" placeholder="email@clinica.com" ${isCloudUser ? "disabled" : ""}/>
      </div>
      <div style="grid-column:1/-1">
        <label>Senha</label>
        <input id="uf_pass" type="password" placeholder="${isCloudUser ? "senha não editável aqui" : "defina uma senha"}" ${isCloudUser ? "disabled" : ""}/>
      </div>
      <div class="muted" style="font-size:12px; grid-column:1/-1">
        ${
          isCloudUser
            ? 'Este acesso já existe na nuvem. Aqui você pode alterar <b>nome</b> e <b>nível</b>. Login e senha de outro usuário cloud exigem uma rota administrativa segura.'
            : 'Se preencher <b>usuário</b>, ele vira o login principal. O <b>e-mail</b> fica como contato. Se deixar o usuário vazio, o login será pelo e-mail.'
        }
      </div>
    </div>
  `;
}


async function createClinicUserViaEdge({ name, username, email, password, role }){
  const sessionResp = await supabaseClient.auth.getSession();
  const session = sessionResp?.data?.session;
  if(!session?.access_token){
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/${CREATE_CLINIC_USER_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`,
      "apikey": supabaseKey
    },
    body: JSON.stringify({ name, username, email, password, role })
  });

  const json = await res.json().catch(() => ({}));
  if(!res.ok){
    throw new Error(json?.error || "Não foi possível criar o usuário.");
  }
  return json || {};
}

function openNewUser(){
  const actor = currentActor();
  if(!actor.perms.manageUsers) return toast("Sem permissão", "Somente Master pode gerenciar usuários.");
  openModal({
    title: "Novo usuário",
    sub: "Usuário interno vinculado ao Master.",
    bodyHTML: userFormHTML(null),
    footHTML: `
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn ok" id="btnSaveUser">Salvar</button>
    `,
    onMount: ()=>{
      el("btnSaveUser").addEventListener("click", async ()=>{
        const db = loadDB();
        const name = val("uf_name").trim();
        const role = val("uf_role");
        if(role==="MASTER" && !actor.perms.manageMasters) return toast("Bloqueado", "Só o Master principal pode criar outros masters.");

        const username = normalizeUsername(val("uf_username"));
        const email = val("uf_email").trim().toLowerCase();
        const pass = val("uf_pass");
        if(!name) return toast("Nome obrigatório");
        if(!email && !username) return toast("Informe um usuário ou e-mail");
        if(!pass) return toast("Senha obrigatória");

        if(username && db.users.some(u=>u.masterId===actor.masterId && normalizeUsername(u.username)===username)) return toast("Usuário já existe");
        if(email && db.users.some(u=>u.masterId===actor.masterId && String(u.email||"").toLowerCase()===email)) return toast("E-mail já existe");

        try{
          const result = await createClinicUserViaEdge({
            name,
            username,
            email,
            password: pass,
            role
          });

          const authUid = result?.user?.auth_uid || result?.auth_uid || null;
          const loginEmail = result?.user?.login_email || (username ? usernameToSyntheticEmail(username) : email);
          const explicitEmail = result?.user?.email || email || "";
          const pendingApproval = result?.pending_approval === true;

          db.users.push({
            id: uid("u"),
            authUid,
            masterId: actor.masterId,
            name,
            username: username || "",
            email: explicitEmail || "",
            loginEmail: loginEmail || "",
            role,
            active: !pendingApproval,
            pendingApproval,
            blockedReason: result?.blocked_reason || null,
            createdAt: new Date().toISOString()
          });

          saveDB(db, { immediate:true });
          closeModal();

          if(pendingApproval){
            toast("Usuário enviado para aprovação ⏳", `${name} foi criado, mas ficará bloqueado até liberação do superadmin.`);
          }else{
            toast("Usuário criado ✅", `${name} já pode entrar no sistema.`);
          }
          renderAll();
        }catch(err){
          console.error("Erro ao criar usuário cloud:", err);
          const msg = String(err?.message || err?.error_description || "Não foi possível criar o usuário.");
          toast("Falha ao criar usuário", msg);
        }
      });
    }
  });
}

function openUserEdit(userId){
  const actor = currentActor();
  if(!actor.perms.manageUsers) return toast("Sem permissão");
  const db = loadDB();
  const u = db.users.find(x=>x.id===userId);
  if(!u) return toast("Usuário não encontrado");
  openModal({
    title: "Editar usuário",
    sub: u.authUid ? "Nome e nível podem ser alterados aqui. Credenciais cloud de terceiros precisam de rota administrativa." : "Altere nível e login. (Senha opcional)",
    bodyHTML: userFormHTML(u),
    footHTML: `
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn ok" id="btnSaveUser">Salvar</button>
    `,
    onMount: ()=>{
      if(!u.authUid){
        el("uf_pass").placeholder = "deixe vazio para manter";
      }
      el("btnSaveUser").addEventListener("click", async ()=>{
        const name = val("uf_name").trim();
        const role = val("uf_role");
        if(role==="MASTER" && !actor.perms.manageMasters) return toast("Bloqueado", "Só o Master principal pode promover para MASTER.");
        if(!name) return toast("Nome obrigatório");

        if(u.authUid){
          try{
            u.name = name;
            u.role = role;
            await updateClinicMemberRecord(u, { name, role });
            saveDB(db, { immediate:true });
            closeModal();
            toast("Usuário atualizado ✅");
            renderAll();
          }catch(err){
            console.error("Erro ao atualizar usuário cloud:", err);
            toast("Falha ao atualizar usuário", String(err?.message || "Tente novamente."));
          }
          return;
        }

        const username = normalizeUsername(val("uf_username"));
        const email = val("uf_email").trim().toLowerCase();
        const pass = val("uf_pass");
        if(!email && !username) return toast("Informe e-mail ou usuário");

        if(username && db.users.some(x=>x.masterId===actor.masterId && normalizeUsername(x.username)===username && x.id!==u.id)) return toast("Usuário já existe");
        if(email && db.users.some(x=>x.masterId===actor.masterId && String(x.email||"").toLowerCase()===email && x.id!==u.id)) return toast("E-mail já existe");

        u.name = name;
        u.role = role;
        u.username = username;
        u.email = email;
        if(pass){
          u.passHash = await hashPass(pass);
        }
        saveDB(db, { immediate:true });
        closeModal();
        toast("Usuário atualizado ✅");
        renderAll();
      });
    }
  });
}

async function deleteUser(userId){
  const actor = currentActor();
  if(!actor.perms.manageUsers) return toast("Sem permissão");
  const db = loadDB();
  const u = db.users.find(x=>x.id===userId);
  if(!u) return;
  if(u.role==="MASTER" && !actor.perms.manageMasters) return toast("Bloqueado", "Só o Master principal pode remover outros masters.");
  if(!confirm(`Excluir usuário ${u.name}?`)) return;

  try{
    if(u.authUid){
      await deactivateClinicMemberRecord(u);
    }
    db.users = db.users.filter(x=>x.id!==userId);
    saveDB(db, { immediate:true });
    toast("Usuário excluído");
    renderAll();
  }catch(err){
    console.error("Erro ao remover usuário:", err);
    toast("Falha ao excluir usuário", String(err?.message || "Tente novamente."));
  }
}

/* -------- CSV Export -------- */
function exportCSV(){
  const actor = currentActor();
  if(!actor) return;
  const f = getUIFilters();
  const db = loadDB();
  const rows = filteredEntries();

  const headers = ["Nome","Número","Status","Origem","Tratamento","Primeiro contato","Agendamento data","Agendamento hora","Tentativas","Resultado ligação","Cidade","Mês","Orçamento (R$)","Pago (R$)","Em aberto (R$)"];
  const lines = [headers.join(",")];

  rows.forEach(e=>{
    const c = db.contacts.find(x=>x.id===e.contactId);
    const origin = e.origin==="Outros" ? (e.originOther||"Outros") : e.origin;
    const treat = e.treatment==="Outros" ? (e.treatmentOther||"Outros") : e.treatment;
    const arr = [
      csvSafe(c?.name||""),
      csvSafe(c?.phone||""),
      csvSafe(e.status||""),
      csvSafe(origin||""),
      csvSafe(treat||""),
      csvSafe(e.firstContactAt||""),
      csvSafe(e.apptDate||""),
      csvSafe(e.apptTime||""),
      csvSafe(e.callAttempts||""),
      csvSafe(e.callResult||""),
      csvSafe(e.city||""),
      csvSafe(monthLabel(e.monthKey)),
      csvSafe(((e.valueBudget!=null)?Number(e.valueBudget):((e.valueEstimated!=null)?Number(e.valueEstimated):""))),
      csvSafe(((e.valuePaid!=null)?Number(e.valuePaid):((e.valueClosed!=null)?Number(e.valueClosed):""))),
      csvSafe((()=>{ const b=(e.valueBudget!=null)?Number(e.valueBudget):((e.valueEstimated!=null)?Number(e.valueEstimated):0); const p=(e.valuePaid!=null)?Number(e.valuePaid):((e.valueClosed!=null)?Number(e.valueClosed):0); const o=Math.max(0,(b||0)-(p||0)); return o?o:""; })())
    ];
    lines.push(arr.join(","));
  });

  const title = `Leads do mês de ${monthLabel(f.monthKey)}`;
  const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replaceAll(" ","_")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  toast("CSV exportado ✅", title);

}

function exportPDFFiltered(){
  const actor = currentActor();
  if(!actor) return;
  const f = getUIFilters();
  const db = loadDB();
  const rows = filteredEntries();

  const title = `Relatório • ${monthLabel(f.monthKey)}`;
  const logo = getSmallLogoDataURI ? getSmallLogoDataURI() : "";
  const master = db.masters.find(m=>m.id===actor.masterId);

  const tableRows = rows.map(e=>{
    const c = db.contacts.find(x=>x.id===e.contactId);
    const origin = e.origin==="Outros" ? (e.originOther||"Outros") : e.origin;
    const treat = e.treatment==="Outros" ? (e.treatmentOther||"Outros") : e.treatment;
    const budget = (e.valueBudget!=null && !isNaN(Number(e.valueBudget))) ? Number(e.valueBudget) : ((e.valueEstimated!=null && !isNaN(Number(e.valueEstimated))) ? Number(e.valueEstimated) : 0);
    const paid = (e.valuePaid!=null && !isNaN(Number(e.valuePaid))) ? Number(e.valuePaid) : ((e.valueClosed!=null && !isNaN(Number(e.valueClosed))) ? Number(e.valueClosed) : 0);
    const open = Math.max(0, (budget||0)-(paid||0));
    const appt = e.apptDate ? `${fmtBR(e.apptDate)} ${e.apptTime||""}`.trim() : "—";
    return `
      <tr>
        <td><b>${escapeHTML(c?.name||"—")}</b><div class="muted">${escapeHTML(c?.phone||"—")}</div></td>
        <td>${escapeHTML(e.status||"—")}</td>
        <td>${escapeHTML(origin||"—")}</td>
        <td>${escapeHTML(treat||"—")}</td>
        <td class="mono">${escapeHTML(appt)}</td>
        <td class="mono">${budget?moneyBR(budget):"—"}</td>
        <td class="mono">${paid?moneyBR(paid):"—"}</td>
        <td class="mono">${open?moneyBR(open):"—"}</td>
      </tr>
    `;
  }).join("");

  const totalPaid = rows.reduce((acc,e)=>{
    const v = (e.valuePaid!=null && !isNaN(Number(e.valuePaid))) ? Number(e.valuePaid) : ((e.valueClosed!=null && !isNaN(Number(e.valueClosed))) ? Number(e.valueClosed) : 0);
    return acc + (v||0);
  },0);

  const htmlDoc = `
<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHTML(title)}</title>
<style>
  body{font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 24px; color:#111;}
  .head{display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:16px; border-bottom:1px solid #ddd; padding-bottom:12px;}
  .brand{display:flex; align-items:center; gap:10px;}
  .brand img{width:34px; height:34px;}
  h1{font-size:18px; margin:0;}
  .sub{font-size:12px; color:#555; margin-top:2px;}
  .muted{color:#666;}
  table{width:100%; border-collapse:collapse; margin-top:12px;}
  th,td{border-bottom:1px solid #eee; text-align:left; padding:8px 6px; font-size:12px; vertical-align:top;}
  th{color:#444;}
  .mono{font-variant-numeric: tabular-nums;}
  .footer{margin-top:10px; font-size:12px; color:#444;}
  @media print{ body{margin: 14mm;} }

/* ===== Access guard / renewal ===== */
.accessGateCard{
  width:min(560px, 100%);
  border:1px solid var(--line);
  border-radius:26px;
  background: linear-gradient(180deg, rgba(255,255,255,.05), transparent 42%), var(--panel);
  box-shadow: var(--shadow);
  padding:20px 18px;
}
.accessGateHeader{
  display:flex;
  align-items:center;
  gap:12px;
  margin-bottom:12px;
}
.accessGateBadge{
  width:44px;
  height:44px;
  border-radius:999px;
  display:grid;
  place-items:center;
  font-size:20px;
  background: rgba(255,255,255,.05);
  border:1px solid var(--line);
}
.accessGateTitle{
  margin:0;
  font-size:26px;
  line-height:1.02;
  letter-spacing:-.02em;
}
.accessGateText{
  margin:10px 0 0;
  color:var(--muted);
  line-height:1.5;
}
.accessGateMeta{
  margin-top:14px;
  padding:12px 14px;
  border-radius:16px;
  border:1px solid var(--line);
  background: rgba(255,255,255,.03);
  color:var(--text);
  display:grid;
  gap:8px;
}
.accessGateActions{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  margin-top:16px;
}
.accessGateActions .btn{
  flex:1 1 220px;
  justify-content:center;
}
.accessNotice{
  width:min(560px, 100%);
  border:1px solid var(--line);
  border-radius:22px;
  background: var(--panel2);
  box-shadow: 0 20px 60px rgba(17,24,39,.15);
  padding:18px 16px;
}
.accessNoticeHead{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  margin-bottom:10px;
}
.accessNoticeHead h3{
  margin:0;
  font-size:20px;
}
.accessNoticeText{
  color:var(--muted);
  line-height:1.5;
  margin:0 0 14px;
}
.accessNoticeActions{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  justify-content:flex-end;
}
.accessNoticeDays{
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:6px 10px;
  border-radius:999px;
  border:1px solid var(--line);
  background: rgba(255,255,255,.04);
  color:var(--text);
  font-size:12px;
  font-weight:700;
}

</style>
</head>
<body>
  <div class="head">
    <div class="brand">
      ${logo?`<img src="${logo}" alt="Cronos"/>`:``}
      <div>
        <h1>${escapeHTML(master?.name||"Clínica")} — Relatório</h1>
        <div class="sub">${escapeHTML(monthLabel(f.monthKey))} • Gerado em ${new Date().toLocaleString("pt-BR")}</div>
      </div>
    </div>
    <div class="mono"><b>Total recebido:</b> ${moneyBR(totalPaid)}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Paciente</th>
        <th>Status</th>
        <th>Origem</th>
        <th>Tratamento</th>
        <th>Agendamento</th>
        <th class="mono">Orçamento</th>
        <th class="mono">Pago</th>
        <th class="mono">Em aberto</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows || `<tr><td colspan="8" class="muted">Sem leads no filtro atual.</td></tr>`}
    </tbody>
  </table>

  <div class="footer muted">Dica: ao imprimir, selecione “Salvar como PDF”.</div>

<script>window.onload=()=>{ setTimeout(()=>window.print(), 250); };<\/script>

<div id="chartTooltip" aria-hidden="true"></div>

<div id="kpiModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modalInner" style="max-width:720px">
    <div class="modalHeader">
      <div>
        <div class="muted" style="font-size:12px">KPIs</div>
        <div id="kpiModalTitle" style="font-size:18px; font-weight:800">Detalhes</div>
      </div>
      <button class="btn" id="kpiModalClose">Fechar</button>
    </div>
    <div class="modalBody" style="padding-top:10px">
      <div class="muted" id="kpiModalSub" style="margin-bottom:10px"></div>
      <div id="kpiModalList" class="stack" style="gap:10px"></div>
    </div>
  </div>
</div>

</body>
</html>`;

  const w = window.open("", "_blank");
  if(!w) return toast("Popup bloqueado", "Permita popups pra gerar PDF.");
  w.document.open();
  w.document.write(htmlDoc);
  w.document.close();
  toast("PDF pronto ✅", title);
}

function csvSafe(s){
  const v = String(s??"").replaceAll('"','""');
  return `"${v}"`;
}

/* -------- Backup / Import -------- */
function exportJSON(){
  const actor = currentActor();
  if(actor && !canAccessView("settings", actor)) return toast("Sem permissão", "Seu nível não pode exportar backup.");
  const db = loadDB();
  const blob = new Blob([JSON.stringify(db,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cronoscrm_backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  toast("Backup exportado ✅");
}
function importJSON(file){
  const actor = currentActor();
  if(actor && !canAccessView("settings", actor)) return toast("Sem permissão", "Seu nível não pode importar backup.");
  const r = new FileReader();
  r.onload = async ()=>{
    try{
      const data = JSON.parse(r.result);
      if(!data || typeof data!=="object") throw new Error("invalid");
      if(!Array.isArray(data.masters) || !Array.isArray(data.entries)) throw new Error("invalid");
      saveDB(normalizeDBShape(data), { immediate:true });
      toast("Backup importado ✅", "Se a sessão estiver ativa, já sobe para a nuvem.");
      await boot();
    }catch(e){
      toast("Falha ao importar", "Arquivo inválido.");
    }
  };
  r.readAsText(file);
}
async function wipeAll(){
  const actor = currentActor();
  if(actor && !canAccessView("settings", actor)) return toast("Sem permissão", "Seu nível não pode zerar a base.");
  if(!confirm("Zerar TUDO? (usuários, leads, masters)")) return;
  const fresh = freshDB();
  try{
    const user = await getCurrentSupabaseUser();
    if(user) ensureMasterRecord(fresh, user);
  }catch(_){}
  saveDB(fresh, { immediate:true });
  localStorage.removeItem(FILTERKEY);
  clearSession();
  toast("Zerado 🧨");
  setTimeout(()=>location.reload(), 250);
}

/* -------- Render all -------- */

/* -------- Kanban -------- */
const KANBAN_COLUMNS = [
  {title:"Conversando", status:"Conversando"},
  {title:"Agendado", status:"Agendado"},
  {title:"Compareceu", status:"Compareceu"},
  {title:"Fechou", status:"Fechou"},
  {title:"Sem resposta", status:"Sem resposta"},
];

function renderKanban(){
  const actor = currentActor();
if(!actor) return;

const db = loadDB();
const board = el("kanbanBoard");
if(!board) return;

const rows = filteredEntries().slice(); // respects filters + month

function currentStatus(entry){
 if(!entry.statusLog || entry.statusLog.length === 0){
  return "Conversando";
 }
 return entry.statusLog[entry.statusLog.length - 1].to;
}

  const groups = new Map(KANBAN_COLUMNS.map(c=>[c.status, []]));
  rows.forEach(e=>{
    const s = currentStatus(e);
const key = groups.has(s) ? s : "Conversando";
    groups.get(key).push(e);
  });

  board.innerHTML = KANBAN_COLUMNS.map(col=>{
    const list = groups.get(col.status) || [];

const total = list.reduce((sum,e)=>{
  const budget = (e.valueBudget!=null && !isNaN(Number(e.valueBudget)))
    ? Number(e.valueBudget)
    : 0;
  return sum + budget;
},0);

    return `
      <div class="kanCol" data-kan-status="${escapeHTML(col.status)}">
        <div class="kanHead">
          <b>${escapeHTML(col.title)}</b>
          <span class="pill">${list.length}</span>
<span class="pill" style="margin-left:6px">
  R$ ${total.toLocaleString("pt-BR")}
</span>
        </div>
        <div class="kanList" data-dropzone="${escapeHTML(col.status)}">
          ${list.length ? list
            .sort((a,b)=>(b.lastUpdateAt||"").localeCompare(a.lastUpdateAt||""))
            .map(e=>{
              const c = db.contacts.find(x=>x.id===e.contactId);
              const paid = (e.valuePaid!=null && !isNaN(Number(e.valuePaid))) ? Number(e.valuePaid) : 0;
              const budget = (e.valueBudget!=null && !isNaN(Number(e.valueBudget))) ? Number(e.valueBudget) : 0;
              const open = Math.max(0, budget - paid);
              const apptDateRaw = (e.apptDate || e.agendamentoData || e.appointmentDate || "").toString().trim();
              const apptTimeRaw = (e.apptTime || e.agendamentoHora || e.appointmentTime || "").toString().trim();
              const apptLabel = `${apptDateRaw ? fmtBR(apptDateRaw) : ""}${apptTimeRaw ? ` às ${apptTimeRaw}` : ""}`.trim() || "—";
              const showApptOnCard = ["Agendado","Remarcou"].includes(col.status);
              return `
                <div class="kanCard" draggable="true" data-entry="${e.id}">
                  <div style="display:flex; justify-content:space-between; gap:10px">
                    <div>
                      <div style="font-weight:900">${escapeHTML(c?.name||"—")}</div>
                      <div class="muted" style="font-size:12px; margin-top:2px">${escapeHTML(c?.phone||"—")}</div>
                      <div class="muted" style="font-size:12px; margin-top:6px">${escapeHTML(e.treatment||"—")} • ${escapeHTML(e.origin||"—")}</div>
                      ${showApptOnCard ? `<div class="muted mono" style="font-size:12px; margin-top:6px">Agendamento: <b>${escapeHTML(apptLabel)}</b></div>` : ""}
                      ${(budget||paid)?`<div class="muted mono" style="font-size:12px; margin-top:6px">Pago: <b>${moneyBR(paid)}</b> • Em aberto: <b>${moneyBR(open)}</b></div>`:""}
                    </div>
                    <div style="display:flex; flex-direction:column; gap:8px; align-items:flex-end">
                      <button class="miniBtn" onclick="openLeadEntry('${e.id}')">Abrir</button>
                      <button class="miniBtn" onclick="printLeadEntry('${e.id}')">🖨️</button>
                    </div>
                  </div>
                </div>
              `;
            }).join("")
          : `<div class="muted" style="font-size:13px">—</div>`}
        </div>
      </div>
    `;
  }).join("");

  window.__KANBAN_DRAG_ID = null;

  qsa(".kanCard", board).forEach(card=>{
    const id = card.dataset.entry;

    card.addEventListener("dragstart", (ev)=>{
      window.__KANBAN_DRAG_ID = id;
      try{
        if(ev.dataTransfer){
          ev.dataTransfer.effectAllowed = "move";
          ev.dataTransfer.setData("text/plain", id);
        }
      }catch(e){}
      setTimeout(()=>card.classList.add("kanDragging"), 0);
    });

    card.addEventListener("dragend", ()=>{
      card.classList.remove("kanDragging");
      window.__KANBAN_DRAG_ID = null;
      qsa(".kanDropHint", board).forEach(x=>x.classList.remove("kanDropHint"));
    });

    card.addEventListener("pointerdown", (ev)=>{
      if(ev.pointerType === "mouse") return;
      const t = ev.target;
      if(t && (t.tagName === "BUTTON" || t.closest("button"))) return;
      window.__KANBAN_DRAG_ID = id;
      qsa(".kanCard", board).forEach(c=>c.classList.remove("kanSelected"));
      card.classList.add("kanSelected");
      toast("Toque na coluna para mover");
    });
  });

  function kanbanMoveTo(status){
    const entryId = window.__KANBAN_DRAG_ID;
    window.__KANBAN_DRAG_ID = null;
    qsa(".kanCard", board).forEach(c=>c.classList.remove("kanSelected"));
    if(entryId && status){
  quickUpdateStatus(entryId, status);

  setTimeout(() => {
    renderKanban();
  }, 50);
}
  }

  qsa("[data-dropzone], .kanCol", board).forEach(zone=>{
    const status = zone.dataset.dropzone || zone.dataset.kanStatus;

    zone.addEventListener("dragover", (ev)=>{
      ev.preventDefault();
      zone.classList.add("kanDropHint");
    });

    zone.addEventListener("dragleave", ()=>zone.classList.remove("kanDropHint"));

    zone.addEventListener("drop", (ev)=>{
      ev.preventDefault();
      zone.classList.remove("kanDropHint");

      let entryId = null;
      try{
        entryId = ev.dataTransfer && ev.dataTransfer.getData("text/plain");
      }catch(e){}

      if(entryId) window.__KANBAN_DRAG_ID = entryId;
      kanbanMoveTo(status);
    });

    zone.addEventListener("click", ()=>{
      if(window.__KANBAN_DRAG_ID) kanbanMoveTo(status);
    });
  });


  function quickUpdateStatus(entryId, newStatus){
  const actor = currentActor();
  if(!actor?.perms?.edit) return toast("Sem permissão para editar");
  const db = loadDB();
  const e = db.entries.find(x=>x.id===entryId);
  if(!e) return;
  const old = e.status;
  if(old===newStatus) return;
  e.status = newStatus;
  e.lastUpdateAt = todayISO();
  e.statusLog = e.statusLog || [];
  e.statusLog.push({at: new Date().toISOString(), from: old, to: newStatus, by: actor.name});
  saveDB(db);
  renderAll();
}

}

/* -------- Tasks -------- */
const TASK_ACTIONS = ["Ligar","WhatsApp","Enviar orçamento","Confirmar agendamento","Follow-up","Outros"];

function taskStatusLabel(t){
  const due = t.dueDate ? new Date(t.dueDate+"T00:00:00") : null;
  const today = new Date(new Date().toISOString().slice(0,10)+"T00:00:00");
  const overdue = due && due < today && !t.done;
 if(overdue) return `<span class="chip"><span class="dot hot"></span>Atrasado</span>`;
if(t.done) return `<span class="chip"><span class="dot ok"></span>Feito</span>`;
return `<span class="chip"><span class="dot warm"></span>Pendente</span>`;
}

function renderTasks(){
  const actor = currentActor();
  if(!actor) return;
  const db = loadDB();
  syncInstallmentTasks(db, actor);
  saveDB(db, { skipCloud:true });

  const tbody = el("tasksTbody");
  if(!tbody) return;

  const monthEl = el("taskMonth");
  const searchEl = el("taskSearch");
  const filterEl = el("taskFilter");

  const currentMonth = new Date().toISOString().slice(0,7);

  if(monthEl && !monthEl.value){
    monthEl.value = currentMonth;
  }

  [monthEl, searchEl, filterEl].forEach(ctrl => {
    if(ctrl && !ctrl.dataset.bound){
      ctrl.addEventListener(
        ctrl.tagName === "INPUT" && ctrl.type === "text" ? "input" : "change",
        () => renderTasks()
      );
      ctrl.dataset.bound = "1";
    }
  });

  const taskMonth = monthEl?.value || currentMonth;
  const taskSearch = (searchEl?.value || "").trim().toLowerCase();
  const taskFilter = filterEl?.value || "Todos";

  function normTaskFilter(v){
    return String(v || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/_/g, " ")
      .trim();
  }

  const taskFilterNorm = normTaskFilter(taskFilter);
  const filterTextNorm = normTaskFilter(filterEl?.selectedOptions?.[0]?.textContent || "");

  const isTodosFilter = taskFilter === "Todos" || taskFilterNorm === "todos" || filterTextNorm === "todos";
  const isAllOpenFilter =
    taskFilter === "PendentesEAtraso" ||
    taskFilterNorm === "pendentes e atraso" ||
    taskFilterNorm === "pendentes e em atraso" ||
    filterTextNorm === "pendentes e atraso" ||
    filterTextNorm === "pendentes e em atraso" ||
    taskFilterNorm.includes("pendentes") && taskFilterNorm.includes("atraso") ||
    filterTextNorm.includes("pendentes") && filterTextNorm.includes("atraso") ||
    taskFilterNorm.includes("abert") ||
    filterTextNorm.includes("abert");

  const isLateFilter = !isAllOpenFilter && (
    taskFilter === "Atrasado" ||
    taskFilterNorm.includes("atrasad") ||
    filterTextNorm.includes("atrasad")
  );

  const isPendingFilter = !isAllOpenFilter && (
    taskFilter === "Pendente" ||
    taskFilterNorm === "pendente" ||
    taskFilterNorm === "pendentes" ||
    filterTextNorm === "pendente" ||
    filterTextNorm === "pendentes"
  );

  const isDoneFilter = (
    taskFilter === "Feito" ||
    taskFilterNorm.includes("feito") ||
    filterTextNorm.includes("feito")
  );

  const allStatusMode = isTodosFilter;
  const allOpenMode = isAllOpenFilter;

  const today = new Date(new Date().toISOString().slice(0,10)+"T00:00:00");

  const tasks = (db.tasks||[])
    .filter(t => !t.masterId || t.masterId === actor.masterId)
    .filter(t => {
      if(allOpenMode) return t.done !== true;
      if(!taskMonth) return true;
      return String(t.dueDate || "").slice(0,7) === taskMonth;
    })
    .filter(t => {
      const e = db.entries.find(x => x.id === t.entryId);
      const c = e ? db.contacts.find(x => x.id === e.contactId) : null;
      const hay = `${c?.name || ""} ${c?.phone || ""}`.toLowerCase();
      return !taskSearch || hay.includes(taskSearch);
    })
    .filter(t => {
      const due = t.dueDate ? new Date(t.dueDate+"T00:00:00") : null;
      const overdue = due && due < today && !t.done;
      const pending = !t.done && !overdue;

      if(isAllOpenFilter) return t.done !== true;
      if(isLateFilter) return !!overdue;
      if(isPendingFilter) return !!pending;
      if(isDoneFilter) return !!t.done;
      return true;
    })
    .sort((a,b)=> {
      const aDue = String(a.dueDate||"9999-12-31");
      const bDue = String(b.dueDate||"9999-12-31");

      if(allStatusMode || allOpenMode){
        const aDate = a.dueDate ? new Date(a.dueDate+"T00:00:00") : null;
        const bDate = b.dueDate ? new Date(b.dueDate+"T00:00:00") : null;

        const rank = (t, d)=>{
          const overdue = d && d < today && t.done !== true;
          if(overdue) return 0;
          if(t.done === true) return allStatusMode ? 2 : 1;
          return 1;
        };

        const ar = rank(a, aDate);
        const br = rank(b, bDate);
        if(ar !== br) return ar - br;
      }

      return aDue.localeCompare(bDue);
    });

  if(!tasks.length){
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Nenhuma tarefa encontrada para este filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = tasks.map(t=>{
  const e = db.entries.find(x=>x.id===t.entryId);
  const c = e ? db.contacts.find(x=>x.id===e.contactId) : null;
  const due = t.dueDate ? new Date(t.dueDate+"T00:00:00") : null;
  const overdue = due && due < today && !t.done;
  const cls = t.done ? "taskOk" : (overdue ? "taskBad" : "");
  return `
    <tr class="${cls}">
      <td class="nowrap">${taskStatusLabel(t)}</td>
      <td><b>${escapeHTML(t.title||"—")}</b><div class="muted" style="font-size:12px">${escapeHTML(t.action||"")}</div></td>
      <td>${escapeHTML(c?.name||"—")}<div class="muted" style="font-size:12px">${escapeHTML(c?.phone||"")}</div></td>
      <td class="nowrap">${t.dueDate?fmtBR(t.dueDate):"—"}</td>
      <td>${escapeHTML(t.notes||"")}</td>
      <td>
        <div class="taskActionsCell">
          <div class="taskActionsRow">
            <button class="miniBtn" onclick="openTaskEdit('${t.id}')" title="Editar">✏️</button>
            ${`<button class="miniBtn ok" onclick="toggleTaskDone(\'${t.id}\')" title="${t.done?'Reabrir':'Concluir'}">${t.done?'↩️':'✔️'}</button>`}
          </div>
          ${e?`<button class="miniBtn taskOpenLead" onclick="openLeadEntry('${e.id}')">Abrir lead</button>`:""}
        </div>
      </td>
    </tr>
  `;
}).join("");
}

function openNewTask(){
  const actor = currentActor();
  if(!actor) return;
  if(!actor.perms.edit || !canAccessView("tasks", actor)) return toast("Sem permissão", "Seu nível não pode criar tarefas.");
  const db = loadDB();
  const monthKey = val("fMonth") || new Date().toISOString().slice(0,7);

  const entries = filteredEntries();
  const opts = entries.map(e=>{
    const c = db.contacts.find(x=>x.id===e.contactId);
    return `<option value="${e.id}">${escapeHTML(c?.name||"—")} • ${escapeHTML(c?.phone||"")}</option>`;
  }).join("");

  openModal({
    title:"Nova tarefa",
    sub:"Crie um follow-up com vencimento. O mês do filtro é usado como referência.",
    bodyHTML: `
      <div class="twoCol">
        <div>
          <label>Lead *</label>
          <select id="tf_entry">${opts || `<option value="">(Sem leads no filtro)</option>`}</select>
        </div>
        <div>
          <label>Vencimento *</label>
          <input id="tf_due" type="date" value="${todayISO()}"/>
        </div>
        <div style="grid-column:1/-1">
          <label>Tarefa *</label>
          <input id="tf_title" placeholder="Ex: Ligar e passar valor do orçamento"/>
        </div>
        <div>
          <label>Ação</label>
          <select id="tf_action">${TASK_ACTIONS.map(a=>`<option value="${a}">${a}</option>`).join("")}</select>
        </div>
        <div style="grid-column:1/-1">
          <label>Obs</label>
          <textarea id="tf_notes" placeholder="Contexto, detalhes, objeções..."></textarea>
        </div>
      </div>
    `,
    footHTML: `
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn ok" id="btnSaveTask">Salvar</button>
    `,
    onMount: ()=>{
      const btn = el("btnSaveTask");
      btn.addEventListener("click", ()=>{
        const entryId = val("tf_entry");
        const dueDate = val("tf_due");
        const title = val("tf_title").trim();
        const action = val("tf_action");
        const notes = val("tf_notes").trim();
        if(!entryId) return toast("Selecione um lead");
        if(!dueDate) return toast("Informe o vencimento");
        if(!title) return toast("Informe a tarefa");

        const t = {id: uid("task"), masterId: actor.masterId, entryId, dueDate, title, action, notes, done:false, createdAt:new Date().toISOString()};
        db.tasks = db.tasks || [];
        db.tasks.push(t);
        saveDB(db);
        closeModal();
        toast("Tarefa criada");
        renderAll();
      });
    }
  });
}

function openTaskEdit(taskId){
  const actor = currentActor();
  const db = loadDB();
  const t = (db.tasks||[]).find(x=>x.id===taskId);
  if(!t) return toast("Tarefa não encontrada");
  const entry = db.entries.find(e=>e.id===t.entryId);
  const c = entry ? db.contacts.find(x=>x.id===entry.contactId) : null;

  openModal({
    title:"Editar tarefa",
    sub:`Lead: ${c?.name||"—"}`,
    bodyHTML: `
      <div class="twoCol">
        <div>
          <label>Vencimento</label>
          <input id="tf_due" type="date" value="${escapeHTML(t.dueDate||"")}"/>
        </div>
        <div>
          <label>Status</label>
          <select id="tf_done">
            <option value="0" ${t.done?"":"selected"}>Pendente</option>
            <option value="1" ${t.done?"selected":""}>Feito</option>
          </select>
        </div>
        <div style="grid-column:1/-1">
          <label>Tarefa</label>
          <input id="tf_title" value="${escapeHTML(t.title||"")}"/>
        </div>
        <div>
          <label>Ação</label>
          <select id="tf_action">${TASK_ACTIONS.map(a=>`<option value="${a}" ${(t.action===a)?"selected":""}>${a}</option>`).join("")}</select>
        </div>
        <div style="grid-column:1/-1">
          <label>Obs</label>
          <textarea id="tf_notes">${escapeHTML(t.notes||"")}</textarea>
        </div>
      </div>
    `,
    footHTML: `
      <button class="btn" onclick="closeModal()">Fechar</button>
      <button class="btn ok" id="btnSaveTask">Salvar</button>
    `,
    onMount: ()=>{
      el("btnSaveTask").addEventListener("click", ()=>{
        t.dueDate = val("tf_due");
        t.done = el("tf_done").value ==="1";
        t.title = val("tf_title").trim();
        t.action = val("tf_action");
        t.notes = val("tf_notes").trim();
        saveDB(db);
        closeModal();
        toast("Tarefa atualizada");
        renderAll();
      });
    }
  });
}

function toggleTaskDone(taskId){
  const db = loadDB();
  const t = (db.tasks||[]).find(x=>x.id===taskId);
  if(!t) return;

  if (t.key && t.key.startsWith("INST:")) {
    return toast("Aviso", "Essa tarefa é automática e vinculada ao recebimento.");
  }
  t.done = !t.done;
  saveDB(db);
  toast(t.done ? "Tarefa marcada como feita" : "Tarefa reaberta");
 if (typeof renderTasks === "function") renderTasks();
  if (typeof updateSidebarPills === "function") updateSidebarPills();
}
function markTaskDone(taskId){ return toggleTaskDone(taskId); }
function deleteTask(taskId){
  return toast("Exclusão bloqueada", "As tarefas não podem mais ser apagadas. Use editar, concluir ou reabrir.");
}

function renderAll(){
 setTimeout(() => {
  updateSidebarPills();
  renderInstallmentsView();
}, 100);
  renderDashboard();
  renderLeadsTable(filteredEntries());
renderKanban();
  renderTasks();
  renderUsers();
  renderSettings();
}

/* -------- Boot & bindings -------- */
function bindNav(){
  if(window.__navBound) return;
  window.__navBound = true;

  qsa(".nav button").forEach(b=>{
    b.addEventListener("click", ()=>setActiveView(b.dataset.view));
  });

const bKan = el("btnNewLeadKanban"); if(bKan) bKan.addEventListener("click", openNewLead);
const bTask = el("btnNewTask"); if(bTask) bTask.addEventListener("click", openNewTask);

  const instMonth = el("instMonth");
  const instSearch = el("instSearch");
  const instFilter = el("instFilter");
  const instRefresh = el("btnInstRefresh");
  const instNew = el("btnNewFinancialInstallment");
  if(instMonth) instMonth.addEventListener("change", renderInstallmentsView);
  if(instSearch) instSearch.addEventListener("input", debounce(renderInstallmentsView, 150));
  if(instFilter) instFilter.addEventListener("change", renderInstallmentsView);
  if(instRefresh) instRefresh.addEventListener("click", ()=>runManualCloudRefresh(instRefresh, { installmentsOnly:true }));
  if(instNew) instNew.addEventListener("click", ()=>openNewFinancialInstallment());
  setTimeout(() => {
  relabelInstallmentsToRecebimentos();
  renderInstallmentsView();
  updateSidebarPills();
}, 50);

}
function bindActions(){
  el("btnLogout").onclick = async ()=>{
    try{ if(typeof supabaseClient !== "undefined" && supabaseClient?.auth) await supabaseClient.auth.signOut(); }catch(_){}
    DB = null;
    resetCloudContext();
    clearSupportContext();
    clearClinicAccessState();
    clearSession();
    toast("Saiu");
    showAuth();
  };
  const btnGateLogout = el("btnGateLogout");
  if(btnGateLogout) btnGateLogout.onclick = async ()=>{
    try{ if(typeof supabaseClient !== "undefined" && supabaseClient?.auth) await supabaseClient.auth.signOut(); }catch(_){}
    DB = null;
    resetCloudContext();
    clearSupportContext();
    clearClinicAccessState();
    clearSession();
    showAuth();
  };
  const btnCloseAccessNotice = el("btnCloseAccessNotice");
  if(btnCloseAccessNotice) btnCloseAccessNotice.onclick = hideAccessNotice;
  const btnAccessNoticeContinue = el("btnAccessNoticeContinue");
  if(btnAccessNoticeContinue) btnAccessNoticeContinue.onclick = hideAccessNotice;
  const btnExitSupport = el("btnExitSupport");
  if(btnExitSupport) btnExitSupport.onclick = ()=>{
    clearSupportContext();
    clearClinicAccessState();
    DB = null;
    resetCloudContext();
    clearSession();
    toast("Modo suporte encerrado");
    window.location.href = "/superadmin/";
  };
  const btnRefreshNow = el("btnRefreshNow");
  if(btnRefreshNow) btnRefreshNow.onclick = ()=>runManualCloudRefresh(btnRefreshNow);
  el("btnNewLeadSide").onclick = openNewLead;
  el("btnNewLeadTop").onclick = openNewLead;
  el("btnNewLeadList").onclick = openNewLead;

  el("themeToggle").onclick = toggleTheme;
  el("themeToggleAuth").onclick = toggleTheme;

  const passToggle = el("authPassToggle");
  const passInput = el("authPass");
  if(passToggle && passInput){
    const eyeOpen = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>';
    const eyeOff = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 3l18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10.58 10.58A2 2 0 0012 16a2 2 0 001.42-.58" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.88 5.09A10.94 10.94 0 0112 5c6.5 0 10.5 7 10.5 7a21.76 21.76 0 01-4.13 4.77" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.61 6.61C3.73 8.55 1.5 12 1.5 12A21.78 21.78 0 006.27 16.87" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const syncPassIcon = ()=>{
      const hidden = passInput.type === 'password';
      passToggle.innerHTML = hidden ? eyeOpen : eyeOff;
      passToggle.setAttribute('aria-label', hidden ? 'Mostrar senha' : 'Ocultar senha');
      passToggle.setAttribute('title', hidden ? 'Mostrar senha' : 'Ocultar senha');
    };
    syncPassIcon();
    passToggle.addEventListener('click', ()=>{
      passInput.type = passInput.type === 'password' ? 'text' : 'password';
      syncPassIcon();
      try{ passInput.focus({preventScroll:true}); }catch(_){ passInput.focus(); }
      const end = String(passInput.value || '').length;
      try{ passInput.setSelectionRange(end, end); }catch(_){ }
    });
  }

  el("btnClearFilters").onclick = ()=>{
    const f = loadFilters();
    f.search=""; f.status=""; f.campaign=""; f.treatment=""; f.origin=""; f.periodFrom=""; f.periodTo=""; f.order="recent";
    saveFilters(f);
    setUIFilters(f);
    currentPage = 1;
    renderAll();
  };

  el("btnExportCSV").onclick = exportCSV;
  el("btnExportPDF").onclick = exportPDFFiltered;
  const btnChangeMyPassword = el("btnChangeMyPassword");
  if(btnChangeMyPassword) btnChangeMyPassword.onclick = openChangeMyPassword;
  const btnMyPasswordSide = el("btnMyPasswordSide");
  if(btnMyPasswordSide) btnMyPasswordSide.onclick = openChangeMyPassword;

  ["fYear","fMonth","fSearch","fStatus","fCampaign","fTreatment","fOrigin","fPeriodFrom","fPeriodTo","fOrder"].forEach(id=>{
    el(id).addEventListener("input", ()=>{
      const f = getUIFilters();
      if(id === "fSearch" && String(f.search || "").trim()){
        window.__KPI_ACTIVE = null;
      }
      saveFilters(f);
      currentPage = 1;
      renderAll();
    });
    el(id).addEventListener("change", ()=>{
      const f = getUIFilters();
      if(id === "fSearch" && String(f.search || "").trim()){
        window.__KPI_ACTIVE = null;
      }
      saveFilters(f);
      if(id==="fYear"){
        ensureMonthOptions();
      }
      saveFilters(getUIFilters());
      currentPage = 1;
      renderAll();
    });
  });

  el("btnNewUser").onclick = openNewUser;

  el("btnBackup").onclick = exportJSON;
  el("fileImport").addEventListener("change", (e)=>{
    const f = e.target.files?.[0]; if(f) importJSON(f);
    e.target.value="";
  });
  const dbInitPrefs = loadDB();
  if(el("waTemplate")) el("waTemplate").value = (dbInitPrefs.settings && dbInitPrefs.settings.waTemplate) ? String(dbInitPrefs.settings.waTemplate) : "";
  if(el("waChargeTemplate")) el("waChargeTemplate").value = (dbInitPrefs.settings && dbInitPrefs.settings.waChargeTemplate) ? String(dbInitPrefs.settings.waChargeTemplate) : "";
  const btnClinicIdentity = el("btnSaveClinicIdentity");
  if(btnClinicIdentity) btnClinicIdentity.onclick = ()=>{
    const actor = currentActor();
    if(actor && !canAccessView("settings", actor)) return toast("Sem permissão", "Seu nível não pode alterar configurações.");
    if(!(actor && actor.kind === "master")) return toast("Sem permissão", "Só o master principal pode alterar a identidade da clínica.");
    const db = loadDB();
    const master = db.masters.find(m=>m.id===actor.masterId);
    const clinicDisplayName = String(val("clinicDisplayName") || "").trim();
    if(!clinicDisplayName) return toast("Nome da clínica", "Digite um nome para a clínica antes de salvar.");
    if(master){
      master.name = clinicDisplayName;
      saveDB(db);
      try{
        const actorNow = currentActor();
        if(actorNow) showApp(actorNow);
        renderUsers();
      }catch(_){}
      const hint = el("clinicIdentitySavedHint");
      if(hint){ hint.textContent = "Identidade salva."; setTimeout(()=>hint.textContent="", 2200); }
      toast("Identidade da clínica salva.");
    }
  };

  const btnPrefs = el("btnSavePrefs");
  if(btnPrefs) btnPrefs.onclick = ()=>{
    const actor = currentActor();
    if(actor && !canAccessView("settings", actor)) return toast("Sem permissão", "Seu nível não pode alterar configurações.");
    const db = loadDB();
    if(!db.settings) db.settings = {};
    db.settings.waTemplate = (val("waTemplate")||"").trim();

    saveDB(db);
    try{
      const actorNow = currentActor();
      if(actorNow) showApp(actorNow);
      renderUsers();
    }catch(_){}
    const hint = el("prefsSavedHint");
    if(hint){ hint.textContent = "Mensagem salva."; setTimeout(()=>hint.textContent="", 2000); }
    toast("Preferência de mensagem salva.");
  };

  const taCharge = el("waChargeTemplate");
  const hintCharge = el("chargeTplSaved");
  const btnSaveCharge = el("btnSaveChargeTpl");
  const btnResetCharge = el("btnResetChargeTpl");
  try{
    const db0 = loadDB();
    if(taCharge){
      taCharge.value = (db0.settings && db0.settings.waChargeTemplate) ? String(db0.settings.waChargeTemplate) : "";
    }
  }catch(e){}
  if(btnSaveCharge) btnSaveCharge.onclick = ()=>{
    const db = loadDB();
    if(!db.settings) db.settings = {};
    db.settings.waChargeTemplate = (val("waChargeTemplate")||"").trim();
    saveDB(db);
    if(hintCharge){ hintCharge.textContent = "Salvo."; setTimeout(()=>hintCharge.textContent="", 2000); }
    toast("Cobrança salva.");
  };
  if(btnResetCharge) btnResetCharge.onclick = ()=>{
    const db = loadDB();
    if(!db.settings) db.settings = {};
    db.settings.waChargeTemplate = "";
    saveDB(db);
    if(taCharge) taCharge.value = "";
    if(hintCharge){ hintCharge.textContent = "Padrão restaurado."; setTimeout(()=>hintCharge.textContent="", 2000); }
    toast("Padrão restaurado.");
  };
}

function bindAuth(){ 
  el("authMode").addEventListener("change", ()=>{
    const mode = val("authMode");
    const sel = el("authMasterSelect");
    const wrap = el("authMasterNameWrap");
    if(mode==="master"){
      if(sel) sel.disabled = true;
      if(wrap) wrap.classList.remove("hidden");
      el("authLogin").placeholder = "E-mail do Master";
    }else{
      if(sel) sel.disabled = true;
      if(wrap) wrap.classList.add("hidden");
      el("authLogin").placeholder = "Usuário ou e-mail do usuário";
    }
  });

  el("btnLogin").addEventListener("click", async ()=>{
    if(window.__SUPABASE_CLOUD_LOGIN__) return;
  });
}
function renderAll(){
  setTimeout(() => {
    try{ updateSidebarPills(); }catch(_){ }
    try{ renderInstallmentsView(); }catch(_){ }
  }, 100);

  try{ renderDashboard(); }catch(_){ }
  try{ renderLeadsTable(filteredEntries()); }catch(_){ }
  try{ renderKanban(); }catch(_){ }
  try{ renderTasks(); }catch(_){ }
  try{ renderUsers(); }catch(_){ }
  try{ renderSettings(); }catch(_){ }
}
  async function syncMasterUser(){
  return syncCurrentCloudActor();
}

async function boot(){
  window.__CRONOS_BOOTING__ = true;
  window.__CRONOS_SESSION_CHECKING__ = true;
  const supportTokenPresent = new URLSearchParams(location.search).has("support_token");

  if(supportTokenPresent || isSupportMode()){
    setSupportEntryLoading(true, "Modo suporte • Validando acesso e carregando a clínica...");
  }

  try{
    await maybeInitSupportMode();
  }catch(error){
    console.error("Falha ao iniciar suporte:", error);

    const supportCtx = getSupportContext();

    if(!supportCtx && !supportTokenPresent){
      clearSupportContext();
      toast("Falha no suporte", error?.message || "Não foi possível validar o acesso de suporte.");
    }
  }

  await ensureCloudDBLoaded();
  await syncCurrentCloudActor();

  fillSelectOptions();

  const f = loadFilters();
  ensureYearOptions();
  setUIFilters(f);
  ensureMonthOptions();

  try{ const db=loadDB(); if(migrateDBValues(db)) saveDB(db); }catch(e){}

  saveFilters(getUIFilters());

  const actor = currentActor();

  if(!actor){
    if((supportTokenPresent || isSupportMode()) && (window.__SUPPORT_BOOT_RETRIES__ || 0) < 6){
      window.__SUPPORT_BOOT_RETRIES__ = (window.__SUPPORT_BOOT_RETRIES__ || 0) + 1;
      setTimeout(()=>boot(), 180);
      return;
    }

    window.__SUPPORT_BOOT_RETRIES__ = 0;
    showAuth();
    const authSelect = el("authMasterSelect");
    if (authSelect) authSelect.parentElement.classList.add("hidden");
    el("authMode").value = "master";
    if(window.__CRONOS_ACCESS_BLOCK__?.title){
      toast(window.__CRONOS_ACCESS_BLOCK__.title, window.__CRONOS_ACCESS_BLOCK__.message || "");
    }
    return;
  }

  window.__SUPPORT_BOOT_RETRIES__ = 0;

  const accessDecision = await applyClinicAccessRules();
  if(accessDecision?.mode && accessDecision.mode !== "allow"){
    return;
  }

  showApp(actor);
  applyRoleVisibility(actor);

  bindNav();
  setActiveView(firstAllowedView(actor));
}

/* One-time bindings */
(function init(){
  applyTheme(localStorage.getItem(THEMEKEY) || "dark");

  bindActions();
  bindAuth();
  bindLoginEnterSubmit();

  try{
    const auth = document.getElementById("authView");
    const app = document.getElementById("appView");
    if(auth) auth.classList.add("hidden");
    if(app) app.classList.add("hidden");
    showBootSplash("Sincronizando seu ambiente...");
  }catch(_){ }
})();

function setupLeadsTopScrollbar(){
  return; // desativado (sem scroll horizontal)
  const card = document.querySelector('.leadsTableWrap');
  if(!card) return;
  const wrap = card.querySelector('.tableWrap');
  const top = card.querySelector('.hscrollTop');
  const inner = card.querySelector('.hscrollTopInner');
  if(!wrap || !top || !inner) return;

  const table = wrap.querySelector('table');
  const width = table ? table.scrollWidth : wrap.scrollWidth;
  inner.style.width = Math.max(width, wrap.clientWidth) + 'px';

  if(!top.dataset.bound){
    top.dataset.bound = '1';
    top.addEventListener('scroll', ()=>{ if(wrap.scrollLeft !== top.scrollLeft) wrap.scrollLeft = top.scrollLeft; }, {passive:true});
    wrap.addEventListener('scroll', ()=>{ if(top.scrollLeft !== wrap.scrollLeft) top.scrollLeft = wrap.scrollLeft; }, {passive:true});
  }
  top.scrollLeft = wrap.scrollLeft;
}


(function(){
  function setupTopScroll(){
    const leadsView = document.getElementById('view-leads');
    if(!leadsView) return;
    const wrap = leadsView.querySelector('.tableWrap');
    const top = document.getElementById('leadsTopScroll');
    if(!wrap || !top) return;

    const inner = top.querySelector('.inner');
    const table = wrap.querySelector('table');
    if(!inner || !table) return;

    function refresh(){
      inner.style.width = table.scrollWidth + "px";
      top.scrollLeft = wrap.scrollLeft;
    }
    let lock=false;
    top.addEventListener('scroll', ()=>{ if(lock) return; lock=true; wrap.scrollLeft = top.scrollLeft; lock=false; });
    wrap.addEventListener('scroll', ()=>{ if(lock) return; lock=true; top.scrollLeft = wrap.scrollLeft; lock=false; });

    window.addEventListener('resize', refresh);
    const mo = new MutationObserver(()=>refresh());
    mo.observe(wrap, {childList:true, subtree:true});
    refresh();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupTopScroll);
  else setupTopScroll();
})();


/* =========================
   Tooltips (Canvas charts)
========================= */
function __ensureChartTooltip(){
  let tip = document.getElementById("chartTooltip");
  if(!tip){
    tip = document.createElement("div");
    tip.id = "chartTooltip";
    document.body.appendChild(tip);
  }
  return tip;
}
function __hideChartTooltip(){
  const tip = document.getElementById("chartTooltip");
  if(tip) tip.style.display = "none";
}
function __showChartTooltip(html, clientX, clientY){
  const tip = __ensureChartTooltip();
  tip.innerHTML = html;
  tip.style.left = clientX + "px";
  tip.style.top = clientY + "px";
  tip.style.display = "block";
}
function __bindChartHoverOnce(canvas){
  if(!canvas || canvas.__ttBound) return;
  canvas.__ttBound = true;

  const rel = (ev)=>{
    const r = canvas.getBoundingClientRect();
    return {x: ev.clientX - r.left, y: ev.clientY - r.top, r};
  };

  const pointIndexFromEvent = (ev, data)=>{
    const {x, y} = rel(ev);
    const {labels, pad, top, w, h} = data;
    const innerW = (w - pad - 10);
    if(x < pad || x > pad + innerW || y < top-10 || y > h-6) return -1;
    return Math.max(0, Math.min(labels.length-1, Math.round(((x - pad) / innerW) * Math.max(1, labels.length-1))));
  };

  canvas.addEventListener("mouseleave", ()=>__hideChartTooltip(), {passive:true});
  canvas.addEventListener("mousemove", (ev)=>{
    const data = canvas.__chartData;
    if(!data){ __hideChartTooltip(); return; }
    const {x, y} = rel(ev);

    if(data.type === "multiLine"){
      const {labels, series, pad, top, w, h} = data;
      const innerW = (w - pad - 10);
      if(x < pad || x > pad + innerW || y < top-6 || y > h-8){ __hideChartTooltip(); return; }
      const idx = Math.max(0, Math.min(labels.length-1, Math.round(((x - pad) / innerW) * Math.max(1, labels.length-1))));
      const labelPrefix = String(data.axisLabelPrefix || "Dia");
      const title = labels[idx] ? `${labelPrefix} ${labels[idx]}` : `Ponto ${idx+1}`;
      let body = `<div class="ttTitle">${title}</div>`;
      series.forEach(s=>{
        const v = (s.values && s.values[idx]!=null) ? s.values[idx] : 0;
        const rawPrefix = String(data.yPrefix || "");
        const val = rawPrefix.trim().replace(/\s+/g,"") === "R$" ? moneyBR(v) : (rawPrefix + moneyBR(v));
        body += `<div class="ttRow"><span style="display:flex; gap:8px; align-items:flex-start"><span class="ttDot" style="background:${s.color||'rgba(30,120,255,0.9)'}"></span><span>${escapeHTML(s.name||'')}</span></span><b>${val}</b></div>`;
        const details = Array.isArray(s.details?.[idx]) ? s.details[idx] : [];
        if((Number(v)||0) > 0 && details.length){
          body += `<div class="ttSources">`;
          details.slice(0,3).forEach(d=>{
            body += `<div class="ttSourceLine">• ${escapeHTML(d.patient || 'Sem paciente')} <b>${moneyBR(d.value||0)}</b></div>`;
          });
          if(details.length > 3) body += `<div class="ttSourceMore">+ ${details.length-3} lançamento(s)</div>`;
          body += `</div>`;
        }
      });
      body += `<div class="ttHint">Clique para ver a origem completa</div>`;
      __showChartTooltip(body, ev.clientX, ev.clientY);
      return;
    }

    if(data.type === "bar"){
      const hit = (data.rects||[]).find(rc => x>=rc.x && x<=rc.x+rc.w && y>=rc.y && y<=rc.y+rc.h);
      if(!hit){ __hideChartTooltip(); return; }
      const title = escapeHTML(hit.label||"");
      const body = `<div class="ttTitle">${title}</div><div class="ttRow"><span>Qtd</span><b>${hit.value||0}</b></div>`;
      __showChartTooltip(body, ev.clientX, ev.clientY);
      return;
    }
  }, {passive:true});

  canvas.addEventListener("click", (ev)=>{
    const data = canvas.__chartData;
    if(!data || data.type !== "multiLine") return;
    const idx = pointIndexFromEvent(ev, data);
    if(idx < 0) return;
    __openChartPointDetails(data, idx);
  });
}

function __openChartPointDetails(data, idx){
  try{
    const labelPrefix = String(data?.axisLabelPrefix || "Dia");
    const label = data?.labels?.[idx] ? `${labelPrefix} ${data.labels[idx]}` : `Ponto ${idx+1}`;
    const rows = [];
    (data?.series||[]).forEach(s=>{
      const details = Array.isArray(s.details?.[idx]) ? s.details[idx] : [];
      details.forEach(d=>{
        rows.push({
          serie: s.name || "",
          patient: d.patient || "Sem paciente vinculado",
          value: Number(d.value||0),
          desc: d.desc || "—",
          method: d.method || "—",
          date: d.iso || ""
        });
      });
    });

    const total = rows.reduce((sum,r)=>sum + (Number(r.value)||0), 0);

    if(!rows.length){
      const bodyHTML = `<div class="muted">Nenhum lançamento identificado para este ponto. Se aparece valor e não aparece origem, é sinal de dado legado incompleto.</div>`;
      if(typeof openModal === "function"){
        openModal({
          title: `Origem do gráfico — ${label}`,
          sub: "Auditoria rápida da receita/orçamento.",
          bodyHTML,
          footHTML: `<button class="btn" onclick="closeModal()">Fechar</button>`,
          maxWidth: "920px"
        });
      }else{
        toast("Origem do gráfico", "Nenhum lançamento identificado.");
      }
      return;
    }

    const pageSize = 12;
    let page = 1;
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

    const renderPage = ()=>{
      const host = document.getElementById("chartPointDetailsHost");
      if(!host) return;
      page = Math.max(1, Math.min(totalPages, page));
      const start = (page-1) * pageSize;
      const slice = rows.slice(start, start + pageSize);
      host.innerHTML = `
        <div class="muted" style="margin-bottom:10px">Esses são os lançamentos que formam este ponto do gráfico.</div>
        <div class="tableWrap"><table class="table"><thead><tr><th>Tipo</th><th>Paciente</th><th>Origem</th><th>Data</th><th class="right">Valor</th></tr></thead><tbody>
          ${slice.map(r=>{
            const methodLine = r.method && r.method !== "—" ? `<div class="muted" style="font-size:11px">${escapeHTML(r.method)}</div>` : "";
            return `<tr><td>${escapeHTML(r.serie)}</td><td><b>${escapeHTML(r.patient)}</b></td><td>${escapeHTML(r.desc)}${methodLine}</td><td>${escapeHTML(r.date ? fmtBR(r.date) : "—")}</td><td class="right mono">${moneyBR(r.value)}</td></tr>`;
          }).join("") }
        </tbody></table></div>
        <div style="display:flex; flex-wrap:wrap; gap:10px; justify-content:space-between; align-items:center; margin-top:10px">
          <span class="muted">Mostrando ${start+1}–${Math.min(rows.length, start + pageSize)} de ${rows.length} lançamento(s)</span>
          <b>Total do ponto: ${moneyBR(total)}</b>
        </div>
      `;
      const pageLabel = document.getElementById("chartOriginPageLabel");
      const prev = document.getElementById("chartOriginPrev");
      const next = document.getElementById("chartOriginNext");
      if(pageLabel) pageLabel.textContent = `Página ${page} de ${totalPages}`;
      if(prev) prev.disabled = page <= 1;
      if(next) next.disabled = page >= totalPages;
    };

    if(typeof openModal === "function"){
      const needsPagination = rows.length > pageSize;
      openModal({
        title: `Origem do gráfico — ${label}`,
        sub: "Auditoria rápida da receita/orçamento.",
        bodyHTML: `<div id="chartPointDetailsHost"></div>`,
        footHTML: `
          <div style="display:flex; gap:8px; align-items:center; justify-content:space-between; width:100%; flex-wrap:wrap">
            <div style="display:${needsPagination ? "flex" : "none"}; gap:8px; align-items:center">
              <button class="btn small" id="chartOriginPrev" type="button">Anterior</button>
              <span class="muted" id="chartOriginPageLabel">Página 1 de ${totalPages}</span>
              <button class="btn small" id="chartOriginNext" type="button">Próxima</button>
            </div>
            <button class="btn" onclick="closeModal()">Fechar</button>
          </div>
        `,
        maxWidth: "980px",
        onMount: ()=>{
          renderPage();
          const prev = document.getElementById("chartOriginPrev");
          const next = document.getElementById("chartOriginNext");
          if(prev) prev.onclick = ()=>{ page -= 1; renderPage(); };
          if(next) next.onclick = ()=>{ page += 1; renderPage(); };
        }
      });
    }else{
      toast("Origem do gráfico", rows.length ? `${rows.length} lançamento(s) • ${moneyBR(total)}` : "Nenhum lançamento identificado.");
    }
  }catch(err){
    console.warn("Falha ao abrir origem do gráfico", err);
    toast("Não consegui abrir a origem", "Tente passar o mouse no ponto ou recarregar a tela.");
  }
}


/* helper */
function escapeHTML(str){
  return String(str??"").replace(/[&<>"']/g, (m)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

/* =========================
   KPI click → modal (lista de leads)
========================= */
const KPI_RULES = {
  positive: new Set(["Agendado","Compareceu","Fechou","Remarcou","Conversando"]),
  disqualified: new Set(["Número incorreto","Achou caro","Não tem interesse","Mora longe","Fechou em outro lugar","Mensagem não entregue"])
};
function __kpiBucket(key, rows){
  const list = (rows||[]).slice();
  if(key==="total") return list;
  if(key==="pos") return list.filter(e => KPI_RULES.positive.has((e.status||"").trim()));
  if(key==="bad") return list.filter(e => KPI_RULES.disqualified.has((e.status||"").trim()));
  if(key==="sched") return list.filter(e => ["Agendado","Remarcou"].includes((e.status||"").trim()));
  if(key==="budget"||key==="received"||key==="open") return list;
  return list;
}
function __kpiTitle(key){
  return ({
    total:"Total (no filtro atual)",
    pos:"Resultado positivo",
    bad:"Desqualificados",
    sched:"Agendados/Remarcou",
    budget:"Valor orçado (leads no filtro)",
    received:"R$ recebido (leads no filtro)",
    open:"Em aberto (leads no filtro)"
  })[key] || "Detalhes";
}


function __updateKpiActiveUI(){
  try{
    document.querySelectorAll(".kpi[data-kpi]").forEach(k=>{
      const key = k.getAttribute("data-kpi");
      const active = window.__KPI_ACTIVE && window.__KPI_ACTIVE===key && key!=="total";
      k.classList.toggle("kpiActive", !!active);
      k.setAttribute("aria-pressed", active ? "true" : "false");
      k.style.cursor = "pointer";
    });
  }catch(_){}
}

function __dashboardRowsByKpi(key, rows){
  rows = Array.isArray(rows) ? rows : [];
  if(!key || key === "total") return rows;
  try{ return __kpiBucket(key, rows); }catch(_){ return rows; }
}

function __applyKpiClick(key, opts={}){
  key = String(key || "");
  if(!key) return;

  const now = Date.now();
  const sig = `${key}|${now}`;
  if(window.__KPI_CLICK_LOCK && (now - window.__KPI_CLICK_LOCK_AT) < 160) return;
  window.__KPI_CLICK_LOCK = sig;
  window.__KPI_CLICK_LOCK_AT = now;
  setTimeout(()=>{ window.__KPI_CLICK_LOCK = ""; }, 180);

  if(key === "total"){
    window.__KPI_ACTIVE = null;
    window.__DASH_STATUS_ACTIVE = "";
  }else{
    window.__KPI_ACTIVE = (window.__KPI_ACTIVE === key) ? null : key;
    window.__DASH_STATUS_ACTIVE = "";
  }

  window.DASH_PREVIEW_LIMIT = 10;
  __updateKpiActiveUI();

  try{ renderDashboard(); }catch(_){ try{ renderAll(); }catch(__){} }
}

function __bindKpiClicks(){
  try{
    document.querySelectorAll(".kpi[data-kpi]").forEach(k=>{
      k.style.cursor = "pointer";
      k.tabIndex = 0;
      k.setAttribute("role","button");
      k.setAttribute("aria-label", k.getAttribute("aria-label") || "Filtrar Dashboard por este indicador");
    });

    const closeBtn = document.getElementById("kpiModalClose");
    if(closeBtn && !closeBtn.__bound){
      closeBtn.__bound = true;
      closeBtn.addEventListener("click", ()=>closeModal("kpiModal"));
    }
    __updateKpiActiveUI();
  }catch(_){}
}

(function(){
  if(window.__CRONOS_KPI_CLICK_V1032_BOUND) return;
  window.__CRONOS_KPI_CLICK_V1032_BOUND = true;

  const handler = (ev)=>{
    const kpiEl = ev.target && ev.target.closest ? ev.target.closest(".kpi[data-kpi]") : null;
    if(!kpiEl) return;
    if(ev.target.closest("button, a, input, select, textarea")) return;

    try{
      ev.preventDefault?.();
      ev.stopPropagation?.();
      ev.stopImmediatePropagation?.();
    }catch(_){}

    const key = kpiEl.getAttribute("data-kpi");
    __applyKpiClick(key);
  };

  document.addEventListener("pointerdown", handler, true);
  document.addEventListener("keydown", (ev)=>{
    const kpiEl = ev.target && ev.target.closest ? ev.target.closest(".kpi[data-kpi]") : null;
    if(!kpiEl) return;
    if(ev.key !== "Enter" && ev.key !== " ") return;
    try{ ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.(); }catch(_){}
    __applyKpiClick(kpiEl.getAttribute("data-kpi"));
  }, true);
})();



const supabaseUrl = "https://nsqpslierpulanxvsxaw.supabase.co";
const supabaseKey = "sb_publishable_gFddoL8aMpTWJE979hRgvg_dJVackKZ";

const CRONOS_MAIN_AUTH_STORAGE_KEY = "cronos-main-auth";
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey, {
  auth: {
    storageKey: CRONOS_MAIN_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});
window.__SUPABASE_CLOUD_LOGIN__ = true;
window.__SUPABASE_MASTER_LOGIN__ = false;
window.__CRONOS_LOGIN_BUSY__ = false;
window.__CRONOS_EXPLICIT_LOGIN__ = false;
window.__CRONOS_ACCESS_BLOCK__ = null;

async function finalizeCloudLogin(){
  try{
    const explicitLogin = !!window.__CRONOS_EXPLICIT_LOGIN__;
    cancelPendingCloudSync();
    suppressCloudFailureToasts(12000);
    setSupportEntryLoading(false);

    document.getElementById("appView").classList.add("hidden");

    if(explicitLogin){
      hideBootSplash();
      document.getElementById("authView").classList.remove("hidden");
      setLoginLoading(true, "Validando acesso e carregando seu ambiente...");
    }else{
      document.getElementById("authView").classList.add("hidden");
      setLoginLoading(false);
      showBootSplash("Sincronizando seu ambiente...");
    }

    await ensureCloudDBLoaded(true);
    const actorInfo = await syncCurrentCloudActor();
    if(!actorInfo){
      let title = "Acesso sem vínculo";
      let message = "Esse login autenticou, mas não está ligado a nenhuma clínica.";

      if(CLOUD_ACCESS_KIND === "member_pending"){
        title = "Aguardando liberação";
        message = String(CLOUD_MEMBER_INFO?.blocked_reason || "Seu acesso foi criado, mas ainda depende da liberação do superadmin.");
      }else if(CLOUD_ACCESS_KIND === "member_inactive"){
        title = "Acesso bloqueado";
        message = String(CLOUD_MEMBER_INFO?.blocked_reason || "Esse usuário está inativo e precisa ser liberado pelo superadmin.");
      }

      toast(title, message);
      cancelPendingCloudSync();
      suppressCloudFailureToasts(4000);
      try{ await supabaseClient.auth.signOut(); }catch(_){}
      clearClinicAccessState();
      clearSession();
      showAuth();
      return;
    }
  }catch(err){
    console.error("Erro ao preparar dados da nuvem:", err);
    setLoginLoading(false);
    toast("Falha ao abrir o sistema", "A autenticação ocorreu, mas a clínica não carregou direito.");
    return;
  }

  await boot();

  const actor = currentActor();
  if(window.__CRONOS_EXPLICIT_LOGIN__ && actor){
    setTimeout(()=>{
      toast(`Bem-vindo, ${actor.name} 👋`, actor.kind === "master"
        ? "Sua clínica já está pronta para uso."
        : `${roleLabelPt(actor.role)} conectado com sucesso.`);
    }, 220);
  }
  window.__CRONOS_EXPLICIT_LOGIN__ = false;
}

document.getElementById("btnLogin").addEventListener("click", async () => {
  if(window.__CRONOS_LOGIN_BUSY__) return;

  cancelPendingCloudSync();
  suppressCloudFailureToasts(12000);

  const mode = String(document.getElementById("authMode")?.value || "master");
  const rawLogin = String(document.getElementById("authLogin").value || "").trim();
  const password = document.getElementById("authPass").value;

  if (!rawLogin || !password) {
    toast("Preencha login e senha");
    return;
  }

  const email = mode === "user"
    ? resolveUserLoginEmail(rawLogin)
    : String(rawLogin || "").trim().toLowerCase();

  if(!email){
    toast("Login inválido");
    return;
  }

  setLoginLoading(true, "Conectando e validando seu acesso...");
  window.__CRONOS_EXPLICIT_LOGIN__ = true;

  try{
    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      toast("Login ou senha inválidos", "Confere os dados e tenta de novo.");
      return;
    }

    await finalizeCloudLogin();
  }catch(err){
    console.error("Falha no login:", err);
    toast("Falha ao entrar", "O sistema demorou mais do que devia. Tenta de novo.");
  }finally{
    setLoginLoading(false);
    window.__CRONOS_EXPLICIT_LOGIN__ = false;
  }
});

async function verificarSessao() {
  window.__CRONOS_SESSION_CHECKING__ = true;
  window.__CRONOS_BOOTING__ = true;

  try{
    const auth = document.getElementById("authView");
    const app = document.getElementById("appView");
    if(app) app.classList.add("hidden");
    if(auth) auth.classList.add("hidden");
    showBootSplash("Sincronizando seu ambiente...");
    setSupportEntryLoading(false);
    setLoginLoading(false);
  }catch(_){}

  const hasSupportToken = new URLSearchParams(location.search).has("support_token");

  if (hasSupportToken || isSupportMode()) {
    await boot();
    return;
  }

  const { data } = await supabaseClient.auth.getSession();

  if (data.session) {
    window.__CRONOS_EXPLICIT_LOGIN__ = false;
    await finalizeCloudLogin();
    return;
  }

  clearSession();
  resetCloudContext();
  DB = null;
  showAuth();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", verificarSessao, { once:true });
}else{
  setTimeout(verificarSessao, 0);
}
document.addEventListener("DOMContentLoaded", () => {
  const btnKanban = document.querySelector('[data-view="kanban"]');

  if (btnKanban) {
    btnKanban.addEventListener("click", () => {
      setTimeout(() => {
        try {
          renderKanban();
        } catch (e) {
          console.error("Erro ao renderizar kanban:", e);
        }
      }, 150);
    });
  }
});

  setTimeout(() => {
    renderTasks();
    renderUsers();
  }, 200);

(function(){
  const FEATURE_ACCESS_ENDPOINT = 'get-clinic-feature-access';
  const SUPABASE_FN_BASE = 'https://nsqpslierpulanxvsxaw.supabase.co/functions/v1/';
  const FEATURE_CACHE_PREFIX = 'cronos_feature_access_cache::';
  const SUPPORT_SPLASH_MIN_MS = 900;

  const featureStateMap = new Map();
  let lastResolvedContextKey = null;
  let overlayMounted = false;

  const VIEW_TO_FEATURE = {
    dashboard: 'dashboard',
    leads: 'leads',
    kanban: 'kanban',
    tasks: 'tasks',
    installments: 'installments',
    users: 'users',
    settings: 'settings'
  };

  const VIEW_LABELS = {
    dashboard: 'Dashboard',
    leads: 'Leads',
    kanban: 'Funil',
    tasks: 'Tarefas',
    installments: 'Recebimentos',
    users: 'Usuários',
    settings: 'Configurações'
  };

  function normalizeFeatureKey(value){
    return String(value || '').trim().toLowerCase();
  }

  function getFeatureState(view){
    const key = VIEW_TO_FEATURE[view];
    if(!key) return { visibility_mode:'enabled', enabled:true };
    return featureStateMap.get(key) || { visibility_mode:'enabled', enabled:true };
  }

  function isFeatureHidden(view){
    const state = getFeatureState(view);
    return String(state.visibility_mode || '').toLowerCase() === 'hidden';
  }

  function isFeatureLocked(view){
    const state = getFeatureState(view);
    const visibility = String(state.visibility_mode || '').toLowerCase();
    if(visibility === 'hidden') return false;
    if(visibility === 'locked') return true;
    return state.enabled === false;
  }

  function showPlanToast(){
    try{
      if(typeof toast === 'function'){
        toast('Módulo indisponível', 'Este módulo não está disponível para esta clínica.');
        return;
      }
    }catch(_err){}
  }

  function ensureOverlay(){
    if(overlayMounted && document.getElementById('featureBlockedOverlay')) return document.getElementById('featureBlockedOverlay');
    const main = document.querySelector('.main');
    if(!main) return null;
    let overlay = document.getElementById('featureBlockedOverlay');
    if(!overlay){
      overlay = document.createElement('section');
      overlay.id = 'featureBlockedOverlay';
      overlay.innerHTML = `
        <div class="featureBlockedCard">
          <div class="featureBlockedEyebrow">Bloqueado no momento</div>
          <h2 class="featureBlockedTitle">Módulo indisponível</h2>
          <p class="featureBlockedText">Este módulo não está disponível para esta clínica.</p>
          <p class="featureBlockedText">Para liberar este recurso, entre em contato com o suporte.</p>
        </div>
      `;
      main.appendChild(overlay);
    }
    overlayMounted = true;
    return overlay;
  }

  function getAppViewsList(){
    try{
      if(typeof APP_VIEWS !== 'undefined' && Array.isArray(APP_VIEWS)) return APP_VIEWS;
    }catch(_err){}
    if(Array.isArray(window.APP_VIEWS)) return window.APP_VIEWS;
    return ['dashboard','leads','kanban','tasks','installments','users','settings'];
  }

  function hideAllNativeViews(){
    getAppViewsList().forEach(v => {
      const node = document.getElementById(`view-${v}`);
      if(node) node.classList.add('hidden');
    });
  }

  function positionBlockedOverlay(){
    const overlay = document.getElementById('featureBlockedOverlay');
    const main = document.querySelector('.main');
    if(!overlay || !main) return;

    if(window.innerWidth <= 980){
      overlay.style.inset = '16px';
      overlay.style.left = '';
      overlay.style.top = '';
      overlay.style.width = '';
      overlay.style.height = '';
      return;
    }

    const rect = main.getBoundingClientRect();
    overlay.style.top = Math.max(16, rect.top + 12) + 'px';
    overlay.style.left = Math.max(16, rect.left + 12) + 'px';
    overlay.style.width = Math.max(320, rect.width - 24) + 'px';
    overlay.style.height = Math.max(240, rect.height - 24) + 'px';
    overlay.style.right = 'auto';
    overlay.style.bottom = 'auto';
    overlay.style.inset = 'auto';
  }

  function showBlockedOverlay(view){
    const overlay = ensureOverlay();
    if(!overlay) return;
    const label = VIEW_LABELS[view] || 'Módulo';
    const title = overlay.querySelector('.featureBlockedTitle');
    const texts = overlay.querySelectorAll('.featureBlockedText');
    if(title) title.textContent = `${label} indisponível`;
    if(texts[0]) texts[0].textContent = `O módulo ${label} não está disponível para esta clínica.`;
    if(texts[1]) texts[1].textContent = 'Para liberar este recurso, entre em contato com o suporte.';

    hideAllNativeViews();
    const sticky = document.getElementById('stickyFilters');
    if(sticky) sticky.classList.add('hidden');

    const main = document.querySelector('.main');
    if(main) main.style.overflow = 'hidden';
    document.documentElement.classList.add('feature-lock-active');
    document.body.classList.add('feature-lock-active');

    document.querySelectorAll('.nav button[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    overlay.classList.add('show');
    positionBlockedOverlay();
  }

  function hideBlockedOverlay(){
    const overlay = document.getElementById('featureBlockedOverlay');
    if(overlay) overlay.classList.remove('show');
    const main = document.querySelector('.main');
    if(main) main.style.overflow = '';
    document.documentElement.classList.remove('feature-lock-active');
    document.body.classList.remove('feature-lock-active');
  }

  function getFirstVisibleAndEnabledView(){
    const buttons = Array.from(document.querySelectorAll('.nav button[data-view]'));
    for(const btn of buttons){
      const view = btn.getAttribute('data-view');
      if(!view) continue;
      if(btn.classList.contains('hidden')) continue;
      if(isFeatureHidden(view)) continue;
      if(isFeatureLocked(view)) continue;
      return view;
    }
    return null;
  }

  function applyFeatureStatesToMenu(){
    try{
      const buttons = Array.from(document.querySelectorAll('.nav button[data-view]'));
      buttons.forEach(btn => {
        const view = btn.getAttribute('data-view');
        if(!view) return;

        const hiddenByRole = btn.classList.contains('hidden');
        const hiddenByFeature = isFeatureHidden(view);
        const lockedByFeature = isFeatureLocked(view);

        btn.classList.toggle('feature-hidden', !hiddenByRole && hiddenByFeature);
        btn.classList.toggle('feature-locked', !hiddenByRole && !hiddenByFeature && lockedByFeature);

        let tag = btn.querySelector('.featureLockTag');
        if(!hiddenByRole && !hiddenByFeature && lockedByFeature){
          if(!tag){
            tag = document.createElement('span');
            tag.className = 'featureLockTag';
            tag.textContent = 'Bloq.';
            btn.appendChild(tag);
          }
        } else if(tag){
          tag.remove();
        }
      });
    }catch(err){
      console.error('Falha ao aplicar botões de feature:', err);
    }
  }

  function syncCurrentViewState(){
    const activeBtn = document.querySelector('.nav button.active[data-view]');
    const activeView = activeBtn ? activeBtn.dataset.view : null;
    if(activeView && isFeatureLocked(activeView)){
      showBlockedOverlay(activeView);
      return;
    }
    hideBlockedOverlay();
  }

  function wrapSetActiveView(){
    if(typeof window.setActiveView !== 'function' || window.__featureSetActiveWrapped) return;
    const originalSetActiveView = window.setActiveView;

    window.setActiveView = function(view){
      if(isFeatureHidden(view)){
        const fallback = getFirstVisibleAndEnabledView();
        if(fallback && fallback !== view){
          return originalSetActiveView.call(this, fallback);
        }
        hideAllNativeViews();
        hideBlockedOverlay();
        return;
      }

      if(isFeatureLocked(view)){
        showPlanToast();
        showBlockedOverlay(view);
        return;
      }

      hideBlockedOverlay();
      return originalSetActiveView.apply(this, arguments);
    };

    window.__featureSetActiveWrapped = true;
  }

  function resolveOwnerContext(actorOverride){
    const actor = actorOverride || ((typeof currentActor === 'function') ? currentActor() : null);
    const support = (typeof getSupportContext === 'function') ? getSupportContext() : null;

    const ownerUid =
      (typeof CLOUD_CLINIC_OWNER_UID !== 'undefined' && CLOUD_CLINIC_OWNER_UID) ||
      (typeof CLOUD_OWNER_UID !== 'undefined' && CLOUD_OWNER_UID) ||
      (support && support.owner_uid) ||
      (actor && actor.kind === 'support' && actor.id ? actor.id : null) ||
      null;

    const ownerEmail =
      (typeof CLOUD_CLINIC_OWNER_EMAIL !== 'undefined' && CLOUD_CLINIC_OWNER_EMAIL) ||
      (typeof CLOUD_OWNER_EMAIL !== 'undefined' && CLOUD_OWNER_EMAIL) ||
      (support && (support.owner_email || support.master_email)) ||
      ((actor && actor.kind === 'master') ? actor.email : null) ||
      ((actor && actor.kind === 'support' && actor.email) ? actor.email : null) ||
      null;

    return {
      owner_uid: ownerUid || null,
      owner_email: ownerEmail || null
    };
  }

  function getContextCacheKey(ctx){
    if(!ctx || (!ctx.owner_uid && !ctx.owner_email)) return null;
    return FEATURE_CACHE_PREFIX + (ctx.owner_uid || ctx.owner_email || 'default');
  }

  function applyFeaturePayload(items){
    featureStateMap.clear();
    (Array.isArray(items) ? items : []).forEach(item => {
      const key = normalizeFeatureKey(item && item.feature_key);
      if(!key) return;
      featureStateMap.set(key, {
        enabled: item && item.enabled !== false,
        visibility_mode: normalizeFeatureKey(item && item.visibility_mode || 'enabled') || 'enabled'
      });
    });
  }

  function readFeatureCache(ctx){
    try{
      const key = getContextCacheKey(ctx);
      if(!key) return false;
      const raw = localStorage.getItem(key);
      if(!raw) return false;
      const parsed = JSON.parse(raw);
      if(!Array.isArray(parsed && parsed.features)) return false;
      applyFeaturePayload(parsed.features);
      lastResolvedContextKey = JSON.stringify(ctx);
      return true;
    }catch(err){
      console.warn('Falha ao ler cache de módulos:', err);
      return false;
    }
  }

  function writeFeatureCache(ctx, features){
    try{
      const key = getContextCacheKey(ctx);
      if(!key) return;
      localStorage.setItem(key, JSON.stringify({
        saved_at: Date.now(),
        features: Array.isArray(features) ? features : []
      }));
    }catch(err){
      console.warn('Falha ao gravar cache de módulos:', err);
    }
  }

  async function fetchFeatureAccess(force, actorOverride){
    try{
      const ctx = resolveOwnerContext(actorOverride);
      if(!ctx.owner_uid && !ctx.owner_email){
        console.warn('Feature access: contexto da clínica ainda não resolvido.');
        return false;
      }

      const ctxKey = JSON.stringify(ctx);

      if(!force && !featureStateMap.size){
        readFeatureCache(ctx);
      }

      if(!force && lastResolvedContextKey === ctxKey && featureStateMap.size){
        return true;
      }

      const authToken =
        localStorage.getItem('cronos_token') ||
        localStorage.getItem('authToken') ||
        '';

      const headers = { 'Content-Type':'application/json' };
      if(authToken){
        headers['Authorization'] = 'Bearer ' + authToken;
      }

      const res = await fetch(SUPABASE_FN_BASE + FEATURE_ACCESS_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          owner_uid: ctx.owner_uid,
          owner_email: ctx.owner_email
        })
      });

      if(!res.ok){
        throw new Error('feature access unavailable');
      }

      const data = await res.json().catch(() => ({}));
      const features = Array.isArray(data && data.features) ? data.features : [];
      applyFeaturePayload(features);
      writeFeatureCache(ctx, features);
      lastResolvedContextKey = ctxKey;
      return true;
    }catch(err){
      console.warn('Feature access em modo seguro:', err && err.message || err);
      return false;
    }
  }

  async function refreshFeatureAccess(force, actorOverride){
    wrapSetActiveView();
    const ctx = resolveOwnerContext(actorOverride);
    if(featureStateMap.size === 0){
      readFeatureCache(ctx);
    }
    applyFeatureStatesToMenu();
    syncCurrentViewState();
    await fetchFeatureAccess(!!force, actorOverride);
    applyFeatureStatesToMenu();
    syncCurrentViewState();
  }

  function wrapSetSupportEntryLoading(){
    if(typeof window.setSupportEntryLoading !== 'function' || window.__supportEntryWrapped) return;
    const original = window.setSupportEntryLoading;
    window.setSupportEntryLoading = function(isLoading, message){
      if(isLoading){
        window.__supportEntryStartedAt = Date.now();
      }else{
        window.__supportEntryStartedAt = 0;
      }
      return original.apply(this, arguments);
    };
    window.__supportEntryWrapped = true;
  }

  function wrapShowApp(){
    if(typeof window.showApp !== 'function' || window.__featureShowAppWrapped) return;
    const originalShowApp = window.showApp;

    window.showApp = function(actor){
      const ctx = resolveOwnerContext(actor);
      readFeatureCache(ctx);

      const supportMode = !!(actor && actor.isSupport);
      const authVisible = !!(document.getElementById('authView') && !document.getElementById('authView').classList.contains('hidden'));
      const elapsed = Date.now() - Number(window.__supportEntryStartedAt || 0);
      const waitMs = (supportMode && authVisible) ? Math.max(0, SUPPORT_SPLASH_MIN_MS - elapsed) : 0;

      const run = () => {
        originalShowApp.apply(this, arguments);
        applyFeatureStatesToMenu();
        syncCurrentViewState();
        setTimeout(() => { refreshFeatureAccess(true, actor); }, 40);
        setTimeout(() => { refreshFeatureAccess(true, actor); }, 900);
      };

      if(waitMs > 0){
        setTimeout(run, waitMs);
        return;
      }

      return run();
    };

    window.__featureShowAppWrapped = true;
  }

  function wrapBoot(){
    if(typeof window.boot !== 'function' || window.__featureBootWrapped) return;
    const originalBoot = window.boot;
    window.boot = async function(){
      const supportPending = new URLSearchParams(location.search).has('support_token') ||
        (typeof isSupportMode === 'function' && isSupportMode());

      if(supportPending && !window.__supportEntryStartedAt){
        window.__supportEntryStartedAt = Date.now();
      }

      const result = await originalBoot.apply(this, arguments);
      setTimeout(() => { refreshFeatureAccess(true); }, 300);
      setTimeout(() => { refreshFeatureAccess(true); }, 1200);
      return result;
    };
    window.__featureBootWrapped = true;
  }

  function install(){
    ensureOverlay();
    wrapSetSupportEntryLoading();
    wrapShowApp();
    wrapBoot();
    wrapSetActiveView();
    refreshFeatureAccess(false);
    window.addEventListener('focus', () => refreshFeatureAccess(true));
    document.addEventListener('visibilitychange', () => {
      if(document.visibilityState === 'visible') refreshFeatureAccess(true);
    });
  }

  window.__refreshFeatureAccess = refreshFeatureAccess;
  window.addEventListener('resize', positionBlockedOverlay);
  window.addEventListener('scroll', positionBlockedOverlay, true);

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', install, { once:true });
  }else{
    install();
  }
})();

/* Ficha do lead e procedimentos */
(function(){
  try{
    const FACE_OPTIONS = [
      {value:'', label:'Sem face'},
      {value:'V', label:'Vestibular'},
      {value:'L/P', label:'Lingual/Palatina'},
      {value:'M', label:'Mesial'},
      {value:'D', label:'Distal'},
      {value:'O/I', label:'Oclusal/Incisal'}
    ];

    const TOOTH_ROWS = {
      supDir: ['18','17','16','15','14','13','12','11'],
      supEsq: ['21','22','23','24','25','26','27','28'],
      infDir: ['48','47','46','45','44','43','42','41'],
      infEsq: ['31','32','33','34','35','36','37','38']
    };
    const ALL_TEETH = [...TOOTH_ROWS.supDir, ...TOOTH_ROWS.supEsq, ...TOOTH_ROWS.infDir, ...TOOTH_ROWS.infEsq];
    const ODONTO_BASE_LIGHT = "data:image/svg+xml;base64,PHN2ZyB2ZXJzaW9uPSIxLjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIKIHdpZHRoPSIyNTUxLjAwMDAwMHB0IiBoZWlnaHQ9IjgwMC4wMDAwMDBwdCIgdmlld0JveD0iMCAwIDI1NTEuMDAwMDAwIDgwMC4wMDAwMDAiCiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJ4TWlkWU1pZCBtZWV0Ij4KPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMC4wMDAwMDAsODAwLjAwMDAwMCkgc2NhbGUoMC4xMDAwMDAsLTAuMTAwMDAwKSIKZmlsbD0iIzExMTgyNyIgc3Ryb2tlPSJub25lIj4KPHBhdGggZD0iTTkwODYgNzg4OSBjLTcyIC04MCAtNzYgLTEwMyAtNzYgLTQ1MyAwIC0xNjYgLTQgLTM0OCAtMTAgLTQwNiAtNQotNTggLTE0IC0xNjggLTIwIC0yNDUgLTYgLTc3IC0xOCAtMjIxIC0yNyAtMzIwIC05IC0xMDcgLTE3IC0zNDcgLTIwIC01OTQgLTQKLTM2MSAtMyAtNDE5IDExIC00NTUgMTUgLTM5IDE1IC00NiAtMyAtMTA2IC02MiAtMjA4IC05MyAtMzA2IC0xMjYgLTM5NSAtNjEKLTE2NiAtNzUgLTIyNCAtNzUgLTMwNyAwIC0xODYgMTA5IC0zMzIgMzMwIC00NDMgMTE4IC02MCAxODkgLTc1IDM0MyAtNzUgMTE2CjAgMTQzIDMgMjA4IDI1IDQxIDE0IDk5IDQyIDEyOSA2MiA4NyA1OCAxOTQgMTc0IDIzNSAyNTUgMzIgNjUgMzUgNzggMzUgMTYwCjAgMTQ3IC02MCAzNTYgLTE2NSA1NzggLTcwIDE0NiAtMTEzIDI3NSAtMTQ0IDQzMCAtMjEgMTA1IC00MSAyNzkgLTQxIDM1NCAwCjEwMyAtMjggNTA3IC00MCA1ODEgLTUgMzMgLTE3IDExMiAtMjUgMTc1IC0yMSAxNTYgLTgyIDQ2OCAtMTMwIDY2NSAtMTExIDQ2MwotMTIzIDQ5NSAtMjA1IDUzOSAtMzEgMTcgLTYzIDI2IC05MyAyNiAtNDIgMCAtNDkgLTQgLTkxIC01MXogbTE0NCAtNjUgYzE3Ci0xNSAzOSAtNDMgNDkgLTYzIDE4IC0zNCA2MCAtMTgzIDk2IC0zMzYgOSAtMzggMjAgLTg2IDI1IC0xMDYgNiAtMjAgMTQgLTU4CjIwIC04NSA1IC0yNyAxNiAtODAgMjUgLTExOSA3OCAtMzUyIDEyMSAtNjc2IDEzNSAtMTAxMCAxMSAtMjQ2IDI1IC00MDIgNDUKLTUwMiA4IC00MCAxNSAtODkgMTUgLTEwOSBsMCAtMzYgLTU3IDggYy03NSAxMiAtNDIxIDExIC00OTQgMCBsLTU2IC04IC0xMgozMiBjLTIyIDY0IC0xMSA2NTMgMTggOTg1IDQyIDQ2NSA2MSA4MTMgNjEgMTA2OCAwIDE4MCAxIDE5MCAyNSAyMzcgMjIgNDMgNDYKNjkgNjcgNzAgMyAwIDIxIC0xMiAzOCAtMjZ6IG0zNjQgLTI0NTggYzM3IC04IDc0IC0yMCA4MiAtMjcgNyAtOCAyNiAtNDggNDMKLTg5IDE2IC00MSA1NyAtMTI5IDg5IC0xOTUgNjAgLTEyMSA3NCAtMTYyIDExOCAtMzM0IDI4IC0xMDggMzAgLTE0OCAxMCAtMTk2Ci0yMiAtNTMgLTg2IC0xMzQgLTE2MiAtMjA0IC0xNjMgLTE1MyAtMzY4IC0xODkgLTU5MCAtMTAyIC05NiAzNyAtMTU2IDc1Ci0yMzYgMTQ5IC03MSA2NiAtMTA0IDEyMCAtMTE5IDE5MyAtMTMgNjYgLTMgMTA5IDcwIDMxOSAyNyA4MCA3MSAyMTEgOTYgMjkxCjI1IDgxIDUzIDE1NyA2NCAxNzAgMjkgMzUgMTI3IDQ5IDMxMSA0NCA4NSAtMyAxODYgLTExIDIyNCAtMTl6Ii8+CjxwYXRoIGQ9Ik0xNjY4NyA3OTAxIGMtNTQgLTM1IC03OCAtODUgLTEzMyAtMjc4IC0xMzIgLTQ1NyAtMTg0IC03MDggLTIwNAotOTgzIC0yOCAtMzk2IC0xMTQgLTEwMDUgLTE3MCAtMTIwOSAtNiAtMjAgLTIxIC04MyAtMzQgLTE0MSAtNDMgLTE4MSAtNjQKLTI3MSAtMTAwIC00MjAgLTUxIC0yMTUgLTYxIC0yOTggLTQ2IC0zNzMgMjggLTEzMyA5MyAtMjExIDI0NiAtMjkzIDE0OSAtODAKMjI5IC05OCA0MTMgLTkyIDEzMiA1IDE1NCA4IDIyOCAzNiAxNjcgNjMgMjU4IDE0NyAzMDUgMjgxIDE3IDQ4IDIwIDczIDE1CjE3MSAtNiAxNDIgLTM4IDI2MCAtMTcyIDYzNSAtNTMgMTQ4IC01MiAxMzggLTE2IDM5NSAxOSAxMjcgMjIgMTg2IDE4IDMzMCAtMwoxNTMgLTI4IDQ0OCAtNDIgNTA1IC01IDIyIC0yMSAzNTggLTM1IDc4MCAtMTQgMzg0IC0yNSA1NDUgLTQzIDU4NyAtOCAxOSAtMzAKNDcgLTQ5IDYyIC0yOSAyMSAtNDYgMjYgLTk0IDI2IC00MSAwIC02OCAtNiAtODcgLTE5eiBtMTI2IC04OSBjOCAtOSAyMSAtMzEKMjggLTQ3IDEzIC0zNSA0OCAtNjM0IDQ5IC04NjAgMCAtODIgNSAtMjA0IDEwIC0yNzAgNiAtNjYgMTUgLTE3NiAyMCAtMjQ1IDYKLTY5IDE1IC0xNTIgMTkgLTE4NSAyNSAtMTY2IDUgLTYyNCAtMzEgLTcxNyAtMTMgLTM2IC0yNiAtMzkgLTExMSAtMjggLTE0OAoxOSAtMzgyIDQgLTQ3MyAtMzAgLTIxIC04IC0zMSAtOCAtNDEgMyAtMTEgMTEgLTExIDI2IDIgOTMgNjQgMzIyIDExNCA2ODEKMTM1IDk2OSAxNyAyMzAgMzUgMzY2IDc2IDU2NSAzNSAxNzUgMTU1IDU5OSAxOTQgNjg2IDM0IDc4IDg3IDEwNiAxMjMgNjZ6Cm03MSAtMjQ2NSBjMTYgLTExIDMxIC00MSA0OSAtOTQgMTQgLTQzIDQ4IC0xNDEgNzUgLTIxOCA1NiAtMTU1IDk0IC0yODUgMTEyCi0zODcgMjYgLTE0MSAtMjkgLTI3NiAtMTQyIC0zNDkgLTYyIC0zOSAtMTcxIC03OSAtMjczIC0xMDAgLTIwOCAtNDEgLTUyNAoxMDMgLTYxNCAyNzkgLTM1IDY5IC0yOCAxMzMgNTAgNDM3IDI3IDEwMyA0OCAxODkgNTkgMjQyIDI2IDExOCA0MSAxNTMgNjgKMTU5IDE1IDMgNDMgMTEgNjIgMTcgMTA0IDMyIDE0OSAzNiAzMzcgMzMgMTUzIC0zIDE5OCAtNyAyMTcgLTE5eiIvPgo8cGF0aCBkPSJNNzU1NCA3NzIxIGMtNDAgLTI0IC02OCAtOTMgLTgyIC0yMDEgLTYgLTQ3IC0xNiAtMjc2IC0yMSAtNTEwIC02Ci0yMzQgLTE2IC01NjIgLTIyIC03MzAgLTEzIC0zMjMgLTEyIC0zNDIgMzEgLTU4NSAyMyAtMTI4IDIzIC0xMzEgNyAtMjY1IC0xNwotMTMyIC01NSAtMzAyIC0xMTUgLTUxMCAtNjIgLTIxMSAtNjggLTM0NyAtMjAgLTQ1MCA0NCAtOTYgMjAzIC0yMzEgMzM2IC0yODUKMjI1IC05MSA0NzUgLTM2IDY2OCAxNDcgODcgODMgMTI5IDE0NSAxNTUgMjMwIDQyIDEzOCAxOCAyNjEgLTkxIDQ2MCAtMTUxCjI3NiAtMTgzIDMzNCAtMjEyIDM4MCAtMjggNDUgLTI5IDQ5IC0xOSAxMDQgMjcgMTQ0IDQgNDQ0IC02MCA3ODQgLTIyIDExNgotMjQgMTMwIC02OSA0NDAgLTU1IDM4NiAtMTA1IDU2OCAtMjExIDc4MSAtNjkgMTM5IC05MyAxNjkgLTE2MSAyMDMgLTYyIDMxCi03NCAzMiAtMTE0IDd6IG0xMjEgLTEzMiBjMjAgLTIzIDY0IC05NyA5NiAtMTY0IDEwNSAtMjE4IDE1NCAtNDA0IDIwMyAtNzgwCjkgLTY2IDIzIC0xNTggMzEgLTIwNSA0NCAtMjYxIDY2IC0zOTcgODAgLTQ5NCAxOSAtMTM2IDIwIC00MjAgMiAtNDU2IGwtMTMKLTI1IC0yMTYgLTEgYy0xMjAgLTEgLTIyOSAtNSAtMjQ0IC04IC00MSAtMTEgLTU0IDggLTU0IDc4IDAgNjYgLTE5IDIwNiAtNDYKMzUxIC0xMyA3MSAtMTUgMTE5IC0xMCAyMzAgOCAxNTcgMjIgNjAyIDM1IDEwNzUgNyAyMzQgMTMgMzI3IDI0IDM2MyAyOSA5MAo1NSA5OSAxMTIgMzZ6IG00MjcgLTIyNDEgYzI4IC0xOSA5MyAtMTMxIDIyNCAtMzg1IDg5IC0xNzIgODkgLTE3MyA5MyAtMjU3IDQKLTExOCAtMjAgLTE3MCAtMTM3IC0yODcgLTc0IC03MyAtMTA0IC05NiAtMTc4IC0xMzEgLTg1IC00MSAtOTQgLTQzIC0xOTUgLTQ2Ci0xMzMgLTUgLTE4NyA5IC0yODkgNzcgLTExMSA3MyAtMTYyIDEyMiAtMjAxIDE5MyAtMzEgNTcgLTM0IDcwIC0zMyAxMzggMiA3OQo1IDkxIDc4IDM0MyAyNSA4NyA1MCAxODQgNTUgMjE2IDE3IDEwNiAzMCAxNDAgNTQgMTQ2IDQ0IDEwIDEyNiAxMyAzMTMgMTEKMTU3IC0yIDE5NiAtNSAyMTYgLTE4eiIvPgo8cGF0aCBkPSJNMTE5NjUgNzU2OSBjLTYyIC03NSAtOTEgLTE3MiAtMTAwIC0zMzQgLTMgLTYwIC0xMCAtMTM5IC0xNSAtMTc1Ci0zMyAtMjM1IC0zMyAtMjM2IC02MCAtNTg1IC05IC0xMjggLTM3IC0zOTYgLTU5IC01NzAgLTE0IC0xMTIgLTU2IC0yOTAgLTEwMQotNDI1IC01NyAtMTc0IC05NiAtMzEzIC0xMjIgLTQ0NCAtMjAgLTk2IC0yMyAtMTQxIC0yMiAtMzQxIDAgLTIxMiAyIC0yMzUgMjIKLTI5MCAzNyAtOTkgNjMgLTEyOSAxNDQgLTE3MCA5OSAtNDggMTcwIC01NSA1NjMgLTUyIGwzMjAgMyA2MSAzMSBjMTAyIDUzCjE0NyAxMzIgMTY2IDI5MiAyOSAyNDUgLTM4IDUzNyAtMTY2IDcyOSBsLTQ1IDY3IDIxIDYwIGMxNSA0NCAyMiA5NCAyNiAxODUgNgoxNjggMCAxOTYgLTI2MCAxMjQ5IC03NCAyOTggLTE3MSA2MTggLTIxMiA3MDAgLTI5IDU3IC03OCAxMDEgLTExMSAxMDEgLTE0IDAKLTM0IC0xMyAtNTAgLTMxeiBtMTA1IC0xNjIgYzMwIC02MyA1NCAtMTM2IDExNiAtMzUyIDQ5IC0xNjkgNTEgLTE3NyA3OSAtMzAwCjE0IC02MCAzMiAtMTM1IDQwIC0xNjUgNyAtMzAgMjUgLTEwOSA0MCAtMTc1IDM1IC0xNTkgODMgLTM2MyA5NSAtNDAwIDY2Ci0yMTUgOTMgLTQ2NSA2MSAtNTc3IC0yMCAtNzEgLTMyIC03NiAtODggLTQwIC0xMjAgNzcgLTI0NyAxMTIgLTQxMSAxMTIgLTYyCjAgLTE0NSAtNSAtMTg0IC0xMSAtMzggLTYgLTc0IC03IC03OCAtMiAtNSA0IDYgNzEgMjUgMTQ4IDE4IDc3IDM4IDE4MSA0NQoyMzAgNiA1MCAxNSAxMTcgMjAgMTUwIDEzIDgyIDQ3IDQ4MiA1NSA2MzQgNCA2OCAxMyAxNzAgMjEgMjI1IDggNTYgMjAgMTc1CjI5IDI2NiAxOCAyMDQgMjEgMjIxIDQ4IDI3NiAzMCA2MyA1MSA1OSA4NyAtMTl6IG0xMjAgLTIwMTUgYzI0NCAtODYgMzc5Ci0yMjMgNDQ1IC00NTUgNDAgLTEzOSA0OCAtMTk5IDQzIC0zMzQgLTMgLTExNCAtNyAtMTM1IC0zMSAtMTg4IC0zNiAtNzcgLTUxCi05MyAtMTEyIC0xMjAgLTQ5IC0yMiAtNjMgLTIzIC0zNDAgLTI0IC00NzcgLTIgLTU1OCAyNCAtNjEyIDE5NiAtMzQgMTEwIC0yNQo0MDQgMTkgNTk4IDIxIDk1IDc3IDI4OCA4NiAyOTcgMTAgMTAgOTkgMzUgMTcyIDQ5IDc2IDE0IDI2OCAzIDMzMCAtMTl6Ii8+CjxwYXRoIGQ9Ik0xNTM4OCA3NTI1IGMtODcgLTQ2IC04OSAtNTEgLTIyMiAtNTI1IC0xMTUgLTQwOSAtMTUxIC02MTUgLTE2MQotOTEwIC0xNSAtNDUzIC00MCAtNjI3IC0xMzMgLTkzMCAtNTAgLTE2MSAtNzYgLTQwMiAtNzEgLTY2NSA0IC0xNTYgNyAtMTg1CjI0IC0yMTkgMzkgLTc4IDEwMCAtOTggMzQ2IC0xMTYgMzIyIC0yMyA0MTkgLTExIDQ4OSA2MSA3MiA3NCA3NSA5NiA3NSA0OTkgMAozMDggLTMgMzY3IC0xOSA0NDUgLTIzIDExMCAtNjEgMTg4IC0xMjYgMjYwIGwtNTAgNTUgMCA1MDAgYzAgMjc2IC01IDYxMSAtMTEKNzQ1IC04IDE4NCAtNyAyOTMgMiA0MzcgMTggMjg2IDE0IDMxOSAtNDcgMzY3IC0zMyAyNiAtMzggMjYgLTk2IC00eiBtNjgKLTEyMCBjMyAtMTQgMSAtOTIgLTYgLTE3MyAtOCAtOTIgLTEwIC0yMTkgLTYgLTM0MiAxMyAtNDI2IDE4IC0xMzcyIDcgLTEzODMKLTcgLTcgLTQ4IC0xMCAtMTA5IC04IC01NCAxIC0xMzYgLTMgLTE4MiAtOSAtMTEzIC0xNiAtMTE3IC0xMiAtMTAxIDEwNyA2IDQ4CjE1IDIwNSAyMSAzNDggMTAgMjY0IDI1IDQyNSA1NSA1NzAgMTcgODYgMTAzIDQyNCAxMTAgNDM1IDMgNCAxMSAzMiAxOSA2MSA4CjMwIDIyIDc5IDMxIDEwOSA5IDMwIDI2IDkzIDM5IDE0MCAyNCA4OCAzOCAxMjMgNjQgMTUzIDIyIDI1IDUwIDIxIDU4IC04egptMTkgLTIwMjQgYzgyIC0zNiAxMzAgLTExMiAxNjEgLTI1MSAyMCAtOTMgMzEgLTU3NSAxNiAtNjkzIC0xMiAtODggLTQyIC0xNDUKLTk1IC0xNzcgLTM5IC0yNCAtMTM2IC0yNiAtMzkzIC02IC0xNDggMTEgLTE3NyAxNiAtMjE1IDM3IC02NyAzNyAtNzIgNjIgLTY1CjMxMSA2IDIyNiAyMyAzNTQgNjMgNDkzIDYyIDIxNyA3NSAyNTUgODggMjY5IDggNyA1NCAxOSAxMDIgMjUgNDggNyA5NSAxNAoxMDMgMTYgNDQgMTEgMTg4IC0zIDIzNSAtMjR6Ii8+CjxwYXRoIGQ9Ik0xODI5NCA3NTI1IGMtNjcgLTMzIC04MSAtNTAgLTE1MyAtMTgwIC0xNTggLTI4NyAtMjc2IC02NDkgLTM0MQotMTA0NSAtMTkgLTExNSAtMzAgLTM0OCAtMzAgLTYzNyBsMCAtMjgxIC0zOCAtNDkgYy04NSAtMTA5IC0xNDIgLTIxOCAtMTc5Ci0zMzcgLTEyNSAtNDEzIC02NyAtNjU5IDE4MyAtNzg0IDE5MCAtOTUgNDI1IC05MiA2MjMgOCAxMDYgNTMgMTk3IDEzOCAyNDIKMjI3IGwzNCA2NyAtMSAxNDEgYy0xIDk5IC03IDE2OSAtMjIgMjQxIC0yNCAxMTcgLTczIDMwMyAtMTAxIDM4OSAtMTggNTUgLTIwCjk2IC0yNCA1MTAgLTIgMjQ4IC0xMCA1NDUgLTE3IDY2MCAtMTYgMjU4IC0xNyA0NDEgLTcgNzQwIGw4IDIzMCAtMzUgNTQgYy01Mwo4MiAtNjQgODUgLTE0MiA0NnogbTc3IC0xMTYgYzE3IC0yMiAxNyAtNDAgOCAtMjQ0IC0xMiAtMjQyIC05IC00MTYgMTUgLTkxMAo5IC0xODEgMTcgLTQ0NiAxNyAtNTg4IDIgLTMwMiA0IC0yOTYgLTgwIC0yNzggLTI5IDYgLTE0NiAxMSAtMjYwIDExIC0xODEgMAotMjEwIDIgLTIxNSAxNiAtMTAgMjYgLTcgNTk3IDQgNjc2IDUgNDAgMTcgMTMxIDI1IDIwMiAyNiAyMDggODkgNDQ5IDE4MCA2ODAKMTAyIDI2MSAyMzMgNDc4IDI3OCA0NjMgNiAtMiAxOSAtMTQgMjggLTI4eiBtLTc0IC0yMTE1IGM1MyAtOCAxMDQgLTE5IDExNAotMjUgMTkgLTEwIDUzIC0xMDkgODQgLTI0NCA5IC0zOCAyMCAtODggMjUgLTExMCAxOSAtODMgMzMgLTE5MyAzNCAtMjcwIDEKLTcwIC0zIC04NyAtMjggLTEzNyAtNTggLTExNCAtMTkyIC0yMTUgLTMzOCAtMjU0IC04MSAtMjEgLTI0NyAtMTggLTMyOSA2Ci0xMTUgMzUgLTIxNyAxMjUgLTI2NyAyMzggLTI4IDY1IC0yMSAyMzIgMTggMzc3IDE3IDY2IDQ0IDE0NyA2MCAxODEgMzUgNzIKMTE5IDIwMyAxNDUgMjI0IDM3IDMxIDMyNyAzOSA0ODIgMTR6Ii8+CjxwYXRoIGQ9Ik0xMDQ4NSA3NTE2IGMtMTEgLTE2IC0yMCAtNTUgLTIzIC05NyAtNCAtNjYgMTUgLTI4NSAzOSAtNDM3IDI2Ci0xNjggMjkgLTQ4MSA1IC01MjAgLTMgLTUgLTE1IC04NyAtMjYgLTE4MyAtMTkgLTE1MSAtMjEgLTIxOCAtMTggLTUwMCBsMwotMzI2IC00NyAtNjkgYy0yNiAtMzggLTU5IC05NiAtNzQgLTEyOSAtMzYgLTg0IC03MSAtMjM0IC03OCAtMzQwIC01IC04OSA2Ci0zNzMgMjMgLTU3MiAxMyAtMTU1IDU4IC0yMTggMTcyIC0yNDIgODAgLTE3IDQ3MSAtMTQgNTcwIDUgMTk2IDM3IDI1MyAxMjMKMjE1IDMyNSAtMTIgNjIgLTE2IDE0NiAtMTYgMzAwIDAgMTk0IC0yIDIyMyAtMjQgMzA0IC01NSAyMDcgLTcwIDMxOCAtOTYgNzIwCi0yMSAzMDcgLTM1IDQyNiAtNzEgNjA3IC02NCAzMjYgLTE0NyA2MzYgLTIyMSA4MjUgLTIyIDYwIC01MiAxMzYgLTY0IDE3MAotMTMgMzQgLTM0IDc4IC00NiA5OCAtMjcgNDEgLTk0IDc2IC0xNTkgODMgLTQyIDQgLTQ5IDIgLTY0IC0yMnogbTEzNyAtMTEzCmM0NSAtNTAgMTc3IC00MDQgMjM0IC02MjggNDQgLTE3MSAxMDAgLTQzMSAxMzUgLTYyMCAxMyAtNzEgMzcgLTM3MyA0NCAtNTQ5Cmw2IC0xNDkgLTM4IDcgYy0xMDYgMjAgLTIwMCAyNSAtMzE1IDIwIGwtMTI3IC03IC02IDI2IGMtNCAxNCAtNSAxOTUgLTMgNDA0CjQgMzU4IDYgMzg1IDMxIDUxOCAzMyAxNzIgMzQgMjczIDcgNTA3IC0xMiA5NSAtMjUgMjA5IC0zMCAyNTMgLTEzIDExMCAtMTMKMjI4IDIgMjQzIDEzIDEzIDM0IDQgNjAgLTI1eiBtMzQ1IC0yMDMxIGM0MCAtMTAgNzcgLTIyIDgyIC0yNyA1IC02IDE2IC01NQoyNiAtMTEwIDkgLTU1IDI4IC0xNDUgNDIgLTIwMCAyMiAtODcgMjcgLTEzMiAzNCAtMzU1IDQgLTE0MCAxMSAtMjgyIDE0IC0zMTUKNSAtNTAgMyAtNjUgLTE0IC05MiAtNDYgLTc0IC0xMzcgLTkzIC00NDAgLTkzIC0yMTAgMCAtMjE1IDAgLTI1NyAyNSAtNjggNDAKLTc5IDc3IC05NSAzMDUgLTE5IDI2NiAtMTggNDE2IDQgNTIwIDMwIDE0MiAxMjMgMzE0IDE4NCAzMzkgNDEgMTYgMTk4IDMwCjI3OCAyNSAzOSAtMyAxMDMgLTEzIDE0MiAtMjJ6Ii8+CjxwYXRoIGQ9Ik0xMzk4NCA3NTIxIGMtNzIgLTMzIC05NCAtNjYgLTE0MSAtMjE2IC0xNTMgLTQ5MCAtMjU0IC05NTAgLTMyMwotMTQ3MCAtNDUgLTM0NiAtNTAgLTQ0MSAtMjUgLTUwMSAxNiAtMzkgMTUgLTQxIC0yNiAtOTUgLTYwIC03NiAtMTI1IC0yMzEKLTE2MyAtMzg3IC0yNCAtOTcgLTIyIC0zNDIgNCAtNDY3IDMxIC0xNDUgNTYgLTE4NiAxMzUgLTIyMiAzNyAtMTYgNzYgLTE4CjQ2MiAtMTYgNDEwIDIgNDIzIDMgNDczIDI0IDExOCA1MSAxNzAgMTgyIDE3MCA0MzQgMCAyMzEgLTQwIDQyMCAtMTQxIDY2NQotNDkgMTE5IC01MiAxMzEgLTU5IDI0NSAtNSA4MiAtMTUgMTQ3IC0zMyAyMDUgLTM4IDEyNyAtNDggMjEyIC01NyA0NzAgLTkKMjMxIC0yNCA0NTcgLTM1IDUwMiAtMyAxMyAtMTAgNjQgLTE1IDExMyAtNSA1MCAtMTYgMTQ0IC0yNCAyMTAgLTkgNjYgLTIwCjE4NyAtMjYgMjY4IC01IDgxIC0xNiAxNjMgLTI0IDE4MSAtMzIgNzYgLTc1IDkyIC0xNTIgNTd6IG03MiAtMTAyIGMxNCAtMTYKMjEgLTQ0IDI2IC0xMTIgNSAtNTEgMTIgLTE0NCAxNyAtMjA3IDExIC0xMzIgMjkgLTI5NCAzNiAtMzMwIDE4IC05MSAzOSAtMzMwCjQ1IC01MzUgMTAgLTMwMCAyMCAtMzkyIDY2IC01NzggMjkgLTExNSAzNSAtMTU1IDI4IC0xNzUgbC0xMCAtMjcgLTE0MSAzCmMtMTc2IDUgLTMwNCAtMTEgLTQxMyAtNDkgLTEzMCAtNDYgLTEyNiAtNDYgLTEzOSAtOSAtMTEgMzIgLTggNjcgMTkgMzE1IDYKNTAgMTUgMTE5IDIwIDE1NSAyOCAxODUgNTEgMzI4IDU2IDM1MCAzIDE0IDkgNDggMTMgNzUgNyA0NSAyMyAxMTggOTIgNDQwIDExCjU1IDM3IDE1MiA1NiAyMTUgMTkgNjMgNDEgMTQwIDQ5IDE3MCAyMCA3NyA2NCAyMDkgODEgMjQ1IDE0IDI4IDYwIDc1IDc0IDc1CjMgMCAxNCAtOSAyNSAtMjF6IG0yMDkgLTIwODMgYzU2IC0zNyAxNDkgLTI5NCAxOTAgLTUyOCAxOSAtMTA3IDE5IC0yNzUgMAotMzU4IC04IC0zNiAtMTcgLTc1IC0yMCAtODcgLTcgLTI5IC02MSAtOTAgLTk0IC0xMDcgLTM0IC0xNyAtODA4IC0yMSAtODU5Ci01IC02OCAyMiAtMTA3IDE2MyAtMTA3IDM4NCAxIDE4MiAxOSAyNjMgOTcgNDIxIDgxIDE2NSAxODYgMjUyIDM1MCAyODkgOTEKMjEgNDA3IDE1IDQ0MyAtOXoiLz4KPHBhdGggZD0iTTYyNzIgNzM3OCBjLTI2IC0xMyAtNTMgLTkxIC03MiAtMjExIC0xNyAtMTA2IC02IC0yNTcgMzMgLTQzNyA3Ci0zMiAxMiAtMTM0IDEyIC0yNDUgLTEgLTE2MSAtNCAtMjA2IC0yNCAtMjk1IC0zMCAtMTM1IC0zNyAtMjkzIC0yMSAtNDM4IDExCi05MyAxMSAtMTI5IDEgLTE5MSAtMTIgLTcwIC0yNSAtMTE4IC0xMTAgLTQwMCAtNTIgLTE2OCAtNjMgLTI0OCAtNjUgLTQ1MQpsLTEgLTE4NSAzNiAtNzUgYzQ2IC05NiAxMDQgLTE2MCAxODcgLTIwOSAxNTEgLTg3IDMyMyAtMTE4IDQ0MCAtNzcgMTMwIDQ1CjMxMCAyMDQgMzYzIDMyMiA0MCA4OCA1NCAxODQgNDIgMjgxIC0xMCA3MyAtOTEgMzIxIC0xNzUgNTM4IGwtMzEgODAgMiAxODUKYzYgNDAzIC0zNyA2OTAgLTE2MSAxMDcwIC0xMTAgMzQwIC0xMzIgNDAwIC0xOTUgNTI1IC04NiAxNzEgLTEwMSAxOTEgLTE2NQoyMTAgLTU5IDE3IC02NSAxNyAtOTYgM3ogbTk3IC0xMjIgYzI5IC0zMSAxMDYgLTE2NSAxMzggLTI0MSAyOSAtNjkgMTY0IC00NzIKMTk4IC01OTAgMzQgLTExOSA1NiAtMjMyIDgxIC00MTAgMjEgLTE0NCAyNiAtNTU3IDggLTU3NSAtOCAtOCAtMzMgLTcgLTk1IDYKLTY2IDEzIC0xMTAgMTUgLTIxNCAxMCAtNzEgLTQgLTE1MCAtOSAtMTczIC0xMiBsLTQ0IC02IDggNzggYzUgNDQgNiAxMjAgNAoxNjkgLTMgNTAgLTUgMTU4IC01IDI0MCAwIDEzMCA0IDE2NyAyOSAyNzUgMjYgMTExIDI5IDE0MiAyOSAyODAgLTEgMTI1IC02CjE4MCAtMjcgMjg1IC00NCAyMTkgLTQ1IDM3NiAtMiA0NzkgMTcgNDIgMzQgNDUgNjUgMTJ6IG0yODIgLTE5MDAgYzQyIC04IDk3Ci0yMyAxMjMgLTM0IDQ3IC0yMSA2NiAtNDkgOTUgLTE0NCA1IC0xOCAyOCAtODUgNTEgLTE0OCA2OSAtMTkzIDkxIC0yNjEgOTYKLTMwNCA2IC00NCAtMTUgLTEzNSAtNDYgLTE5NiAtNTAgLTk4IC0xNjggLTIwNiAtMjg4IC0yNjIgLTU2IC0yNyAtNzEgLTMwCi0xNDAgLTI3IC02OCA0IC04OSAxMCAtMTcyIDUwIC0xMjEgNTggLTE5NyAxMjYgLTIzMyAyMDcgLTQyIDkyIC00OCAxNDcgLTM2CjI5MCAxMyAxNDggMzQgMjQ0IDg5IDQwMSAyMiA2MyA0MCAxMTYgNDAgMTE4IDAgMTIgNzcgMzYgMTUzIDQ3IDEyMCAxOCAxNzYKMTggMjY4IDJ6Ii8+CjxwYXRoIGQ9Ik0xOTUxMyA3Mzc1IGMtMzcgLTE2IC01NSAtNDggLTczIC0xMjUgLTYgLTMwIC0yNSAtMTAwIC00MiAtMTU1IC0zMwotMTEwIC00NSAtMTQ0IC0xNTQgLTQyMCAtMTA3IC0yNzMgLTE1MCAtNDQ1IC0xNzQgLTcwMCAtMzIgLTMyNSAtODUgLTY2OAotMTMyIC04NDUgLTEwIC00MSAtNDAgLTEzOCAtNjYgLTIxNSAtNDUgLTEzNSAtNDYgLTE0NCAtNDcgLTI2MCAwIC0xMTQgMgotMTIzIDMxIC0xODUgMzMgLTY5IDc2IC0xMTggMTkyIC0yMTggMTkwIC0xNjMgMzczIC0xODMgNjAyIC02NyAxNTEgNzYgMjE4CjE2MSAyNDYgMzEwIDM4IDIwMSAtNCA0MjIgLTEzNiA3MzAgbC01MiAxMjAgMTQgNjAgYzE5IDg3IDE3IDQxNyAtNCA1ODAgLTQ3CjM2MCAtNDYgNDY1IDEyIDg4NSAxNiAxMTIgMTIgMzY1IC01IDQwOCAtNDAgOTUgLTEyNiAxMzUgLTIxMiA5N3ogbTEwMSAtMTA0CmM1OCAtNjQgNjAgLTE5NiAxMCAtNTYzIC0xNiAtMTI0IC0xOSAtNTM0IC0zIC02NDMgMzYgLTI1OSA0NSAtNDMwIDI5IC01NjEKLTE0IC0xMTMgLTI3IC0xMzkgLTY1IC0xMzAgLTU2IDE0IC0yNTAgMTggLTM1OSA3IC0xNDUgLTE1IC0xNDkgLTEzIC0xMzUgNjkKMTEgNjEgMzUgMjU4IDQ5IDM5MCAzNiAzNTMgNzkgNTM0IDE5OCA4MjUgMzcgOTAgMTA5IDI4MyAxMzQgMzYwIDE1IDQ2IDI4IDk1CjQyIDE1NyAyMyA5OSA2MSAxMzMgMTAwIDg5eiBtMTEgLTIwMDUgYzMwIC0yMCAxMDEgLTE3MyAxNjUgLTM1NiA1MCAtMTQyIDUzCi0zNTYgNyAtNDUxIC03NSAtMTU1IC0zMTYgLTI4MCAtNDc5IC0yNDggLTY1IDEzIC0xMjQgNDcgLTIyNyAxMzEgLTEwMyA4NQotMTU1IDE1MyAtMTc2IDIzMyAtMjIgODEgLTE1IDEyOSA0OCAzMjUgMjQgNzQgNTAgMTYwIDU3IDE5MCAyNyAxMTMgNDIgMTYwCjUzIDE2NyA1NSAzNCA1MDMgNDEgNTUyIDl6Ii8+CjxwYXRoIGQ9Ik0yMDQ3MSA3MDMyIGMtNDggLTUxIC0xNzMgLTI5NyAtMjA0IC00MDIgLTU0IC0xODAgLTY4IC0yODIgLTY4Ci00NzUgMCAtMTMzIDUgLTIxNiAyMSAtMzE3IDQ0IC0yODQgNTcgLTQzNyA0OSAtNTUzIC03IC0xMTMgLTE1IC0xNDQgLTY5Ci0zMDAgLTc4IC0yMjQgLTk4IC00MTYgLTYyIC01ODcgMjUgLTExOCA1OSAtMTg3IDEyMCAtMjUxIDc2IC03OCAyMDQgLTEwMAozMjggLTU2IDEwMyAzNiAxNjcgNDggMjYyIDQ5IDc3IDAgMTA4IC01IDE4OCAtMzEgMTcyIC01NiAyNjcgLTMwIDM3MCAxMDMgMzQKNDQgNjMgOTcgODQgMTU1IDI5IDc3IDM0IDEwMyAzOCAyMTMgNSAxNTUgLTEzIDI1NSAtNzAgMzg0IC05NCAyMTUgLTE1MiAzNjYKLTIwMSA1MzEgLTE0IDQ1IC0yOSAxMTQgLTU3IDI2MCAtMTggOTAgLTMxIDI5OCAtMjUgNDAwIDUgOTAgMTQgMTYwIDQ1IDM3NwoxNCA5MiAxMiAxNTIgLTUgMjY2IC0yNiAxNzEgLTY1IDI2MyAtMTE0IDI3MCAtNDQgNyAtMTA5IC05IC0xNDggLTM1IC0zNyAtMjUKLTM4IC0yNSAtODMgLTkgLTI2IDkgLTc3IDE2IC0xMjAgMTYgLTQxIDEgLTkzIDcgLTExNSAxNSAtMjIgOCAtNjAgMTUgLTg0IDE1Ci0zOCAwIC00OSAtNSAtODAgLTM4eiBtMTQ0IC03OSBjMTAgLTEwIDE1IC0yNiAxMiAtNDIgLTIgLTE0IC0xNSAtODAgLTI4Ci0xNDYgLTIwIC0xMDYgLTIzIC0xNTEgLTIzIC0zNzUgLTEgLTI0MSAwIC0yNTggMjEgLTMwMiAxMiAtMjYgMzggLTYzIDU3IC04MwpsMzYgLTM2IDAgLTEyNyBjMCAtMTE1IDIgLTEzMCAyMCAtMTUwIDI1IC0yNiAzMyAtMjcgNTQgLTcgMTMgMTMgMTQgMzcgOSAxNTAKLTUgMTE3IC00IDEzNyAxMSAxNjAgNTAgNzcgODUgMjEyIDExNSA0NDUgMzggMjkyIDYxIDQyMSA4MyA0NjUgMzQgNjUgODYgODUKMTA3IDM5IDQ2IC0xMDMgNjUgLTMwMiA0MSAtNDM1IC03NCAtNDAzIC0zOCAtODQxIDk5IC0xMjE5IDE3IC00NiAzMSAtOTAgMzEKLTk4IDAgLTE2IDkgLTE2IC0zNjAgOCAtMTU3IDEwIC0zMDAgNyAtNDQ0IC0xMSAtNTYgLTcgLTgyIC03IC05MCAxIC03IDcgLTEyCjY2IC0xMyAxNTggLTEgODEgLTYgMTc5IC0xMiAyMTcgLTYgMzkgLTE3IDExNyAtMjYgMTc1IC01MiAzNDIgLTU2IDQ0NyAtMjUKNjM0IDI2IDE1MSA2NyAyNzQgMTM2IDQwNSA4MiAxNTUgMTA5IDE5MSAxNDQgMTkxIDE2IDAgMzYgLTcgNDUgLTE3eiBtMjEwCi0xNyBjNTAgLTIxIDU4IC00NCA0MSAtMTE4IC04IC0zNSAtMjIgLTEzMyAtMzEgLTIxOCAtMzAgLTI3OCAtODMgLTUwMSAtMTIwCi01MDQgLTUgLTEgLTIxIDIyIC0zNSA0OSAtMjIgNDUgLTI1IDY1IC0yOSAxOTUgLTQgMTUxIDcgMjYxIDQxIDQ0MCAzNCAxNzYKNDcgMTkyIDEzMyAxNTZ6IG0xNDUgLTE4MzcgYzgwIC02IDE4NyAtMTIgMjM4IC0xMyA1MSAtMiA5NyAtNyAxMDEgLTEyIDEyCi0xNCA4NyAtMTkzIDEwOSAtMjU5IDQ3IC0xNDYgMzcgLTMxNiAtMjcgLTQ0NCAtNDggLTk0IC04MSAtMTM1IC0xNDAgLTE3MwotNTMgLTMzIC05OCAtMzYgLTE1OSAtOCAtNTggMjYgLTE3OCA1MCAtMjUyIDUwIC03MSAwIC0xNzggLTIzIC0yNjggLTU2IC0zNwotMTQgLTg0IC0yNCAtMTE2IC0yNCAtNDUgMCAtNjEgNiAtMTA3IDM4IC00NCAzMCAtNjEgNTIgLTkyIDExMiAtNDcgOTMgLTYxCjE3MyAtNTMgMzEyIDYgMTIwIDMwIDIyMCA4NCAzNTIgMzQgODQgNDAgOTIgNzQgMTAzIDg5IDI5IDM3MiAzOSA2MDggMjJ6Ii8+CjxwYXRoIGQ9Ik00ODA0IDY5ODMgYy0yMCAtMTQgLTQyIC02NyAtNTQgLTEyOCAtOCAtNDIgLTEwIC0xNTQgLTUgLTM3NSAxMwotNjkyIDE4IC02MTAgLTU1IC05MTUgLTE3IC03MSAtNDAgLTE3MyAtNTAgLTIyNSAtMjIgLTEwOSAtMzUgLTE0NyAtMTE4IC0zNTUKLTgzIC0yMDggLTEwNiAtMzAzIC0xMDcgLTQ0MSAwIC0xMDcgMSAtMTEyIDM3IC0xODUgNDEgLTgzIDk1IC0xMzYgMTg4IC0xODUKNDkgLTI2IDY1IC0yOSAxNDUgLTI5IDg2IDAgOTMgMiAxNzIgNDMgMTEyIDU3IDE0MyA1NyAyNDggLTUgMTAyIC01OSAxNDkgLTczCjI1MCAtNzMgMTE5IDAgMTc3IDIxIDI0NiA5MCA2NiA2NiA4NCAxMTYgMTAxIDI4OCAxNSAxNDQgMiAyNDcgLTQzIDM1MiAtNjkKMTYyIC04NCAyNjMgLTc2IDQ5NCA0IDk0IDEyIDIxNiAxOSAyNzEgMTcgMTM3IDE3IDYwOCAwIDcwNSAtMjIgMTI4IC00MiAyMTMKLTYzIDI3MCAtNDAgMTA5IC0xNjEgMzE2IC0yMjQgMzg0IC0yNiAyOCAtMjkgMjggLTkzIDIyIC0zNyAtNCAtMTE1IC0xMSAtMTc0Ci0xNCAtNzkgLTYgLTExMSAtMTIgLTEyNiAtMjUgLTI0IC0yMiAtMjcgLTIyIC02OCAxMCAtMzYgMjcgLTEyNiA0MyAtMTUwIDI2egptNjEzIC0xODQgYzY3IC05NSAxNDggLTI1NyAxNjcgLTMzNCA4IC0zMyAyMCAtODIgMjYgLTExMCAxOSAtNzUgMjQgLTUyMCAxMAotNzEwIC03IC04OCAtMTUgLTIzNSAtMTcgLTMyNyAtMyAtMTEyIC05IC0xNzAgLTE3IC0xNzcgLTExIC05IC0xMDUgMiAtMzQxCjQyIC0xOTkgMzQgLTM1MiAyOSAtNDc0IC0xMyAtNzYgLTI3IC04NiAtMTcgLTY2IDY1IDE3IDY2IDgyIDM1NyA5NSA0MjAgNTIKMjU1IDU4IDM0NyAzNSA1MzAgLTI0IDE5NiAtMTkgNjE0IDggNjYzIDIyIDQwIDM4IDQwIDcxIDIgNDIgLTUxIDU3IC0xMTggMTQyCi02NDUgMjcgLTE3MSA1MiAtMjc3IDg0IC0zNjIgMTEgLTMwIDIwIC03MiAyMCAtOTQgMCAtNTAgMTUgLTc5IDQxIC03OSAyMSAwCjM0IDI0IDQ0IDgyIDMgMjEgMjUgNzUgNDkgMTIwIDU4IDExMiA3MSAxNzkgNzAgMzc4IDAgMTYwIC0xNyAzMzMgLTQ5IDUwNQotMTggOTkgLTE5IDEzMiAtMiAxMzggMjEgOCA1MSAtMTggMTA0IC05NHogbS0yMzcgNjYgYzM0IC0xNyAzMSAtNiA2NyAtMjI1CjI0IC0xNDEgMjggLTE5NCAyOCAtMzY1IDAgLTIxNiAtNCAtMjUyIC0zNSAtMzAzIC0xNiAtMjYgLTI0IC0zMSAtMzQgLTIzIC0yMgoxOCAtNTggMTk4IC05NiA0NzEgLTE3IDExOSAtMzggMjM0IC01NyAzMDcgLTEzIDUyIC0xNCA2NyAtMyA5MyAyNCA1NyA3MyA3NAoxMzAgNDV6IG0zMCAtMTc3NCBjNjkgLTExIDE2NiAtMjcgMjE1IC0zNSA1MCAtOSAxMDYgLTE2IDEyNiAtMTYgMjAgMCA0MiAtNgo0OCAtMTMgNiAtOCAyMiAtNTMgMzYgLTEwMSAxNCAtNDggMzYgLTEwOCA0OSAtMTM0IDQ3IC05MyA1NyAtMTk3IDMyIC0zMzkKLTIyIC0xMjEgLTYyIC0xODYgLTE0MSAtMjI2IC0xMDYgLTUzIC0xODEgLTQxIC0zNTAgNTggLTU2IDMyIC02NiAzNSAtMTQ0IDM1Ci04MCAwIC04OCAtMiAtMTYwIC00MiAtNjMgLTM0IC04NiAtNDEgLTEzMSAtNDIgLTk4IDAgLTIwOSA3NCAtMjU5IDE3NiAtMjcKNTMgLTMxIDcyIC0zMSAxNDMgMCA5NCAyMiAxODkgNzQgMzIyIDY2IDE2OCA3NyAxODMgMTQ4IDE4MyAxNyAwIDYxIDkgOTcgMTkKMzYgMTEgNzcgMjIgOTEgMjQgNjEgMTAgMTg1IDUgMzAwIC0xMnoiLz4KPHBhdGggZD0iTTIyOTYwIDY5MTAgYy0xMCAtMTAgLTMxIC0zNyAtNDQgLTU5IC0zNCAtNTQgLTQzIC01NyAtNzQgLTI4IC03NAo2OCAtMTIxIDcyIC0yMTMgMTUgLTQ5IC0zMCAtNTQgLTMxIC05MyAtMTkgLTEzMiA0MCAtMTQ2IDMwIC0zMjAgLTIyOSAtNTkKLTg5IC0xMDcgLTE4OSAtMTI4IC0yNzAgLTMyIC0xMjMgLTQ5IC0yMTYgLTY3IC0zNzAgLTEyIC05NiAtMjYgLTIwMCAtMzEKLTIzMCAtNSAtMzAgLTEyIC03MyAtMTUgLTk1IC03IC00MSAtOTIgLTMwNSAtMTM5IC00MjYgLTQxIC0xMDggLTY1IC0yNTcgLTc2Ci00NTggLTUgLTEwMiAtNyAtMjAzIC0zIC0yMjYgMTEgLTc3IDQ3IC0xMjUgMTQ4IC0yMDIgNjYgLTUwIDIyMyAtMTM0IDI3OAotMTQ5IDY4IC0xOCAxODIgLTE4IDI0MyAxIDcxIDIyIDEzMiAxOCAyMjYgLTEyIDExOCAtMzggMjExIC0zOCAyOTUgMSA3NSAzNAoxMzUgOTYgMTY5IDE3MiA3MyAxNjYgNDcgNTE0IC02MSA4MDkgLTU0IDE0NyAtNjYgMTk5IC03MiAzMTUgLTQgNzkgLTEgMTI3CjExIDE5MCAzNiAxNzQgNDUgMjg2IDM0IDM4MyAtMTUgMTMxIC00IDI2MiAzMiAzOTIgNDIgMTU1IDU0IDI1NyA0MSAzNDUgLTIyCjEzOCAtODUgMjA2IC0xNDEgMTUweiBtLTE5MCAtMTY2IGMyMiAtMjAgNDAgLTQ0IDQwIC01NCAwIC0xMCAtMTIgLTM3IC0yNgotNjEgLTE0IC0yNCAtNTggLTEwMCAtOTggLTE2OSAtNDAgLTY5IC03OSAtMTI1IC04NyAtMTI1IC0xMSAwIC0xNCAyOSAtMTcKMTY1IC0xIDEwMCAyIDE3NSA4IDE5MCA3IDE3IDMzIDM3IDczIDU3IDM0IDE4IDYzIDMyIDY0IDMyIDIgMSAyMSAtMTUgNDMgLTM1egptMjM4IDE0IGMyMiAtMjIgMTMgLTEzNyAtMjIgLTI3OSAtNDYgLTE4MyAtNjAgLTI3NiAtNTIgLTM0NiAxNSAtMTMzIDE4IC0yMzIKOCAtMjkzIC02IC0zNiAtMjAgLTExNyAtMzEgLTE4MCAtMjUgLTE0MSAtMjYgLTE4NSAtNCAtMzIzIDExIC02NyAxMyAtMTExIDcKLTExNiAtMTQgLTE1IC05NjcgLTE3IC05NzIgLTIgLTIgNiAxMCA0OCAyNiA5NCAzNiA5OSA4OCAyOTUgOTYgMzU3IDY5IDU5NAoxMDEgNzAxIDI3NSA5MzUgOTQgMTI1IDExMSAxNDEgMTM4IDEyNyAxNiAtMTAgMTggLTI5IDE5IC0yMjkgMCAtMTIwIDQgLTI3NAo4IC0zNDMgNyAtMTEwIDUgLTEzNiAtMTQgLTIxNSAtMTEgLTQ5IC00NCAtMTQwIC03MSAtMjAxIC01OSAtMTI5IC02MyAtMTc3Ci0xNyAtMTgyIDI1IC0zIDMxIDQgNzEgODUgNzEgMTQyIDEyNyAzNDEgMTI3IDQ1MSAwIDI0IDIxIDY5IDczIDE1NSA0MSA2NwoxMTMgMTkwIDE2MiAyNzIgMTU3IDI2NiAxNTAgMjU2IDE3MyAyMzN6IG0tNDIgLTE2NTAgYzUgLTYgNTggLTE2OCA3MiAtMjIzCjM5IC0xNTEgNDcgLTM1MSAxOCAtNDUwIC0xMCAtMzMgLTMzIC04NCAtNTIgLTExMyAtNjAgLTkyIC0xNjggLTEyNCAtMjg5IC04NgotMjcgOCAtODMgMjEgLTEyNCAyOSAtNzAgMTQgLTgxIDEzIC0xNjQgLTYgLTEyNCAtMjkgLTE5MyAtMjQgLTI4OSAyNCAtMTE3CjU3IC0yNjUgMTc0IC0yOTUgMjMxIC0xMyAyNSAtMTQgNTIgLTkgMTUzIDggMTM5IDI4IDMwOCA0NSAzNzAgNyAyNSAyMSA0OCAzNAo1NSAxMiA3IDY5IDE1IDEyNyAxOSAxMTYgNyA5MTggNCA5MjYgLTN6Ii8+CjxwYXRoIGQ9Ik0yODM4IDY4ODMgYy04NSAtOTIgLTk2IC0yMjggLTM5IC01MDggNTQgLTI2MCA3NCAtNDQ3IDc1IC02ODAgMgotMzQ5IC0yNyAtNTY1IC0xMDMgLTc4MCAtNTAgLTEzOSAtNTMgLTMzNSAtOSAtNTI1IDQ1IC0xOTUgNzEgLTI1MSAxMzMgLTI4Mgo1NyAtMzAgMTcxIC0zNSAyNTUgLTEzIDkxIDI0IDI1MiAzMCA0MDMgMTUgMjA4IC0yMiAzMTkgNCA0MTggOTYgNTcgNTQgODgKMTAzIDEyMyAxOTIgNjkgMTc3IDc5IDQ0MSAyMyA2NDIgLTE0IDQ3IC01NCAxNTkgLTkwIDI1MCAtOTQgMjM4IC0xMzEgNDEwCi0xNTYgNzMwIC0xNyAyMDkgLTUyIDMwMyAtMjM2IDYzMCAtNDIgNzQgLTg2IDE0NSAtOTggMTU4IC0yNCAyNiAtODMgMzAgLTEyNgo3IC0yMyAtMTEgLTYxIC0xMyAtMTg2IC0xMCAtMTQyIDQgLTE1OSA2IC0xNzEgMjQgLTggMTAgLTM1IDMzIC02MSA1MCAtNjIgNDEKLTExOCA0MyAtMTU1IDR6IG0xMjYgLTEwOSBjNTEgLTUwIDY5IC05MSAxMDUgLTIzOSA2MyAtMjU3IDk4IC0zMjAgMjQ2IC00NDkKbDQwIC0zNCAxMSAtMjQ0IGM3IC0xMzQgMTcgLTI2MCAyNCAtMjgxIDEwIC0zNSAxNCAtMzggNDMgLTM1IDMyIDMgMzIgMyAzMQo1OCAtMSAzMCAtNiAxMTggLTEzIDE5NSAtNiA3NyAtMTMgMjQxIC0xNiAzNjUgLTYgMjIxIC0xNiAzNjAgLTM2IDQ5MiAtNiAzNwotOCA3NiAtNCA4NiA3IDI1IDU4IDQ3IDc5IDM1IDIxIC0xMSAxNjYgLTI2MSAyMzIgLTM5OCA1NSAtMTEzIDg0IC0yMTggODQKLTMwMyAwIC00MyAzNyAtMzI0IDYwIC00NTIgMTEgLTYxIDU5IC0yMTcgOTIgLTI5NyAzNiAtODkgNjQgLTgzIC00MDQgLTgzCi00MTIgMSAtNTYyIDEwIC01ODkgMzcgLTEwIDEwIC0xMCA0OSAwIDE4MCAyNSAzNjMgOCA1OTAgLTc5IDEwNzEgLTI2IDE0MAotMjkgMTcwIC0yNCAyMDIgOSA0OCA1MSAxMzAgNjggMTMwIDcgMCAyOSAtMTYgNTAgLTM2eiBtMzEyIC03NyBjMjkgLTI1IDI5Ci0yOCA1MyAtMjMyIDYgLTQ0IDExIC0xMTggMTMgLTE2NSAzIC03MiAxIC04NSAtMTMgLTg4IC0yMiAtNCAtMTA0IDExOCAtMTMxCjE5NSAtMjggODAgLTY4IDI0MiAtNjggMjc0IDAgMzIgOSAzNyA3MiAzOCAzNSAxIDUzIC01IDc0IC0yMnogbS0xMTYgLTE1OTcKYzkxIC02IDI4OCAtOCA0NzYgLTQgMTc2IDQgMzMyIDQgMzQ2IDEgNzUgLTE5IDEyMSAtMzUwIDc0IC01MzcgLTQzIC0xNzAKLTExNSAtMjc4IC0yMTkgLTMzMCAtODMgLTQxIC0xMzcgLTQ1IC0yOTIgLTI1IC0xNTggMjEgLTI4NiAxNCAtNDE4IC0yMSAtMTA1Ci0yOSAtMTQxIC0yNiAtMTg3IDEzIC00MiAzNSAtNjMgODEgLTg4IDE4OCAtNjIgMjcyIC01OSAzMzYgMjcgNTc1IDE3IDQ3IDMxCjkwIDMxIDk3IDAgNiA1IDI0IDEwIDM4IDkgMjQgMTQgMjYgNDggMjEgMjAgLTMgMTA3IC0xMSAxOTIgLTE2eiIvPgo8cGF0aCBkPSJNMTQ0MCA2Nzk4IGMtMzMgLTE3IC01MSAtMzUgLTY4IC02OCAtMjIgLTQzIC0yMyAtNTIgLTE3IC0xODUgOAotMTk4IDI1IC0zNDQgNjAgLTUxNSA3IC0zNiAxOCAtOTAgMjQgLTEyMCA0MCAtMTk5IDUzIC01NTYgMjYgLTcyMyAtOCAtNTEKLTM2IC0xNTYgLTYxIC0yMzIgLTU1IC0xNjQgLTYzIC0yNDcgLTQ1IC00NDIgMTcgLTE4NCA1NiAtMjU1IDE2OSAtMzA1IDg0Ci0zOCAxNDIgLTQwIDMxMyAtMTMgMTU5IDI1IDMwNSAzMSAzODkgMTUgMjUgLTQgNjIgLTExIDgyIC0xNSA1NCAtMTEgMTA0IDIKMTQzIDM2IDY1IDU3IDEwOCAyMjYgMTA5IDQyOSAwIDIyMCAtNTQgMzY4IC0yMDUgNTYwIC0xNyAyMSAtNTAgMTAwIC04MiAxOTUKLTE2MSA0NzQgLTM1NiA5MzggLTUyMyAxMjQ0IC02OSAxMjggLTEwMCAxNTMgLTE5NiAxNTggLTYyIDQgLTgwIDEgLTExOCAtMTl6Cm0xNzMgLTk4IGM3NyAtNjcgMzE3IC01NzQgNDc1IC0xMDAwIDc2IC0yMDYgMTMyIC0zNzYgMTMyIC0zOTkgMCAtMjcgLTExIC0yOQotMjA1IC0zNSAtMTcwIC01IC0yODAgLTI3IC0zNzMgLTc1IC0yNCAtMTIgLTUzIC0yMSAtNjQgLTE5IC0yMSAzIC0yMSA4IC0yMwoyNzggLTIgMjIyIC03IDMwMSAtMjQgNDEzIC0xMSA3NyAtMjMgMTQyIC0yNiAxNDcgLTMgNCAtOSAzNiAtMTQgNzEgLTYgMzUKLTE3IDEwNyAtMjYgMTU5IC0xOCAxMDYgLTMxIDM4MyAtMjEgNDI0IDQgMTUgMjEgMzUgMzkgNDYgNDcgMjkgOTAgMjYgMTMwCi0xMHogbTY5NyAtMTU3NiBjMTI5IC0xNDIgMTkxIC0zNDAgMTY5IC01NDQgLTE4IC0xODEgLTY5IC0yOTAgLTEzMyAtMjkwIC0xNQowIC03MCA3IC0xMjQgMTYgLTExNCAxOSAtMTg4IDE1IC0zOTIgLTIwIC0xMTUgLTIwIC0xNTQgLTIzIC0xODkgLTE1IC04NSAxOQotMTM4IDU3IC0xNzQgMTI0IC0yMCAzNyAtMjIgNTQgLTIyIDIzNSAwIDE4OCAxIDE5NyAyNiAyNTUgMTQgMzMgMzMgODAgNDIKMTA1IDE2IDQzIDIxIDQ3IDk5IDgxIDIyNiAxMDAgMjU2IDEwNiA0OTEgMTA2IGwxNTggMCA0OSAtNTN6Ii8+CjxwYXRoIGQ9Ik0yNDI4MCA2NzcxIGMtNTAgLTI3IC01NyAtMzcgLTE2MiAtMjI2IC0yMDMgLTM2NiAtMjY3IC01MDQgLTM2MwotNzkwIC03MSAtMjEyIC05OSAtMzEzIC0xMTAgLTQwOSAtNyAtNTEgLTE0IC02NiAtNTAgLTEwNSAtNjQgLTcxIC0xNzUgLTI2NAotMjEyIC0zNzEgLTI5IC04NCAtMzMgLTEwNyAtMzMgLTIwMSAwIC03NyA1IC0xMjUgMTkgLTE3MCAxMSAtMzUgMjQgLTkxIDMwCi0xMjMgNiAtMzMgMTggLTcwIDI3IC04NCAyMCAtMzAgMTA3IC02OSAyMDEgLTkwIDcyIC0xNSA3MyAtMTUgMTYzIDEzIDEyNCAzOAoyMjcgMzMgMzUwIC0xNSAxNDggLTU4IDI1NiAtNDAgMzIyIDU1IDM4IDU1IDc2IDE5OCA4NyAzMjIgMTMgMTQ1IC0xIDI3MyAtNDMKNDA4IC0zMSAxMDEgLTQzIDE2MSAtNjcgMzQ1IC0xMSA4OSAtMTEgMzQyIDEgNDc1IDEwIDExMCAxNSAxNTAgNDQgMzQ1IDM1CjIzMSA0OCAzNTkgNDQgNDQxIC01IDEwMSAtMTggMTI2IC04NiAxNzAgLTU0IDM0IC0xMDkgMzggLTE2MiAxMHogbTExNCAtOTIKYzM2IC0yOCA1NiAtNzAgNTYgLTExNiAwIC0zNSAtMTYgLTE2NiAtNTUgLTQ0OCAtNDAgLTI4NSAtNDcgLTM2MSAtNTIgLTUxNQotMyAtMTMzIDAgLTE5MSAxNiAtMzAwIDEzIC04NiAxNyAtMTM4IDEwIC0xNDUgLTYgLTYgLTI0IC01IC01MiAzIC0xNjYgNDcKLTI1MCA2NSAtNDAxIDgzIC05NCAxMiAtMTc3IDI3IC0xODQgMzQgLTExIDEwIC0xMSAyNSAtMiA3NiAxNyAxMDIgNDAgMTg2IDcyCjI3MyAxNiA0NSA0NSAxMzEgNjUgMTkxIDQyIDEzMCAxMTYgMjk4IDIwMCA0NTAgMTcwIDMxMCAyMDcgMzczIDIzOCA0MDMgNDEKMzggNTMgMzkgODkgMTF6IG0tNTAxIC0xNTI5IGMyNTEgLTMzIDQ3OCAtMTAyIDUxNCAtMTU3IDMyIC00OCA2NCAtMjAzIDY1Ci0zMDggMSAtMTY5IC00NiAtMzQwIC0xMDggLTM5NCAtNDYgLTQxIC05NCAtNDEgLTE5OSAwIC0xMDcgNDIgLTI1NiA1MSAtMzU1CjIzIC05NCAtMjcgLTE4MiAtMjQgLTI1MiA4IC02MyAyOSAtNTkgMjIgLTEwOCAyMTQgLTM1IDEzOSAtMjUgMjIxIDQ2IDM2NyA5OAoyMDMgMTQ4IDI2NyAyMDggMjY3IDE5IDAgMTA0IC05IDE4OSAtMjB6Ii8+CjxwYXRoIGQ9Ik0xNTkwMCAzODA3IGMtMTI3IC0yOSAtMjU5IC0xMjcgLTMxMyAtMjMzIC01NSAtMTA4IC02MiAtMTU4IC02MgotNDI5IDAgLTMxMSAxMSAtMzY2IDEyNSAtNjE0IGw2MiAtMTM0IDkgLTIxNiBjNSAtMTE5IDExIC0yMjcgMTQgLTI0MSAyIC0xNAoxNiAtOTUgMzAgLTE4MCAyMyAtMTQ2IDM0IC0yMjMgNTYgLTM4NCAxOCAtMTM2IDYwIC0zNzMgODUgLTQ4MSA2MSAtMjYyIDEyOQotNDU0IDI0NiAtNzAzIDUwIC0xMDUgMTMzIC0xNTcgMTk4IC0xMjIgMjcgMTUgNjEgNjYgNzEgMTA4IDUgMjAgNCAyMzUgLTEKNDc3IC0xMCA0NDMgLTggNDk0IDI1IDcwMCAyOCAxNzUgMzUgMzE0IDI0IDQ3NyAtMjAgMzE4IC0yMiA0MDAgLTkgNTE3IDE0CjEzNyAxNCAxMzQgODAgMzI0IDg3IDI1MSAxMTIgMzU0IDE0MCA1NTggMTcgMTI2IDEgMTkxIC02MCAyNDIgLTE3IDE1IC00NiAzMQotNjUgMzYgLTQ1IDEyIC04MiAzOSAtMTg1IDEzNSAtMTEzIDEwNSAtMjMwIDE2NCAtMzQwIDE3MSAtNDMgMyAtOTkgLTEgLTEzMAotOHogbTI1MiAtMTIwIGM2NCAtMzYgMTM2IC05NCAyMTggLTE3NCAyNSAtMjUgNzcgLTYwIDExNyAtNzkgNDAgLTE5IDgyIC00Nwo5NCAtNjIgMTkgLTI0IDIxIC0zNSAxNSAtMTA3IC03IC04NSAtMjggLTIwNCAtNTMgLTI5NSAtNTEgLTE5MCAtMTUwIC00NTgKLTE3NCAtNDcxIC0zMyAtMTcgLTE2OCAtMjEgLTM3NCAtMTEgLTExMCA2IC0yMDcgMTMgLTIxNSAxNiAtMjIgOSAtOTYgMTUxCi0xMjYgMjQyIC01MSAxNTYgLTY2IDM2MyAtNDMgNTg1IDEyIDEyNSAzNiAxODIgMTA3IDI2MCA1MCA1NSAxNDQgMTE0IDIwNwoxMzAgMTYgNSA2MCA3IDk3IDUgNTQgLTMgNzggLTEwIDEzMCAtMzl6IG0tMjQgLTEyOTUgbDI0MyAtNyA3IC0yNzUgYzkgLTM5MAo3IC01ODQgLTcgLTY3MCAtMzMgLTIwNiAtMzYgLTI1NyAtMzUgLTU4MCAwIC0xODQgNCAtMzk4IDggLTQ3NSA3IC0xMTggNgotMTQ2IC03IC0xNzggLTMxIC03NCAtNzIgLTQzIC0xNDIgMTA4IC0xMjcgMjcyIC0xODIgNDQ1IC0yNDAgNzQ1IC00NiAyNDYKLTU2IDMxMCAtOTUgNjMwIC00IDM2IC0xOCAxMTkgLTMwIDE4NSAtMjQgMTMxIC00MyA1MDAgLTI3IDUyMiA2IDggMjIgMTEgNDYKNyAyMCAtMyAxNDUgLTkgMjc5IC0xMnoiLz4KPHBhdGggZD0iTTEzMzQzIDM3ODIgYy0yMyAtOSAtNTQgLTI3IC02OSAtNDAgLTQ5IC00NCAtNTYgLTc5IC03MCAtMzU3IC0yNwotNTM4IC0xNyAtNjExIDExNiAtNzc1IDU0IC02OSA1OCAtODMgMzQgLTE1MCAtMjUgLTcxIC0zMCAtMjc1IC05IC0zODUgMjYKLTEzNyAzNCAtMjU5IDQ0IC02NDUgOSAtMzE4IDEyIC0zNjggMzUgLTQ4MCAyOCAtMTM3IDUxIC0yMTMgOTAgLTI5MSAzNSAtNjgKOTMgLTEzOCAxMjMgLTE0NSA1MyAtMTQgMTEyIDM3IDE1NSAxMzMgMTkgNDIgMjAgNjkgMjMgMzQyIDEgMTkyIDggMzQwIDE4CjQyMSA4IDY5IDIwIDE4NCAyNiAyNTUgNyA3MiAxNiAxNzEgMjEgMjIyIDYgNTAgMTAgMTM0IDEwIDE4NyAwIDIwNiA3MyA1NjUKMTgwIDg4NiA1NiAxNjggNjQgMjExIDY0IDM1NSAwIDExMCAtNCAxNDEgLTIzIDIwMCAtMzEgOTEgLTQ3IDEyMiAtNzkgMTUyCi01MSA0NyAtOTUgNjIgLTIzOCA3OCAtNzcgOSAtMTgxIDI1IC0yMzIgMzYgLTExMiAyMyAtMTY0IDIzIC0yMTkgMXogbTE0NwotODIgYzM5IC0xMSAxOTMgLTM1IDMyNCAtNDkgMTA1IC0xMiAxNDEgLTMyIDE4OCAtMTA0IDM4IC01OSA1OCAtMTM5IDU4IC0yMzIKMCAtODggLTE4IC0xNzIgLTY5IC0zMjggLTIzIC02NyAtNTYgLTE3OCAtNzUgLTI0NyAtMTkgLTY5IC0zNyAtMTMzIC00MSAtMTQzCi0xMCAtMjQgLTQ2IC0zMSAtMTI5IC0yMiAtMzkgNCAtMTE0IDEwIC0xNjYgMTQgLTExMCA3IC0xMjYgMTUgLTE5MiA5MyAtOTEKMTA2IC0xMTIgMTczIC0xMTMgMzQ4IDAgMTk0IDIyIDU0OCAzNyA1OTUgMjMgNzAgOTIgMTAwIDE3OCA3NXogbTI1NyAtMTIxNgpjMTAyIC04IDEwOSAtMTQgOTUgLTkyIC0xNCAtNzIgLTMwIC0yNDMgLTQyIC00MzcgLTUgLTgyIC0xNiAtMjE1IC0yNSAtMjk1Ci0zNCAtMzIyIC00NSAtNTE0IC00NCAtNzE1IDEgLTE2NiAtMiAtMjE3IC0xMyAtMjQ1IC0xOCAtNDIgLTUyIC03NCAtNzEgLTY3Ci0xNSA2IC05NCAxNTEgLTEwOCAyMDAgLTQ0IDE1MCAtNjkgMzcxIC03MCA2MjIgMCAyNTcgLTEzIDQ3MCAtMzUgNTkwIC0zNgoxOTkgLTI0IDM4NSAyOCA0MzcgMjEgMjEgMzggMjEgMjg1IDJ6Ii8+CjxwYXRoIGQ9Ik0yNDE0MSAzNzc1IGMtMzAgLTE0IC03NCAtNDQgLTk4IC02NSAtMjMgLTIyIC01MSAtNDAgLTYwIC00MCAtMTAgMAotNDMgMTIgLTczIDI2IC04NyA0MSAtMTM5IDU0IC0yMjAgNTQgLTEzMiAtMSAtMjE3IC02MyAtMjkyIC0yMTcgLTQzIC04NyAtNDMKLTg5IC00NiAtMjEzIC02IC0xODYgMyAtMjEyIDE2OCAtNTEzIDQ5IC05MCAxMDUgLTI0NCAxNjAgLTQ0MiAyMSAtNzcgNTAKLTE3OSA2MyAtMjI2IDUwIC0xNzggMTQ2IC0zNjQgMjc3IC01MzggMTI4IC0xNjkgMjAzIC0yNDggMjQyIC0yNTMgNDQgLTcgOTYKNiAxMjIgMzEgMTIgMTIgMjggMjEgMzQgMjEgNyAwIDU2IC0yNSAxMTAgLTU1IDEwOSAtNjAgMTY3IC03NSAyMjcgLTU1IDQ4IDE2Cjc1IDYwIDc1IDEyMyAwIDUyIC0xMSA3OSAtNzUgMTc3IC05OSAxNTIgLTE2NyAzMTkgLTIwNCA0OTUgLTMwIDE0NyAtNjEgMzcxCi02MSA0NDEgMCAxMzEgNDggMzIxIDExMyA0NDkgMjkgNTggMzggODggNzIgMjQ2IDMwIDEzOSAzMSAxNjQgNyAyNTYgLTI5IDEwOQotMTAzIDIwNCAtMTk3IDI1NSAtMTMxIDY5IC0yNTQgODUgLTM0NCA0M3ogbTI1NCAtMTA0IGM4MiAtMzggMTUxIC0xMDYgMTkxCi0xODcgMjMgLTQ3IDI2IC02MiAyMSAtMTI2IC04IC0xMTcgLTQzIC0yNTcgLTkwIC0zNTkgLTUwIC0xMDYgLTg1IC0yMTcgLTk0Ci0yOTEgLTMgLTI3IC0xMiAtNTUgLTE5IC02MiAtMTkgLTE5IC02ODIgLTIzIC03MDYgLTQgLTkgNyAtMzEgNDkgLTQ4IDkzIC0xNwo0NCAtNjUgMTQxIC0xMDUgMjE1IC04NiAxNTggLTg5IDE2NCAtMTEwIDI2NSAtMTMgNjIgLTEzIDg4IC00IDEzOCAyNCAxMzYKMTI4IDI4MyAyMTUgMzA2IDUzIDE0IDkxIDYgMTg0IC0zNyA3NyAtMzYgMTYyIC01MSAyMTYgLTM4IDE0IDQgNDkgMjkgNzggNTUKMjggMjYgNjAgNTMgNzEgNjAgMzUgMjAgMTI0IDggMjAwIC0yOHogbTMgLTExNDQgYzcgLTcgMTYgLTY3IDIyIC0xMzMgMzEKLTM2MSAxMjQgLTY2MSAyNzQgLTg4OSAyNSAtMzggNDYgLTc3IDQ2IC04NiAwIC0xOSAtMjUgLTQ5IC00MSAtNDkgLTE0IDAKLTEyMiA1NiAtMTgyIDk0IC02NiA0MiAtODMgNjIgLTEwMSAxMTQgLTkgMjQgLTQwIDk1IC02OSAxNjAgLTEyOSAyNzkgLTE1NQozNDggLTE3NyA0NjQgLTExIDU2IC0yNiA3MyAtNTUgNjIgLTIyIC05IC0yMCAtMTAzIDQgLTE5NSAxOSAtNzQgMTEyIC0zMDIKMTY5IC00MTQgNTcgLTExNSA2NSAtMTgyIDIzIC0yMDQgLTE0IC04IC0yNSAtNiAtNDUgMTAgLTQ0IDM0IC0xODUgMjA5IC0yNTcKMzE3IC0xMTcgMTc2IC0xNTUgMjcyIC0yNTUgNjM1IC0xOCA2OSAtMjMgMTAxIC0xNiAxMTAgMTYgMTkgNjQ1IDIzIDY2MCA0eiIvPgo8cGF0aCBkPSJNMzg1MSAzNzgwIGMtMzAgLTQgLTg3IC0yNSAtMTI3IC00NSAtODQgLTQzIC0xMDcgLTQzIC0yMTkgLTEgLTE4Mgo2NyAtMzczIDkgLTQ2OSAtMTQzIC01NyAtODkgLTc3IC0yNTQgLTU3IC00NDYgMTUgLTEzNSAyMiAtMTY3IDczIC0zMjQgMzYKLTExMyA0MCAtMTMyIDM2IC0yMDAgLTYgLTk1IC0zMCAtMTY1IC0xMjMgLTM2MSAtODQgLTE3OCAtMTAwIC0yMjQgLTExNyAtMzM1Ci0yNCAtMTUxIC0xNyAtMjg4IDMxIC02NTAgMjUgLTE4NyAzNCAtMjE3IDcyIC0yNDkgMjUgLTIyIDQxIC0yNiA4OSAtMjYgMzMgMAo3MCA1IDg0IDExIDU0IDI1IDgzIDE0NyA4OSAzNzkgNCAxNDEgOSAxNzggMzIgMjU1IDMwIDEwNCA5MCAyMzUgMTY4IDM2NyAzMAo1MSA3MyAxMzAgOTYgMTc2IDIzIDQ1IDUwIDkxIDYxIDEwMiA0OSA0OSAxMTQgNiAxNTYgLTEwMSA0MyAtMTE0IDI4IC0yMTIKLTY5IC00NTQgLTIyIC01NSAtNTIgLTEzNCAtNjggLTE3NSAtMTUgLTQxIC00MyAtMTE0IC02MyAtMTYzIC02NSAtMTU2IC03MQotMzEzIC0xNiAtMzY5IDI1IC0yNSAzNiAtMjggOTAgLTI4IGw2MiAwIDcyIDcyIGMxNzcgMTc5IDI4NCAzNDQgMzY3IDU2NCAxMDMKMjczIDEyNSA1OTIgNjkgOTg1IC0xMCA2NSAtOSA2OCAyOSAxNTAgMjIgNDYgNDcgMTA3IDU2IDEzNCA5IDI4IDQzIDEwOSA3NQoxODEgNjggMTUyIDgzIDIyNiA2OCAzNDQgLTIxIDE3MyAtMTE2IDI5MiAtMjY3IDMzNSAtNjAgMTcgLTIxMiAyNiAtMjgwIDE1egptMTkyIC05MCBjODMgLTEyIDEzMCAtMzUgMTgzIC05MiA3MSAtNzQgMTExIC0xODEgOTggLTI2NyAtMyAtMjUgLTMyIC0xMDcKLTYzIC0xODEgLTMyIC03NCAtNzkgLTE5MCAtMTA2IC0yNTggLTQxIC0xMDMgLTU0IC0xMjYgLTc5IC0xNDAgLTI3IC0xNSAtODAKLTE3IC00NDYgLTE5IC0yMjggLTIgLTQyNSAtMSAtNDM3IDIgLTE1IDQgLTI2IDE5IC0zNiA1MyAtOSAyNiAtMjcgODAgLTQyCjEyMCAtNTggMTYxIC03OSA0MzIgLTQyIDUzOCAyOCA4MCA2OSAxMzYgMTMxIDE3OSA1NyAzOSA2MCA0MCAxNDUgNDAgNzQgLTEKOTQgLTUgMTQ2IC0zMCA0OCAtMjMgNzQgLTI5IDEzMCAtMjkgNjMgMCA3NyA0IDEzOCAzOCAxMDQgNTkgMTQ1IDY1IDI4MCA0NnoKbTQxIC0xMDYyIGMzNSAtNTggNDkgLTQ3OSAyMCAtNjU2IC01MyAtMzMwIC0xNzggLTU2NyAtNDQwIC04MzAgLTI4IC0yOCAtNTkKLTUyIC02OCAtNTIgLTIzIDAgLTM2IDMyIC0zNiA4NyAxIDYwIDEwIDk2IDUzIDIwMyAxNjkgNDIwIDIxNyA1NzIgMjE3IDY5MAotMSAxMDQgLTM4IDIzMCAtODIgMjc3IC00NyA1MSAtMTc1IDY3IC0yMzIgMzAgLTE0IC05IC01NCAtNzQgLTk0IC0xNDkgLTM4Ci03MyAtOTUgLTE3OSAtMTI1IC0yMzUgLTY1IC0xMTkgLTEyMSAtMjU4IC0xNDMgLTM1MCAtOCAtMzYgLTE5IC0xNDggLTI0Ci0yNDkgLTEzIC0yNTYgLTM0IC0zMjAgLTEwMCAtMjk5IC0zMCA5IC00OCA1MiAtNTkgMTQxIC02IDQzIC0xOCAxMjkgLTI3IDE4OQotOSA2MSAtMTggMTc5IC0yMSAyNjQgLTggMjI1IDcgMjg4IDEyMiA1MjYgNzYgMTU4IDEwNiAyMzkgMTI2IDM0MiA2IDM1IDE3CjY3IDI0IDczIDcgNiAxNjEgMTEgNDA2IDEzIDIxNyAxIDQxMSAzIDQzMSA1IDMwIDEgNDEgLTMgNTIgLTIweiIvPgo8cGF0aCBkPSJNOTcyMCAzNzU3IGMtMzAgLTEzIC0xMTAgLTU5IC0xNzcgLTEwMyAtNjcgLTQzIC0xNTAgLTk3IC0xODUgLTExOQotMTE3IC03NCAtMTQzIC0xNDQgLTEzNSAtMzY5IDYgLTE2MSAyMSAtMjM2IDcyIC0zNTYgMTUgLTM2IDQyIC0xMDMgNjEgLTE1MApsMzMgLTg1IDEgLTMwNSBjMSAtMTY4IDUgLTMzOSAxMSAtMzgwIDggLTY4IDE1IC0zMTMgMzcgLTE0MDAgOCAtMzgyIDEwIC0zOTcKNjQgLTQzNCA3MSAtNTAgMTg4IDI1IDI0OSAxNTkgNTMgMTE4IDEzOCAzOTMgMTcyIDU2MCAyMCA5NCA1MiAyNDcgNzMgMzQwIDIwCjk0IDQ3IDIyMCA2MCAyODAgNjggMzE0IDk3IDUzMiA4MyA2NDAgLTEzIDEwMiAtMTAgMjMwIDYgMjk0IDkgMzMgMzMgOTggNTQKMTQzIDc1IDE2NCAxMjMgMzUwIDE1MCA1ODQgMjMgMTk2IDcgMjk2IC03NSA0NjEgLTcyIDE0NCAtMTA0IDE4MSAtMTk2IDIyNAotNjggMzIgLTgxIDM0IC0xODggMzcgLTEwMiAyIC0xMjEgMCAtMTcwIC0yMXogbTI2MCAtNzggYzkwIC0yNCAxNTUgLTg3IDIyNAotMjE5IDYxIC0xMTcgNjggLTE1NSA2MyAtMzA4IC01IC0xNTYgLTI2IC0yOTcgLTYyIC00MjUgLTMwIC0xMDMgLTExMSAtMjgzCi0xMzEgLTI5MSAtNyAtMyAtNjAgLTEgLTExNiA0IC01NyA2IC0xNzMgMTUgLTI1OCAyMSAtMTcwIDExIC0yMDggMjEgLTIxNSA1MwotMiAxMSAtOSA0OCAtMTYgODEgLTYgMzMgLTMzIDExMiAtNTkgMTc1IC03MCAxNjggLTc3IDE4NyAtOTQgMjc0IC0yMCAxMDAKLTIwIDIxOCAtMSAyODQgMjAgNjUgNjAgMTEyIDEzMyAxNTMgMzEgMTggMTA1IDYzIDE2NCAxMDAgNTkgMzcgMTIyIDc2IDE0MAo4NSA2MSAzMyAxMzggMzcgMjI4IDEzeiBtLTI1NSAtMTMxNCBjMjY2IC0yMSAzMTUgLTI3IDMyMSAtMzcgMyAtNSA4IC0xMTYgMTAKLTI0NiA1IC0yMTEgMyAtMjUxIC0xNiAtMzYyIC0zMCAtMTc3IC0zNSAtMTk5IC04NiAtNDE1IC0yMiAtOTIgLTQzIC0xOTMKLTEwNSAtNDkwIC0zMCAtMTQ3IC0xMTMgLTQwOSAtMTY4IC01MjkgLTMyIC03MSAtODUgLTEzNiAtMTEwIC0xMzYgLTMxIDAgLTQxCjQ1IC00MSAxODggMCA3NSAtNSAyMjMgLTEwIDMyNyAtNiAxMDUgLTExIDMzNiAtMTEgNTE1IC0xIDE3OSAtOCA0MjIgLTE1IDU0MAotOCAxMTggLTE3IDMwNyAtMjEgNDIwIC01IDE4NiAtNCAyMDcgMTEgMjIzIDIxIDIwIDcgMjAgMjQxIDJ6Ii8+CjxwYXRoIGQ9Ik0xMjI5OSAzNzU2IGMtMiAtMyAtNDUgLTEwIC05NCAtMTcgLTUwIC02IC0xMjcgLTI1IC0xNzIgLTQxIC0xODAKLTY1IC0yNDMgLTE3NSAtMjQzIC00MjUgMCAtMTU0IDIyIC0yNzQgNzQgLTM5NyA3NyAtMTgyIDgwIC0xOTYgMTA2IC01MTYgNQotNjkgMTQgLTE2MyAyMCAtMjEwIDE0IC0xMjMgMjkgLTQxNyAzNSAtNzE1IDYgLTI4OSAxMyAtMzc2IDU2IC03MTAgMTEgLTg4CjQzIC0xNjIgOTIgLTIxMyA1OSAtNjIgMTAyIC0zOCAxNzUgOTggMTA1IDE5NiAxMzIgMzYwIDE1MyA5MjUgMTIgMzE1IDE5IDQyMgozOSA1NzAgMTQgMTAxIDggMjg4IC0xMSAzNDcgLTEwIDMyIC05IDQxIDEwIDczIDM2IDYxIDc4IDE2OCAxMDAgMjU2IDE5IDc0CjIzIDEzMSAzMyA0NjUgbDExIDM4MSAtMjQgNDQgYy0zOCA3MCAtODYgODggLTIzNSA4OSAtNjYgMCAtMTIzIC0yIC0xMjUgLTR6Cm0yNDMgLTEwMyBjNTggLTI5IDU5IC0zOSA0OSAtNDA1IC0xMSAtMzcwIC0xOSAtNDI4IC03OCAtNTY1IC0yMyAtNTUgLTQ3IC05NAotNzEgLTExNCBsLTM2IC0zMiAtMTYwIDUgYy05NSAzIC0xNzAgOSAtMTgzIDE2IC0yNCAxMyAtMzYgNDcgLTUzIDE0NiAtMTEgNjkKLTE3IDg4IC04NCAyNDkgLTQ0IDEwOCAtNjEgMjMwIC01MiAzNzEgOCAxMTUgMjAgMTQ4IDcyIDIwNiA2OCA3NiAxMzIgOTggMzY0CjEzMCAxMzkgMTkgMTg1IDE3IDIzMiAtN3ogbS0yNTkgLTEyMDggYzExNCAtMSAxNTEgLTUgMTU3IC0xNiA1IC03IDE0IC00NSAyMQotODMgMTEgLTY3IDEwIC05OCAtMTEgLTI5NiAtOSAtODkgLTMxIC00NDggLTUwIC04MTAgLTE0IC0yODggLTMzIC0zODUgLTEwNgotNTM3IC01MCAtMTA2IC02OCAtMTE2IC0xMDQgLTU4IC00OSA4MCAtNzUgMzYyIC0xMDAgMTEwNCAtNiAxNjggLTE1IDMzNiAtMjAKMzc1IC00MSAzMTcgLTM4IDM0NCAyOSAzMzAgMjAgLTQgMTAzIC04IDE4NCAtOXoiLz4KPHBhdGggZD0iTTE3MjcwIDM3NTEgYy0xNjUgLTU0IC0zMTUgLTI0NSAtMzY2IC00NjYgLTIyIC05NyAtMTIgLTE3NiAzNyAtMjk3CjUxIC0xMjQgMTEzIC0zMjMgMTI4IC00MTMgNyAtMzggMTcgLTg2IDIxIC0xMDUgMjIgLTg3IDUwIC0yOTggNTAgLTM3NyAwIC00OQotNSAtMTM5IC0xMCAtMjAxIC0xMyAtMTQ1IC0xIC0yMjIgNTcgLTM3MSA2NCAtMTY0IDgzIC0yNzkgODMgLTUxMCAwIC0xNTAgNAotMTk5IDE4IC0yNTIgMzMgLTEyMCA5OCAtMjA5IDE4NSAtMjU1IDUwIC0yNiA1NyAtMjcgODcgLTE0IDI0IDEwIDM5IDI3IDU2CjY0IDIzIDQ4IDI0IDYyIDI0IDI2MSAwIDE4MiAxNCAzNzkgNDUgNjc1IDEyIDExMCA3NSA0OTggOTcgNjAwIDggMzMgMTMgMTM3CjEzIDI1NyAwIDE5NSAxIDIwMiAyMyAyMjUgMTIgMTQgMjIgMjggMjIgMzIgMCA1IDQzIDk3IDk1IDIwNSAxMDkgMjI3IDEyOQoyOTMgMTIzIDQwMiAtNCA2MCAtMTAgODYgLTMxIDEyMiAtMzQgNTggLTEzMCAxNDAgLTIzMyAxOTggLTQzIDI2IC0xMjQgNzIKLTE3OSAxMDMgLTU1IDMyIC0xMjIgNzIgLTE0OSA4OSAtMzggMjUgLTYwIDMyIC0xMTAgMzQgLTMzIDEgLTcyIC0xIC04NiAtNnoKbTEzMSAtMTA0IGM2MSAtNDEgMjAyIC0xMjQgMjY3IC0xNTYgMTQ4IC03NSAyNTUgLTE2MCAyOTQgLTIzNSAzNyAtNzIgMjUKLTEyNSAtNzkgLTM0MSAtNTAgLTEwNSAtOTYgLTIwNCAtMTAzIC0yMjIgLTIwIC01NCAtNDIgLTY0IC0yMDcgLTEwMCAtMjQwCi01MSAtMzA5IC01OSAtMzYzIC00MiAtNTAgMTYgLTQyIC0yIC05OSAyMTMgLTE3IDY1IC01NCAxNzQgLTgxIDI0MiAtNTggMTQzCi02MyAxOTYgLTI5IDI5NyA2MCAxODEgMjMzIDM2NyAzNDAgMzY3IDE0IDAgNDEgLTEwIDYwIC0yM3ogbTI5NyAtMTE2MCBjMzQKLTcwIDI2IC0yNDIgLTIyIC01MTIgLTgwIC00NDAgLTEwNiAtNjc3IC0xMTIgLTEwMzAgLTMgLTE1NCAtMTAgLTI5NSAtMTYKLTMxMiAtMTQgLTQ2IC00MiAtNDMgLTkwIDkgLTg2IDkzIC05OSAxNDMgLTEwOCA0MjMgLTkgMjQ0IC0yMiAzMzggLTY2IDQ1NAotODMgMjE3IC04NSAyMzUgLTYyIDQ2OSAxMSAxMTIgMTAgMTM3IC0xMCAyNzkgLTE2IDExNSAtMTkgMTYwIC0xMSAxNzAgOCA5CjM3IDEzIDg4IDE0IDUwIDAgMTI2IDEyIDIyMSAzNCA4MCAxOSAxNTIgMzMgMTYwIDMyIDggLTEgMjEgLTE1IDI4IC0zMHoiLz4KPHBhdGggZD0iTTE4Njk3IDM3NDYgYy0yMSAtOCAtNTcgLTI2IC04MCAtNDEgLTU1IC0zNiAtMjMwIC0yMTYgLTI3MyAtMjgwCi03MiAtMTA3IC04MCAtMjQxIC0yNCAtMzk5IDY2IC0xODkgMTE1IC00NjQgMTQwIC03OTYgNiAtNzQgMTMgLTE2NiAxNiAtMjA1CjYgLTc1IDI4IC0yNjggNDQgLTM3NSAxNSAtMTA5IDMwIC0yMjEgNDAgLTMxNSAyNCAtMjE2IDY5IC00NTcgMTAxIC01NDUgNTEKLTEzOSAxMzIgLTI2NiAxODkgLTI5NSA2NiAtMzQgMTQ3IC05IDE4MCA1NSAzNiA3MCA0MyAxNDggMjQgMjUzIC0xNyA5MSAtMjcKMTcxIC00MCAzMjAgLTE0IDE1NCAyNyA0NzkgMTAxIDgwNyA5NiA0MjMgMTA1IDQ2OSAxMDUgNTM2IDAgNDggOCA3MCA2NCAxNzcKNjQgMTIyIDEwNCAyMTQgMTkwIDQ0NCA3MSAxODkgNjQgMjczIC0zMCAzNDYgLTE4NCAxNDMgLTQyNyAyOTEgLTUxOSAzMTYgLTU1CjE1IC0xODIgMTMgLTIyOCAtM3ogbTE3OCAtODAgYzU5IC0xNSA4NyAtMjkgMjIwIC0xMDkgMTIwIC03MiAzMjEgLTIyMSAzMzYKLTI0OSAxNyAtMzIgNyAtNjcgLTc2IC0yNzggLTg3IC0yMjEgLTE3OCAtNDA1IC0yMTIgLTQyNyAtMzIgLTIxIC0xNjcgLTkKLTMxMyAyOCAtMzE5IDgwIC0zMjMgODIgLTM0MiAxMjAgLTkgMTkgLTI0IDY4IC0zNCAxMDkgLTkgNDEgLTMyIDEyMiAtNTAgMTc5Ci01MiAxNTggLTUzIDE5MSAtOSAyODAgMjcgNTYgNTggOTcgMTIzIDE2NCAxMDUgMTA3IDE2OSAxNTUgMjM2IDE3OSA2MiAyMSA1OQoyMSAxMjEgNHogbS0yNDAgLTEwODcgYzE5MCAtNTYgMzA5IC03OSA0MDUgLTc5IDQ4IDAgNzEgLTQgODAgLTE1IDE4IC0yMSA4Ci05OCAtMzQgLTI4MCAtNTIgLTIyNiAtMTEzIC01MzUgLTEzMiAtNjcwIC0yNyAtMTkwIC0yNSAtNTExIDUgLTY5MSAxNSAtOTAKMjEgLTE1NSAxNyAtMTc5IC03IC0zNyAtNDUgLTg1IC02NyAtODUgLTIzIDAgLTg4IDgzIC0xMjkgMTY0IC00MiA4NiAtODEgMjIxCi05OSAzNDcgLTIxIDE0MiAtNDAgMjg1IC01MSAzNzkgLTYgNTIgLTIxIDE2OSAtMzQgMjYwIC0xNCA5MSAtMjkgMjIxIC0zNQoyOTAgLTYgNjkgLTIwIDIyMyAtMzIgMzQzIC0xMSAxMTkgLTE3IDIyMiAtMTQgMjI3IDkgMTUgNDMgMTIgMTIwIC0xMXoiLz4KPHBhdGggZD0iTTIxNzU0IDM3MTYgYy00OSAtMjQgLTExMCAtNjIgLTEzNSAtODQgLTg4IC03OCAtMTM3IC0yMTQgLTEyNSAtMzQ0CjggLTkyIDM0IC0xNTYgMTE4IC0yODkgMTQ3IC0yMzYgMTcyIC0zMTYgMTQ5IC00ODkgLTYgLTQ3IC0yMCAtMTU1IC0zMSAtMjQwCi0yNSAtMTkxIC0yNSAtMjM3IDAgLTM3MCAyMCAtMTE0IDQyIC0xNzcgMTE4IC0zNDUgNjcgLTE0NyAxMTQgLTIzMCAyMzggLTQxNQoxMjUgLTE4OCAxNDQgLTIwNSAyMzQgLTIwNSAxMTMgMCAxNTUgNDYgMTU0IDE2NyBsMCA3OCAtMTM2IDI3NyBjLTc1IDE1MwotMTQxIDI5OSAtMTQ3IDMyNSAtMjUgMTA3IC04IDMyNCAzMiA0MTkgMjYgNjQgNzggODQgMTM1IDU1IDUxIC0yNiAyMjggLTMwNQoyNzcgLTQzNSA4IC0yMyAyMSAtNTggMjkgLTc4IDUzIC0xNDIgOTYgLTM3NiA5NiAtNTI1IDAgLTEwMyAyIC0xMTIgMzQgLTE3Ngo0OCAtOTYgNjQgLTEwNyAxNDUgLTEwNyA3OCAwIDExNiAxNiAxMzcgNTggMTkgMzUgMzMgMjExIDQxIDQ5MiA4IDMxNyAtMjEKNDc2IC0xMzMgNzE0IC04MyAxNzUgLTg4IDE5NyAtODggMzcxIC0xIDE3MCA4IDIyMCA2OSAzODUgNTggMTU4IDcwIDIxOSA3MAozNTAgLTEgMTEzIC0yIDEyNCAtMzEgMTg1IC02MiAxMzIgLTE5OCAyMjggLTM1NiAyNTEgLTY5IDEwIC04NCA5IC0xNDYgLTEwCi00NSAtMTMgLTg5IC0zNiAtMTI3IC02NiAtMzIgLTI0IC02MSAtNDMgLTY0IC00MSAtMyAxIC00NCAyNiAtOTEgNTMgLTExNyA3MAotMTYxIDgzIC0yNzkgODMgLTk1IDAgLTEwMCAtMSAtMTg3IC00NHogbTMyMSAtNzAgYzI4IC0xMyA4OCAtNDggMTM0IC03OSAxMTAKLTc0IDEzMCAtNzUgMjAyIC02IDMwIDI4IDc3IDYyIDEwNiA3NiA0NyAyMSA1NyAyMyAxMTMgMTQgMjE4IC0zNSAzNTYgLTIxNQozMjAgLTQxOCAtNiAtMzYgLTMzIC0xMzMgLTYxIC0yMTYgLTI3IC04NCAtNTggLTE5MSAtNjcgLTI0MCAtMTAgLTQ4IC0yMyAtOTIKLTI4IC05NyAtMTkgLTE5IC0yMTcgLTMzIC0zODkgLTI2IC0yMDcgNyAtNDU1IDM2IC01MzcgNjIgLTkgMyAtMjYgMzAgLTM3IDYwCi0yOCA3NSAtNzQgMTYzIC0xMzMgMjU4IC05MiAxNDYgLTExOCAyMTEgLTExOCAyOTIgMCA1OSA1IDgxIDMwIDEzMSA1MyAxMDYKMTY4IDE5MyAyODIgMjEyIDY4IDEyIDEyMCA1IDE4MyAtMjN6IG0tMzUgLTEwNTggYzExOSAtMTcgMTkzIC0yMSA0MTAgLTIyCjE0NiAtMSAyNzkgMiAyOTcgNiA0OCAxMSA2MyAtMTAgNjMgLTg3IDAgLTEwNCAyNCAtMTgxIDExMCAtMzYwIDMxIC02NCA2MAotMTQ0IDc5IC0yMjQgMzAgLTEyMCAzMSAtMTMwIDMxIC0zNTUgMCAtMjA3IC0xMSAtNDExIC0yNSAtNDczIC03IC0zMCAtNDgKLTU2IC03NSAtNDggLTM1IDExIC04MCAxMTQgLTgwIDE4MyAwIDEzNyAtNDUgMzg2IC0xMDEgNTU1IC02MSAxODYgLTIwOCA0NTUKLTI5NiA1NDMgLTc2IDc2IC0yNDYgNjYgLTI4OSAtMTcgLTU0IC0xMDUgLTc5IC0zNDggLTUzIC01MDggMTMgLTgyIDU2IC0xODYKMTc2IC00MjggMTEwIC0yMjAgMTIxIC0yNjYgODAgLTMwNyAtMTQgLTE0IC0zMyAtMjYgLTQyIC0yNiAtNzAgMCAtMzMyIDQwMAotNDQ1IDY3OSAtODYgMjE0IC05NyAzMzIgLTU5IDYyNiAxMiA4OCAyNCAxODQgMjggMjEzIDYgNDYgMjEgNzEgNDEgNzIgMyAwCjcxIC0xMCAxNTAgLTIyeiIvPgo8cGF0aCBkPSJNMTUwOCAzNzM1IGMtMTM0IC0zNyAtMjkxIC0xNzkgLTMzOSAtMzA2IC0yMyAtNTkgLTI1IC0xOTUgLTUgLTI0OQo3IC0xOSA0OCAtMTI5IDkwIC0yNDUgNDMgLTExNSA4OCAtMjM3IDEwMSAtMjcwIDUyIC0xMzIgNTEgLTExOSAxNiAtMjY2IC0xOAotNzQgLTM2IC0xNTQgLTQyIC0xNzkgLTY5IC0zMTEgLTExOCAtNDU0IC0xOTggLTU4MiAtOTQgLTE0NyAtMTAxIC0xNjEgLTEwMQotMjExIDAgLTU1IDIwIC0xMDEgNTIgLTExOCA0MyAtMjMgMTkwIDE1IDI3OCA3MSA1MiAzMyA3MSAzMiA4OCAtNiAxNiAtMzQgNzEKLTU4IDExNSAtNTAgNTQgMTAgMTU0IDgwIDI0MiAxNzEgMTI3IDEzMSAyMTIgMjg1IDMyMiA1ODUgODYgMjM2IDEzOCAzNjkgMTYzCjQyMCAxNSAzMCAzMCA2OSAzNCA4NSA0IDE3IDQ3IDExMSA5NiAyMTAgNDkgOTkgMTA4IDIzMiAxMzEgMjk1IDQxIDEwOSA0MwoxMjEgNDMgMjI1IDAgOTggLTMgMTE2IC0yNiAxNjYgLTYyIDEzNSAtMTkyIDIxOSAtMzM4IDIxOSAtMzAgMCAtOTMgLTEyIC0xMzkKLTI1IC0xMjAgLTM1IC0xNzkgLTMzIC0yNjkgMTAgLTEzNiA2NSAtMjE1IDc4IC0zMTQgNTB6IG0yMzMgLTEyMSBjMTM4IC02MwoyMDAgLTcyIDMwOSAtNDQgMTY0IDQyIDE4OSA0NSAyNTIgMjYgODcgLTI1IDE2OSAtMTA1IDE5OSAtMTkzIDI2IC04MCAyMwotMTE2IC0yNyAtMjYyIC00OSAtMTQ1IC0yMDMgLTQ2MSAtMjM5IC00ODkgLTI3IC0yMiAtMzIgLTIyIC0zODcgLTIyIGwtMzU5IDAKLTIyIDIzIGMtMzEgMzAgLTIzNyA1OTQgLTIzNyA2NDYgMCA5NiAxMjEgMjU1IDI0MSAzMTYgMTEwIDU3IDE0NSA1NyAyNzAgLTF6Cm00NTQgLTEwODQgYzMgLTUgLTE3IC03MSAtNDUgLTE0NyAtMjggLTc2IC03MSAtMTk0IC05NiAtMjYzIC0xMTIgLTMwNyAtMjMzCi00OTggLTM5NyAtNjI4IC05MSAtNzIgLTEwMCAtNzYgLTEzMSAtNTEgLTMzIDI2IC0zNCA2MiAtMiAxMDMgNTQgNzEgMTMxIDI1MgoyMzYgNTU0IDMzIDk1IDI5IDEzMiAtMTQgMTMyIC0zMiAwIC0zOSAtMTEgLTcxIC0xMTAgLTQyIC0xMjggLTE0MiAtMzc4IC0xNzYKLTQzNyAtODMgLTE0NSAtMTgwIC0yMzMgLTI5NCAtMjY5IC00NCAtMTQgLTU3IC0xNSAtNjkgLTQgLTI0IDE5IC0yMCAyOSAzMAoxMDUgODkgMTM0IDE1NiAzMDAgMjA0IDUwMSAxMSA0OSAyNiAxMTQgMzQgMTQ0IDcgMzAgMTkgODIgMjcgMTE1IDMzIDE1MyA1OQoyNDkgNzEgMjU2IDE5IDEyIDY4NSAxMSA2OTMgLTF6Ii8+CjxwYXRoIGQ9Ik0xMTEzMiAzNzM5IGMtNDUgLTUgLTExNSAtMTggLTE1NSAtMzAgLTM5IC0xMSAtMTA0IC0yOSAtMTQzIC00MAotMTAyIC0yOSAtMTg0IC03OCAtMjExIC0xMjQgLTMxIC01NSAtMzYgLTExMSAtMjQgLTI0OSA2IC02NiAxNSAtMTg2IDIxIC0yNjYKMjAgLTI3MyA0NyAtNDA0IDEyNiAtNjE2IDMzIC05MSAzMyAtOTIgNDQgLTM1MCA1IC0xNDMgMTcgLTM0OSAyNSAtNDU5IDgKLTExMCAxOSAtMjYzIDI1IC0zNDAgNSAtNzcgMTggLTI2OCAyOSAtNDI1IDExIC0xNTcgMjMgLTM1MiAyNiAtNDM1IDQgLTEwMAoxMSAtMTYyIDIyIC0xODYgMzAgLTczIDExNyAtMTA2IDE2NCAtNjQgMjggMjYgOTUgMTQwIDEyMSAyMDcgMzAgNzggNTUgMTkwCjY3IDMwMyAxNyAxNTUgNTIgNzE5IDcyIDExNTAgMjkgNjQwIDIzIDU5NSAxMDIgNzg3IDQwIDk2IDUxIDE0MiA3MiAyOTMgOSA2MQoyMSAxNDQgMjggMTg1IDcgNDIgMTIgMTY4IDEyIDI4NSAwIDE3NyAtMyAyMTcgLTE4IDI1NiAtNDQgMTE0IC0xNDggMTQ1IC00MDUKMTE4eiBtMjU4IC05NyBjMjEgLTEwIDQ1IC0zNCA2MCAtNjIgMjQgLTQyIDI1IC01MyAyNSAtMTk1IDAgLTE0MyAtNSAtMTk0Ci0zOSAtNDU1IC0xNyAtMTI0IC00NiAtMjMxIC05NSAtMzQ5IC0xNyAtNDAgLTM2IC05MSAtNDEgLTExMiAtNiAtMjIgLTIxIC00NgotMzMgLTUzIC0yOSAtMTkgLTI1OSAtNDEgLTMzMSAtMzIgLTMxIDQgLTY1IDE1IC03NiAyNCAtMzEgMjYgLTg2IDE3NCAtMTE0CjMwNyAtMjYgMTI3IC01MCAzNTYgLTYxIDU4NiAtOCAxNzcgLTIgMTk1IDg3IDIzNyAxODcgOTAgNTMyIDE0OCA2MTggMTA0egptLTEyNSAtMTUzNyBjLTEgLTIxOSAtMjAgLTYwMyAtNjUgLTEyNjAgLTE3IC0yNDkgLTQ5IC0zODIgLTEyMyAtNTIwIC0zOSAtNzMKLTY5IC04NSAtODUgLTMzIC02IDE4IC0xMyA5MSAtMTcgMTYzIC0xMiAyNjIgLTI0IDQ2NCAtMzkgNjUwIC04IDEwNSAtMjAgMjYwCi0yNiAzNDUgLTYgODUgLTE1IDE5NiAtMjAgMjQ3IC02IDUwIC0xMCAxMzggLTEwIDE5NSAwIDU3IC01IDE2MiAtMTAgMjMzIC01CjcyIC03IDEzOCAtNCAxNDcgNCAxNSAyMyAxOCAxMzcgMjEgNzMgMiAxNjEgMyAxOTcgMyBsNjUgLTEgMCAtMTkweiIvPgo8cGF0aCBkPSJNNTAzMiAzNzEwIGMtMTEwIC0zOSAtMTY3IC05MCAtMjIyIC0xOTkgLTQxIC04MSAtNTAgLTEzMCAtNTAgLTI3MgowIC0xOTggMzYgLTM3MiAxMTAgLTUzNSAzMCAtNjYgMzEgLTc1IDMyIC0yMDQgMSAtMTU3IC05IC0yMTkgLTY0IC0zOTAgLTczCi0yMjggLTEwNyAtMzczIC0xMzkgLTU5MyAtMTcgLTExOCAtMjEgLTE5MSAtMjEgLTQzMiAwIC0yODEgNyAtMzc4IDM0IC00MjkgOQotMTYgMTkgLTE4IDc1IC0xMyA0MiAzIDc1IDEyIDkyIDI0IDMzIDI0IDY3IDkyIDgxIDE2MyA0MCAxOTUgMTE0IDQ2NiAxODIKNjY1IDc5IDIzMCAyNDAgNTczIDI4MyA2MDEgMjcgMTggNTcgNyA3NSAtMjYgMTQgLTI3IDI4IC0xNTYgMzkgLTM3MCA3IC0xMTcKMTcgLTIwMiAzMCAtMjU1IDExIC00NCAyMSAtOTYgMjEgLTExNSAwIC01NSAtMzUgLTE3OCAtNzUgLTI2NSAtNTIgLTExMyAtOTIKLTIyNCAtMTAwIC0yNzYgLTkgLTYzIDI2IC0xMjggNzggLTE0OCA2NSAtMjQgMTA3IC00IDIxMiAxMDMgNzIgNzIgMTAwIDExMAoxMzcgMTgxIDI1IDUwIDUxIDEwNiA1NiAxMjUgNTcgMTk1IDc5IDMxNCAxMjEgNjY1IDI5IDIzNCAzNSA0MDcgMjEgNjAyIGwtMTIKMTcxIDI2IDY0IGMxMjMgMzA5IDE2NiA1OTUgMTIxIDgxNyAtNDEgMjAxIC0xMTAgMjk3IC0yNDAgMzMyIC02MyAxOCAtMTkwIDYKLTI2NiAtMjUgLTg4IC0zNSAtMTczIC0zNSAtMjQ3IC0xIC04OSA0MSAtMTUwIDU1IC0yNDYgNTUgLTY0IC0xIC0xMDcgLTYKLTE0NCAtMjB6IG0zNDUgLTExOSBjMTMxIC01MyAxNzYgLTU0IDMxOSAtNiAxMjggNDMgMTg5IDQ2IDI0OSAxMCA2OSAtNDAgMTIwCi0xMjEgMTUwIC0yMzYgMjAgLTc2IDIzIC0yNzQgNSAtMzcwIC0zMCAtMTYzIC0xMTcgLTQwNCAtMTUwIC00MTQgLTkgLTMgLTUyCjQgLTk2IDE1IC0yMzIgNjAgLTQwOSA4NyAtNjY0IDEwMCAtMTAzIDUgLTE5NSAxMyAtMjA0IDE2IC0yMSA4IC01NiA3NyAtODQKMTY0IC00MCAxMjMgLTU2IDIyOSAtNTYgMzY1IDAgMTQ3IDE1IDIwMyA4MSAyODIgNzkgOTcgMTQxIDEyNSAyNjMgMTE5IDcxIC0zCjEwMiAtMTAgMTg3IC00NXogbTgzIC0xMDIwIGM3NSAtMTIgMTc2IC0zMCAyMjUgLTQwIDUwIC0xMSAxMTUgLTI1IDE0NSAtMzIKNjkgLTE0IDEwNyAtMzQgMTE0IC01NiAyNyAtOTQgMzYgLTQxNSAxNiAtNTgzIC02MiAtNTEzIC05OSAtNjkzIC0xNzUgLTg0NwotMzYgLTczIC02NCAtMTEyIC0xMzIgLTE4MyAtNzEgLTc1IC05MSAtOTAgLTExMiAtODggLTIzIDMgLTI2IDggLTI5IDQ0IC0yCjMzIDkgNjkgNTQgMTcwIDc0IDE2NyA5MyAyMzAgMTAwIDMzNCA1IDYzIDIgMTA0IC0xMSAxNTUgLTkgMzkgLTIzIDE1OCAtMzAKMjY1IC0yMCAyNzQgLTM0IDQwMCAtNDggNDI5IC0xNyAzNSAtNjIgNTUgLTEyNyA1NSAtODggMSAtMTA1IC0xNyAtMjAwIC0yMTIKLTE0NyAtMzAwIC0yMzEgLTUzNyAtMzMyIC05NDYgLTUwIC0yMDMgLTY3IC0yNTYgLTg3IC0yNzUgbC0yNCAtMjUgLTE4IDIyCmMtNTAgNjMgLTQ1IDQ5OSAxMSA4NTcgMTMgODIgNzAgMzAzIDExOSA0NTUgNTUgMTczIDcxIDI2NCA3MSAzOTQgMCA3NiA0IDExNgoxMyAxMjUgMTcgMTkgMjgyIDggNDU3IC0xOHoiLz4KPHBhdGggZD0iTTY5OTAgMzcwNiBjLTY4IC0yNCAtMTc3IC04NSAtMzQxIC0xOTIgLTEwNyAtNjkgLTEyOSAtOTkgLTE0OSAtMTkxCi0xMiAtNTMgNSAtMjAxIDM1IC0zMjMgOSAtMzYgMjMgLTk0IDMxIC0xMjkgOCAtMzUgMTYgLTY3IDE5IC03MSAzIC01IDE0IC00MQoyNSAtODIgMTkgLTcyIDM3IC0xMzQgMTAwIC0zMzMgODggLTI4MiAxNjQgLTYyMyAyMTEgLTk0NSAyOCAtMTk2IDI3IC01MjIgLTIKLTY4MCAtMjkgLTE1NCAtMzMgLTIxNSAtMTkgLTI1MSAzMyAtNzggMTkwIC05MCAyNTYgLTIwIDU0IDU3IDE2OCAzNTcgMjEwCjU1MCA1MCAyMjkgNjUgMzM5IDg0IDYxNiA1IDgzIDE4IDIzMyAyNyAzMzUgMTAgMTAyIDE4IDI4OSAxOSA0MTUgbDIgMjMwIDM2Cjc2IGMxOSA0MiA2MSAxNTIgOTIgMjQ1IDUxIDE1MyA1NyAxNzcgNTggMjU5IDEgODQgLTIgOTUgLTM2IDE2NyAtMzkgODMgLTk1CjE0NCAtMjAzIDIyNSAtMTU1IDExNiAtMzEyIDE1MCAtNDU1IDk5eiBtMjc1IC0xMDUgYzE1MiAtNjkgMjkyIC0yMTMgMzM0Ci0zNDIgMTQgLTQ0IDEgLTEwNiAtNjMgLTI5NCAtNjAgLTE3NSAtOTkgLTI2MCAtMTMxIC0yODEgLTE2IC0xMSAtNjggLTIxCi0xNDMgLTMwIC02NCAtNyAtMTc4IC0yMCAtMjUyIC0yOSAtNzQgLTkgLTE2NCAtMTkgLTIwMCAtMjIgLTY1IC01IC02NiAtNQotNzkgMjMgLTggMTYgLTE3IDQzIC0yMiA1OSAtNCAxNyAtMjEgNzcgLTM5IDEzNSAtNDkgMTY3IC05MCAzNzAgLTkwIDQ0OCAwCjQ4IDQgNTcgNDEgOTcgMjMgMjUgNTkgNTUgODAgNjcgMjEgMTMgODIgNTEgMTM2IDg0IDE3MiAxMDggMjIxIDEyNiAzMTEgMTE4CjI5IC0yIDgyIC0xNyAxMTcgLTMzeiBtMTI4IC0xMDQ2IGMzMyAtMzMgMzAgLTI0NyAtOSAtNjMzIC04IC03OCAtMTQgLTE3NAotMTQgLTIxNCAwIC0xMzEgLTQyIC00NTEgLTgwIC02MTMgLTM3IC0xNTUgLTcwIC0yNTMgLTEyNCAtMzczIC0yNCAtNTMgLTQ3Ci0xMDcgLTUwIC0xMTggLTE4IC02MSAtODYgLTkzIC0xMjEgLTU3IC0xOSAxOCAtMTggMzIgOSAxOTggMzUgMjEzIDI4IDYxMAotMTQgODIwIC01IDI4IC0yNCAxMjIgLTQxIDIxMCAtNDkgMjU0IC0xMDAgNDYyIC0xNjAgNjQ5IC0xMyA0MCAtMTYgNjMgLTkgNzEKNiA3IDY3IDE3IDE0MiAyNCA3MyA2IDE2NSAxNiAyMDMgMjIgMzkgNSA5NyAxNCAxMzAgMTggOTIgMTMgMTIyIDEyIDEzOCAtNHoiLz4KPHBhdGggZD0iTTE0NDU1IDM3MTYgYy01NyAtMjUgLTc0IC01NyAtMTAyIC0xODQgLTIxIC0xMDEgLTI0IC00NzQgLTUgLTU3NwozOCAtMTk3IDg3IC0zNTcgMTY2IC01MzggbDQ3IC0xMDggLTIyIC04NyBjLTI5IC0xMTIgLTMzIC0zNDUgLTcgLTQzMiAyNiAtODcKNDEgLTE5MSAzNSAtMjQ1IC0yIC0yNyAtMTEgLTEwNCAtMTggLTE3MCAtMTYgLTE0MSAtMTcgLTQxNCAtMiAtNTM1IDEyIC05MgoyNSAtMTU3IDgyIC00MTAgNDkgLTIxMiA2NCAtMjQ4IDEyMyAtMjgwIDQxIC0yMSA1MCAtMjMgODQgLTEyIDIyIDcgNDcgMjQgNTgKMzggMjYgMzcgNDYgMTE5IDQ2IDE5NCAwIDM2IDcgMTMwIDE1IDIxMCA5IDgwIDIwIDE4OCAyNiAyNDAgNSA1MiAyMSAxOTQgMzUKMzE1IDM2IDMwNyA1MyA1MDAgNzkgODgwIDggMTIxIDE5IDI0MCAyNCAyNjUgNSAyNSAxNSA3NCAyMSAxMTAgNyAzNiAyOCAxMjYKNDYgMjAwIDY2IDI2NSA4NiAzODUgOTEgNTUyIDExIDM0MyAtMzIgNDMyIC0yMjggNDY4IC0zNSA3IC0xMTggMjggLTE4NCA0NwotMjIzIDY0IC0yNjAgNzMgLTMyMCA3MiAtMzMgMCAtNzMgLTYgLTkwIC0xM3ogbTMxNSAtMTMzIGM4MCAtMjUgMTgyIC01MSAyMjgKLTU4IDExMiAtMTggMTQxIC0zNyAxNzIgLTExMCAyMyAtNTUgMjUgLTcyIDI1IC0yMTUgMCAtMTc0IC05IC0yMzAgLTg1IC01NDUKLTI2IC0xMTAgLTUxIC0yMTUgLTU1IC0yMzMgLTEyIC02MCAtMTggLTYyIC0yMTUgLTYyIC0xNTUgMCAtMTgwIDIgLTE5OCAxOAotMjUgMjEgLTg3IDE2MSAtMTM1IDMwMiAtODggMjU5IC0xMTQgNDk0IC04MyA3NDAgMTUgMTE2IDM3IDE4MyA3MCAyMDYgMzEgMjIKMTAzIDExIDI3NiAtNDN6IG0yNDkgLTEzMjcgYzkgLTExIDEwIC0zMyAyIC05MSAtNiAtNDIgLTExIC0xMjEgLTExIC0xNzYgMAotNTUgLTUgLTE0MiAtMTAgLTE5MiAtNiAtNTEgLTE5IC0xODIgLTMwIC0yOTIgLTExIC0xMTAgLTI0IC0yMzYgLTMwIC0yODAKLTE4IC0xNTYgLTM5IC0zNDEgLTQ1IC00MDAgLTMgLTMzIC0xMCAtMTAzIC0xNSAtMTU1IC02IC01MiAtMTUgLTE1OCAtMjEKLTIzNCAtMTAgLTE0MCAtMjYgLTE5NiAtNTQgLTE5NiAtMjUgMCAtNDcgNDcgLTgxIDE3OCAtMTAyIDM4NiAtMTMwIDYyOSAtOTgKODY3IDI3IDIwMSAyNSA0MDUgLTUgNTEwIC0yOSAxMDMgLTM4IDIyOSAtMjEgMzAzIDQxIDE4MyAyNiAxNzIgMjM5IDE3MiAxMzQKMCAxNzEgLTMgMTgwIC0xNHoiLz4KPHBhdGggZD0iTTIwNzQwIDM2ODYgYy02OCAtMjEgLTEzMiAtNTIgLTE3NSAtODYgLTUwIC00MCAtMTAxIC00MCAtMTg2IDAKLTE3MSA3OSAtMzM0IDgwIC00NDMgMyAtMTI0IC04OCAtMTczIC0yMzkgLTE1NSAtNDgwIDExIC0xNDggMjAgLTE5NiA3NyAtMzkwCjI4IC05MiA1MiAtMTgxIDU1IC0xOTggMyAtMTYgMTcgLTkzIDMxIC0xNjkgMjIgLTExOSAyNiAtMTY4IDI2IC0zMjcgMCAtMTAyCi01IC0yNDQgLTEwIC0zMTQgLTExIC0xMzcgLTIgLTMwMCAyNSAtNDQ4IDQxIC0yMjIgMTUxIC00MjQgMzE3IC01ODMgMTAyIC05NwoxMzUgLTExNCAxODQgLTkxIDQ0IDIxIDc0IDcxIDc0IDEyMyAwIDMxIC0xMCA1NiAtNDIgMTA1IC05MCAxMzkgLTExOCAyNTAKLTExOCA0NzcgMCA5NSA1IDIwMyAxMCAyNDAgNiAzNyAxNCAxMzkgMTkgMjI3IDcgMTM2IDExIDE2NyAzMSAyMDUgMjMgNDcgNTgKOTAgNzIgOTAgMTYgMCA3OCAtMTA5IDEyNyAtMjIyIDYwIC0xMzggMTEwIC0yOTMgMTcyIC01MzIgOTQgLTM2MyAxNzUgLTU5NwoyNDAgLTY4OCAyNSAtMzUgNzYgLTM4IDEyNCAtOCA2MSAzOCA2OSA2MCA3NyAyMjAgNCA4MCAxMCAxODkgMTQgMjQ0IDcgMTA2Ci0xIDE3MyAtNDIgMzM2IC0xMTMgNDU0IC0xOTQgODU4IC0yMTAgMTA1MCAtNyA3NyAtNiA3OCA0NSAxOTcgODkgMjA4IDExNgozNDQgMTA3IDUzOCAtMTEgMjQ2IC04MSAzODggLTIyNSA0NTQgLTgyIDM4IC0xNTYgNDcgLTIyMSAyN3ogbTE2NiAtMTA1IGM5OAotNDUgMTYyIC0xNDYgMTg5IC0zMDIgMjAgLTExMSAxOSAtMTY4IC00IC0yODEgLTMwIC0xNDYgLTExMSAtMzU5IC0xNDMgLTM3MAotNyAtMyAtNDcgLTEgLTg4IDQgLTEyMSAxNiAtMzMwIDIgLTQ5MyAtMzIgLTE3MCAtMzYgLTI2MSAtNTcgLTMwMyAtNzEgLTQ3Ci0xNCAtNjIgLTMgLTgwIDYwIC04IDMxIC0zNSAxMjYgLTU5IDIxMSAtMjUgODUgLTUwIDE5OCAtNTYgMjUwIC0xNSAxMjQgLTUKMjg4IDIwIDM0NSAyNyA2MSA4OCAxMjQgMTQ2IDE1MSA4NSA0MCAxNDEgMzIgMzI0IC00NSAxMTYgLTQ5IDE5MSAtMzkgMzAwIDM5CjgzIDYxIDE3MSA3NSAyNDcgNDF6IG0tNzYgLTEwNDEgYzM2IC02IDcyIC0xMyA4MSAtMTYgMjQgLTcgMzcgLTQ2IDQ5IC0xNDQKMTYgLTEzNyAyOCAtMjA5IDQ5IC0zMTAgMTAgLTUyIDI2IC0xMzEgMzUgLTE3NSA5IC00NCAyMSAtOTggMjYgLTEyMCA1IC0yMgoxNiAtNjkgMjQgLTEwNSA4IC0zNiAzNCAtMTQxIDU4IC0yMzUgbDQzIC0xNzAgLTMgLTI0NCBjLTMgLTI1MyAtMTAgLTMwMSAtNDgKLTMwMSAtMzUgMCAtMTQ5IDMwMiAtMjI0IDU5NSAtNTAgMTk1IC03MSAyNjggLTExNyA0MTAgLTM2IDExMSAtMTM2IDMzNCAtMTg2CjQxMyAtMjQgMzcgLTMxIDQyIC02NiA0MiAtNzYgMCAtMTU1IC04NiAtMTg3IC0yMDIgLTggLTI5IC0xOSAtMTM4IC0yNCAtMjQzCi02IC0xMDQgLTE0IC0yMzAgLTIwIC0yODAgLTE0IC0xMjYgLTEyIC0yMDEgNiAtMzI0IDIwIC0xMzggNDUgLTIyMyA5NSAtMzE3CjQwIC03NCA0NCAtMTA0IDE1IC0xMDQgLTcgMCAtNTggNDcgLTExMyAxMDMgLTgyIDg3IC0xMDcgMTIxIC0xNTUgMjEzIC0xMDQKMjAyIC0xNDUgMzkwIC0xMzQgNjE5IDE4IDM3NCAxOCA1MTAgMiA2MzUgbC0xNyAxMjUgMjIgMTggYzEyIDkgMjggMTcgMzYgMTcKOCAwIDYzIDEyIDEyMiAyNiAxNDQgMzQgMjQ2IDUzIDM3MSA2OSAxMzUgMTYgMTgxIDE3IDI2MCA1eiIvPgo8cGF0aCBkPSJNODQ3MSAzNjQwIGMtMzAgLTExIC04NCAtMzcgLTEyMCAtNTkgLTM2IC0yMSAtOTUgLTUzIC0xMzEgLTcxIC04NwotNDQgLTE4MyAtMTEzIC0yMTggLTE1OCAtNTIgLTY2IC02MiAtOTUgLTYyIC0xNzkgMCAtNzUgMiAtODEgNTEgLTE2OCA4MQotMTQzIDExNCAtMjQ5IDE1MCAtNDc1IDYgLTQxIDI0IC0xMzMgMzkgLTIwNSA0NyAtMjE3IDQ5IC0yMzQgNjQgLTQwMCAxNAotMTU1IDI0IC0zMzggNDYgLTg0NSAxNCAtMzIxIDI2IC00MjcgNTcgLTUxNCAzMyAtOTMgNTUgLTExNiAxMDcgLTExNiA5MCAwCjExNSAzNSAxNTIgMjExIDY3IDMyNSA3NCAzNzQgODUgNjQyIDUgMTQ0IDE2IDMwMiAyNCAzNTIgOCA0OSAyMyAxNDkgMzUgMjIwCjExIDcyIDI1IDE2MiAzMCAyMDEgNSAzOSAxMyAxMDAgMTkgMTM1IDUgMzUgMTMgMTE4IDE3IDE4NCA2IDEwMCAxMiAxMzIgMzgKMjAwIDM4IDkzIDUwIDEzNCA3MiAyMzAgMjEgOTYgNDQgMzQ4IDM4IDQxNSAtMjEgMjE5IC02OCAzMTEgLTE5OSAzODYgLTQzIDI1Ci02MSAyOSAtMTQ1IDMxIC03NiAzIC0xMDYgLTEgLTE0OSAtMTd6IG0yNTEgLTEwMiBjNjUgLTM0IDg1IC01OCAxMjYgLTE0NSAyNgotNTYgMjcgLTY0IDI2IC0yMjMgMCAtMTA4IC02IC0xOTUgLTE3IC0yNTAgLTMzIC0xNzEgLTEwMSAtMzU3IC0xNDEgLTM4NiAtMzcKLTI2IC0xODggLTE4IC0zMjMgMTYgLTE5MiA1MCAtMTgzIDQzIC0yMDMgMTU1IC0xOSAxMTMgLTUwIDIwMyAtMTEyIDMyNCAtNjgKMTM0IC03MyAxNjggLTI5IDIyOCA0NSA2MSAxMDIgMTAzIDI3NiAxOTggMTkwIDEwNCAyMTMgMTEzIDI4NCAxMTQgNDEgMSA2NgotNiAxMTMgLTMxeiBtLTM3MiAtMTA3NCBjNjkgLTIxIDExNCAtMjggMjM1IC0zMyBsMTUwIC02IC0yIC0zMCBjLTQgLTU0IC0zMwotMjg4IC00NyAtMzc1IC01NyAtMzUzIC03NCAtNTEyIC04MSAtNzUwIC0yIC0xMDIgLTExIC0yMjMgLTIwIC0yNzAgLTE4IC0xMDAKLTUyIC0yNjkgLTY2IC0zMjIgLTI5IC0xMjAgLTI5IC0xMTkgLTUyIC0xMTYgLTMyIDQgLTY1IDk2IC03NyAyMTUgLTkgOTQgLTIyCjM1OSAtNDAgODAzIC0xMiAzMDggLTM5IDUzNyAtODYgNzM4IC0zMCAxMjggLTMxIDE3MyAtNSAxNzIgMyAwIDQ0IC0xMiA5MQotMjZ6Ii8+CjwvZz4KPC9zdmc+";
    const ODONTO_BASE_DARK = "data:image/svg+xml;base64,PHN2ZyB2ZXJzaW9uPSIxLjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIKIHdpZHRoPSIyNTUxLjAwMDAwMHB0IiBoZWlnaHQ9IjgwMC4wMDAwMDBwdCIgdmlld0JveD0iMCAwIDI1NTEuMDAwMDAwIDgwMC4wMDAwMDAiCiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJ4TWlkWU1pZCBtZWV0Ij4KPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMC4wMDAwMDAsODAwLjAwMDAwMCkgc2NhbGUoMC4xMDAwMDAsLTAuMTAwMDAwKSIKZmlsbD0iI2U4ZWVmNiIgc3Ryb2tlPSJub25lIj4KPHBhdGggZD0iTTkwODYgNzg4OSBjLTcyIC04MCAtNzYgLTEwMyAtNzYgLTQ1MyAwIC0xNjYgLTQgLTM0OCAtMTAgLTQwNiAtNQotNTggLTE0IC0xNjggLTIwIC0yNDUgLTYgLTc3IC0xOCAtMjIxIC0yNyAtMzIwIC05IC0xMDcgLTE3IC0zNDcgLTIwIC01OTQgLTQKLTM2MSAtMyAtNDE5IDExIC00NTUgMTUgLTM5IDE1IC00NiAtMyAtMTA2IC02MiAtMjA4IC05MyAtMzA2IC0xMjYgLTM5NSAtNjEKLTE2NiAtNzUgLTIyNCAtNzUgLTMwNyAwIC0xODYgMTA5IC0zMzIgMzMwIC00NDMgMTE4IC02MCAxODkgLTc1IDM0MyAtNzUgMTE2CjAgMTQzIDMgMjA4IDI1IDQxIDE0IDk5IDQyIDEyOSA2MiA4NyA1OCAxOTQgMTc0IDIzNSAyNTUgMzIgNjUgMzUgNzggMzUgMTYwCjAgMTQ3IC02MCAzNTYgLTE2NSA1NzggLTcwIDE0NiAtMTEzIDI3NSAtMTQ0IDQzMCAtMjEgMTA1IC00MSAyNzkgLTQxIDM1NCAwCjEwMyAtMjggNTA3IC00MCA1ODEgLTUgMzMgLTE3IDExMiAtMjUgMTc1IC0yMSAxNTYgLTgyIDQ2OCAtMTMwIDY2NSAtMTExIDQ2MwotMTIzIDQ5NSAtMjA1IDUzOSAtMzEgMTcgLTYzIDI2IC05MyAyNiAtNDIgMCAtNDkgLTQgLTkxIC01MXogbTE0NCAtNjUgYzE3Ci0xNSAzOSAtNDMgNDkgLTYzIDE4IC0zNCA2MCAtMTgzIDk2IC0zMzYgOSAtMzggMjAgLTg2IDI1IC0xMDYgNiAtMjAgMTQgLTU4CjIwIC04NSA1IC0yNyAxNiAtODAgMjUgLTExOSA3OCAtMzUyIDEyMSAtNjc2IDEzNSAtMTAxMCAxMSAtMjQ2IDI1IC00MDIgNDUKLTUwMiA4IC00MCAxNSAtODkgMTUgLTEwOSBsMCAtMzYgLTU3IDggYy03NSAxMiAtNDIxIDExIC00OTQgMCBsLTU2IC04IC0xMgozMiBjLTIyIDY0IC0xMSA2NTMgMTggOTg1IDQyIDQ2NSA2MSA4MTMgNjEgMTA2OCAwIDE4MCAxIDE5MCAyNSAyMzcgMjIgNDMgNDYKNjkgNjcgNzAgMyAwIDIxIC0xMiAzOCAtMjZ6IG0zNjQgLTI0NTggYzM3IC04IDc0IC0yMCA4MiAtMjcgNyAtOCAyNiAtNDggNDMKLTg5IDE2IC00MSA1NyAtMTI5IDg5IC0xOTUgNjAgLTEyMSA3NCAtMTYyIDExOCAtMzM0IDI4IC0xMDggMzAgLTE0OCAxMCAtMTk2Ci0yMiAtNTMgLTg2IC0xMzQgLTE2MiAtMjA0IC0xNjMgLTE1MyAtMzY4IC0xODkgLTU5MCAtMTAyIC05NiAzNyAtMTU2IDc1Ci0yMzYgMTQ5IC03MSA2NiAtMTA0IDEyMCAtMTE5IDE5MyAtMTMgNjYgLTMgMTA5IDcwIDMxOSAyNyA4MCA3MSAyMTEgOTYgMjkxCjI1IDgxIDUzIDE1NyA2NCAxNzAgMjkgMzUgMTI3IDQ5IDMxMSA0NCA4NSAtMyAxODYgLTExIDIyNCAtMTl6Ii8+CjxwYXRoIGQ9Ik0xNjY4NyA3OTAxIGMtNTQgLTM1IC03OCAtODUgLTEzMyAtMjc4IC0xMzIgLTQ1NyAtMTg0IC03MDggLTIwNAotOTgzIC0yOCAtMzk2IC0xMTQgLTEwMDUgLTE3MCAtMTIwOSAtNiAtMjAgLTIxIC04MyAtMzQgLTE0MSAtNDMgLTE4MSAtNjQKLTI3MSAtMTAwIC00MjAgLTUxIC0yMTUgLTYxIC0yOTggLTQ2IC0zNzMgMjggLTEzMyA5MyAtMjExIDI0NiAtMjkzIDE0OSAtODAKMjI5IC05OCA0MTMgLTkyIDEzMiA1IDE1NCA4IDIyOCAzNiAxNjcgNjMgMjU4IDE0NyAzMDUgMjgxIDE3IDQ4IDIwIDczIDE1CjE3MSAtNiAxNDIgLTM4IDI2MCAtMTcyIDYzNSAtNTMgMTQ4IC01MiAxMzggLTE2IDM5NSAxOSAxMjcgMjIgMTg2IDE4IDMzMCAtMwoxNTMgLTI4IDQ0OCAtNDIgNTA1IC01IDIyIC0yMSAzNTggLTM1IDc4MCAtMTQgMzg0IC0yNSA1NDUgLTQzIDU4NyAtOCAxOSAtMzAKNDcgLTQ5IDYyIC0yOSAyMSAtNDYgMjYgLTk0IDI2IC00MSAwIC02OCAtNiAtODcgLTE5eiBtMTI2IC04OSBjOCAtOSAyMSAtMzEKMjggLTQ3IDEzIC0zNSA0OCAtNjM0IDQ5IC04NjAgMCAtODIgNSAtMjA0IDEwIC0yNzAgNiAtNjYgMTUgLTE3NiAyMCAtMjQ1IDYKLTY5IDE1IC0xNTIgMTkgLTE4NSAyNSAtMTY2IDUgLTYyNCAtMzEgLTcxNyAtMTMgLTM2IC0yNiAtMzkgLTExMSAtMjggLTE0OAoxOSAtMzgyIDQgLTQ3MyAtMzAgLTIxIC04IC0zMSAtOCAtNDEgMyAtMTEgMTEgLTExIDI2IDIgOTMgNjQgMzIyIDExNCA2ODEKMTM1IDk2OSAxNyAyMzAgMzUgMzY2IDc2IDU2NSAzNSAxNzUgMTU1IDU5OSAxOTQgNjg2IDM0IDc4IDg3IDEwNiAxMjMgNjZ6Cm03MSAtMjQ2NSBjMTYgLTExIDMxIC00MSA0OSAtOTQgMTQgLTQzIDQ4IC0xNDEgNzUgLTIxOCA1NiAtMTU1IDk0IC0yODUgMTEyCi0zODcgMjYgLTE0MSAtMjkgLTI3NiAtMTQyIC0zNDkgLTYyIC0zOSAtMTcxIC03OSAtMjczIC0xMDAgLTIwOCAtNDEgLTUyNAoxMDMgLTYxNCAyNzkgLTM1IDY5IC0yOCAxMzMgNTAgNDM3IDI3IDEwMyA0OCAxODkgNTkgMjQyIDI2IDExOCA0MSAxNTMgNjgKMTU5IDE1IDMgNDMgMTEgNjIgMTcgMTA0IDMyIDE0OSAzNiAzMzcgMzMgMTUzIC0zIDE5OCAtNyAyMTcgLTE5eiIvPgo8cGF0aCBkPSJNNzU1NCA3NzIxIGMtNDAgLTI0IC02OCAtOTMgLTgyIC0yMDEgLTYgLTQ3IC0xNiAtMjc2IC0yMSAtNTEwIC02Ci0yMzQgLTE2IC01NjIgLTIyIC03MzAgLTEzIC0zMjMgLTEyIC0zNDIgMzEgLTU4NSAyMyAtMTI4IDIzIC0xMzEgNyAtMjY1IC0xNwotMTMyIC01NSAtMzAyIC0xMTUgLTUxMCAtNjIgLTIxMSAtNjggLTM0NyAtMjAgLTQ1MCA0NCAtOTYgMjAzIC0yMzEgMzM2IC0yODUKMjI1IC05MSA0NzUgLTM2IDY2OCAxNDcgODcgODMgMTI5IDE0NSAxNTUgMjMwIDQyIDEzOCAxOCAyNjEgLTkxIDQ2MCAtMTUxCjI3NiAtMTgzIDMzNCAtMjEyIDM4MCAtMjggNDUgLTI5IDQ5IC0xOSAxMDQgMjcgMTQ0IDQgNDQ0IC02MCA3ODQgLTIyIDExNgotMjQgMTMwIC02OSA0NDAgLTU1IDM4NiAtMTA1IDU2OCAtMjExIDc4MSAtNjkgMTM5IC05MyAxNjkgLTE2MSAyMDMgLTYyIDMxCi03NCAzMiAtMTE0IDd6IG0xMjEgLTEzMiBjMjAgLTIzIDY0IC05NyA5NiAtMTY0IDEwNSAtMjE4IDE1NCAtNDA0IDIwMyAtNzgwCjkgLTY2IDIzIC0xNTggMzEgLTIwNSA0NCAtMjYxIDY2IC0zOTcgODAgLTQ5NCAxOSAtMTM2IDIwIC00MjAgMiAtNDU2IGwtMTMKLTI1IC0yMTYgLTEgYy0xMjAgLTEgLTIyOSAtNSAtMjQ0IC04IC00MSAtMTEgLTU0IDggLTU0IDc4IDAgNjYgLTE5IDIwNiAtNDYKMzUxIC0xMyA3MSAtMTUgMTE5IC0xMCAyMzAgOCAxNTcgMjIgNjAyIDM1IDEwNzUgNyAyMzQgMTMgMzI3IDI0IDM2MyAyOSA5MAo1NSA5OSAxMTIgMzZ6IG00MjcgLTIyNDEgYzI4IC0xOSA5MyAtMTMxIDIyNCAtMzg1IDg5IC0xNzIgODkgLTE3MyA5MyAtMjU3IDQKLTExOCAtMjAgLTE3MCAtMTM3IC0yODcgLTc0IC03MyAtMTA0IC05NiAtMTc4IC0xMzEgLTg1IC00MSAtOTQgLTQzIC0xOTUgLTQ2Ci0xMzMgLTUgLTE4NyA5IC0yODkgNzcgLTExMSA3MyAtMTYyIDEyMiAtMjAxIDE5MyAtMzEgNTcgLTM0IDcwIC0zMyAxMzggMiA3OQo1IDkxIDc4IDM0MyAyNSA4NyA1MCAxODQgNTUgMjE2IDE3IDEwNiAzMCAxNDAgNTQgMTQ2IDQ0IDEwIDEyNiAxMyAzMTMgMTEKMTU3IC0yIDE5NiAtNSAyMTYgLTE4eiIvPgo8cGF0aCBkPSJNMTE5NjUgNzU2OSBjLTYyIC03NSAtOTEgLTE3MiAtMTAwIC0zMzQgLTMgLTYwIC0xMCAtMTM5IC0xNSAtMTc1Ci0zMyAtMjM1IC0zMyAtMjM2IC02MCAtNTg1IC05IC0xMjggLTM3IC0zOTYgLTU5IC01NzAgLTE0IC0xMTIgLTU2IC0yOTAgLTEwMQotNDI1IC01NyAtMTc0IC05NiAtMzEzIC0xMjIgLTQ0NCAtMjAgLTk2IC0yMyAtMTQxIC0yMiAtMzQxIDAgLTIxMiAyIC0yMzUgMjIKLTI5MCAzNyAtOTkgNjMgLTEyOSAxNDQgLTE3MCA5OSAtNDggMTcwIC01NSA1NjMgLTUyIGwzMjAgMyA2MSAzMSBjMTAyIDUzCjE0NyAxMzIgMTY2IDI5MiAyOSAyNDUgLTM4IDUzNyAtMTY2IDcyOSBsLTQ1IDY3IDIxIDYwIGMxNSA0NCAyMiA5NCAyNiAxODUgNgoxNjggMCAxOTYgLTI2MCAxMjQ5IC03NCAyOTggLTE3MSA2MTggLTIxMiA3MDAgLTI5IDU3IC03OCAxMDEgLTExMSAxMDEgLTE0IDAKLTM0IC0xMyAtNTAgLTMxeiBtMTA1IC0xNjIgYzMwIC02MyA1NCAtMTM2IDExNiAtMzUyIDQ5IC0xNjkgNTEgLTE3NyA3OSAtMzAwCjE0IC02MCAzMiAtMTM1IDQwIC0xNjUgNyAtMzAgMjUgLTEwOSA0MCAtMTc1IDM1IC0xNTkgODMgLTM2MyA5NSAtNDAwIDY2Ci0yMTUgOTMgLTQ2NSA2MSAtNTc3IC0yMCAtNzEgLTMyIC03NiAtODggLTQwIC0xMjAgNzcgLTI0NyAxMTIgLTQxMSAxMTIgLTYyCjAgLTE0NSAtNSAtMTg0IC0xMSAtMzggLTYgLTc0IC03IC03OCAtMiAtNSA0IDYgNzEgMjUgMTQ4IDE4IDc3IDM4IDE4MSA0NQoyMzAgNiA1MCAxNSAxMTcgMjAgMTUwIDEzIDgyIDQ3IDQ4MiA1NSA2MzQgNCA2OCAxMyAxNzAgMjEgMjI1IDggNTYgMjAgMTc1CjI5IDI2NiAxOCAyMDQgMjEgMjIxIDQ4IDI3NiAzMCA2MyA1MSA1OSA4NyAtMTl6IG0xMjAgLTIwMTUgYzI0NCAtODYgMzc5Ci0yMjMgNDQ1IC00NTUgNDAgLTEzOSA0OCAtMTk5IDQzIC0zMzQgLTMgLTExNCAtNyAtMTM1IC0zMSAtMTg4IC0zNiAtNzcgLTUxCi05MyAtMTEyIC0xMjAgLTQ5IC0yMiAtNjMgLTIzIC0zNDAgLTI0IC00NzcgLTIgLTU1OCAyNCAtNjEyIDE5NiAtMzQgMTEwIC0yNQo0MDQgMTkgNTk4IDIxIDk1IDc3IDI4OCA4NiAyOTcgMTAgMTAgOTkgMzUgMTcyIDQ5IDc2IDE0IDI2OCAzIDMzMCAtMTl6Ii8+CjxwYXRoIGQ9Ik0xNTM4OCA3NTI1IGMtODcgLTQ2IC04OSAtNTEgLTIyMiAtNTI1IC0xMTUgLTQwOSAtMTUxIC02MTUgLTE2MQotOTEwIC0xNSAtNDUzIC00MCAtNjI3IC0xMzMgLTkzMCAtNTAgLTE2MSAtNzYgLTQwMiAtNzEgLTY2NSA0IC0xNTYgNyAtMTg1CjI0IC0yMTkgMzkgLTc4IDEwMCAtOTggMzQ2IC0xMTYgMzIyIC0yMyA0MTkgLTExIDQ4OSA2MSA3MiA3NCA3NSA5NiA3NSA0OTkgMAozMDggLTMgMzY3IC0xOSA0NDUgLTIzIDExMCAtNjEgMTg4IC0xMjYgMjYwIGwtNTAgNTUgMCA1MDAgYzAgMjc2IC01IDYxMSAtMTEKNzQ1IC04IDE4NCAtNyAyOTMgMiA0MzcgMTggMjg2IDE0IDMxOSAtNDcgMzY3IC0zMyAyNiAtMzggMjYgLTk2IC00eiBtNjgKLTEyMCBjMyAtMTQgMSAtOTIgLTYgLTE3MyAtOCAtOTIgLTEwIC0yMTkgLTYgLTM0MiAxMyAtNDI2IDE4IC0xMzcyIDcgLTEzODMKLTcgLTcgLTQ4IC0xMCAtMTA5IC04IC01NCAxIC0xMzYgLTMgLTE4MiAtOSAtMTEzIC0xNiAtMTE3IC0xMiAtMTAxIDEwNyA2IDQ4CjE1IDIwNSAyMSAzNDggMTAgMjY0IDI1IDQyNSA1NSA1NzAgMTcgODYgMTAzIDQyNCAxMTAgNDM1IDMgNCAxMSAzMiAxOSA2MSA4CjMwIDIyIDc5IDMxIDEwOSA5IDMwIDI2IDkzIDM5IDE0MCAyNCA4OCAzOCAxMjMgNjQgMTUzIDIyIDI1IDUwIDIxIDU4IC04egptMTkgLTIwMjQgYzgyIC0zNiAxMzAgLTExMiAxNjEgLTI1MSAyMCAtOTMgMzEgLTU3NSAxNiAtNjkzIC0xMiAtODggLTQyIC0xNDUKLTk1IC0xNzcgLTM5IC0yNCAtMTM2IC0yNiAtMzkzIC02IC0xNDggMTEgLTE3NyAxNiAtMjE1IDM3IC02NyAzNyAtNzIgNjIgLTY1CjMxMSA2IDIyNiAyMyAzNTQgNjMgNDkzIDYyIDIxNyA3NSAyNTUgODggMjY5IDggNyA1NCAxOSAxMDIgMjUgNDggNyA5NSAxNAoxMDMgMTYgNDQgMTEgMTg4IC0zIDIzNSAtMjR6Ii8+CjxwYXRoIGQ9Ik0xODI5NCA3NTI1IGMtNjcgLTMzIC04MSAtNTAgLTE1MyAtMTgwIC0xNTggLTI4NyAtMjc2IC02NDkgLTM0MQotMTA0NSAtMTkgLTExNSAtMzAgLTM0OCAtMzAgLTYzNyBsMCAtMjgxIC0zOCAtNDkgYy04NSAtMTA5IC0xNDIgLTIxOCAtMTc5Ci0zMzcgLTEyNSAtNDEzIC02NyAtNjU5IDE4MyAtNzg0IDE5MCAtOTUgNDI1IC05MiA2MjMgOCAxMDYgNTMgMTk3IDEzOCAyNDIKMjI3IGwzNCA2NyAtMSAxNDEgYy0xIDk5IC03IDE2OSAtMjIgMjQxIC0yNCAxMTcgLTczIDMwMyAtMTAxIDM4OSAtMTggNTUgLTIwCjk2IC0yNCA1MTAgLTIgMjQ4IC0xMCA1NDUgLTE3IDY2MCAtMTYgMjU4IC0xNyA0NDEgLTcgNzQwIGw4IDIzMCAtMzUgNTQgYy01Mwo4MiAtNjQgODUgLTE0MiA0NnogbTc3IC0xMTYgYzE3IC0yMiAxNyAtNDAgOCAtMjQ0IC0xMiAtMjQyIC05IC00MTYgMTUgLTkxMAo5IC0xODEgMTcgLTQ0NiAxNyAtNTg4IDIgLTMwMiA0IC0yOTYgLTgwIC0yNzggLTI5IDYgLTE0NiAxMSAtMjYwIDExIC0xODEgMAotMjEwIDIgLTIxNSAxNiAtMTAgMjYgLTcgNTk3IDQgNjc2IDUgNDAgMTcgMTMxIDI1IDIwMiAyNiAyMDggODkgNDQ5IDE4MCA2ODAKMTAyIDI2MSAyMzMgNDc4IDI3OCA0NjMgNiAtMiAxOSAtMTQgMjggLTI4eiBtLTc0IC0yMTE1IGM1MyAtOCAxMDQgLTE5IDExNAotMjUgMTkgLTEwIDUzIC0xMDkgODQgLTI0NCA5IC0zOCAyMCAtODggMjUgLTExMCAxOSAtODMgMzMgLTE5MyAzNCAtMjcwIDEKLTcwIC0zIC04NyAtMjggLTEzNyAtNTggLTExNCAtMTkyIC0yMTUgLTMzOCAtMjU0IC04MSAtMjEgLTI0NyAtMTggLTMyOSA2Ci0xMTUgMzUgLTIxNyAxMjUgLTI2NyAyMzggLTI4IDY1IC0yMSAyMzIgMTggMzc3IDE3IDY2IDQ0IDE0NyA2MCAxODEgMzUgNzIKMTE5IDIwMyAxNDUgMjI0IDM3IDMxIDMyNyAzOSA0ODIgMTR6Ii8+CjxwYXRoIGQ9Ik0xMDQ4NSA3NTE2IGMtMTEgLTE2IC0yMCAtNTUgLTIzIC05NyAtNCAtNjYgMTUgLTI4NSAzOSAtNDM3IDI2Ci0xNjggMjkgLTQ4MSA1IC01MjAgLTMgLTUgLTE1IC04NyAtMjYgLTE4MyAtMTkgLTE1MSAtMjEgLTIxOCAtMTggLTUwMCBsMwotMzI2IC00NyAtNjkgYy0yNiAtMzggLTU5IC05NiAtNzQgLTEyOSAtMzYgLTg0IC03MSAtMjM0IC03OCAtMzQwIC01IC04OSA2Ci0zNzMgMjMgLTU3MiAxMyAtMTU1IDU4IC0yMTggMTcyIC0yNDIgODAgLTE3IDQ3MSAtMTQgNTcwIDUgMTk2IDM3IDI1MyAxMjMKMjE1IDMyNSAtMTIgNjIgLTE2IDE0NiAtMTYgMzAwIDAgMTk0IC0yIDIyMyAtMjQgMzA0IC01NSAyMDcgLTcwIDMxOCAtOTYgNzIwCi0yMSAzMDcgLTM1IDQyNiAtNzEgNjA3IC02NCAzMjYgLTE0NyA2MzYgLTIyMSA4MjUgLTIyIDYwIC01MiAxMzYgLTY0IDE3MAotMTMgMzQgLTM0IDc4IC00NiA5OCAtMjcgNDEgLTk0IDc2IC0xNTkgODMgLTQyIDQgLTQ5IDIgLTY0IC0yMnogbTEzNyAtMTEzCmM0NSAtNTAgMTc3IC00MDQgMjM0IC02MjggNDQgLTE3MSAxMDAgLTQzMSAxMzUgLTYyMCAxMyAtNzEgMzcgLTM3MyA0NCAtNTQ5Cmw2IC0xNDkgLTM4IDcgYy0xMDYgMjAgLTIwMCAyNSAtMzE1IDIwIGwtMTI3IC03IC02IDI2IGMtNCAxNCAtNSAxOTUgLTMgNDA0CjQgMzU4IDYgMzg1IDMxIDUxOCAzMyAxNzIgMzQgMjczIDcgNTA3IC0xMiA5NSAtMjUgMjA5IC0zMCAyNTMgLTEzIDExMCAtMTMKMjI4IDIgMjQzIDEzIDEzIDM0IDQgNjAgLTI1eiBtMzQ1IC0yMDMxIGM0MCAtMTAgNzcgLTIyIDgyIC0yNyA1IC02IDE2IC01NQoyNiAtMTEwIDkgLTU1IDI4IC0xNDUgNDIgLTIwMCAyMiAtODcgMjcgLTEzMiAzNCAtMzU1IDQgLTE0MCAxMSAtMjgyIDE0IC0zMTUKNSAtNTAgMyAtNjUgLTE0IC05MiAtNDYgLTc0IC0xMzcgLTkzIC00NDAgLTkzIC0yMTAgMCAtMjE1IDAgLTI1NyAyNSAtNjggNDAKLTc5IDc3IC05NSAzMDUgLTE5IDI2NiAtMTggNDE2IDQgNTIwIDMwIDE0MiAxMjMgMzE0IDE4NCAzMzkgNDEgMTYgMTk4IDMwCjI3OCAyNSAzOSAtMyAxMDMgLTEzIDE0MiAtMjJ6Ii8+CjxwYXRoIGQ9Ik0xMzk4NCA3NTIxIGMtNzIgLTMzIC05NCAtNjYgLTE0MSAtMjE2IC0xNTMgLTQ5MCAtMjU0IC05NTAgLTMyMwotMTQ3MCAtNDUgLTM0NiAtNTAgLTQ0MSAtMjUgLTUwMSAxNiAtMzkgMTUgLTQxIC0yNiAtOTUgLTYwIC03NiAtMTI1IC0yMzEKLTE2MyAtMzg3IC0yNCAtOTcgLTIyIC0zNDIgNCAtNDY3IDMxIC0xNDUgNTYgLTE4NiAxMzUgLTIyMiAzNyAtMTYgNzYgLTE4CjQ2MiAtMTYgNDEwIDIgNDIzIDMgNDczIDI0IDExOCA1MSAxNzAgMTgyIDE3MCA0MzQgMCAyMzEgLTQwIDQyMCAtMTQxIDY2NQotNDkgMTE5IC01MiAxMzEgLTU5IDI0NSAtNSA4MiAtMTUgMTQ3IC0zMyAyMDUgLTM4IDEyNyAtNDggMjEyIC01NyA0NzAgLTkKMjMxIC0yNCA0NTcgLTM1IDUwMiAtMyAxMyAtMTAgNjQgLTE1IDExMyAtNSA1MCAtMTYgMTQ0IC0yNCAyMTAgLTkgNjYgLTIwCjE4NyAtMjYgMjY4IC01IDgxIC0xNiAxNjMgLTI0IDE4MSAtMzIgNzYgLTc1IDkyIC0xNTIgNTd6IG03MiAtMTAyIGMxNCAtMTYKMjEgLTQ0IDI2IC0xMTIgNSAtNTEgMTIgLTE0NCAxNyAtMjA3IDExIC0xMzIgMjkgLTI5NCAzNiAtMzMwIDE4IC05MSAzOSAtMzMwCjQ1IC01MzUgMTAgLTMwMCAyMCAtMzkyIDY2IC01NzggMjkgLTExNSAzNSAtMTU1IDI4IC0xNzUgbC0xMCAtMjcgLTE0MSAzCmMtMTc2IDUgLTMwNCAtMTEgLTQxMyAtNDkgLTEzMCAtNDYgLTEyNiAtNDYgLTEzOSAtOSAtMTEgMzIgLTggNjcgMTkgMzE1IDYKNTAgMTUgMTE5IDIwIDE1NSAyOCAxODUgNTEgMzI4IDU2IDM1MCAzIDE0IDkgNDggMTMgNzUgNyA0NSAyMyAxMTggOTIgNDQwIDExCjU1IDM3IDE1MiA1NiAyMTUgMTkgNjMgNDEgMTQwIDQ5IDE3MCAyMCA3NyA2NCAyMDkgODEgMjQ1IDE0IDI4IDYwIDc1IDc0IDc1CjMgMCAxNCAtOSAyNSAtMjF6IG0yMDkgLTIwODMgYzU2IC0zNyAxNDkgLTI5NCAxOTAgLTUyOCAxOSAtMTA3IDE5IC0yNzUgMAotMzU4IC04IC0zNiAtMTcgLTc1IC0yMCAtODcgLTcgLTI5IC02MSAtOTAgLTk0IC0xMDcgLTM0IC0xNyAtODA4IC0yMSAtODU5Ci01IC02OCAyMiAtMTA3IDE2MyAtMTA3IDM4NCAxIDE4MiAxOSAyNjMgOTcgNDIxIDgxIDE2NSAxODYgMjUyIDM1MCAyODkgOTEKMjEgNDA3IDE1IDQ0MyAtOXoiLz4KPHBhdGggZD0iTTYyNzIgNzM3OCBjLTI2IC0xMyAtNTMgLTkxIC03MiAtMjExIC0xNyAtMTA2IC02IC0yNTcgMzMgLTQzNyA3Ci0zMiAxMiAtMTM0IDEyIC0yNDUgLTEgLTE2MSAtNCAtMjA2IC0yNCAtMjk1IC0zMCAtMTM1IC0zNyAtMjkzIC0yMSAtNDM4IDExCi05MyAxMSAtMTI5IDEgLTE5MSAtMTIgLTcwIC0yNSAtMTE4IC0xMTAgLTQwMCAtNTIgLTE2OCAtNjMgLTI0OCAtNjUgLTQ1MQpsLTEgLTE4NSAzNiAtNzUgYzQ2IC05NiAxMDQgLTE2MCAxODcgLTIwOSAxNTEgLTg3IDMyMyAtMTE4IDQ0MCAtNzcgMTMwIDQ1CjMxMCAyMDQgMzYzIDMyMiA0MCA4OCA1NCAxODQgNDIgMjgxIC0xMCA3MyAtOTEgMzIxIC0xNzUgNTM4IGwtMzEgODAgMiAxODUKYzYgNDAzIC0zNyA2OTAgLTE2MSAxMDcwIC0xMTAgMzQwIC0xMzIgNDAwIC0xOTUgNTI1IC04NiAxNzEgLTEwMSAxOTEgLTE2NQoyMTAgLTU5IDE3IC02NSAxNyAtOTYgM3ogbTk3IC0xMjIgYzI5IC0zMSAxMDYgLTE2NSAxMzggLTI0MSAyOSAtNjkgMTY0IC00NzIKMTk4IC01OTAgMzQgLTExOSA1NiAtMjMyIDgxIC00MTAgMjEgLTE0NCAyNiAtNTU3IDggLTU3NSAtOCAtOCAtMzMgLTcgLTk1IDYKLTY2IDEzIC0xMTAgMTUgLTIxNCAxMCAtNzEgLTQgLTE1MCAtOSAtMTczIC0xMiBsLTQ0IC02IDggNzggYzUgNDQgNiAxMjAgNAoxNjkgLTMgNTAgLTUgMTU4IC01IDI0MCAwIDEzMCA0IDE2NyAyOSAyNzUgMjYgMTExIDI5IDE0MiAyOSAyODAgLTEgMTI1IC02CjE4MCAtMjcgMjg1IC00NCAyMTkgLTQ1IDM3NiAtMiA0NzkgMTcgNDIgMzQgNDUgNjUgMTJ6IG0yODIgLTE5MDAgYzQyIC04IDk3Ci0yMyAxMjMgLTM0IDQ3IC0yMSA2NiAtNDkgOTUgLTE0NCA1IC0xOCAyOCAtODUgNTEgLTE0OCA2OSAtMTkzIDkxIC0yNjEgOTYKLTMwNCA2IC00NCAtMTUgLTEzNSAtNDYgLTE5NiAtNTAgLTk4IC0xNjggLTIwNiAtMjg4IC0yNjIgLTU2IC0yNyAtNzEgLTMwCi0xNDAgLTI3IC02OCA0IC04OSAxMCAtMTcyIDUwIC0xMjEgNTggLTE5NyAxMjYgLTIzMyAyMDcgLTQyIDkyIC00OCAxNDcgLTM2CjI5MCAxMyAxNDggMzQgMjQ0IDg5IDQwMSAyMiA2MyA0MCAxMTYgNDAgMTE4IDAgMTIgNzcgMzYgMTUzIDQ3IDEyMCAxOCAxNzYKMTggMjY4IDJ6Ii8+CjxwYXRoIGQ9Ik0xOTUxMyA3Mzc1IGMtMzcgLTE2IC01NSAtNDggLTczIC0xMjUgLTYgLTMwIC0yNSAtMTAwIC00MiAtMTU1IC0zMwotMTEwIC00NSAtMTQ0IC0xNTQgLTQyMCAtMTA3IC0yNzMgLTE1MCAtNDQ1IC0xNzQgLTcwMCAtMzIgLTMyNSAtODUgLTY2OAotMTMyIC04NDUgLTEwIC00MSAtNDAgLTEzOCAtNjYgLTIxNSAtNDUgLTEzNSAtNDYgLTE0NCAtNDcgLTI2MCAwIC0xMTQgMgotMTIzIDMxIC0xODUgMzMgLTY5IDc2IC0xMTggMTkyIC0yMTggMTkwIC0xNjMgMzczIC0xODMgNjAyIC02NyAxNTEgNzYgMjE4CjE2MSAyNDYgMzEwIDM4IDIwMSAtNCA0MjIgLTEzNiA3MzAgbC01MiAxMjAgMTQgNjAgYzE5IDg3IDE3IDQxNyAtNCA1ODAgLTQ3CjM2MCAtNDYgNDY1IDEyIDg4NSAxNiAxMTIgMTIgMzY1IC01IDQwOCAtNDAgOTUgLTEyNiAxMzUgLTIxMiA5N3ogbTEwMSAtMTA0CmM1OCAtNjQgNjAgLTE5NiAxMCAtNTYzIC0xNiAtMTI0IC0xOSAtNTM0IC0zIC02NDMgMzYgLTI1OSA0NSAtNDMwIDI5IC01NjEKLTE0IC0xMTMgLTI3IC0xMzkgLTY1IC0xMzAgLTU2IDE0IC0yNTAgMTggLTM1OSA3IC0xNDUgLTE1IC0xNDkgLTEzIC0xMzUgNjkKMTEgNjEgMzUgMjU4IDQ5IDM5MCAzNiAzNTMgNzkgNTM0IDE5OCA4MjUgMzcgOTAgMTA5IDI4MyAxMzQgMzYwIDE1IDQ2IDI4IDk1CjQyIDE1NyAyMyA5OSA2MSAxMzMgMTAwIDg5eiBtMTEgLTIwMDUgYzMwIC0yMCAxMDEgLTE3MyAxNjUgLTM1NiA1MCAtMTQyIDUzCi0zNTYgNyAtNDUxIC03NSAtMTU1IC0zMTYgLTI4MCAtNDc5IC0yNDggLTY1IDEzIC0xMjQgNDcgLTIyNyAxMzEgLTEwMyA4NQotMTU1IDE1MyAtMTc2IDIzMyAtMjIgODEgLTE1IDEyOSA0OCAzMjUgMjQgNzQgNTAgMTYwIDU3IDE5MCAyNyAxMTMgNDIgMTYwCjUzIDE2NyA1NSAzNCA1MDMgNDEgNTUyIDl6Ii8+CjxwYXRoIGQ9Ik0yMDQ3MSA3MDMyIGMtNDggLTUxIC0xNzMgLTI5NyAtMjA0IC00MDIgLTU0IC0xODAgLTY4IC0yODIgLTY4Ci00NzUgMCAtMTMzIDUgLTIxNiAyMSAtMzE3IDQ0IC0yODQgNTcgLTQzNyA0OSAtNTUzIC03IC0xMTMgLTE1IC0xNDQgLTY5Ci0zMDAgLTc4IC0yMjQgLTk4IC00MTYgLTYyIC01ODcgMjUgLTExOCA1OSAtMTg3IDEyMCAtMjUxIDc2IC03OCAyMDQgLTEwMAozMjggLTU2IDEwMyAzNiAxNjcgNDggMjYyIDQ5IDc3IDAgMTA4IC01IDE4OCAtMzEgMTcyIC01NiAyNjcgLTMwIDM3MCAxMDMgMzQKNDQgNjMgOTcgODQgMTU1IDI5IDc3IDM0IDEwMyAzOCAyMTMgNSAxNTUgLTEzIDI1NSAtNzAgMzg0IC05NCAyMTUgLTE1MiAzNjYKLTIwMSA1MzEgLTE0IDQ1IC0yOSAxMTQgLTU3IDI2MCAtMTggOTAgLTMxIDI5OCAtMjUgNDAwIDUgOTAgMTQgMTYwIDQ1IDM3NwoxNCA5MiAxMiAxNTIgLTUgMjY2IC0yNiAxNzEgLTY1IDI2MyAtMTE0IDI3MCAtNDQgNyAtMTA5IC05IC0xNDggLTM1IC0zNyAtMjUKLTM4IC0yNSAtODMgLTkgLTI2IDkgLTc3IDE2IC0xMjAgMTYgLTQxIDEgLTkzIDcgLTExNSAxNSAtMjIgOCAtNjAgMTUgLTg0IDE1Ci0zOCAwIC00OSAtNSAtODAgLTM4eiBtMTQ0IC03OSBjMTAgLTEwIDE1IC0yNiAxMiAtNDIgLTIgLTE0IC0xNSAtODAgLTI4Ci0xNDYgLTIwIC0xMDYgLTIzIC0xNTEgLTIzIC0zNzUgLTEgLTI0MSAwIC0yNTggMjEgLTMwMiAxMiAtMjYgMzggLTYzIDU3IC04MwpsMzYgLTM2IDAgLTEyNyBjMCAtMTE1IDIgLTEzMCAyMCAtMTUwIDI1IC0yNiAzMyAtMjcgNTQgLTcgMTMgMTMgMTQgMzcgOSAxNTAKLTUgMTE3IC00IDEzNyAxMSAxNjAgNTAgNzcgODUgMjEyIDExNSA0NDUgMzggMjkyIDYxIDQyMSA4MyA0NjUgMzQgNjUgODYgODUKMTA3IDM5IDQ2IC0xMDMgNjUgLTMwMiA0MSAtNDM1IC03NCAtNDAzIC0zOCAtODQxIDk5IC0xMjE5IDE3IC00NiAzMSAtOTAgMzEKLTk4IDAgLTE2IDkgLTE2IC0zNjAgOCAtMTU3IDEwIC0zMDAgNyAtNDQ0IC0xMSAtNTYgLTcgLTgyIC03IC05MCAxIC03IDcgLTEyCjY2IC0xMyAxNTggLTEgODEgLTYgMTc5IC0xMiAyMTcgLTYgMzkgLTE3IDExNyAtMjYgMTc1IC01MiAzNDIgLTU2IDQ0NyAtMjUKNjM0IDI2IDE1MSA2NyAyNzQgMTM2IDQwNSA4MiAxNTUgMTA5IDE5MSAxNDQgMTkxIDE2IDAgMzYgLTcgNDUgLTE3eiBtMjEwCi0xNyBjNTAgLTIxIDU4IC00NCA0MSAtMTE4IC04IC0zNSAtMjIgLTEzMyAtMzEgLTIxOCAtMzAgLTI3OCAtODMgLTUwMSAtMTIwCi01MDQgLTUgLTEgLTIxIDIyIC0zNSA0OSAtMjIgNDUgLTI1IDY1IC0yOSAxOTUgLTQgMTUxIDcgMjYxIDQxIDQ0MCAzNCAxNzYKNDcgMTkyIDEzMyAxNTZ6IG0xNDUgLTE4MzcgYzgwIC02IDE4NyAtMTIgMjM4IC0xMyA1MSAtMiA5NyAtNyAxMDEgLTEyIDEyCi0xNCA4NyAtMTkzIDEwOSAtMjU5IDQ3IC0xNDYgMzcgLTMxNiAtMjcgLTQ0NCAtNDggLTk0IC04MSAtMTM1IC0xNDAgLTE3MwotNTMgLTMzIC05OCAtMzYgLTE1OSAtOCAtNTggMjYgLTE3OCA1MCAtMjUyIDUwIC03MSAwIC0xNzggLTIzIC0yNjggLTU2IC0zNwotMTQgLTg0IC0yNCAtMTE2IC0yNCAtNDUgMCAtNjEgNiAtMTA3IDM4IC00NCAzMCAtNjEgNTIgLTkyIDExMiAtNDcgOTMgLTYxCjE3MyAtNTMgMzEyIDYgMTIwIDMwIDIyMCA4NCAzNTIgMzQgODQgNDAgOTIgNzQgMTAzIDg5IDI5IDM3MiAzOSA2MDggMjJ6Ii8+CjxwYXRoIGQ9Ik00ODA0IDY5ODMgYy0yMCAtMTQgLTQyIC02NyAtNTQgLTEyOCAtOCAtNDIgLTEwIC0xNTQgLTUgLTM3NSAxMwotNjkyIDE4IC02MTAgLTU1IC05MTUgLTE3IC03MSAtNDAgLTE3MyAtNTAgLTIyNSAtMjIgLTEwOSAtMzUgLTE0NyAtMTE4IC0zNTUKLTgzIC0yMDggLTEwNiAtMzAzIC0xMDcgLTQ0MSAwIC0xMDcgMSAtMTEyIDM3IC0xODUgNDEgLTgzIDk1IC0xMzYgMTg4IC0xODUKNDkgLTI2IDY1IC0yOSAxNDUgLTI5IDg2IDAgOTMgMiAxNzIgNDMgMTEyIDU3IDE0MyA1NyAyNDggLTUgMTAyIC01OSAxNDkgLTczCjI1MCAtNzMgMTE5IDAgMTc3IDIxIDI0NiA5MCA2NiA2NiA4NCAxMTYgMTAxIDI4OCAxNSAxNDQgMiAyNDcgLTQzIDM1MiAtNjkKMTYyIC04NCAyNjMgLTc2IDQ5NCA0IDk0IDEyIDIxNiAxOSAyNzEgMTcgMTM3IDE3IDYwOCAwIDcwNSAtMjIgMTI4IC00MiAyMTMKLTYzIDI3MCAtNDAgMTA5IC0xNjEgMzE2IC0yMjQgMzg0IC0yNiAyOCAtMjkgMjggLTkzIDIyIC0zNyAtNCAtMTE1IC0xMSAtMTc0Ci0xNCAtNzkgLTYgLTExMSAtMTIgLTEyNiAtMjUgLTI0IC0yMiAtMjcgLTIyIC02OCAxMCAtMzYgMjcgLTEyNiA0MyAtMTUwIDI2egptNjEzIC0xODQgYzY3IC05NSAxNDggLTI1NyAxNjcgLTMzNCA4IC0zMyAyMCAtODIgMjYgLTExMCAxOSAtNzUgMjQgLTUyMCAxMAotNzEwIC03IC04OCAtMTUgLTIzNSAtMTcgLTMyNyAtMyAtMTEyIC05IC0xNzAgLTE3IC0xNzcgLTExIC05IC0xMDUgMiAtMzQxCjQyIC0xOTkgMzQgLTM1MiAyOSAtNDc0IC0xMyAtNzYgLTI3IC04NiAtMTcgLTY2IDY1IDE3IDY2IDgyIDM1NyA5NSA0MjAgNTIKMjU1IDU4IDM0NyAzNSA1MzAgLTI0IDE5NiAtMTkgNjE0IDggNjYzIDIyIDQwIDM4IDQwIDcxIDIgNDIgLTUxIDU3IC0xMTggMTQyCi02NDUgMjcgLTE3MSA1MiAtMjc3IDg0IC0zNjIgMTEgLTMwIDIwIC03MiAyMCAtOTQgMCAtNTAgMTUgLTc5IDQxIC03OSAyMSAwCjM0IDI0IDQ0IDgyIDMgMjEgMjUgNzUgNDkgMTIwIDU4IDExMiA3MSAxNzkgNzAgMzc4IDAgMTYwIC0xNyAzMzMgLTQ5IDUwNQotMTggOTkgLTE5IDEzMiAtMiAxMzggMjEgOCA1MSAtMTggMTA0IC05NHogbS0yMzcgNjYgYzM0IC0xNyAzMSAtNiA2NyAtMjI1CjI0IC0xNDEgMjggLTE5NCAyOCAtMzY1IDAgLTIxNiAtNCAtMjUyIC0zNSAtMzAzIC0xNiAtMjYgLTI0IC0zMSAtMzQgLTIzIC0yMgoxOCAtNTggMTk4IC05NiA0NzEgLTE3IDExOSAtMzggMjM0IC01NyAzMDcgLTEzIDUyIC0xNCA2NyAtMyA5MyAyNCA1NyA3MyA3NAoxMzAgNDV6IG0zMCAtMTc3NCBjNjkgLTExIDE2NiAtMjcgMjE1IC0zNSA1MCAtOSAxMDYgLTE2IDEyNiAtMTYgMjAgMCA0MiAtNgo0OCAtMTMgNiAtOCAyMiAtNTMgMzYgLTEwMSAxNCAtNDggMzYgLTEwOCA0OSAtMTM0IDQ3IC05MyA1NyAtMTk3IDMyIC0zMzkKLTIyIC0xMjEgLTYyIC0xODYgLTE0MSAtMjI2IC0xMDYgLTUzIC0xODEgLTQxIC0zNTAgNTggLTU2IDMyIC02NiAzNSAtMTQ0IDM1Ci04MCAwIC04OCAtMiAtMTYwIC00MiAtNjMgLTM0IC04NiAtNDEgLTEzMSAtNDIgLTk4IDAgLTIwOSA3NCAtMjU5IDE3NiAtMjcKNTMgLTMxIDcyIC0zMSAxNDMgMCA5NCAyMiAxODkgNzQgMzIyIDY2IDE2OCA3NyAxODMgMTQ4IDE4MyAxNyAwIDYxIDkgOTcgMTkKMzYgMTEgNzcgMjIgOTEgMjQgNjEgMTAgMTg1IDUgMzAwIC0xMnoiLz4KPHBhdGggZD0iTTIyOTYwIDY5MTAgYy0xMCAtMTAgLTMxIC0zNyAtNDQgLTU5IC0zNCAtNTQgLTQzIC01NyAtNzQgLTI4IC03NAo2OCAtMTIxIDcyIC0yMTMgMTUgLTQ5IC0zMCAtNTQgLTMxIC05MyAtMTkgLTEzMiA0MCAtMTQ2IDMwIC0zMjAgLTIyOSAtNTkKLTg5IC0xMDcgLTE4OSAtMTI4IC0yNzAgLTMyIC0xMjMgLTQ5IC0yMTYgLTY3IC0zNzAgLTEyIC05NiAtMjYgLTIwMCAtMzEKLTIzMCAtNSAtMzAgLTEyIC03MyAtMTUgLTk1IC03IC00MSAtOTIgLTMwNSAtMTM5IC00MjYgLTQxIC0xMDggLTY1IC0yNTcgLTc2Ci00NTggLTUgLTEwMiAtNyAtMjAzIC0zIC0yMjYgMTEgLTc3IDQ3IC0xMjUgMTQ4IC0yMDIgNjYgLTUwIDIyMyAtMTM0IDI3OAotMTQ5IDY4IC0xOCAxODIgLTE4IDI0MyAxIDcxIDIyIDEzMiAxOCAyMjYgLTEyIDExOCAtMzggMjExIC0zOCAyOTUgMSA3NSAzNAoxMzUgOTYgMTY5IDE3MiA3MyAxNjYgNDcgNTE0IC02MSA4MDkgLTU0IDE0NyAtNjYgMTk5IC03MiAzMTUgLTQgNzkgLTEgMTI3CjExIDE5MCAzNiAxNzQgNDUgMjg2IDM0IDM4MyAtMTUgMTMxIC00IDI2MiAzMiAzOTIgNDIgMTU1IDU0IDI1NyA0MSAzNDUgLTIyCjEzOCAtODUgMjA2IC0xNDEgMTUweiBtLTE5MCAtMTY2IGMyMiAtMjAgNDAgLTQ0IDQwIC01NCAwIC0xMCAtMTIgLTM3IC0yNgotNjEgLTE0IC0yNCAtNTggLTEwMCAtOTggLTE2OSAtNDAgLTY5IC03OSAtMTI1IC04NyAtMTI1IC0xMSAwIC0xNCAyOSAtMTcKMTY1IC0xIDEwMCAyIDE3NSA4IDE5MCA3IDE3IDMzIDM3IDczIDU3IDM0IDE4IDYzIDMyIDY0IDMyIDIgMSAyMSAtMTUgNDMgLTM1egptMjM4IDE0IGMyMiAtMjIgMTMgLTEzNyAtMjIgLTI3OSAtNDYgLTE4MyAtNjAgLTI3NiAtNTIgLTM0NiAxNSAtMTMzIDE4IC0yMzIKOCAtMjkzIC02IC0zNiAtMjAgLTExNyAtMzEgLTE4MCAtMjUgLTE0MSAtMjYgLTE4NSAtNCAtMzIzIDExIC02NyAxMyAtMTExIDcKLTExNiAtMTQgLTE1IC05NjcgLTE3IC05NzIgLTIgLTIgNiAxMCA0OCAyNiA5NCAzNiA5OSA4OCAyOTUgOTYgMzU3IDY5IDU5NAoxMDEgNzAxIDI3NSA5MzUgOTQgMTI1IDExMSAxNDEgMTM4IDEyNyAxNiAtMTAgMTggLTI5IDE5IC0yMjkgMCAtMTIwIDQgLTI3NAo4IC0zNDMgNyAtMTEwIDUgLTEzNiAtMTQgLTIxNSAtMTEgLTQ5IC00NCAtMTQwIC03MSAtMjAxIC01OSAtMTI5IC02MyAtMTc3Ci0xNyAtMTgyIDI1IC0zIDMxIDQgNzEgODUgNzEgMTQyIDEyNyAzNDEgMTI3IDQ1MSAwIDI0IDIxIDY5IDczIDE1NSA0MSA2NwoxMTMgMTkwIDE2MiAyNzIgMTU3IDI2NiAxNTAgMjU2IDE3MyAyMzN6IG0tNDIgLTE2NTAgYzUgLTYgNTggLTE2OCA3MiAtMjIzCjM5IC0xNTEgNDcgLTM1MSAxOCAtNDUwIC0xMCAtMzMgLTMzIC04NCAtNTIgLTExMyAtNjAgLTkyIC0xNjggLTEyNCAtMjg5IC04NgotMjcgOCAtODMgMjEgLTEyNCAyOSAtNzAgMTQgLTgxIDEzIC0xNjQgLTYgLTEyNCAtMjkgLTE5MyAtMjQgLTI4OSAyNCAtMTE3CjU3IC0yNjUgMTc0IC0yOTUgMjMxIC0xMyAyNSAtMTQgNTIgLTkgMTUzIDggMTM5IDI4IDMwOCA0NSAzNzAgNyAyNSAyMSA0OCAzNAo1NSAxMiA3IDY5IDE1IDEyNyAxOSAxMTYgNyA5MTggNCA5MjYgLTN6Ii8+CjxwYXRoIGQ9Ik0yODM4IDY4ODMgYy04NSAtOTIgLTk2IC0yMjggLTM5IC01MDggNTQgLTI2MCA3NCAtNDQ3IDc1IC02ODAgMgotMzQ5IC0yNyAtNTY1IC0xMDMgLTc4MCAtNTAgLTEzOSAtNTMgLTMzNSAtOSAtNTI1IDQ1IC0xOTUgNzEgLTI1MSAxMzMgLTI4Mgo1NyAtMzAgMTcxIC0zNSAyNTUgLTEzIDkxIDI0IDI1MiAzMCA0MDMgMTUgMjA4IC0yMiAzMTkgNCA0MTggOTYgNTcgNTQgODgKMTAzIDEyMyAxOTIgNjkgMTc3IDc5IDQ0MSAyMyA2NDIgLTE0IDQ3IC01NCAxNTkgLTkwIDI1MCAtOTQgMjM4IC0xMzEgNDEwCi0xNTYgNzMwIC0xNyAyMDkgLTUyIDMwMyAtMjM2IDYzMCAtNDIgNzQgLTg2IDE0NSAtOTggMTU4IC0yNCAyNiAtODMgMzAgLTEyNgo3IC0yMyAtMTEgLTYxIC0xMyAtMTg2IC0xMCAtMTQyIDQgLTE1OSA2IC0xNzEgMjQgLTggMTAgLTM1IDMzIC02MSA1MCAtNjIgNDEKLTExOCA0MyAtMTU1IDR6IG0xMjYgLTEwOSBjNTEgLTUwIDY5IC05MSAxMDUgLTIzOSA2MyAtMjU3IDk4IC0zMjAgMjQ2IC00NDkKbDQwIC0zNCAxMSAtMjQ0IGM3IC0xMzQgMTcgLTI2MCAyNCAtMjgxIDEwIC0zNSAxNCAtMzggNDMgLTM1IDMyIDMgMzIgMyAzMQo1OCAtMSAzMCAtNiAxMTggLTEzIDE5NSAtNiA3NyAtMTMgMjQxIC0xNiAzNjUgLTYgMjIxIC0xNiAzNjAgLTM2IDQ5MiAtNiAzNwotOCA3NiAtNCA4NiA3IDI1IDU4IDQ3IDc5IDM1IDIxIC0xMSAxNjYgLTI2MSAyMzIgLTM5OCA1NSAtMTEzIDg0IC0yMTggODQKLTMwMyAwIC00MyAzNyAtMzI0IDYwIC00NTIgMTEgLTYxIDU5IC0yMTcgOTIgLTI5NyAzNiAtODkgNjQgLTgzIC00MDQgLTgzCi00MTIgMSAtNTYyIDEwIC01ODkgMzcgLTEwIDEwIC0xMCA0OSAwIDE4MCAyNSAzNjMgOCA1OTAgLTc5IDEwNzEgLTI2IDE0MAotMjkgMTcwIC0yNCAyMDIgOSA0OCA1MSAxMzAgNjggMTMwIDcgMCAyOSAtMTYgNTAgLTM2eiBtMzEyIC03NyBjMjkgLTI1IDI5Ci0yOCA1MyAtMjMyIDYgLTQ0IDExIC0xMTggMTMgLTE2NSAzIC03MiAxIC04NSAtMTMgLTg4IC0yMiAtNCAtMTA0IDExOCAtMTMxCjE5NSAtMjggODAgLTY4IDI0MiAtNjggMjc0IDAgMzIgOSAzNyA3MiAzOCAzNSAxIDUzIC01IDc0IC0yMnogbS0xMTYgLTE1OTcKYzkxIC02IDI4OCAtOCA0NzYgLTQgMTc2IDQgMzMyIDQgMzQ2IDEgNzUgLTE5IDEyMSAtMzUwIDc0IC01MzcgLTQzIC0xNzAKLTExNSAtMjc4IC0yMTkgLTMzMCAtODMgLTQxIC0xMzcgLTQ1IC0yOTIgLTI1IC0xNTggMjEgLTI4NiAxNCAtNDE4IC0yMSAtMTA1Ci0yOSAtMTQxIC0yNiAtMTg3IDEzIC00MiAzNSAtNjMgODEgLTg4IDE4OCAtNjIgMjcyIC01OSAzMzYgMjcgNTc1IDE3IDQ3IDMxCjkwIDMxIDk3IDAgNiA1IDI0IDEwIDM4IDkgMjQgMTQgMjYgNDggMjEgMjAgLTMgMTA3IC0xMSAxOTIgLTE2eiIvPgo8cGF0aCBkPSJNMTQ0MCA2Nzk4IGMtMzMgLTE3IC01MSAtMzUgLTY4IC02OCAtMjIgLTQzIC0yMyAtNTIgLTE3IC0xODUgOAotMTk4IDI1IC0zNDQgNjAgLTUxNSA3IC0zNiAxOCAtOTAgMjQgLTEyMCA0MCAtMTk5IDUzIC01NTYgMjYgLTcyMyAtOCAtNTEKLTM2IC0xNTYgLTYxIC0yMzIgLTU1IC0xNjQgLTYzIC0yNDcgLTQ1IC00NDIgMTcgLTE4NCA1NiAtMjU1IDE2OSAtMzA1IDg0Ci0zOCAxNDIgLTQwIDMxMyAtMTMgMTU5IDI1IDMwNSAzMSAzODkgMTUgMjUgLTQgNjIgLTExIDgyIC0xNSA1NCAtMTEgMTA0IDIKMTQzIDM2IDY1IDU3IDEwOCAyMjYgMTA5IDQyOSAwIDIyMCAtNTQgMzY4IC0yMDUgNTYwIC0xNyAyMSAtNTAgMTAwIC04MiAxOTUKLTE2MSA0NzQgLTM1NiA5MzggLTUyMyAxMjQ0IC02OSAxMjggLTEwMCAxNTMgLTE5NiAxNTggLTYyIDQgLTgwIDEgLTExOCAtMTl6Cm0xNzMgLTk4IGM3NyAtNjcgMzE3IC01NzQgNDc1IC0xMDAwIDc2IC0yMDYgMTMyIC0zNzYgMTMyIC0zOTkgMCAtMjcgLTExIC0yOQotMjA1IC0zNSAtMTcwIC01IC0yODAgLTI3IC0zNzMgLTc1IC0yNCAtMTIgLTUzIC0yMSAtNjQgLTE5IC0yMSAzIC0yMSA4IC0yMwoyNzggLTIgMjIyIC03IDMwMSAtMjQgNDEzIC0xMSA3NyAtMjMgMTQyIC0yNiAxNDcgLTMgNCAtOSAzNiAtMTQgNzEgLTYgMzUKLTE3IDEwNyAtMjYgMTU5IC0xOCAxMDYgLTMxIDM4MyAtMjEgNDI0IDQgMTUgMjEgMzUgMzkgNDYgNDcgMjkgOTAgMjYgMTMwCi0xMHogbTY5NyAtMTU3NiBjMTI5IC0xNDIgMTkxIC0zNDAgMTY5IC01NDQgLTE4IC0xODEgLTY5IC0yOTAgLTEzMyAtMjkwIC0xNQowIC03MCA3IC0xMjQgMTYgLTExNCAxOSAtMTg4IDE1IC0zOTIgLTIwIC0xMTUgLTIwIC0xNTQgLTIzIC0xODkgLTE1IC04NSAxOQotMTM4IDU3IC0xNzQgMTI0IC0yMCAzNyAtMjIgNTQgLTIyIDIzNSAwIDE4OCAxIDE5NyAyNiAyNTUgMTQgMzMgMzMgODAgNDIKMTA1IDE2IDQzIDIxIDQ3IDk5IDgxIDIyNiAxMDAgMjU2IDEwNiA0OTEgMTA2IGwxNTggMCA0OSAtNTN6Ii8+CjxwYXRoIGQ9Ik0yNDI4MCA2NzcxIGMtNTAgLTI3IC01NyAtMzcgLTE2MiAtMjI2IC0yMDMgLTM2NiAtMjY3IC01MDQgLTM2MwotNzkwIC03MSAtMjEyIC05OSAtMzEzIC0xMTAgLTQwOSAtNyAtNTEgLTE0IC02NiAtNTAgLTEwNSAtNjQgLTcxIC0xNzUgLTI2NAotMjEyIC0zNzEgLTI5IC04NCAtMzMgLTEwNyAtMzMgLTIwMSAwIC03NyA1IC0xMjUgMTkgLTE3MCAxMSAtMzUgMjQgLTkxIDMwCi0xMjMgNiAtMzMgMTggLTcwIDI3IC04NCAyMCAtMzAgMTA3IC02OSAyMDEgLTkwIDcyIC0xNSA3MyAtMTUgMTYzIDEzIDEyNCAzOAoyMjcgMzMgMzUwIC0xNSAxNDggLTU4IDI1NiAtNDAgMzIyIDU1IDM4IDU1IDc2IDE5OCA4NyAzMjIgMTMgMTQ1IC0xIDI3MyAtNDMKNDA4IC0zMSAxMDEgLTQzIDE2MSAtNjcgMzQ1IC0xMSA4OSAtMTEgMzQyIDEgNDc1IDEwIDExMCAxNSAxNTAgNDQgMzQ1IDM1CjIzMSA0OCAzNTkgNDQgNDQxIC01IDEwMSAtMTggMTI2IC04NiAxNzAgLTU0IDM0IC0xMDkgMzggLTE2MiAxMHogbTExNCAtOTIKYzM2IC0yOCA1NiAtNzAgNTYgLTExNiAwIC0zNSAtMTYgLTE2NiAtNTUgLTQ0OCAtNDAgLTI4NSAtNDcgLTM2MSAtNTIgLTUxNQotMyAtMTMzIDAgLTE5MSAxNiAtMzAwIDEzIC04NiAxNyAtMTM4IDEwIC0xNDUgLTYgLTYgLTI0IC01IC01MiAzIC0xNjYgNDcKLTI1MCA2NSAtNDAxIDgzIC05NCAxMiAtMTc3IDI3IC0xODQgMzQgLTExIDEwIC0xMSAyNSAtMiA3NiAxNyAxMDIgNDAgMTg2IDcyCjI3MyAxNiA0NSA0NSAxMzEgNjUgMTkxIDQyIDEzMCAxMTYgMjk4IDIwMCA0NTAgMTcwIDMxMCAyMDcgMzczIDIzOCA0MDMgNDEKMzggNTMgMzkgODkgMTF6IG0tNTAxIC0xNTI5IGMyNTEgLTMzIDQ3OCAtMTAyIDUxNCAtMTU3IDMyIC00OCA2NCAtMjAzIDY1Ci0zMDggMSAtMTY5IC00NiAtMzQwIC0xMDggLTM5NCAtNDYgLTQxIC05NCAtNDEgLTE5OSAwIC0xMDcgNDIgLTI1NiA1MSAtMzU1CjIzIC05NCAtMjcgLTE4MiAtMjQgLTI1MiA4IC02MyAyOSAtNTkgMjIgLTEwOCAyMTQgLTM1IDEzOSAtMjUgMjIxIDQ2IDM2NyA5OAoyMDMgMTQ4IDI2NyAyMDggMjY3IDE5IDAgMTA0IC05IDE4OSAtMjB6Ii8+CjxwYXRoIGQ9Ik0xNTkwMCAzODA3IGMtMTI3IC0yOSAtMjU5IC0xMjcgLTMxMyAtMjMzIC01NSAtMTA4IC02MiAtMTU4IC02MgotNDI5IDAgLTMxMSAxMSAtMzY2IDEyNSAtNjE0IGw2MiAtMTM0IDkgLTIxNiBjNSAtMTE5IDExIC0yMjcgMTQgLTI0MSAyIC0xNAoxNiAtOTUgMzAgLTE4MCAyMyAtMTQ2IDM0IC0yMjMgNTYgLTM4NCAxOCAtMTM2IDYwIC0zNzMgODUgLTQ4MSA2MSAtMjYyIDEyOQotNDU0IDI0NiAtNzAzIDUwIC0xMDUgMTMzIC0xNTcgMTk4IC0xMjIgMjcgMTUgNjEgNjYgNzEgMTA4IDUgMjAgNCAyMzUgLTEKNDc3IC0xMCA0NDMgLTggNDk0IDI1IDcwMCAyOCAxNzUgMzUgMzE0IDI0IDQ3NyAtMjAgMzE4IC0yMiA0MDAgLTkgNTE3IDE0CjEzNyAxNCAxMzQgODAgMzI0IDg3IDI1MSAxMTIgMzU0IDE0MCA1NTggMTcgMTI2IDEgMTkxIC02MCAyNDIgLTE3IDE1IC00NiAzMQotNjUgMzYgLTQ1IDEyIC04MiAzOSAtMTg1IDEzNSAtMTEzIDEwNSAtMjMwIDE2NCAtMzQwIDE3MSAtNDMgMyAtOTkgLTEgLTEzMAotOHogbTI1MiAtMTIwIGM2NCAtMzYgMTM2IC05NCAyMTggLTE3NCAyNSAtMjUgNzcgLTYwIDExNyAtNzkgNDAgLTE5IDgyIC00Nwo5NCAtNjIgMTkgLTI0IDIxIC0zNSAxNSAtMTA3IC03IC04NSAtMjggLTIwNCAtNTMgLTI5NSAtNTEgLTE5MCAtMTUwIC00NTgKLTE3NCAtNDcxIC0zMyAtMTcgLTE2OCAtMjEgLTM3NCAtMTEgLTExMCA2IC0yMDcgMTMgLTIxNSAxNiAtMjIgOSAtOTYgMTUxCi0xMjYgMjQyIC01MSAxNTYgLTY2IDM2MyAtNDMgNTg1IDEyIDEyNSAzNiAxODIgMTA3IDI2MCA1MCA1NSAxNDQgMTE0IDIwNwoxMzAgMTYgNSA2MCA3IDk3IDUgNTQgLTMgNzggLTEwIDEzMCAtMzl6IG0tMjQgLTEyOTUgbDI0MyAtNyA3IC0yNzUgYzkgLTM5MAo3IC01ODQgLTcgLTY3MCAtMzMgLTIwNiAtMzYgLTI1NyAtMzUgLTU4MCAwIC0xODQgNCAtMzk4IDggLTQ3NSA3IC0xMTggNgotMTQ2IC03IC0xNzggLTMxIC03NCAtNzIgLTQzIC0xNDIgMTA4IC0xMjcgMjcyIC0xODIgNDQ1IC0yNDAgNzQ1IC00NiAyNDYKLTU2IDMxMCAtOTUgNjMwIC00IDM2IC0xOCAxMTkgLTMwIDE4NSAtMjQgMTMxIC00MyA1MDAgLTI3IDUyMiA2IDggMjIgMTEgNDYKNyAyMCAtMyAxNDUgLTkgMjc5IC0xMnoiLz4KPHBhdGggZD0iTTEzMzQzIDM3ODIgYy0yMyAtOSAtNTQgLTI3IC02OSAtNDAgLTQ5IC00NCAtNTYgLTc5IC03MCAtMzU3IC0yNwotNTM4IC0xNyAtNjExIDExNiAtNzc1IDU0IC02OSA1OCAtODMgMzQgLTE1MCAtMjUgLTcxIC0zMCAtMjc1IC05IC0zODUgMjYKLTEzNyAzNCAtMjU5IDQ0IC02NDUgOSAtMzE4IDEyIC0zNjggMzUgLTQ4MCAyOCAtMTM3IDUxIC0yMTMgOTAgLTI5MSAzNSAtNjgKOTMgLTEzOCAxMjMgLTE0NSA1MyAtMTQgMTEyIDM3IDE1NSAxMzMgMTkgNDIgMjAgNjkgMjMgMzQyIDEgMTkyIDggMzQwIDE4CjQyMSA4IDY5IDIwIDE4NCAyNiAyNTUgNyA3MiAxNiAxNzEgMjEgMjIyIDYgNTAgMTAgMTM0IDEwIDE4NyAwIDIwNiA3MyA1NjUKMTgwIDg4NiA1NiAxNjggNjQgMjExIDY0IDM1NSAwIDExMCAtNCAxNDEgLTIzIDIwMCAtMzEgOTEgLTQ3IDEyMiAtNzkgMTUyCi01MSA0NyAtOTUgNjIgLTIzOCA3OCAtNzcgOSAtMTgxIDI1IC0yMzIgMzYgLTExMiAyMyAtMTY0IDIzIC0yMTkgMXogbTE0NwotODIgYzM5IC0xMSAxOTMgLTM1IDMyNCAtNDkgMTA1IC0xMiAxNDEgLTMyIDE4OCAtMTA0IDM4IC01OSA1OCAtMTM5IDU4IC0yMzIKMCAtODggLTE4IC0xNzIgLTY5IC0zMjggLTIzIC02NyAtNTYgLTE3OCAtNzUgLTI0NyAtMTkgLTY5IC0zNyAtMTMzIC00MSAtMTQzCi0xMCAtMjQgLTQ2IC0zMSAtMTI5IC0yMiAtMzkgNCAtMTE0IDEwIC0xNjYgMTQgLTExMCA3IC0xMjYgMTUgLTE5MiA5MyAtOTEKMTA2IC0xMTIgMTczIC0xMTMgMzQ4IDAgMTk0IDIyIDU0OCAzNyA1OTUgMjMgNzAgOTIgMTAwIDE3OCA3NXogbTI1NyAtMTIxNgpjMTAyIC04IDEwOSAtMTQgOTUgLTkyIC0xNCAtNzIgLTMwIC0yNDMgLTQyIC00MzcgLTUgLTgyIC0xNiAtMjE1IC0yNSAtMjk1Ci0zNCAtMzIyIC00NSAtNTE0IC00NCAtNzE1IDEgLTE2NiAtMiAtMjE3IC0xMyAtMjQ1IC0xOCAtNDIgLTUyIC03NCAtNzEgLTY3Ci0xNSA2IC05NCAxNTEgLTEwOCAyMDAgLTQ0IDE1MCAtNjkgMzcxIC03MCA2MjIgMCAyNTcgLTEzIDQ3MCAtMzUgNTkwIC0zNgoxOTkgLTI0IDM4NSAyOCA0MzcgMjEgMjEgMzggMjEgMjg1IDJ6Ii8+CjxwYXRoIGQ9Ik0yNDE0MSAzNzc1IGMtMzAgLTE0IC03NCAtNDQgLTk4IC02NSAtMjMgLTIyIC01MSAtNDAgLTYwIC00MCAtMTAgMAotNDMgMTIgLTczIDI2IC04NyA0MSAtMTM5IDU0IC0yMjAgNTQgLTEzMiAtMSAtMjE3IC02MyAtMjkyIC0yMTcgLTQzIC04NyAtNDMKLTg5IC00NiAtMjEzIC02IC0xODYgMyAtMjEyIDE2OCAtNTEzIDQ5IC05MCAxMDUgLTI0NCAxNjAgLTQ0MiAyMSAtNzcgNTAKLTE3OSA2MyAtMjI2IDUwIC0xNzggMTQ2IC0zNjQgMjc3IC01MzggMTI4IC0xNjkgMjAzIC0yNDggMjQyIC0yNTMgNDQgLTcgOTYKNiAxMjIgMzEgMTIgMTIgMjggMjEgMzQgMjEgNyAwIDU2IC0yNSAxMTAgLTU1IDEwOSAtNjAgMTY3IC03NSAyMjcgLTU1IDQ4IDE2Cjc1IDYwIDc1IDEyMyAwIDUyIC0xMSA3OSAtNzUgMTc3IC05OSAxNTIgLTE2NyAzMTkgLTIwNCA0OTUgLTMwIDE0NyAtNjEgMzcxCi02MSA0NDEgMCAxMzEgNDggMzIxIDExMyA0NDkgMjkgNTggMzggODggNzIgMjQ2IDMwIDEzOSAzMSAxNjQgNyAyNTYgLTI5IDEwOQotMTAzIDIwNCAtMTk3IDI1NSAtMTMxIDY5IC0yNTQgODUgLTM0NCA0M3ogbTI1NCAtMTA0IGM4MiAtMzggMTUxIC0xMDYgMTkxCi0xODcgMjMgLTQ3IDI2IC02MiAyMSAtMTI2IC04IC0xMTcgLTQzIC0yNTcgLTkwIC0zNTkgLTUwIC0xMDYgLTg1IC0yMTcgLTk0Ci0yOTEgLTMgLTI3IC0xMiAtNTUgLTE5IC02MiAtMTkgLTE5IC02ODIgLTIzIC03MDYgLTQgLTkgNyAtMzEgNDkgLTQ4IDkzIC0xNwo0NCAtNjUgMTQxIC0xMDUgMjE1IC04NiAxNTggLTg5IDE2NCAtMTEwIDI2NSAtMTMgNjIgLTEzIDg4IC00IDEzOCAyNCAxMzYKMTI4IDI4MyAyMTUgMzA2IDUzIDE0IDkxIDYgMTg0IC0zNyA3NyAtMzYgMTYyIC01MSAyMTYgLTM4IDE0IDQgNDkgMjkgNzggNTUKMjggMjYgNjAgNTMgNzEgNjAgMzUgMjAgMTI0IDggMjAwIC0yOHogbTMgLTExNDQgYzcgLTcgMTYgLTY3IDIyIC0xMzMgMzEKLTM2MSAxMjQgLTY2MSAyNzQgLTg4OSAyNSAtMzggNDYgLTc3IDQ2IC04NiAwIC0xOSAtMjUgLTQ5IC00MSAtNDkgLTE0IDAKLTEyMiA1NiAtMTgyIDk0IC02NiA0MiAtODMgNjIgLTEwMSAxMTQgLTkgMjQgLTQwIDk1IC02OSAxNjAgLTEyOSAyNzkgLTE1NQozNDggLTE3NyA0NjQgLTExIDU2IC0yNiA3MyAtNTUgNjIgLTIyIC05IC0yMCAtMTAzIDQgLTE5NSAxOSAtNzQgMTEyIC0zMDIKMTY5IC00MTQgNTcgLTExNSA2NSAtMTgyIDIzIC0yMDQgLTE0IC04IC0yNSAtNiAtNDUgMTAgLTQ0IDM0IC0xODUgMjA5IC0yNTcKMzE3IC0xMTcgMTc2IC0xNTUgMjcyIC0yNTUgNjM1IC0xOCA2OSAtMjMgMTAxIC0xNiAxMTAgMTYgMTkgNjQ1IDIzIDY2MCA0eiIvPgo8cGF0aCBkPSJNMzg1MSAzNzgwIGMtMzAgLTQgLTg3IC0yNSAtMTI3IC00NSAtODQgLTQzIC0xMDcgLTQzIC0yMTkgLTEgLTE4Mgo2NyAtMzczIDkgLTQ2OSAtMTQzIC01NyAtODkgLTc3IC0yNTQgLTU3IC00NDYgMTUgLTEzNSAyMiAtMTY3IDczIC0zMjQgMzYKLTExMyA0MCAtMTMyIDM2IC0yMDAgLTYgLTk1IC0zMCAtMTY1IC0xMjMgLTM2MSAtODQgLTE3OCAtMTAwIC0yMjQgLTExNyAtMzM1Ci0yNCAtMTUxIC0xNyAtMjg4IDMxIC02NTAgMjUgLTE4NyAzNCAtMjE3IDcyIC0yNDkgMjUgLTIyIDQxIC0yNiA4OSAtMjYgMzMgMAo3MCA1IDg0IDExIDU0IDI1IDgzIDE0NyA4OSAzNzkgNCAxNDEgOSAxNzggMzIgMjU1IDMwIDEwNCA5MCAyMzUgMTY4IDM2NyAzMAo1MSA3MyAxMzAgOTYgMTc2IDIzIDQ1IDUwIDkxIDYxIDEwMiA0OSA0OSAxMTQgNiAxNTYgLTEwMSA0MyAtMTE0IDI4IC0yMTIKLTY5IC00NTQgLTIyIC01NSAtNTIgLTEzNCAtNjggLTE3NSAtMTUgLTQxIC00MyAtMTE0IC02MyAtMTYzIC02NSAtMTU2IC03MQotMzEzIC0xNiAtMzY5IDI1IC0yNSAzNiAtMjggOTAgLTI4IGw2MiAwIDcyIDcyIGMxNzcgMTc5IDI4NCAzNDQgMzY3IDU2NCAxMDMKMjczIDEyNSA1OTIgNjkgOTg1IC0xMCA2NSAtOSA2OCAyOSAxNTAgMjIgNDYgNDcgMTA3IDU2IDEzNCA5IDI4IDQzIDEwOSA3NQoxODEgNjggMTUyIDgzIDIyNiA2OCAzNDQgLTIxIDE3MyAtMTE2IDI5MiAtMjY3IDMzNSAtNjAgMTcgLTIxMiAyNiAtMjgwIDE1egptMTkyIC05MCBjODMgLTEyIDEzMCAtMzUgMTgzIC05MiA3MSAtNzQgMTExIC0xODEgOTggLTI2NyAtMyAtMjUgLTMyIC0xMDcKLTYzIC0xODEgLTMyIC03NCAtNzkgLTE5MCAtMTA2IC0yNTggLTQxIC0xMDMgLTU0IC0xMjYgLTc5IC0xNDAgLTI3IC0xNSAtODAKLTE3IC00NDYgLTE5IC0yMjggLTIgLTQyNSAtMSAtNDM3IDIgLTE1IDQgLTI2IDE5IC0zNiA1MyAtOSAyNiAtMjcgODAgLTQyCjEyMCAtNTggMTYxIC03OSA0MzIgLTQyIDUzOCAyOCA4MCA2OSAxMzYgMTMxIDE3OSA1NyAzOSA2MCA0MCAxNDUgNDAgNzQgLTEKOTQgLTUgMTQ2IC0zMCA0OCAtMjMgNzQgLTI5IDEzMCAtMjkgNjMgMCA3NyA0IDEzOCAzOCAxMDQgNTkgMTQ1IDY1IDI4MCA0NnoKbTQxIC0xMDYyIGMzNSAtNTggNDkgLTQ3OSAyMCAtNjU2IC01MyAtMzMwIC0xNzggLTU2NyAtNDQwIC04MzAgLTI4IC0yOCAtNTkKLTUyIC02OCAtNTIgLTIzIDAgLTM2IDMyIC0zNiA4NyAxIDYwIDEwIDk2IDUzIDIwMyAxNjkgNDIwIDIxNyA1NzIgMjE3IDY5MAotMSAxMDQgLTM4IDIzMCAtODIgMjc3IC00NyA1MSAtMTc1IDY3IC0yMzIgMzAgLTE0IC05IC01NCAtNzQgLTk0IC0xNDkgLTM4Ci03MyAtOTUgLTE3OSAtMTI1IC0yMzUgLTY1IC0xMTkgLTEyMSAtMjU4IC0xNDMgLTM1MCAtOCAtMzYgLTE5IC0xNDggLTI0Ci0yNDkgLTEzIC0yNTYgLTM0IC0zMjAgLTEwMCAtMjk5IC0zMCA5IC00OCA1MiAtNTkgMTQxIC02IDQzIC0xOCAxMjkgLTI3IDE4OQotOSA2MSAtMTggMTc5IC0yMSAyNjQgLTggMjI1IDcgMjg4IDEyMiA1MjYgNzYgMTU4IDEwNiAyMzkgMTI2IDM0MiA2IDM1IDE3CjY3IDI0IDczIDcgNiAxNjEgMTEgNDA2IDEzIDIxNyAxIDQxMSAzIDQzMSA1IDMwIDEgNDEgLTMgNTIgLTIweiIvPgo8cGF0aCBkPSJNOTcyMCAzNzU3IGMtMzAgLTEzIC0xMTAgLTU5IC0xNzcgLTEwMyAtNjcgLTQzIC0xNTAgLTk3IC0xODUgLTExOQotMTE3IC03NCAtMTQzIC0xNDQgLTEzNSAtMzY5IDYgLTE2MSAyMSAtMjM2IDcyIC0zNTYgMTUgLTM2IDQyIC0xMDMgNjEgLTE1MApsMzMgLTg1IDEgLTMwNSBjMSAtMTY4IDUgLTMzOSAxMSAtMzgwIDggLTY4IDE1IC0zMTMgMzcgLTE0MDAgOCAtMzgyIDEwIC0zOTcKNjQgLTQzNCA3MSAtNTAgMTg4IDI1IDI0OSAxNTkgNTMgMTE4IDEzOCAzOTMgMTcyIDU2MCAyMCA5NCA1MiAyNDcgNzMgMzQwIDIwCjk0IDQ3IDIyMCA2MCAyODAgNjggMzE0IDk3IDUzMiA4MyA2NDAgLTEzIDEwMiAtMTAgMjMwIDYgMjk0IDkgMzMgMzMgOTggNTQKMTQzIDc1IDE2NCAxMjMgMzUwIDE1MCA1ODQgMjMgMTk2IDcgMjk2IC03NSA0NjEgLTcyIDE0NCAtMTA0IDE4MSAtMTk2IDIyNAotNjggMzIgLTgxIDM0IC0xODggMzcgLTEwMiAyIC0xMjEgMCAtMTcwIC0yMXogbTI2MCAtNzggYzkwIC0yNCAxNTUgLTg3IDIyNAotMjE5IDYxIC0xMTcgNjggLTE1NSA2MyAtMzA4IC01IC0xNTYgLTI2IC0yOTcgLTYyIC00MjUgLTMwIC0xMDMgLTExMSAtMjgzCi0xMzEgLTI5MSAtNyAtMyAtNjAgLTEgLTExNiA0IC01NyA2IC0xNzMgMTUgLTI1OCAyMSAtMTcwIDExIC0yMDggMjEgLTIxNSA1MwotMiAxMSAtOSA0OCAtMTYgODEgLTYgMzMgLTMzIDExMiAtNTkgMTc1IC03MCAxNjggLTc3IDE4NyAtOTQgMjc0IC0yMCAxMDAKLTIwIDIxOCAtMSAyODQgMjAgNjUgNjAgMTEyIDEzMyAxNTMgMzEgMTggMTA1IDYzIDE2NCAxMDAgNTkgMzcgMTIyIDc2IDE0MAo4NSA2MSAzMyAxMzggMzcgMjI4IDEzeiBtLTI1NSAtMTMxNCBjMjY2IC0yMSAzMTUgLTI3IDMyMSAtMzcgMyAtNSA4IC0xMTYgMTAKLTI0NiA1IC0yMTEgMyAtMjUxIC0xNiAtMzYyIC0zMCAtMTc3IC0zNSAtMTk5IC04NiAtNDE1IC0yMiAtOTIgLTQzIC0xOTMKLTEwNSAtNDkwIC0zMCAtMTQ3IC0xMTMgLTQwOSAtMTY4IC01MjkgLTMyIC03MSAtODUgLTEzNiAtMTEwIC0xMzYgLTMxIDAgLTQxCjQ1IC00MSAxODggMCA3NSAtNSAyMjMgLTEwIDMyNyAtNiAxMDUgLTExIDMzNiAtMTEgNTE1IC0xIDE3OSAtOCA0MjIgLTE1IDU0MAotOCAxMTggLTE3IDMwNyAtMjEgNDIwIC01IDE4NiAtNCAyMDcgMTEgMjIzIDIxIDIwIDcgMjAgMjQxIDJ6Ii8+CjxwYXRoIGQ9Ik0xMjI5OSAzNzU2IGMtMiAtMyAtNDUgLTEwIC05NCAtMTcgLTUwIC02IC0xMjcgLTI1IC0xNzIgLTQxIC0xODAKLTY1IC0yNDMgLTE3NSAtMjQzIC00MjUgMCAtMTU0IDIyIC0yNzQgNzQgLTM5NyA3NyAtMTgyIDgwIC0xOTYgMTA2IC01MTYgNQotNjkgMTQgLTE2MyAyMCAtMjEwIDE0IC0xMjMgMjkgLTQxNyAzNSAtNzE1IDYgLTI4OSAxMyAtMzc2IDU2IC03MTAgMTEgLTg4CjQzIC0xNjIgOTIgLTIxMyA1OSAtNjIgMTAyIC0zOCAxNzUgOTggMTA1IDE5NiAxMzIgMzYwIDE1MyA5MjUgMTIgMzE1IDE5IDQyMgozOSA1NzAgMTQgMTAxIDggMjg4IC0xMSAzNDcgLTEwIDMyIC05IDQxIDEwIDczIDM2IDYxIDc4IDE2OCAxMDAgMjU2IDE5IDc0CjIzIDEzMSAzMyA0NjUgbDExIDM4MSAtMjQgNDQgYy0zOCA3MCAtODYgODggLTIzNSA4OSAtNjYgMCAtMTIzIC0yIC0xMjUgLTR6Cm0yNDMgLTEwMyBjNTggLTI5IDU5IC0zOSA0OSAtNDA1IC0xMSAtMzcwIC0xOSAtNDI4IC03OCAtNTY1IC0yMyAtNTUgLTQ3IC05NAotNzEgLTExNCBsLTM2IC0zMiAtMTYwIDUgYy05NSAzIC0xNzAgOSAtMTgzIDE2IC0yNCAxMyAtMzYgNDcgLTUzIDE0NiAtMTEgNjkKLTE3IDg4IC04NCAyNDkgLTQ0IDEwOCAtNjEgMjMwIC01MiAzNzEgOCAxMTUgMjAgMTQ4IDcyIDIwNiA2OCA3NiAxMzIgOTggMzY0CjEzMCAxMzkgMTkgMTg1IDE3IDIzMiAtN3ogbS0yNTkgLTEyMDggYzExNCAtMSAxNTEgLTUgMTU3IC0xNiA1IC03IDE0IC00NSAyMQotODMgMTEgLTY3IDEwIC05OCAtMTEgLTI5NiAtOSAtODkgLTMxIC00NDggLTUwIC04MTAgLTE0IC0yODggLTMzIC0zODUgLTEwNgotNTM3IC01MCAtMTA2IC02OCAtMTE2IC0xMDQgLTU4IC00OSA4MCAtNzUgMzYyIC0xMDAgMTEwNCAtNiAxNjggLTE1IDMzNiAtMjAKMzc1IC00MSAzMTcgLTM4IDM0NCAyOSAzMzAgMjAgLTQgMTAzIC04IDE4NCAtOXoiLz4KPHBhdGggZD0iTTE3MjcwIDM3NTEgYy0xNjUgLTU0IC0zMTUgLTI0NSAtMzY2IC00NjYgLTIyIC05NyAtMTIgLTE3NiAzNyAtMjk3CjUxIC0xMjQgMTEzIC0zMjMgMTI4IC00MTMgNyAtMzggMTcgLTg2IDIxIC0xMDUgMjIgLTg3IDUwIC0yOTggNTAgLTM3NyAwIC00OQotNSAtMTM5IC0xMCAtMjAxIC0xMyAtMTQ1IC0xIC0yMjIgNTcgLTM3MSA2NCAtMTY0IDgzIC0yNzkgODMgLTUxMCAwIC0xNTAgNAotMTk5IDE4IC0yNTIgMzMgLTEyMCA5OCAtMjA5IDE4NSAtMjU1IDUwIC0yNiA1NyAtMjcgODcgLTE0IDI0IDEwIDM5IDI3IDU2CjY0IDIzIDQ4IDI0IDYyIDI0IDI2MSAwIDE4MiAxNCAzNzkgNDUgNjc1IDEyIDExMCA3NSA0OTggOTcgNjAwIDggMzMgMTMgMTM3CjEzIDI1NyAwIDE5NSAxIDIwMiAyMyAyMjUgMTIgMTQgMjIgMjggMjIgMzIgMCA1IDQzIDk3IDk1IDIwNSAxMDkgMjI3IDEyOQoyOTMgMTIzIDQwMiAtNCA2MCAtMTAgODYgLTMxIDEyMiAtMzQgNTggLTEzMCAxNDAgLTIzMyAxOTggLTQzIDI2IC0xMjQgNzIKLTE3OSAxMDMgLTU1IDMyIC0xMjIgNzIgLTE0OSA4OSAtMzggMjUgLTYwIDMyIC0xMTAgMzQgLTMzIDEgLTcyIC0xIC04NiAtNnoKbTEzMSAtMTA0IGM2MSAtNDEgMjAyIC0xMjQgMjY3IC0xNTYgMTQ4IC03NSAyNTUgLTE2MCAyOTQgLTIzNSAzNyAtNzIgMjUKLTEyNSAtNzkgLTM0MSAtNTAgLTEwNSAtOTYgLTIwNCAtMTAzIC0yMjIgLTIwIC01NCAtNDIgLTY0IC0yMDcgLTEwMCAtMjQwCi01MSAtMzA5IC01OSAtMzYzIC00MiAtNTAgMTYgLTQyIC0yIC05OSAyMTMgLTE3IDY1IC01NCAxNzQgLTgxIDI0MiAtNTggMTQzCi02MyAxOTYgLTI5IDI5NyA2MCAxODEgMjMzIDM2NyAzNDAgMzY3IDE0IDAgNDEgLTEwIDYwIC0yM3ogbTI5NyAtMTE2MCBjMzQKLTcwIDI2IC0yNDIgLTIyIC01MTIgLTgwIC00NDAgLTEwNiAtNjc3IC0xMTIgLTEwMzAgLTMgLTE1NCAtMTAgLTI5NSAtMTYKLTMxMiAtMTQgLTQ2IC00MiAtNDMgLTkwIDkgLTg2IDkzIC05OSAxNDMgLTEwOCA0MjMgLTkgMjQ0IC0yMiAzMzggLTY2IDQ1NAotODMgMjE3IC04NSAyMzUgLTYyIDQ2OSAxMSAxMTIgMTAgMTM3IC0xMCAyNzkgLTE2IDExNSAtMTkgMTYwIC0xMSAxNzAgOCA5CjM3IDEzIDg4IDE0IDUwIDAgMTI2IDEyIDIyMSAzNCA4MCAxOSAxNTIgMzMgMTYwIDMyIDggLTEgMjEgLTE1IDI4IC0zMHoiLz4KPHBhdGggZD0iTTE4Njk3IDM3NDYgYy0yMSAtOCAtNTcgLTI2IC04MCAtNDEgLTU1IC0zNiAtMjMwIC0yMTYgLTI3MyAtMjgwCi03MiAtMTA3IC04MCAtMjQxIC0yNCAtMzk5IDY2IC0xODkgMTE1IC00NjQgMTQwIC03OTYgNiAtNzQgMTMgLTE2NiAxNiAtMjA1CjYgLTc1IDI4IC0yNjggNDQgLTM3NSAxNSAtMTA5IDMwIC0yMjEgNDAgLTMxNSAyNCAtMjE2IDY5IC00NTcgMTAxIC01NDUgNTEKLTEzOSAxMzIgLTI2NiAxODkgLTI5NSA2NiAtMzQgMTQ3IC05IDE4MCA1NSAzNiA3MCA0MyAxNDggMjQgMjUzIC0xNyA5MSAtMjcKMTcxIC00MCAzMjAgLTE0IDE1NCAyNyA0NzkgMTAxIDgwNyA5NiA0MjMgMTA1IDQ2OSAxMDUgNTM2IDAgNDggOCA3MCA2NCAxNzcKNjQgMTIyIDEwNCAyMTQgMTkwIDQ0NCA3MSAxODkgNjQgMjczIC0zMCAzNDYgLTE4NCAxNDMgLTQyNyAyOTEgLTUxOSAzMTYgLTU1CjE1IC0xODIgMTMgLTIyOCAtM3ogbTE3OCAtODAgYzU5IC0xNSA4NyAtMjkgMjIwIC0xMDkgMTIwIC03MiAzMjEgLTIyMSAzMzYKLTI0OSAxNyAtMzIgNyAtNjcgLTc2IC0yNzggLTg3IC0yMjEgLTE3OCAtNDA1IC0yMTIgLTQyNyAtMzIgLTIxIC0xNjcgLTkKLTMxMyAyOCAtMzE5IDgwIC0zMjMgODIgLTM0MiAxMjAgLTkgMTkgLTI0IDY4IC0zNCAxMDkgLTkgNDEgLTMyIDEyMiAtNTAgMTc5Ci01MiAxNTggLTUzIDE5MSAtOSAyODAgMjcgNTYgNTggOTcgMTIzIDE2NCAxMDUgMTA3IDE2OSAxNTUgMjM2IDE3OSA2MiAyMSA1OQoyMSAxMjEgNHogbS0yNDAgLTEwODcgYzE5MCAtNTYgMzA5IC03OSA0MDUgLTc5IDQ4IDAgNzEgLTQgODAgLTE1IDE4IC0yMSA4Ci05OCAtMzQgLTI4MCAtNTIgLTIyNiAtMTEzIC01MzUgLTEzMiAtNjcwIC0yNyAtMTkwIC0yNSAtNTExIDUgLTY5MSAxNSAtOTAKMjEgLTE1NSAxNyAtMTc5IC03IC0zNyAtNDUgLTg1IC02NyAtODUgLTIzIDAgLTg4IDgzIC0xMjkgMTY0IC00MiA4NiAtODEgMjIxCi05OSAzNDcgLTIxIDE0MiAtNDAgMjg1IC01MSAzNzkgLTYgNTIgLTIxIDE2OSAtMzQgMjYwIC0xNCA5MSAtMjkgMjIxIC0zNQoyOTAgLTYgNjkgLTIwIDIyMyAtMzIgMzQzIC0xMSAxMTkgLTE3IDIyMiAtMTQgMjI3IDkgMTUgNDMgMTIgMTIwIC0xMXoiLz4KPHBhdGggZD0iTTIxNzU0IDM3MTYgYy00OSAtMjQgLTExMCAtNjIgLTEzNSAtODQgLTg4IC03OCAtMTM3IC0yMTQgLTEyNSAtMzQ0CjggLTkyIDM0IC0xNTYgMTE4IC0yODkgMTQ3IC0yMzYgMTcyIC0zMTYgMTQ5IC00ODkgLTYgLTQ3IC0yMCAtMTU1IC0zMSAtMjQwCi0yNSAtMTkxIC0yNSAtMjM3IDAgLTM3MCAyMCAtMTE0IDQyIC0xNzcgMTE4IC0zNDUgNjcgLTE0NyAxMTQgLTIzMCAyMzggLTQxNQoxMjUgLTE4OCAxNDQgLTIwNSAyMzQgLTIwNSAxMTMgMCAxNTUgNDYgMTU0IDE2NyBsMCA3OCAtMTM2IDI3NyBjLTc1IDE1MwotMTQxIDI5OSAtMTQ3IDMyNSAtMjUgMTA3IC04IDMyNCAzMiA0MTkgMjYgNjQgNzggODQgMTM1IDU1IDUxIC0yNiAyMjggLTMwNQoyNzcgLTQzNSA4IC0yMyAyMSAtNTggMjkgLTc4IDUzIC0xNDIgOTYgLTM3NiA5NiAtNTI1IDAgLTEwMyAyIC0xMTIgMzQgLTE3Ngo0OCAtOTYgNjQgLTEwNyAxNDUgLTEwNyA3OCAwIDExNiAxNiAxMzcgNTggMTkgMzUgMzMgMjExIDQxIDQ5MiA4IDMxNyAtMjEKNDc2IC0xMzMgNzE0IC04MyAxNzUgLTg4IDE5NyAtODggMzcxIC0xIDE3MCA4IDIyMCA2OSAzODUgNTggMTU4IDcwIDIxOSA3MAozNTAgLTEgMTEzIC0yIDEyNCAtMzEgMTg1IC02MiAxMzIgLTE5OCAyMjggLTM1NiAyNTEgLTY5IDEwIC04NCA5IC0xNDYgLTEwCi00NSAtMTMgLTg5IC0zNiAtMTI3IC02NiAtMzIgLTI0IC02MSAtNDMgLTY0IC00MSAtMyAxIC00NCAyNiAtOTEgNTMgLTExNyA3MAotMTYxIDgzIC0yNzkgODMgLTk1IDAgLTEwMCAtMSAtMTg3IC00NHogbTMyMSAtNzAgYzI4IC0xMyA4OCAtNDggMTM0IC03OSAxMTAKLTc0IDEzMCAtNzUgMjAyIC02IDMwIDI4IDc3IDYyIDEwNiA3NiA0NyAyMSA1NyAyMyAxMTMgMTQgMjE4IC0zNSAzNTYgLTIxNQozMjAgLTQxOCAtNiAtMzYgLTMzIC0xMzMgLTYxIC0yMTYgLTI3IC04NCAtNTggLTE5MSAtNjcgLTI0MCAtMTAgLTQ4IC0yMyAtOTIKLTI4IC05NyAtMTkgLTE5IC0yMTcgLTMzIC0zODkgLTI2IC0yMDcgNyAtNDU1IDM2IC01MzcgNjIgLTkgMyAtMjYgMzAgLTM3IDYwCi0yOCA3NSAtNzQgMTYzIC0xMzMgMjU4IC05MiAxNDYgLTExOCAyMTEgLTExOCAyOTIgMCA1OSA1IDgxIDMwIDEzMSA1MyAxMDYKMTY4IDE5MyAyODIgMjEyIDY4IDEyIDEyMCA1IDE4MyAtMjN6IG0tMzUgLTEwNTggYzExOSAtMTcgMTkzIC0yMSA0MTAgLTIyCjE0NiAtMSAyNzkgMiAyOTcgNiA0OCAxMSA2MyAtMTAgNjMgLTg3IDAgLTEwNCAyNCAtMTgxIDExMCAtMzYwIDMxIC02NCA2MAotMTQ0IDc5IC0yMjQgMzAgLTEyMCAzMSAtMTMwIDMxIC0zNTUgMCAtMjA3IC0xMSAtNDExIC0yNSAtNDczIC03IC0zMCAtNDgKLTU2IC03NSAtNDggLTM1IDExIC04MCAxMTQgLTgwIDE4MyAwIDEzNyAtNDUgMzg2IC0xMDEgNTU1IC02MSAxODYgLTIwOCA0NTUKLTI5NiA1NDMgLTc2IDc2IC0yNDYgNjYgLTI4OSAtMTcgLTU0IC0xMDUgLTc5IC0zNDggLTUzIC01MDggMTMgLTgyIDU2IC0xODYKMTc2IC00MjggMTEwIC0yMjAgMTIxIC0yNjYgODAgLTMwNyAtMTQgLTE0IC0zMyAtMjYgLTQyIC0yNiAtNzAgMCAtMzMyIDQwMAotNDQ1IDY3OSAtODYgMjE0IC05NyAzMzIgLTU5IDYyNiAxMiA4OCAyNCAxODQgMjggMjEzIDYgNDYgMjEgNzEgNDEgNzIgMyAwCjcxIC0xMCAxNTAgLTIyeiIvPgo8cGF0aCBkPSJNMTUwOCAzNzM1IGMtMTM0IC0zNyAtMjkxIC0xNzkgLTMzOSAtMzA2IC0yMyAtNTkgLTI1IC0xOTUgLTUgLTI0OQo3IC0xOSA0OCAtMTI5IDkwIC0yNDUgNDMgLTExNSA4OCAtMjM3IDEwMSAtMjcwIDUyIC0xMzIgNTEgLTExOSAxNiAtMjY2IC0xOAotNzQgLTM2IC0xNTQgLTQyIC0xNzkgLTY5IC0zMTEgLTExOCAtNDU0IC0xOTggLTU4MiAtOTQgLTE0NyAtMTAxIC0xNjEgLTEwMQotMjExIDAgLTU1IDIwIC0xMDEgNTIgLTExOCA0MyAtMjMgMTkwIDE1IDI3OCA3MSA1MiAzMyA3MSAzMiA4OCAtNiAxNiAtMzQgNzEKLTU4IDExNSAtNTAgNTQgMTAgMTU0IDgwIDI0MiAxNzEgMTI3IDEzMSAyMTIgMjg1IDMyMiA1ODUgODYgMjM2IDEzOCAzNjkgMTYzCjQyMCAxNSAzMCAzMCA2OSAzNCA4NSA0IDE3IDQ3IDExMSA5NiAyMTAgNDkgOTkgMTA4IDIzMiAxMzEgMjk1IDQxIDEwOSA0MwoxMjEgNDMgMjI1IDAgOTggLTMgMTE2IC0yNiAxNjYgLTYyIDEzNSAtMTkyIDIxOSAtMzM4IDIxOSAtMzAgMCAtOTMgLTEyIC0xMzkKLTI1IC0xMjAgLTM1IC0xNzkgLTMzIC0yNjkgMTAgLTEzNiA2NSAtMjE1IDc4IC0zMTQgNTB6IG0yMzMgLTEyMSBjMTM4IC02MwoyMDAgLTcyIDMwOSAtNDQgMTY0IDQyIDE4OSA0NSAyNTIgMjYgODcgLTI1IDE2OSAtMTA1IDE5OSAtMTkzIDI2IC04MCAyMwotMTE2IC0yNyAtMjYyIC00OSAtMTQ1IC0yMDMgLTQ2MSAtMjM5IC00ODkgLTI3IC0yMiAtMzIgLTIyIC0zODcgLTIyIGwtMzU5IDAKLTIyIDIzIGMtMzEgMzAgLTIzNyA1OTQgLTIzNyA2NDYgMCA5NiAxMjEgMjU1IDI0MSAzMTYgMTEwIDU3IDE0NSA1NyAyNzAgLTF6Cm00NTQgLTEwODQgYzMgLTUgLTE3IC03MSAtNDUgLTE0NyAtMjggLTc2IC03MSAtMTk0IC05NiAtMjYzIC0xMTIgLTMwNyAtMjMzCi00OTggLTM5NyAtNjI4IC05MSAtNzIgLTEwMCAtNzYgLTEzMSAtNTEgLTMzIDI2IC0zNCA2MiAtMiAxMDMgNTQgNzEgMTMxIDI1MgoyMzYgNTU0IDMzIDk1IDI5IDEzMiAtMTQgMTMyIC0zMiAwIC0zOSAtMTEgLTcxIC0xMTAgLTQyIC0xMjggLTE0MiAtMzc4IC0xNzYKLTQzNyAtODMgLTE0NSAtMTgwIC0yMzMgLTI5NCAtMjY5IC00NCAtMTQgLTU3IC0xNSAtNjkgLTQgLTI0IDE5IC0yMCAyOSAzMAoxMDUgODkgMTM0IDE1NiAzMDAgMjA0IDUwMSAxMSA0OSAyNiAxMTQgMzQgMTQ0IDcgMzAgMTkgODIgMjcgMTE1IDMzIDE1MyA1OQoyNDkgNzEgMjU2IDE5IDEyIDY4NSAxMSA2OTMgLTF6Ii8+CjxwYXRoIGQ9Ik0xMTEzMiAzNzM5IGMtNDUgLTUgLTExNSAtMTggLTE1NSAtMzAgLTM5IC0xMSAtMTA0IC0yOSAtMTQzIC00MAotMTAyIC0yOSAtMTg0IC03OCAtMjExIC0xMjQgLTMxIC01NSAtMzYgLTExMSAtMjQgLTI0OSA2IC02NiAxNSAtMTg2IDIxIC0yNjYKMjAgLTI3MyA0NyAtNDA0IDEyNiAtNjE2IDMzIC05MSAzMyAtOTIgNDQgLTM1MCA1IC0xNDMgMTcgLTM0OSAyNSAtNDU5IDgKLTExMCAxOSAtMjYzIDI1IC0zNDAgNSAtNzcgMTggLTI2OCAyOSAtNDI1IDExIC0xNTcgMjMgLTM1MiAyNiAtNDM1IDQgLTEwMAoxMSAtMTYyIDIyIC0xODYgMzAgLTczIDExNyAtMTA2IDE2NCAtNjQgMjggMjYgOTUgMTQwIDEyMSAyMDcgMzAgNzggNTUgMTkwCjY3IDMwMyAxNyAxNTUgNTIgNzE5IDcyIDExNTAgMjkgNjQwIDIzIDU5NSAxMDIgNzg3IDQwIDk2IDUxIDE0MiA3MiAyOTMgOSA2MQoyMSAxNDQgMjggMTg1IDcgNDIgMTIgMTY4IDEyIDI4NSAwIDE3NyAtMyAyMTcgLTE4IDI1NiAtNDQgMTE0IC0xNDggMTQ1IC00MDUKMTE4eiBtMjU4IC05NyBjMjEgLTEwIDQ1IC0zNCA2MCAtNjIgMjQgLTQyIDI1IC01MyAyNSAtMTk1IDAgLTE0MyAtNSAtMTk0Ci0zOSAtNDU1IC0xNyAtMTI0IC00NiAtMjMxIC05NSAtMzQ5IC0xNyAtNDAgLTM2IC05MSAtNDEgLTExMiAtNiAtMjIgLTIxIC00NgotMzMgLTUzIC0yOSAtMTkgLTI1OSAtNDEgLTMzMSAtMzIgLTMxIDQgLTY1IDE1IC03NiAyNCAtMzEgMjYgLTg2IDE3NCAtMTE0CjMwNyAtMjYgMTI3IC01MCAzNTYgLTYxIDU4NiAtOCAxNzcgLTIgMTk1IDg3IDIzNyAxODcgOTAgNTMyIDE0OCA2MTggMTA0egptLTEyNSAtMTUzNyBjLTEgLTIxOSAtMjAgLTYwMyAtNjUgLTEyNjAgLTE3IC0yNDkgLTQ5IC0zODIgLTEyMyAtNTIwIC0zOSAtNzMKLTY5IC04NSAtODUgLTMzIC02IDE4IC0xMyA5MSAtMTcgMTYzIC0xMiAyNjIgLTI0IDQ2NCAtMzkgNjUwIC04IDEwNSAtMjAgMjYwCi0yNiAzNDUgLTYgODUgLTE1IDE5NiAtMjAgMjQ3IC02IDUwIC0xMCAxMzggLTEwIDE5NSAwIDU3IC01IDE2MiAtMTAgMjMzIC01CjcyIC03IDEzOCAtNCAxNDcgNCAxNSAyMyAxOCAxMzcgMjEgNzMgMiAxNjEgMyAxOTcgMyBsNjUgLTEgMCAtMTkweiIvPgo8cGF0aCBkPSJNNTAzMiAzNzEwIGMtMTEwIC0zOSAtMTY3IC05MCAtMjIyIC0xOTkgLTQxIC04MSAtNTAgLTEzMCAtNTAgLTI3MgowIC0xOTggMzYgLTM3MiAxMTAgLTUzNSAzMCAtNjYgMzEgLTc1IDMyIC0yMDQgMSAtMTU3IC05IC0yMTkgLTY0IC0zOTAgLTczCi0yMjggLTEwNyAtMzczIC0xMzkgLTU5MyAtMTcgLTExOCAtMjEgLTE5MSAtMjEgLTQzMiAwIC0yODEgNyAtMzc4IDM0IC00MjkgOQotMTYgMTkgLTE4IDc1IC0xMyA0MiAzIDc1IDEyIDkyIDI0IDMzIDI0IDY3IDkyIDgxIDE2MyA0MCAxOTUgMTE0IDQ2NiAxODIKNjY1IDc5IDIzMCAyNDAgNTczIDI4MyA2MDEgMjcgMTggNTcgNyA3NSAtMjYgMTQgLTI3IDI4IC0xNTYgMzkgLTM3MCA3IC0xMTcKMTcgLTIwMiAzMCAtMjU1IDExIC00NCAyMSAtOTYgMjEgLTExNSAwIC01NSAtMzUgLTE3OCAtNzUgLTI2NSAtNTIgLTExMyAtOTIKLTIyNCAtMTAwIC0yNzYgLTkgLTYzIDI2IC0xMjggNzggLTE0OCA2NSAtMjQgMTA3IC00IDIxMiAxMDMgNzIgNzIgMTAwIDExMAoxMzcgMTgxIDI1IDUwIDUxIDEwNiA1NiAxMjUgNTcgMTk1IDc5IDMxNCAxMjEgNjY1IDI5IDIzNCAzNSA0MDcgMjEgNjAyIGwtMTIKMTcxIDI2IDY0IGMxMjMgMzA5IDE2NiA1OTUgMTIxIDgxNyAtNDEgMjAxIC0xMTAgMjk3IC0yNDAgMzMyIC02MyAxOCAtMTkwIDYKLTI2NiAtMjUgLTg4IC0zNSAtMTczIC0zNSAtMjQ3IC0xIC04OSA0MSAtMTUwIDU1IC0yNDYgNTUgLTY0IC0xIC0xMDcgLTYKLTE0NCAtMjB6IG0zNDUgLTExOSBjMTMxIC01MyAxNzYgLTU0IDMxOSAtNiAxMjggNDMgMTg5IDQ2IDI0OSAxMCA2OSAtNDAgMTIwCi0xMjEgMTUwIC0yMzYgMjAgLTc2IDIzIC0yNzQgNSAtMzcwIC0zMCAtMTYzIC0xMTcgLTQwNCAtMTUwIC00MTQgLTkgLTMgLTUyCjQgLTk2IDE1IC0yMzIgNjAgLTQwOSA4NyAtNjY0IDEwMCAtMTAzIDUgLTE5NSAxMyAtMjA0IDE2IC0yMSA4IC01NiA3NyAtODQKMTY0IC00MCAxMjMgLTU2IDIyOSAtNTYgMzY1IDAgMTQ3IDE1IDIwMyA4MSAyODIgNzkgOTcgMTQxIDEyNSAyNjMgMTE5IDcxIC0zCjEwMiAtMTAgMTg3IC00NXogbTgzIC0xMDIwIGM3NSAtMTIgMTc2IC0zMCAyMjUgLTQwIDUwIC0xMSAxMTUgLTI1IDE0NSAtMzIKNjkgLTE0IDEwNyAtMzQgMTE0IC01NiAyNyAtOTQgMzYgLTQxNSAxNiAtNTgzIC02MiAtNTEzIC05OSAtNjkzIC0xNzUgLTg0NwotMzYgLTczIC02NCAtMTEyIC0xMzIgLTE4MyAtNzEgLTc1IC05MSAtOTAgLTExMiAtODggLTIzIDMgLTI2IDggLTI5IDQ0IC0yCjMzIDkgNjkgNTQgMTcwIDc0IDE2NyA5MyAyMzAgMTAwIDMzNCA1IDYzIDIgMTA0IC0xMSAxNTUgLTkgMzkgLTIzIDE1OCAtMzAKMjY1IC0yMCAyNzQgLTM0IDQwMCAtNDggNDI5IC0xNyAzNSAtNjIgNTUgLTEyNyA1NSAtODggMSAtMTA1IC0xNyAtMjAwIC0yMTIKLTE0NyAtMzAwIC0yMzEgLTUzNyAtMzMyIC05NDYgLTUwIC0yMDMgLTY3IC0yNTYgLTg3IC0yNzUgbC0yNCAtMjUgLTE4IDIyCmMtNTAgNjMgLTQ1IDQ5OSAxMSA4NTcgMTMgODIgNzAgMzAzIDExOSA0NTUgNTUgMTczIDcxIDI2NCA3MSAzOTQgMCA3NiA0IDExNgoxMyAxMjUgMTcgMTkgMjgyIDggNDU3IC0xOHoiLz4KPHBhdGggZD0iTTY5OTAgMzcwNiBjLTY4IC0yNCAtMTc3IC04NSAtMzQxIC0xOTIgLTEwNyAtNjkgLTEyOSAtOTkgLTE0OSAtMTkxCi0xMiAtNTMgNSAtMjAxIDM1IC0zMjMgOSAtMzYgMjMgLTk0IDMxIC0xMjkgOCAtMzUgMTYgLTY3IDE5IC03MSAzIC01IDE0IC00MQoyNSAtODIgMTkgLTcyIDM3IC0xMzQgMTAwIC0zMzMgODggLTI4MiAxNjQgLTYyMyAyMTEgLTk0NSAyOCAtMTk2IDI3IC01MjIgLTIKLTY4MCAtMjkgLTE1NCAtMzMgLTIxNSAtMTkgLTI1MSAzMyAtNzggMTkwIC05MCAyNTYgLTIwIDU0IDU3IDE2OCAzNTcgMjEwCjU1MCA1MCAyMjkgNjUgMzM5IDg0IDYxNiA1IDgzIDE4IDIzMyAyNyAzMzUgMTAgMTAyIDE4IDI4OSAxOSA0MTUgbDIgMjMwIDM2Cjc2IGMxOSA0MiA2MSAxNTIgOTIgMjQ1IDUxIDE1MyA1NyAxNzcgNTggMjU5IDEgODQgLTIgOTUgLTM2IDE2NyAtMzkgODMgLTk1CjE0NCAtMjAzIDIyNSAtMTU1IDExNiAtMzEyIDE1MCAtNDU1IDk5eiBtMjc1IC0xMDUgYzE1MiAtNjkgMjkyIC0yMTMgMzM0Ci0zNDIgMTQgLTQ0IDEgLTEwNiAtNjMgLTI5NCAtNjAgLTE3NSAtOTkgLTI2MCAtMTMxIC0yODEgLTE2IC0xMSAtNjggLTIxCi0xNDMgLTMwIC02NCAtNyAtMTc4IC0yMCAtMjUyIC0yOSAtNzQgLTkgLTE2NCAtMTkgLTIwMCAtMjIgLTY1IC01IC02NiAtNQotNzkgMjMgLTggMTYgLTE3IDQzIC0yMiA1OSAtNCAxNyAtMjEgNzcgLTM5IDEzNSAtNDkgMTY3IC05MCAzNzAgLTkwIDQ0OCAwCjQ4IDQgNTcgNDEgOTcgMjMgMjUgNTkgNTUgODAgNjcgMjEgMTMgODIgNTEgMTM2IDg0IDE3MiAxMDggMjIxIDEyNiAzMTEgMTE4CjI5IC0yIDgyIC0xNyAxMTcgLTMzeiBtMTI4IC0xMDQ2IGMzMyAtMzMgMzAgLTI0NyAtOSAtNjMzIC04IC03OCAtMTQgLTE3NAotMTQgLTIxNCAwIC0xMzEgLTQyIC00NTEgLTgwIC02MTMgLTM3IC0xNTUgLTcwIC0yNTMgLTEyNCAtMzczIC0yNCAtNTMgLTQ3Ci0xMDcgLTUwIC0xMTggLTE4IC02MSAtODYgLTkzIC0xMjEgLTU3IC0xOSAxOCAtMTggMzIgOSAxOTggMzUgMjEzIDI4IDYxMAotMTQgODIwIC01IDI4IC0yNCAxMjIgLTQxIDIxMCAtNDkgMjU0IC0xMDAgNDYyIC0xNjAgNjQ5IC0xMyA0MCAtMTYgNjMgLTkgNzEKNiA3IDY3IDE3IDE0MiAyNCA3MyA2IDE2NSAxNiAyMDMgMjIgMzkgNSA5NyAxNCAxMzAgMTggOTIgMTMgMTIyIDEyIDEzOCAtNHoiLz4KPHBhdGggZD0iTTE0NDU1IDM3MTYgYy01NyAtMjUgLTc0IC01NyAtMTAyIC0xODQgLTIxIC0xMDEgLTI0IC00NzQgLTUgLTU3NwozOCAtMTk3IDg3IC0zNTcgMTY2IC01MzggbDQ3IC0xMDggLTIyIC04NyBjLTI5IC0xMTIgLTMzIC0zNDUgLTcgLTQzMiAyNiAtODcKNDEgLTE5MSAzNSAtMjQ1IC0yIC0yNyAtMTEgLTEwNCAtMTggLTE3MCAtMTYgLTE0MSAtMTcgLTQxNCAtMiAtNTM1IDEyIC05MgoyNSAtMTU3IDgyIC00MTAgNDkgLTIxMiA2NCAtMjQ4IDEyMyAtMjgwIDQxIC0yMSA1MCAtMjMgODQgLTEyIDIyIDcgNDcgMjQgNTgKMzggMjYgMzcgNDYgMTE5IDQ2IDE5NCAwIDM2IDcgMTMwIDE1IDIxMCA5IDgwIDIwIDE4OCAyNiAyNDAgNSA1MiAyMSAxOTQgMzUKMzE1IDM2IDMwNyA1MyA1MDAgNzkgODgwIDggMTIxIDE5IDI0MCAyNCAyNjUgNSAyNSAxNSA3NCAyMSAxMTAgNyAzNiAyOCAxMjYKNDYgMjAwIDY2IDI2NSA4NiAzODUgOTEgNTUyIDExIDM0MyAtMzIgNDMyIC0yMjggNDY4IC0zNSA3IC0xMTggMjggLTE4NCA0NwotMjIzIDY0IC0yNjAgNzMgLTMyMCA3MiAtMzMgMCAtNzMgLTYgLTkwIC0xM3ogbTMxNSAtMTMzIGM4MCAtMjUgMTgyIC01MSAyMjgKLTU4IDExMiAtMTggMTQxIC0zNyAxNzIgLTExMCAyMyAtNTUgMjUgLTcyIDI1IC0yMTUgMCAtMTc0IC05IC0yMzAgLTg1IC01NDUKLTI2IC0xMTAgLTUxIC0yMTUgLTU1IC0yMzMgLTEyIC02MCAtMTggLTYyIC0yMTUgLTYyIC0xNTUgMCAtMTgwIDIgLTE5OCAxOAotMjUgMjEgLTg3IDE2MSAtMTM1IDMwMiAtODggMjU5IC0xMTQgNDk0IC04MyA3NDAgMTUgMTE2IDM3IDE4MyA3MCAyMDYgMzEgMjIKMTAzIDExIDI3NiAtNDN6IG0yNDkgLTEzMjcgYzkgLTExIDEwIC0zMyAyIC05MSAtNiAtNDIgLTExIC0xMjEgLTExIC0xNzYgMAotNTUgLTUgLTE0MiAtMTAgLTE5MiAtNiAtNTEgLTE5IC0xODIgLTMwIC0yOTIgLTExIC0xMTAgLTI0IC0yMzYgLTMwIC0yODAKLTE4IC0xNTYgLTM5IC0zNDEgLTQ1IC00MDAgLTMgLTMzIC0xMCAtMTAzIC0xNSAtMTU1IC02IC01MiAtMTUgLTE1OCAtMjEKLTIzNCAtMTAgLTE0MCAtMjYgLTE5NiAtNTQgLTE5NiAtMjUgMCAtNDcgNDcgLTgxIDE3OCAtMTAyIDM4NiAtMTMwIDYyOSAtOTgKODY3IDI3IDIwMSAyNSA0MDUgLTUgNTEwIC0yOSAxMDMgLTM4IDIyOSAtMjEgMzAzIDQxIDE4MyAyNiAxNzIgMjM5IDE3MiAxMzQKMCAxNzEgLTMgMTgwIC0xNHoiLz4KPHBhdGggZD0iTTIwNzQwIDM2ODYgYy02OCAtMjEgLTEzMiAtNTIgLTE3NSAtODYgLTUwIC00MCAtMTAxIC00MCAtMTg2IDAKLTE3MSA3OSAtMzM0IDgwIC00NDMgMyAtMTI0IC04OCAtMTczIC0yMzkgLTE1NSAtNDgwIDExIC0xNDggMjAgLTE5NiA3NyAtMzkwCjI4IC05MiA1MiAtMTgxIDU1IC0xOTggMyAtMTYgMTcgLTkzIDMxIC0xNjkgMjIgLTExOSAyNiAtMTY4IDI2IC0zMjcgMCAtMTAyCi01IC0yNDQgLTEwIC0zMTQgLTExIC0xMzcgLTIgLTMwMCAyNSAtNDQ4IDQxIC0yMjIgMTUxIC00MjQgMzE3IC01ODMgMTAyIC05NwoxMzUgLTExNCAxODQgLTkxIDQ0IDIxIDc0IDcxIDc0IDEyMyAwIDMxIC0xMCA1NiAtNDIgMTA1IC05MCAxMzkgLTExOCAyNTAKLTExOCA0NzcgMCA5NSA1IDIwMyAxMCAyNDAgNiAzNyAxNCAxMzkgMTkgMjI3IDcgMTM2IDExIDE2NyAzMSAyMDUgMjMgNDcgNTgKOTAgNzIgOTAgMTYgMCA3OCAtMTA5IDEyNyAtMjIyIDYwIC0xMzggMTEwIC0yOTMgMTcyIC01MzIgOTQgLTM2MyAxNzUgLTU5NwoyNDAgLTY4OCAyNSAtMzUgNzYgLTM4IDEyNCAtOCA2MSAzOCA2OSA2MCA3NyAyMjAgNCA4MCAxMCAxODkgMTQgMjQ0IDcgMTA2Ci0xIDE3MyAtNDIgMzM2IC0xMTMgNDU0IC0xOTQgODU4IC0yMTAgMTA1MCAtNyA3NyAtNiA3OCA0NSAxOTcgODkgMjA4IDExNgozNDQgMTA3IDUzOCAtMTEgMjQ2IC04MSAzODggLTIyNSA0NTQgLTgyIDM4IC0xNTYgNDcgLTIyMSAyN3ogbTE2NiAtMTA1IGM5OAotNDUgMTYyIC0xNDYgMTg5IC0zMDIgMjAgLTExMSAxOSAtMTY4IC00IC0yODEgLTMwIC0xNDYgLTExMSAtMzU5IC0xNDMgLTM3MAotNyAtMyAtNDcgLTEgLTg4IDQgLTEyMSAxNiAtMzMwIDIgLTQ5MyAtMzIgLTE3MCAtMzYgLTI2MSAtNTcgLTMwMyAtNzEgLTQ3Ci0xNCAtNjIgLTMgLTgwIDYwIC04IDMxIC0zNSAxMjYgLTU5IDIxMSAtMjUgODUgLTUwIDE5OCAtNTYgMjUwIC0xNSAxMjQgLTUKMjg4IDIwIDM0NSAyNyA2MSA4OCAxMjQgMTQ2IDE1MSA4NSA0MCAxNDEgMzIgMzI0IC00NSAxMTYgLTQ5IDE5MSAtMzkgMzAwIDM5CjgzIDYxIDE3MSA3NSAyNDcgNDF6IG0tNzYgLTEwNDEgYzM2IC02IDcyIC0xMyA4MSAtMTYgMjQgLTcgMzcgLTQ2IDQ5IC0xNDQKMTYgLTEzNyAyOCAtMjA5IDQ5IC0zMTAgMTAgLTUyIDI2IC0xMzEgMzUgLTE3NSA5IC00NCAyMSAtOTggMjYgLTEyMCA1IC0yMgoxNiAtNjkgMjQgLTEwNSA4IC0zNiAzNCAtMTQxIDU4IC0yMzUgbDQzIC0xNzAgLTMgLTI0NCBjLTMgLTI1MyAtMTAgLTMwMSAtNDgKLTMwMSAtMzUgMCAtMTQ5IDMwMiAtMjI0IDU5NSAtNTAgMTk1IC03MSAyNjggLTExNyA0MTAgLTM2IDExMSAtMTM2IDMzNCAtMTg2CjQxMyAtMjQgMzcgLTMxIDQyIC02NiA0MiAtNzYgMCAtMTU1IC04NiAtMTg3IC0yMDIgLTggLTI5IC0xOSAtMTM4IC0yNCAtMjQzCi02IC0xMDQgLTE0IC0yMzAgLTIwIC0yODAgLTE0IC0xMjYgLTEyIC0yMDEgNiAtMzI0IDIwIC0xMzggNDUgLTIyMyA5NSAtMzE3CjQwIC03NCA0NCAtMTA0IDE1IC0xMDQgLTcgMCAtNTggNDcgLTExMyAxMDMgLTgyIDg3IC0xMDcgMTIxIC0xNTUgMjEzIC0xMDQKMjAyIC0xNDUgMzkwIC0xMzQgNjE5IDE4IDM3NCAxOCA1MTAgMiA2MzUgbC0xNyAxMjUgMjIgMTggYzEyIDkgMjggMTcgMzYgMTcKOCAwIDYzIDEyIDEyMiAyNiAxNDQgMzQgMjQ2IDUzIDM3MSA2OSAxMzUgMTYgMTgxIDE3IDI2MCA1eiIvPgo8cGF0aCBkPSJNODQ3MSAzNjQwIGMtMzAgLTExIC04NCAtMzcgLTEyMCAtNTkgLTM2IC0yMSAtOTUgLTUzIC0xMzEgLTcxIC04NwotNDQgLTE4MyAtMTEzIC0yMTggLTE1OCAtNTIgLTY2IC02MiAtOTUgLTYyIC0xNzkgMCAtNzUgMiAtODEgNTEgLTE2OCA4MQotMTQzIDExNCAtMjQ5IDE1MCAtNDc1IDYgLTQxIDI0IC0xMzMgMzkgLTIwNSA0NyAtMjE3IDQ5IC0yMzQgNjQgLTQwMCAxNAotMTU1IDI0IC0zMzggNDYgLTg0NSAxNCAtMzIxIDI2IC00MjcgNTcgLTUxNCAzMyAtOTMgNTUgLTExNiAxMDcgLTExNiA5MCAwCjExNSAzNSAxNTIgMjExIDY3IDMyNSA3NCAzNzQgODUgNjQyIDUgMTQ0IDE2IDMwMiAyNCAzNTIgOCA0OSAyMyAxNDkgMzUgMjIwCjExIDcyIDI1IDE2MiAzMCAyMDEgNSAzOSAxMyAxMDAgMTkgMTM1IDUgMzUgMTMgMTE4IDE3IDE4NCA2IDEwMCAxMiAxMzIgMzgKMjAwIDM4IDkzIDUwIDEzNCA3MiAyMzAgMjEgOTYgNDQgMzQ4IDM4IDQxNSAtMjEgMjE5IC02OCAzMTEgLTE5OSAzODYgLTQzIDI1Ci02MSAyOSAtMTQ1IDMxIC03NiAzIC0xMDYgLTEgLTE0OSAtMTd6IG0yNTEgLTEwMiBjNjUgLTM0IDg1IC01OCAxMjYgLTE0NSAyNgotNTYgMjcgLTY0IDI2IC0yMjMgMCAtMTA4IC02IC0xOTUgLTE3IC0yNTAgLTMzIC0xNzEgLTEwMSAtMzU3IC0xNDEgLTM4NiAtMzcKLTI2IC0xODggLTE4IC0zMjMgMTYgLTE5MiA1MCAtMTgzIDQzIC0yMDMgMTU1IC0xOSAxMTMgLTUwIDIwMyAtMTEyIDMyNCAtNjgKMTM0IC03MyAxNjggLTI5IDIyOCA0NSA2MSAxMDIgMTAzIDI3NiAxOTggMTkwIDEwNCAyMTMgMTEzIDI4NCAxMTQgNDEgMSA2NgotNiAxMTMgLTMxeiBtLTM3MiAtMTA3NCBjNjkgLTIxIDExNCAtMjggMjM1IC0zMyBsMTUwIC02IC0yIC0zMCBjLTQgLTU0IC0zMwotMjg4IC00NyAtMzc1IC01NyAtMzUzIC03NCAtNTEyIC04MSAtNzUwIC0yIC0xMDIgLTExIC0yMjMgLTIwIC0yNzAgLTE4IC0xMDAKLTUyIC0yNjkgLTY2IC0zMjIgLTI5IC0xMjAgLTI5IC0xMTkgLTUyIC0xMTYgLTMyIDQgLTY1IDk2IC03NyAyMTUgLTkgOTQgLTIyCjM1OSAtNDAgODAzIC0xMiAzMDggLTM5IDUzNyAtODYgNzM4IC0zMCAxMjggLTMxIDE3MyAtNSAxNzIgMyAwIDQ0IC0xMiA5MQotMjZ6Ii8+CjwvZz4KPC9zdmc+";

    function injectFichaStyles(){
      if(document.getElementById('cronosFichaStyles')) return;
      const style = document.createElement('style');
      style.id = 'cronosFichaStyles';
      style.textContent = `
        .btnFicha{border-color: rgba(99,102,241,.35)!important}
        .procCardHint{margin-top:8px;font-size:12px;color:var(--muted)}
        .procGrid{display:grid;grid-template-columns:minmax(260px,1.55fr) minmax(190px,1fr) minmax(110px,.7fr) minmax(120px,.75fr) minmax(120px,.75fr) minmax(130px,.8fr);gap:10px;align-items:end}
        .procCatalogTable{min-width:1120px}
        .procCatalogTable td,.procCatalogTable th{font-size:13px; white-space:nowrap}
        .procCatalogTable td:first-child,.procCatalogTable th:first-child{white-space:normal}
        .procCatalogTable .miniBtn{padding:5px 8px;font-size:12px}
        .procCatalogTable th:last-child,.procCatalogTable td:last-child{position:sticky;right:0;z-index:2;background:var(--panel2);min-width:170px;white-space:nowrap}
        .procCatalogTable td:last-child>button+button,.procCatalogTable td:last-child .miniBtn+.miniBtn{margin-left:8px}
        .brandCardHint{margin-top:8px;font-size:12px;color:var(--muted)}
        .brandRow{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .brandPreview{width:72px;height:72px;border:1px dashed var(--line);border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:rgba(255,255,255,.03)}
        .brandPreview img{max-width:100%;max-height:100%;display:block}
        .fichaHead{display:grid;grid-template-columns:1.15fr .85fr;gap:12px;margin-bottom:12px}
        .fichaHead .cardMini{border:1px solid var(--line);border-radius:14px;padding:12px;background:rgba(255,255,255,.03)}
        .fichaAddWrap{border:1px solid var(--line);border-radius:16px;padding:14px;background:rgba(255,255,255,.03);margin-bottom:14px}
        .fichaAddGrid{display:grid;grid-template-columns:1.2fr .8fr .8fr;gap:10px;align-items:end}
        .fichaAddGrid + .fichaAddGrid{margin-top:10px}
        .toothToolbar{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
        .toothWrap{display:grid;grid-template-columns:repeat(8,minmax(44px,1fr));gap:8px;margin-top:10px}
        .toothBtn{border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--text);border-radius:12px;padding:10px 6px;cursor:pointer;font-weight:800;min-height:44px}
        .toothBtn:hover{background:rgba(255,255,255,.06)}
        .toothBtn.sel{outline:2px solid rgba(124,92,255,.7);background:rgba(124,92,255,.12)}
        .toothChipRow{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
        .toothChip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:rgba(255,255,255,.04);padding:6px 10px;border-radius:999px;font-size:12px}
        .fichaLayout{display:block}
        .financialPaymentTable{width:max-content!important;min-width:874px!important;max-width:874px!important;table-layout:fixed}
        .financialPaymentTable th,.financialPaymentTable td{padding:9px 8px!important}
        .financialPaymentTable td:last-child{display:flex;gap:8px;align-items:center;flex-wrap:nowrap}
        @media(max-width:760px){.newBudgetGrid{grid-template-columns:1fr!important;max-width:100%!important}.newPayLayout{grid-template-columns:1fr!important;max-width:100%!important}.newPayTopGrid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.newPayObsGrid{grid-template-columns:1fr!important}}
        .fichaPlanToolbar{border:1px solid var(--line);border-radius:14px;padding:10px 12px;background:rgba(255,255,255,.025)}
        .fichaTableWrap{overflow:auto;border:1px solid var(--line);border-radius:16px}
        .fichaTable{width:100%;border-collapse:collapse;min-width:1480px;background:rgba(255,255,255,.02)}
        /* Ações não ficam mais fixas: agora rolam junto com a tabela, evitando sobreposição em linhas coloridas */
        .fichaTable th:last-child,.fichaTable td:last-child{position:static;right:auto;z-index:auto;background:inherit}
        .fichaTable th,.fichaTable td{padding:10px 10px;border-bottom:1px solid var(--line);vertical-align:middle;font-size:13px}
        .fichaTable th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;background:color-mix(in srgb, var(--panel2) 92%, transparent)}
        .fichaTable input[type="number"], .fichaTable select, .fichaTable input[type="text"], .fichaTable textarea{padding:8px 10px;border-radius:12px;font-size:13px}
        .fichaDone{background:rgba(46,229,157,.12)!important}
        .fichaDone td{background:rgba(46,229,157,.12)!important}
        .totalsGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
        .fichaTotalsUnderOdonto{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:14px}
        .totalBox{border:1px solid var(--line);border-radius:14px;padding:12px;background:rgba(255,255,255,.03)}
        .totalBox .label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}
        .totalBox .value{font-size:19px;font-weight:800}
        .odontoFull{border:1px solid var(--line);border-radius:16px;padding:14px;background:rgba(255,255,255,.03);margin-bottom:14px}
        .odontoGrid{display:grid;grid-template-columns:minmax(520px,1.05fr) minmax(390px,.95fr);gap:14px;align-items:start}
        .odontoPanel{border:1px solid var(--line);border-radius:14px;padding:14px;background:rgba(255,255,255,.025)}
        .odontoPanel textarea{min-height:100px}
        .odontoPanel label{display:block;margin:10px 0 6px}
        .odontoPanel input,.odontoPanel select{width:100%;box-sizing:border-box}
        .odontoPanel .sideFormGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .odontoPanel .sideFormGrid .full{grid-column:1 / -1}
        .odontoPanel .sideActions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
        .faceChipWrap{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
        .faceChip{border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--text);border-radius:999px;padding:8px 10px;font-weight:800;font-size:12px;cursor:pointer;transition:.15s ease}
        .faceChip:hover{background:rgba(124,92,255,.12);border-color:rgba(124,92,255,.45)}
        .faceChip.active{background:rgba(124,92,255,.18);border-color:rgba(124,92,255,.75);box-shadow:0 0 0 2px rgba(124,92,255,.12) inset}
        .faceChip:disabled{opacity:.48;cursor:not-allowed}
        .faceSelectedText{margin-top:8px;font-size:12px;color:var(--muted)}

        .procPickerWrap{position:relative}
        .procPickerWrap input{padding-right:46px}
        .procDropBtn{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:34px;height:34px;border:0;border-left:1px solid var(--line);background:transparent;color:var(--text);cursor:pointer;font-size:16px;font-weight:900}
        .procSuggestMenu{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:50;max-height:310px;overflow:auto;border:1px solid var(--line);border-radius:14px;background:color-mix(in srgb, var(--panel2) 96%, #000 4%);box-shadow:0 18px 36px rgba(0,0,0,.32);padding:6px;display:none}
        .procSuggestMenu.show{display:block}
        .procSuggestItem{width:100%;text-align:left;border:0;border-radius:10px;background:transparent;color:var(--text);padding:10px 11px;cursor:pointer;font-weight:800}
        .procSuggestItem:hover{background:rgba(124,92,255,.18)}
        .procSuggestItem .muted{font-size:12px;font-weight:700}
        .procSuggestEmpty{padding:12px;color:var(--muted);font-size:13px}

        .odontoRefStage{position:relative;width:100%;aspect-ratio:1536/740;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:transparent}
        .odontoRefStage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;user-select:none}
        .odontoRefStage .odontoBaseLight{opacity:0}
        .odontoRefStage .odontoBaseDark{opacity:1}
        .light .odontoRefStage .odontoBaseLight{opacity:1}
        .light .odontoRefStage .odontoBaseDark{opacity:0}
        .odontoOverlay{position:absolute; inset:0}
        .toothOverlayBox{position:absolute; width:34px; height:34px; border-radius:999px; border:2px solid transparent; background:rgba(15,23,42,.38); color:#f8fafc; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900; transform:translate(-50%,0); cursor:pointer; user-select:none; transition:.15s ease; box-shadow:0 1px 5px rgba(0,0,0,.10)}
        .toothOverlayBox:hover{transform:translate(-50%,0) scale(1.08); border-color:rgba(124,92,255,.65); background:rgba(124,92,255,.16)}
        .light .toothOverlayBox{background:rgba(255,255,255,.36); color:#111827}
        .toothOverlayBox.active{outline:3px solid rgba(124,92,255,.9); outline-offset:2px; box-shadow:0 0 0 5px rgba(124,92,255,.16),0 1px 5px rgba(0,0,0,.10)}
        .toothOverlayBox.paid,.toothOverlayBox.plan,.toothOverlayBox.closed{background:#ffd400; border-color:#b7791f; color:#111827}
        .toothOverlayBox.done{background:#16a34a; border-color:#166534; color:#ffffff}
        .toothOverlayBox.absent{background:#dc2626; border-color:#991b1b; color:#ffffff}
        .fichaPaid{background:rgba(255,212,0,.18)!important}.fichaPaid td{background:rgba(255,212,0,.18)!important}
        .fichaAbsent{background:rgba(220,38,38,.12)!important}.fichaAbsent td{background:rgba(220,38,38,.12)!important}
        .fichaPlan{background:rgba(255,212,0,.14)!important}.fichaPlan td{background:rgba(255,212,0,.14)!important}
        .fichaClosed{background:rgba(255,212,0,.14)!important}.fichaClosed td{background:rgba(255,212,0,.14)!important}
        .odontoLegend{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
        .legendPill{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);padding:5px 10px;border-radius:999px;font-size:12px;background:rgba(255,255,255,.03)}
        .legendDot{width:12px;height:12px;border-radius:999px;display:inline-block;border:1px solid rgba(0,0,0,.15)}
        body.dark .legendDot{border-color:rgba(255,255,255,.22)}
        .lp-paid .legendDot,.lp-plan .legendDot,.lp-closed .legendDot{background:#ffd400}.lp-done .legendDot{background:#16a34a}.lp-absent .legendDot{background:#dc2626}
        .panelMiniGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.panelMiniGrid>div{border:1px solid var(--line);border-radius:12px;padding:9px;background:rgba(255,255,255,.03)}.panelMiniGrid span{display:block;font-size:11px;margin-bottom:4px}.panelMiniGrid b{font-size:13px}
        .fichaEmpty{padding:18px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:14px}
        @media(max-width:1180px){.fichaHead,.procGrid,.fichaAddGrid,.totalsGrid,.odontoGrid{grid-template-columns:1fr}.fichaTable{min-width:760px}}
      `;
      document.head.appendChild(style);
    }

    function procedureCatalogDefaults(){
      return [
        {id:'proc_rest_1f', nome:'Restauração de resina 1 face', categoria:'Dentística', valorBase:250, tipoClinico:'restaurador', indicacao:'cárie/fratura em uma face', abrangencia:'unitário', exigeDente:true, exigeFace:true, cobraPorDente:true, ativo:true},
        {id:'proc_rest_2f', nome:'Restauração de resina 2 faces', categoria:'Dentística', valorBase:320, tipoClinico:'restaurador', indicacao:'cárie/fratura em duas faces', abrangencia:'unitário', exigeDente:true, exigeFace:true, cobraPorDente:true, ativo:true},
        {id:'proc_rest_3f', nome:'Restauração de resina 3 faces', categoria:'Dentística', valorBase:380, tipoClinico:'restaurador', indicacao:'cárie/fratura em três faces', abrangencia:'unitário', exigeDente:true, exigeFace:true, cobraPorDente:true, ativo:true},
        {id:'proc_implante', nome:'Implante unitário', categoria:'Implante', valorBase:2200, tipoClinico:'reabilitação de ausência', indicacao:'perda dentária unitária', abrangencia:'unitário', exigeDente:true, exigeFace:false, cobraPorDente:true, ativo:true},
        {id:'proc_canal', nome:'Canal', categoria:'Endodontia', valorBase:900, tipoClinico:'endodôntico', indicacao:'comprometimento pulpar', abrangencia:'unitário', exigeDente:true, exigeFace:false, cobraPorDente:true, ativo:true},
        {id:'proc_exodontia', nome:'Exodontia', categoria:'Cirurgia', valorBase:400, tipoClinico:'cirúrgico', indicacao:'extração dentária', abrangencia:'unitário', exigeDente:true, exigeFace:false, cobraPorDente:true, ativo:true},
        {id:'proc_coroa', nome:'Coroa unitária', categoria:'Prótese', valorBase:1500, tipoClinico:'protético', indicacao:'reabilitação unitária', abrangencia:'unitário', exigeDente:true, exigeFace:false, cobraPorDente:true, ativo:true},
        {id:'proc_profilaxia', nome:'Profilaxia', categoria:'Clínica geral', valorBase:180, tipoClinico:'preventivo', indicacao:'controle preventivo', abrangencia:'boca toda', exigeDente:false, exigeFace:false, cobraPorDente:false, ativo:true}
      ];
    }

    function getProcedureCatalog(db=loadDB()){
      const arr = db?.settings?.procedureCatalog;
      return Array.isArray(arr) ? arr : [];
    }
    function ensureProcedureCatalogSeeded(){
      const db = loadDB();
      if(!db.settings) db.settings = {};
      if(!Array.isArray(db.settings.procedureCatalog) || !db.settings.procedureCatalog.length){
        db.settings.procedureCatalog = procedureCatalogDefaults();
        saveDB(db);
      }
    }
    function getEntryById(entryId){
      const db = loadDB();
      return (db.entries || []).find(x=>String(x.id)===String(entryId));
    }
    function getContactForEntry(entry){
      const db = loadDB();
      if(!entry?.contactId) return null;
      return (db.contacts || []).find(c=>String(c.id)===String(entry.contactId)) || null;
    }
    function ensureFicha(entry){
      if(!entry.ficha || typeof entry.ficha !== 'object'){
        entry.ficha = { plano: [], odontograma: {}, avaliacoes: [] };
      }
      if(!Array.isArray(entry.ficha.plano)) entry.ficha.plano = [];
      if(!entry.ficha.odontograma || typeof entry.ficha.odontograma !== 'object') entry.ficha.odontograma = {};
      if(!Array.isArray(entry.ficha.avaliacoes)) entry.ficha.avaliacoes = [];

      if(!entry.ficha.avaliacoes.length){
        const evalDate = String(entry.firstContactAt || entry.monthKey || todayISO()).slice(0,10);
        entry.ficha.avaliacoes.push({
          id: 'eval_1',
          label: 'Avaliação 1',
          date: /^\d{4}-\d{2}-\d{2}$/.test(evalDate) ? evalDate : todayISO(),
          createdAt: new Date().toISOString()
        });
      }
      if(!entry.ficha.activeEvaluationId){
        entry.ficha.activeEvaluationId = entry.ficha.avaliacoes[entry.ficha.avaliacoes.length - 1]?.id || 'eval_1';
      }

      const firstEval = entry.ficha.avaliacoes[0] || { id:'eval_1', label:'Avaliação 1', date: todayISO() };
      entry.ficha.plano.forEach(item=>{
        if(!item.id) item.id = uid('plan');
        if(!item.avaliacaoId) item.avaliacaoId = firstEval.id;
        if(!item.avaliacaoLabel) item.avaliacaoLabel = firstEval.label || 'Avaliação 1';
        if(!item.avaliacaoData) item.avaliacaoData = firstEval.date || todayISO();
        if(!item.createdAt) item.createdAt = new Date().toISOString();
        if(item.recebimentoId && !item.financialPlanId) item.financialPlanId = item.recebimentoId;
        if(item.financialPlanId && !item.recebimentoId) item.recebimentoId = item.financialPlanId;
      });

      return entry.ficha;
    }
    function deriveToothType(tooth){
      const t = String(tooth||'').replace(/\D/g,'');
      const second = t.slice(1,2);
      if(['1','2'].includes(second)) return 'Incisivo';
      if(second === '3') return 'Canino';
      if(['4','5'].includes(second)) return 'Pré-molar';
      if(['6','7','8'].includes(second)) return 'Molar';
      return 'Dente';
    }
    function parseMoneyInput(v){
      const n = Number(String(v ?? '').replace(',', '.'));
      return Number.isFinite(n) ? n : 0;
    }
    function percent(num, den){
      if(!den) return 0;
      return (Number(num||0) / Number(den||0)) * 100;
    }
    function calcFichaTotals(plano=[], entry=null){
      const totalBase = plano.reduce((s,x)=>s + Number(x.valorBase||0), 0);
      const totalFechado = plano.reduce((s,x)=>s + Number(x.valorFechado||0), 0);
      const totalDesconto = totalBase - totalFechado;
      const totalPago = plano.filter(x=>isFichaItemFinancialPaid(entry, x)).reduce((s,x)=>s + Number(x.valorFechado||0), 0);
      const totalFeito = plano.filter(x=>!!x.feito).reduce((s,x)=>s + Number(x.valorFechado||0), 0);
      const emAberto = totalFechado - totalPago;
      return {
        totalBase, totalFechado, totalDesconto, totalPago, totalFeito,
        emAberto, descontoPct: percent(totalDesconto, totalBase)
      };
    }


    function getActiveFichaEvaluation(ficha, entry=null){
      ficha = ficha || ensureFicha(entry || {});
      if(!Array.isArray(ficha.avaliacoes) || !ficha.avaliacoes.length){
        ficha.avaliacoes = [{id:'eval_1', label:'Avaliação 1', date: todayISO(), createdAt:new Date().toISOString()}];
      }
      let active = ficha.avaliacoes.find(a=>String(a.id)===String(ficha.activeEvaluationId));
      if(!active){
        active = ficha.avaliacoes[ficha.avaliacoes.length - 1];
        ficha.activeEvaluationId = active.id;
      }
      return active;
    }

    function nextFichaEvaluationLabel(ficha){
      const n = (Array.isArray(ficha?.avaliacoes) ? ficha.avaliacoes.length : 0) + 1;
      return `Avaliação ${n}`;
    }

    function getFinancialPlanForFichaItem(entry, item){
      const planId = String(item?.financialPlanId || item?.recebimentoId || "").trim();
      if(!entry || !planId) return null;
      const plans = ensureFinancialPlans(entry);
      return plans.find(p=>String(p.id)===planId) || null;
    }

    function financialPlanIsFullyPaid(plan){
      if(!plan) return false;
      const t = financialPlanTotals(plan);
      const target = Number(t.total || plan.amount || 0);
      return target > 0 && Number(t.paid || 0) >= (target - 0.01);
    }

    function financialPlanHasAnyPayment(plan){
      if(!plan) return false;
      const pays = Array.isArray(plan.payments) ? plan.payments : [];
      return pays.length > 0 || Number(financialPlanTotals(plan).scheduled || 0) > 0;
    }

    function getFichaItemFinancialStatus(entry, item){
      const plan = getFinancialPlanForFichaItem(entry, item);
      if(plan){
        const t = financialPlanTotals(plan);
        if(financialPlanIsFullyPaid(plan)) return {key:'paid', label:'Pago', plan, totals:t};
        if(Number(t.paid||0) > 0) return {key:'partial', label:'Parcial', plan, totals:t};
        if(financialPlanHasAnyPayment(plan)) return {key:'pending', label:'Em pagamento', plan, totals:t};
        return {key:'linked', label:'Recebimento criado', plan, totals:t};
      }
      if(item?.pago) return {key:'paid_legacy', label:'Pago legado', plan:null, totals:null};
      return {key:'open', label:'Sem recebimento', plan:null, totals:null};
    }

    function isFichaItemFinancialPaid(entry, item){
      const st = getFichaItemFinancialStatus(entry, item);
      return st.key === 'paid' || st.key === 'paid_legacy';
    }

    function isFichaItemAvailableForReceiving(entry, item){
      const st = getFichaItemFinancialStatus(entry, item);
      return st.key === 'open';
    }

    function fichaFinanceBadge(entry, item){
      const st = getFichaItemFinancialStatus(entry, item);
      const klass = st.key === 'paid' || st.key === 'paid_legacy' ? 'ok' : (st.key === 'open' ? 'pending' : 'warn');
      const title = st.plan ? `Recebimento: ${escapeHTML(st.plan.title || st.plan.id)}` : '';
      return `<span class="badge ${klass}" title="${title}">${escapeHTML(st.label)}</span>`;
    }

    function fichaEvaluationSummaryHTML(ficha){
      const map = new Map();
      (ficha.plano || []).forEach(item=>{
        const id = item.avaliacaoId || 'eval_1';
        if(!map.has(id)) map.set(id, {count:0, total:0});
        const row = map.get(id);
        row.count++;
        row.total += Number(item.valorFechado || 0);
      });
      return (ficha.avaliacoes || []).map(av=>{
        const row = map.get(av.id) || {count:0,total:0};
        const active = String(ficha.activeEvaluationId) === String(av.id);
        return `<button type="button" class="miniBtn ${active ? 'primary' : ''}" onclick="CRONOS_FICHA_UI.setActiveEvaluation('${escapeHTML(av.id)}')" title="Adicionar novos procedimentos nesta avaliação">
          ${escapeHTML(av.label || 'Avaliação')} • ${fmtBR(av.date)} • ${row.count} item(ns) • ${moneyBR(row.total)}
        </button>`;
      }).join('');
    }

    function buildFichaReceivingPayments({total, type, date, method, count, obs}){
      total = parseMoney(total);
      const payments = [];
      const n = type === 'parcelado' ? Math.max(1, parseInt(count || 1, 10) || 1) : 1;
      const base = Math.floor((total / n) * 100) / 100;
      let acc = 0;
      for(let i=1;i<=n;i++){
        const amount = i === n ? Number((total - acc).toFixed(2)) : Number(base.toFixed(2));
        acc += amount;
        const dueDate = addMonthsISO(date, i-1);
        const paid = type === 'avista';
        payments.push({
          id: uid('pay'),
          amount,
          dueDate,
          payMethod: method || '',
          notes: obs || '',
          status: paid ? 'PAGA' : 'PENDENTE',
          paidAt: paid ? date : '',
          cashDate: paid ? date : '',
          createdAt: new Date().toISOString(),
          source: 'ficha'
        });
      }
      return payments;
    }

    function createFichaReceiving(entryId, itemIds, options={}){
      const actor = currentActor();
      const db = loadDB();
      const entry = (db.entries||[]).find(e=>String(e.id)===String(entryId));
      if(!entry) return toast('Recebimento', 'Paciente não encontrado.');
      const ficha = ensureFicha(entry);
      const ids = Array.from(new Set((itemIds||[]).map(String).filter(Boolean)));
      const items = ficha.plano.filter(item=>ids.includes(String(item.id)));
      if(!items.length) return toast('Recebimento', 'Selecione pelo menos um procedimento da ficha.');

      const unavailable = items.filter(item=>!isFichaItemAvailableForReceiving(entry, item));
      if(unavailable.length){
        return toast('Recebimento já vinculado', `${unavailable.length} procedimento(s) já possuem recebimento.`);
      }

      const total = items.reduce((sum,item)=>sum + Number(item.valorFechado || 0), 0);
      if(total <= 0) return toast('Recebimento', 'Os procedimentos selecionados precisam ter valor maior que zero.');

      const type = String(options.type || 'avista');
      const date = String(options.date || todayISO()).slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('Data inválida', 'Use uma data válida.');
      const count = type === 'parcelado' ? Math.max(1, parseInt(options.count || 1, 10) || 1) : 1;
      const method = String(options.method || '').trim();
      const obs = String(options.obs || '').trim();

      const evalLabel = items[0]?.avaliacaoLabel || 'Avaliação';
      const plan = {
        id: uid('budget'),
        title: `${type === 'parcelado' ? 'Recebimento parcelado' : 'Recebimento à vista'} • ${evalLabel}`,
        dentist: '',
        amount: total,
        status: 'Aprovado',
        createdAt: new Date().toISOString(),
        createdBy: actor?.name || '',
        source: 'ficha',
        fichaItemIds: ids,
        evaluationIds: Array.from(new Set(items.map(i=>i.avaliacaoId).filter(Boolean))),
        payments: buildFichaReceivingPayments({total, type, date, method, count, obs})
      };

      ensureFinancialPlans(entry).push(plan);
      items.forEach(item=>{
        item.financialPlanId = plan.id;
        item.recebimentoId = plan.id;
        item.financeStatus = type === 'avista' ? 'pago' : 'em_pagamento';
        item.pago = type === 'avista';
      });

      if(type === 'avista'){
        db.payments = db.payments || [];
        plan.payments.forEach(p=>{
          db.payments.push({
            id: uid('p'),
            masterId: actor.masterId,
            entryId: entry.id,
            contactId: entry.contactId || '',
            financialPlanId: plan.id,
            financialPaymentId: p.id,
            at: new Date().toISOString(),
            date: p.cashDate || date,
            value: parseMoney(p.amount),
            method: p.payMethod || method || '',
            desc: `Recebimento da ficha • ${evalLabel}`,
            source: 'financialPlan'
          });
        });
      }

      try{ syncInstallmentTasks(db, actor); }catch(_){}
      saveDB(db, { immediate:true });
      return plan;
    }


    function getClinicBranding(db=loadDB(), actor=currentActor()){
      const clinicId = actor?.masterId || actor?.clinicId || null;
      if(!db.settings) db.settings = {};
      if(!db.settings.clinicBranding) db.settings.clinicBranding = { byClinic:{} };
      if(!db.settings.clinicBranding.byClinic) db.settings.clinicBranding.byClinic = {};
      if(clinicId && !db.settings.clinicBranding.byClinic[String(clinicId)]){
        db.settings.clinicBranding.byClinic[String(clinicId)] = { clinicName:'', logoDataUri:'' };
      }
      return clinicId ? db.settings.clinicBranding.byClinic[String(clinicId)] : { clinicName:'', logoDataUri:'' };
    }
    function getClinicDisplayName(db=loadDB(), actor=currentActor()){
      const branding = getClinicBranding(db, actor);
      return String(branding?.clinicName || actor?.masterName || actor?.clinicName || 'Clínica').trim();
    }
    function injectBrandingSettingsCard(){
      const host = el('view-settings');
      if(!host) return;
      let card = el('settingsBrandingCard');
      const db = loadDB();
      const actor = currentActor();
      const branding = getClinicBranding(db, actor);
      if(!card){
        card = document.createElement('div');
        card.className = 'card';
        card.id = 'settingsBrandingCard';
        host.appendChild(card);
      }
      card.innerHTML = `
        <h3>Identidade da clínica</h3>
        <div class="muted" style="line-height:1.5; margin-bottom:10px">A ficha do paciente usa estes dados no cabeçalho e na impressão. Cada clínica gerencia a própria marca sem depender de ti.</div>
        <div class="procGrid" style="grid-template-columns:1fr .8fr; align-items:start">
          <div>
            <label>Nome da clínica na ficha</label>
            <input id="brandClinicName" type="text" value="${escapeHTML(branding?.clinicName || actor?.masterName || '')}" placeholder="Ex: Mundo Odonto">
            <div class="brandCardHint">Se ficar vazio, a ficha usa o nome padrão da clínica.</div>
          </div>
          <div>
            <label>Logo da clínica</label>
            <div class="brandRow">
              <div class="brandPreview">${branding?.logoDataUri ? `<img src="${branding.logoDataUri}" alt="Logo">` : `<span class="muted">Sem logo</span>`}</div>
              <div style="display:flex; gap:8px; flex-wrap:wrap">
                <label class="btn small" style="cursor:pointer">Enviar logo<input id="brandLogoInput" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>
                ${branding?.logoDataUri ? `<button class="btn small" id="btnRemoveBrandLogo" type="button">Remover</button>` : ''}
              </div>
            </div>
            <div class="brandCardHint">PNG, JPG ou WEBP. Idealmente quadrada e leve.</div>
          </div>
        </div>
        <div style="display:flex; gap:10px; margin-top:12px; align-items:center; flex-wrap:wrap">
          <button class="btn ok" id="btnSaveBranding" type="button">Salvar identidade</button>
        </div>
      `;
      const saveBtn = el('btnSaveBranding');
      if(saveBtn) saveBtn.onclick = ()=>window.CRONOS_BRAND_UI.save();
      const remBtn = el('btnRemoveBrandLogo');
      if(remBtn) remBtn.onclick = ()=>window.CRONOS_BRAND_UI.removeLogo();
      const fileInput = el('brandLogoInput');
      if(fileInput){
        fileInput.onchange = ev => {
          const file = ev.target.files && ev.target.files[0];
          if(!file) return;
          const reader = new FileReader();
          reader.onload = () => { window.CRONOS_BRAND_UI.setLogo(String(reader.result || '')); };
          reader.readAsDataURL(file);
        };
      }
    }
    window.CRONOS_BRAND_UI = {
      setLogo(dataUri){
        const db = loadDB();
        const actor = currentActor();
        const branding = getClinicBranding(db, actor);
        branding.logoDataUri = dataUri || '';
        saveDB(db);
        injectBrandingSettingsCard();
      },
      removeLogo(){
        const db = loadDB();
        const actor = currentActor();
        const branding = getClinicBranding(db, actor);
        branding.logoDataUri = '';
        saveDB(db);
        injectBrandingSettingsCard();
      },
      save(){
        const db = loadDB();
        const actor = currentActor();
        const branding = getClinicBranding(db, actor);
        branding.clinicName = String(val('brandClinicName') || '').trim();
        saveDB(db);
        injectBrandingSettingsCard();
        toast('Identidade salva ✅', branding.clinicName || getClinicDisplayName(db, actor));
      }
    };


    function injectProcedureSettingsCard(){
      const host = el('view-settings');
      if(!host) return;
      let card = el('settingsProceduresCard');
      if(!card){
        card = document.createElement('div');
        card.className = 'card';
        card.id = 'settingsProceduresCard';
        card.innerHTML = `
          <h3>Procedimentos odontológicos</h3>
          <div class="muted" style="line-height:1.5; margin-bottom:10px">
            Cadastro mestre usado na <b>Ficha</b> do lead. O valor base entra automático no plano de tratamento, mas continua editável no paciente.
          </div>
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap">
            <button class="btn ok" id="btnManageProcedures">🦷 Gerenciar procedimentos</button>
            <span class="muted" id="proceduresCountHint" style="font-size:12px"></span>
          </div>
          <div class="procCardHint">Sugestão: deixa só procedimentos ativos e valores de tabela aqui. Ajustes e desconto implícito ficam na ficha do paciente.</div>
        `;
        host.appendChild(card);
      }
      const btn = el('btnManageProcedures');
      if(btn) btn.onclick = openProcedureCatalogModal;
      const hint = el('proceduresCountHint');
      if(hint){
        const catalog = getProcedureCatalog(loadDB());
        const active = catalog.filter(x=>x.ativo !== false).length;
        hint.textContent = `${catalog.length} cadastrados • ${active} ativos`;
      }
    }

    function openProcedureCatalogModal(){
      ensureProcedureCatalogSeeded();
      window.__procCatalogState = { editingId:null, search:'' };
      openModal({
        title:'Cadastro de procedimentos',
        sub:'Usado pela Ficha do lead. Valor base é referência; o valor do paciente continua editável no plano de tratamento.',
        bodyHTML:'<div id="procCatalogApp" style="width:100%"></div>',
        footHTML:'<button class="btn" onclick="closeModal()">Fechar</button>',
        onMount: renderProcedureCatalogApp,
        maxWidth:'min(99vw, 1880px)'
      });
    }

    function renderProcedureCatalogApp(){
      const box = el('procCatalogApp');
      if(!box) return;
      const state = window.__procCatalogState || { editingId:null, search:'' };
      const db = loadDB();
      const catalog = getProcedureCatalog(db);
      const editItem = catalog.find(x=>x.id===state.editingId) || null;
      const filtered = catalog.filter(x=>{
        const q = String(state.search||'').trim().toLowerCase();
        if(!q) return true;
        return String(x.nome||'').toLowerCase().includes(q)
          || String(x.categoria||'').toLowerCase().includes(q)
          || String(x.tipoClinico||'').toLowerCase().includes(q)
          || String(x.indicacao||'').toLowerCase().includes(q)
          || String(x.abrangencia||'').toLowerCase().includes(q);
      });
      box.innerHTML = `
        <div class="procGrid">
          <div>
            <label>Nome do procedimento</label>
            <input id="procName" type="text" placeholder="Ex: Restauração de resina 1 face" value="${escapeHTML(editItem?.nome || '')}">
          </div>
          <div>
            <label>Categoria</label>
            <input id="procCategory" type="text" placeholder="Ex: Dentística" value="${escapeHTML(editItem?.categoria || '')}">
          </div>
          <div>
            <label>Valor base</label>
            <input id="procValue" type="number" step="0.01" value="${Number(editItem?.valorBase || 0) || ''}">
          </div>
          <div>
            <label>Exige dente?</label>
            <select id="procNeedsTooth">
              <option value="0" ${editItem?.exigeDente ? '' : 'selected'}>Não</option>
              <option value="1" ${editItem?.exigeDente ? 'selected' : ''}>Sim</option>
            </select>
          </div>
          <div>
            <label>Exige face?</label>
            <select id="procNeedsFace">
              <option value="0" ${editItem?.exigeFace ? '' : 'selected'}>Não</option>
              <option value="1" ${editItem?.exigeFace ? 'selected' : ''}>Sim</option>
            </select>
          </div>
          <div>
            <label>Cobra por dente?</label>
            <select id="procPerTooth">
              <option value="0" ${editItem?.cobraPorDente ? '' : 'selected'}>Não</option>
              <option value="1" ${editItem?.cobraPorDente ? 'selected' : ''}>Sim</option>
            </select>
          </div>
        </div>
        <div class="procGrid procClinicalGrid" style="grid-template-columns:1fr 1fr 1fr; margin-top:10px">
          <div>
            <label>Tipo clínico <span class="muted">(preparado para inteligência futura)</span></label>
            <input id="procClinicalType" type="text" placeholder="Ex: perda dentária, restauração, endodontia" value="${escapeHTML(editItem?.tipoClinico || '')}">
          </div>
          <div>
            <label>Indicação</label>
            <input id="procIndication" type="text" placeholder="Ex: ausência unitária, cárie extensa" value="${escapeHTML(editItem?.indicacao || '')}">
          </div>
          <div>
            <label>Abrangência</label>
            <input id="procScope" type="text" placeholder="Ex: unitário, múltiplo, arcada" value="${escapeHTML(editItem?.abrangencia || '')}">
          </div>
        </div>
        <div style="display:flex; gap:10px; margin-top:12px; align-items:center; flex-wrap:wrap">
          <label style="display:flex; gap:8px; align-items:center; margin:0">
            <input id="procActive" type="checkbox" ${editItem?.ativo === false ? '' : 'checked'} style="width:auto"> Ativo
          </label>
          <button class="btn ok" onclick="CRONOS_PROC_UI.save()">${editItem ? 'Salvar alteração' : 'Adicionar procedimento'}</button>
          <button class="btn" onclick="CRONOS_PROC_UI.reset()">${editItem ? 'Cancelar edição' : 'Limpar campos'}</button>
          <div style="flex:1"></div>
          <input id="procSearch" type="text" placeholder="Buscar procedimento..." value="${escapeHTML(state.search||'')}" oninput="CRONOS_PROC_UI.search(this.value)" style="max-width:280px">
        </div>
        <div class="tableWrap" style="margin-top:14px">
          <table class="procCatalogTable">
            <thead>
              <tr>
                <th>Procedimento</th>
                <th>Categoria</th>
                <th>Valor base</th>
                <th>Dente</th>
                <th>Face</th>
                <th>Por dente</th>
                <th>Tipo clínico</th>
                <th>Indicação</th>
                <th>Abrangência</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.length ? filtered.map(item=>`
                <tr>
                  <td>${escapeHTML(item.nome||'—')}</td>
                  <td>${escapeHTML(item.categoria||'—')}</td>
                  <td>${moneyBR(item.valorBase||0)}</td>
                  <td>${item.exigeDente ? 'Sim' : 'Não'}</td>
                  <td>${item.exigeFace ? 'Sim' : 'Não'}</td>
                  <td>${item.cobraPorDente ? 'Sim' : 'Não'}</td>
                  <td>${escapeHTML(item.tipoClinico || '—')}</td>
                  <td>${escapeHTML(item.indicacao || '—')}</td>
                  <td>${escapeHTML(item.abrangencia || '—')}</td>
                  <td>${item.ativo === false ? 'Inativo' : 'Ativo'}</td>
                  <td>
                    <button class="miniBtn" onclick="CRONOS_PROC_UI.edit('${escapeHTML(item.id)}')">Editar</button>
                    <button class="miniBtn danger" onclick="CRONOS_PROC_UI.remove('${escapeHTML(item.id)}')">Excluir</button>
                  </td>
                </tr>
              `).join('') : `<tr><td colspan="11" class="muted">Nenhum procedimento encontrado.</td></tr>`}
            </tbody>
          </table>
        </div>
      `;
    }

    
    function __cronosRefocusInput(id, value=''){
      requestAnimationFrame(()=>{
        const input = el(id);
        if(!input) return;
        try{
          input.focus();
          const pos = String(value ?? '').length;
          if(typeof input.setSelectionRange === 'function') input.setSelectionRange(pos, pos);
        }catch(_){}
      });
    }
    function __cronosThemeIsDark(){
      try{
        const root = document.documentElement;
        const body = document.body;
        const cls = `${root.className||''} ${body.className||''}`.toLowerCase();
        if(/(^|\s)dark(\s|$)/.test(cls)) return true;
        const attr = String(root.getAttribute('data-theme') || body.getAttribute('data-theme') || '').toLowerCase();
        if(attr.includes('dark')) return true;
        const bg = getComputedStyle(body).backgroundColor || getComputedStyle(root).backgroundColor || '';
        const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if(m){
          const r=+m[1], g=+m[2], b=+m[3];
          const lum = (0.2126*r + 0.7152*g + 0.0722*b);
          return lum < 140;
        }
      }catch(_){}
      return false;
    }
    function __odontoBoxLeftPct(tooth, i){
      const base = 5.5 + i * 6.0;
      const tweak = ({
        '16': 0,
        '26': 0,
        '46': 0,
        '36': 0
      })[String(tooth)] || 0;
      return (base + tweak).toFixed(2);
    }

window.CRONOS_PROC_UI = {
      search(v){ window.__procCatalogState = Object.assign(window.__procCatalogState || {}, {search:v}); renderProcedureCatalogApp(); __cronosRefocusInput('procSearch', v); },
      edit(id){
        window.__procCatalogState = Object.assign(window.__procCatalogState || {}, {editingId:id});
        renderProcedureCatalogApp();

        requestAnimationFrame(()=>{
          try{
            const modalBody = el('modalBody') || qs('#modalBg .modalBody');
            const modalInner = qs('#modalBg .modalInner');
            const app = el('procCatalogApp');

            if(modalBody && typeof modalBody.scrollTo === 'function'){
              modalBody.scrollTo({ top:0, behavior:'smooth' });
            }
            if(modalInner && typeof modalInner.scrollTo === 'function'){
              modalInner.scrollTo({ top:0, behavior:'smooth' });
            }
            if(app && typeof app.scrollIntoView === 'function'){
              app.scrollIntoView({ behavior:'smooth', block:'start' });
            }

            setTimeout(()=>{ try{ el('procName')?.focus(); }catch(_){} }, 220);
          }catch(_){}
        });
      },
      reset(){ window.__procCatalogState = Object.assign(window.__procCatalogState || {}, {editingId:null}); renderProcedureCatalogApp(); },
      save(){
        const db = loadDB();
        if(!db.settings) db.settings = {};
        const catalog = getProcedureCatalog(db).slice();
        const state = window.__procCatalogState || { editingId:null };
        const nome = String(val('procName') || '').trim();
        const categoria = String(val('procCategory') || '').trim();
        const valorBase = parseMoneyInput(val('procValue'));
        const tipoClinico = String(val('procClinicalType') || '').trim();
        const indicacao = String(val('procIndication') || '').trim();
        const abrangencia = String(val('procScope') || '').trim();
        const exigeDente = String(val('procNeedsTooth')) === '1';
        const exigeFace = String(val('procNeedsFace')) === '1';
        const cobraPorDente = String(val('procPerTooth')) === '1';
        const ativo = !!el('procActive')?.checked;
        if(!nome) return toast('Procedimento', 'Digite o nome do procedimento.');
        const payload = { id: state.editingId || uid('proc'), nome, categoria, valorBase, tipoClinico, indicacao, abrangencia, exigeDente, exigeFace, cobraPorDente, ativo };
        const idx = catalog.findIndex(x=>x.id===payload.id);
        if(idx >= 0) catalog[idx] = payload; else catalog.push(payload);
        db.settings.procedureCatalog = catalog;
        saveDB(db);
        window.__procCatalogState = { editingId:null, search: state.search || '' };
        renderProcedureCatalogApp();
        injectProcedureSettingsCard();
        toast('Procedimento salvo ✅', nome);
      },
      remove(id){
        if(!confirm('Excluir este procedimento do cadastro?')) return;
        const db = loadDB();
        if(!db.settings) db.settings = {};
        db.settings.procedureCatalog = getProcedureCatalog(db).filter(x=>x.id!==id);
        saveDB(db);
        if(window.__procCatalogState?.editingId === id) window.__procCatalogState.editingId = null;
        renderProcedureCatalogApp();
        injectProcedureSettingsCard();
        toast('Procedimento removido.');
      }
    };

    function setupFichaState(entryId){
      const db = loadDB();
      const entry = getEntryById(entryId);
      if(!entry) return null;
      ensureFicha(entry);
      saveDB(db);
      window.__fichaFeatureState = {
        entryId: String(entryId),
        procSearch: '',
        procMenuOpen: false,
        selectedProcId: '',
        selectedTeeth: [],
        selectedFace: '',
        price: '',
        selectedTooth: null,
        selectedItemIds: []
      };
      return window.__fichaFeatureState;
    }
    function getFichaState(){ return window.__fichaFeatureState || null; }
    function getSelectedProc(state, db){ return getProcedureCatalog(db).find(x=>x.id===state?.selectedProcId) || null; }
    function procLabel(item){
      if(!item) return '';
      return `${String(item.nome||'')}${item.categoria ? ` • ${String(item.categoria||'')}` : ''}`;
    }
    function getFaceOptionsHTML(cur=''){
      const selected = new Set(String(cur || '').split(',').map(s=>s.trim()).filter(Boolean));
      if(!selected.size && !String(cur||'').trim()) selected.add('');
      return FACE_OPTIONS.map(opt=>`<option value="${escapeHTML(opt.value)}" ${selected.has(String(opt.value)) ? 'selected' : ''}>${escapeHTML(opt.label)}</option>`).join('');
    }
    function getFaceChipsHTML(cur='', enabled=true){
      const selected = new Set(String(cur || '').split(',').map(s=>s.trim()).filter(Boolean));
      const hasFaces = selected.size > 0;
      return `
        <div class="faceChipWrap">
          ${FACE_OPTIONS.map(opt=>{
            const value = String(opt.value || '');
            const active = value ? selected.has(value) : !hasFaces;
            return `<button type="button" class="faceChip ${active ? 'active' : ''}" ${enabled ? '' : 'disabled'} onclick="CRONOS_FICHA_UI.toggleFaceChip('${escapeHTML(value)}')">${escapeHTML(opt.label)}</button>`;
          }).join('')}
        </div>
        <div class="faceSelectedText">${enabled ? (hasFaces ? `Selecionado: <b>${escapeHTML(Array.from(selected).join(', '))}</b>` : 'Sem face selecionada.') : 'Este procedimento não exige face.'}</div>
      `;
    }
    function normalizeProcSearchText(v){
      return String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    }
    function filterProcedureCatalog(catalog, query){
      const q = normalizeProcSearchText(query);
      if(!q) return catalog;
      return catalog.filter(item=>{
        const text = normalizeProcSearchText(`${item.nome || ''} ${item.categoria || ''} ${procLabel(item)}`);
        return text.includes(q);
      });
    }
    function getProcSuggestionsHTML(catalog, query=''){
      const list = filterProcedureCatalog(catalog, query).slice(0, 40);
      if(!list.length){
        return `<div class="procSuggestEmpty">Nenhum procedimento encontrado.</div>`;
      }
      return list.map(item=>`
        <button type="button" class="procSuggestItem" onmousedown="event.preventDefault(); CRONOS_FICHA_UI.selectProc('${escapeHTML(item.id)}')">
          <div>${escapeHTML(item.nome || 'Procedimento')}</div>
          <div class="muted">${escapeHTML(item.categoria || 'Sem categoria')} ${Number(item.valorBase || 0) ? `• ${moneyBR(item.valorBase || 0)}` : ''}</div>
        </button>
      `).join('');
    }
    function lineDiscount(item){
      return Number(item.valorBase||0) - Number(item.valorFechado||0);
    }
    function lineDiscountPct(item){
      return percent(lineDiscount(item), Number(item.valorBase||0));
    }
    function getToothMeta(entry, tooth){
      const ficha = ensureFicha(entry);
      return ficha.odontograma?.[String(tooth)] || {};
    }
    function isToothAbsent(entry, tooth){
      const meta = getToothMeta(entry, tooth);
      return meta?.absent === true || meta?.condition === 'absent' || meta?.status === 'absent';
    }
    function getToothProgressStatus(entry, tooth){
      const ficha = ensureFicha(entry);
      const meta = getToothMeta(entry, tooth);
      if(meta?.status === 'done' || meta?.status === 'realizado') return 'done';
      if(meta?.status === 'paid' || meta?.status === 'pago' || meta?.status === 'closed' || meta?.status === 'plan') return 'paid';

      const planForTooth = ficha.plano.filter(x=>String(x.dente||'').split(',').map(s=>s.trim()).includes(String(tooth)));
      if(planForTooth.some(x=>x.feito)) return 'done';
      if(planForTooth.some(x=>x.pago)) return 'paid';
      return '';
    }
    function getToothVisualState(entry, tooth){
      if(isToothAbsent(entry, tooth)) return 'absent';
      return getToothProgressStatus(entry, tooth);
    }
    function getItemVisualState(entry, item){
      if(!item) return '';
      if(item.feito) return 'done';
      if(item.pago) return 'paid';
      const teeth = String(item.dente||'').split(',').map(s=>s.trim()).filter(Boolean);
      if(teeth.length){
        const hasAbsent = teeth.some(t=>isToothAbsent(entry, t));
        if(hasAbsent) return 'absent';
        const states = teeth.map(t => getToothProgressStatus(entry, t)).filter(Boolean);
        if(states.includes('done')) return 'done';
        if(states.includes('paid')) return 'paid';
      }
      return '';
    }
    function buildFichaHeader(entry, contact){
      const db = loadDB();
      const actor = currentActor();
      const branding = getClinicBranding(db, actor);
      const patientName = escapeHTML(contact?.name || entry?.name || 'Paciente');
      const phone = escapeHTML(contact?.phone || entry?.phone || '—');
      const cpf = escapeHTML(formatCPF(contact?.cpf || '') || '—');
      const birthAge = escapeHTML(birthWithAgeLabel(contact?.birthDate || '') || '—');
      const city = escapeHTML(entry?.city || '—');
      const treatment = escapeHTML(entry?.treatment || '—');
      const clinicName = escapeHTML(getClinicDisplayName(db, actor));
      return `
        <div class="fichaHead">
          <div class="cardMini">
            <div style="display:flex; gap:10px; align-items:center">
              ${branding?.logoDataUri ? `<img src="${branding.logoDataUri}" alt="${clinicName}" style="width:auto;height:60px;max-width:120px;object-fit:contain;border:none;background:transparent">` : ``}
              <div>
                <div class="muted" style="font-size:12px">Clínica</div>
                <div style="font-size:20px; font-weight:800">${clinicName}</div>
              </div>
            </div>
            <div style="font-size:18px; font-weight:800; margin-top:10px">${patientName}</div>
            <div class="muted" style="margin-top:6px">Telefone: ${phone}</div>
            <div class="muted">CPF: ${cpf}</div>
            <div class="muted">Nascimento: ${birthAge}</div>
          </div>
          <div class="cardMini">
            <div class="muted" style="font-size:12px">Resumo rápido</div>
            <div style="font-size:15px; font-weight:800; margin-top:2px">Tratamento principal: ${treatment}</div>
            <div class="muted" style="margin-top:6px">Emissão: ${fmtBR(todayISO())}</div>
            <div class="muted">Lead: ${escapeHTML(String(entry?.id || '—'))}</div>
          </div>
        </div>
      `;
    }
    function renderFichaApp(){
      injectFichaStyles();
      const state = getFichaState();
      const box = el('fichaApp');
      if(!box || !state) return;
      const db = loadDB();
      const actor = currentActor();
      const entry = getEntryById(state.entryId);
      if(!entry){ box.innerHTML = `<div class="fichaEmpty">Lead não encontrado.</div>`; return; }
      const contact = getContactForEntry(entry);
      const ficha = ensureFicha(entry);
      const selectedProc = getSelectedProc(state, db);
      const catalogAll = getProcedureCatalog(db).filter(x=>x.ativo !== false);
      const catalog = catalogAll;
      const totals = calcFichaTotals(ficha.plano || [], entry);
      const activeEvaluation = getActiveFichaEvaluation(ficha, entry);
      const selectedFichaItemIds = new Set(Array.isArray(state.selectedItemIds) ? state.selectedItemIds.map(String) : []);
      const selectedFichaItems = ficha.plano.filter(item=>selectedFichaItemIds.has(String(item.id)) && isFichaItemAvailableForReceiving(entry, item));
      const selectedFichaTotal = selectedFichaItems.reduce((s,item)=>s + Number(item.valorFechado || 0), 0);
      const selectedToothMeta = state.selectedTooth ? (ficha.odontograma?.[state.selectedTooth] || {}) : {};
      const selectedToothPlan = state.selectedTooth ? ficha.plano.filter(x=>String(x.dente||'').split(',').map(s=>s.trim()).includes(String(state.selectedTooth))) : [];
      const selectedPrice = state.price !== '' ? String(state.price) : (selectedProc ? String(Number(selectedProc.valorBase||0)) : '');
      const selectedProcLabel = selectedProc ? procLabel(selectedProc) : '';
      const procInputValue = state.procSearch !== '' ? state.procSearch : selectedProcLabel;
      const procMenuHTML = getProcSuggestionsHTML(catalog, state.procMenuOpen ? '' : procInputValue);
      const selectedFaceText = selectedProc?.exigeFace ? (String(state.selectedFace || '').trim() || '—') : 'Não exige';
      const selectedToothStatus = state.selectedTooth
        ? (isToothAbsent(entry, state.selectedTooth) ? 'Perda dentária / ausente' : (getToothProgressStatus(entry, state.selectedTooth) === 'done' ? 'Realizado' : (getToothProgressStatus(entry, state.selectedTooth) === 'paid' ? 'Pago' : 'Neutro')))
        : '—';
      const upper = [...TOOTH_ROWS.supDir, ...TOOTH_ROWS.supEsq];
      const lower = [...TOOTH_ROWS.infDir, ...TOOTH_ROWS.infEsq];
      function overlayBoxes(list, y){
        return list.map((tooth, i)=>`<button type="button" class="toothOverlayBox ${getToothVisualState(entry, tooth)} ${state.selectedTeeth.includes(tooth) ? 'active' : ''}" style="left:${__odontoBoxLeftPct(tooth, i)}%; top:${y}%" title="Selecionar dente para o plano. Use os botões ao lado para marcar pago, realizado ou ausente." onclick="CRONOS_FICHA_UI.toggleTooth('${tooth}')">${tooth}</button>`).join('');
      }
      const selectedTeeth = Array.isArray(state.selectedTeeth) ? state.selectedTeeth.slice() : [];
      const selectedTeethLabel = selectedTeeth.length ? selectedTeeth.join(', ') : 'Nenhum dente selecionado';
      const selectedPlanCount = selectedTeeth.length
        ? ficha.plano.filter(item=>{
            const dentesItem = String(item.dente || '').split(',').map(s=>s.trim()).filter(Boolean);
            return selectedTeeth.some(t=>dentesItem.includes(String(t)));
          }).length
        : 0;

      box.innerHTML = `
        ${buildFichaHeader(entry, contact)}

        <div class="odontoFull">
          <div class="sectionTitle">Odontograma</div>
          <div class="odontoGrid">
            <div>
              <div class="odontoRefStage">
                <img class="odontoBaseLight" src="${ODONTO_BASE_LIGHT}" alt="Arcada odontograma clara"><img class="odontoBaseDark" src="${ODONTO_BASE_DARK}" alt="Arcada odontograma escura">
                <div class="odontoOverlay">${overlayBoxes(upper, 8.5)}${overlayBoxes(lower, 82.5)}</div>
              </div>
              <div class="odontoLegend">
                <span class="legendPill"><span class="legendDot" style="background:transparent;border:1px solid var(--line)"></span>Neutro</span>
                <span class="legendPill lp-paid"><span class="legendDot"></span>Pago</span>
                <span class="legendPill lp-done"><span class="legendDot"></span>Realizado</span>
                <span class="legendPill lp-absent"><span class="legendDot"></span>Perda dentária / ausente</span>
              </div>
              <div style="margin-top:12px" class="small">Clique nos números para selecionar um ou vários dentes. Depois escolha o procedimento no painel ao lado. Andamento e ausência também ficam no painel, sem misturar as coisas.</div>

              <div class="totalsGrid fichaTotalsUnderOdonto">
                <div class="totalBox"><span class="label">Valor de tabela</span><div class="value">${moneyBR(totals.totalBase)}</div></div>
                <div class="totalBox"><span class="label">Valor de orçamento</span><div class="value">${moneyBR(totals.totalFechado)}</div></div>
                <div class="totalBox"><span class="label">Desconto total</span><div class="value">${moneyBR(totals.totalDesconto)}</div><div class="small">${totals.descontoPct.toFixed(2)}%</div></div>
                <div class="totalBox"><span class="label">Total realizado</span><div class="value">${moneyBR(totals.totalFeito)}</div></div>
                <div class="totalBox"><span class="label">Total pago</span><div class="value">${moneyBR(totals.totalPago)}</div></div>
                <div class="totalBox"><span class="label">Em aberto</span><div class="value">${moneyBR(totals.emAberto)}</div></div>
              </div>
            </div>

            <div class="odontoPanel">
              <div style="font-size:16px; font-weight:800">Plano do tratamento</div>
              <div class="small" style="margin:6px 0 10px">Selecione um ou vários dentes no odontograma e lance o procedimento aqui mesmo, sem descer a tela.</div>

              <div class="panelMiniGrid">
                <div><span class="muted">Dente(s)</span><b>${escapeHTML(selectedTeethLabel)}</b></div>
                <div><span class="muted">Itens ligados</span><b>${selectedPlanCount}</b></div>
              </div>
              <div style="margin-top:10px;border:1px solid var(--line);border-radius:12px;padding:10px;background:rgba(255,255,255,.025)">
                <div class="small muted">Avaliação ativa para novos procedimentos</div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
                  <select id="fichaEvalSelect" style="max-width:220px" onchange="CRONOS_FICHA_UI.setActiveEvaluation(this.value)">
                    ${ficha.avaliacoes.map(av=>`<option value="${escapeHTML(av.id)}" ${String(av.id)===String(activeEvaluation.id) ? 'selected' : ''}>${escapeHTML(av.label)} • ${fmtBR(av.date)}</option>`).join('')}
                  </select>
                  <button type="button" class="miniBtn" onclick="CRONOS_FICHA_UI.newEvaluation()">+ Nova avaliação</button>
                </div>
              </div>
              ${selectedTeeth.length ? `<div class="toothChipRow">${selectedTeeth.map(tooth=>`<span class="toothChip">${tooth} • ${deriveToothType(tooth)}</span>`).join('')}</div>` : `<div class="small muted" style="margin-top:8px">Nenhum dente selecionado ainda.</div>`}

              <label>Procedimento</label>
              <div class="procPickerWrap">
                <input id="fichaProcPicker" autocomplete="off" value="${escapeHTML(procInputValue)}" placeholder="Digite para filtrar o procedimento" onfocus="CRONOS_FICHA_UI.openProcMenu(false)" oninput="CRONOS_FICHA_UI.pickProcByText(this.value)">
                <button type="button" class="procDropBtn" title="Ver procedimentos" onmousedown="event.preventDefault(); CRONOS_FICHA_UI.toggleProcMenu()">▾</button>
                <div id="fichaProcMenu" class="procSuggestMenu ${state.procMenuOpen ? 'show' : ''}">
                  ${procMenuHTML}
                </div>
              </div>

              <div class="sideFormGrid">
                <div>
                  <label>Valor do paciente</label>
                  <input type="number" step="0.01" value="${escapeHTML(selectedPrice)}" oninput="CRONOS_FICHA_UI.setPrice(this.value)" placeholder="0,00">
                </div>
                <div>
                  <label>Valor base</label>
                  <input type="text" disabled value="${selectedProc ? moneyBR(selectedProc.valorBase || 0) : '—'}">
                </div>
                <div class="full">
                  <label>Face(s)</label>
                  ${getFaceChipsHTML(state.selectedFace || '', !!selectedProc?.exigeFace)}
                  <div class="small muted" style="margin-top:6px">${selectedProc?.exigeFace ? 'Clique nas faces para marcar ou desmarcar. Pode selecionar mais de uma.' : 'Este procedimento não exige face.'}</div>
                </div>
              </div>

              <button class="btn primary" style="width:100%; margin-top:12px" onclick="CRONOS_FICHA_UI.addToPlan()">➕ Adicionar ao plano</button>

              <div class="sideActions">
                <button class="btn small" onclick="CRONOS_FICHA_UI.markSelectedProgress('paid')">Marcar pago</button>
                <button class="btn ok small" onclick="CRONOS_FICHA_UI.markSelectedProgress('done')">Marcar realizado</button>
                <button class="btn danger small" onclick="CRONOS_FICHA_UI.setAbsentForSelection()">Marcar ausente</button>
                <button class="btn small" onclick="CRONOS_FICHA_UI.clearSelection()">Limpar seleção</button>
                <button class="btn small" onclick="CRONOS_FICHA_UI.clearToothMeta()">Limpar marcação</button>
              </div>
              <div class="small muted" style="margin-top:10px">Pago/realizado são andamento. Ausente é condição clínica separada.</div>
            </div>
          </div>
        </div>

        <div class="fichaLayout">
          <div class="fichaPlanToolbar" style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:10px;margin:0 0 10px">
            <div>
              <div style="font-weight:900">Plano de tratamento</div>
              <div class="small muted">Cada procedimento tem avaliação, data e vínculo financeiro. Selecione procedimentos sem recebimento para gerar cobrança à vista ou parcelada.</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${fichaEvaluationSummaryHTML(ficha)}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
              <button class="btn primary small" type="button" onclick="CRONOS_FICHA_UI.openReceivingForSelected()" ${selectedFichaItems.length ? '' : 'disabled'}>Gerar recebimento (${selectedFichaItems.length}) • ${moneyBR(selectedFichaTotal)}</button>
              <button class="btn small" type="button" onclick="CRONOS_FICHA_UI.refreshPlanBaseValues()">Atualizar valores de tabela</button>
            </div>
          </div>
          <div class="fichaTableWrap">
            <table class="fichaTable">
              <thead>
                <tr>
                  <th>Sel.</th>
                  <th>#</th>
                  <th>Avaliação</th>
                  <th>Procedimento</th>
                  <th>Dente</th>
                  <th>Face</th>
                  <th>Valor base</th>
                  <th>Valor fechado</th>
                  <th>Desconto</th>
                  <th>Feito</th>
                  <th>Financeiro</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                ${ficha.plano.length ? ficha.plano.map((item, idx)=>{
                  const finance = getFichaItemFinancialStatus(entry, item);
                  const available = isFichaItemAvailableForReceiving(entry, item);
                  const checked = selectedFichaItemIds.has(String(item.id));
                  return `
                  <tr class="${(()=>{ const _st = getItemVisualState(entry, item); return _st==='done' ? 'fichaDone' : (isFichaItemFinancialPaid(entry, item) ? 'fichaPaid' : (_st==='absent' ? 'fichaAbsent' : '')); })()}">
                    <td><input type="checkbox" ${checked ? 'checked' : ''} ${available ? '' : 'disabled'} onchange="CRONOS_FICHA_UI.toggleItemSelection('${escapeHTML(item.id)}')"></td>
                    <td>${idx+1}</td>
                    <td><div><b>${escapeHTML(item.avaliacaoLabel || 'Avaliação')}</b></div><div class="small muted">${fmtBR(item.avaliacaoData || '')}</div></td>
                    <td>${escapeHTML(item.procedimento || '—')}</td>
                    <td>${escapeHTML(item.dente || '—')}</td>
                    <td><input type="text" value="${escapeHTML(item.face || '')}" placeholder="Ex: M, O/I" oninput="CRONOS_FICHA_UI.updateFace('${escapeHTML(item.id)}', this.value)"></td>
                    <td>${moneyBR(item.valorBase || 0)}</td>
                    <td><input type="number" step="0.01" value="${escapeHTML(String(Number(item.valorFechado||0)))}" oninput="CRONOS_FICHA_UI.updateValue('${escapeHTML(item.id)}', this.value)"></td>
                    <td>${moneyBR(lineDiscount(item))}<br><span class="small">${lineDiscountPct(item).toFixed(2)}%</span></td>
                    <td><button class="btn small ${item.feito ? 'ok' : ''}" onclick="CRONOS_FICHA_UI.toggleDone('${escapeHTML(item.id)}')">${item.feito ? 'Feito' : 'Pendente'}</button></td>
                    <td>
                      ${fichaFinanceBadge(entry, item)}
                      ${finance.plan ? `<div style="margin-top:6px"><button type="button" class="miniBtn" onclick="openNewFinancialInstallment('${escapeHTML(entry.id)}','${escapeHTML(finance.plan.id)}')">Abrir</button></div>` : `<div style="margin-top:6px"><button type="button" class="miniBtn" onclick="CRONOS_FICHA_UI.openReceivingForItems(['${escapeHTML(item.id)}'])">Receber</button></div>`}
                    </td>
                    <td><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="miniBtn danger" onclick="CRONOS_FICHA_UI.removeItem('${escapeHTML(item.id)}')">Excluir</button></div></td>
                  </tr>
                `}).join('') : `<tr><td colspan="12"><div class="fichaEmpty">Nenhum item no plano ainda.</div></td></tr>`}
              </tbody>
            </table>
          </div>

          <div class="fichaAddWrap" style="margin-top:14px">
            <label>Observações da ficha</label>
            <textarea id="fichaObsTxt" placeholder="Escreve aqui tudo que deve sair na impressão..." oninput="CRONOS_FICHA_UI.setObs(this.value)">${escapeHTML(String(ficha.observacoes || ''))}</textarea>
            <div class="small" style="margin-top:8px">Fica salvo no Cronos e reaparece em qualquer nova impressão.</div>
          </div>
        </div>
      `;
    }

    window.CRONOS_FICHA_UI = {
      setSearch(v){ const s = getFichaState(); if(!s) return; s.procSearch = v; renderFichaApp(); __cronosRefocusInput('fichaProcSearch', v); },
      pickProcByText(v){
        const s = getFichaState(); if(!s) return;
        const typed = String(v||'');
        s.procSearch = typed;
        s.procMenuOpen = true;

        const db = loadDB();
        const current = getProcedureCatalog(db).find(x=>x.id===s.selectedProcId) || null;
        if(current && procLabel(current) !== typed){
          s.selectedProcId = '';
          s.selectedFace = '';
          s.price = '';
        }

        const menu = el('fichaProcMenu');
        if(menu){
          const catalog = getProcedureCatalog(db).filter(x=>x.ativo !== false);
          menu.innerHTML = getProcSuggestionsHTML(catalog, typed);
          menu.classList.add('show');
        }
      },
      openProcMenu(showAll=false){
        const s = getFichaState(); if(!s) return;
        s.procMenuOpen = true;
        const db = loadDB();
        const catalog = getProcedureCatalog(db).filter(x=>x.ativo !== false);
        const menu = el('fichaProcMenu');
        if(menu){
          menu.innerHTML = getProcSuggestionsHTML(catalog, showAll ? '' : (s.procSearch || ''));
          menu.classList.add('show');
        }else{
          renderFichaApp();
        }
        setTimeout(()=>{ try{ el('fichaProcPicker')?.focus(); }catch(_){} }, 0);
      },
      closeProcMenu(){
        const s = getFichaState(); if(!s) return;
        s.procMenuOpen = false;
        const menu = el('fichaProcMenu');
        if(menu) menu.classList.remove('show');
      },
      toggleProcMenu(){
        const s = getFichaState(); if(!s) return;
        if(s.procMenuOpen){
          this.closeProcMenu();
        }else{
          this.openProcMenu(true);
        }
      },
      selectProc(id){
        const s = getFichaState(); if(!s) return;
        const db = loadDB();
        const item = getProcedureCatalog(db).find(x=>x.id===id) || null;
        s.selectedProcId = id || '';
        s.procSearch = item ? procLabel(item) : '';
        s.procMenuOpen = false;
        s.selectedFace = '';
        s.price = item ? String(Number(item.valorBase || 0)) : '';
        renderFichaApp();
      },
      toggleTooth(tooth){
        const s = getFichaState(); if(!s) return;
        tooth = String(tooth || '');
        if(!tooth) return;
        const idx = s.selectedTeeth.indexOf(tooth);
        if(idx >= 0) s.selectedTeeth.splice(idx,1); else s.selectedTeeth.push(tooth);
        s.selectedTooth = tooth;
        s.selectedTeeth.sort((a,b)=>Number(a)-Number(b));
        renderFichaApp();
      },
      setTeethFromSelect(node){
        const s = getFichaState(); if(!s || !node) return;
        s.selectedTeeth = Array.from(node.selectedOptions || []).map(opt=>String(opt.value||'')).filter(Boolean);
        s.selectedTeeth.sort((a,b)=>Number(a)-Number(b));
        renderFichaApp();
      },
      setFace(v){ const s = getFichaState(); if(!s) return; s.selectedFace = v || ''; },
      setFaceFromSelect(node){
        const s = getFichaState(); if(!s || !node) return;
        const values = Array.from(node.selectedOptions || []).map(opt=>String(opt.value||'')).filter(Boolean);
        s.selectedFace = values.join(', ');
      },
      toggleFaceChip(face){
        const s = getFichaState(); if(!s) return;
        const value = String(face || '').trim();
        if(!value){
          s.selectedFace = '';
          renderFichaApp();
          return;
        }
        const selected = String(s.selectedFace || '').split(',').map(x=>x.trim()).filter(Boolean);
        const idx = selected.indexOf(value);
        if(idx >= 0) selected.splice(idx, 1);
        else selected.push(value);
        s.selectedFace = selected.join(', ');
        renderFichaApp();
      },
      setPrice(v){ const s = getFichaState(); if(!s) return; s.price = v; },
      setObs(v){ const s = getFichaState(); if(!s) return; const db = loadDB(); const entry = getEntryById(s.entryId); if(!entry) return; ensureFicha(entry).observacoes = String(v || ''); saveDB(db); },
      addToPlan(){
        const s = getFichaState(); if(!s) return;
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return toast('Lead não encontrado.');
        const ficha = ensureFicha(entry);
        const proc = getProcedureCatalog(db).find(x=>x.id===s.selectedProcId);
        if(!proc) return toast('Procedimento', 'Escolhe um procedimento antes.');
        const valorBase = Number(proc.valorBase || 0);
        const valorFechado = parseMoneyInput(s.price !== '' ? s.price : valorBase);
        const face = proc.exigeFace ? String(s.selectedFace || '') : '';
        const teeth = Array.isArray(s.selectedTeeth) ? s.selectedTeeth.slice() : [];
        const evalInfo = getActiveFichaEvaluation(ficha, entry);
        if(proc.exigeDente && !teeth.length){
          return toast('Dente', 'Seleciona pelo menos um dente para esse procedimento.');
        }
        if(proc.exigeDente && proc.cobraPorDente){
          teeth.forEach(tooth=>{
            ficha.plano.push({
              id: uid('plan'),
              procedimentoId: proc.id,
              procedimento: proc.nome,
              dente: tooth,
              face,
              valorBase,
              valorFechado,
              feito:false,
              pago:false,
              observacao:'',
              avaliacaoId: evalInfo.id,
              avaliacaoLabel: evalInfo.label,
              avaliacaoData: evalInfo.date,
              createdAt: new Date().toISOString(),
              financialPlanId:'',
              recebimentoId:''
            });
          });
        }else{
          ficha.plano.push({
            id: uid('plan'),
            procedimentoId: proc.id,
            procedimento: proc.nome,
            dente: proc.exigeDente ? teeth.join(', ') : '',
            face,
            valorBase,
            valorFechado,
            feito:false,
            pago:false,
            observacao:''
          });
        }
        saveDB(db);

        s.selectedTeeth = [];
        s.selectedTooth = null;
        s.selectedFace = '';
        s.selectedProcId = '';
        s.procSearch = '';
        s.procMenuOpen = false;
        s.price = '';

        renderFichaApp();
        try{ renderLeadsTable(filteredEntries()); }catch(_){ }
        toast('Item adicionado ✅', proc.nome);
      },
      refreshPlanBaseValues(){
        const s = getFichaState(); if(!s) return;
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return toast('Ficha', 'Lead não encontrado.');
        const ficha = ensureFicha(entry);
        const catalog = getProcedureCatalog(db);

        if(!Array.isArray(ficha.plano) || !ficha.plano.length){
          return toast('Plano vazio', 'Nenhum procedimento para atualizar.');
        }

        if(!confirm(
          'Atualizar os valores de tabela deste plano?\n\n' +
          'Isso atualiza apenas o Valor de tabela/Valor base conforme o cadastro atual de procedimentos.\n' +
          'O Valor de orçamento do paciente será mantido.'
        )) return;

        let updated = 0;
        let unchanged = 0;
        let notFound = 0;

        ficha.plano.forEach(item=>{
          const current = catalog.find(proc=>String(proc.id || '') === String(item.procedimentoId || ''))
            || catalog.find(proc=>String(proc.nome || '').trim().toLowerCase() === String(item.procedimento || '').trim().toLowerCase());

          if(!current){
            notFound++;
            return;
          }

          const oldBase = Number(item.valorBase || 0);
          const newBase = Number(current.valorBase || 0);

          item.procedimentoId = current.id || item.procedimentoId || '';
          item.procedimento = current.nome || item.procedimento || '';

          if(oldBase !== newBase){
            item.valorBase = newBase;
            updated++;
          }else{
            unchanged++;
          }
        });

        saveDB(db);
        renderFichaApp();
        try{ renderLeadsTable(filteredEntries()); }catch(_){}

        const msg = `${updated} atualizado(s) • ${unchanged} sem mudança${notFound ? ` • ${notFound} não encontrado(s)` : ''}`;
        toast('Valores de tabela atualizados ✅', msg);
      },
      updateValue(itemId, v){
        const s = getFichaState(); if(!s) return;
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const item = ensureFicha(entry).plano.find(x=>x.id===itemId);
        if(!item) return;
        item.valorFechado = parseMoneyInput(v);
        saveDB(db);
        renderFichaApp();
        try{ renderLeadsTable(filteredEntries()); }catch(_){ }
      },
      updateFace(itemId, v){
        const s = getFichaState(); if(!s) return;
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const item = ensureFicha(entry).plano.find(x=>x.id===itemId);
        if(!item) return;
        item.face = String(v || '');
        saveDB(db);
      },
      toggleDone(itemId){
        const s = getFichaState(); if(!s) return;
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const item = ensureFicha(entry).plano.find(x=>x.id===itemId);
        if(!item) return;
        item.feito = !item.feito;
        saveDB(db);
        renderFichaApp();
      },
      togglePaid(itemId){
        const s = getFichaState(); if(!s) return;
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const item = ensureFicha(entry).plano.find(x=>x.id===itemId);
        if(!item) return;
        const plan = getFinancialPlanForFichaItem(entry, item);
        if(plan) return openNewFinancialInstallment(entry.id, plan.id);
        this.openReceivingForItems([itemId]);
      },
      toggleItemSelection(itemId){
        const s = getFichaState(); if(!s) return;
        const id = String(itemId || '');
        s.selectedItemIds = Array.isArray(s.selectedItemIds) ? s.selectedItemIds : [];
        const idx = s.selectedItemIds.indexOf(id);
        if(idx >= 0) s.selectedItemIds.splice(idx,1); else s.selectedItemIds.push(id);
        renderFichaApp();
      },
      openReceivingForItems(itemIds){
        const s = getFichaState(); if(!s) return;
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const ficha = ensureFicha(entry);
        const ids = Array.from(new Set((itemIds||[]).map(String).filter(Boolean)));
        const items = ficha.plano.filter(item=>ids.includes(String(item.id)) && isFichaItemAvailableForReceiving(entry, item));
        if(!items.length) return toast('Recebimento', 'Selecione procedimento(s) sem recebimento vinculado.');
        const total = items.reduce((sum,item)=>sum + Number(item.valorFechado || 0), 0);
        window.__fichaReceivingDraft = { entryId: String(entry.id), itemIds: items.map(i=>String(i.id)) };
        openModal({
          title:'Gerar recebimento da ficha',
          sub:`${items.length} procedimento(s) • ${moneyBR(total)}`,
          bodyHTML:`
            <div style="display:grid;gap:12px">
              <div class="card" style="box-shadow:none">
                <div style="font-weight:900;margin-bottom:8px">Procedimentos selecionados</div>
                <div style="display:grid;gap:6px">
                  ${items.map(item=>`<div class="chip">${escapeHTML(item.avaliacaoLabel || 'Avaliação')} • ${escapeHTML(item.procedimento || '—')} • <b>${moneyBR(item.valorFechado || 0)}</b></div>`).join('')}
                </div>
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
                <div>
                  <label>Tipo</label>
                  <select id="fr_type" onchange="document.getElementById('fr_count_wrap').style.display=this.value==='parcelado'?'block':'none'">
                    <option value="avista">À vista</option>
                    <option value="parcelado">Parcelado</option>
                  </select>
                </div>
                <div>
                  <label>Forma de pagamento</label>
                  <select id="fr_method">
                    <option>Pix</option>
                    <option>Dinheiro</option>
                    <option>Cartão de crédito</option>
                    <option>Cartão de débito</option>
                    <option>Carnê/Boleto</option>
                  </select>
                </div>
                <div>
                  <label>Data do pagamento / 1º vencimento</label>
                  <input id="fr_date" type="date" value="${todayISO()}">
                </div>
                <div id="fr_count_wrap" style="display:none">
                  <label>Parcelas</label>
                  <input id="fr_count" type="number" min="1" step="1" value="1">
                </div>
              </div>
              <div>
                <label>Observação</label>
                <textarea id="fr_obs" rows="2" placeholder="Opcional"></textarea>
              </div>
            </div>
          `,
          footHTML:`<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn ok" onclick="CRONOS_FICHA_UI.confirmReceiving()">Salvar recebimento</button>`,
          maxWidth:'min(96vw, 860px)'
        });
      },
      openReceivingForSelected(){
        const s = getFichaState(); if(!s) return;
        this.openReceivingForItems(s.selectedItemIds || []);
      },
      confirmReceiving(){
        const draft = window.__fichaReceivingDraft || {};
        const plan = createFichaReceiving(draft.entryId, draft.itemIds, {
          type: val('fr_type') || 'avista',
          method: val('fr_method') || '',
          date: val('fr_date') || todayISO(),
          count: val('fr_count') || '1',
          obs: val('fr_obs') || ''
        });
        if(!plan) return;
        closeModal();
        const s = getFichaState();
        if(s){ s.selectedItemIds = []; }
        renderFichaApp();
        try{ renderInstallmentsView(); }catch(_){}
        try{ renderDashboard(); }catch(_){}
        toast('Recebimento criado ✅', `${moneyBR(plan.amount)} • ${plan.payments.length} lançamento(s)`);
      },
      setActiveEvaluation(evalId){
        const s = getFichaState(); if(!s) return;
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const ficha = ensureFicha(entry);
        if(ficha.avaliacoes.some(a=>String(a.id)===String(evalId))){
          ficha.activeEvaluationId = String(evalId);
          saveDB(db, { immediate:true });
        }
        renderFichaApp();
      },
      newEvaluation(){
        const s = getFichaState(); if(!s) return;
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const ficha = ensureFicha(entry);
        const date = prompt('Data da nova avaliação (AAAA-MM-DD):', todayISO());
        if(!date) return;
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('Data inválida', 'Use o formato AAAA-MM-DD.');
        const av = { id: uid('eval'), label: nextFichaEvaluationLabel(ficha), date, createdAt:new Date().toISOString() };
        ficha.avaliacoes.push(av);
        ficha.activeEvaluationId = av.id;
        saveDB(db, { immediate:true });
        renderFichaApp();
        toast('Nova avaliação criada ✅', `${av.label} • ${fmtBR(date)}`);
      },
      removeItem(itemId){
        if(!confirm('Excluir este item do plano?')) return;
        const s = getFichaState(); if(!s) return;
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const ficha = ensureFicha(entry);
        ficha.plano = ficha.plano.filter(x=>x.id!==itemId);
        saveDB(db);
        renderFichaApp();
        try{ renderLeadsTable(filteredEntries()); }catch(_){ }
      },
      pickTooth(tooth){ const s = getFichaState(); if(!s) return; s.selectedTooth = tooth; renderFichaApp(); },
      cycleToothStatus(tooth){
        const s = getFichaState(); if(!s) return;
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const ficha = ensureFicha(entry);
        const key = String(tooth);
        const meta = ficha.odontograma[key] || {};
        const cur = String(meta.status || '');
        let next = 'paid';
        if(cur === 'paid' || cur === 'pago' || cur === 'closed' || cur === 'plan') next = 'done';
        else if(cur === 'done' || cur === 'realizado') next = '';
        meta.status = next;
        if(!meta.status && !meta.absent && !meta.note && !meta.condition) delete ficha.odontograma[key];
        else ficha.odontograma[key] = meta;
        s.selectedTooth = key;
        saveDB(db);
        renderFichaApp();
      },
      toggleAbsent(tooth){
        const s = getFichaState(); if(!s) return;
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const ficha = ensureFicha(entry);
        const key = String(tooth || s.selectedTooth || '');
        if(!key) return;
        const meta = ficha.odontograma[key] || {};
        meta.absent = !(meta.absent === true || meta.status === 'absent' || meta.condition === 'absent');
        if(meta.status === 'absent') meta.status = '';
        meta.condition = meta.absent ? 'absent' : '';
        if(!meta.status && !meta.absent && !meta.note && !meta.condition) delete ficha.odontograma[key];
        else ficha.odontograma[key] = meta;
        s.selectedTooth = key;
        saveDB(db);
        renderFichaApp();
      },
      useSelectedToothForPlan(){
        const s = getFichaState(); if(!s || !s.selectedTooth) return;
        const tooth = String(s.selectedTooth);
        if(!s.selectedTeeth.includes(tooth)) s.selectedTeeth.push(tooth);
        s.selectedTeeth.sort((a,b)=>Number(a)-Number(b));
        renderFichaApp();
      },
      clearSelection(){
        const s = getFichaState(); if(!s) return;
        s.selectedTeeth = [];
        s.selectedTooth = null;
        s.selectedFace = '';
        s.selectedProcId = '';
        s.price = '';
        renderFichaApp();
      },
      selectedTeethOrLast(){
        const s = getFichaState(); if(!s) return [];
        const teeth = Array.isArray(s.selectedTeeth) ? s.selectedTeeth.slice() : [];
        if(!teeth.length && s.selectedTooth) teeth.push(String(s.selectedTooth));
        return [...new Set(teeth.map(String).filter(Boolean))];
      },
      markSelectedProgress(status){
        const s = getFichaState(); if(!s) return;
        const teeth = this.selectedTeethOrLast();
        if(!teeth.length) return toast('Odontograma', 'Seleciona pelo menos um dente.');
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const ficha = ensureFicha(entry);
        teeth.forEach(tooth=>{
          const key = String(tooth);
          const meta = ficha.odontograma[key] || {};
          meta.status = status || '';
          if(!meta.status && !meta.absent && !meta.note && !meta.condition) delete ficha.odontograma[key];
          else ficha.odontograma[key] = meta;
        });
        saveDB(db);
        renderFichaApp();
      },
      setAbsentForSelection(){
        const s = getFichaState(); if(!s) return;
        const teeth = this.selectedTeethOrLast();
        if(!teeth.length) return toast('Odontograma', 'Seleciona pelo menos um dente.');
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const ficha = ensureFicha(entry);
        const allAbsent = teeth.every(tooth=>isToothAbsent(entry, tooth));
        teeth.forEach(tooth=>{
          const key = String(tooth);
          const meta = ficha.odontograma[key] || {};
          meta.absent = !allAbsent;
          meta.condition = meta.absent ? 'absent' : '';
          if(meta.status === 'absent') meta.status = '';
          if(!meta.status && !meta.absent && !meta.note && !meta.condition) delete ficha.odontograma[key];
          else ficha.odontograma[key] = meta;
        });
        saveDB(db);
        renderFichaApp();
      },
      saveToothMeta(){
        const s = getFichaState(); if(!s || !s.selectedTooth) return;
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const ficha = ensureFicha(entry);
        const old = ficha.odontograma[s.selectedTooth] || {};
        ficha.odontograma[s.selectedTooth] = {
          ...old,
          status: String(el('odontoStatusSel')?.value || old.status || ''),
          note: String(el('odontoNoteTxt')?.value || old.note || '').trim(),
          absent: old.absent === true,
          condition: old.condition || ''
        };
        if(!ficha.odontograma[s.selectedTooth].status && !ficha.odontograma[s.selectedTooth].note && !ficha.odontograma[s.selectedTooth].absent && !ficha.odontograma[s.selectedTooth].condition){
          delete ficha.odontograma[s.selectedTooth];
        }
        saveDB(db);
        renderFichaApp();
        toast('Odontograma salvo.');
      },
      clearToothMeta(){
        const s = getFichaState(); if(!s) return;
        const teeth = this.selectedTeethOrLast();
        if(!teeth.length) return toast('Odontograma', 'Seleciona pelo menos um dente.');
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const ficha = ensureFicha(entry);
        teeth.forEach(tooth=>{ delete ficha.odontograma[String(tooth)]; });
        saveDB(db);
        renderFichaApp();
      }
    };

    if(!window.__CRONOS_PROC_MENU_OUTSIDE_BOUND__){
      window.__CRONOS_PROC_MENU_OUTSIDE_BOUND__ = true;
      document.addEventListener('mousedown', function(ev){
        try{
          const wrap = ev.target?.closest?.('.procPickerWrap');
          if(wrap) return;
          if(window.CRONOS_FICHA_UI?.closeProcMenu){
            window.CRONOS_FICHA_UI.closeProcMenu();
          }
        }catch(_){}
      }, true);
      document.addEventListener('keydown', function(ev){
        try{
          if(ev.key === 'Escape' && window.CRONOS_FICHA_UI?.closeProcMenu){
            window.CRONOS_FICHA_UI.closeProcMenu();
          }
        }catch(_){}
      });
    }

    window.openFicha = function(entryId){
      ensureProcedureCatalogSeeded();
      const st = setupFichaState(entryId);
      if(!st) return toast('Ficha', 'Lead não encontrado.');
      const entry = getEntryById(entryId);
      const contact = getContactForEntry(entry);
      openModal({
        title:'Ficha do paciente',
        sub:`${contact?.name || entry?.name || 'Lead'} • plano de tratamento, valores e odontograma`,
        bodyHTML:'<div id="fichaApp" style="width:100%"></div>',
        footHTML:`<button class="btn" onclick="printFicha('${escapeHTML(String(entryId))}')">🖨️ Imprimir ficha</button><button class="btn" onclick="closeModal()">Fechar</button>`,
        onMount: renderFichaApp,
        maxWidth:'min(99vw, 1880px)',
        width:'min(99vw, 1880px)'
      });
    };

    window.CRONOS_OPEN_FICHA_BTN = function(ev, entryId){
      try{
        if(ev){
          ev.preventDefault?.();
          ev.stopPropagation?.();
        }
      }catch(_){}
      if(!entryId) return false;
      window.openFicha && window.openFicha(entryId);
      return false;
    };

    if(!window.__CRONOS_FICHA_BUTTON_DELEGATE_BOUND__){
      window.__CRONOS_FICHA_BUTTON_DELEGATE_BOUND__ = true;
      document.addEventListener('click', function(ev){
        const btn = ev.target?.closest?.('[data-ficha-entry]');
        if(!btn) return;
        const id = btn.getAttribute('data-ficha-entry');
        if(!id) return;
        if(document.getElementById('fichaApp')) return;
        window.openFicha && window.openFicha(id);
      }, true);
    }

    window.printFicha = function(entryId){
      const entry = getEntryById(entryId);
      if(!entry) return toast('Ficha', 'Lead não encontrado.');
      const db = loadDB();
      const actor = currentActor();
      const contact = getContactForEntry(entry);
      const ficha = ensureFicha(entry);
      const totals = calcFichaTotals(ficha.plano || [], entry);
      const branding = getClinicBranding(db, actor);
      const clinicName = escapeHTML(getClinicDisplayName(db, actor));
      const patientName = escapeHTML(contact?.name || entry?.name || 'Paciente');
      const patientPhone = escapeHTML(contact?.phone || entry?.phone || '—');
      const patientCpf = escapeHTML(formatCPF(contact?.cpf || '') || '—');
      const patientBirthAge = escapeHTML(birthWithAgeLabel(contact?.birthDate || '') || '—');
      const patientCity = escapeHTML(entry?.city || '—');
      const patientTreatment = escapeHTML(entry?.treatment || '—');
      const obs = escapeHTML(String(ficha?.observacoes || entry?.obs || '').trim() || '');
      const upper = [...TOOTH_ROWS.supDir, ...TOOTH_ROWS.supEsq];
      const lower = [...TOOTH_ROWS.infDir, ...TOOTH_ROWS.infEsq];
      function overlayBoxes(list, y){
        return list.map((tooth, i)=>`<div class="box ${getToothVisualState(entry, tooth)}" style="left:${__odontoBoxLeftPct(tooth, i)}%; top:${y}%">${tooth}</div>`).join('');
      }

      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha - ${patientName}</title>
        <style>
          body{font-family:Arial,sans-serif;padding:24px;color:#111;margin:0}
          .sheet{border:1px solid #d7dde7;padding:22px 24px 28px}
          .head{display:grid;grid-template-columns:120px 1fr 220px;gap:16px;align-items:center;border-bottom:2px solid #111;padding-bottom:14px}
          .logo{width:140px;height:84px;display:flex;align-items:center;justify-content:flex-start;text-align:center;font-size:12px;font-weight:700}
          .logo img{width:auto;height:76px;max-width:140px;display:block;object-fit:contain}
          .title{text-align:center}.title h2{margin:0;font-size:24px;letter-spacing:.05em}.title p{margin:6px 0 0;font-size:12px;color:#444;letter-spacing:.08em}
          .meta{text-align:right;font-size:12px;line-height:1.7}
          .patient{margin-top:12px;display:grid;grid-template-columns:1.3fr .9fr .9fr 1fr 1fr;gap:10px}
          .field{border:1px solid #111;min-height:45px;padding:7px 10px}.field .lbl{display:block;font-size:10px;color:#444;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px}.field .val{font-size:14px;font-weight:700}
          .sectionTitle{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px}
          .boxWrap{border:1.5px solid #111;padding:10px}
          .odonto{position:relative;width:100%;aspect-ratio:1536/740;border:1px solid #cfd7e3;border-radius:10px;overflow:hidden;background:#eef1f5}
          .odonto img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
          .overlay{position:absolute;inset:0}
          .box{position:absolute;width:34px;height:34px;border-radius:999px;border:2px solid transparent;background:rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#111827;transform:translate(-50%,0)}
          .box.paid,.box.plan,.box.closed{background:#ffd400;border-color:#b7791f;color:#111827}.box.done{background:#16a34a;border-color:#166534;color:#fff}.box.absent{background:#dc2626;border-color:#991b1b;color:#fff}
          .legend{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:#555}.legend span{display:inline-flex;align-items:center;gap:6px;border:1px solid #ddd;padding:5px 9px;border-radius:999px}
          .chip{width:10px;height:10px;border-radius:999px;display:inline-block}.cp1{background:#ffd400}.cp2{background:#16a34a}.cp3{background:#dc2626}
          table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #111;padding:6px 7px;vertical-align:top}th{background:#f5f5f5;font-size:10px;text-transform:uppercase;letter-spacing:.08em;text-align:left}td.center{text-align:center}td.right{text-align:right}tr.done td{background:#bbf7d0}tr.paid td{background:#fef08a}tr.absent td{background:#fecaca}tr.closed td{background:#fef08a}
          .summary{border-top:1.5px solid #111;margin-top:auto;display:grid;grid-template-columns:repeat(5,1fr)}.sum{border-right:1px solid #111;padding:8px 9px;min-height:62px}.sum:last-child{border-right:none}.sum .lbl{font-size:10px;text-transform:uppercase;color:#444;font-weight:800;letter-spacing:.06em;margin-bottom:6px}.sum .val{font-size:16px;font-weight:800}
          .obs{margin-top:14px;border:1.5px solid #111;padding:10px;page-break-inside:auto}.obsText{margin-top:8px;line-height:1.45;font-size:13px;white-space:pre-wrap;word-break:break-word}
          .foot{margin-top:16px;font-size:11px;color:#333}
          @media print{body{padding:0}.sheet{border:none}tr.done td{background:#bbf7d0 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}tr.paid td,tr.closed td{background:#fef08a !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}tr.absent td{background:#fecaca !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.box.paid,.box.plan,.box.closed,.box.done,.box.absent{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
        </style></head><body>
        <div class="sheet">
          <div class="head">
            <div class="logo">${branding?.logoDataUri ? `<img src="${branding.logoDataUri}" alt="${clinicName}">` : `${clinicName}`}</div>
            <div class="title"><h2>FICHA DE AVALIAÇÃO</h2><p>PLANO DE TRATAMENTO / ODONTOGRAMA</p></div>
            <div class="meta">Data: ${fmtBR(todayISO())}<br>Lead: ${escapeHTML(String(entry.id || '—'))}<br>Tratamento: ${patientTreatment}</div>
          </div>
          <div class="patient">
            <div class="field"><span class="lbl">Paciente</span><span class="val">${patientName}</span></div>
            <div class="field"><span class="lbl">Telefone</span><span class="val">${patientPhone}</span></div>
            <div class="field"><span class="lbl">CPF</span><span class="val">${patientCpf}</span></div>
            <div class="field"><span class="lbl">Nascimento</span><span class="val">${patientBirthAge}</span></div>
            <div class="field"><span class="lbl">Cidade</span><span class="val">${patientCity}</span></div>
          </div>

          <div class="boxWrap" style="margin-top:16px">
            <div class="sectionTitle">Odontograma</div>
            <div class="odonto"><img src="${ODONTO_BASE_LIGHT}" alt="Odontograma"><div class="overlay">${overlayBoxes(upper, 8.5)}${overlayBoxes(lower, 82.5)}</div></div>
            <div class="legend"><span><i class="chip cp1"></i>Pago</span><span><i class="chip cp2"></i>Realizado</span><span><i class="chip cp3"></i>Perda dentária / ausente</span></div>
          </div>

          <div style="border:1.5px solid #111;display:flex;flex-direction:column;margin-top:16px">
            <table>
              <thead><tr><th>Nº</th><th>Procedimento</th><th>Dente</th><th>Face</th><th>Tabela</th><th>Fechado</th><th>Pago</th></tr></thead>
              <tbody>${ficha.plano.length ? ficha.plano.map((item, idx)=>`<tr class="${getItemVisualState(entry, item)}"><td class="center">${idx+1}</td><td>${escapeHTML(item.procedimento || '')}</td><td class="center">${escapeHTML(item.dente || '—')}</td><td class="center">${escapeHTML(item.face || '—')}</td><td class="right">${moneyBR(item.valorBase || 0)}</td><td class="right">${moneyBR(item.valorFechado || 0)}</td><td class="right">${item.pago ? moneyBR(item.valorFechado || 0) : moneyBR(0)}</td></tr>`).join('') : `<tr><td colspan="7">Nenhum item cadastrado.</td></tr>`}</tbody>
            </table>
            <div class="summary">
              <div class="sum"><div class="lbl">Valor tabela</div><div class="val">${moneyBR(totals.totalBase)}</div></div>
              <div class="sum"><div class="lbl">Valor fechado</div><div class="val">${moneyBR(totals.totalFechado)}</div></div>
              <div class="sum"><div class="lbl">Desconto</div><div class="val">${moneyBR(totals.totalDesconto)}</div></div>
              <div class="sum"><div class="lbl">Desconto %</div><div class="val">${totals.descontoPct.toFixed(2)}%</div></div>
              <div class="sum"><div class="lbl">Valor pago</div><div class="val">${moneyBR(totals.totalPago)}</div></div>
            </div>
          </div>

          <div class="obs"><div class="sectionTitle">Observações</div><div class="obsText">${obs || '—'}</div></div>
          <div class="foot"><div>Documento gerado pelo Cronos</div></div>
        </div>
        </body></html>`;

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.setAttribute('aria-hidden', 'true');
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow.document;
      doc.open();
      doc.write(html);
      doc.close();

      let printed = false;
      const triggerPrint = ()=>{
        if(printed) return;
        printed = true;
        try{
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        }catch(e){
          console.error('printFicha/iframe', e);
          toast('Impressão', 'Não foi possível abrir a impressão da ficha.');
        }
      };
      const cleanup = ()=> setTimeout(()=>{ try{ iframe.remove(); }catch(_){ } }, 800);

      iframe.onload = ()=>{
        setTimeout(triggerPrint, 600);
      };
      try{ iframe.contentWindow.onafterprint = cleanup; }catch(_){}
      setTimeout(triggerPrint, 1200);
      setTimeout(cleanup, 5000);
    };

    function enhanceLeadCardsWithFichaButtons(){
      qsa('#leadsCards .leadCard').forEach(card=>{
        const row = card.querySelector('.leadActionsRow');
        if(!row || row.querySelector('.btnFicha')) return;
        const refBtn = row.querySelector('button[onclick*="openLeadEntry"]');
        if(!refBtn) return;
        const m = String(refBtn.getAttribute('onclick') || '').match(/openLeadEntry\('([^']+)'\)/);
        if(!m || !m[1]) return;
        const btn = document.createElement('button');
        btn.className = 'iconBtn btnFicha cronos-action-ficha';
        btn.title = 'Ficha';
        btn.innerHTML = `<svg class="cronos-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="3" width="16" height="18" rx="3"></rect><path d="M8 8h8"></path><path d="M8 12h8"></path><path d="M8 16h5"></path></svg>`;
        btn.onclick = ()=>openFicha(m[1]);
        row.insertBefore(btn, row.firstChild);
      });
    }

    const __origRenderSettings_ficha = typeof renderSettings === 'function' ? renderSettings : null;
    if(__origRenderSettings_ficha){
      renderSettings = function(){
        const out = __origRenderSettings_ficha.apply(this, arguments);
        try{ injectBrandingSettingsCard(); }catch(e){ console.error('Branding/settings', e); }
        try{ injectProcedureSettingsCard(); }catch(e){ console.error('Procedimentos/settings', e); }
        return out;
      };
    }
    const __origRenderLeadsTable_ficha = typeof renderLeadsTable === 'function' ? renderLeadsTable : null;
    if(__origRenderLeadsTable_ficha){
      renderLeadsTable = function(){
        const out = __origRenderLeadsTable_ficha.apply(this, arguments);
        try{ enhanceLeadCardsWithFichaButtons(); }catch(e){ console.error('Ficha/leads', e); }
        return out;
      };
    }

    injectFichaStyles();
    ensureProcedureCatalogSeeded();
    setTimeout(()=>{
      try{ injectBrandingSettingsCard(); }catch(_){ }
      try{ injectProcedureSettingsCard(); }catch(_){ }
      try{ enhanceLeadCardsWithFichaButtons(); }catch(_){ }
    }, 50);
  }catch(err){
    console.error('Falha ao iniciar módulo de ficha/prontuário:', err);
  }
})();
