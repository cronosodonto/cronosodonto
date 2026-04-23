// ===== SAFE PATCH: debounce fallback =====
function debounce(fn, delay){
  let t;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(()=>fn.apply(this,args), delay||300);
  };
}
// ==========================================

(function(){
  // Error handler:
  // - BEFORE boot: show auth fallback + message.
  // - AFTER boot: keep the current screen, only show a toast with the error (não derruba a sessão).
  function showToast(title, message, type = 'info') {
    // Produção: sem notificações visuais (evita "tag" no canto).
    try {
      const prefix = type ? `[${String(type).toUpperCase()}]` : '[INFO]';
      console.log(prefix, title || '', message || '');
    } catch (e) {}
  }

  function fallbackBeforeBoot(msg){
    try{
      var a=document.getElementById('authView');
      var b=document.getElementById('appView');
      if(a) a.classList.remove('hidden');
      if(b) b.classList.add('hidden');
      showToast(msg || 'Falha ao iniciar.');
    }catch(e){}
  }

  function handleErr(msg){
    // If already booted, do NOT change screens—just report.
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

  // If nothing shows after 1s, force auth visible (only if not booted).
  setTimeout(function(){
    if(window.__CRONOS_BOOTED) return;
    var a=document.getElementById('authView');
    var b=document.getElementById('appView');
    if(a && b && a.classList.contains('hidden') && b.classList.contains('hidden')){
      fallbackBeforeBoot('Boot não exibiu nenhuma tela (fallback automático).');
    }
  }, 1000);
})();

/* =========================
   Parcelamentos (v20+)
   - guarda por entry.installPlan + entry.installments[]
   - lista por paciente no view-installments
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
  // keep day stable-ish (JS auto rolls)
  return isoDate(dt);
}
function monthKeyOf(iso){ return (iso||"").slice(0,7); }

function ensureInstallmentsForEntry(entry){
  // garante que exista um "plano" + parcelas geradas (compat v20)
  entry.installments = entry.installments || [];

  // Se tem plano mas ainda não tem parcelas, gera agora
  if(entry.installPlan && (!Array.isArray(entry.installments) || entry.installments.length===0)){
    try{ buildInstallments(entry); }catch(e){ console.warn("buildInstallments falhou:", e); }
  }

  // Normaliza chaves legadas e status
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
    // Se já pagou, força status
    if(p.paidAt && p.status!=="PAGA") p.status="PAGA";
  });
}

function buildInstallments(entry){
  // uses entry.installPlan
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

function syncInstallmentTasks(db, actor){
  // cria/atualiza tarefas de inadimplência (apenas para atrasos)
  const today = todayISO();
  const masterId = actor?.masterId;
  if(!masterId) return;

  const contactsById = new Map((db.contacts||[]).filter(c=>c.masterId===masterId).map(c=>[c.id,c]));
  const entries = (db.entries||[]).filter(e=>e.masterId===masterId);
db.tasks = (db.tasks || []).filter(t => {
  return !(
    t.id?.includes("INST") ||
    t.type === "installment" ||
    t.desc?.includes("Parcela")
  );
});

const tasks = db.tasks;
  
  function taskKey(entryId, dueDate, number){
    return `INST:${entryId}:${dueDate}:${number}`;
  }

  // mark all existing installment tasks as not seen; we'll reconcile
  const seen = new Set();

  entries.forEach(e=>{
    if(!e.installPlan) return;
    ensureInstallmentsForEntry(e);
    (e.installments||[]).forEach(p=>{
      const due = p.dueDate;
      const isPaid = !!p.paidAt || p.status==="PAGA";
      const isLate = due && new Date(due) < new Date(today) && !isPaid;
      if(!isLate && !isPaid) return;

      const key = taskKey(e.id, due, p.number);
      seen.add(key);

      let t = tasks.find(x=>x.masterId===masterId && x.key===key);
      const c = contactsById.get(e.contactId) || {name:"(sem nome)", phone:""};
      const title = `Inadimplente: ${c.name} • Parcela ${p.number}/${p.total}`;
      const desc = `Venc: ${fmtBR(due)} • ${moneyBR(p.amount)} • ${p.payMethod||e.installPlan.payMethod||"—"}`;
      if(!t){
        t = { id: uid("t"), masterId, key, entryId: e.id, title, action:"WhatsApp", notes: desc, done:false, createdAt:new Date().toISOString(), dueDate: due, phone:c.phone, wa: true };
        tasks.push(t);
      }else{
        t.title = title;
        t.notes = desc;
        if(!t.action) t.action = "WhatsApp";
        if(!t.entryId) t.entryId = e.id;
        t.dueDate = due;
        t.phone = c.phone;
        t.done = isPaid;
      }
    });
  });

  // optional: we don't delete tasks, just keep.
}

function installmentsKPIs(db, actor, monthKey){
  const today = todayISO();
  const masterId = actor?.masterId;
  const entries = (db.entries||[]).filter(e=>e.masterId===masterId && e.installPlan);
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

function renderInstallmentsView(){
  const actor = currentActor();
  if(!actor){ showAuth(); return; }
  const db = loadDB();

  (db.tasks||[]).forEach(t=>{
    if(!t.masterId) t.masterId = actor.masterId;
    if(!t.entryId && typeof t.key==="string" && t.key.startsWith("INST:")){
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

  const k = installmentsKPIs(db, actor, mk);
  el("kpiInstMonth").textContent = moneyBR(k.monthSum);
  el("kpiInstMonthN").textContent = `${k.monthN} parcelas`;
  el("kpiInstLate").textContent = moneyBR(k.lateSum);
  el("kpiInstLateN").textContent = `${k.lateN} parcelas`;
  el("kpiInstFuture").textContent = moneyBR(k.futureSum);
  el("kpiInstFutureN").textContent = `${k.futureN} parcelas`;

  const pill = el("pillInst");
  if(pill) pill.textContent = String(k.lateN || 0);

  const contactsById = new Map((db.contacts||[]).filter(c=>c.masterId===actor.masterId).map(c=>[c.id,c]));
  const entries = (db.entries||[]).filter(e=>e.masterId===actor.masterId && e.installPlan);

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

    const monthInstallments = (e.installments||[]).filter(p=>p?.dueDate && monthKeyOf(p.dueDate)===mk);
    if(!monthInstallments.length) return;

    let monthPaidSum=0, monthPendingSum=0, monthLateSum=0, monthFutureSum=0;
    let monthPaidCount=0, monthPendingCount=0, monthLateCount=0, monthFutureCount=0;

    monthInstallments.forEach(p=>{
      const paid = !!p.paidAt || p.status === "PAGA";
      if(paid){
        monthPaidSum += parseMoney(p.amount);
        monthPaidCount++;
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
    const aDate = (A.monthInstallments[0]?.dueDate || "9999-99-99");
    const bDate = (B.monthInstallments[0]?.dueDate || "9999-99-99");
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

  if(!rows.length){
    list.innerHTML = `<div class="muted">Nenhum parcelamento encontrado para o mês e filtro selecionados.</div>`;
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
      const paid = !!p.paidAt || p.status === "PAGA";
      const late = !paid && p.dueDate && p.dueDate < today;
      const statusChip = paid
        ? `<span class="badge ok">PAGA</span>`
        : late
          ? `<span class="badge late">ATRASADA</span>`
          : `<span class="badge pending">PENDENTE</span>`;
      return `<div class="chip">${p.number}/${p.total} • ${fmtBR(p.dueDate)} • <b>${moneyBR(p.amount)}</b> ${statusChip}</div>`;
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
            <button class="btn danger" onclick="deleteInstallmentPlan('${e.id}')">Excluir</button>
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

  list.innerHTML = cardsHtml + pagerHtml;

  try{
    window.__instOpen = window.__instOpen || {};
    Object.keys(window.__instOpen).forEach(id=>{
      const rr = el(`instrow_${id}`);
      if(rr && window.__instOpen[id]) rr.classList.add("open");
      updateInstallmentToggleLabel(id);
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
  const pmDefault = entry.installPlan?.payMethod || "";
  const rows = (entry.installments||[]).map(p=>{
    const paid = !!p.paidAt || p.status==="PAGA";
    const late = !paid && p.dueDate && p.dueDate < today;
    const st = paid ? `<span class="badge ok">PAGO</span>` : (late ? `<span class="badge late">ATRASADO</span>` : `<span class="badge pending">PENDENTE</span>`);
    const action = paid
      ? `<a class="miniLink" href="javascript:void(0)" onclick="undoInstallmentPay('${entry.id}', ${p.number})">Desfazer</a>`
      : `<button class="btn ok" onclick="payInstallment('${entry.id}', ${p.number})">Dar baixa</button>`;
    const wa = !paid ? `<a class="miniLink" href="${waChargeLink(contact.phone, contact.name, entry, p)}" target="_blank">Cobrar</a>` : "";
    return `
      <tr>
        <td class="mono">${p.number}/${p.total}</td>
        <td class="mono">${p.dueDate?fmtBR(p.dueDate):"—"}</td>
        <td class="mono">${moneyBR(p.amount)}</td>
        <td>${escapeHTML(p.payMethod||pmDefault||"—")}</td>
        <td>${st} ${p.paidAt?`<div class="muted" style="font-size:12px">em ${fmtBR(p.paidAt)}</div>`:""}</td>
        <td style="white-space:nowrap; display:flex; gap:10px; align-items:center; flex-wrap:wrap">${action} ${wa} <button class="miniBtn danger" onclick="deleteInstallment('${entry.id}', ${p.number})" title="Excluir parcela">🗑️</button></td>
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

function payInstallment(entryId, number){
  window.__instOpen = window.__instOpen || {};
  window.__instOpen[entryId] = true;
  const actor = currentActor();
  const db = loadDB();
  const entry = (db.entries||[]).find(e=>e.id===entryId);
  if(!entry) return toast("Erro", "Entrada não encontrada");
  ensureInstallmentsForEntry(entry);
  const p = (entry.installments||[]).find(x=>x.number===number);
  if(!p) return toast("Erro", "Parcela não encontrada");
  if(p.paidAt || p.status==="PAGA") return toast("Já foi", "Essa parcela já está baixada.");
  const payDate = todayISO();
  p.paidAt = payDate;
  p.status = "PAGA";

  // soma no valuePaid
  entry.valuePaid = parseMoney(entry.valuePaid) + parseMoney(p.amount);
  entry.valueClosed = (entry.status==="Fechou") ? entry.valuePaid : null;

  // registra pagamento no caixa (opcional)
  db.payments = db.payments || [];
  db.payments.push({ id: uid("p"), masterId: actor.masterId, entryId, contactId: entry.contactId, at: new Date().toISOString(), date: payDate, value: p.amount, method: p.payMethod || entry.installPlan?.payMethod || "", desc: `Parcela ${p.number}/${p.total}` });

  saveDB(db);
  toast("Baixa feita ✅", `Parcela ${number}/${p.total} • ${moneyBR(p.amount)}`);
  // re-sync tasks + rerender
  try {
  syncInstallmentTasks(db, actor);
  saveDB(db);
} catch {}
  renderAll();
}

function undoInstallmentPay(entryId, number){
  const actor = currentActor();
  const db = loadDB();
  const entry = (db.entries||[]).find(e=>e.id===entryId);
  if(!entry) return toast("Erro", "Entrada não encontrada");
  ensureInstallmentsForEntry(entry);
  const p = (entry.installments||[]).find(x=>x.number===number);
  if(!p) return toast("Erro", "Parcela não encontrada");
  if(!(p.paidAt || p.status==="PAGA")) return toast("Nada a desfazer", "Essa parcela não está paga.");
  // remove payment record (best effort)
  const amt = parseMoney(p.amount);
  entry.valuePaid = Math.max(0, parseMoney(entry.valuePaid) - amt);
  p.paidAt = "";
  p.status = "PENDENTE";
  // remove one matching payment
  db.payments = db.payments || [];
  const idx = db.payments.findIndex(x=>x.entryId===entryId && x.value===amt && (x.desc||"").includes(`Parcela ${number}/`));
  if(idx>=0) db.payments.splice(idx,1);

  saveDB(db);
  toast("Baixa desfeita", `Parcela ${number}/${p.total} voltou para pendente.`);
  try{ syncInstallmentTasks(db, actor); saveDB(db);}catch{}
  setTimeout(() => {
  if (typeof renderAll === "function") renderAll();
}, 50);
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
  if(!actor?.perms?.edit) return toast("Sem permissão");
  const db = loadDB();
  const entry = (db.entries||[]).find(e=>e.id===entryId);
  if(!entry || !entry.installPlan) return toast("Parcelamento não encontrado");
  ensureInstallmentsForEntry(entry);
  const contact = (db.contacts||[]).find(c=>c.id===entry.contactId);
  const totalParcelas = (entry.installments||[]).length;
  if(!confirm(`Excluir todo o parcelamento de ${contact?.name || 'este paciente'}?

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

/* Hook renderAll to also render installments safely */
const __renderAll = typeof renderAll === "function" ? renderAll : function(){};
renderAll = function(){
  try{
    const actor = currentActor();
    const db = loadDB();
    // ensure installments normalized
    (db.entries||[]).forEach(e=>{ if(e.installPlan){ ensureInstallmentsForEntry(e); }});
    if(actor) { try{ syncInstallmentTasks(db, actor); }catch{} saveDB(db); }
  }catch(e){}
  __renderAll();
  try{
    if(qs('[data-view="installments"].active')) renderInstallmentsView();
  }catch(e){}
};

// Ensure view switch triggers render
const __showView = typeof showView === "function" ? showView : function(){};
showView = function(view){
  if(typeof setActiveView === "function"){
    setActiveView(view);
  }else{
    __showView(view);
  }

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

// Bind filters events on DOM ready
document.addEventListener("DOMContentLoaded", ()=>{
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

// Status groups for dashboard math
const POSITIVE = new Set(["Agendado","Compareceu","Fechou","Remarcou","Conversando","Concluído"]);
const DISQUALIFIED = new Set(["Número incorreto","Achou caro","Não tem interesse","Mora longe","Mora em outra cidade","Fechou em outro lugar","Msg não entregue","Mensagem não entregue"]);
// Permissions
const APP_VIEWS = ["dashboard","leads","kanban","tasks","installments","users","settings"];

const PERMS = {
  // MASTER (secundário): acesso alto, mas NÃO pode criar/remover outros masters
  MASTER:     {viewAll:true, edit:true, delete:true, manageUsers:true, manageMasters:false, views:[...APP_VIEWS]},
  GERENTE:    {viewAll:true, edit:true, delete:true, manageUsers:false, manageMasters:false, views:["dashboard","leads","kanban","tasks","installments"]},
  SECRETARIA: {viewAll:true, edit:true, delete:true, manageUsers:false, manageMasters:false, views:["dashboard","leads","kanban","tasks","installments"]},
  DENTISTA:   {viewAll:true, edit:false, delete:false, manageUsers:false, manageMasters:false, views:["dashboard","leads","kanban"]},
};

function actorAllowedViews(actor=currentActor()){
  if(!actor) return [...APP_VIEWS];
  const views = Array.isArray(actor?.perms?.views) && actor.perms.views.length ? actor.perms.views : ["dashboard"];
  return [...new Set(views.filter(v=>APP_VIEWS.includes(v)))];
}
function canAccessView(view, actor=currentActor()){
  return actorAllowedViews(actor).includes(view);
}
function firstAllowedView(actor=currentActor()){
  return actorAllowedViews(actor)[0] || "dashboard";
}
function applyRoleVisibility(actor=currentActor()){
  APP_VIEWS.forEach(view=>{
    const btn = qs(`.nav button[data-view="${view}"]`);
    if(btn) btn.classList.toggle("hidden", !canAccessView(view, actor));
  });

  const canEdit = !!actor?.perms?.edit;
  const canUsers = canAccessView("users", actor) && !!actor?.perms?.manageUsers;
  const canSettings = canAccessView("settings", actor);

  ["btnNewLeadSide","btnNewLeadTop","btnNewLeadList","btnNewLeadKanban","btnNewTask"].forEach(id=>{
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

const el = (id)=>document.getElementById(id);
const qs = (sel,root=document)=>root.querySelector(sel);
const qsa = (sel,root=document)=>Array.from(root.querySelectorAll(sel));

  // Safe value readers (avoid null.value crashes when elements are not present in current view)
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

/* -------- Theme -------- */
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
}
function setThemeIcons(icon){
  const a = el("themeToggle"); const b = el("themeToggleAuth");
  if(a) a.innerHTML = `<small>${icon}</small>`;
  if(b) b.innerHTML = `<small>${icon}</small>`;
}
function toggleTheme(){
  const cur = localStorage.getItem(THEMEKEY) || "dark";
  applyTheme(cur === "dark" ? "light" : "dark");
}

/* -------- DB shape --------
db = {
  masters: [{id,name,email,passHash,createdAt}],
  users: [{id,masterId,name,username,email,passHash,role,createdAt}],
  contacts: [{id, masterId, name, phone, firstSeenAt, lastSeenAt}],
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

async function flushCloudSave(dbToSave){
  const user = await getCurrentSupabaseUser();
  if(!user) return false;

  const ctx = await applyCloudAccessContext(user);
  const ownerEmail = String(ctx?.ownerEmail || user.email || "").trim().toLowerCase();

  let normalized = ensureMasterRecordByEmail(normalizeDBShape(dbToSave || DB || freshDB()), ownerEmail);
  if(CLOUD_MEMBER_INFO){
    normalized = ensureMemberMirror(normalized, CLOUD_MEMBER_INFO);
  }

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
  if(typeof supabaseClient === "undefined" || !supabaseClient?.auth) return;
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
    run();
    return;
  }
  __cloudSaveTimer = setTimeout(run, 650);
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

  if(options.skipCloud) return;
  scheduleCloudSave(!!options.immediate);
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
    let db = await ensureCloudDBLoaded(true);
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

  let db = await ensureCloudDBLoaded(true);

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
    saveDB(db);
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
  // If already has country code 55, keep; else assume BR.
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
  // robust for file:// + localhost
  try{
    if (window.crypto?.subtle){
      const enc = new TextEncoder().encode(p);
      const buf = await crypto.subtle.digest("SHA-256", enc);
      return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
    }
  }catch(e){}
  // fallback FNV-1a
  let h = 2166136261;
  for (let i=0;i<p.length;i++){ h ^= p.charCodeAt(i); h = Math.imul(h, 16777619); }
  return "fnv1a_" + (h>>>0).toString(16);
}

/* -------- Auth -------- */
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
    // Reseta qualquer loading de login antes de esconder os campos,
    // para não reexibir a UI logo em seguida.
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
  // refreshAuthMasters();
  syncThemeButtons();
  window.__CRONOS_BOOTED = true;
}

function showApp(actor){
  window.__CRONOS_ACCESS_BLOCK__ = null;
  setSupportEntryLoading(false);
  el("authView").classList.add("hidden");
  el("appView").classList.remove("hidden");
  hideAccessGate();
  el("brandName").textContent = "CRONOS ODONTO";
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

/* -------- Filters (persist across views) -------- */
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
    // backward compatibility: migrate old fields into new ones
    const out = {...def, ...parsed};
    if(!out.year){
      const mk = String(out.monthKey||def.monthKey);
      out.year = mk && mk!=="all" ? mk.slice(0,4) : def.year;
    }
    // old filters: first/appt -> period (keep only if new empty)
    if(!out.periodFrom && (parsed.firstFrom||parsed.apptFrom)) out.periodFrom = parsed.firstFrom || parsed.apptFrom || "";
    if(!out.periodTo && (parsed.firstTo||parsed.apptTo)) out.periodTo = parsed.firstTo || parsed.apptTo || "";
    if(!out.order) out.order = "recent";
    // default seguro: evitar abrir o sistema preso em "Todos"
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

  // keep selection
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

  // keep selection: prefer saved monthKey if matches selectedYear
  const f = loadFilters ? loadFilters() : {};
  const desiredMk = (getUIFilters()?.monthKey) || f.monthKey || currentMonthKey;

  let finalMk = desiredMk;
  if(finalMk !== "all"){
    const y = String(finalMk).slice(0,4);
    if(Number(y)!==selectedYear){
      // if current year, select current month; otherwise default to "all"
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

/* -------- Data access -------- */
function filteredEntries(){
  const db = loadDB();
  const actor = currentActor();
  if(!actor) return [];
  const f = getUIFilters();
  const search = (f.search||"").toLowerCase();

  const periodFrom = parseISO(f.periodFrom);
  const periodTo = parseISO(f.periodTo);

  function inRangeISO(d, a, b){
    if(!d) return false;
    const dt = parseISO(d);
    if(a && dt < a) return false;
    if(b && dt > b) return false;
    return true;
  }

  // pick ONE "reference date" for the unified period filter
  function entryRefDate(e){
    return e.firstContactAt || e.apptDate || e.createdAt || e.updatedAt || (e.monthKey ? (String(e.monthKey).slice(0,7) + "-01") : "");
  }

  const rows = (db.entries||[])
    .filter(e=>e.masterId===actor.masterId)
    .filter(e=>{
      // month filter: specific month vs "all"
      if(f.monthKey && f.monthKey !== "all"){
        return e.monthKey === f.monthKey;
      }
      // "Todos": keep year selectable
      const y = String(e.monthKey||"").slice(0,4);
      if(f.year && y !== String(f.year)) return false;

      // apply unified period if provided
      if(f.periodFrom || f.periodTo){
        return inRangeISO(entryRefDate(e), periodFrom, periodTo);
      }
      return true;
    })
    .filter(e=> !f.status || e.status===f.status)
    .filter(e=>{
      if(!f.campaign) return true;
      const inCampaign = Array.isArray(e?.tags) && e.tags.includes("Campanha");
      return f.campaign === "yes" ? inCampaign : !inCampaign;
    })
    .filter(e=> !f.treatment || e.treatment===f.treatment)
    .filter(e=> !f.origin || e.origin===f.origin)
    .filter(e=>{
      if(!search) return true;
      const c = (db.contacts||[]).find(x=>x.id===e.contactId);
      const hay = [
        c?.name, c?.phone, e.city, e.notes, e.originOther, e.treatmentOther,
        e.status, e.origin, e.treatment, ...(e.tags||[])
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(search);
    });

  // sort
  try{
    const order = f.order || "recent";
    const contactsById = new Map((db.contacts||[]).map(c=>[String(c.id), c]));
    const nameOf = (e)=> (contactsById.get(String(e.contactId||""))?.name || "").toLowerCase();
    const dateOf = (e)=> parseISO(entryRefDate(e)) || new Date(0);

    if(order==="recent") rows.sort((a,b)=> dateOf(b) - dateOf(a));
    else if(order==="old") rows.sort((a,b)=> dateOf(a) - dateOf(b));
    else if(order==="az") rows.sort((a,b)=> nameOf(a).localeCompare(nameOf(b)));
    else if(order==="za") rows.sort((a,b)=> nameOf(b).localeCompare(nameOf(a)));
  }catch(_){}

  // KPI clicável: quando ativo, aplica o bucket na lista/kanban
  try{
    const k = window.__KPI_ACTIVE;
    if(k && k!=="total") return __kpiBucket(k, rows);
  }catch(_){ }
  return rows;
}


function getContact(contactId){
  const db = loadDB();
  return db.contacts.find(c=>c.id===contactId) || null;
}

/* -------- UI Render -------- */
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
  return (e && e.valueBudget!=null && !isNaN(Number(e.valueBudget)))
    ? Number(e.valueBudget)
    : ((e && e.valueEstimated!=null && !isNaN(Number(e.valueEstimated))) ? Number(e.valueEstimated) : 0);
}
function getEntryPaidValue(e){
  return (e && e.valuePaid!=null && !isNaN(Number(e.valuePaid)))
    ? Number(e.valuePaid)
    : ((e && e.valueClosed!=null && !isNaN(Number(e.valueClosed))) ? Number(e.valueClosed) : 0);
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

  const entryKey = (obj)=>{
    const entryId = String(obj?.entryId || obj?.id || "").trim();
    if(entryId) return `entry:${entryId}`;
    const contactId = String(obj?.contactId || "").trim();
    if(contactId) return `contact:${contactId}`;
    return "";
  };

  function computeMonthData(monthKey, monthRows){
    const daysInMonth = new Date(Number(monthKey.slice(0,4)), Number(monthKey.slice(5,7)), 0).getDate();
    const grossSeries = Array.from({length: daysInMonth}, ()=>0);
    const receivedSeries = Array.from({length: daysInMonth}, ()=>0);
    const isCurrentMonth = monthKey === currentMonthKey;
    const monthRowsSafe = (monthRows||[]).filter(e=>String(e?.monthKey||"")===monthKey);
    const monthPaymentsAll = getDashboardPaymentsForRows(db, actor, monthRowsSafe)
      .filter(p=>p.__iso.slice(0,7)===monthKey)
      .filter(p=>!(fromISO || toISO) || dashboardDateInRange(p.__iso, fromISO, toISO));

    (monthRowsSafe||[]).forEach(e=>{
      const budget = getEntryBudgetValue(e);
      if(!budget) return;
      const iso = getDashboardEntryDate(e);
      if(!iso || iso.slice(0,7)!==monthKey) return;
      if((fromISO || toISO) && !dashboardDateInRange(iso, fromISO, toISO)) return;
      const day = Number(iso.slice(8,10));
      if(day>=1 && day<=daysInMonth) grossSeries[day-1] += budget;
    });

    let monthPayments = monthPaymentsAll;
    if(isCurrentMonth) monthPayments = monthPayments.filter(p=>p.__iso <= todayISO);

    const keysWithPayment = new Set();
    monthPayments.forEach(p=>{
      const day = Number(String(p.__iso||"").slice(8,10));
      if(day>=1 && day<=daysInMonth) receivedSeries[day-1] += Number(p.value||0);
      const key = entryKey(p);
      if(key) keysWithPayment.add(key);
    });

    (monthRowsSafe||[]).forEach(e=>{
      const paid = getEntryPaidValue(e);
      if(!paid) return;
      const iso = getDashboardEntryDate(e);
      if(!iso || iso.slice(0,7)!==monthKey) return;
      if((fromISO || toISO) && !dashboardDateInRange(iso, fromISO, toISO)) return;
      if(isCurrentMonth && iso > todayISO) return;
      const key = entryKey(e);
      if(key && keysWithPayment.has(key)) return;
      const day = Number(iso.slice(8,10));
      if(day>=1 && day<=daysInMonth) receivedSeries[day-1] += paid;
    });

    return { grossSeries, receivedSeries };
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
      totalReceived: monthData.receivedSeries.reduce((sum,v)=>sum + (Number(v)||0), 0),
      titleText: "Receita (R$) por dia",
      hintText: "(bruto/orçado por dia • recebido por dia)"
    };
  }

  const selectedYear = String(filters?.year || currentYear);
  const labels = monthNamesShort.slice();
  const grossSeries = Array.from({length: 12}, ()=>0);
  const receivedSeries = Array.from({length: 12}, ()=>0);

  for(let monthIndex=0; monthIndex<12; monthIndex++){
    const monthKey = `${selectedYear}-${String(monthIndex+1).padStart(2,"0")}`;
    const monthRows = (rows||[]).filter(e=>String(e?.monthKey||"")===monthKey);
    const monthData = computeMonthData(monthKey, monthRows);
    grossSeries[monthIndex] = monthData.grossSeries.reduce((sum,v)=>sum + (Number(v)||0), 0);
    receivedSeries[monthIndex] = monthData.receivedSeries.reduce((sum,v)=>sum + (Number(v)||0), 0);
  }

  return {
    mode: "monthly",
    axisLabelPrefix: "Mês",
    labels,
    grossSeries,
    receivedSeries,
    totalReceived: receivedSeries.reduce((sum,v)=>sum + (Number(v)||0), 0),
    titleText: "Receita (R$) por mês",
    hintText: "(bruto/orçado por mês • recebido por mês)"
  };
}

function renderDashboard(){
  const rows = filteredEntries();
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

    byStatus.set(e.status, (byStatus.get(e.status)||0) + 1);
    byStatusValue.set(e.status, (byStatusValue.get(e.status)||0) + (open||0));

    totalBudget += (budget||0);
    if(open) totalOpen += open;
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

  // Ticket médio (orçado): média do orçamento no filtro (considera apenas leads com orçamento > 0, sem resgatados)
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

  // Robust render (grid)
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
        Clique em um status para filtrar os leads abaixo.
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




  // preview (max 10)
 const dashStatusActivePreview = getDashStatusFilter();
const sortedRows = rows
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

// charts
requestAnimationFrame(()=>renderDashboardCharts(rows));
}
function statusDotClass(status){
  const s = (status||"").trim();
  // cores inspiradas no layout de referência
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
      { name:"Recebido", values: revenueData.receivedSeries, color:"rgba(46,229,157,0.9)", fill:true },
      { name:"Bruto/Orçado", values: revenueData.grossSeries, color:"rgba(255,90,90,0.9)", dash:[6,6], fill:false }
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

  // fallback quando o canvas está dentro de seção recém-exibida (ou ainda sem layout)
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

  // axes
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = mutedColor;
  ctx.beginPath();
  ctx.moveTo(pad, top);
  ctx.lineTo(pad, h-pad);
  ctx.lineTo(w-10, h-pad);
  ctx.stroke();

  // line
  ctx.strokeStyle = "rgba(30,120,255,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v,i)=>{
    const x = pad + (i*(w-pad-10))/Math.max(1, values.length-1);
    const y = (h-pad) - ((v-minV)*(h-pad-top))/Math.max(1, (maxV-minV));
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();

  // labels (poucos pra não poluir)
  ctx.fillStyle = textColor || "1f2937";
  ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  const step = Math.ceil(labels.length/8);
  for(let i=0;i<labels.length;i+=step){
    const x = pad + (i*(w-pad-10))/Math.max(1, labels.length-1);
    ctx.fillText(labels[i], x-8, h-10);
  }
  // max value
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

  // series: [{name, values, color, dash?, fill?}]
  const {ctx,w,h} = clearCanvas(canvas);

  // Premium spacing
  const padL = 34;
  const padR = 18;
  const padB = 30;
  const topBase = 64; // legenda + respiro

  // y scale (dinâmica p/ evitar "linha reta")
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

  // grid (horizontal)
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
  // axis
  ctx.strokeStyle = axisColor;
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotTop);
  ctx.lineTo(plotLeft, plotBottom);
  ctx.lineTo(plotRight, plotBottom);
  ctx.stroke();
  ctx.restore();

  // helpers: smooth curve (Catmull-Rom -> Bezier)
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

  // draw series
  (series||[]).forEach((s, si)=>{
    const values = (s.values||[]).map(v=>Number(v)||0);
    if(values.length===0) return;

    // stroke
    ctx.save();
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = s.color || "rgba(30,120,255,0.9)";
    if(Array.isArray(s.dash)) ctx.setLineDash(s.dash); else ctx.setLineDash([]);

    const pts = drawSmoothPath(values);

    // soft shadow
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.stroke();

    // fill (only if requested)
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

    // points
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

  // x labels (few)
  ctx.save();
  ctx.fillStyle = labelColor;
  ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  const step = Math.ceil(labels.length/7);
  for(let i=0;i<labels.length;i+=step){
    const x = X(i, labels.length);
    ctx.fillText(labels[i], x-10, h-10);
  }

  // y max label (optional)
  if(opt.showMaxLabel !== false){
    ctx.fillStyle = labelColor;
    ctx.fillText((opt.yPrefix||"")+moneyBR(maxV).replace(/R\$\s*/,""), 10, 18);
  }
  ctx.restore();
// legend (more padding, wrap)
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
      // dashed hint
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

  // bind tooltip data
  try{
    canvas.__chartData = {
      type:"multiLine",
      labels: labels,
      series: (series||[]).map(s=>({
        name:s.name,
        values:(s.values||[]),
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
  // evita erro quando canvas está oculto/sem tamanho
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

  // axes
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, top);
  ctx.lineTo(pad, h-pad);
  ctx.lineTo(w-10, h-pad);
  ctx.stroke();

  // bars
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

  // bind tooltip data
  try{
    canvas.__chartData = { type:"bar", rects: rects };
    __bindChartHoverOnce(canvas);
  }catch(_){}

}

// === PAGINAÇÃO GLOBAL ===
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
  // Novo layout (cards) na aba Leads
  const cardsWrap = document.getElementById('leadsCards');
  const tbody = document.getElementById('leadsTbody'); // fallback antigo (se existir)
  const db = loadDB();
  const _contactsById = new Map((db.contacts||[]).map(c=>[String(c.id), c]));
  const _getContact = (cid)=> _contactsById.get(String(cid||''));

  const target = cardsWrap || tbody;
  if(!target) return;

  const fullList = Array.isArray(list) ? [...list] : [];

  // === PAGINAÇÃO ===
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

    // Prioridade (normalizada)
    const prioridadeRaw = (e.priority || e.prioridade || e.temperature || e.temperatura || e.temp || e.pri || '').toString().trim();
    let prioridade = prioridadeRaw;
    const priNorm = String(prioridadeRaw).trim().toLowerCase();
    if (priNorm === '2' || priNorm === 'hot' || priNorm === 'quente' || priNorm === 'q') prioridade = 'Quente';
    else if (priNorm === '1' || priNorm === 'warm' || priNorm === 'morno' || priNorm === 'm') prioridade = 'Morno';
    else if (priNorm === '0' || priNorm === 'cold' || priNorm === 'frio' || priNorm === 'f') prioridade = 'Frio';

    // fallback: prioridade via tag "Prioridade: X"
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

    // Ações
    const btnEdit  = `<button class="iconBtn" title="Abrir" onclick="openLeadEntry('${idAttr}')">✏️</button>`;
    const btnOk    = `<button class="iconBtn" title="Marcar OK" onclick="markOK('${idAttr}')">✅</button>`;
    const btnMsg   = `<button class="iconBtn" title="WhatsApp" onclick="openWhats('${idAttr}')">💬</button>`;
    const btnDel   = `<button class="iconBtn danger" title="Excluir" onclick="deleteLead('${idAttr}')">🗑️</button>`;

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
            ${btnEdit}${btnOk}${btnMsg}${btnDel}
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

function setActiveView(view){
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
    el(`view-${v}`).classList.toggle("hidden", v!==targetView);
  });

  const sticky = el("stickyFilters");
  if(sticky){
    const viewsWithGlobalFilters = new Set(["dashboard","leads","kanban"]);
    sticky.classList.toggle("hidden", !viewsWithGlobalFilters.has(targetView));
  }

  renderAll();
}

/* -------- Modal helpers -------- */
function openModal({title, sub="", bodyHTML="", footHTML="", onMount=null, maxWidth="720px"}){
  el("modalTitle").textContent = title;
  el("modalSub").textContent = sub;
  el("modalBody").innerHTML = bodyHTML;
  el("modalFoot").innerHTML = footHTML;
  const __modalInner = document.querySelector('#modalBg .modalInner');
  if(__modalInner) __modalInner.style.maxWidth = maxWidth || '720px';
  el("modalBg").classList.add("show");
  el("modalBg").setAttribute("aria-hidden","false");
  if(typeof onMount==="function") onMount();
}
function closeModal(){
  el("modalBg").classList.remove("show");
  el("modalBg").setAttribute("aria-hidden","true");
  const __modalInner = document.querySelector('#modalBg .modalInner');
  if(__modalInner) __modalInner.style.maxWidth = '720px';
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


  // Tags: aceitar legado (e.tag / c.tags) e garantir render estável
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
        <label>Valor do orçamento (R$) <span class="muted" style="font-weight:400">(opcional)</span></label>
        <input id="lf_value_budget" type="text" inputmode="decimal" ${ro?"disabled":""} placeholder="Ex: 12000" value="${(e.valueBudget!=null)?escapeHTML(e.valueBudget):((e.valueEstimated!=null)?escapeHTML(e.valueEstimated):"")}"/>
        <div class="help muted" style="font-size:12px">Quanto foi orçado/proposto.</div>
      </div>

      <div>
        <label>Valor pago (R$) <span class="muted" style="font-weight:400">(opcional)</span></label>
        <input id="lf_value_paid" type="text" inputmode="decimal" ${ro?"disabled":""} placeholder="Ex: 3000" value="${(e.valuePaidGross!=null)?escapeHTML(e.valuePaidGross):((e.valuePaid!=null)?escapeHTML(e.valuePaid):((e.valueClosed!=null)?escapeHTML(e.valueClosed):""))}"/>
        <div class="help muted" style="font-size:12px">Quanto entrou de fato (pode ser parcial).</div>
        <div class="help" style="font-size:12px; margin-top:6px">
          Em aberto: <b class="mono" id="lf_open_value">—</b>
        </div>
      </div>

      <div>
        <label>Data do pagamento <span class="muted" style="font-weight:400">(quando houver pagamento)</span></label>
        <input id="lf_payment_date" type="date" ${ro?"disabled":""} value="${escapeHTML(e.lastPaymentDate || "")}"/>
        <div class="help muted" style="font-size:12px">Usada para lançar o pagamento no dia e no mês corretos.</div>
      </div>

      <div style="grid-column:1/-1">
        <div class="hr" style="margin:10px 0; opacity:.6"></div>
      </div>

      <div style="grid-column:1/-1">
        <div class="twoCol" style="gap:14px">
          <div>
            <label>Forma de pagamento <span class="muted" style="font-weight:400">(parcelamento)</span></label>
            <select id="lf_pay_method">
              <option value="">—</option>
              <option value="Pix">Pix</option>
              <option value="Cartão de crédito">Cartão de crédito</option>
              <option value="Cartão de débito">Cartão de débito</option>
              <option value="Espécie">Espécie</option>
              <option value="Boleto">Boleto</option>
            </select>
            <div class="help muted" style="font-size:12px">Usado para priorizar cobrança (boleto = risco maior).</div>
          </div>
          <div>
            <label>Entrada (R$)</label>
            <input id="lf_entry_amount" type="text" inputmode="decimal" placeholder="Ex: 1000" />
            <div class="help muted" style="font-size:12px">Se recebeu entrada e o restante vai parcelar.</div>
          </div>
          <div>
            <label>Valor para parcelar (R$)</label>
            <input id="lf_inst_amount" type="text" inputmode="decimal" placeholder="Ex: 2000" />
          </div>
          <div>
            <label>Vezes</label>
            <input id="lf_inst_n" type="number" step="1" min="1" placeholder="Ex: 10" />
            <div class="help" style="font-size:12px; margin-top:6px">Parcela estimada: <b class="mono" id="lf_inst_each">—</b></div>
          </div>
          <div>
            <label>1º vencimento</label>
            <input id="lf_inst_firstdue" type="date" />
            <div class="help muted" style="font-size:12px">Se vazio, usa o mesmo dia no próximo mês.</div>
          </div>
        </div>
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
  const contact = { name:"", phone:"", firstSeenAt:"", lastSeenAt:"" };

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

  // toggle others
  const originSel = el("lf_origin");
  const treatSel = el("lf_treatment");
  const toggleOrigin = ()=> el("originOtherWrap").classList.toggle("hidden", originSel.value!=="Outros");
  const toggleTreat = ()=> el("treatOtherWrap").classList.toggle("hidden", treatSel.value!=="Outros");
  originSel?.addEventListener("change", toggleOrigin);
  treatSel?.addEventListener("change", toggleTreat);

  // valores: em aberto (orçamento - pago)
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


  // parcelamento: pré-preencher + cálculo de parcela estimada
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


  // suggestions
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

  // hide suggest on blur (small delay for click)
  [nameInp, phoneInp].forEach(inp=>{
    inp?.addEventListener("blur", ()=>setTimeout(()=>suggestBox.classList.remove("show"), 180));
    inp?.addEventListener("focus", ()=>showSuggest());
  });

  // tag adding (persistente)
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

  // remover tag (clicando no ×)
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



  // init: puxa tags já salvas (sem "Prioridade:")
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

// Save
  const btn = el("btnSaveLead");
  btn?.addEventListener("click", async ()=>{
    if(!actor.perms.edit) return toast("Sem permissão", "Seu nível não permite editar.");

    const name = val("lf_name").trim();
    const phone = normPhone(val("lf_phone"));
    if(!name || !phone) return toast("Nome e telefone são obrigatórios");

    let monthKey = (val("lf_month","") || val("fMonth", new Date().toISOString().slice(0,7))).trim();
    if(!monthKey || monthKey === "all") monthKey = new Date().toISOString().slice(0,7);
    if(!/^\d{4}-\d{2}$/.test(monthKey)) return toast("Mês inválido", "Use YYYY-MM (ex: 2026-01)");

    // find or create contact (unique by phone)
// verifica se já existe alguém com esse telefone
const existing = db.contacts.find(
  c => c.masterId === actor.masterId && c.phone === phone
);

const selectedContactId = String(el("lf_name")?.dataset.contactId || el("lf_phone")?.dataset.contactId || "").trim();
if (existing && isNew && !selectedContactId) {
  const continuar = confirm(
    "Já existe outro contato com esse telefone.\n\nDeseja continuar mesmo assim?"
  );
  if (!continuar) return;
}

// SEMPRE cria novo contato
const now = new Date().toISOString();

let contact = {
  id: null,
  masterId: actor.masterId,
  name,
  phone,
  firstSeenAt: val("lf_first") || todayISO(),
  lastSeenAt: val("lf_first") || todayISO()
};

const selectedId = String(el("lf_name")?.dataset.contactId || el("lf_phone")?.dataset.contactId || "").trim();
let existingIndex = -1;
if(selectedId){
  existingIndex = db.contacts.findIndex(function(c){
    return String(c.id) === String(selectedId);
  });
}
if(existingIndex < 0){
  existingIndex = db.contacts.findIndex(function(c){
    return String(c.phone) === String(contact.phone);
  });
}

if (existingIndex >= 0) {

  // atualiza apenas nome e telefone
  db.contacts[existingIndex].name = contact.name;
  db.contacts[existingIndex].phone = contact.phone;

  // usa o contato existente para manter histórico
  contact = db.contacts[existingIndex];

} else {

  // novo contato
  contact.id = crypto.randomUUID();

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
    const payMethod = val("lf_pay_method","").trim();

    const valueBudgetRaw = el("lf_value_budget")?.value;
    const valueBudget = parseBRNum(valueBudgetRaw);
    const valuePaidRaw = el("lf_value_paid")?.value;
    const valuePaid = parseBRNum(valuePaidRaw);
    const paymentDate = val("lf_payment_date") || todayISO();
    const campaign = !!el("lf_campaign")?.checked;

    let manualTags = [];
    try{ manualTags = JSON.parse((tagInp?.dataset.tags)||"[]") || []; }catch(_){ manualTags = []; }
    // Se o usuário digitou uma tag e clicou em "Salvar" sem dar Enter, não vamos perder.
    const pendingTag = (tagInp?.value||"").trim();
    if(pendingTag){
      manualTags = Array.from(new Set([...(manualTags||[]), pendingTag]));
      if(tagInp){ tagInp.value=""; tagInp.dataset.tags = JSON.stringify(manualTags); }
    }
    const prio = val("lf_priority");
    let tags = [];
    if(prio) tags.push("Prioridade: " + prio);
    tags.push(...manualTags);

    // resgate financeiro: só entra no mês da data do pagamento quando houver dinheiro novo + status Fechou
    const realToday = todayISO();
    const rescueDate = paymentDate || realToday;
    const rescueMonthKey = String(rescueDate).slice(0,7);
    const hadBefore = db.entries.some(e=>e.masterId===actor.masterId && e.contactId===contact.id && e.monthKey !== rescueMonthKey);
    const existingThisMonth = db.entries.find(e=>e.masterId===actor.masterId && e.contactId===contact.id && e.monthKey === monthKey);

    if(isNew && existingThisMonth){
      // instead of duplicate, open existing entry and update it
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
    const paidNow = (valuePaid!=null && !isNaN(Number(valuePaid))) ? Number(valuePaid) : 0;
    const paidDelta = Math.max(0, Number((paidNow - originalPaidBase).toFixed(2)));
    const shouldRegisterRescue = isCrossMonthFinancialEdit && status === "Fechou" && paidDelta > 0;
    const shouldRegisterDirectPayment = !shouldRegisterRescue && status === "Fechou" && paidDelta > 0;

    const fromStatus = shouldRegisterRescue ? originalStatus : (entry.status || "");
    const toStatus = shouldRegisterRescue ? originalStatus : status;

    // update entry fields (edições cadastrais sempre podem corrigir a ficha antiga)
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
    entry.valueBudget = valueBudget;
    entry.apptDate = apptDate;
    entry.apptTime = apptTime;
    entry.callAttempts = callAttempts;
    entry.callResult = callResult;
    entry.valueEstimated = valueBudget;

    if(shouldRegisterRescue){
      // mantém o mês antigo intacto e guarda o total bruto só como referência de edição
      entry.valuePaid = (originalPaidShown || null);
      entry.valueClosed = (originalStatus === "Fechou") ? (originalPaidShown || null) : null;
      entry.valuePaidGross = paidNow;
      entry.valueClosedGross = paidNow;
      entry.lastPaymentDate = rescueDate;
    }else{
      entry.valuePaid = valuePaid;
      entry.valueClosed = (status==="Fechou") ? valuePaid : null;
      entry.valuePaidGross = valuePaid;
      entry.valueClosedGross = (status==="Fechou") ? valuePaid : null;
      if(shouldRegisterDirectPayment || paidNow>0) entry.lastPaymentDate = rescueDate;
    }

    // tags: sobrescreve tags manuais (permite remover), preservando tags de sistema
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
        value: paidDelta,
        method: payMethod || "",
        desc: "Resgate / pagamento manual"
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
        value: paidDelta,
        method: payMethod || "",
        desc: "Pagamento manual"
      });
    }

    /* ===== Parcelamento: captura e gera parcelas ===== */
    const entryAmtRaw = el("lf_entry_amount")?.value;
    const entryAmount = parseBRNum(entryAmtRaw) || 0;
    const instAmtRaw = el("lf_inst_amount")?.value;
    const instAmount = parseBRNum(instAmtRaw) || 0;
    const instNRaw = el("lf_inst_n")?.value;
    const instN = (instNRaw!==undefined && instNRaw!==null && instNRaw!=="") ? parseInt(instNRaw,10) : 0;
    const firstDue = val("lf_inst_firstdue","").trim();

    // Se tiver entrada, soma no valuePaid automaticamente (sem tirar do que você digitou, só se valuePaid estiver vazio)
    if(entryAmount>0 && (valuePaid==null || isNaN(valuePaid))){
      entry.valuePaid = entryAmount;
      entry.valueClosed = (status==="Fechou") ? entry.valuePaid : null;
    }

    if(instAmount>0 && instN>0){
      entry.installPlan = { amount: instAmount, n: instN, firstDue: firstDue, payMethod: payMethod, entryAmount: entryAmount, each: Number((instAmount/instN).toFixed(2)) };
      buildInstallments(entry);
    }else{
      // se zerou os campos, remove plano
      entry.installPlan = null;
      entry.installments = [];
    }

    saveDB(db);
    closeModal();
    ensureMonthOptions(); // in case new month
    const savedMonthLabel = (typeof rescueMonthKey !== "undefined" && shouldRegisterRescue) ? `${monthLabel(rescueMonthKey)} • Resgatado` : monthLabel(monthKey);
    toast("Lead salvo ✅", `${name} • ${savedMonthLabel}`);
    renderAll();
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

  // Se o contato já existe no banco, abrir a ficha real para editar
  // evita duplicidade, respeita o mês/ano original e elimina o alerta falso de telefone duplicado.
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
    setIf("lf_value_budget", latest.valueBudget != null ? latest.valueBudget : (latest.valueEstimated != null ? latest.valueEstimated : ""));
    setIf("lf_value_paid", latest.valuePaidGross != null ? latest.valuePaidGross : (latest.valuePaid != null ? latest.valuePaid : (latest.valueClosed != null ? latest.valueClosed : "")));
    setIf("lf_payment_date", latest.lastPaymentDate || "");
    setIf("lf_apptDate", latest.apptDate || "");
    setIf("lf_apptTime", latest.apptTime || "");
    setIf("lf_calls", latest.callAttempts || "");
    setIf("lf_callResult", latest.callResult || "");
    setIf("lf_notes", latest.notes || "");

    if(el("lf_pay_method")) setIf("lf_pay_method", latest.installPlan?.payMethod || "");
    if(el("lf_entry_amount")) setIf("lf_entry_amount", latest.installPlan?.entryAmount != null ? latest.installPlan.entryAmount : "");
    if(el("lf_inst_amount")) setIf("lf_inst_amount", latest.installPlan?.amount != null ? latest.installPlan.amount : "");
    if(el("lf_inst_n")) setIf("lf_inst_n", latest.installPlan?.n != null ? latest.installPlan.n : "");
    if(el("lf_inst_firstdue")) setIf("lf_inst_firstdue", latest.installPlan?.firstDue || "");

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
    setIf("lf_payment_date", latest.lastPaymentDate || "");
    const campaignChk = el("lf_campaign");
    if(campaignChk) campaignChk.checked = false;
  }

  ["lf_origin","lf_treatment"].forEach(id=>el(id)?.dispatchEvent(new Event("change", { bubbles:true })));
  ["lf_value_budget","lf_value_paid","lf_inst_amount","lf_inst_n"].forEach(id=>el(id)?.dispatchEvent(new Event("input", { bubbles:true })));

  fillHistory(c.id);
  document.querySelectorAll(".suggestBox.show").forEach(box=>box.classList.remove("show"));
  toast("Cadastro carregado", latest ? "Dados anteriores preenchidos automaticamente." : "Contato existente carregado para novo registro.");
}

/* -------- Delete -------- */

function toggleLeadDone(entryId){
  const db = loadDB();
  const e = db.entries.find(x=>x.id===entryId);
  if(!e) return;
  // simple toggle: status between "Concluído" and previous
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

    // Toggle: se já estiver Concluído, volta pro status anterior (quando existir)
    if(fromStatus === "Concluído"){
      const back = entry._prevStatus || entry.prevStatus || "";
      if(back && back !== "Concluído"){
        toStatus = back;
      }else{
        // fallback seguro
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

    // compat
    const vp = parseMoney(entry.valuePaid);
    entry.valueClosed = vp || null;

    // log
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
    // template simples (pode evoluir depois)
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
      // basic shape check
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

  // Wire drag & drop (robust: desktop + touch)
  window.__KANBAN_DRAG_ID = null;

  qsa(".kanCard", board).forEach(card=>{
    const id = card.dataset.entry;

    // Desktop HTML5 drag
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

    // Touch/pointer fallback: tap a card, then tap a column to move
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

    // Tap-to-move fallback (mobile)
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
  saveDB(db);

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
  const allOpenMode = taskFilter === "PendentesEAtraso";

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

      if(taskFilter === "PendentesEAtraso") return t.done !== true;
      if(taskFilter === "Atrasado") return !!overdue;
      if(taskFilter === "Pendente") return !!pending;
      if(taskFilter === "Feito") return !!t.done;
      return true;
    })
    .sort((a,b)=> {
      const aDue = String(a.dueDate||"9999-12-31");
      const bDue = String(b.dueDate||"9999-12-31");
      if(allOpenMode){
        const aDate = a.dueDate ? new Date(a.dueDate+"T00:00:00") : null;
        const bDate = b.dueDate ? new Date(b.dueDate+"T00:00:00") : null;
        const aOver = aDate && aDate < today && a.done !== true ? 0 : 1;
        const bOver = bDate && bDate < today && b.done !== true ? 0 : 1;
        if(aOver !== bOver) return aOver - bOver;
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

  // choices from current filtered entries
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

  // 🔒 BLOQUEIO DE TAREFA AUTOMÁTICA
  if (t.key && t.key.startsWith("INST:")) {
    return toast("Aviso", "Essa tarefa é automática e vinculada ao parcelamento.");
  }
  // toggle done and keep a memory of previous state if you want future audits
  t.done = !t.done;
  saveDB(db);
  toast(t.done ? "Tarefa marcada como feita" : "Tarefa reaberta");
 if (typeof renderTasks === "function") renderTasks();
  if (typeof updateSidebarPills === "function") updateSidebarPills();
}
// compat
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

  // Parcelamentos bindings
  const instMonth = el("instMonth");
  const instSearch = el("instSearch");
  const instFilter = el("instFilter");
  const instRefresh = el("btnInstRefresh");
  if(instMonth) instMonth.addEventListener("change", renderInstallmentsView);
  if(instSearch) instSearch.addEventListener("input", debounce(renderInstallmentsView, 150));
  if(instFilter) instFilter.addEventListener("change", renderInstallmentsView);
  if(instRefresh) instRefresh.addEventListener("click", ()=>runManualCloudRefresh(instRefresh, { installmentsOnly:true }));
  setTimeout(() => {
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
      saveFilters(f);
      currentPage = 1;
      renderAll();
    });
    el(id).addEventListener("change", ()=>{
      const f = getUIFilters();
      saveFilters(f);
      if(id==="fYear"){
        ensureMonthOptions();
      }
      // persist again in case month selection was adjusted
      saveFilters(getUIFilters());
      currentPage = 1;
      renderAll();
    });
  });

  // Users
  el("btnNewUser").onclick = openNewUser;

  // Settings
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

  // Parcelamentos: template de cobrança
  const taCharge = el("waChargeTemplate");
  const hintCharge = el("chargeTplSaved");
  const btnSaveCharge = el("btnSaveChargeTpl");
  const btnResetCharge = el("btnResetChargeTpl");
  // carregar valores atuais
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
  // wipe removed for production
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
  const supportTokenPresent = new URLSearchParams(location.search).has("support_token");

  if(supportTokenPresent || isSupportMode()){
    setSupportEntryLoading(true, "Modo suporte • Validando acesso e carregando a clínica...");
  }

  try{
    await maybeInitSupportMode();
  }catch(error){
    console.error("Falha ao iniciar suporte:", error);

    const supportCtx = getSupportContext();

    // Em fluxo de suporte, não mostra toast antes do fluxo terminar.
    if(!supportCtx && !supportTokenPresent){
      clearSupportContext();
      toast("Falha no suporte", error?.message || "Não foi possível validar o acesso de suporte.");
    }
  }

  await ensureCloudDBLoaded();
  await syncCurrentCloudActor();

  fillSelectOptions();

  // Filters (year/month) need options before we set values
  const f = loadFilters();
  ensureYearOptions();
  setUIFilters(f);
  ensureMonthOptions();

  // migração (valores antigos -> novos)
  try{ const db=loadDB(); if(migrateDBValues(db)) saveDB(db); }catch(e){}

  // persist normalized filters
  saveFilters(getUIFilters());

  const actor = currentActor();

  if(!actor){
    // Evita jogar o suporte na tela de login por causa de corrida de inicialização.
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
  // theme at start
  applyTheme(localStorage.getItem(THEMEKEY) || "dark");

  bindActions();
  bindAuth();
  bindLoginEnterSubmit();

  showAuth();
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


// === PATCH: sincroniza a rolagem horizontal dos Leads (top bar) ===
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
      // faz o "inner" ter a mesma largura do conteúdo real (table scrollWidth)
      inner.style.width = table.scrollWidth + "px";
      // mantém sincronizado caso alguém tenha mexido no outro
      top.scrollLeft = wrap.scrollLeft;
    }
    // sync listeners (evita loop com flag simples)
    let lock=false;
    top.addEventListener('scroll', ()=>{ if(lock) return; lock=true; wrap.scrollLeft = top.scrollLeft; lock=false; });
    wrap.addEventListener('scroll', ()=>{ if(lock) return; lock=true; top.scrollLeft = wrap.scrollLeft; lock=false; });

    window.addEventListener('resize', refresh);
    // quando tabela re-renderizar, tenta de novo
    const mo = new MutationObserver(()=>refresh());
    mo.observe(wrap, {childList:true, subtree:true});
    refresh();
  }
  // espera DOM pronto
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

  canvas.addEventListener("mouseleave", ()=>__hideChartTooltip(), {passive:true});
  canvas.addEventListener("mousemove", (ev)=>{
    const data = canvas.__chartData;
    if(!data){ __hideChartTooltip(); return; }
    const {x, y, r} = rel(ev);

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
        body += `<div class="ttRow"><span style="display:flex; gap:8px; align-items:flex-start">
          <span class="ttDot" style="background:${s.color||'rgba(30,120,255,0.9)'}"></span>
          <span>${escapeHTML(s.name||'')}</span>
        </span><b>${val}</b></div>`;
      });
      __showChartTooltip(body, ev.clientX, ev.clientY);
      return;
    }

    if(data.type === "bar"){
      const hit = (data.rects||[]).find(rc => x>=rc.x && x<=rc.x+rc.w && y>=rc.y && y<=rc.y+rc.h);
      if(!hit){ __hideChartTooltip(); return; }
      const title = escapeHTML(hit.label||"");
      const body = `<div class="ttTitle">${title}</div>
        <div class="ttRow"><span>Qtd</span><b>${hit.value||0}</b></div>`;
      __showChartTooltip(body, ev.clientX, ev.clientY);
      return;
    }
  }, {passive:true});
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
  // dinheiro: mostra tudo (modal informativa) – útil p/ auditoria rápida
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
    });
  }catch(_){}
}
function __applyKpiClick(key){
  // total limpa o filtro; clicar no mesmo KPI alterna on/off
  if(key==="total"){
    window.__KPI_ACTIVE = null;
  } else {
    window.__KPI_ACTIVE = (window.__KPI_ACTIVE===key) ? null : key;
  }
  __updateKpiActiveUI();

  // Re-renderiza mantendo a view atual; no dashboard isso atualiza
  // o resumo por status e os leads filtrados sem pular para Leads.
  try{ renderAll(); }catch(_){}
}


// KPI clique instantâneo (delegação): não depende de renderDashboard, nem perde listener ao re-render
(function(){
  if(window.__kpiDelegated) return;
  window.__kpiDelegated = true;
  document.addEventListener("click", (ev)=>{
    const k = ev.target && ev.target.closest ? ev.target.closest(".kpi[data-kpi]") : null;
    if(!k) return;
    const key = k.getAttribute("data-kpi");
    try{ __applyKpiClick(key); }catch(_){}
  }, true);
})();
function __openKpiModal(key){
  const rows = window.__lastDashRows || [];
  const list = __kpiBucket(key, rows);

  const modal = document.getElementById("kpiModal");
  const title = document.getElementById("kpiModalTitle");
  const sub = document.getElementById("kpiModalSub");
  const box = document.getElementById("kpiModalList");
  if(!modal || !title || !sub || !box) return;

  title.textContent = __kpiTitle(key);
  sub.textContent = `${list.length} lead(s)`;
  box.innerHTML = "";

  if(list.length===0){
    box.innerHTML = `<div class="muted">Nada aqui por enquanto.</div>`;
  } else {
    list
      .sort((a,b)=> String(a.name||"").localeCompare(String(b.name||""), "pt-BR"))
      .forEach(e=>{
        const card = document.createElement("div");
        card.className = "leadCard";
        const phone = (e.phone||e.tel||e.whatsapp||"").toString();
        const st = (e.status||"—");
        card.innerHTML = `
          <div class="leadCardMain">
            <div class="leadCardTitle">${escapeHTML(e.name||"Sem nome")}</div>
            <div class="leadCardSub muted">${escapeHTML(phone)} • ${escapeHTML(st)}</div>
          </div>
          <div class="leadCardActions">
            <button class="btn btnSmall">Abrir</button>
          </div>
        `;
        card.querySelector("button").addEventListener("click", ()=>{
          try{ closeModal("kpiModal"); }catch(_){}
          try{ openLead(e.id); }catch(_){}
        });
        box.appendChild(card);
      });
  }

  openModal("kpiModal");
}
function __bindKpiClicks(){
  document.querySelectorAll(".kpi[data-kpi]").forEach(elm=>{
    if(elm.__kpiBound) return;
    elm.__kpiBound = true;
    const key = elm.getAttribute("data-kpi");
    elm.addEventListener("click", ()=>{
      // apenas KPIs "de status" abrem lista; os financeiros também abrem (pra auditoria)
      __applyKpiClick(key);
    });
  });

  const closeBtn = document.getElementById("kpiModalClose");
  if(closeBtn && !closeBtn.__bound){
    closeBtn.__bound = true;
    closeBtn.addEventListener("click", ()=>closeModal("kpiModal"));
  }
  try{ __updateKpiActiveUI(); }catch(_){ }
}

// KPI clicks (delegação): funciona mesmo se os cards forem re-renderizados
(function(){
  if(window.__KPI_DELEGATE_BOUND) return;
  window.__KPI_DELEGATE_BOUND = true;
  document.addEventListener("click", (ev)=>{
    const kpiEl = ev.target && ev.target.closest ? ev.target.closest(".kpi[data-kpi]") : null;
    if(!kpiEl) return;
    // evita conflito com botões internos (ex.: "Abrir" dentro de lista)
    if(ev.target.closest("button, a")) return;

    const key = kpiEl.getAttribute("data-kpi");
    if(!key) return;

    // alterna filtro
    try{
      if(!window.__KPI_ACTIVE || window.__KPI_ACTIVE==="total"){
        window.__KPI_ACTIVE = key;
      }else if(window.__KPI_ACTIVE===key){
        window.__KPI_ACTIVE = "total";
      }else{
        window.__KPI_ACTIVE = key;
      }
    }catch(_){ window.__KPI_ACTIVE = key; }

    // marca visual
    try{
      document.querySelectorAll(".kpi[data-kpi]").forEach(x=>x.classList.toggle("kpiActive", x.getAttribute("data-kpi")===window.__KPI_ACTIVE && window.__KPI_ACTIVE!=="total"));
      if(window.__KPI_ACTIVE==="total") document.querySelectorAll(".kpi[data-kpi]").forEach(x=>x.classList.remove("kpiActive"));
    }catch(_){}

    // re-render geral
    try{ renderAll(); }catch(_){}
  }, true);
})();



/* garante que, sempre que o dashboard renderizar, o clique funcione */
(function(){
  const _origRenderDashboard = window.renderDashboard;
  if(typeof _origRenderDashboard === "function" && !_origRenderDashboard.__wrappedKpi){
    const wrapped = function(...args){
      const ret = _origRenderDashboard.apply(this, args);
      try{ __bindKpiClicks(); }catch(_){}
      return ret;
    };
    wrapped.__wrappedKpi = true;
    window.renderDashboard = wrapped;
  }
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
    cancelPendingCloudSync();
    suppressCloudFailureToasts(12000);
    setSupportEntryLoading(false);
    setLoginLoading(true, window.__CRONOS_EXPLICIT_LOGIN__
      ? "Validando acesso e carregando seu ambiente..."
      : "Restaurando acesso e carregando seu ambiente...");

    document.getElementById("appView").classList.add("hidden");
    document.getElementById("authView").classList.remove("hidden");

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
  const hasSupportToken = new URLSearchParams(location.search).has("support_token");

  // Em suporte, deixa o próprio boot resolver tudo — inclusive sem login.
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

window.addEventListener("load", verificarSessao);
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
    installments: 'Parcelamentos',
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

/* ===== FICHA DO LEAD + CADASTRO DE PROCEDIMENTOS (v1) ===== */
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
    const ODONTO_BASE_LIGHT = "data:image/png;base64,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Cr9ndqTSOfvtzso6lzP6Qj2/FBTaLSeMca2heYV0dFatUMenq5HcrIZKoROcenhz7eq3TDNHUxMlikbLE8BzXsO7XA+BBHig80REBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERARFrTUTiX0s0mqzS5dnljsdYPGmqatvej5sG5H3INlop4o+0H4ea2odCzVKyxua7lLpi+Np+TnNAI+K3NhOoWM6kWht0xa/W/ILe7wqLfUNlaPnsen1QZCiIgIiICIiAiIgIiICIiAiIgIiICL8e9sbHOc4Na0blxOwAXRTZ9jFNU+zzZHaYp99u6fXRB2/psXboO+Reqlq4K6Fs1NNHUQu8JInhzT9QvagIiICIiAi0FrVx0aN6DXSotGR5SKnIINg6y2iB1XVhx8Glrfdaf5zgsLw3tQNAsqqHUtfkNww6tB29myW3SUxI/a5m87APm4H4IKxRYbhOsuCakUTavF8vs19gd4GirY3n+jvuPuWZICIiAiIgIiICIiAiIgIiICIiAi41yuVJZ6Cetr6mKjo6dhklqJ3hjI2jqS5x6AKTc+7T3SHG7q6z4nDftULyOns+I0HtEbT5c0ji0bfFnMgrtFGLe0BzdjPbZ+GPUSOzDq6rYGOkDdt9+75Rv8uZZ1pH2g+j+rF6ZYX3OuwrJnODBZMupfYKguPgAeZzCfgHb/BBSiL8a4OAIIIPUEea/UBERAREQEREBFwpL3boq5tG+vpWVjugp3TNEh/h33XNQEREBERAREQEREBEXT12Y2C11LaesvltpJ3HYRT1cbHE/IndB3CLwhmjqI2yRSNljd4PYdwfqvNAREQEREBERAREQEREBERAREQEREBERAREQEXorK6mt0Bmq6iKlhHjJM8MaPqV1VFnWNXOoFPR5Daqqc+EUFbE9x+gdug7xERAREQEREBERAREQEREBERARFj2eahY1phjlRfssvdFYLPBsJKuulEbAT4Ab+J+A6oMhRRxe+1b0OttzmprcMpyalhO0lxs9mc+mb6+89zCQPUDb03W2tI+NLRnW6RtPi+c2+W4OaHG313NSVA+HJKGknfp03QbtRAdxuOoRAREQEREBERAREQEREBERAREQF6qqqhoaaWoqJWQU8TS+SWRwa1jQNyST4AL2kgAknYBfP3WDJ8r7QDWCv0l08u1VY9HcYqe6y/J6R3K25zh23ssLh/KAEHoDynq47gM5gyLUHjfzTWTOKzT3hhxlmV1tK/2e4ZvcG8tpoXEdXMcejw3r1I94t91rxtv+N4BtUtR6CGo1V4kMur7r9p1Jjcho6GJ37rG8gdt4c3ID8Aq20w0sxbRvDbfi2IWenstmooxHHDA3q8jxe93i958S5xJJPVZWgiFnA9rLpLT+2aQ8ROQOrWnmNpzMmtt83wIIf3e/m5rCV4Yl2h130vymDDOJLA63Tm7Pf3cWSUcZntNR5B/MNy1pI6FvOOvXl2KuFdffMdtWTUL6K8W2kutG8EOp62Bs0ZB8d2uBCDVkXGPobNQtrG6r4n7MRvzuukTenxBO4WqM77TPS+2Xansen1DfNXsiqHcjKPFKNz4muPgHTPAB3/cD/jsti1vAtw/3C4Gtm0lxkTF3MRFRiOPfff7DSG/gtrYpp/i+CUTKPG8ctWP0jBsyC2UUdOxo+AY0BBHruKniyu0hqrRwu9zbt+jLleI4p9v5rntO/wDCuZZO0ogw66W6z636WZZpRWVcoh/KlRTd/bWk/rOk6PDf5rX+vgrVXU5TiVlzix1dmyC10t4tVXG6KekrIhJG9pGxBBQe3HsiteWWWku9muFPdLXVxiWnq6SQSRytPgWuHQrsV87Ljb7v2Yeq9trLfW1d24dMuuIpqmgqHmR+PVTz0ewnclmwPxcGkHdwBP0OpaqGtpoqinlZPBKwSRyxu3a9pG4IPmCEHtREQFEWtXF/n2p2rNZo1w4W2C43+ikMF8zOsj56C0O32cASC1xbsQSQfe6Na4grYHaEa43PR3Ql9vxeYtzjL6yPH7JFE4CbvJej3s69C1p2DvJz2eG4WacI/DhbOGLRm0YrTiOovcjBVXq4s6mrrHAGR3MRuWA+63fyA8yUGj7T2Ydhy6tN81j1DyzUzJZ2Dv5Za91NTtd5tjYNy1g8mggD0XNyjso9E7pTtNgdkWIV7NjHV267yyEOH6xEpd1+RCsxEEQ1lk4ruFamJsFfTcRGGRcsUNDcj7Pe6Rg8y8D9MPLcuc7qOmwXAuuu/FprlPBjeFaPP0fjrNm1GU5LKJPYmfrOaxzBu70HI477dB4i7UQSnpB2c+meFVJv+dQSas5zPKZ6q+ZUXVLHSHqeWB5Me2/gXBx+IVEU2mmIUdBJQ0+KWSCikGz6aO3QtjcPi0N2PifvWSIg0bm/A5oLqFHMLtpZjscsp3dUWykFBKT689PyEn5lTNmGgmqHALU1Gd6K3q45pppE/vr7gd2nM0sUPnLTuI8WjxLdneG4eAdvoWvGSNsrHMe0PY4EOa4bgj0KDBdEdacY4gNN7TmuJ1ntNsr2e9E8cstNKOkkMjfJ7TuD5HxBIIJzxQFpjQwcFnHnXaeQTezaa6rQvuVlpSSW0Nyad3RD0a487G/z4h5Eq/UBERBwr3e7fjdpq7pda2C3W2kjdNUVdTII44mAblznHoAFFdx44tQ9e82qsY4a8DjyK000pp6rOsh54LXE/wDab03c0fVzvJu3j0nEldr7xs8RB4eMXrZrZp7jPd1+bXmkILpX+LKVrvAHfpsfFwcdto+tt4Bp/j+l2I2zGMXtcNosluhbBT0sA6NaBtuSernHxLiSSdySSglKDhw4sr8XVd84maS01L+oo7HjsDoIvUBzmtc4fEjdeD9G+MjAJPbbBrdjeoUMO8htGS2ZlGZh+wJYmE7nwG7mjf0VoogivFu0LuWntzpbFxFaa3nSqvnlMUV+ihNVaJNvAmRhJG56bt5x16kBb7ouLTRi4W411Pqhi0lIACZRdIgBv67notk33HrXlFtmt94ttJdaCYFslLWwNmieD4gtcCCtC3Ds8eHS53KSum0rtDZ3v5y2CWeGLf4RskDAPgBsgxDUTtJ9PbVf6bGtNbTd9ZsoqWnu6TE4u8p43eTXznpuf3A/bbrt0XTWjUzjT1E/vi3aW4Zp/RSO2i/OW5ukkDfVzIi5w+RaD8FVuEaaYlpra47dimNWrHKGP7MFso44G/EnlA3J9T4rJUEP5PxJcUmgAbcdSNIbNmeKwuJrLxg9Y6R8MY8Xd0/3wNuu7mgdPEKntDdecM4icFpcrwq5ivt8oDZoJAGVFJJtuYpmbnlePmQfEEjqtguaHtLXAOaRsQRuCF88Nf8AF38BHEljutWHs/J2mWY1zbRmFngG1PBLIS5s7Yx0bvyucCPBzXDwk2IfRBF4QzMqIWSxuDo3tDmuHmD1BXmgIi49wuNLaaKesrqmGjpIGGSWed4ZHG0eJc49APiUHIWvtYtfcB0Ex994znJKSyU4aXRQyO5p6ggfZjibu55Ph0H3KYtR+PG/6rZdV6ccMuPOzXIg4wVWYTx/+J7Zv070PIIeG9SCfdJHQP8AA5LobwAWnHspbqFrBfJ9WtS5SJfbbtu+ion+P6CE+6dj4Fw2Gw5WtQYjaOJbiR4oXVbtGtOqDT/EXH+9csztzmSSt38WQND9yf3WvaPNy7lmgXGM+jdPJxM2aOu+0KOPE6V0G/7PeGIO2+PLurMjjbExrGNDGNGwa0bAD0Xkghi56z8WvDc6Ko1DwSzavYrGC+pvOFucyqhZ5l0Ra07jx37vl/eVGcP3FLp7xK4+24YfeA6vjZvWWStAir6F2+xbLFv5H9ZpLT5ErbZG42PgpW4lOB2g1FvcGoGmFz/uZ6tW93fQXu1tMUdcQP5Opa3YO38C7Ykjo4OHRBVKKSOFzjTrszzap0g1es/5mav2wGN0cmzKW7co/lID6uHvBo3BG5afIVugIiICIuryXKrNhlmqLtf7rRWW107S+asr52wxRj1LnEAIO0WO5zqLi+mVkkvGWX+349bI/tVVwqGxM+Q3PU/AKScn49ch1hymfC+GjC587uDXOhqMvucbqezUJ8O853bc4HU9dubb3Q7pvzNO+ztoMlvUmZcQmR1Wr+aVJD3U1RNJFa6M+TYoWFocB4bEBv7nmgyS89p9w32e4CjGfuuEu+znW+01szG/HmEWx/hJ8FsnSzi70c1rr4aDDNQLTeLjMCY6AufT1LgPSKVrH/gs4sel2G4zQRUNoxSyWyjiG0cFLb4o2NG23QBq03r/AMBulWvVI+qksseJ5ZGOalyXH2Clqon+ReGbNlHwcN/QhBRaKJeGnXvOdINancOetdcbxdu473FcvkHL+VacAkRyud9qTYEB3U7tLSSdibaQERCdggLF9R9TsV0ixWqyPML5SWCzUw3kqqt+wJ8mtaNy5x8mtBJ8gpr1t48nUGbVemuieJVeq2osJEdQaJhNttzydj38w6e759Q0eBcCCB0+C8CF/wBUsqps64mssOod8hcJKTFaN7orLQbHdre7byiTbzGwDv1ufruGHVOtmtnHtdKux6QU9ZpVpLu6Orzm4Rujra5m+xbTAdWkjw5SCB4ub4Hc+jnZzaJaT0UUlZitLnF+6Ge8ZTGK18jvURSbxs6+jd/iVS1vt9LaaKGjoqaGjpIGhkUEDAxjGjwDWjoB8lyEGubrw3aTXyg9ir9McPqqUN5GxSWKlIaP3fc936bKds77Nqw49c3ZXoNklz0gzSna58DaKrklt87/AB5JY3lxDD4EDdu36pVnoglDhH4r8kzjML5pHrBaocZ1dsDed0MY5YbrAB1nh26Hps7Zp2IcCPMCr1GnaG6LXZ9rsGu+CNbDn2nEouDw3cGtoGnmliO32uUbnY+LS8ddwFSGhmr1n140nxvO7FJzUF4phL3Z+1DKCWSxO+LHtc0/L0QZ2iLr8iv9BimP3O93SoFLbLbSy1tVO4biOGNhe9x+TWk/RB7rpdaKyW+euuFXDQ0UDC+WoqJAyNjR4kuPQBSzqV2mWi+D18VrsFbc9S73IS0UGHUntfIfAc0jnNZ1PT3S4/Baa010tyTtLKqbUvUnIrnZdIW1stPYMHtU7oBUxRu5XS1Lh4lxG2/U+PKWjZW/ppongejtmhtWGYna8eo4gABSQDvHH1fId3vd+84k/FBK9Frzxba2XGWDB9HLZpnZJW7w3rOKl3Mxp8CYmjncT4jljI9T69nTcLvE3kzGTZXxPVNBOSCabGrLDBEwegfysLvmQrLRBE9z7OC+ZO8TZFxHanXeo6bF1xcxjOnXlbz7D6L0xdnpnOB0k9Zp1xG5zar6BzRtu9QaqjlcPASxlxBHx2PyKt5EEn8HnE/mGbZplej+rduht+qWKASSVdK0Mp7nTbgCZg2Gx6tPQbEOBAGxCrBRDxHWN2E9oxw75tRS9wMjpazHLg1nuiURse+PmPmSZx49f0bQreQFjeoepGM6T4pWZLl15pbFZKQby1dU7Zo9GgDq5x8mgEnyCyRfOmzYz/4Rziovl7vc5qtDdN6w26gtzJHd1eK5p3c9wB2LDtuT5t7sDo52wZlaONTWLiSrZIdAdJHRY6XujbmOazezUg26c4jaSXDw6NL3fAdV2MXDhxaZlu7LeJCix+Nzt/Y8SszA1vXymcyN/wB+6su32+ltVFDR0VNFSUkLQyKCBgYxjR4AAdAFyEEQTdl5bsurGVOoWs2oedP5w9zK25uaPDqG8xdyj5eA6LMqbsvOHSGItlwysq5SwN7+e+VvOD+17soG/wBNvgqtRB88dWOC7JeESzXjVXh6za8291jgdcLlid2qDVUldSxAvlbsftENDiA4b9DyuDtlZmgGsds190hxrOrU3uoLtTCSSDfcwTD3ZY9/PleHDfzGyzu4UtNXUFTTVkbJaSaJ0c0co3a5hBDgfgQSo87Jgn/ce2sMMjqRt4uApjINiY++O347/XdBZSIiApz49eICu4e9AK+42GRrMtvdTFZbKXDfu55Sd5P4GB5H73L6qjFAnaqNNbeeHi2vO1NV5i0SDbff3oQP84oN6cJvCFi3D5hFLUVdvgvWf3OJtRfcirm9/U1FQ73nta5+5awE7bDbfbc7lbgy/S7DtQLbJb8mxWzX+ikBDoLlQRTt+YDmnY/EdVk6IJXyfsx+HnIi+SmwybHal/jPZLnUwH+gXuYP6KwePstrRjlW2fCdZNRcNcx3M32K6EkfVpb6n71cCIIuuHCtxLYTBJUYFxMV94nj3cyhzG3x1Mc3XfldKWvc3fw3A+5ZPws8Xt81Azq76T6tY43B9WbRH33soP8Ae1zhHQywO3IJ/W2BILTuCdnbVUox7SPTWrt2I47rrikLYs102r4bg6Vu4dU0HOBLE7bxDSQ7r+r3g80FnIukwfK6PO8MsWSW+RstDdqGGugew7gskYHj8Cu7QStxfcRucYlmuH6Q6P0NJXan5Y107aqtHNT2qja7lNRKNj03Dz1B6Ru6E7A45U6AcYcVGyam4m7TPWhoc6lnxKkZCXebe8ERdy/Hl3WNcM1PHqt2jHEBqA6R09PjcNPj1H1Jaw8rY3cvoCaeQ7eriVeKCHrnq7xkaHiEZRpjjurdrb/KXLD6l8c3KPWJzQ/mI8xHyrKdNu040hy24yWjLjd9K79FsDR5fSGCN58HckzS5uwP7fITv0B67VwsXzfSzDtS7e+iyzFrRkdK/wAY7nRRzj5jmB2PxCDnYtmuP5vb2V2PXqgvdG8biagqWTN2+bSV3SjnMOyw0eu1a+txKrybTiqcS4tx27SCAu9eSXnI+TXNHwXSDg41+0dZFX6V8Q94vr6Y8/5BzZhqaSdoH8mC4v5N/DdoaRv0I8UFwopx4Q+LKfiA/OfGMrsIxHUrE6k0t5socXMPXlEsZPXlJBGx326dSCqOQFimqeqGO6NYHd8wyquFvstshM00m273nyYxv6z3HYAeZKytQXrjCOMzjUs2jj5hPptp5TtvuS07QeSurC4BlO8+bQHNG3T7UvjsNgx/BdP9Se0krW5jqXW1+D6HMn57PhtDKYprq0eEs7xtu3y5j578oA943Hpno9hWjeO09iwrGrfjtsh+zFSRe84/tPkO73u/ecST6rLKWlhoaaKnp4mQU8TQyOKJoa1jQNgAB0AHovagLWGt3DVpzxC2B9szXGaS4vAPcXCNgirKV37UUzdnN67HbfY7dQVs9EHz2dd9XOzcr4heqq46tcP0krWNrXO7y5480nbZ3N4sG/Qb8nTYchPW78MzKy6hYvbcix64Q3WzXGFs9NVwO3a9h/sPkQeoPRdlcbdS3egqKGupoqyjqI3RTU87A+ORhGxa5p6EEeRUA5dgOo/Z4Znd8z0vtVTm+h10m9qu+GxOc+eyu6l81OOuzAN+oGwGwd0AcA+gyLT2hfFtpbxDWmkqMSyqhkuUzN5LHVzNhuEDvNr4CeboenM3dp8iVuFARF+OcGtJJAA6knyQdPmGY2XAMZuOQ5Fcqe0WW3xGeprKl/KyNg8z/sA6kqEY9RNdO0CutdDpxX1WjmisMrofzne1zLleGA7HudtnNB6n3XNA3ALnHouNkArO0h4lKvHoaipp9AtOq3kuBjcWtv1wY4jlBHRzN29D5M3I2Lxt9BrXa6OyW6mt9vpYaKhpoxFBTU7AyONgGwa1o6ABBGtH2TWjYsr4bjccrud7kaS+9S3d7Zu8P6waBy+PXYg/NYeMh1y7PCMQX2Gt1p0NgP6K505DrvZot/sSB23M0eW5LfLmZ0C+gi8JoY6iJ8UrGyxvBa5jxuHD0IQa80U4hcA4hcbbesFyKmvEAa0z0wPJU0ziN+WWI+80j7j5EhbGUn60dn7jmU5R+fWlt6rNINRWOMn5TsBLKaqd/wANACGn4lu2+55g5a/ouMbWDhcutPY+JLCJbnjrdomai4rTmWllJPR00bWhrTtvu0BjunRhQXgix/BdQMb1NxukyDFL3RX+zVTeaKsoZhIw/A7eBHgQdiD0IWQICIiAsE1p1sxLQDAq/LsyuTbfa6VpDWNHNLUybHliib+s93gB0HmSBuV+a3a24pw+6eXLMswr/Y7ZRt92JmxmqZD9mKJpI5nuPgN9vMkAEqONENIcu43tV6TXLWO2zWvALe4Pw3CKpx5HNB3FTNH0BBIDtyPfIHTka3cPfZqXXvtAKWouFdc63QzRmpBbTUNIP/G95jPg9z9gWxkePUA7+Dx1GwMd7K7QG02ptNc7HdsjreTZ1wuF5qmy837QET2NHy2P1VdRxtiY1jGhjGgBrWjYAegXkgiK5dnnkOkc8t64eNV79hF3G7jaL5UmttlV+7I0tO3wcWPIXvwDjvyHS/I6fCuJrEZdOrxI8xUuVUzDLZq0gdCZGl3JzeRG4G/vcmxVrLos1wXHtR8eq7FlFmor9Z6phZNR10IkY4H4HwPoR1Hkg7Gz3mgyG101ytdZBcLfUsEkFVTSCSORp8C1w6ELmKCr5wzaqcFt4uGZcPlwqMuwcuM9x0yusrpT3fn7G87kuaNyB9ogbfpPA0Lw1cXmC8TNpmbZaiS05TQ+5c8Yube6raN46O90/bZv+s3f0Ox3CDeCIiAiLQ3F1xQ0vDXhVAaC3uyLOcgqRbsfsMJ3fU1DvB7xvuI2nbcjxLmjz3AbO1B1Xw3Si2NuGY5Na8ao3HZstyqWxBx+AJ3P0Wj6rtLOGujuRon6n0jpQN+eK21skX/WNhLfxWF6R8ANPll6Go3EXXnU/UKuAmdbat7jarZv1EUcI2a8NHTYjk8fd36qqbZphh1loY6K34pZKKjjGzKent0LGNHoGhuwQYpp1xRaS6tVjKPEdQbFe61zeYUkNWGz7f8AFu2d+C2ipz1f7P7RLWF01bVYjDjl/LCIr3jbzQVEbvJ5bHtHIR6va7p0WoKDCOK7hIoZKLEKuh1/wWAf3tb7xP7Nd6Rvo2Rx/SNH7PM8+TWgILrWmNe+LzTLhypXsyq+ia+OYHU2PWxntFxqSfAMiB6b+ry1vxU/0evfF3rO2Sw45ovSaVvqGOZJk2TVJcyj8udkTm7vd6DlcN9t+i2lw0cDmJ6E1dTlF9qpdQNS7gXPrsqvW8su7ju5sLXEhg3/AFvtHzO3RBq8ceGtOUsbccP4XMqrbDKN6epuEpiklH7XKGbD6E/Nd3ifaV4/bMopca1iwLJdGbrUDZlXfKcyUBd5AygBzd/IlhaPNwHVWUscz7TrGtUcZrceyuy0d9s9ZGY5aariDwQfMHxaR4gjYggEIO5tV1or5baa4W6rhrqGpjEsNTTvD45GHwc1w6ELlL56adz3Xs49fbRp1erzVXfQ7OqgssVfWv5nWWtJ2ELyf1DuwEjYbEO2Gzl9C0BERBxrlc6SzW+or6+pio6KnYZZqid4YyNgG5c5x6ABRbfOMbUXiIzivwzhpx2mrbVRSmnrtR720/kuBwHUwt2/Seg6EuPUN5feWP8AFVkV/wCL7iKpeGfEbjJasRtUTLpmt4pd+85RsW0wPht77Oh8XOHkw72vp1pzjmk+HWzFsUtUFnsduibDBTQDyA+05x6ucfEucSSSSSgkqj7M2gz2/OyPWrUzJ9S79MN5Y2VHsNI391kbPsM8dmt5QskufZacPFZbDTUeLXGz1OxAr6K91ffD4+/I5n9VVqiCDqnhj4guFNrbpojqHU6h4pRgyzYHlsvO+Ru/VlNIejTt12Do+u/2idjuXhq43cN4ga2fGaymqsJ1HoSWV2KXtvdThwHvOhJ6SN+HRw827bE0YtBcTfBjg3EtQMrKyOTHM0pBvb8qtP6KsgcPAPI27xnwPUeRCDruKnjSx7h1dR43a6GXNNTbsWx2vFLdu+VzndGvm23LGE+H6zvIbAkazoeG3iO1+tn5Q1X1mrNPqGtAmZieDsbC6kaeojlqW7OcR4Eczhv5lZnwhcC1u4cbldspyW/y6g6hXIiN1+uDC51PC3oGRc5c4EjbmcTudgBsB1qdBE1NwCal4JEZsA4nM6t1TGCYqW9SGuowfjE95b/VXVXHiO4i+Eu4U/8AdtxSk1IwEACfNcOh5Zacb7c00OzACPEjla0+TiruXqqqWGuppaeohZPBK0sfFK0Oa9p8QQehCDHdONTMY1cxGhyfELzTX2yVjeaKqpnbjfza4Hq1w8C1wBB8QsnXzv1RxK59nBrDBqbg0cs+imW3FlNlGOdTDaZpHe7UQ/723mJ28h9jwLNvoRb6+nutBT1tJMyopaiNssUsZ3a9jhuCD6EFByEREGP5/n1g0vw+6ZRk9yitNjtsJmqaqbfZrR5ADqST0AHUk7BQ9Z4tae0PknvcORXTRjQx7iygpaP9Hd70z/fXOb9mM9Rtz8p8Nn/aHv4jHT8anFnadBaGsLdOsMjZe8wdA9zHVc3MA2l5h4ABzR026vefFgIvK32+ltNBT0VFTxUlHTxtihghYGMjY0bBrQOgAA8EESv7JPTGOkidR5jnFHdWe9+UG3UE8/7QbyDY/VcLIMG4tOFmKG5YbmDde8Mo2hkuP32JrbsyP9psv25dtgPtud16MPiLvRBDtn7WjTSnsdQMuxLMsVyilbyyWKS1966WUdC2KTmA8fN/IsZ0w0Dyzjv1BGreutuq7Xp1TvIxTT+okdGHRdNp52t2OziN+vV/8wNBvqpsdtrZu+qLfSzzf75LC1zvvIXNADQABsB4AIOttmL2ay2+Ght9poaGihYIoqampmRxsYBsGhoGwAHktRa2cF2kOvVLUuyLD6CnvErfdvtqibS18bh9k96wAv29H8w+C3giD58z3/Vjs2nW6LIK6s1Y0CdKIPyhyb3THwT0D9/tR9enUjoR7nQOu7D8vs2fYxbcix64w3Wy3KBtRSVkBJZLG4bgjfqPkQCD0IBXvyPHbZl1huFlvNFDcrVXwPpqqknbzMljcNnNI+IKh3hJuNXwp8UGUcM9wqp67E7jC+/4dVVG5fEwgvkpifP3WuO/rG79rYBeaIiAiIgIiICIiAiIgIiICIiCdO0A1auGj3C5lVzsxIvlz7qy0HIdnCWpd3e7f3gznI+SyPg/0Fo+HPQLGMTjjaLqadtZd5weYzVsjQ6Y7+YB9xv7rR57rTfarU5h4fcUvkkjmUOP5tarpWco33hAmjI/pStP0Vh2ytguNtpKumkbNTTwslikYd2va5oIIPmCCg5KIiAiIgIiICIiDV3E9pTRa16BZxiFZDHK6vtkxpXSjpDUsaXwSD0LZGtP0I81gXZ46gV2o/CBp/cbq8yXSkgmtdQ53iTTTyQsJ+JYxhPxJW6tS8npcK06yjIK5/JRWq11NbM70ZHE57j9wU4dlvaZqLg3xi41DXRzXqvuNyLHeQdVyMG3QdCIwfqgrNERBDHEtBBqR2j3DzhtY0T0Nit1bkHdOPumU8zhuPh7Iwq51B+ewGDtedNZHSFzZsQqS1p8G7Q1Q2H3K8EBERAREQEREBERBD3aV0UNiyPh5ziJgFxtGdUlOxw+05jyJCPlvCPvVwqE+OepqNUeKbhz0mtcftc0V6GS3NjPeMNNE4bvePIcjJtt/E9PFXYgLHtRczpdONPsnyyuY6WisNrqrpOxn2nMgidI4D4kNKyFaS426iWm4RtXXxN53HG6xhGxPuujLXHp6AkoNSdlxjQl0FuuolwpmtybPb5WXe41Ox5pB3r2xtBP6o3eQP3yrIWj+CC3U9r4SdK4KYARfkOCTpt1c7dzvxJW8EBERAREQEREBab4xNNBq3wz6g422Bs9VNa5Z6Vrm77TxDvGEfHdvRbkXhPAypgkhkbzRyNLHN9QRsUE/cAOpVfqtwj6e3q7Td/dYaR9tqpCd3OdTSvga537xZGxxPmSVQig/shbtUjRTN8bqXbusWU1MIZv1YXNaSPh1aVeCASACSdgPMr501dBk3aVa6ZJa6i61+P8PWE15t01Pb3mGS/VbDvI1z/Meu32WFuwDn8y+gmTOnZjd1dTcvtIpJTFzeHNyHbf6qUOyhaXcG1hqJG/31U3S5S1DyNnPk9peCXfHYAfRBTenumeK6UY3T2DELDRY/aIGhrKajj5QdvNx8XH95xJPqsmREBERAREQTdxqcJlFxG4Qy6WaT8i6lY8DWWC+U55JWys94QucOvI4jof1TsR5g8vga4jqjiQ0ThuV5jNLmNjqXWa/wBK9nI9tVG1pMnJ5B4IP84OH6qoZQvoRZP7lnaZa0Y5RPdHaMmsdPfxTjozvi5pLtvg50wHwcguhEWF606l02jmk+V5tWQmogsdvlrO5B27xzR7rd/LdxA3+KDVHFPxl2Ph5koMatFtnzXU287MtWK20F8riejXzcu5Yzfw8z12GwJGocZ4Fcz4gslpM54nMunvcgf39NgVmlMNso2nq2J5bsXcvgeXqSOr3dd+f2c2jsmQ4zUcQeeH8uak5zLLVx19UzrRUfOWsjhb4MDg3fp+rygdFbSDqcYxOy4VZ4LVYLVR2a2wNDIqWhgbFG0AbDo0BdsiICIiCRO0w02nvuhMOoNhpmjNNPq+G+W2uY39JHG17e+Z06lpAa4t/cConRnUSLVvSXDs1ihbTNv9ppri6BruYQvkja58e/nyuJb9F13EZBHU8P2pkcrQ9hxq5HY+oppCPxC072ZN5qLzwW4B7Q4uNIyppWEnf3Gzv5fuB2+iCpVLXaI693LRjRCO04y90eaZpWNsNpkYNzAZNhLKPi1h2Ho57T5KpVEnGLQR5bxqcLGOVbQ+iZcqy6Fjvsl8LBKOnziCDfnC5w5Y/wANGlNrxm00sRujo2zXe5lu81dVuAMkj3Hckb9AN9gAAtvoiAiIgIiIPTWUcFwpJ6WpibPTTsdHJE8bte0jYgj0IUJ8B0k+gXEPrJw7V1RJLR0NUMjsJf0aaWUMLuX6SRA7dOZrviryUQ66XCHT/tNdB7zCwNfk9krrHWlo6vYA8xb/ACkcz6BBby09xjOmbwn6wGDm5/zUuYPIOvL7M/m+nLvv8N1uFYLrxj7st0O1EsbGl77njlxomtHiTJTSMA/rINb8ADaNvBzpZ7EAIzaWl/hvz87ubfbz33VBKSuywu0l24LcNdISTTz1lM3f9llQ8BVqgIiICIiCOOOjePXPhVkj92b8+4mczftch5A4fIjxVjqM+L2qZdOMnhRsLN3T/le4XJ3L4tbFEw/cdnfcVZiDX/EDnb9MtD86yqI7VFqs1TUwknb9KIz3f9YtWkOy9xGkxfgzwqpghEU94dU3Codts57zO9gJ/hY36LOuOj/BD1V/5kl/tC4PZ/bf7jXSrY7j8k//AIsiCg0REBERBhWt15fjmi+fXaJ7Y5KDH7hVNe53KGllNI4Eny8PFT32VVCaDgrxAODh3tVXTDmG3R1Q/wAPgtycWH+CzrJ/kZef9RmWvezehZDwYab8jQ3mpJXHbzJmfuUFLoiIChLtJaVt51Z4W7SGl8lTnETeTw3aZadvj5K7VFfF+38scaPCrZ9ufku1ZcOQnb+SjD9/XpyeHwQWoiIgIiICwPXvFYc30SzywzjeK4WSsgI+cLtvxWeLHdRrpDZNPsmuFQQ2GltlTM8k7dGxOP8AsQTt2X19nvfBRgcdTL31Rb311C5xO5AZWTcjfhswsA+ACqp7wxjnOOzQNyVI/ZW0ToeDHF60ghlxuFzqmA+Q9slj/tjKrC5vMdtq3NOzmwvIP8JQQ92WFqdU0Wu+Uvd3rrpndVSiUjYuELQ8f6wrqUfdltG3/c5Xmp2/TVWXXaaZ37T+8a3f4dGjwVgoCIiAiIgiHVq1HSvtM9IctoSKK353aquxXZsY5RUTRQyOhLvVxd3A39IwreULdpLcTjmpnDHfIS4VFJm8J6ebQ+EkbfHqPqrpQFEXZf1DM5s+s2p08LRccqzapHe7buNNExhibv6AzSBWndq78mWusrOTvPZ4Xzcm+3NytJ23+ij7slLP+S+DSxzFvK+uuddUn/reQH7mBBZaIiAiIgL8c0PaWuAc0jYgjoQv1EEw8QXZ9aX60UlddLTaY8Hz3bvKLJbHzU745h1aZI2ENeCehO3Nt4ELjdnxrlkWrGmF/wAczapFZm2B3eXHrnVDqakRktjlcfMnle0nzLCT4qp1DXZqW+WszjiZyYBvsdyzyopISwbNd3L5nE+vUTsQXKpg7Q/W+p0e4fqq3WSo7vMcwqWY/Zo2/b55TtLIPQNj5uvk5zPVU+oR4kJoNUu0h0CwGug9otVhpKy+zRuG7TKIpJGE/Dmp4x9UFMcL2hVr4dNEsbwu3RN9ppqds1yqgPeqq14BnlJ8ertwAfBoaPJbWREBERAXCvNkt+R2uptt1oqe42+pYY56WqjEkcjT4hzT0IXNRBCeoHCBl/C7ktdqfw1V81NSs3qLtptUvfLRXGMdXtgBJLXkeA8QejSB7qozhi4msY4odPm5FYRJQ3CmkNNdLLVECooKgeLHj0PiHeY9CCBuBQLqdTR8KnaIafZNj9IKPGtWWOst8o4vchdV87QycDwDg50TifQv83EoL6XjJI2GN8j3BrGAuc4+AA8SvJaf4wsqqcK4WtVLxRvdFWQ47WMhlYdnRvkiMbXj4tLwfoglLT2zy9ohxOXfN8lhfLovpzWm32KzyN3prrXNJL5pPJ4GzXEeHKYm7dX7/QuKJkMbI42NjjYA1rGjYNA8AAtB8BmB0mnfCTpvbKTr39tbcJn7falncZXn737fIBb+QEREBERAUv8AE7wO2XWS4w5phNyfpxqtQP76myS1AxGpcB0ZUBpHMN9ve+0PiOiqBEElcMXFhk9y1EqNE9a7RHjuq1up++p62IgUl8hH+Oi8BzEBx2HQ8rttiC0Vqop4y47czjC4VJLe2L87n3qra90QBmNAGM5w/wDd3dJtv+/t5q1kBQppXjzOI3tEdR88uz47hjmlzWY/Y6cnmYyv2HfSbeG7Hd+Pm5h8Wq61AnY+Sz3bSTUW/wBUeeru+VTVMzy4kueY2kk7/FxQX2iIgIiICIiAiIgnnj10Wj1u4ZMtt0LGtvtpg/LVpqCPeiqKf9Js0+XOwPj/AI9/JZVwkanP1j4bNPcunnFRWV9qjbVyDzqIt4pv+0jeto3a3su1qrKGT7FTC+F3yc0g/wBqirsljUWrRHPsXnke9mPZxcKKBrvCOLuoDyj+PvHfxILgXrqKiOkp5Z5niOKJpe9x8A0DclexeqrpY66lmppm88MzHRvbvtu0jYjf5FBEvZUUtTlWlud6pXdrZb/nGUVVZPU7e93TNmtj3/Za90uw+Kt9RN2TFXVWzh5yDCrnD7LeMRyiutlZTu6PY/drzuP5znD+Eq2UBERAREQEREBERBgWvWnVDq1ozmWI3GnbVU11tk0IY4b7SBvNG4fFr2tcD5EBaJ7MDUqv1C4TbNR3Xd1xxWtqMckkJ6vbDyui+6OVjP4FVdxro7Zb6qsmO0NPE6Z59GtBJ/sURdkYw1OhGc3NvSGuzWufH02BaIoDuPh7230KC5V66mpjo6aWomeI4YmGR7z+q0Dcn7l7F0ub2+ou2GX+hpHOZV1NvqIYXN8Q90bg0j6kII/7LC21GSaXZzqtd4G/l/Pcnqq6SoI972eMhsce/jyteZtvgVbSkrss7zT3jgxw8QcodST1dLK1vk9szvH4kEH6qtUBERAREQEREBQdx71r8M4s+FPJrc0i5z3ist0pYN3SQl9K3l9SNp5N/mrxUJa9XCLVTtMdEMHdF31JiFtq77Ub9Q2V7C9u/wAP0MP1KC7UREBERAREQEREBERAREQEREGteJDSWl1y0PzDCqqFs7rnQPbTBx25aho54Xb+W0jWlag7NrVys1K4a7ZZL0zuMkwmU4zXwPP6RopwGxFwPUHkAad/EsJ81VKhDC2s4YO0kv8Ajrad8OJ6xUTrnSvJ2jiukZfJIB8HHvenjzSs8ggu9ERAREQEREBERBHPahai3KyaEUGn+OSg5PqHdYLBT07D+kfA9w70NH7x5Iz8JCqa0mwSn0x0xxbE6WNkcNmtsFEGx/Z3YwBxHzO5+qjjHWniv7Rq4X4wR1uA6O05oqOcHmjmuzwCXfEseX7becDD5q80BERBEPFBJS4d2hvDRklSOVt1pLjZu8Phu3bl6/Oq/EK3lEvagY7FacX0r1YMj434BllLUTlv/wCqTyxiXb480UP03VqUdZBcKSCqpZmVFNOxssU0bg5r2OG4cCPEEEHdB7kREBERAREQFxLxdqSw2msuVfOymoaOF8880h2axjQS4n5AFctSJ2lmqNfjeidFp7jm02X6jXCPH6KFrvfZC87zSbeO23Kzf/hd/JBh3Z92mu1y1S1P4l8gpyybIqySy48xzt2wW6FzWkN/6uNpcPEtf4blXYsM0Z0xtejOleL4VZoG09BZqGOma1v67/tSSH957y95Pq4rM0Bau4qLO/IOGXVm3QxmWeoxS6MiY3xdJ7LIWD+lstor0V9DBc6Goo6qJs9LURuhlieN2vY4bOB+BBIQTT2a2SnJ+DHT2Rzw91HBNQkg7/ycz27KnVFnZY3WntWkGbac94TX4NllfbZY3ePdukLmP+rhKP4SrTQEREBERAREQERdHnOSw4bhd+v1Q4MhtlBPWPJO3SOMu/2IIk7JeVtyx3Wm7MI7q4ZnPMwNO4AIJ6O8/teKvdRp2TWMx2fhHoLuGFsl+u9dXFxG24bKYR/oirLQeE8LaiCSJ32XtLT8iNlDXZY32e22bWfTmpYWHE8xqHwtcNiyGoLg1ny5qd7v4yroUIaOyz6T9qNq5ifcez2rN7NT3+m3Gwkexred4/6Q1I+hQXeiIgIiICIiAoX4X7jX6q9oTxAZwIybHY6SDGaedp3Y57HNGwPn0ie4jy5h6qrdddUKDRfR7L82uTg2mstulqWt327yXblijHxfI5jR8XLR/ZoaaVGA8Ltqu1ylfUXzMaybJa+eUe+58/KGgnx+wxh+bneqCq1o7jexO4Ztwn6m2i1QTVNwltEkkUEHV8nIQ8tA8+jT081vFCAQQRuD5IJ94BM+t+oPCJplU0Bja62WeCz1MTD1jmpmCF3N6F3IH/xqglAmDxHgc42psKY32PSHVUvq7RC1u0NuugLd42nwDT1by+kkfk3rfaAiIgIiINf8Qv8A5gtS/wDJm5/6rItG9ltE+LgtwsvaWh8tW5u/mO/f1W0uMHIosV4XdT7jNJ3TG2Gqh5t9usjDGB9S9dDwD463GODrSmlDeUzWWOuO46kzl02//aBBv5RVxaTR2Hjj4V7zUvDaaWurrc3c7fpJYu7Z1+LpGhWqob7VjHa2hwDTXUmhf3bsJyqmqZ5AdjHFK5o5/pIyIfxILkRcW13GG72ykrqdwfT1MLJo3A7gtcAQfuK5SAiIgIiICh3iUtoyjtJeGe3Rk89BRXK4ykOHutZHI9u/zMe31+64lEVJdxmna11tL9qHDsE7noejZpnRybn5x1A+4ILdXhPDHUwyQysEkUjSxzXeBBGxC80QRp2Tsb6HhRFqke58tryC40b+YbbFsoJ2/pb/AFVlqKuy/ujI8S1kxwjknsuoVzZ3QO4ZG/k5dv4mSfcrVQEREBERBDeqNDNl3awaV00Q54Mbwua5SEj7DpJKuM/g5iuRQroLfzqD2nuudyd70OP2Ons8BHUM5HRtePq/vD9VdSDV3FJicuccOOpNkp295UVdhqxEz9p7Yi5o+paAta9mtdY7pwVabckvevpqeop5DvvyubUy9PoCFTE0LKiJ8UjQ+N7S1zT4EHoQoZ7M6U6VXTV/Qe51vPdsOyCWqooXnrLQShoZK0ehPK4+net9UF0oiICIiDVXFh/gs6yf5GXn/UZlgHZxf4GGmn/IpP8ATPWccXtW2i4U9YpHAkOxG6x7D1fSSNH4uWKdnza5LRwb6Xwy7h77Z3xB8uaR7h+BCCh0REBRDrpVMrO1H4cKGQc7aezXiYNcOgJo6ogj47sH3BW8oW1o/wDSw8Pn+T90/wBTrkF0oiICIiAp47QPP6bTrhC1HrpqhsE9bbnWul67OfNUERtDfUgOc75NJ8lQ6gvjzln1u4k9CdB6eA1drnuYyS9xx9doIuZoLvQCPvvHxLgEFMcJOmLNHOGzTzEW797Q2qOSo3//AFiYmabb4d5K/b4La1bH31FUR7E88bm7DxO4XnDCynhZFG0MjY0Na0eAA6ALzQRn2WNzZNofnFqHuvs+dXWk7t3RzWnupBv/AEyPofRWYoR7NanqMU1Q4mcOqgY5Ldlwq2scep70zAn7mM6/FXcgIiICIiCEe0yojes+4ZrVC7++arOIY2NA3PvSQtB+8q7lE3E7Wx5d2gfDPhoHeewGuv8AM0fqd3DI+Mn5mAq2UGP6hTVFNgOSy0rO9qo7ZUuiZtvzPETi0befXZTp2YMcMfBfg3cP5wTUuf18HGd+4VQXehN0tNbRh/dmogfDzkb8vM0jfb6qQeyWvQu3BpYodwX0NyrqZ23l+lLx+DwgslERAREQEREHT5jk9HhGI3zIrgeWgtFDPcKg77bRxRukd1+TSpR7KennqOFj8vVbOWsyC/3G5zH9pzpeXf8AqrMe0Y1Jbpnwg5/UA/3xdqT8iwjfbrUnu3f1C9bA4VdPBpXw6ae4y6mNHU0dmp3VMLhs5k72CSUO+Ie5w+iDaqg/Uamlw/taNMrxWMDaDJMaqbfTzSn3WyRwznZvo4uDW/Hn+KvBR72mGmFdedI7RqfjjZhl+m1wjvVJ7O4h0lPzsE7Dt16ANf8AJjvVBYSLEtJdRrbq7pljGZ2mQPoL5b4a2Mbjdhc0FzDt4Oa7maR5FpCy1AREQEREBQZxvSz5xxqcLmEUMRqZqS6vvdQyP7TIWyRukcfQBlO8/RXdV1cNBSzVNRK2CnhY6SSV52axoG5JPkAAoV4L6k8SvFPqvxCTRzGw0m2K4syob0bTs5TJK30LuUHYeHfPCC71qniuxKbOuGbVGx0sLqisq8crhTQtG5kmbC58bR8S9rQtrLxkY2VjmOAc1wIIPmEE+dn9nLNQeEDTa5NIMkFv/J8oHk+ne6E/L7G/1VCqFuB2tk0U4ltdNBq2q3o4biMlsUJ6BsM7Q6Rrfhyvg6DoC13qVdKAiIgIiICeCLS/GJrgeHnh2y/MoAx91hpxS22OQ9HVUpEcZ28+UuLyPMMIQTroPE/iZ7QHUXVSeBtRiun1MMWsdQHbsdUhzjI5vqRzzOJ8u8YryU78AujZ0U4X8TtdTTPprzdIzeroJftuqZw0nm+IYI2/whUQgKB+yDiNr0r1KsZLgbVls9OWP25m7MaOpHQnor4UT8EMdNgfFBxRafMIidHkbMggg8NoqppkHKPRoewfUILYREQEREBERAREQFEvZoAOruISWMAwP1Aqwx7fsnZo32Ph5j7wrIyW6Cx45dbiXBopKWWoJPgOVhd/sUadkfb62bhyyXJ6+NzX5Rl9fdIZH77yR8kMRPx2kjlH0KC3UREHz9yGvq+DLtBJL/XySw6X6vMbDUVLjy01JdGkBpefAO33O523bM7x5Tt9Alqnie0As/Evo5e8Iu3JFLUM76grHM5jSVTQe7lHy3IO3i1zh5rUvAJr1e83xO66YahGWm1VwGT8n3SCrkDpqqBp5Y6gH9cbcrS7rv7p394bhWCIiAiIgIiICIiDUHF5qRBpLwz6i5ROf/JbTJDEB+tNMRBEPrJKwfVYv2fum0el3CJp1be5MNZW0Au1XzjZ5lqXGY83xa17W/JoWm+0Nulbq5qlozw92epZvk12F1vUPj/edPu8c37uzJn7eZY30VzUlLFQ0sNNAwRwQsbHGxvg1oGwH3IPaiIghfs6aqk0m1H1y0Hlc+OosGQyXq2Ml6GShmDGbN+DOWLc+feK6FBnHVaLlw6a44DxNY7T1FRQ0b2WPLqKlb1monH3ZT6kAub182xeHVXHj9/t2VWOgvNprIq+118DKmmqoHczJY3gFrgfQgoOwREQEREBERAURcL81Lqrx9cROetgL4scipcTo6h4/Wa5wqAPiH04HyI9Vvni514h4ctBclzHo65xw+y2uEjfvKyT3Yht5gE8xHo0rEuALQ24aJcPltGQB5y/JJn3+9PmbtL38+zgyTz5mt5Qd/1uZBSKIiAiIgIiICIiAiIgIiICIiAo27TnTyrrNJcf1UsYlGS6aXaG8w9wdnPpjIwTN3Hhtsx+/kGO9VZK6fMcYpM2xK84/XtD6K6UctHMHN392Rhaen1QcTTfObdqbgGO5baZO9tt6oIa+B3nyyMDtiPIjfYjyIKyNRD2YeS12JY1qBoZf55X3/Tu+1EETZd9jRyvJYWb/ql4kcPhIFbyAiIgIiIC0jxk6/U3DhoFkWUiYNvc0f5PssAHM6aulBEYA9G7Oefgw+ey3coIymki42eOejs0crq3SzSLaorpGHmpq+7kgiEeR5T0cf8AgnjwcCQ3dwF6HT6G8OtkpbtG38676598vcw6udUTnmDXH1YzkafLcOI8VRKAAAADYBEBERBq3ih0rj1q0AzjEDTipqa+2ymkjPj7Swc8O3oedreq1p2cmrbtVeFXFIqtrorxjEQx2uik+211M0MYXA9QTGGb79d91Tq+cuMa1YRwTcdetWP5bdH2LEMxp6fJKaUQSzshrXkulaGRtc4c/PK7fbYcgHog+jSKTZ+1Q4aIYy5uoE8zt9uSOxXDf8YAPxX5B2qPDTKHc+fVFOQduWSxXDc/HpAUFZopRHal8MxIH90WT/7CuP8A+brn/wDhMeGz/wCsun/+zaz/APIoKfRS+/tM+GxjHOOpUBAG+wtlaT93crrKjtT+G1jP72zesuEx8IKaw1/O75c0LR+KCs1B1gjh4p+0jud3cwVeG6O0PslLPG7mjluz3DcfHkJl6+Rhb5FdZrR2tuLWPBbrPg+D5hXXN0ZhpbrdrYKS3QyO6Bznl5cSPEN5Rv6rd3Z8aHx6McN2PzVe0uSZRG3ILvU78znyztD2MJ8yxjmtPx5j5oKWREQEREEHaO1cehHaZao4SaX2W06kWynvtHJts19REHuO3wJfUg/EBXio47R3ArlbcZxDW/FYJX5ZpncW1xbAeU1FA9zfaI3kdeX3QfgC/wBVSOlesOMav6fWLL7DcYH267UkdS2N8zO8gLmguikAPR7SS0j1BQZsi8WSNlaHMcHtI3BadwQvJAREQEREBTB2kupUGm3CJmRc9za2/NZYqJjPtPmn33A+TGyO/hKp9Qzxk+0a38XOhOjFPAyqtNvqjl96Y7qAyLdrA4eWzRIPj3oCCneG7S+n0X0HwXC6cAG02qGOdw8H1Dhzzv8A4pXvd9VslfgAaAANgPABfqAof46Kqp0o4leHLVyn5Ka3014djd6qndGtpKl7B73wa107h8dlcCmntGNLP7q3CNnNPFv7dZKb8vUxaNyXUwMjx9YxIPmQgpZFqThM1Mp9XeHPAcmgnNTJUWqGGpe47u7+JojlB+POw7rbaAiIgIi9dTURUdPLPPI2KGJpe+R52DWgbkk+myCJu0pu9w1EOmWgePVLG3nPb1G+tj/3ughdzPkd+6CC7490dvBWhZbPSY9Z6G10ELaehooGU0ELBsGRsaGtA+QAUM8IE1ZxQcWepevtwYyoxmx82J4o97fCJji572fR5cT6zkDzV5oCIiCXe0e0lOp/DFe66hMsORYlKzIrVUU/SRk0IPMAR16sc/6hp8ltjhs1bpNdNCcKzik3H5WtzHVDHeMdQzeOdnx2lY8A+YAPmtg3S3U94ttXQVcYlpaqF8EsbvBzHAhw+4lRP2WlddMZxHVDSy7naowbKqmiiYfJj3OJ2/dLmucP5yC4UREBERBIHao3ien4UKyx0TwLlkl5oLPSxc2xle+XmLPqGFU1pnhkenOm+KYnDIJobDaaS1skA252wQsiB+vIo14qZYtdePHQvSinqJDRYr32V3dkZ9znHK+EO+LRD0+E23mrvQFrXiT0opdcdCc1wiqYXtu1ve2HbxbOwiWFw+UrGH6LZSIJb7ODWKTVThotFtubXw5Nh0rscusMp98Ph2Ebzv196Ms3P7TX+iqRQjQUg4VO0bNNC002C6zUzpQ97uWKnu8Ye4sHxe4Db41AA6BXcgIiICIiAob4Lamk1P4xeJnUqDeaFtyprDSznwdHAwRbj5iBp+WyrXWDPYNLdKsty+o6xWS11FcQPMsjLgPqQFOfZb4C7FeFS25BV0pprtmFwq77U8494tdK5kP8Jjja8fz/AIoK7REQQpwD0j8O4qOK/E5SY2i+0lzp4tthtK6qc9w+fNGrrUK2GSo077WjIKLk7mgzbEI6hvTZsjog33vieaB4+qupAREQERYVrVqPbdItJcszG7zCChs9umqXHzc/l2jYP3nPLWj4uCCU+z3tcd81t4n86aRKy4ZebdDIP+CMj3+HT/Gx/crhUk9l5p7V4PwoWu53GQyXLL7jU5LUE+s3Ixn3shY75uKrZAUHcVlt/wBzFxf6a8QNJJHRYzkMoxPKiGnp3jSY5XbeRbGDv5GBvjurxWi+ODTNurPCxqFYm0raqsZbn11I1w3LZoP0rS34+6R9dvNBvJj2yMa9p5muG4I8wvJaL4HtUazWHhW09yS5PEl0dQexVjvN0tO90Befi4Rh5/nLeiAiIgl3tMMy/M3gzz1wO0l0jhtbCf8AhZWh39UOC25w443JiOgOndnmY6OeksNEyVjh1a8wtLgfkSQpf49Kt2sevGheg1D3dbTXK7sv+R03Q8lBA9pAd8HNE+3xa31VzAbDYdAgIiIChnjUulJpJxjcNGqFcO7t7a2rsFXNt0Y2ojMQe4+jRUOd8gVcy0Pxs8P7uI3h/vmO0HdxZLRll0slS8dY6uE8zWg+XO3mj38uffY7IN8Ip84JeI2l4g9HaJ1bIafN7ABa8jtk7eSanqo/dLy0+LXgcwPqSPEFUGgIiIChTguqabXfi9141sjldU22kmZidjc/q0U8ZYXyN38A4wscP+Md6qoOJbUd+kmgeeZdEQKm12meWDc7fpS0tZ/WIWq+zb0yfppwjYb7XSey3W/MkvlXuNnO79xdET/0PddPLdBT6IiCFNPzXaZdq3qHZ5GGntOdY3BdqYH7Mroo42OcPj3kc6utQ12g89VpFrJoHrhTyNgt9gvf5GvMgHU0VSRz7/AME23xcCriilZPEyWN4kje0Oa9p3DgfAhB5oiICIuLdbjDZ7ZWV9SS2npYXzyEeTWtLj+AQRZp3WUOq3alah3mId/FgWK09jil290TyO55CPiDJKz6FW6oa7Lq3My+06u6uTQllZmWX1bonu33MDDz7g+YL5XD5sKuVAUQ9mXFBg8uu+mRkAqsazeoqGRE9W007A2I/wD7u771byhANg4du1Ec97JYbHq1YdmSbfozcI39R/O/RA/ATD1QXeiIgIiICIhOw3PggiDjjlOr/Edw/wCitFKyohmuxye/0u++1HTuaYw4ej+WoHzDSrfUJ8INE7XfjI1t1wqaV4tNqnZilhncd2PMQLZyz5NZGenQ98firsQF1+QWOlyaw3G0VzO8oq+nkpZm+rHtLXfgV2CIIU7L6+VWEQaraGXV8puGBZHUezCU9DSySOALfRpcxzx697v5q61DmfT1GiXaf4TfmNZTY/qhY3WSufvsH1kDSYnH94llOwfBxVxoCIiAiISACSdgPNBH3aSay3HGNMrVpdiBFRnuo9W2zUdOxxD4qV3uzS9PDclrB/Pcf1Vv/QDRy06BaQYzgtmZtTWqlDJZT9qedx5pZXfFz3OPwBA8ApM4aKGm4sOMzULXCsnbdMSwyU43iMb2e4XtH6Sqb8Nuct8/0wPQtCvVAREQQ1xOsZo92gGgGo1PS8lPlgkw+5zNGzS97w2AuP7RMw/hi+CuVRl2rdJV0fDRRZVbRy3TF8ioLpTTgdYXNeQHf0i1UdpVrjh2rmLWO7WS/wBsqJrnRxVQoY6uN08RewOLHM35t2kkHp5IM/REQEREBQbxXMh4qOMPTbQeH++8VxofnPlpif0OwPdUzviRy7/CcEdWqw9XNTrLo1ptkOaZBUtpbVZ6R9TI53i9w6MjaPNz3FrQPMuCmPs4dJrkzFsk1vzCNpzbUysfctuu9NQl28UfwLju/wDm92OhBQWWAAAANgPJERAUJZ3cINB+1HxK+yRvZa9TsedZKiTb3W1THt7s/Pmhhb8A8q7VHPag4RcazQyz6i2ANZkWnV6p79DJ+sYN+SVg+G5iefhEUFjIuiwPKabOMIx/IqORs1LdrfT18UjPBzZY2vBH9Jd6gIiICIiAiIgmrtEtVZNK+FHMH0Mwjvt+YywW2PfZz5Klwjk5fi2IyuB9WhbJ4aNOHaRaAYDiEkbY6i1WiCGoDBsDMW80p+Ze5x+ql3X6lbxUcdmn2lkLG1uH6dR/nLkr2P3Z7Q4bw07vUkiIEfsyP9CruQEREBQdx0Y1ceHfWDCeJ3E4XthoJmWfMKSlbs6qoZCA2RwH2gNg07+fdHy3F4rENX9N6DV/THJsMuYHsd6oZKRzj+oXD3XfR2x+iDIbFeqLJLJb7vbahlXb6+njqqaeM7tkje0Oa4HzBBBXOUI9mFxC2M6DSaeZVf6K05HhVfPbTBc6tkT3U/eOczbnI3DSXM2HgGgK5bfcqS7UzaihqoKynd4S08gkYfkQdkHJREQEREBEXQ59f3YrguRXphAkt1uqKtpPhvHE5w/EII34YqiPXPj3111LqaISUWIiPD7LO8cwjMbnMncw+RcY3HcfqykeZ3uZRT2SVnqI+FupyOsDn1eSZDX3Azv+1K0OEW5Pn78cnVWsgIiIOhzzCLPqVhl5xbIKRtdZrtSvpKqB/wCsxw23HoR0IPkQCo/7P/K7rpBleZcM+aVkk96xOV9bj1XIzlZX2p7uhZ18Wlwdy+XOQN+UlW8oY7RewV+kuWaa8SOO08s9ww+vZb71Twnb2i3Sl32j8HFzf+lG/RqC50XFtV0pL3bKO40E7KqhrIWVEE8Z3bJG9oc1wPoQQfquUgIiICIiCDeI6Y8RvH3pXpF+lfjeEwuyq8xt6xyz+66EPHgQ0CNoJ/35w81eShjgHfUahcSnE9qPXs70vv8AFj1DUHqGxU7pg9jT6ECnP3K50BERAREQEREBERAREQEREBERAREQfOvjMzO88I3Gjger2P2yW9UOY251hu1ipXBj7hLHsI9jsff9+HY7f4vbwcVtJvE9xMSAPZwtVgY7qA/I6QHb4gu6FYxxeim1Y45uG3TPZzxa6moyat2b7rY42mRoJ9Heylv8Q8yrpQR7/um+Jr/1W6r/AO8lJ/8AEn+6b4mv/Vbqv/vJSf8AxKwkQR7/ALpvia/9Vuq/+8lJ/wDEn+6b4mv/AFW6r/7yUn/xKwkQfNzik4+Ne9KNMax170Qn09ku+9vosgnucdXHBM5rj0Ee4D+Vry0Ej7O/XZb+7NTS12mnCViU9dQOpMgyLvr3cZJW7SzGaVxhc7fr/Id10+J9StZccTHcRvEro7w90sHtlpirPzqyQxu/kqeJr2tDv2QWOkHXxMrAFdtLSxUVNDTwRtighYI442jYNaBsAPog9qIiAiIgKDrXh9HqF2tmR3OalhrKPFcMidJ3zA9rKiTljYNj4EsmefkCrlvN3o8ftFddLhO2loKKB9TUTv8AsxxsaXOcfgACVFnZsw1Opd41m12rBI38+8ifFb4px78VFTuf3TN/g2Rren+9hBYtPhWO0kfdwWG2Qx778sdHG0b/ACDV41WC43XtDanHrVUNB3Aloo3AH6tXeIgxo6Y4cR/9E7H/APZsP/wrrzojp0TucBxcn/mam/8AgWaogw2HRfT6mlbJFgmNRSN6teyz04I+RDF3NJhePW9gbS2K2UzQdw2GjjYAfoF3KINDccGJQ5Hwj6oW6Gjie/8AI8s8TAwbB7NnhwHqOVefArmT884QtKbrI4vkbZIqB7jvu51MTTEn4kw7ra+oFmjyLA8jtUrQ6OtttTTODvDZ8Tm/7VMXZV3dtx4OMdpWkH8mXCvojsd9tp3Sf/iIK8REQEREGC680D7podqJRxsbLJUY7cYmscCQ4mmkAGw6nqfJfNXgC7PzTfX7h7t2a5LecmbcamuqYXU1quApoGNjfygcvIST5k7+a+qOUMa/Gbu14DmGjmDg7wI5DvupD7I3/Azs/wDztX/6VAf2UOkAl54Mgz2kG2wZDf8AYD5bxk/ivTUdmVQ0EXJjet2p+PjruI7294Pp0BarVRBD0XAtrfjFSyfGeK/NHPY7ma2/GSuZ08AWSSuaR8CNl29ZinG9hsXNbs4061Bjb1c26W11BO74NETWs3PxIVlIgiCr4weIzSynaNReGm43NkfSS4YlXtq4nD9vaPvOX5OIWRYj2pGil0kio8snvum93ceU0WS2iZvX4Pia9u3xdyqvVjuW6c4rn1MafJcbtN/gI2Mdyoo5xt6e+Cg622a1YBe8fnvtvzSw11oghNRLWU1wikjZGBuXEh3QbKTeAFh121d1d4jq6hq6aO/Vn5Dx1tWesVui5C7YeG7nMi328C123isU49ez90msOhma6gYVj78QyG00vtjobPO+OkqWBw5mOpzuwDYnbkDfAKm+BWnttNwgaSttbGsp3WCnfJy7dZy3eY/PvC9BvZERAXprKSGvpJ6WpiZPTzsdHJFI0Oa9pGxBB6EEHbZe5EHzt4MddMV4TrfrbphqPeIMWtGC5G6qtstTzyPko6p7uRkcbA58nKWNd7oJ/TD4radx7VHQpkD32SpyXK5GglsNosFQXOI8ADKGDr8StacQmnWO6edpXpVmmQ2ujulg1Ao5LO6KugbLFFcYmtiY7Zw23cJIAPPcuV72zGLPZWtbb7VQ0AaNgKanZHsPoAgjAdpjdr5IGYrw6alX5zvsB1EYy76MZIufDxM8VebQOdi3DOLPGenf5Le4aYs6ePdvcxzvoFaaIIwoafjqybZ09VpXh8Lupa9s9TOzxH6oew+vj6LTPGnotxP2jQDK8syfXlt7tluhZJW47YbaLZHLA6RrJGmSLldI0B/MQ/cEA/BfTVap4sbQy/cMOq9A9vN32L3Hl8ejxTPLT09HAH6IOi4HbFbMe4SdLILTCyGmmsVPVOLGcveSyt55Hn4lziSVvNaF4DpnT8Huk7nPLyLFA3cnfYDcAfTbZb6QEREBfOu262Yzwr9pPrFS5xdosaxPM7RRXKmrKhrjEKqOKIdS0HbmIqevqGjzC+ii+eHGbhGOXDtDeHefKrFR37H75DPbKqjroRLBPJtIyIPa7o7lfKx2x9PNBdGF6oYhqNQQVuL5Pab/AE07eeN9vrI5uYfJp3WTqS887MbRbJrqbxjVLeNNL2DzNq8QuDqVod5HunBzGgejA1Y7auGDig0rml/MniJbk1uG/d2/Nrd7UXeOwMp53t/hI+SC1lwb5e6DGbLX3e61cVBbKCB9VVVUztmQxMaXPe4+QABP0Uke28ddI+GAUOjFawnldUuNwaQP2nDnH9ULTXF/pXxYZRoLmN4zjUvFrbjlroX1dZjuL0kkTa6JvVzXSuHORt+qXcp8wg2T2eVuqNX871b4irvEXPy26Otdg79m0lPbYHEbD05v0QIHnCfVXCtD8CbKZnCFpWaWnZSxussRLGNA3dueZ3TzJ3P1W+EBERBGParYSLhw3wZ5SukivOCXiiu1JLESHgPqI4XbEeGxex2/lyKrNOcvp9QMBx3JaVwdBdqCCsaR4e+wOP4laX7Q+rhouC3VWSdgkYbYyMA7fadPE1p+jnA/RTRwodpdpfp/w+YHi+U0GUUdzs9ujt89RT2p1RTv7v3RI2Rp3IIAPhuDuPig+kKKT4O1K4bHOc2pzypt7gAeWpsNw3P9GArMMc4/OHnKZY46LViwQuedgbjI+hA6b9TO1gH1QUAiwqy63adZGwPtOfYvdGHYh1FeaaYdfD7Lysj/ADms5hfN+VaHuY2l75PaWcrQPEk79Agj7tNc6rbjhGHaJ49UcmR6l3mnt0gaN3MomyNMjvhu/ux8Wh4Ve4jjdLh2K2exUTGx0dso4qOFjBsA2NgaNh8goo4YakcXXFvmWvNRC5+GYkx2NYhDUR+L9h31UP3iC/4gTAHq1XagIiIIj7QaGo011V0A1pppmUlHjuQfke8zHYH2KqcwczienK0Ml8fOQK22PbI0OaQ5rhuCDuCFprjC0WGv3DrmWIxwme5zUbqq2saQCauIF8I3PT3nAN/iWMdn9rFJrHwxYtUVrXxXuxRCw3GKYnvWzUzRHu8HqHOaGk79dyUFGoiICh/tIrtc9T7hpnw843NGbrnl2jnuTN9zFQU7hI6Rw8Q0Fjn/AB7kgK4FCHC17Vrvx5a26qXCFk9qxQjErFL9psQaS15Z8XBr3k+XfEeBQW9jlgocUsFustsp2Utut9PHS08LBsGRsaGtH3BdiiIC9VVTR1tNNTzN54ZWGN7fVpGxC9qIIX7JO9zQ6OZxhtXMHVWM5TV0xhJ6xh2xPT05mu/FXQvlFolwcT6t8VHEe6l1DyPAGWjKJxC3HJ+6fIJ5pZm8536ta0gAePxW+5+APV21vBsPFdn0UbAe7hrZZZGjfx3HfbHxPkguJdPl+XWfAsYueQ3+vgtdnttO+pqquodysjY0Ek/cPAdT5KMRwccTLm+zO4qrqKP7PM2iPfcvl72++/1WkeM3gQ1JsPD7kGYXrXLKNRqmxtFdVWm7SSezGAO99zGmR2xaCXeAGwKDcnAHity1w1V1B4ncopnRPyCoda8Ygl3DoaGP3HSAehDWMHxbJ6gq8FrPhkqbVV8POnE1lZDHbXWGj7tsAAZv3TQ7bb97m+q2YgIiICIiCGuLPR6/8OGa3Pib0gMdLXUsQkzLGnkilu9KCBJMG+DZGt94kbfZL/Hm5s+0k7SzQfU/GqevrMzo8OunJvVWm/uNO+F3mBIRySD0LXHy3APRdL2pOpEuJcMtRi1A6QXjN6+nsdMIhu7kdI18oHrzNbybeYeVs3Tfgy0lwjTvHsbq8Axy8zW2jZBLW3C1wzzTSbbyPc9zSSS4koPOi44tA7hdIrfBqzjDqmX7HNXBsZ+HeHZu/wAN91syl1Nw+up456fK7JNBIOZkjLhCWuHqDzLCncJGiT6J9J/cmwwUzgQY22OnaOvyZ0WqLn2WnDbdLlLWHA5qXvHc7oKW8VkcW/ns0S+6PgNh6bIME7T3UW35lpXh2leL5BRVl9zjJqOhlpqKpZK8UjS5z3nlJ2Ak7j5jdXBZ7bDZrRQ2+njbFT0kDII2M8Gta0NAHw2C+Yd74Q8C037S3SHG9N7O+zWmmt5yG40bquWqZG6F0hB5pnveA7ljGxPiRtsvqQgIiINLcZGjA174bs3xKKmFTdZKF9Xa2+B9thHeQgHy5nN5CfR5XScBWrp1l4XcOulRuy622A2W4ROO7456b9H7w8QS0Md16+8FQnioE0NceFLtAM+0zqY5abEdTY2X+wyyu2iFU3vHSRs8tyXStIHX3I9+hCC+0REBaG47NSJNKeEvUi/07tqw28UFN12PeVMjKdpHrt3vNt6NK3yoa7Teur8rrtDtLbc4uOVZdBJUwN/XjhLQ0O/d3kLj5e4D5IN+8GOnw0v4WdNMedTCkqYbNDUVUW2xFRMO+l3+PPI5boXrggZTQRwxNDI42hjWjyAGwC9iApe7QjR+76i6LQ5RiYlZnWBVjcjs0lM0GUui6yMb67tG/L5lgGx8FUKEAggjcHyQaw4a9drVxHaOY/nNqDYDXRctXRh4caWpb0kjPyI3HqCCtnr5YWvVfL+Ari5z/SvCsAmzfHMxqo73ZLDRSOZLTvewl3dHYjk6OaQR0Ebeo2O++q3jn1itMbvbOFDPXyRgF/sbXVA/h5Izv9EFqoocn7TC9Wcu/LvDbqhZmtIDnT2yQbdN+vNG3y6r2Q9qzhpgD59L9R4X/rNFmDgOvrzhBb60Lxya1u0H4ZcyyGlqH096qaV1stT4zs9tXOCxj2/Fm7n/AMC0vUdqpjU8YbaNI9R7pUnwh/JPJv69QXf2Ka9auJzJuK3iV0DwrKdO73p3hb8lo6s22+08jJLrvUMbzEPY0OYACz3d/tu9Agv/AIHtIJNEeGLCsdqQ4XKWmNxreduzu/qD3rg7z3HMG9f2dlvdPBEBERBEHaq4vUU2mWA6l0UxgqcFyekrJJAdi2GWRrC4H1EjYfvKtKx3emyCzUFzo5WTUlZAyoikY4Oa5rmhwII8ehWoeNTABqfwqam49tvLNZ5KqEbb7y05bURj+nE1RRwj8FuVakcNmE5liPEPm+HTXWmkMtBbqmT2SEsnkjMbA2RpHLyEHx67+SD6hLHMq1JxPBoJJsiya0WKKMbvdca6OANHqeZwUe0/Z9aqXt/JlPFPntbRghpp6KaSPnb8SZSAfHrsVl2G9l7ofj92bdb/AEV61CugPMajK7m+pBd5ksYGNd8nBwQc7Ke024f8eq5aOhyqsyuuj3DqfHbVUVX3ScjY3fRxWi8+7Si86810ukujGnl/oc1yOJ9HTXDIzHSGkjc095MYwXbcrOZ3NzdNtwCVemKaV4ZglI2mxzE7LYqdv2Y7dQRQNH9FoUd8T1NLg3aPcOGWQNjgiv1NWWWaTYDmLNw7mP8ANqWD6IKU4WdA6Phq0Sx/BaeoZXVVIx01dXMj5BU1LzzSP29NyGjfrs0LbKIgIiINH8b+NxZVwiat0UzBI2LHauuAP7VOwztP0MQKkDhC7PLRbWrhlwfMamK+27Ka+me+qu1ru0kMnfNkc07NO7AByjwaF9Fc3xqHNMMv+PVGwgu1vqKCTfw5ZY3MP4OUsdlHUSHg4sNFOC2ot9zuNLK1zty1wqHu2+G3Nsg6Gk4SuI3RWapqdKtf58joiPcsOoEb6yEgeDWykvMfp7gbv5pVcXXEZo5RxDVDh2rL3C08r7vhda2qhcB4vMbO8LB8H8qt9EEgWTtUdCpY2MyisyHAq8g89Ff7FU87SPEDuGyAjfz+/ZZhD2jHDjPSvqG6p2wRs8Q+mqWv+jDEHH6Bb1v2FY9lO35ZsVtuxHga2kjmI/pArEZeGrSaeZ0smmmJvkdtu91mpyTt4fqIIk1g1Zs/aRa4Ylo1p5c6ms0xtEgvmU32OKSFlS2P7MLGSNa4jmIaCR9p5IBDNz9GrZbaWzW6loKGBlLRUsTYYIIhs2NjRs1oHoAAF8+eBfFbTinHvxM2/HrfFbbHRujggpoGBkcJM27mMaPBvNzbAdANl9D0BERAWI6vYHBqhpbleJVIDorzbKiiO/q9hAP37LLkQSB2WOdHJeFK3Y9U1BmueI3Gss1Rzn3g0TOki+gZIGj+Yq/Xyn07p9adJeOPW/R3RGXHqajuNWMjqKjI4XyQ0EMrIpg6PlcN3D2psfKQ7w8tiVvuXge1q1JrJKnUziYyWSCc7zWzFYvYKcj9kNaQwem5YUFYZVq7g+D001RkOX2OywwgmR1dcIouXbx35nKfMp7T/QGwzVFLasiuWZXGEHaixy0VE7pD5Br3tZG7f1D9vivfp32ZegmBVwuFXjNRmlz86vK6t1bzHzJi92I/VhVCYvpniGExtjx/F7PZGN6tFvoYodvlytCCP6LtGM7zCd8WG8Mme3dhP6OoqWGFnwLtoi1v9JdhPxFcX97iMlj4ZKKkhIGxumSUscg9fddKwq1UQRhScQHGDbaR0t34ZrdUhh3caDKaJziPgwTOJPyWIZ52m+aaV2WtlzXh0y3GKiONzYqyqkJo+922bu8xgcvNt1Dir+Ws+JvGosw4edRrPPGJY6uxVbOUt36iJxB29QQD9EGiezX0trbbpZdtWsllZV5nqdWyX6rmb17une9xijB+PM5+3lzgeSsJTr2eWUQ5bwY6WVcJb/e9sNve0eTqeWSA7/Pu9/rv5qikBERARF1eVXlmO4xd7rI8Rx0NHNVOefABjC4n8EHy04JuEfS/i1u+t2YZ5ZKi5uky2pZbn09fNT9wx73yuLRG8Ak84HvAjoNlRg7LDAsfkdPhGf6g4RVlpaJbbfHAN6eWwaf6y/eyVxVtk4UmXfb9Jfr1WVvN6sa4RN/GNytJBEdLwRa7YnUd/jHFdl0j2kuY3IY3XFm/lu2WR4I8Om3qu+fpjxm2Rm1DrPg+SHw5rvjgpT4D/eWfNV8iCL6qj48beGMirtH7oOo71rKxjvgXAtaPuXH7zj2/3rSP76n/AN6thEEcQ49xzXNjTU5VpJZQWjpSUlXM9u/juHxkbj4Eha14leHjifuGjmY3zJOISnqqSjtc81RYrPaG0NPUQtaS+MvZs47gbbnf0X0RWDa7Wv8ALWime0IbzmexVrA3l5tz3D9ht5oNadn5TRUnBnpQyGMRsNoEhDf2nSvc4/Ukn6qhFKXZe5X+dPBXgrHu5qm1PrLbMCSeUsqZCwdf+DfGqtQEREBYXrRpnRayaU5ThVeQ2nvVBLSd4f8AFvLfcf8Awu5T9FmiIPlTwY8bWr+MaVw6d27RG9ahTYQTbKuqoZ3Nmp/ff3cMjS07FnK5mw8AwLfP+721fpJXRVfCVqE54I600cr27fMQEH714aRyz6LdpXqhh8z4qaw6j2iPJKCPYDnrIuUSBvxINS53ryj0VwIImbx46v13uUXCVqCyQdXGrEkbdvgXQDqvfT8ZWv8AdpGw0HClkscxI611eyBm3857Wj8VaSII7dxOcTjonGPhbqQ/Y8vPkdJtv8feXTZLxW8UuOY1dbhVcML4nU1M6ZssF8gqhGA0kuMcbi9+3jyt69FbqEbhBE/ZIzTXPhhuF7q3iWvvGS19bVSbbF8riwOJ+5Wwo27KqNtHw2XO37BktDlFzp5Y2joxwkHQfQhWSgIiICIiAiIgIiICIiAiIgIiICIurym+xYvjN3vMwBht9JLVvBO24YwuI3+iCNOHW6R6wdojrxmT6bmpsQo6fEqCVw35HMeRUbH1Mkch+Tlb6irspbTVV+hOT59cIeSvzXKK+598Rt30bX8m/wBJBMPorVQEWvtfdZrVw+6RZJn15hkqqOzwCQUsLg19RI57WRxtJ8C5zmjfyG58l2ekeb1OpemGLZXWWp9kqbzboa59ve/nMBkaHcvNsN/Hx2CDLlxbrdKWyWusuNdM2moqSF888zzs1kbWlznE+gAJXKUr9pRqVPgvDFdLNbWPqMgzOrhxq208J/SPkn3LiB4/YY4fNzR5oME7O2kn1kzfVniMu9A6mrMuubrZZ2yO5jT26DlAYPmWRBx8CYum3VXGtf6A6R27QnRzFMEtZc+ms1E2F8r/ALUsziXyyH+dI57tvLfbyWwEBERARF4yysgifJI9scbAXOe47BoHiSfIIJK7STVWsxjRmi07xyXnzfUesbYbZSs+2YnOaKh/waGva0ny7wfFb60G0modC9HsTwW3uZJFZaCOmlnY3lFRNtvLLt5c7y531Ui8NEcnGHxc5ZrvXNkfg2Gl1gw6N43jqJPeEtS3fy2975yt6+4Qr3QE8EU68d3EM3h70GudVQOEmXX4/kiw0nXmkqJPdL9h5RtJd8SGjzQamyjiD1a4qNXsq060CuVBh+L4s80t6zquphUPlqdyDFTNILQOhG+3MdiQWjbfrMqz/ig4K7EMnzu6WfWzTqmkaLnU09P7JcrfG5waHggAObuf1g7xA3aOooLgt4fKfhv0CsONvi2yCrb+U75UOO75q6UAybn0aA1g+DN/EknceR4/QZZj9yst1po6223GmkpKmnlG7ZI3tLXNI9CCUHA0/wA7sup2F2bKsdqxXWW7UzaqlnA25mOHgR5EHcEeoKyBRN2ZF4q8OsGpuid4rHVF309yOWGnEnRxoZusRA/nslJ9Odo9N7ZQfhAcCCNwfEFQf2PdwdPw/ZTRuc3alyWo9wH3m8zWHqPLwV4qCOyHf7TpnqbWMB9nqcsnkieRtzDlH/vQXuiIgIiIMB1/vn5s6Fah3UO5H0mPV8zDvt74p38v47LRnZc4xPjPBjhnfxmI3CWqr2g77lr5nbH6hqdp3l9bjvCld7RanE3fKa+ksNLCz7czpZN3Mb8S1jvxW/dFcDdpdo/hOISFj5rHZqS3zPj+y+SOFrXuHzcHH6oM0REQEWntb+LnSnh2uFHbs6yuC1XOrj76KgjifNOY99uctYDyt3B2J232O2+xXZ6L8S+mnEJDWPwHLKO/S0WxqaVgdHPECdg4xvAdyn9oDby33QbOREQYDxAY0zMdDM/sr283ttirYmj9/uXcv9YBaa7Mu6/lPgr09bzBxpY6mnOwPTapkOx3/nKlr3TvrLNXwRt53y08jGt9SWkAKOuyMuLK7g7tsYI5qa71sThzbke80/TxQWkiIgIiIJB7UPErjc+G1uXWOL/x/hN3pL/SVLW7vp+7eA54+W7Sfl8FSWk2dR6n6YYnl0TY423u101e6OI7tjdJG1zmA/uuJH0XL1Fwmi1JwDJMTuLnMoL5bqi2zvYN3MZLG5hcPiObcfEKWuy3yeol4f7pgtzqu/vuCX6ssVXET1jDZCWbA9eX7QH80+iCxkREBa64j7h+SeHzUyt3Y32bGrjLvJ9kctNIevw6LYq0Rx2X/wDNvg91aqwQO8sM9Huf+H2g9D/vn/6PFBxOz/pG0XBvpUxri4OtDZdz6ue5xH4qglpTgppPYeErSSLu+6cMbo3Obtt7xjBP4klbrQEREBRD2p1NUYtgmmGqNDTmWrwjL6WqllaP5OnkDg4nby7yOEfNwVvLSPG1iX578JuqVobB7RLJZJp4o9t95Itpmfc6Np+iDcdpuMd4tVHXw/yNVCydn81zQR/auWtFcDOfy6ncJGl9+nJdUOtLaKZ58XyUz30z3H4l0JP1W9UBTn2h+RNxrg21NmJHPU28UTAfMyyMYfwJVGKMu1nrZm8JNVa6VrpKy7Xqho4YmdTI4yF3KPnyoN58I9rFn4XdKKZoAH5s2+Xod/twMf8A95baXRYFjLMKwbHcejIdHabdTUDSBsCIomsH+au9QEREEp9qTMyLgX1Ia5wa6R1sYwep/KVKdvuB+5bg4fsQt1i0C0/s4t8DKansdKBA+Nrmjmia53TbbqSSfmtK9qi4M4KMyc77IrLaT8vboVSemsjJdOsVfH/JutVKW7Dbp3LdkHruOl2G3fmNdidjqy4bOM1uheSPmWrD7rwn6M3x7nV+l+KVTneJktMPXrv+ytrognO+9ndw65F3ntOl1pg5zufYJJqTb5d09u3j5KZOL3s7NG9GuHjOMyxaTIMduNro++po47vJJA95cGiNzH7ktcTt479V9J1IPavPqWcE+XdwXBhrbeJuX9j2uPx+HNyoM17PvSuq0f4R8AstxYI7nVUr7rVNHi11TI6ZrT8Wxvjafi0qiV1GHiBuJWQUpBphQwCItO45O7bt+Gy7dAREQF8obNhGtOE9oVq3iGhmR0mP09c05JcKa7RiWgeyQsPvMIPvGSYgFuzgCeuwK+ryibTGq/J/asaq0UzQ11bhFNPE7m8Q2Wm6bfEOJ/hQcj86+O62y9w7D9JbtG0HapbLVxlx67b/AN8AfQD/AN68WnjuyCcsndpVi8L9j3tHFPOWdPAB73/PrurTRBCGcaB8ZF1xa9VVbxC2iBwpJHiitNojpt9mlxY2VsQc0nbbm33+K/exwt8sPDDkNfVOMtbX5ZWSSyvJLztBTN2cfM8wcf4la+Yy9ziN7k235KGd23rtG5R/2Q8BbwjCqJ/8tyGvqOX9j+Tbt8fsfigtdERAREQRZwwXFts7QLilsD3hz5/yTcYwAR09nbzfd3rB96tNRBgtA/FO1pz0PO0OR4FHVs2HjIyalZ+DYnferfQFimrOHw6haWZji855Yb1Z6y3Pd+yJYXx7/Tm3WVri3aqiorXWVE72xQwwvke9x2DWhpJJPyQSt2W14qLrwZ4lBVuLqi21VdQO3O/KGVL+UfRpAVZqPuyuBqOFh1yaCKe55HdKyAuBG7DNyj8WFWCgIiICIiCK+L+OHMuNHhYwypiFTTNuVbfZIXeHNTRd4wnfx6xk/RWoon4jaT8mdpHww3mZzvZ6iiu9APQP9mmDfvMw+5WwgIiIIX0ekqc27VbWC6zMdJR4tisFojcd9o5JX00jdvLq0Tfj6K6FGPApJBkWvnFXlMQD/ac0/JbZgNw9lL3jBsfAj3t/qFZyAiIgKNu1DxkUmiFn1Ptk0dDlunt5prraqx3iC6VjXx7eYcRGSPPkVkqIu03qXZnBovo+0ScmfZbDFVOjOxbSwPjEpHy79p+hQcTCO0O1Ky7ErVeYOGHO7lFW07ZW1lrhfJSzbj7UTizctPkV3n+7r1P/APVU1K/9mP8A8CsO2WylsttpLfQwR0tFSRMgggiGzI42gNa0DyAAAXJQRn/u69T/AP1VNSv/AGY//AtL4PqVlHE/2neFvv8AhdzwiDAbHU1ktju+xniMlOQJX7dBu+pgLdvID1O300UX6EXCDLO0p4h7jFyOFms1ptLHg7k7xsdJ9z2EfRBaCIiAiIggfiTkdjnag8PV1ADWXK0zW7fbxdz1AP4StV8KCeMP/wBIZwr/APG1P+eFeyAiIgKK+Je2U+adoVw02adrHMs1Jc724be8T7vd/c+FpHTyP0tRRvqJ/wClJ0x/yCq/9YmQWQiIgIiIOuyS1C+47dLadtqyllp+vh77C3/ao17JStqqXh3ybFq2QmbGMur7dHEfGOPlik2+sj5SrbUH9n5cX2TiW4qMO6iCDKpK+FhI6B00zd+nq3k+5BeCIiAoz4+gKbVvhhrmNHtUWaOiY89dmvjZzD68rfuVmKG+Nm7uvXGTwp4lF1ay7Vd0nbtzD/FNjJHw5JevxQXIiIgIiICijsw7uI7HrdjBIJsmoVxDOUbNEchAAA/nRvP1VrqEuz9pTYeKPi4spcGNjyChqWQkbHeR1a5zvXzZ+Hqgu1ERAXjLKyCJ8kjgyNgLnOcdgAPEryWtuJPPKbTLQLP8nqpBHHb7NUvbuftSOYWRtHxc9zQPiUExdm5QU2Y53xD6pQnvIr/mdTR00nl3cZMp/wBMz7lcymjs4tO4NOeDzAImRltXeaZ18q5HfakkqHF7SflH3Tf4QqXQEREBERBEl0jhwTtZbJVjlj/PbBpqM7kfpJYD3hPz5KZo+QVtqC+MqeTHuPrhZvcbywzVklsJHmJX92R069RKR9VeiAiIgIsXyzVHD8Du1lteR5PabHcr1OKa20dfWMhlrJCQA2NriC47kDp5kDxIWUIC67JLSL9jt0thOwraWWmJ9Odhb/tXYogiTslJ56Dh5yfGKoltRjuXV9D3Tj1jbyxO2/pmRW2oU4F5arCeLTik0/qW9zE2/i+08Lum0dQ972ED4xyR9fkrrQEREBaQ43MhkxfhN1RuETzHMyyTRscDsd37M2/rLd6kTtV8kOPcF2WRsdyyXKroqFv8U7XO/qscgz3gHw+bBuDvSq21DSyaWztuDmu8R7S91SAfiBMB9Fv5dLhFpZYMLsFsiDRHRW+npmhvgAyNrRt9y7pAUkaldodYrLqhVaeab4Tf9XMooi5lbHjse8FM9vi10mxB2PQu+yD033WzuMzV86GcM2fZZBUezXOG3upLc8faFXORDC4Dz5XPD/k0rHOAnQui0R4dccY6nY7Jb9ALxebg4by1M83vgOcepDWua0fInxJQYZh3aKWmmz63Ybq1gOQ6N3a5FrKGpyGP+853EgACXYADc7c32R5kKvg4OAIIIPUEea1xxAaBYrxH6b3HD8rpBJTVDCaasY0d9RT7ENmjJ8HNPl4EdD0Knfgb1lyDDsiu/DhqlM5ud4m0mz3CUnlu9tHVj2E+JY3b5tI82uQWgvCeGOphkhlY2SKRpY9jhuHAjYgrzRBDHZz1Mul2omuuhlbTOo341kct0tzJDs6WindtG8A+ILGwu3/fCudQvxo0Vfw5cRWnPEnaaaaWxxkY7mDIjsz2OU8kUj/gC/oT05o4x5hXBbrhT3agpq2jmZUUlTG2aKWM7texw3aQfQgoOQiIgIiIIQ7Ragi0u1d0B1zbI6GOyZDHY7iW9AaeYOkaSR5AMnB9ecfW7Y5Gyxte07tcA4H1BWg+PDTJmrHCjqDZxSirrKegdcqNu27mzQfpGkeh2a4fIn1XZ8GGrL9beGHT/K6g73Ca3NpK31NRA4wSO+HM6Mv29HBButEUs8d2suT6HwaRX6zXR1rsUuaUVLfyANpqNx9+NxIOzS0P+4HyQVMiAgjcdQiCIOzWuxt+UcR+Ev5g+yZ5U1rQ/wC0Iql0jWb/APsxPh5lW+ob0LraTTPtMdb8QaO4iy+0UV7haOgdNE0EgD5TSn6FXIgIiICIiAiIgIiICIiAiIgIiICnTtCdQJdOOEHUO4Urtq6spGWqnA+0X1MrITy/ENe538KotQt2g09XqrrVw/6KWyq/+dr7+W7pTtO/6CnG7XOHoGiodt+6PRBS3CzgT9MOHHTfGJofZ6q32KlZUxjyqHRh83/aOeVtNfjGNjY1jRytaNgB5BfkkjYY3yPcGsYC5zj4ADxKCFu0SdNrXqdo5w72ytkp58luQvN57v8AxVuh593n58kxb5F0aualpoqKmip4I2xQRMEccbBsGtA2AHwAUL8G76jiG4tdZddal8dTYrZN+aGPP5fsxxcrnlvp7pa4+pmKu1AUHZ3/AP1MdpRi2NQTyz4vpLbXXa4MAPc+3vc3lYfIuO8Xj5Rv281YmrWpNr0g01yPMrxIGW+zUUlW8eby0e6wfFztmj5qaezHwG7UGi931KyeY1WV6k3N99rKh7NnOi3cIR8usjgPAB/RBYaIiAiIgKZu0T1UrtMOF/IYrO0yX3JXsx2hjYffc+p3Y7kHm7k59lTKiLjapJdQuLbhcwNjy+jhu1VkVdT77tIgMJhcR8OSYfxFBRHC3o1BoHoLh2FshjirKGhjdcDGdw+reOac7+Y5y4A+gC2qiIPGSRsUbnvcGMaC5znHYAeZJUAaeubx3cZ9dm1TE+bSbSqV1FZYngGK5XLc8058i0Ec4Ho2LfxcFtXtB9d6/TrTOhwLEHPm1H1AqG2a0RQjd0Mb3Bs0xA6/ZJYPi/f9UrbvDZoRZeHDR6xYRZYxtSRCWtqtveq6twHezO+JI6egDR5INnoi/HuDGlx6ADcoIN4bnwSdqDxCmgBFI2zQNqAD0M/PT77/AB+3+KvNQ72b9PS6h5pr7rNE0vjyjKn26ild+tTU7ecOb8Hd+3+h8FcSDj3CsZb6CpqpNuSCJ0rtzsNmgk9fLwUU9kVZHUHDDcLi5vL+UshrJG/FreVoP3g/cqN4o8zfp7w66i5BGS2WislS5jh4hzmFoI+RcFrbs2cdlxzgt03ZPF3VRWU9RXv3/WEtTK9jvqwsKCmkREBEX45wY0ucQ1oG5J8AghLXurh4ge0S0o0x5JZLLp/SS5RcuQ+66qcGPiDvg3kh2PrK4K7lDfZ2WufUnUbXPXaukbVsye/PtNlnPVwoad7urT+y7eEbesKuRAWHaw6l2zRzS/Js0u8zIKCzUT6lxkOwc/wjZ83PLWgeZcAsxUL8Y1TX8TXEZgPDjZpphj1O5mR5tLD9htLGQ6KF5/eIGwP60kZ8t0HM4DeHeDLccqdeNUbZS5DqHnc77pA+4RCZtBRP6Qsja/cNJb16eDCxvTY79LxJYNj3DtxlaA6j4lbYMdflN7/Nm9QUDBDT1bZ9o2vexoDeYGTcnz5Gk+G6u632+mtNBTUVHCynpKaNsMMMY2axjRs1oHoAFDvaqVE+PWTRPLRD3tDj+cUlXUHr0A2c0fXkKC6kX4x7ZGhzSHNcNwQdwQv1B6K+rFBQ1FS5pe2GN0haPE7Dfb8FFXZAW80nCFDO4OBqb3WPAd4bDkAI+5Vvqbdm2HTbLLm95iZRWmrqXPG27QyF7t+vyU49lrbBbuC/DXgAe1TVdR0367zub1/ooKzREQEREBQrw/VdJo52kGtmARxmGkzWgpcipR+r38Yc94HzE8pJ/cV1KGeLzl0m44uHLUqCEtivc1RilxlYNh77mCEH4n2iT6M+CC5kREBSl2o9caTge1CjZziWqfboGFnxuFOSD8CGkfVVaop7Wi9NouGqzWvcGS7ZTb6flJ8WtL5CfvY370FN6DWAYtongdpDeX2Ox0cRbvvsRC1Z2uLa6T2C2UlLsG9zCyPYHcDZoH+xcpAREQFwb9a475Y7jbpQHRVlPJTuB8CHNLT/AGrnIgiXsmMmbWcO9+xYgNkxfJq6iYweIie4StJ/idIPoraUL9nVaDhOs/FBiZ6MoswM0LS7/FOfMWHl8t2lhV0ICiHtE6ye+6rcLuCxsMsF5zeO4VEQ/WipXwc2/wAOWd5+it5Q1qReWZ92q+meOFjZabD8Xqbh1G/JUzCQk/0BD95QXKiIgIiIJV7UYA8Cupnw/Jn/APE6Rbr4f7j+VtDcBqyXHvbHRu3d4/yLVrntBrF+cXBlqtS8od3dp9s2IB/kJY5t+v8Axa73gurnXLhP0oqX7c8mPUhOx8+7AQboREQFPHaDWKPIODfVKCRvOILUawDfbYxPbID9CwKh1o/jgIHCHq5udv8A5OVf+YUGScMeYt1A4dtNchB3fX49QySgeUoha2QfR4cPotmLRXArbprXwfaSQzt5XusFPOB1+zIDI3x/dcFvVAREQFCFjrDTdsDkUQ5dqjB44zv49BC7p/RV3qCb3G63dsHjz+UEV+HSAHw25YZOvx+xsgvZERBjWptW6g04ympYA58VrqngO8CRE5Th2V9tmt3BDgj5mhvtU1wnYPPlNbM0E/Pl3+RC31rvWm26J57Vh7YzDYq2QPd4DaB53K1l2ett/JPBhpTBy8vPazPtvv8Ayk0km/8AXQUOiIgIiIIY1rupxLtTtDqlpHd3nHaygnaB1ILagN3/AIww/RXOoG40Ijb+PnhZuTWgmWtdSeGx2MwB6/8ASeCvlAWqeLC+HG+GHVm4skMUsOLXLung+EjqaRrD/SIW1lLPacZQ7GeC3PhG/u5ri2mt7Dv495UR84+O7GvH1Qdx2d+Huwng503onsMclRRPr3tI6gzyvl/76o5YFoDbGWfQ3T6jY3kbFYKEcpby7EwMJ6fMrPUBERAREQQt2oFVWYJPodqXQsPeYvmED5XjzY8tcWH4OEbgfgVdDXB7Q5pDmkbgjwKk/tSLWyu4K80rC0OltdTb62Ikb7OFZDHuPpI78Vv7RfKW5vpHhl+a7n/KFopahzh5uMTeb8d0GZoi9dROylgkmldyxxtL3O9ABuUEJdkpVTXfAdWrxUSCSe5ZrVVMmw6czmNJ2O/XqVeKhXsdLTJQ8KVTVva5ray+1T283gQ1rG7j7ldSAiIgKKdZKpmVdp/opj8zO+hx/Fa29xjbcMlmfNGT49DtA37wrWUQ57QzWLtZdPLk8D2W74JPTRvd0/SMlqOZo+IBYf4kFvIiICgrgWkFz40uLK48xlcL8KPvR9naKeZnL8xy7fRXqoa7OagbV6s8UuQBpYKzUGujY13jy+0TP/7yC5UREBERBCnGjQ+wcdHCbeJC4QTV9dS7gbgOYYT+Pej7ldaibtPbmzArJotqNyFzsXzmlfM9rerKaSN5l6+W/dMHzI9FbKAiIgKONWWm19prozWu+xccRuFCzm6DmZJJIdvU7PHRWOoi4wbn+bPHRwm3Rm7XVVbcrbIS7ZpbKIIwPnvKT8dggt1ERAREQFAvBm91f2gfFTWBjWRtqYqfYHfq2Ut3+vLv9VfShTs7La25658UuVhoDazM5qaNzeoIE073df4m/egutERAUM5DFR6odrFjtJzd83BcNlrXtHUNlc/Zu/oQapp+gVzKI+DfHqXMeMjic1N7zvnU92jxWkcB0a2INNQN/wCdDD9x+GwW4iIgIiICiDhve3Hu0i4j7ICN7lbaC6bAfs8gPl/w6t9QVbPacb7YO7tdzCHIcOZI3p0LY4WD/OgKC9UREBRb2rGXml4f7NgcAc6rzrIKK18rPHumStmeR8eZkQ/iKtJQ3xLys1T7Qzh906mg9otthgqcprGkbta5rJHREj056dg/iCCzMOxumw7ErLYqNgjpbZRw0cTW+AaxgaP7F3CIgIiICIiCGOPSNv8AupOEx/KOf87mDm267d9B0VzqFOPSpjPFXwm0+570ZZHJtt027+Af7FdaAtK8XfEfScL+jFzyx1M243qVworPb3bkVFY8Huw4DqWDbmcB1IGw2J3W6lEXFLQU+qvHxw8YDWP7y3WKmqcuqaQndsrmybQFwPQ7Ppj9C4eaDBaDs0q7XDSe9Zjq1frjW65ZDTmspat9SWU9pk2LoKfuwPsjcB/jy9eXw6707P8A14u+qmmFwxLNHOi1IwOp/It8p5t+9dylzYpnH9bmEbgXDxLCfNVGoR4n7TLwtcXWAa+2tr4MUyeUYzmQY4NiZz8ognf8Pd3JPgYR+0gu5F4se2RjXtIc1w3BHgQvJBEd+uL9Nu1fx4Mh7qg1Cwx9JLIejZKmmEsgdv6iOnjb/H8lbihftI66q021C4edU6KI72LKRRVUw/3mYN5oyfRzGyjxVztcHAEEEHqCPNB+oiICh7tfWh/DDYWOG7H5fb2uafAjuqjoVcKkLtV8RflPBrklREN6iy1tHdIyPLll5HH6MlegrW3Da30oHh3Tf7AuQujwW+wZRhGPXmlc19LcbdT1cTmO5gWSRNe0g+Y2IXeIIl7VZjsg0o07w2N/LLkmaW+kA235urm+vrIFaNtt8Npt1LQ0zeSnpomQxt9GtAAH3BQ12i0z6nXfhQtskbnUc2e0bnnfoT7VTN2+4lXcgKRe0E0WvN4xmzax4CDTak6dPNxppYx/5XRN96aCQDq9oALgN/AvH6yrpeL2NkY5j2h7HDYtcNwR6FBrrh61vsvERpHYM5sjmshuEA9opQ7mNLUAASwk+Za7cb+Y2PmtjqAOHOWTg740cs0Rqg6LAc7Lr9ijne7HSz7uL6dnlsRzM6ecUfT3iVf6DD9YdOLfq7pdlGG3SFk9HeaCWlLZPBriN2O+Ba8NcD5EBTl2aOpN4vujF107yqRgyvTe6S45URb/AKT2ePpCXD4bPj+UY8yq9UL4u2n0P7U+/WOnifDbNU8dFzY1u/IK6EPdLt8S2CV5+Lx6oLoREQEREHrqaeKsp5YJ42ywysLHxuG4c0jYg/RQl2eRl0O1i1n4eLnVySy2O4m+2bvPCWgl5NnD47SQFwHm4+hV4qG+O7H6zRDVzTTiWsUc4isVbHZsqZSs3MltlJbzv28WguLevgXRkdQguRTD2kmllRqrwi5lDQgm5WFrMgpmgb7+zEvlG3me5Mu3x2VJWa70mQWihulvnbU0NbAypp5mHdskb2hzXA+hBBXurKSG4Uk9LURtlgnY6OSNw3DmkbEEfEFBrDhX1OpNYeHrA8qo5TK2rtcUcxPiJoh3UoPxD2OC2qoT4B7vPobrPq1w43mpDY7RcHXvGo3Ajmopvee1u/kA6J23q56uxBCnEPS0ml/aU6C5tK8QQZXbaywyO8jNGOUE/MVMTfoFdajjtQsUqf7iVh1GtNIai/6eX6kvlM5u+4jEjRID+6dmE/zAqqwTMbfqJhNgym0uc+2XqgguFMXbc3dysD2g7eYDtiPVB3qIiAiIgIiICIiAiIgIiICIiASACSdgPMqFOFWrh4juNvV/WSSkbPYsXYMSxqrJ5o3crnCaZh9XNBIP7M5C2xx7a/DRLQ+soLU72nN8sJsdht0Tv00ssvuPkaPRjXb7/tFo8wsw4R9BqXhx0FxjDmMYbpHAKq7TsO/fVsgDpnb+YB90fBoQbjU5cfeu0ug/DfkFbbJWtyi98tls0e/vGec8jnj4sjL3j4taPNUaoEuk1Pxs8elHbWN9t0x0ePtFTzdYbhdifdA26FrHhvQ+PdO6EOQUvwgaMM0D4dcMw91PFBcaejFRcTGPt1cvvyknxJBdy9fJoHgAtyItRcUvEXZeGLSK65jdA2qrGjuLZbebldW1TvsRj4ebj5NB89kEy8dl+ruIvW/AOGXHJ5m0VZMy9ZbWUjt+4pGE8sTtvDoC47+bovirrs1nosetFDarbSx0VuoYGU1NTQt5WRRMaGsY0eQAAA+SlrgF0AvOC4xedT9QozUaqZ9L+UblPUM2lpKdx5o6YD9QfrFo2/VB+wNqxQEREBERAULZbcHXjtdcMo5uYw2zB5RC3m6BxM7y7b+Lb6BXSoSySlNB2v2LTSuDW1eDSPj36b/y7Nvj1YUF2oi1Dxc6oR6N8N2f5U6R0c1LbJIadzDs4TzbRRbHyPPI3qgm7QSkpuKXjt1B1cqqaWbGNPN8Zxp73c0UlU3nZPUN8j0Ly34SNPiFd6nPs+dKo9J+E7BKY8xuF6o23+ue8bOdNVNEoB+LWFjf4VRiAp+48dZJNEOF3Nb3RztgvVZTfku2knZwnn/R8zfi1pe8fFoVAqFeJFkXE3xwabaNmmZcMSwqIZVkjebdj5Tv3NO8em3d7jzEx9EG+uCnSOXRHhkwbF6umbSXNlH7XXRgdRUTEyP3+I5gD8lvBEQR32p+XV9q4Z4cTs7O/vOb3ykx+nhafeLXF0jyB5j9EGn+eFVODYzS4VhWP49QxiGitNvp6CCMfqxxRtY0fQNCi7UaQ8RXaWYXidPVOmx7Su1Pvlxi5d4hWvczlafLmPPB4+TXbeauxAREQFpHjY1Fbpbwral3xs7qerNmnoaSRh2c2onaYYy34hzw7+FbuUU9qdK7JtLdP9Nqabuq7Ocwt9qi28QC/Yu28wHOZ94QbV4B9O49M+EjTm2N/lKu3Nukp28X1P6b+x4VArhWSzUmO2W32qgi7mhoaeOlp4h+pGxoa0fQALmoMW1T1Bt+lWnOR5fdHsZRWahlrHh7uUOLWktbv+8dh9VK/Zq6cXupxPLdbcyY/wDO3U2vdcmmQkllDzEwgb+DTzEtH7AZ5bLgdpFkdx1BuGmXD5YP0ldnt2jmupjfs+Kgge1x+QJBdv6Qn1VoY7YaHFcftlltkDKW222lio6aCMbNjijYGMaPgGgBB2CkrtTaOObgyyqqfHzvoa63VMbtvsO9riZzfc8j6qtVLfae/wCAxqd/Mt3/APEaVBQOm9zdetO8WuDnB7qu1Us5cPAl0LXb/isjWvOHaR0ugmnTnuL3HH6HdzjuT+gYthoNJ8bF5fYOE3VStjJDmWKoZuPH3xyf95dR2flnksXBnpRTSgtc+0CqAPpNK+Vv4PCxTtQcsixXg0zNr3ASXN1Pbo2+bjJK3f8ABpP0VE6Y4rHgum2J43DH3UVntNJb2M225RFCyMD+qgyVERAREQFHPaqWepl4X2ZJb4+a54rfqC80snLv3TmPLC76B5VjLVvFPizMz4btTLQ+H2gz49Wuji235pGQuewD48zWoMy09y+DUHAcayilZ3dNe7ZTXKJm+/K2aJsgH0DlkCmfs4M9GoHB1p/O4kz2umfaJfnA8sb/AFORUwgKBO1pPt1k0Us+zpBX5fG3umj7ewaNt/4/xV9qIu0AtpyfXbhXsOzXslzRlTIzbdxjY+Jz/pytcgt1ERAREQEREETcPFwbZO0l4mMead46ujtNxaANhzGlgc7p4f47xVsqFsAiNu7XjUxgaza4YPT1Ti0bHdgooxv6n3fH02V0oChjh5oqXUDtK+IDL2O75uOW2hs0bh4Nke1rSd/lTPH1KuYnYE+iiDsyLC+uqdfc9mdzSZDnVTRsLvtOipi5zDv16b1Lh4/qlBcCIiAiIg1/xC2U5JoFqVaQOY1+M3KlA+L6WRo/tWtezxuLLpwY6Wys22ZbHQHY79Y5ZGH8WlbuzqlbXYTkNM4lrZrdURkjxAMTgpf7KW9i78E+HwF3O+31dwpHE77/APlUkgHX92RvggrxERAUv9pdlcOJ8GGoMkrgH18UFuib5udLMxuw+TeY/QqoFEfamQjMMJ0k07ikAqsqzijiMXiXwRxyCTp5gOliP3IKu0fx5uJaS4TYmN5GWyx0NE1oG2wjgYwDb+FZcvVSU7aOkhgb9mJjWD5AbL2oCIiAoh1lpPyN2pGid0DzE244xWUhJHRzmmfcb/KRv/8AJVvKJOMKrGPccPChdHbMZV1d0oXSNPvHpTjY/D9KPvKC20REGl+NK7GycJmrdU13I/8ANutia7m22c+IsBB9d3L1cElIKLhF0ijDufmxujl322+3GHbfTm2WK9pLX/k3gk1Rm73uuakpoeb17ysgZt9ebb6rP+Eyh/JnDDpVS8rmdzjVAzlf4jaBnig2wiIgIiIIe49aeSh4luFC8tb3jI8plgc3fbrzU5H3+99yuFRX2iG1HqBw03Ie8+nzlkYZ5Hma0/8Ac/FWogKJe15mezhNhgY4D2jJKCJw9RtKf7QFbSibtVaaO76U6dWaVu8dyzW3wOd5AEuB6fxILBw22GyYhY7cd96Shgp+vj7kbW/7F3CIgIiICIiDQfHtaPy3wc6s0/7FkkqfHb+Sc2X/ALi5XA5M+o4Q9JpJHF7zj9Nu4+J91ZBxUWqO98MurNFJ0bLil0AP7LhSyFp+hAP0WJcAtS+q4OtKXP23bZo4xt6NLgP7EG/1iGsN/biukuaXl7+QUFlrKkOB2O7YXkbfHcBZetCceV0ks3B/qpUxO5ZBZ3xg77fae1p/AlBh/Zf2j8lcFuCv5eX2w1VT4Ab71D279P5qqtaC4B7K+w8HGk9NJH3TpLLHVBvXqJnOmB+okB+q36gIiICiXj5kq8A114ZtUIXiC22jJZLNc6hzvdjgrDCzmd8A1sx+eytpST2pmKnJuDPLpmN5n2mekuAPmA2ZrTt9HoK2RYPoXk0+aaK4FfqqUzVdysNDVTyO33dK+Bjnnr+8Ss4QeMkjYo3Pe4NY0EknwAUSdlNO29aWak5C1jmC75tXz9R6hjtt/P7arnUq4OtOnOVVzSQ6mtVVMC3x3bC4/wCxSd2RVvfTcIUNY9rgLlf6+qaT5jdke/3xlBaqIiAiIgl/tLcTgyzgz1AE0Ye+3Qw3GI+bXRStO4+hI+pW5tCc+h1T0XwfLoJDILxZ6WreS7mLZHRN7xpPmQ/mB+IK4/ENhn90PQrPscA3fcbLVQxgft904s/rALTHZhX2O98FOAsZJ3j6D2ujkPNuQRUyOA+ge36bIKpREQFDnaEUjote+Eu5xv5JI8/pKX48slTTcw+5u31VxqJO0ikecv4ZoqUn8oO1It5g5Ptb94wDY/MtQW2iIgIiICibsvj7Rj2tlXINqqbUGv7w+HgyMjp5dSVbKhPgZr6nTziu4ldL7jAaR0l8dkdBG7pz08r3Frm+oLJIT8PBBdiIiDi3W5QWa11lwqnclNSQvnld06Ma0ucevwBUY9kvYK2HhtueV3J7pLhluQVl1me7xe7cMLvqWErdPG5lU+GcJuqN0pnujnbZZadrmnYjvdojt9HlddwB43NivB3pZR1EXczS2ltY4EbEiZ7pWn6te1BQCIiAiIgKKuJH2bCe0O4cMnlbym/2+54+6Qkbfo9nsHr9qq2/iVqqJe0zomWE6E6hlxjOK5zSGZ++wFPM5hl3+fcsH3oLaREQFEPDzfI9Vu0a16ygQ702K22mxWjkcAS0seO/G/lvLG8/IhWpdbjDZ7XWV9QeWnpYXzyH0a1pcfwCirsqI/zl011L1BqYx+UcrzOuqZZdvttHK4EH05pX/cgt9ERAREQEREEGcW1C7JO0V4XrQ0NkbAai4Fu25BhL5d9vlFv9Feai/UKnZc+1P0pErW727D7hUxHbc8zmyxn5dHnwVoICiC8ku7XiwgncN06cBv5fppv/AHq31BdnqZb72wd+/lCyyYZHTeG4AfFHJ9BvMfrugvRan4qtGoNfNAcywt8Qlqq2idJQgnbaqj9+E7+XvtaPqtsIgmXs7NW6zVThix+C8MdFkGLE43cI5Se856YBjXP36hxYG77+YJVNKGtEqqk0A7RPVLTlzpILTqPSNym1Md/JitHO+oY3+cDM74d2B6K5UEzdpBgVTn3B5nkdBF3tztEcF7piBuWGmmZJI4fHuRL962lw4Z0dTdBNP8peQZbpZKWol2O+0hjAePmHAg/ELMsssceTYteLPK1r47hRzUrmv+yQ9hbsfh1Uh9lLkdxPD5fcGvEhNxwXJa2yiNx3cyElsrd/PbvJJgPg3byQWiiIgLBtctNYdYtIMuwud/dtvVulpGv/AGXlvuH6OAWcogkfswdTTm3C7asdrHyflzC6maw1sU3R7BG8mIbeQDHNZt+4q4UF2WuZwmdozdbTUH2XB9ZYBVUrWN2jgu7Xdd/TncZAdvOZm/QK9EEP9qQxmNY/o3qA9hMeKZxQ1Mj2dHBpcH9D/wBD6q2qKshuFHBVU8glp542yxvb4Oa4bg/cVqjiz0Vg4geHvM8KdGx9dWUTprc9/Tu6yL9JA7fyHO1rT+65w81iHAJrI/WLhsx6S4Pa3JbBz2G8UpPvw1FOeQcw/ejDHfUjyQUYiIgjbtN9Oaqs0osGq1ghecu01ukV3pZI9wXUxezv2O28vcjd8mH1KqTTPOqHU7TvGcutu4ob7bae4wtJ3LGyxtfyn4jfY/EFcvNcWpc5w6+Y7XAGju1DNQy7jfZsjCwnb1G+6kjstcmrqXR3KdMr1VGa+6e5FV2aaJxJ7qMSO5QP3edsuyC0VEfHPcoNPOJrhezoxtErMils0sn6wgqA2N/3NlcVbig7taad8OC6TXaNu8lDmVNyuPgC5pI+P6iC8UREBERAWP6g4Pa9TMHvuKXuH2i03ijkoqmP1Y9pBI+I8R8QsgRBD3AXqDddIMxyXhfzypcb/isklTjlZK4ltwtjjztDCfHlDtwPIEt/UIFwqU+OjhovGptqsupencvsGrGDSe32uVnQ1sTDzupj6k7Hl36EktOwcSNj8KXEjZ+JrSujyGkAob7Sk0d7s8nSWgq2dHtc39l23M0+YI32IIAaB7Qux1Gj2a6Z8SVghkFdidxit1+jpme9WWyV/Vjz8N5GgnwMo9ArSxzIKDLLBbb1aqhtXbbjTx1VNOzwkje0OafuIXWak4DatVMAyHEL5D31pvdDLQ1DR4hr2lvM30c0kOB8iAVKHZtZ1c8fs2baDZXJL+dOm9xfBTyTuG9VbpHu7p7Bvvs0g/ANkj+KCsNR8HodTMAyLE7luKG9UE1BK4DcsEjC3mHxG+4+IClXszs5q6DAMq0YyKrdLlumt2ntkscnQvpDI7uns38Wbh4HoOXyIVmqAuLe2VfCtxZYHxE2qKRuKXt7cdzBsR5Y2Nfs2OWT1BADt/J0Df2gEF+ovTR1kFwpIKqmlZPTTsbLFLGd2va4bhwPmCCCvcgIiICIiAiIgIiICIiAuFe71Q43Zq67XOpjordQwPqamplOzYo2NLnOPwABK5qn7j4st/v/AAjakUeNiV9xNu7x0cH23wtc10oH8Ad9N0GhOHDHblxq8R9RxE5LSz0mn2OPfb8HtFYzrOQSHVTmnw2J5uni7br7nW/FDPDrx76CaZcJ+nVPc8xpaG5Wiw0lvq7HTwSSVvtUUTWS7RNb+s8OcHHZp5vHxXDrOMPWHiqklsHDzp9X49ZalhZNqDlsBghpW+BMLOrXSegBeR5t8wGTdoHxlw6O2GLTXC62KfVHKOSig5CHC1xSuDO+k9HkEhgPn7x6DY7q4VOHGz8MWklvxW3kVd0lJrLxdHbmSurHAc8hJ67DYNaPIAeZJMtZf2UdgOi95qaa+3HIdcDILrDl9fUyby1TCHdyIubl7t2xAc4FwJB32HKvzEe1HqaLE6HD7vpZl101vp2Cgmx6moS2Ooq2jl5t9y9oO3MRyHYb9duqCzdatbMS0AwG4ZdmNzZb7ZSMPJGNjNUyfqxRM8XvcegHgPEkAEiO+HnTjK+NrVaj191bt7rfhFqeW4ThtTuYwAf/ACuWMjZ252Iceri0eDWM3yLTHg8zLXHUKm1W4lqyK51kL+/s2n1O8vttqb4tEg32e5vmOoJ6uLvBWzT08VJBHDBGyGGNoayONoa1oHgAB4BB7EREBERAREQFFnEm+DDu0K4bsimaGC+UNzsXenbxZyuaPvqP6ytNRD2klqdbMy4bc5B2ZYc7p6WZ24AbFUPhLyT5f+TgePmgt5Rz2p1wY/h3sGNSBzo8qzC1WeRrCdywvfMfD/iR9SFYyiPtQ/8A5l0J/wD2j23/ADZEFo2miittqoqSFjYoaeFkTGNGwa1rQAAPLoFy0RBwL9eabHbHcbrWSNhpKGmkqppHnZrWMaXOJPkAAVGXZm4nV5XaNQ9eL/SOhvuol7mlpO88Y7fG4hgHpzPL/gRGwhc3tNNQr6dPsY0dw9jpsq1MuLLU1kL9pG0oe0yn4NJLWuJ6BvPv0VSaUae0Gk+muNYdbNzRWSghoo3HxfyNALj8zufqgytYRrZqzZ9DdLcize+PAobRSum7rfZ00ngyJvxc4gfVZuvnzrZdqjjt4rrXo3ZSZ9KsAqW3TLq2Inuq2qaeVtMXjodveaGjqd5T+oNg2d2b+m14tWkt01Ny8PlzjUmvffq+eePkkELie4Zt5M2Je0eADxt02VcLwhhjp4WRRMbHExoaxjBsGgdAAPILzQEREBRPxVUUeecevDFjBf7tm9vyOeMHf7JjMJI/n052PzVsKDG10uUdsFJG/wDSxY5hTaZo2J7vnZ3v061B+9BeaItUcVWqUWjXDzneWPqDTT0dslZSyNOzhUSDu4uX487mkfJBNnDNFFxC8dmsGrdVSuktGF//ACRx+cu5o3SNc9k8zT68rXbfuz+qupTL2cuk7tKOE7DmVPMbnkEP5wVZkGzg6pAexp89xHyb7+e6ppAU/cfuFVef8HOqdoomOkqW2sV7WMG7nClljqS0DzJEJG3xVAriXa3xXe1VlDM1r4aqF8D2uG4LXNIII+RQag4K8iGVcKWl1x5w9z7FTxvIJOzmN5CPoW7LdSi/ssaittGjOc4RWzvnbhuZ3C0Upcd+WnAjeB/TfIf4laCCJu08t4zW1aIYGH7HIc8pO8Zv1dDHHIJPmB3rT89lbKg/igbWZx2kfDnjEO81JY6GovkkYO4bzPfzkjy6U7PwV4ICIiAiIgLwngjqYZIZWNkikaWPY8bhwI2II9F5ogiTst3w4xh2rOnMfM04Zm1dQNY93MREXlrCT84nj6K21FPCHbWYVxv8VmP+DbjVWu9QtJ23DxO6Qgfzp/H4BWsgKKeJStbfu0R4YsbaWv8AZY7rdJGOO2xbTSOaen/Eu+oVrKI79a35V2tuNzMPNBjGAvqX7j7Mkr54tvq2cH6FBbiIiAiIgIiIIxdSus/azMnDA5l20zcOboNnMqxv8+kbfv8AgrOUe5o72DtRtO5GgA12CV1M4u8wyV7wG/HcfcrCQdLm+QxYjhl/vs43gtlvqK2QE7e7HG556/Jqlrsp4JDwdWO4T7mqud1uNbM9zdi97qhzeb47ho6rd/FPUSUfDFq/PC7kmiw+8PY4eThRTEFay7Na2ttnBfp01oA76nmnOxJ6uneUFOoiICIiDrclYJccurD4OpJQdv5hUZ9kDI8cKNdTF3NFSZRXwRbgbhvJC7r69XFWdkP/AMwXP/ksv+YVF/ZBf4Lt6/ytr/8AR06C4EREBQvr3a5dWO0t0TxqKXno8PtM+R1cYJPdkPPKSB+05sLfqroURcJ9LFqXxz8RupsdQKmjtUsOH0DgeZu0fIZ9j6c9O0jb9ooLdREQEREBQd2ksTrdrRwq39vMBSZe+j6bH+XkpPL/AKIq8VGXag0sdPpvpZfie7fZdQbVVGYbbsZ+lDvH48p+gQWaiIglDtS6lsPA5qFCQ4vqZbZFGAP1vyjTO6/RpVAaP2sWTSfDKBo5RTWaki22222haFM/at3JtJwrMonP5DdMktlG1u/R57wy7H16RE/RVvj1P7JYLZB0/RUsTOnh0YAg7BERAREQRV2lX951HD/cvtCn1ApI+79eaN58f4PxVqqJu1HlNBiOi1xc0Gnp9RbcHkuA2JinI/BrvuVsAhwBB3B8CEH6or7SxzJ3aBUMrgYKrUO3MkiJ25287d/j5+StRRJ2h8rZdWeFSje0Pjk1It7nMd1BHfwjqPqgttERAREQEREGu+I3/B61Q/yWun+qSrX/AGfn+BvpZ/zS3/PctgcRv+D1qh/ktdP9UlWv+z8/wN9LP+aW/wCe5BQik/tRr/8AkDguzXqA6tkpKMDp1552b+PwBVYKHu1thkvGheCY7F7zr9m9vt7o+bbna6Kc/PbmDfwQV9ptj7MS06xaxxxmGO2WqlomxlpaWCOFrANj1G3KsjREBERAU59olXxW/gv1SklPR9ujiaN9t3OniaP7fwVGKOe1kvLrVwbX6FrtnV1xoqXl36uBl5j8/soN58K0T4eGnS1r2ljvzat52cNjsadhC2msS0ixybDtJ8KsFS1zai1WSioZGu8Q6KBjDv8AVqy1BrHievbcc4ddSbk93I2nx+tcXb7bbwuHj9VgvZ64vHiPBjpXRxgDv7Wbg4g77uqJZJz/AKVdd2k99kx7gn1NqYyQ6Wlp6Q7ek1VDEfweVtPhtsr8c4dtLrVKOWWixa108g2295lJE13T5goNjIiICIiDxkjbLG5j2h7HAhzXDcEehUL9kxTVuLaZamYNXOImxTMau3GN595paGh24/nNKupRNwn3SPE+O3ifwblLG11VSZJTtA2B7xrTOf6U8f4oLZREQFC3H5LU3Tih4RrDTgu7zMG3NwA36U89K5x/olyulRNqXcKfO+1K0tsDdpRh+J1d1fvt7k85ezb58ndn+JBbKIiAiIgKGOO91Tw+a36T8RdooZZ4qCp/NzJGRHZs1DNzBnP8Wl7y0npzBm/gFc61LxY6UU+tvDnn2Hz9H1tsklpn/sVMO00B+XeRs3+G6DatJVw19JDU08glgmY2SORvg5pG4I+hXtU79n3qONT+EXT25vqTVVtJRG2Vbnnd4lp3mI83xLWtd8nBUQgjrtYMt/Nng8vtI3+WvNfSW9g9d387vwjKq/EsfhxPFbNZKcAU9sooaKMNGw5Y4wwbD5NUedpxaW5tR6FYSSR+Xc+pBIAdt4WRvEnw6CQH6BWygIiICIiAo77WCyPu/BpkMsbOZ1DX0VUXbdWgShpP9ZWItJ8a+OMyrhN1VoHs7wNsNTVAbb7GFvfA/Tu0Ge6PZPLmukmE5DO5z5rtY6Gvkc7xLpYGPO/x3csvWh+BPJm5ZwiaW1oO7o7NFSOHoYd4v7GBb4Qa34k8jZiPD7qNeJH92yksFbIXen6Fw/2rWvZzYbFhPBjpnTMbtLXUL7pK/wA3uqJnzAn5Ne1vyaF6O0ouz7LwRao1DCQX0tLTdPSWtp4j+DytpcNtlfjnDzpjapA4PocZttM4P+1uymjb16Dr09EGx0REBERAREQRnnZbR9qZpm+V7W+14XXxQjzc5veOI+4E/RWYoP4taqbDe0M4YMlYzlhq31FmdJ1950/NDt906vBAUQcOFMzJO0g4jcg3738mUFBawSd+UlrB5+H8gQrfUE9ndXNv3Ezxa3R3vyPyGjYJNyeneVwI/qj7kF7IiIIY7Rqjq9M9QNC9b7cxrBjWQNtd0m8CKao22Lj+wOWVp+Mg9VckEzKmGOWNwdHI0Oa4eYI3C0bxxaZf3W+FbUPH27e0C3mugJG+0lO4TN/GPb6rx4GdTodWeFHTe9NnNRV09qitda553f7RTNEMhd8XFnP/ABhBvdQpw32yfRntFdc8JqJwy35fRxZXbYvASBz937D918krPk1XWoa4wH02kvG/w5arVE3cUNdLNiNwcTswRy94InOPo11U5x3/AGQfJBcqIiAiIgmPtB9E6zVfQmW8493kObYVUtyOyzwN3lMkIJfEPPZzdzsPFzGei2Xwy64WziJ0TxnOLa7lfW0/d1tM7bnpquM8k0bh5bPaSPVpafNbQc0PaWuALSNiD5qBMAnp+BfjUuOCTc1FpRqrKK6xyPJMdvuZIDoN/ANc4lo9A6LfwJQX4vn/AEjXcF/aCPpnOZRaZ6ylpgDRtFS3UEAMPkOaR/Q+G04H6pK+gCnjju4fJeIXh+vNttbS3K7P/wCN7JLGNnmpiBcIwfLnG7d/Ilp8kFDotB8EGvg4huHyw3yreRkVuBtN6gkP6WOrhAa4vHiC8cr+v7S34gKHtI5qTSTtOtV8TjYIKTPrBT5BEAOhqoj74H84PnefirhUOcS8MGDdovw4ZYCI3XmCtskpH6xLHMbv/wC0D7kFxqG+1q/8zen3+WlD/mSq5FBfa1PfU4dpDbWnl9rzGAcxPQEN2G4/iQXoiIgIiICIiAoI4lNNsg4O9Yp+JDS+2PuGM1pEedYrTAhkkR6Gsja0bNIOznHydu4+656vdemso4LjRz0tVCyopp43RSwytDmPY4bOaQfEEEjZBjGlGqeOa04DaMxxWvZcLNc4hLE8EczHfrRvH6r2ncEeRCinitutm4U+O7SjWKoqvYrNmlNPYcg3dsyIR90wVLvgGyx7+ghJ8SvZcdLNT+AfU263vRvErhqXpPlEpmrMOpHOdUWmr6kPh2BPIR032PTYO+y0rhWXhazjju1Hk1C4iLDVYbhtDSPosewiKpfFVQ832p5CNi0kgE79XENBAa0Ah9B6Srgr6WGppZo6immYJI5onBzHtI3DgR0II81i2rWmVn1j04yDDb9A2a23ekfTPLm8xjcR7sjf3mu2cPiFGFDg3EBwEzy/meavW7RWnAP5CqCHXm2R7+8YeVu7w0eQ3b58jepVFaC8aOlXEPEKfHshit+QM3E2O3ktpbhGR9raJx98D1ZuB57eCDSvAXqlf9OMov3DNqTUH86sRDn4/WzO2bc7YD7ndE/a5G7EDxDSR/iztbq+ffGjd6O78bnDjTYBU01bqPR1835RZRva+SGhPIQJuXflbye0Eh36pPkV9BEBERAREQEREBERAREQF+PY2RjmPaHNcNi0jcEei/UQawtHC/pHYb7U3qg04xunudTIZZahtujJc4ncnYjYfQLZkEEdNCyKGNsUTAGsYxoDWgeAAHgF5ogLjfk2k9u9t9lh9s5eT2jux3nL6c22+3wXJRAREQEREBERAREQFHXav2yar4QLtW027aq2XShrI5Wkh0ZbLtzD49VYq0xxm4a/PeFfU6zxQOqKh9jqKiGJjd3OfE3vWho8ySzbb4oNhaZZV+fWm2J5KfG82mkuPQbfysLJPDy+0o17T+ufVZPw4Y9E495XZvFVhoBO/cmJpO23/Dfit1cAWo9DqXwlaeVdHMJJbbbo7RVM33MctOBHyn+FrT8itNayTHWftM9J8OjpTV2vAbVUZBXvb7zYpHt3YXeQ98Uw/iQXUiIghjT2uptcO1Dzy71URmpNMbBFZ7Zzb8rJ5Ce+k9ObeaZnyA9OlzqBeDaQUPaDcUlDUfoauWpjqGRP6F0Zk3Dh8NntPyIW4OL7i9OhslrwbCrU7LtXslZ3dmscA5+55t2tnmA68gIcQOm/I7cgAkB0PGpxMXax1FLorpQ6S6ax5SwQxNozv+R6d/2qiV3hGeXcjfqB73pvtXhV4bLLwvaVUmL22T265zu9ru91eDz11W4e+877nYeAHoPUlYPwccJMmiEF0zbNrg7JtXcn3mvN3ldztgDjzezw+jR03I8SPIABU2gIiICIiAoc0RpPyz2pWu91dyyNoMeoaVrmjo1xZTDYn12Y5XGoo4Zf/SF8TP8Aye2/5qC11D/aWXWrzm5aM6I2+nNU7N8jZU3FrCdxR0rmFzSPRxl5t/8AgVcChTHKaq1m7VPILq2cT2LTLHWUgG+4jqqhmwZ8z3krt/8Ag9kFzUtNFR00VPCxsUMTBGxjBsGtA2AA9Nl7URAXhPM2nhkledmMaXOPwA3XmtMcYuskehHDfm+WdHV8dC6jt8ZOxfVz/ooth58rn85HowoNH9mBXjKsd1ry6Nm1PedQa50Mm/R8bYoi0geG36TxHx9Fa6nvgF0udpHwnYFZp6N1DcamkNyrY3jZ/fTuMh5viAWj5NC3rf75RYxYrjeLlOylt1vp5KqpnkOzY42NLnOJ9AASgiXSa4VOpnan6pXZ0Dn2zDMXjszJgN2xzSSQkDfyLh35/hKulRd2X1su+Q6cZ5qtkETY7rqJkk90Gw8Kdm7Y2/JrjKB8NlaKAiIgIiICIiCGcRujrB2uWZW9ry6G84JGXMA2Aex8DwT8gxw/iVzKBbqwQ9sTZXM9wy4fJ3hB+1tC/bf7h9yvpAUNcMN7k1E7RPiRyItJpbPBSY/A4Doww7Rvb9XxPd9Vbl0uEVptlXXTnaCmhfNIf3WtJP4BRT2WLPzswrVbUqaHkqswzOsqA89eeJmzmkH05ppB8wUFvoiICIiAiIgi3XStdaO004c5pOVtPW2a8UvMep39mmI2/i5B9SrSUGcZtZ+R+PnhTr3v7uJ9ZUUe4dseaV7IwPkecD6q80GquLD/AAWdZP8AIy8/6jMsF7Ov/Ay0x/5vd/pXrKeM65/knhL1fn3258WuFPvtv/KQPj/766/gXsZx3hG0tozsX/kaOVxHmXkv/wC8g3siIgIiIOqywkYteSOh9im/zCo97IRoHB5SO2HM++VznO83Hdg3P3BWNkbQ7HroCNwaWUEfwFRh2QPu8LN2jBPJHldexjd+jR3cHQfDqUFwIiIMe1DzCl09wPIcmrXNZS2igmrXl3gRGwu2+u231Uq9lFg/5vcK9Pkc73S1+W3Squs0rzuXgSGIb/HeNx+qyTtNc+ZgnB5mLdz7TfDDZadjfF75ndQP4GPP0W6dAtOYtItFMIw2L3vyNaKaklf+3KGDvX/xPLnfVBnyIiAiIgKNe1pgceDe81TH93JSXa3zMcB1378NG3p9pWUpa7Ta0uu/BhnrWjf2dtPUnp5MmYUFJ41eo8kxy1XeJpZFX0kVU1p8g9gcB+K7Jay4X7g+68NOktbLy97UYlaZX8nhzOo4idvqStmoIN7XKuc7TXS20tBkdW5lTPEQ3JfyMePDz/lPxV4sY2NjWtAa1o2AHkFBnaiUcl5ynhxtDXbMrcyawgbA77wgdT4faKvRAREQEREEM9rxUGk0H06nBAMWoNufu7wG1LWHqrdtcnfW2kk3B5oWO3Hh1aFGXa7219Xwhy10Y3da7/QVnw8XxDf6yhWFi0hlxi0POxLqOF3T4sCDtFCHaDc1XxMcJFFGN5DmtPUbk9OVlVSl312V3qHOMy3vyPjh4S7RE4F0dyrrk9jT7wEHcy7/AC2jd9xQXGiIgIiICIiDDNa6D8q6NZ5Rd2ZfabBXw92DsXc1PINvrutQdnLWGu4L9MnmRsnJQyRbt26cs0jdunptst/ZVSsrsXvFNI0ujmo5o3NB2JBYQf7VJfZMZA68cG1lopN+9s11r7e8OHUHve+2+gmCCyFF3aAFt31b4X8dceYVmaGu7vp19nbGd+vp3n4/JWioZ4xa0VfHnwnW2RpfHBVXGoAd9nd4iH3/AKIfgguZERAREQFFnaZzx3i0aJYW8tP5zagW2kewnxjDwHH73tHh5q01DnaDDveIbhGhf70RzNzyw+Bc2WjLT9EFxoiII77VC4xHhqtuOyO97J8ptdpbGN937ymY7bfCHz3+/ZV3a6ZtHbaSna3lbFCyMNHkA0BQt2lkc2SarcMWJQkuFxy11S+NrvOJ1OGnb5SP6/NXkgIiICIiAoeqWUunXaz0VS93cDOMHlpWbjo+WN7X+PxFJ94A81cKhjjoswxLir4YtSecxU7L6bFVSb7AB5Doxv8AEOm+5Bc6IiAoW0Ftzc37TrXvK2v54LBbKO0MI6hshiiY4f8AYv8ArurpUD9mQ+a/6o8TmTzuMj6/LGU4eW7HeN9ST57/AOMb9yC+EREBERAXqqqdlZSzQSDeOVhY4fAjYr2ogiPsr6U4zgmr2IF24sefVzI27/ZjdFCGgfDeNx+pVuKIeAiodQ8RvFdZXkO7nK4p2uaNh1NQD/Y38VbyCGOMG7OvvHnwsYoC4xUk9ddZGNbv9sNa0n5ezu+W5VzqDda6N147WbRiBzy6KixB9W1g/Vd3tduenqA37leSAiIgIiICxvUvGPz305yrHdgfyvaau37HwPewuj/7yyREEbdk1dJa7g9tNLUczZ7fda2lcxw2LNpNwD96slRB2bN2ktOXcR2APZyMxzOJ6qAbbEQ1MkwYP/3cn+JW+gkrtT3Sv4LMvpo5DG2qrbZC/wCINdCf7QD9FT+JUrKLFbNTxtDY4qKFjWtGwADAApg7UpwbwcZISQALlaySfL+/YlUuOkHH7YQdwaWL/MCDsEREBERAREQRH2qVDUY9pnp3qXQU5lrMJy6jrZJQN+6gfuHE/AyNhHzcFZ1ju0N/stvudOQYK2njqIyDv7r2hw/ArCOIrTFms2hub4U4N57za5qeFzhuGzbc0TtvUPa0/Rac7NnVyTUvhks1pulV32U4fLLYLrE/7bDE9wgJ9d4uQb+ZY5BVCgjsy3iPVjiipnbtqI8sje+Nw2LWufV8p+vKfuV7qGOCG2jCeMrisxqXZs1VcqG5wg9CYi6odvt/07fvCC50REHqq6WGupZqaojbLBMx0ckbhuHNI2IPzBUOdmjVv0/yPXPRidkkZw/KZ56QSdC+mle5sb/4mxNd8nBXQody+qrNFO1ExW7Hu6fHdUbA6z1L3dA6rp2F0ZP75McMY+DyPNBcSjntWsLhvvCfcMj5T7fidzorpTvb9oc07IXD7pQf4VYyn3tAGwv4NNVxPy8n5HJHOdhzCRnL9ebbb47INuaY5hDqBp1jOSwODo7tboKzcer2BxH3krJlo3gblfNwh6SvkcXvOP025Piei3kgIiIC0bxj8OFJxMaMXGwNJpckoD+UbDXsdyup61gPJ1/Zd1a74HfxAW8kQTTwLcTD9e9M5bRkMZt+ouJPFqyC3ybhxkYS1swB67P5Tv6ODh6E0soN4v8AB7vwt61WrifwC2vqbeXsos8tEAJbVUji1hqOUfZcAB73gHNY4jbm3tXBc2s+o+H2jJ7BWR19mulOyppqiM7hzHD+0dQR5EFBC1va7gs7QmWiJFHprrKA6n3/AJOG6h23L8CZJNvlO306fQZSZ2nun0eY8JuQ3eHaK74tNBeqGqb0kicyRrXFjvEHlcT9FvbQPNKnUXRHA8mrXiWuutkpKqpeBsHTOiaZCB5bu5kGeqCe0xkktOrfC7e2u5GUeVyxF2/L1e+lI97y+wVeygvtWqSqtdv0UzKamkmxnHMtjmu0zBzNga8xlj3D0/RvG/qQPEhBeihftI7d+cupvDFYGNc59ZnEIcANxyc8IJPyG5+St613OlvVspLhQzx1VFVwsqIJ4nBzJI3NDmuaR4ggggqOeKmpiufHVwtWSU87W1VxuHIPEOjgcWn08Wj7kFoIiICIiAiIgIiICIiAtFaycEejuut7/LeTYo1l/wBv/na11MlFUk/tOdE4B5+LgVvVEGl9CuD/AEt4dK6quWHY+6O91TO7qLxcKmSqq5GnxHO8nl326hoAK3QiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiIC/CA4EEbg+IK/UQRzkfZ5VVlzC7XrR3V7IdHaO8TGpr7JbacVVE+Un3nxxmRgjJHTz26bbAbLavDVwoWHhzN8ujb1dMxzO/ua675Ne5OepquXflaOp5Wjfw3PgNydhtvFEBERBM2v8AwVR6p6mUupeEZ5ddKtRY6ZtHPerVTtqI6yFo2AmhLmc5A2buXeDWgg8o25fDbwV2PQnJLnmd+yGv1I1KuZIqsqvMfLK1hAHJFHzO7sbAD7RO3TcDYKjkQEREBERAREQFFHDb/evaK8SlPJ7s0tFbZmN9Wcrev9YferXUK6U3EWTtY9YrZzEMueMUcoa79ZzYqV+4+XvBBcF1ulLZLXWXGtmbT0VHC+onld4MjY0uc4/IAlRj2YFA3KsU1S1dljeyt1ByuqrNpPFlPFJJ3Uf8Jmk+9bV4+tR2aYcJOotzPWast7rVCPV9T+h/se5dvwVafx6acK2mdmbCYJ3WWnrqljhs4TTsEzwfiC/b6IN2IiIChHihMHFTxi6eaEwPNVimKj85stMEnQPDSYaZ3xIMe/ntN06hWpm2U0uD4bfcirnNZR2mhnrpnOOwDI2F53PyapD7MrT6uuGG5drhk1OxuUalXaevjdvu6OhDyGN+HNIJHfFoYUFqRxtijaxjQxjQGta0bAAeAAUe9pJnl0rNPLBoziD45831Jr2WyGmEmzoqMHmmmdt1DOgaT6c3jsVS+qmquMaLYNcsty65x2uy0EZfJK7q558mMb4ue49A0eKkHgp08yXXvVq9cUOo1I6jmuURoMPss43NDQDfaX4bgkDoNy6R36wQV/pPpta9HtNscwuyh35MslFHRxOf9p/KPeefi5xLj8SssREBERAREQEREEDXY992w9kDPfMWHSGTl68gML9t/TxH3hXyofwS1DJ+1k1Bu4AMNgwmCmJBO4mkfAG/1DJ+CuBBorjj1OOkPCpqJkMTgKz8n+w0g8zNUPbAwgeexk5iPRpXJ4KtOG6U8K+m2PGm9lqmWiKrq4y3ZwqJ95pd/Uh8hHyAU/8AaDy1OsmsuhuglsqxH+W7x+W7tGDvtTU7XOBcPQNbOQD4kD0V0wQMpoI4YmhkcbQxrR4AAbAIPNERAREQEREEI9odSMpeIbhOu0p5Yo83p4nO38AKmmceiu5RL2j4/wDljw0u26DUGj3Pp+kjVtIJN7UjK5MY4MswiiPK+7T0lt3+D5muP3hhH1W/NELE/GNGsFtMjDHLR2OihkafEPEDA4ffupa7R6rbl+W8PulboPaIcszOmlq2FvMDSwSRCXp8Gy7n4Aq20BERAREQcO8sElormkbh0DwR/CVEfZAlzeHvO4Nz3cGeXCKNp/Ub7NRnYfUn71c0jBLG5h8HAgqJOyqjkt2n+sNqewNFJqJcSDvuesNOOv0YPvQW6iIghztD6+mzzVnhz0ie3v23nK2XqshA8Iqccjeb4O76UfwlXEAGgAdAOihitdR6r9rFb6cD2iHT/DZJ3Hb3WzvkAA+Y9qB+nwV0ICIiAiIgLTXGXZBkPCrqnQu8H2Cpk/oN5/8Aurcq1/xDUwrNA9SYTH3pfjVyAZtvufZpNvx2QYRwJ3Zt64PdJahhaQywwU3u+G8W8R/FhW91JnZaXQ3LgrwqMu5vZJqynHXfb++Hu2+H21WaCJuNemF64teFO2OADWZG+u5iT4xFkgH9RWyol4gqpt27TDhptDnkNprddqxwGx94UlQ5v+jVtICIiAiIgmvtHrCcj4K9T6YAnuaKGs6Df+RqYpv+4tt6E32HKNEdPrxTua6Gvx+31LS3w2fTxu2/FdLxT4zLmPDfqVZYQXS1lgrI2geZ7px/2LXHZr5FJk3BNplUTO5pqemqaFwLty0QVc0TB/QY3p5dEFNKLswvMGa9qfg9lh/SDD8KqqyZ37E9Q8jl/wCrdGf4laKhLgvqKTV3jR4ktUoY3Pp6arpsfop3N2Dmxs7txHx5aZm/84ILtREQEREBERB4yxtmifG8bteC0j4FRL2Z8dPhNZr3psHhtTYM5qKsQnoWxTxsYz6f3uR/+lW4oPwinp9E+1UzCzuldHR6k42y7UzCPdNQ1x5x8TzU8x+TkF4KDuLMh3aM8LzZmlsIZVmN7TuXP3d0I9OjfvV4qFuMOidS8fPChcZXBlPNUV9O1x/aZ3ZP+lagulERAREQFDvaHsfS648Jdxa0ubFncdKW7dN5ZqQb7/DlPTz+iuJRX2pkkWO6WadZu9p3xTNbdcudoPMGhx3AI6+Q8x4BBaiLwilZPEyWNwfG9oc1zTuCD4ELzQQ7xK1kOVdo7w1YwNnuttPcLs9vT3SIpHj/AFfdXEoaFplyvtdPaWe/BjOCGpcT0DHSHutviT3/APb6K5UBERAREQFHHas4lW3vhXOQWzpcMPvtFf43D7QDC+IkH4d9zH+arHWuuIvT86p6E55ijBvLdbPUwRdN/wBJyEs/rAIMrwm/U+U4ZYb1SSieluNBT1kUoO4eySNr2u+oIK7pSx2ZebPzHg6wunqaj2i4WJ1TZqjd25Z3MzxE34bRGID4BVOgKF+yufAbPrq1vL7SNQK0v6deQtby/iH/AIq6FBfZoRy2jVnihsLhyxUWWRTNaOgDpH1QPTwHSNqC9EREBERAREQQ3wN/4XnFr/lHF/n1CuRQrwQ1UdPxncWNBISyqkvkVQ2M+Jj7yb3v67fvV1IIiukMdz7W60PDdnW7AHEl3q6SUdPpJ/ardUSx/wDpa5v/ANn4/wBIraQEREBERAREQQ1pPXw6Y9qLqri/J3FNnGPU13i28JKmHY9B/MdOT8R8VcqhjjVmOkPF9w5arxU5bRVVZPi91qgNmsZKW9yHH1IlnPXyYVc6CWu08trrnwOalsZEJJImUE7dxuWhlwpnOI9PdDvxW7tDcg/OzRbAr3zc/wCUbDQ1fN688DHb/iuk4psRjzvhx1JsUjecVdiqwB6ObGXtP0LQfosG7PPO4NQODjTKrifzSW+2izzM82OpXGAA/NsbXfJwQUWiIgIiICIiAvn9UzM4JOPiesqXig0q1f23e1m0NDdht9o+DQ57nHfyE3kGL6ArUvFFw9WbiZ0fu2G3X9BVPHtNsr2/bo6xgPdSj4bkgjzaSPig20oTzCI6H9qZjWQVU5p7Hqhj5tjXno11dDyMEf3MgPxMizbgS4k7pm1suekuo7DbNWMId7DWQznY3CnZ0ZUM36k7bB3ru1362w5faL6Q3bPtE6fL8Ti/+XGn1dHktpmjbzSt7kh8gYPM7Ma7bzMY89kFVotZ8OGuFp4iNHceze0vZ/f0AbV07D/5NUtAEsR+Tt9vUEHzWzEBRh2pOBT1ejGP6m2zvBeNOb3TXZvdfafTPlZHKB8Q7un7+QY5Wese1Dwyi1FwTIMXuDGyUV4oZqKUPG42ewt3I+G+6D24LltFnuFWHJbbIJbfeKCCvp3jwdHLGHtP3OCnntNribdwQ6k8jg2WeOip2AjffmrqcOH9HmWH9mJnlxp9Oss0eyWrM2UabXqotJjf4+yc5EexPiA8Sgfu8gXK7WCodFwmSxN25ai/26J/y7wu/taEG/8AhrxyTEeH7Tu0S/ytLYqRjvmYmn/atkrr8dgbS4/bIWb8kdLEwb+OwYAuwQEREBERBw7zZ6LIbPXWq5U0dbbq6CSlqaaZvMyWJ7S17HA+ILSQR8V8/wDHbPql2c+e3ajtuO3fUrh4uNQ+qpqeztNRcLE5/vO2i8eUHfcb8rh727XcwX0MRB89NdNZs248rFBpRpJhOR4/i14lj/ODMsloH0dPBTteHOijYesh6AkAgnYN22PMLr0+wui05wXH8VtrnvoLLQQ0EL5NuZzY2Bgc7bzO25+JWQIgLDNZNLbRrXpjkWE3yNr7feKR1O5xbzGJ/iyQD1a4NcPiFmaIPnfoJxM5VwXYhJpNrfh2V3A49I6msGRWO3OraWuoh0ija8EfZGwaD1DS0Hl5V3Whlozrin4zLdr1kGH3XAcGxO1zW/HaC8sMdVWSSxyRulewgbAtmkJ26DZgBdsSr2RAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBfPLWbK7Jw99qXjOa5bcYrHi+S4iad1zqTywMnbzxlrnbdNu7iJ8vfavoasRz/AEhwfVZtA3M8QsmVtoHmSlbeaCKqEJO3Nyh7TsDsNx4HYb+CCFtZ9XqHtBtacM0g06jkvWmdpuMd4yvITA4UtQ2I7inYXAbtPUb/AKxcNujdz9FWMbExrGNDGNGzWtGwA9AuqxfDrBhFrZbccsdtsFuj+xR2ukjpoW/JjAAPuXboCIiDUPF1gl31M4ZtSMZsLy273CzzMpmN8ZXNAf3X8YaWfxKduE3jj0cwbhLxSjyXLKawXrE7Wy2XKyVbHNrRNCOTaOLbeTn2BHLv47HYg7XOtbXrhr0nyPL2ZTdNN8Xr8hY7n/KNRaYXyvf5PcS333DYbOduRt0IQSNgWmmW9ojmdBqPqrQVGP6L2uoM2M4TKeV9z2P/AJTU7eLSOnxG4bs0kuv6np4qSnjggiZDBE0MZHG0NaxoGwAA6AD0XlFEyCNscbGxxsAa1jRsAPQBeSAiIgIiICIiAiLo86yF+JYRkN9jiE8lst1RWtiPg8xxOeB9eVBIHArVz5vxN8VmbzNc+CXJKexUkpO45aT2iN23lsR3R+vxVrVVTFRU0tRUSNhghYZJJHnZrGgbkk+QAUZ9kzTGo4WZb9USioud8v8AX11bMPF8peAS749FkPaQaxVWn+hTcPx+pLM1z6sjx+1RR/bDJHNE8nwAYeTfxBkb8UGCcGE83EbxTava/VcMU1ipJTieLSubuW00TvekZv4F7eVx8x3rx4K61rThv0VtnD5ori2DWyNg/JtI32udg2NTVO96eU+fvPLiPQbDwAWy0BERAREQEREEO9q7UOsOmmluStbuLRnNDKSSNh7kruv/AFat2kqo66khqYXc8MzGyMd6tI3B+4rQHHzpANaeFPOrNDC+a6UNIbxbmxjd5qKbeQNaPV7Q+P8AjXb8GmsVDrbw1YTk0ErPaGULaG4Q8w5oKmAd1I1w8t+XmG/i1zT5oNDZFeJNU+1bxyzNg723ac4xLO9xG4ZVVLOYu+G7JYm/NpVzKFOz2ranVPXjiP1Xqqf9BcL7FZaCp23BjgD+ZjT5gN9n+8K60BERAREQFFPZvRutWQ8RVkdISaPPJ5DGdiW87Nt9/jyfgrWUT8Aj30uvvFdbZWtEkGXxSEg7783tA/DlH3oLYRFqnip1Ofo5w757l0JHtdvtcvs252/TP/Rxn47OeDt8EE39nbU0Gq+rHENrNDEXi/ZILXbp3jY+xwN3aR/PDoifiweiuZTT2c2mp0y4Q8EppqU0tddKd13qWOGzi6d3Own/AKPkVLICIiAiIgLpc2tH5fwy/Wvl5/bbfUU3LsTvzxubt0+a7pEETdkHV+0cH1LGZOd0N7rWcv7IJYQPxVsqKeynpY7NopmliY1rfyTmFwpdmjbblLQOnl4eCtZBC2cUkt97XfTtrWGSOyYTUVziSSGCRtVDuB5dZGj6q6VE+iV6pNRe0y1vvNKRNDjGP0WPMm2/X5mOmaPlIx7T/NVsICIiAiIg4d5t7bvaK6heAWVUD4HB3gQ5pB3+9Rr2TeUR3Dhyu+NE8tRjeR11I6P9lkj+9b/Wc/7laygG13+g4DeM/KKO/MbadJdV5xcaG6npT265+Mkcp8GMc9z9vJoezwDXEBUPFlrZScPvD/mGZTytZW09G+ntsbuplrZQWQNA8/fIcf3WuPksS4A9Ip9H+GLGKW5RNbkN77y/XaUD35KipPOOc+bmx92z+BaH1JvNJx+8WFj08sVay46Q6czRXm/3Gn2lprpWggspmPB2LdiWE/CXbwaT9AI42Qxtjja1jGgNa1o2AA8AAg8kREBERAREQFFHaSWW64DT6ca+Y1QMqr1p3d2yVvkZbfMeSSNxHXlJIb8O8cfMq111OXYpas6xe7Y7fKOO4We6UslHV0so3bJE9pa4H6Hx8kHHwPNrTqRhlmyixVIq7RdqWOrppR5scNwD6EeBHkQVHHGPdYMg46eFXFoGF1dQVdfdZ3tbuWRSd21vyG9M/f5Ba70918rezJvN80k1ToLze9P+eS44ZkFBCJnyROJLqV25aAQ7y33aSenK5pG0+EDT7LNbdX7txM6j2x9kqLjRm24lj8zd3UNBv/LO3APM4bgdBuHvPmEFrIiICIiApe7SzBX53wb55HE3mmtccV2Y31EMgc/7mF5+iqFY5qThkGo2neUYpUv7qnvlrqrZJJt9hs0Toy76c26DF+GfKG5nw86bXkS9++qx+iMkm+/NIIWtf/Wa5bLUg9lnfKur4WKfH7lLzXTF7xXWWpi5tzC6OTmDPoHhV8gi/housWZdoJxN3dhDmWentNljPXfo1/eD+nC78FaCh7s7qF9z1i4p8qJcYrhntVSRFzeUlkU05b9wkA+iuFAREQEREBERBDPArSUui3EtxB6Js544qa5MyW1Ru+z7HOGHZv8AM72FpPqrmUKcV9RXaC8b2imrtP3VNj2Qb4ffJ3AAFshJYHn4Ah4+MJ8ldYIIBB3BQFC3Z7f4R/Fv/lRS/wCfWq6VC/Z8NLOJHi3B6EZRSf59aguhERAREQEREEIZhUR8NHaW2rI6mEUuI6t2qO2z173csUNyi91rT6c3dw/Myk+RV3rS/Frw12vih0jrsWqphb7xC4VdnunLu6jqm/Zd068p+y4DyPqAtKcLHGpLb7k/R7Xhww7VKxN9mbXXJ4ZS3iNo2bKyX7POQNzudneIJO4Aeir/ALw7Wuj5ve9u0/Jbt+rtK/x/oH71bShDQK9M177R7U3UOzNbXYhidhjxymusLg+GapL2khjvB3QTnp4dPUK70BERAREQEREGguOfQ6o1/wCG3J8dt+/5bpWtulsLRu41MG72tb6Fw5m/xL94IeIBvEVw947fqqd0mSUMTbZfGyAB/tkTQ17yPLn6P/iI8lvxfPnU2luPZ88TlTqhbKaao0W1FrBHk9NC3mbaq9zi5tQB+qCXvcNum3O3p7iC/rjQQ3W31NFUs7ynqYnQys/aa4EEfcVE3ZURux3T7VPDA5z4cdzWtp43nwIIa3p1/wCD3+qoPWTiVwvTHRC96gsyW11dDDQumt8lPUslFXM5v6FkYaTzFzi3oPLcnoCtV9mdpheME4bob9kgc3IM1uE2SVLZBs9rJtu65vi5oD/+k28kFZIiICIiAiIgIiIJc4weEeq1bqbbqNpzXjFdZMab31susH6P24MBIppj0BDj7oLtwA4ggtJXK4SOMCl1wp6zDc0o/wA0dXLE72a749WDuzMQP5aDf7TT5gdR8QWk0yp24oeCnEuJCWjv0VXVYbqDbR/4vyuyuMVSwjYtbIWkF4BHQ7gt68pG53DQHDHvoj2ieq2k2HudNgF0o23yehYeaK3VZY155AOjNzIWEdNxyD9UL6ELQnClwhY7wuWm7zU9yrcny6+uZJeMjubi+epLdy1o3JLWgucfEkk7knYbb7QEREEK8RdXHwk8ZmE6zQxilwzO2jGsrEUfutnA/QVLviNmEnxLYneJK9XatZxb7rpdhumtqeLrl+TZBRTUVtpSHyuiYXe/sOuxc5oB8+voqx110Wx7iC0tveDZNE51tuUYAmi2EtNK1wdHLGfJzXAH4jcHoSFpvhc7P/B+Gy9OyWWvrs1zPuu4ivV52caWPw5YWdeQ7dObcnboNgSCFNW+B1LQU0L9ueOJrHbeG4AC5CIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiIC9NZSQXCknpamJk9NOx0UsUg3a9pGxaR5gg7L3Igh3HODbWvhvut7pdBNTbRR4Pcqp9XHjOVUJqGUT3f73IAXbAbDxG+w5tyN1lGknBhldZrRR6t66ZzHqDl1sZy2a3UVP3FttpI252x7AFw3O3QdfeO7gCK6RAREQEREBERAREQfj2Ne0tcA5pGxB8CFAt17PfVLDMwzym0h1gbgmnuZTmorrS6kMk8Bd/KNif+p4uAc0tdy7Ak7K+0Qa34eNCrFw46UWfBcffLUUtFzyTVk4He1U73c0kr9vMk/QADyWyERAREQEREBQ1wOf4X3Fr/lFF/pJ1cqhrgc/wv+LT/KKL/SToLlUOdpXc5NSrhpPoFaa18F0zi+x1FwEW+8dvh35nO+biSPXuXK41CPDpFLxJceGp2rswp63E8Ih/NOwVDSHNdODvI9h89gZCT/wzdkF00tLDRU0NPTxthghYI442DZrGgbAAegC9qIgIiICIiAiIgins3ZpqXIeJG0T/AMpQ6kXIHYggEyOBA+rCrEyW/U2LY5dLzWHlpLfSy1cp329xjC4/gFFvZ7PdBxAcXFFIC2Vme1FRy79OWSpqy0/UBd32lWrdwtmnVl0fxPmmzbUqsjtMDYT78FLzt75+w/a/k/k558kHT9llanZPhOpWrdbTOiuOd5XWVbXyD7UDXkjlPmO8kkHzarhWGaM6a0WjulGJ4Tbw001jt0NFztaG949rRzyEDzc7mcfi4rM0BERAREQFhurmkOKa44NccSzG1RXWz1rC1zXgCSJ3lJG7xY9viHDwWZIg1lw+cOmF8MuBRYnhVFLDR946eorKtzZKqslJ+3M8NaHEDZo2AAAAAWzURAREQEREBERAREQdRkWIWLLo6WO+WegvEdLKJ4G19MyYRSDwe0OB2PxC7ZrQxoa0ANA2AHkv1EBERAREQEREEMcIbGaQccPEVplNUOEN8kp8st0L+jRzueZuUep9oj+kfwVxVdSyipZqiTcRxMdI7bx2A3KhfiZbS6MdodoPqJs+Omy+mqcZrXAe6JGljI3E+p9oYNv3OngVY2qNwZadM8urZCBHTWirmdudujYXk9fogk3sm55L3w/5Pkk7Wtqr3ltwq5iDuS48hP4uKtlRb2RttmoeDyhmlaWsrL1XVEW48W8zWb/ewq0kBERAREQEREGhOOXRlmuXDLmFihpDU3qjg/Ktocw7SRVkG72Fh8i5vOz5SFcrgs1uj1/4ccRyd+0d2jg/J10gJ3dFVwHu37jy5uUSAHyeFvEgEEEbg+SgfQGE8I/HTmuk9RtS4TqOHX/GZZXbNbUgF0lO3yG28rQPEhkfiXIL4UOcDFM+zcW3Frbhs6J1/pJwd9z1dUkfg9XGok4dpfyD2kfEfZAwRMrbdbrly7/acY4jv9e+JQW2iIgIiICIiAtX678NWnnEhjhtGc2CG48gPs9fF+jq6U+sUo6t+R3B8wVtBEGCaLaJ4lw/4DRYfhlu/J9opiXkvdzyzyH7Ukr/ANZ52G5+AA2AAWdoiAiIgIiICIiAuoy3ELLnmO11hyK2U14s1dGYqmiq4w+ORp8iP9viF26IJIxXsttA8UyyC9ssl1ukNNP7RTWa53N81BC/fcER9C4D0e5wPnuq0hhjp4mRRMbHExoa1jBsGgeAA8gvNEBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQFCHBHcYqXja4rrTLvHWzXllWyN3QmISyDm+X6Rv3q71HfErwyalUet9u1q0Dr7bbs2qKYWy+266kNpa+EABkrtx1c0BoPXchjSOoO4Zhx38So4ftHqilsk3fahZNva8dt8A56iSaQhhlYwdTycw2/eLB57LJ+DbQNvDhw/wCN4jNHG2892ay7SRnfvKuT3pOvny9G7+jVrHQHgovtu1WOset2VRZ7qaG8lBFSMLbfao+uwiDgC5w5nbdGgcx6EnmVdoCIiAiIgIiICIiCA9cbRnnA/r7luuuE42cy03y6JkmW2WmPLUUlQwHlqWnYkN5nuJOxHvv5gNw4dvwZ6R5drHqxdeJnVu1ut14ucZhxGxVLXA2qhcCGyBp26ujdsHEAkOe7Yc42uVEBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERBPvG5w/wB14gdHG0WMTxUeaWGvhvdiqZdhy1UJJDQ7y5gSNz03238FKepvF5rBrpp6dC7dpHkWO6t3lrLVfK6opS2300J92edjuuzHjcgk8oBOzndN/pciDAtBtJ6LQzR3EsDoJBPDY6COmfUBvL3823NLLt5c8he7by5tlnqIgIiICIiAiIgKP+0i0cvuWac2DUvCoO8zjTi4MvdKGDeSWnYQ6VrR5kFrH7eYa4eJCsBeL2NkY5j2hzHDYtI3BHog1zw+a44/xCaTWTNrBWwVENXCG1kMb/epKloHewyDxa5pPgfEFpG4IJlzgsuUOr3GZxH6pUIdJZ2TUuPUdSRuybugGuLT8BAw/J49VzdSuzYl/OK7V+jupt40pt2Rzb5BZqXmlpJ4zvzOhAc0sd1d0JI69C0dDUmimi+L6A6d23DMRovZLVRguc553lqJTtzyyO/We7bqfgAOgCDOkREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREH//2Q==";
    const ODONTO_BASE_DARK = "data:image/png;base64,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";

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
        .fichaTableWrap{overflow:auto;border:1px solid var(--line);border-radius:16px}
        .fichaTable{width:100%;border-collapse:collapse;min-width:1080px;background:rgba(255,255,255,.02)}
        .fichaTable th:last-child,.fichaTable td:last-child{position:sticky;right:0;z-index:2;background:var(--panel2)}
        .fichaTable th,.fichaTable td{padding:10px 10px;border-bottom:1px solid var(--line);vertical-align:middle;font-size:13px}
        .fichaTable th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;background:color-mix(in srgb, var(--panel2) 92%, transparent)}
        .fichaTable input[type="number"], .fichaTable select, .fichaTable input[type="text"], .fichaTable textarea{padding:8px 10px;border-radius:12px;font-size:13px}
        .fichaDone{background:rgba(46,229,157,.12)!important}
        .fichaDone td{background:rgba(46,229,157,.12)!important}
        .totalsGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
        .totalBox{border:1px solid var(--line);border-radius:14px;padding:12px;background:rgba(255,255,255,.03)}
        .totalBox .label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}
        .totalBox .value{font-size:19px;font-weight:800}
        .odontoFull{border:1px solid var(--line);border-radius:16px;padding:14px;background:rgba(255,255,255,.03);margin-bottom:14px}.odontoGrid{display:grid;grid-template-columns:1.32fr .68fr;gap:14px;align-items:start}.odontoPanel{border:1px solid var(--line);border-radius:14px;padding:12px;background:rgba(255,255,255,.02)}.odontoPanel textarea{min-height:100px}
        .odontoRefStage{position:relative; width:100%; aspect-ratio:1536/740; border:1px solid var(--line); border-radius:14px; overflow:hidden; background:var(--panel2)}
        .odontoRefStage img{position:absolute; inset:0; width:100%; height:100%; object-fit:contain; display:block; pointer-events:none; user-select:none}
        .odontoRefStage .odontoBaseDark{opacity:0}
        body.dark .odontoRefStage .odontoBaseLight{opacity:0}
        body.dark .odontoRefStage .odontoBaseDark{opacity:1}
        .odontoOverlay{position:absolute; inset:0}
        .toothOverlayBox{position:absolute; width:36px; height:36px; border-radius:8px; border:2px solid #6b7280; background:rgba(255,255,255,.98); color:#111827; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900; transform:translate(-50%,0); cursor:pointer; user-select:none; transition:.15s ease}
        .toothOverlayBox:hover{transform:translate(-50%,0) scale(1.04)}
        body.dark .toothOverlayBox{background:rgba(17,24,39,.96); color:#f8fafc; border-color:#cbd5e1}
        .toothOverlayBox.plan{background:#ffd400; border-color:#c48a00; color:#111827}
        .toothOverlayBox.closed{background:#1d4ed8; border-color:#1e3a8a; color:#ffffff}
        .toothOverlayBox.done{background:#16a34a; border-color:#166534; color:#ffffff}
        .odontoLegend{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
        .legendPill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);padding:5px 9px;border-radius:999px;font-size:12px;background:rgba(255,255,255,.03)}
        .legendDot{width:10px;height:10px;border-radius:999px;display:inline-block}
        .lp-plan .legendDot{background:#ffd400}.lp-closed .legendDot{background:#1d4ed8}.lp-done .legendDot{background:#16a34a}
        .fichaEmpty{padding:18px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:14px}
        @media(max-width:1180px){.fichaHead,.procGrid,.fichaAddGrid,.totalsGrid,.odontoGrid{grid-template-columns:1fr}.fichaTable{min-width:760px}}
      `;
      document.head.appendChild(style);
    }

    function procedureCatalogDefaults(){
      return [
        {id:'proc_rest_1f', nome:'Restauração de resina 1 face', categoria:'Dentística', valorBase:250, exigeDente:true, exigeFace:true, cobraPorDente:true, ativo:true},
        {id:'proc_rest_2f', nome:'Restauração de resina 2 faces', categoria:'Dentística', valorBase:320, exigeDente:true, exigeFace:true, cobraPorDente:true, ativo:true},
        {id:'proc_rest_3f', nome:'Restauração de resina 3 faces', categoria:'Dentística', valorBase:380, exigeDente:true, exigeFace:true, cobraPorDente:true, ativo:true},
        {id:'proc_implante', nome:'Implante unitário', categoria:'Implante', valorBase:2200, exigeDente:true, exigeFace:false, cobraPorDente:true, ativo:true},
        {id:'proc_canal', nome:'Canal', categoria:'Endodontia', valorBase:900, exigeDente:true, exigeFace:false, cobraPorDente:true, ativo:true},
        {id:'proc_exodontia', nome:'Exodontia', categoria:'Cirurgia', valorBase:400, exigeDente:true, exigeFace:false, cobraPorDente:true, ativo:true},
        {id:'proc_coroa', nome:'Coroa unitária', categoria:'Prótese', valorBase:1500, exigeDente:true, exigeFace:false, cobraPorDente:true, ativo:true},
        {id:'proc_profilaxia', nome:'Profilaxia', categoria:'Clínica geral', valorBase:180, exigeDente:false, exigeFace:false, cobraPorDente:false, ativo:true}
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
        entry.ficha = { plano: [], odontograma: {} };
      }
      if(!Array.isArray(entry.ficha.plano)) entry.ficha.plano = [];
      if(!entry.ficha.odontograma || typeof entry.ficha.odontograma !== 'object') entry.ficha.odontograma = {};
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
    function calcFichaTotals(plano=[]){
      const totalBase = plano.reduce((s,x)=>s + Number(x.valorBase||0), 0);
      const totalFechado = plano.reduce((s,x)=>s + Number(x.valorFechado||0), 0);
      const totalDesconto = totalBase - totalFechado;
      const totalPago = plano.filter(x=>!!x.pago).reduce((s,x)=>s + Number(x.valorFechado||0), 0);
      const totalFeito = plano.filter(x=>!!x.feito).reduce((s,x)=>s + Number(x.valorFechado||0), 0);
      const emAberto = totalFechado - totalPago;
      return {
        totalBase, totalFechado, totalDesconto, totalPago, totalFeito,
        emAberto, descontoPct: percent(totalDesconto, totalBase)
      };
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
          || String(x.categoria||'').toLowerCase().includes(q);
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
                  <td>${item.ativo === false ? 'Inativo' : 'Ativo'}</td>
                  <td>
                    <button class="miniBtn" onclick="CRONOS_PROC_UI.edit('${escapeHTML(item.id)}')">Editar</button>
                    <button class="miniBtn danger" onclick="CRONOS_PROC_UI.remove('${escapeHTML(item.id)}')">Excluir</button>
                  </td>
                </tr>
              `).join('') : `<tr><td colspan="8" class="muted">Nenhum procedimento encontrado.</td></tr>`}
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
      edit(id){ window.__procCatalogState = Object.assign(window.__procCatalogState || {}, {editingId:id}); renderProcedureCatalogApp(); },
      reset(){ window.__procCatalogState = Object.assign(window.__procCatalogState || {}, {editingId:null}); renderProcedureCatalogApp(); },
      save(){
        const db = loadDB();
        if(!db.settings) db.settings = {};
        const catalog = getProcedureCatalog(db).slice();
        const state = window.__procCatalogState || { editingId:null };
        const nome = String(val('procName') || '').trim();
        const categoria = String(val('procCategory') || '').trim();
        const valorBase = parseMoneyInput(val('procValue'));
        const exigeDente = String(val('procNeedsTooth')) === '1';
        const exigeFace = String(val('procNeedsFace')) === '1';
        const cobraPorDente = String(val('procPerTooth')) === '1';
        const ativo = !!el('procActive')?.checked;
        if(!nome) return toast('Procedimento', 'Digite o nome do procedimento.');
        const payload = { id: state.editingId || uid('proc'), nome, categoria, valorBase, exigeDente, exigeFace, cobraPorDente, ativo };
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
        selectedProcId: '',
        selectedTeeth: [],
        selectedFace: '',
        price: '',
        selectedTooth: null
      };
      return window.__fichaFeatureState;
    }
    function getFichaState(){ return window.__fichaFeatureState || null; }
    function getSelectedProc(state, db){ return getProcedureCatalog(db).find(x=>x.id===state?.selectedProcId) || null; }
    function getFaceOptionsHTML(cur=''){
      return FACE_OPTIONS.map(opt=>`<option value="${escapeHTML(opt.value)}" ${String(cur||'')===String(opt.value) ? 'selected' : ''}>${escapeHTML(opt.label)}</option>`).join('');
    }
    function lineDiscount(item){
      return Number(item.valorBase||0) - Number(item.valorFechado||0);
    }
    function lineDiscountPct(item){
      return percent(lineDiscount(item), Number(item.valorBase||0));
    }
    function getToothVisualState(entry, tooth){
      const ficha = ensureFicha(entry);
      const planForTooth = ficha.plano.filter(x=>String(x.dente||'').split(',').map(s=>s.trim()).includes(String(tooth)));
      const explicit = ficha.odontograma?.[tooth];
      if(explicit?.status === 'done') return 'done';
      if(explicit?.status === 'closed') return 'closed';
      if(explicit?.status === 'plan') return 'plan';
      if(planForTooth.some(x=>x.feito)) return 'done';
      if(planForTooth.length) return 'closed';
      return '';
    }
    function buildFichaHeader(entry, contact){
      const db = loadDB();
      const actor = currentActor();
      const branding = getClinicBranding(db, actor);
      const patientName = escapeHTML(contact?.name || entry?.name || 'Paciente');
      const phone = escapeHTML(contact?.phone || entry?.phone || '—');
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
            <div class="muted">Cidade: ${city}</div>
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
      const catalog = catalogAll.filter(item=>{
        const q = String(state.procSearch||'').trim().toLowerCase();
        if(!q) return true;
        return String(item.nome||'').toLowerCase().includes(q) || String(item.categoria||'').toLowerCase().includes(q);
      });
      const totals = calcFichaTotals(ficha.plano || []);
      const selectedToothMeta = state.selectedTooth ? (ficha.odontograma?.[state.selectedTooth] || {}) : {};
      const selectedToothPlan = state.selectedTooth ? ficha.plano.filter(x=>String(x.dente||'').split(',').map(s=>s.trim()).includes(String(state.selectedTooth))) : [];
      const selectedPrice = state.price !== '' ? String(state.price) : (selectedProc ? String(Number(selectedProc.valorBase||0)) : '');
      const odontoBaseSrc = __cronosThemeIsDark() ? ODONTO_BASE_DARK : ODONTO_BASE_LIGHT;
      const upper = [...TOOTH_ROWS.supDir, ...TOOTH_ROWS.supEsq];
      const lower = [...TOOTH_ROWS.infDir, ...TOOTH_ROWS.infEsq];
      function overlayBoxes(list, y){
        return list.map((tooth, i)=>`<button type="button" class="toothOverlayBox ${getToothVisualState(entry, tooth)} ${state.selectedTooth===tooth ? 'active' : ''}" style="left:${__odontoBoxLeftPct(tooth, i)}%; top:${y}%" onclick="CRONOS_FICHA_UI.pickTooth('${tooth}')">${tooth}</button>`).join('');
      }

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
                <span class="legendPill lp-plan"><span class="legendDot"></span>Planejado</span>
                <span class="legendPill lp-closed"><span class="legendDot"></span>Fechado</span>
                <span class="legendPill lp-done"><span class="legendDot"></span>Concluído</span>
              </div>
              <div style="margin-top:12px" class="small">O odontograma usa base neutra em preto e branco, e os status ficam com contraste forte para leitura rápida na tela e na impressão.</div>
            </div>

            <div class="odontoPanel">
              <div style="font-size:16px; font-weight:800">${state.selectedTooth ? `Dente ${state.selectedTooth} • ${deriveToothType(state.selectedTooth)}` : 'Seleciona um dente no odontograma'}</div>
              ${state.selectedTooth ? `
                <div class="small" style="margin:6px 0 10px">${selectedToothPlan.length ? `${selectedToothPlan.length} item(ns) do plano ligado(s) a este dente.` : 'Sem itens do plano ligados a este dente.'}</div>
                <label>Status manual</label>
                <select id="odontoStatusSel">
                  <option value="" ${!selectedToothMeta.status ? 'selected' : ''}>Sem marcação manual</option>
                  <option value="plan" ${selectedToothMeta.status==='plan' ? 'selected' : ''}>Planejado</option>
                  <option value="closed" ${selectedToothMeta.status==='closed' ? 'selected' : ''}>Fechado</option>
                  <option value="done" ${selectedToothMeta.status==='done' ? 'selected' : ''}>Concluído</option>
                </select>
                <label style="margin-top:10px">Observação</label>
                <textarea id="odontoNoteTxt">${escapeHTML(selectedToothMeta.note || '')}</textarea>
                <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap">
                  <button class="btn ok" onclick="CRONOS_FICHA_UI.saveToothMeta()">Salvar marcação</button>
                  <button class="btn" onclick="CRONOS_FICHA_UI.clearToothMeta()">Limpar marcação</button>
                </div>
              ` : `<div class="muted" style="margin-top:8px">Clica num quadrinho do odontograma para editar a observação clínica ou destacar algo.</div>`}
            </div>
          </div>
        </div>

        <div class="fichaAddWrap">
          <div class="muted" style="margin-bottom:10px">Plano de tratamento — escolhe o procedimento, ajusta o valor do paciente se precisar e adiciona ao plano.</div>
          <div class="fichaAddGrid">
            <div>
              <label>Buscar procedimento</label>
              <input id="fichaProcSearch" type="text" value="${escapeHTML(state.procSearch||'')}" placeholder="Ex: restauração" oninput="CRONOS_FICHA_UI.setSearch(this.value)">
            </div>
            <div>
              <label>Procedimento</label>
              <select onchange="CRONOS_FICHA_UI.selectProc(this.value)">
                <option value="">Selecione</option>
                ${catalog.map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===state.selectedProcId ? 'selected' : ''}>${escapeHTML(item.nome)}${item.categoria ? ` • ${escapeHTML(item.categoria)}` : ''}</option>`).join('')}
              </select>
            </div>
            <div>
              <label>Valor do paciente</label>
              <input type="number" step="0.01" value="${escapeHTML(selectedPrice)}" oninput="CRONOS_FICHA_UI.setPrice(this.value)" placeholder="0,00">
            </div>
          </div>
          <div class="fichaAddGrid">
            <div>
              <label>Face</label>
              <select ${selectedProc?.exigeFace ? '' : 'disabled'} onchange="CRONOS_FICHA_UI.setFace(this.value)">${getFaceOptionsHTML(state.selectedFace || '')}</select>
            </div>
            <div>
              <label>Valor base</label>
              <input type="text" disabled value="${selectedProc ? moneyBR(selectedProc.valorBase || 0) : '—'}">
            </div>
            <div style="display:flex; align-items:flex-end">
              <button class="btn primary" style="width:100%" onclick="CRONOS_FICHA_UI.addToPlan()">➕ Adicionar ao plano</button>
            </div>
          </div>
          ${selectedProc?.exigeDente ? `
            <div style="margin-top:12px">
              <div class="toothToolbar">
                <label style="margin:0">Selecione o(s) dente(s)</label>
                <div class="muted">${selectedProc?.cobraPorDente ? 'Cada dente vira uma linha própria no plano.' : 'Vários dentes podem entrar na mesma linha.'}</div>
              </div>
              <div class="toothWrap">
                ${ALL_TEETH.map(tooth=>`<button type="button" class="toothBtn ${state.selectedTeeth.includes(tooth) ? 'sel' : ''}" onclick="CRONOS_FICHA_UI.toggleTooth('${tooth}')">${tooth}<small>${deriveToothType(tooth)}</small></button>`).join('')}
              </div>
              ${state.selectedTeeth.length ? `<div class="toothChipRow">${state.selectedTeeth.map(tooth=>`<span class="toothChip">${tooth} • ${deriveToothType(tooth)}</span>`).join('')}</div>` : ''}
            </div>
          ` : ''}
        </div>

        <div class="fichaLayout">
          <div class="fichaTableWrap">
            <table class="fichaTable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Procedimento</th>
                  <th>Dente</th>
                  <th>Face</th>
                  <th>Valor base</th>
                  <th>Valor fechado</th>
                  <th>Desconto</th>
                  <th>Feito</th>
                  <th>Pago</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                ${ficha.plano.length ? ficha.plano.map((item, idx)=>`
                  <tr class="${item.feito ? 'fichaDone' : ''}">
                    <td>${idx+1}</td>
                    <td>${escapeHTML(item.procedimento || '—')}</td>
                    <td>${escapeHTML(item.dente || '—')}</td>
                    <td><select onchange="CRONOS_FICHA_UI.updateFace('${escapeHTML(item.id)}', this.value)">${getFaceOptionsHTML(item.face || '')}</select></td>
                    <td>${moneyBR(item.valorBase || 0)}</td>
                    <td><input type="number" step="0.01" value="${escapeHTML(String(Number(item.valorFechado||0)))}" oninput="CRONOS_FICHA_UI.updateValue('${escapeHTML(item.id)}', this.value)"></td>
                    <td>${moneyBR(lineDiscount(item))}<br><span class="small">${lineDiscountPct(item).toFixed(2)}%</span></td>
                    <td><button class="btn small ${item.feito ? 'ok' : ''}" onclick="CRONOS_FICHA_UI.toggleDone('${escapeHTML(item.id)}')">${item.feito ? 'Feito' : 'Pendente'}</button></td>
                    <td><button class="btn small ${item.pago ? 'ok' : ''}" onclick="CRONOS_FICHA_UI.togglePaid('${escapeHTML(item.id)}')">${item.pago ? 'Pago' : 'Aberto'}</button></td>
                    <td><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="miniBtn danger" onclick="CRONOS_FICHA_UI.removeItem('${escapeHTML(item.id)}')">Excluir</button></div></td>
                  </tr>
                `).join('') : `<tr><td colspan="10"><div class="fichaEmpty">Nenhum item no plano ainda.</div></td></tr>`}
              </tbody>
            </table>
          </div>
          <div class="totalsGrid">
            <div class="totalBox"><span class="label">Total pela tabela</span><div class="value">${moneyBR(totals.totalBase)}</div></div>
            <div class="totalBox"><span class="label">Valor fechado</span><div class="value">${moneyBR(totals.totalFechado)}</div></div>
            <div class="totalBox"><span class="label">Desconto total</span><div class="value">${moneyBR(totals.totalDesconto)}</div><div class="small">${totals.descontoPct.toFixed(2)}%</div></div>
            <div class="totalBox"><span class="label">Total feito</span><div class="value">${moneyBR(totals.totalFeito)}</div></div>
            <div class="totalBox"><span class="label">Total pago</span><div class="value">${moneyBR(totals.totalPago)}</div></div>
            <div class="totalBox"><span class="label">Em aberto</span><div class="value">${moneyBR(totals.emAberto)}</div></div>
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
      selectProc(id){
        const s = getFichaState(); if(!s) return;
        const db = loadDB();
        const item = getProcedureCatalog(db).find(x=>x.id===id) || null;
        s.selectedProcId = id || '';
        s.selectedTeeth = [];
        s.selectedFace = '';
        s.price = item ? String(Number(item.valorBase || 0)) : '';
        renderFichaApp();
      },
      toggleTooth(tooth){
        const s = getFichaState(); if(!s) return;
        const idx = s.selectedTeeth.indexOf(tooth);
        if(idx >= 0) s.selectedTeeth.splice(idx,1); else s.selectedTeeth.push(tooth);
        s.selectedTeeth.sort((a,b)=>Number(a)-Number(b));
        renderFichaApp();
      },
      setFace(v){ const s = getFichaState(); if(!s) return; s.selectedFace = v || ''; },
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
              observacao:''
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
        s.selectedFace = '';
        s.price = String(valorBase);
        renderFichaApp();
        try{ renderLeadsTable(filteredEntries()); }catch(_){ }
        toast('Item adicionado ✅', proc.nome);
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
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const item = ensureFicha(entry).plano.find(x=>x.id===itemId);
        if(!item) return;
        item.pago = !item.pago;
        if(item.pago) item.feito = true;
        saveDB(db);
        renderFichaApp();
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
      saveToothMeta(){
        const s = getFichaState(); if(!s || !s.selectedTooth) return;
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const ficha = ensureFicha(entry);
        ficha.odontograma[s.selectedTooth] = {
          status: String(el('odontoStatusSel')?.value || ''),
          note: String(el('odontoNoteTxt')?.value || '').trim()
        };
        if(!ficha.odontograma[s.selectedTooth].status && !ficha.odontograma[s.selectedTooth].note){
          delete ficha.odontograma[s.selectedTooth];
        }
        saveDB(db);
        renderFichaApp();
        toast('Odontograma salvo.');
      },
      clearToothMeta(){
        const s = getFichaState(); if(!s || !s.selectedTooth) return;
        const db = loadDB();
        const entry = getEntryById(s.entryId);
        if(!entry) return;
        const ficha = ensureFicha(entry);
        delete ficha.odontograma[s.selectedTooth];
        saveDB(db);
        renderFichaApp();
      }
    };

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
        maxWidth:'min(99vw, 1880px)'
      });
    };

    window.printFicha = function(entryId){
      const entry = getEntryById(entryId);
      if(!entry) return toast('Ficha', 'Lead não encontrado.');
      const db = loadDB();
      const actor = currentActor();
      const contact = getContactForEntry(entry);
      const ficha = ensureFicha(entry);
      const totals = calcFichaTotals(ficha.plano || []);
      const branding = getClinicBranding(db, actor);
      const clinicName = escapeHTML(getClinicDisplayName(db, actor));
      const patientName = escapeHTML(contact?.name || entry?.name || 'Paciente');
      const patientPhone = escapeHTML(contact?.phone || entry?.phone || '—');
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
          .patient{margin-top:12px;display:grid;grid-template-columns:1.3fr .9fr .8fr 1fr;gap:10px}
          .field{border:1px solid #111;min-height:45px;padding:7px 10px}.field .lbl{display:block;font-size:10px;color:#444;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px}.field .val{font-size:14px;font-weight:700}
          .sectionTitle{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px}
          .boxWrap{border:1.5px solid #111;padding:10px}
          .odonto{position:relative;width:100%;aspect-ratio:1536/740;border:1px solid #cfd7e3;border-radius:10px;overflow:hidden;background:#eef1f5}
          .odonto img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
          .overlay{position:absolute;inset:0}
          .box{position:absolute;width:36px;height:36px;border-radius:8px;border:2px solid #6b7280;background:#ffffff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#111827;transform:translate(-50%,0)}
          .box.plan{background:#ffd400;border-color:#c48a00}.box.closed{background:#1d4ed8;border-color:#1e3a8a;color:#fff}.box.done{background:#16a34a;border-color:#166534;color:#fff}
          .legend{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:#555}.legend span{display:inline-flex;align-items:center;gap:6px;border:1px solid #ddd;padding:5px 9px;border-radius:999px}
          .chip{width:10px;height:10px;border-radius:999px;display:inline-block}.cp1{background:#ffd400}.cp2{background:#1d4ed8}.cp3{background:#16a34a}
          table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #111;padding:6px 7px;vertical-align:top}th{background:#f5f5f5;font-size:10px;text-transform:uppercase;letter-spacing:.08em;text-align:left}td.center{text-align:center}td.right{text-align:right}tr.done td{background:#e6f7e3}tr.closed td{background:#eef4ff}
          .summary{border-top:1.5px solid #111;margin-top:auto;display:grid;grid-template-columns:repeat(5,1fr)}.sum{border-right:1px solid #111;padding:8px 9px;min-height:62px}.sum:last-child{border-right:none}.sum .lbl{font-size:10px;text-transform:uppercase;color:#444;font-weight:800;letter-spacing:.06em;margin-bottom:6px}.sum .val{font-size:16px;font-weight:800}
          .obs{margin-top:14px;border:1.5px solid #111;padding:10px;page-break-inside:auto}.obsText{margin-top:8px;line-height:1.45;font-size:13px;white-space:pre-wrap;word-break:break-word}
          .foot{margin-top:16px;font-size:11px;color:#333}
          @media print{body{padding:0}.sheet{border:none}tr.done td{background:#bbf7d0 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}tr.closed td{background:#93c5fd !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.box.plan,.box.closed,.box.done{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
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
            <div class="field"><span class="lbl">Cidade</span><span class="val">${patientCity}</span></div>
            <div class="field"><span class="lbl">Clínica</span><span class="val">${clinicName}</span></div>
          </div>

          <div class="boxWrap" style="margin-top:16px">
            <div class="sectionTitle">Odontograma</div>
            <div class="odonto"><img src="${ODONTO_BASE_LIGHT}" alt="Odontograma"><div class="overlay">${overlayBoxes(upper, 8.5)}${overlayBoxes(lower, 82.5)}</div></div>
            <div class="legend"><span><i class="chip cp1"></i>Planejado</span><span><i class="chip cp2"></i>Fechado</span><span><i class="chip cp3"></i>Concluído</span></div>
          </div>

          <div style="border:1.5px solid #111;display:flex;flex-direction:column;margin-top:16px">
            <table>
              <thead><tr><th>Nº</th><th>Procedimento</th><th>Dente</th><th>Face</th><th>Tabela</th><th>Fechado</th><th>Pago</th></tr></thead>
              <tbody>${ficha.plano.length ? ficha.plano.map((item, idx)=>`<tr class="${item.feito ? 'done' : (item.valorFechado ? 'closed' : '')}"><td class="center">${idx+1}</td><td>${escapeHTML(item.procedimento || '')}</td><td class="center">${escapeHTML(item.dente || '—')}</td><td class="center">${escapeHTML(item.face || '—')}</td><td class="right">${moneyBR(item.valorBase || 0)}</td><td class="right">${moneyBR(item.valorFechado || 0)}</td><td class="right">${item.pago ? moneyBR(item.valorFechado || 0) : moneyBR(0)}</td></tr>`).join('') : `<tr><td colspan="7">Nenhum item cadastrado.</td></tr>`}</tbody>
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
        btn.className = 'iconBtn btnFicha';
        btn.title = 'Ficha';
        btn.textContent = '📋';
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
