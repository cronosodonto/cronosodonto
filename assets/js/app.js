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
    const ODONTO_BASE_LIGHT = "data:image/png;base64,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Cr9ndqTSOfvtzso6lzP6Qj2/FBTaLSeMca2heYV0dFatUMenq5HcrIZKoROcenhz7eq3TDNHUxMlikbLE8BzXsO7XA+BBHig80REBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERARFrTUTiX0s0mqzS5dnljsdYPGmqatvej5sG5H3INlop4o+0H4ea2odCzVKyxua7lLpi+Np+TnNAI+K3NhOoWM6kWht0xa/W/ILe7wqLfUNlaPnsen1QZCiIgIiICIiAiIgIiICIiAiIgIiICL8e9sbHOc4Na0blxOwAXRTZ9jFNU+zzZHaYp99u6fXRB2/psXboO+Reqlq4K6Fs1NNHUQu8JInhzT9QvagIiICIiAi0FrVx0aN6DXSotGR5SKnIINg6y2iB1XVhx8Glrfdaf5zgsLw3tQNAsqqHUtfkNww6tB29myW3SUxI/a5m87APm4H4IKxRYbhOsuCakUTavF8vs19gd4GirY3n+jvuPuWZICIiAiIgIiICIiAiIgIiICIiAi41yuVJZ6Cetr6mKjo6dhklqJ3hjI2jqS5x6AKTc+7T3SHG7q6z4nDftULyOns+I0HtEbT5c0ji0bfFnMgrtFGLe0BzdjPbZ+GPUSOzDq6rYGOkDdt9+75Rv8uZZ1pH2g+j+rF6ZYX3OuwrJnODBZMupfYKguPgAeZzCfgHb/BBSiL8a4OAIIIPUEea/UBERAREQEREBFwpL3boq5tG+vpWVjugp3TNEh/h33XNQEREBERAREQEREBEXT12Y2C11LaesvltpJ3HYRT1cbHE/IndB3CLwhmjqI2yRSNljd4PYdwfqvNAREQEREBERAREQEREBERAREQEREBERAREQEXorK6mt0Bmq6iKlhHjJM8MaPqV1VFnWNXOoFPR5Daqqc+EUFbE9x+gdug7xERAREQEREBERAREQEREBERARFj2eahY1phjlRfssvdFYLPBsJKuulEbAT4Ab+J+A6oMhRRxe+1b0OttzmprcMpyalhO0lxs9mc+mb6+89zCQPUDb03W2tI+NLRnW6RtPi+c2+W4OaHG313NSVA+HJKGknfp03QbtRAdxuOoRAREQEREBERAREQEREBERAREQF6qqqhoaaWoqJWQU8TS+SWRwa1jQNyST4AL2kgAknYBfP3WDJ8r7QDWC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8kp8st0L+jRzueZuUep9oj+kfwVxVdSyipZqiTcRxMdI7bx2A3KhfiZbS6MdodoPqJs+Omy+mqcZrXAe6JGljI3E+p9oYNv3OngVY2qNwZadM8urZCBHTWirmdudujYXk9fogk3sm55L3w/5Pkk7Wtqr3ltwq5iDuS48hP4uKtlRb2RttmoeDyhmlaWsrL1XVEW48W8zWb/ewq0kBERAREQEREGhOOXRlmuXDLmFihpDU3qjg/Ktocw7SRVkG72Fh8i5vOz5SFcrgs1uj1/4ccRyd+0d2jg/J10gJ3dFVwHu37jy5uUSAHyeFvEgEEEbg+SgfQGE8I/HTmuk9RtS4TqOHX/GZZXbNbUgF0lO3yG28rQPEhkfiXIL4UOcDFM+zcW3Frbhs6J1/pJwd9z1dUkfg9XGok4dpfyD2kfEfZAwRMrbdbrly7/acY4jv9e+JQW2iIgIiICIiAtX678NWnnEhjhtGc2CG48gPs9fF+jq6U+sUo6t+R3B8wVtBEGCaLaJ4lw/4DRYfhlu/J9opiXkvdzyzyH7Ukr/ANZ52G5+AA2AAWdoiAiIgIiICIiAuoy3ELLnmO11hyK2U14s1dGYqmiq4w+ORp8iP9viF26IJIxXsttA8UyyC9ssl1ukNNP7RTWa53N81BC/fcER9C4D0e5wPnuq0hhjp4mRRMbHExoa1jBsGgeAA8gvNEBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQFCHBHcYqXja4rrTLvHWzXllWyN3QmISyDm+X6Rv3q71HfErwyalUet9u1q0Dr7bbs2qKYWy+266kNpa+EABkrtx1c0BoPXchjSOoO4Zhx38So4ftHqilsk3fahZNva8dt8A56iSaQhhlYwdTycw2/eLB57LJ+DbQNvDhw/wCN4jNHG2892ay7SRnfvKuT3pOvny9G7+jVrHQHgovtu1WOset2VRZ7qaG8lBFSMLbfao+uwiDgC5w5nbdGgcx6EnmVdoCIiAiIgIiICIiCA9cbRnnA/r7luuuE42cy03y6JkmW2WmPLUUlQwHlqWnYkN5nuJOxHvv5gNw4dvwZ6R5drHqxdeJnVu1ut14ucZhxGxVLXA2qhcCGyBp26ujdsHEAkOe7Yc42uVEBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERBPvG5w/wB14gdHG0WMTxUeaWGvhvdiqZdhy1UJJDQ7y5gSNz03238FKepvF5rBrpp6dC7dpHkWO6t3lrLVfK6opS2300J92edjuuzHjcgk8oBOzndN/pciDAtBtJ6LQzR3EsDoJBPDY6COmfUBvL3823NLLt5c8he7by5tlnqIgIiICIiAiIgKP+0i0cvuWac2DUvCoO8zjTi4MvdKGDeSWnYQ6VrR5kFrH7eYa4eJCsBeL2NkY5j2hzHDYtI3BHog1zw+a44/xCaTWTNrBWwVENXCG1kMb/epKloHewyDxa5pPgfEFpG4IJlzgsuUOr3GZxH6pUIdJZ2TUuPUdSRuybugGuLT8BAw/J49VzdSuzYl/OK7V+jupt40pt2Rzb5BZqXmlpJ4zvzOhAc0sd1d0JI69C0dDUmimi+L6A6d23DMRovZLVRguc553lqJTtzyyO/We7bqfgAOgCDOkREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREH//2Q==";
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
        .odontoRefStage{position:relative; width:100%; aspect-ratio:1536/740; border:1px solid var(--line); border-radius:14px; overflow:hidden; background:#f3f4f6}
        body.dark .odontoRefStage{background:#111827}
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
        .fichaPlan{background:rgba(255,212,0,.14)!important}.fichaPlan td{background:rgba(255,212,0,.14)!important}
        .fichaClosed{background:rgba(29,78,216,.14)!important}.fichaClosed td{background:rgba(29,78,216,.14)!important}
        .odontoLegend{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
        .legendPill{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);padding:5px 10px;border-radius:999px;font-size:12px;background:rgba(255,255,255,.03)}
        .legendDot{width:12px;height:12px;border-radius:999px;display:inline-block;border:1px solid rgba(0,0,0,.15)}
        body.dark .legendDot{border-color:rgba(255,255,255,.22)}
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
    function getItemVisualState(entry, item){
      if(!item) return '';
      if(item.feito || item.pago) return 'done';
      const ficha = ensureFicha(entry);
      const teeth = String(item.dente||'').split(',').map(s=>s.trim()).filter(Boolean);
      if(teeth.length){
        const states = teeth.map(t => String(ficha.odontograma?.[t]?.status || '')).filter(Boolean);
        if(states.includes('done')) return 'done';
        if(states.includes('closed')) return 'closed';
        if(states.includes('plan')) return 'plan';
      }
      if(Number(item.valorFechado||0) > 0) return 'closed';
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
                  <tr class="${(()=>{ const _st = getItemVisualState(entry, item); return _st==='done' ? 'fichaDone' : (_st==='closed' ? 'fichaClosed' : (_st==='plan' ? 'fichaPlan' : '')); })()}">
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
