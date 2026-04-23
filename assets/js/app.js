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
function openModal({title, sub="", bodyHTML="", footHTML="", onMount=null}){
  el("modalTitle").textContent = title;
  el("modalSub").textContent = sub;
  el("modalBody").innerHTML = bodyHTML;
  el("modalFoot").innerHTML = footHTML;
  el("modalBg").classList.add("show");
  el("modalBg").setAttribute("aria-hidden","false");
  if(typeof onMount==="function") onMount();
}
function closeModal(){
  el("modalBg").classList.remove("show");
  el("modalBg").setAttribute("aria-hidden","true");
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
    const ODONTO_BASE_LIGHT = "data:image/png;base64,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";
    const ODONTO_BASE_DARK = "data:image/png;base64,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";

    function injectFichaStyles(){
      if(document.getElementById('cronosFichaStyles')) return;
      const style = document.createElement('style');
      style.id = 'cronosFichaStyles';
      style.textContent = `
        .btnFicha{border-color: rgba(99,102,241,.35)!important}
        .procCardHint{margin-top:8px;font-size:12px;color:var(--muted)}
        .procGrid{display:grid;grid-template-columns:1.2fr .85fr .7fr .8fr .8fr .75fr;gap:10px;align-items:end}
        .procCatalogTable td,.procCatalogTable th{font-size:13px}
        .procCatalogTable .miniBtn{padding:6px 10px}
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
        .fichaLayout{display:grid;grid-template-columns:1.2fr .9fr;gap:14px;align-items:start}
        .fichaTableWrap{overflow:auto;border:1px solid var(--line);border-radius:16px}
        .fichaTable{width:100%;border-collapse:collapse;min-width:980px;background:rgba(255,255,255,.02)}
        .fichaTable th,.fichaTable td{padding:10px 10px;border-bottom:1px solid var(--line);vertical-align:middle;font-size:13px}
        .fichaTable th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;background:color-mix(in srgb, var(--panel2) 92%, transparent)}
        .fichaTable input[type="number"], .fichaTable select, .fichaTable input[type="text"], .fichaTable textarea{padding:8px 10px;border-radius:12px;font-size:13px}
        .fichaDone{background:rgba(46,229,157,.12)!important}
        .fichaDone td{background:rgba(46,229,157,.12)!important}
        .totalsGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
        .totalBox{border:1px solid var(--line);border-radius:14px;padding:12px;background:rgba(255,255,255,.03)}
        .totalBox .label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}
        .totalBox .value{font-size:19px;font-weight:800}
        .odontoSide{border:1px solid var(--line);border-radius:16px;padding:14px;background:rgba(255,255,255,.03)}
        .odontoRefStage{position:relative; width:100%; aspect-ratio:1536/740; border:1px solid var(--line); border-radius:14px; overflow:hidden; background:var(--panel2)}
        .odontoRefStage img{position:absolute; inset:0; width:100%; height:100%; object-fit:contain; display:block; pointer-events:none; user-select:none}
        .odontoBaseDark{opacity:0}
        body.dark .odontoBaseLight{opacity:0}
        body.dark .odontoBaseDark{opacity:1}
        .odontoOverlay{position:absolute; inset:0}
        .toothOverlayBox{position:absolute; width:36px; height:36px; border-radius:8px; border:2px solid var(--line); background:rgba(255,255,255,.95); color:#122033; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:800; transform:translate(-50%,0); cursor:pointer; user-select:none; backdrop-filter:blur(2px); transition:.15s ease}
        .toothOverlayBox:hover{transform:translate(-50%,0) scale(1.04)}
        body.dark .toothOverlayBox{background:rgba(21,30,43,.95); color:#edf3ff; border-color:#88a7cf}
        .toothOverlayBox.plan{background:#fff3b8; border-color:#b58d00; color:#122033}
        .toothOverlayBox.closed{background:#dfe9ff; border-color:#4c6edb; color:#122033}
        .toothOverlayBox.done{background:#daf2d3; border-color:#2f8f46; color:#122033}
        .odontoLegend{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
        .legendPill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);padding:5px 9px;border-radius:999px;font-size:12px;background:rgba(255,255,255,.03)}
        .legendDot{width:10px;height:10px;border-radius:999px;display:inline-block}
        .lp-plan .legendDot{background:#facc15}.lp-closed .legendDot{background:#4c6edb}.lp-done .legendDot{background:#2ee59d}
        .fichaEmpty{padding:18px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:14px}
        @media(max-width:1100px){.fichaLayout,.fichaHead,.procGrid,.fichaAddGrid,.totalsGrid{grid-template-columns:1fr}.fichaTable{min-width:860px}}
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
        bodyHTML:'<div id="procCatalogApp"></div>',
        footHTML:'<button class="btn" onclick="closeModal()">Fechar</button>',
        onMount: renderProcedureCatalogApp
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

    window.CRONOS_PROC_UI = {
      search(v){ window.__procCatalogState = Object.assign(window.__procCatalogState || {}, {search:v}); renderProcedureCatalogApp(); },
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
              ${branding?.logoDataUri ? `<img src="${branding.logoDataUri}" alt="${clinicName}" style="width:56px;height:56px;object-fit:contain;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.03)">` : ``}
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
      const branding = getClinicBranding(db, actor);
      const clinicName = escapeHTML(getClinicDisplayName(db, actor));
      const catalogAll = getProcedureCatalog(db).filter(x=>x.ativo !== false);
      const selectedProc = getSelectedProc(state, db);
      const catalog = catalogAll.filter(item=>{
        const q = String(state.procSearch||'').trim().toLowerCase();
        if(!q) return true;
        return String(item.nome||'').toLowerCase().includes(q) || String(item.categoria||'').toLowerCase().includes(q);
      });
      const totals = calcFichaTotals(ficha.plano || []);
      const selectedToothMeta = state.selectedTooth ? (ficha.odontograma?.[state.selectedTooth] || {}) : {};
      const selectedToothPlan = state.selectedTooth ? ficha.plano.filter(x=>String(x.dente||'').split(',').map(s=>s.trim()).includes(String(state.selectedTooth))) : [];
      const selectedPrice = state.price !== '' ? String(state.price) : (selectedProc ? String(Number(selectedProc.valorBase||0)) : '');
      function overlayBoxes(list, y){
        return list.map((tooth, i)=>`<button type="button" class="toothOverlayBox ${getToothVisualState(entry, tooth)} ${state.selectedTooth===tooth ? 'active' : ''}" style="left:${5.5 + i * 6.0}%; top:${y}%" onclick="CRONOS_FICHA_UI.pickTooth('${tooth}')">${tooth}</button>`).join('');
      }
      box.innerHTML = `
        ${buildFichaHeader(entry, contact)}
        <div class="fichaAddWrap">
          <div class="muted" style="margin-bottom:10px">Plano de tratamento — escolhe o procedimento, ajusta o valor do paciente se precisar e adiciona ao plano.</div>
          <div class="fichaAddGrid">
            <div>
              <label>Buscar procedimento</label>
              <input type="text" value="${escapeHTML(state.procSearch||'')}" placeholder="Ex: restauração" oninput="CRONOS_FICHA_UI.setSearch(this.value)">
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
          <div>
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
                      <td><button class="miniBtn danger" onclick="CRONOS_FICHA_UI.removeItem('${escapeHTML(item.id)}')">Excluir</button></td>
                    </tr>
                  `).join('') : `<tr><td colspan="10"><div class="fichaEmpty">Nenhum item no plano ainda.</div></td></tr>`}
                </tbody>
              </table>
            </div>
            <div class="totalsGrid">
              <div class="totalBox"><span class="label">Total pela tabela</span><div class="value">${moneyBR(totals.totalBase)}</div></div>
              <div class="totalBox"><span class="label">Total fechado</span><div class="value">${moneyBR(totals.totalFechado)}</div></div>
              <div class="totalBox"><span class="label">Desconto total</span><div class="value">${moneyBR(totals.totalDesconto)}</div><div class="small">${totals.descontoPct.toFixed(2)}%</div></div>
              <div class="totalBox"><span class="label">Total feito</span><div class="value">${moneyBR(totals.totalFeito)}</div></div>
              <div class="totalBox"><span class="label">Total pago</span><div class="value">${moneyBR(totals.totalPago)}</div></div>
              <div class="totalBox"><span class="label">Em aberto</span><div class="value">${moneyBR(totals.emAberto)}</div></div>
            </div>
          </div>

          <div class="odontoSide">
            <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start; margin-bottom:10px">
              <div>
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
                  ${branding?.logoDataUri ? `<img src="${branding.logoDataUri}" alt="${clinicName}" style="width:44px;height:44px;object-fit:contain;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.03)">` : ''}
                  <div>
                    <div style="font-size:18px; font-weight:800">Odontograma</div>
                    <div class="muted" style="margin-top:4px">${clinicName}</div>
                  </div>
                </div>
              </div>
              <button class="btn small" onclick="printFicha('${escapeHTML(String(entry.id))}')">🖨️ Imprimir ficha</button>
            </div>
            <div class="odontoRefStage">
              <img class="odontoBaseLight" src="${ODONTO_BASE_LIGHT}" alt="Arcada clara">
              <img class="odontoBaseDark" src="${ODONTO_BASE_DARK}" alt="Arcada escura">
              <div class="odontoOverlay">${overlayBoxes(upper, 8.5)}${overlayBoxes(lower, 82.5)}</div>
            </div>
            <div class="odontoLegend">
              <span class="legendPill"><span class="legendDot" style="background:transparent;border:1px solid var(--line)"></span>Neutro</span>
              <span class="legendPill lp-plan"><span class="legendDot"></span>Planejado</span>
              <span class="legendPill lp-closed"><span class="legendDot"></span>Fechado</span>
              <span class="legendPill lp-done"><span class="legendDot"></span>Concluído</span>
            </div>
            <div style="margin-top:12px" class="small">A base do odontograma serve como guia visual. Os quadrinhos por cima podem ser sincronizados com o plano e também receber observação manual.</div>
            <div style="margin-top:14px; border-top:1px solid var(--line); padding-top:14px">
              <div style="font-size:16px; font-weight:800">${state.selectedTooth ? `Dente ${state.selectedTooth} • ${deriveToothType(state.selectedTooth)}` : 'Seleciona um dente'}</div>
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
                <textarea id="odontoNoteTxt" style="min-height:84px">${escapeHTML(selectedToothMeta.note || '')}</textarea>
                <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap">
                  <button class="btn ok" onclick="CRONOS_FICHA_UI.saveToothMeta()">Salvar marcação</button>
                  <button class="btn" onclick="CRONOS_FICHA_UI.clearToothMeta()">Limpar marcação</button>
                </div>
              ` : `<div class="muted" style="margin-top:8px">Clica num quadrinho do odontograma para editar a observação clínica ou destacar algo.</div>`}
            </div>
          </div>
        </div>
      `;
    }

    window.CRONOS_FICHA_UI = {
      setSearch(v){ const s = getFichaState(); if(!s) return; s.procSearch = v; renderFichaApp(); },
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
        bodyHTML:'<div id="fichaApp"></div>',
        footHTML:`<button class="btn" onclick="printFicha('${escapeHTML(String(entryId))}')">🖨️ Imprimir ficha</button><button class="btn" onclick="closeModal()">Fechar</button>`,
        onMount: renderFichaApp
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
      const win = window.open('', '_blank', 'width=1180,height=900');
      if(!win) return toast('Impressão', 'Não foi possível abrir a janela de impressão.');
      function overlayBoxes(list, y){
        return list.map((tooth, i)=>`<div class="box ${getToothVisualState(entry, tooth)}" style="left:${5.5 + i * 6.0}%; top:${y}%">${tooth}</div>`).join('');
      }
      win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha - ${patientName}</title>
        <style>
          body{font-family:Arial,sans-serif;padding:24px;color:#111;margin:0}
          .sheet{border:1px solid #d7dde7;padding:22px 24px 28px}
          .head{display:grid;grid-template-columns:120px 1fr 220px;gap:16px;align-items:center;border-bottom:2px solid #111;padding-bottom:14px}
          .logo{width:120px;height:84px;border:1.5px solid #111;display:grid;place-items:center;text-align:center;font-size:12px;font-weight:700;overflow:hidden}
          .logo img{max-width:100%;max-height:100%;display:block;object-fit:contain}
          .title{text-align:center}.title h2{margin:0;font-size:24px;letter-spacing:.05em}.title p{margin:6px 0 0;font-size:12px;color:#444;letter-spacing:.08em}
          .meta{text-align:right;font-size:12px;line-height:1.7}
          .patient{margin-top:12px;display:grid;grid-template-columns:1.3fr .9fr .8fr 1fr;gap:10px}
          .field{border:1px solid #111;min-height:45px;padding:7px 10px}.field .lbl{display:block;font-size:10px;color:#444;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px}.field .val{font-size:14px;font-weight:700}
          .main{margin-top:16px;display:grid;grid-template-columns:420px 1fr;gap:14px;align-items:start}
          .boxWrap{border:1.5px solid #111;padding:10px}.sectionTitle{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px}
          .odonto{position:relative;width:100%;aspect-ratio:1536/740;border:1px solid #cfd7e3;border-radius:10px;overflow:hidden;background:#eef1f5}
          .odonto img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
          .overlay{position:absolute;inset:0}
          .box{position:absolute;width:36px;height:36px;border-radius:8px;border:2px solid #5b7696;background:rgba(255,255,255,.95);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#122033;transform:translate(-50%,0)}
          .box.plan{background:#fff3b8;border-color:#b58d00}.box.closed{background:#dfe9ff;border-color:#4c6edb}.box.done{background:#daf2d3;border-color:#2f8f46}
          .legend{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:#555}.legend span{display:inline-flex;align-items:center;gap:6px;border:1px solid #ddd;padding:5px 9px;border-radius:999px}
          .chip{width:10px;height:10px;border-radius:999px;display:inline-block}.cp1{background:#facc15}.cp2{background:#4c6edb}.cp3{background:#2ee59d}
          table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #111;padding:6px 7px;vertical-align:top}th{background:#f5f5f5;font-size:10px;text-transform:uppercase;letter-spacing:.08em;text-align:left}td.center{text-align:center}td.right{text-align:right}tr.done td{background:#e6f7e3}tr.closed td{background:#eef4ff}
          .summary{border-top:1.5px solid #111;margin-top:auto;display:grid;grid-template-columns:repeat(5,1fr)}.sum{border-right:1px solid #111;padding:8px 9px;min-height:62px}.sum:last-child{border-right:none}.sum .lbl{font-size:10px;text-transform:uppercase;color:#444;font-weight:800;letter-spacing:.06em;margin-bottom:6px}.sum .val{font-size:16px;font-weight:800}
          .obs{margin-top:14px;border:1.5px solid #111;min-height:96px;padding:10px}.obsText{margin-top:8px;line-height:1.45;font-size:13px}
          .foot{margin-top:16px;display:flex;justify-content:space-between;gap:16px;align-items:flex-end;font-size:11px;color:#333}.sign{width:270px;border-top:1px solid #111;text-align:center;padding-top:6px;color:#111}
          @media print{body{padding:0}.sheet{border:none}tr.done td{background:#e6f7e3 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}tr.closed td{background:#eef4ff !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
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
          <div class="main">
            <div class="boxWrap">
              <div class="sectionTitle">Odontograma</div>
              <div class="odonto"><img src="${ODONTO_BASE_LIGHT}" alt="Odontograma"><div class="overlay">${overlayBoxes(upper, 8.5)}${overlayBoxes(lower, 82.5)}</div></div>
              <div class="legend"><span><i class="chip cp1"></i>Planejado</span><span><i class="chip cp2"></i>Fechado</span><span><i class="chip cp3"></i>Concluído</span></div>
            </div>
            <div style="border:1.5px solid #111;display:flex;flex-direction:column">
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
          </div>
          <div class="obs"><div class="sectionTitle">Observações</div><div class="obsText">${obs || '—'}</div></div>
          <div class="foot"><div>Documento gerado pelo Cronos</div><div class="sign">Assinatura / Responsável</div></div>
        </div>
        <script>window.onload = () => window.print();<\/script>
        </body></html>`);
      win.document.close();
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
