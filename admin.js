/* Admin panel: auth guard + Overview + Customers + 7 modules. Access is enforced by the admins/<uid> document AND firestore.rules. */
import { auth, db, fns, configured } from "../firebase-config.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, query, where, orderBy, limit, serverTimestamp, getCountFromServer, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { esc, inr, dt, ms, emi, maskPan, $ } from "./util.js";

const page = document.body.dataset.page, A = document.getElementById("app"), dlg = document.getElementById("dlg");
const toast = (m, t = "") => { const e = document.createElement("div"); e.className = "t " + t; e.textContent = m; $("#toast").append(e); setTimeout(() => e.remove(), 5500); };
const show = html => { dlg.innerHTML = `<div class="dlg wide">${html}</div>`; if (!dlg.open) dlg.showModal(); };
dlg.addEventListener("click", e => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });
const chip = s => `<span class="chip s-${esc(String(s || "none").toLowerCase().replace(/[^a-z]+/g, "-"))}">${esc(s || "—")}</span>`;
const kv = rows => `<dl class="review">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v ?? "—"}</dd></div>`).join("")}</dl>`;
const me = () => auth.currentUser?.email || auth.currentUser?.uid;
const rs = n => "Rs. " + Number(n || 0).toLocaleString("en-IN");
const audit = (action, module, recordId, uid, details = "") => addDoc(collection(db, "auditLogs"), { actor: auth.currentUser.uid, actorEmail: me(), action, module, recordId: recordId || "", uid: uid || "", details: String(details).slice(0, 300), createdAt: serverTimestamp() });
const notify = (uid, title, body) => addDoc(collection(db, "customers", uid, "notifications"), { title, body, read: false, createdAt: serverTimestamp() });
const list = async (col, ...q) => (await getDocs(query(collection(db, col), ...q))).docs.map(d => ({ id: d.id, ...d.data() }));
const byUid = async (col, uid) => (await list(col, where("uid", "==", uid))).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
const findCustomer = async cid => (await list("customers", where("customerId", "==", cid), limit(1)))[0];

/* ---------- PDF (jsPDF loaded by the page) ---------- */
function pdf(title, rows, { mark, file } = {}) {
  if (!window.jspdf) return toast("PDF library not loaded. Check internet connection.", "error");
  const d = new window.jspdf.jsPDF(); d.setFontSize(16); d.text(title, 14, 18);
  if (mark) { d.setTextColor(190, 0, 0); d.setFontSize(11); d.text(mark, 14, 26); d.setTextColor(0); }
  d.setFontSize(10); let y = 36;
  rows.forEach(([k, v]) => { const l = d.splitTextToSize(v === "" ? k : `${k}: ${v ?? "-"}`, 180); if (y + l.length * 5 > 280) { d.addPage(); y = 20; } d.text(l, 14, y); y += l.length * 5 + 2; });
  d.setFontSize(8); d.text(`Generated ${new Date().toLocaleString("en-IN")} | ${(window.SITE || {}).name || "[Company Name]"}`, 14, 290); d.save(file || "document.pdf");
}

/* ---------- generic table: search, status/date filters, pagination, CSV ---------- */
function table(host, { rows, cols, statuses, open, size = 10 }) {
  let q = "", st = "", from = "", to = "", pg = 0, view = rows;
  host.innerHTML = `<div class="toolbar"><input type="search" placeholder="Search…" aria-label="Search" id="q">${statuses ? `<select id="st" aria-label="Status"><option value="">All statuses</option>${statuses.map(s => `<option>${esc(s)}</option>`).join("")}</select>` : ""}<input type="date" id="df" aria-label="From date"><input type="date" id="dt" aria-label="To date"><button class="btn btn-ghost btn-sm" id="csv">Export CSV</button></div>
  <div class="tbl-wrap"><table><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join("")}</tr></thead><tbody></tbody></table></div><div class="pager"></div>`;
  const body = host.querySelector("tbody"), pager = host.querySelector(".pager");
  const draw = () => {
    view = rows.filter(r => (!q || Object.values(r).map(v => typeof v === "object" ? "" : v).join(" ").toLowerCase().includes(q)) && (!st || r.status === st) && (!from || ms(r.createdAt) >= new Date(from)) && (!to || ms(r.createdAt) <= new Date(to + "T23:59:59")));
    const pages = Math.max(1, Math.ceil(view.length / size)); pg = Math.min(pg, pages - 1);
    body.innerHTML = view.slice(pg * size, pg * size + size).map(r => `<tr data-id="${esc(r.id)}" tabindex="0">${cols.map(c => `<td>${c[0] === "Status" ? chip(c[1](r)) : esc(c[1](r))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length}" class="empty">No records found.</td></tr>`;
    pager.innerHTML = `<span>${view.length} record(s)</span><span class="sp"></span><button class="btn btn-ghost btn-sm" data-p="-1" ${pg ? "" : "disabled"}>Prev</button> Page ${pg + 1}/${pages} <button class="btn btn-ghost btn-sm" data-p="1" ${pg < pages - 1 ? "" : "disabled"}>Next</button>`;
  };
  host.querySelector(".toolbar").addEventListener("input", e => { q = $("#q", host).value.trim().toLowerCase(); st = $("#st", host)?.value || ""; from = $("#df", host).value; to = $("#dt", host).value; pg = 0; draw(); });
  pager.addEventListener("click", e => { const b = e.target.closest("[data-p]"); if (b) { pg += +b.dataset.p; draw(); } });
  const go = e => { const tr = e.target.closest("tr[data-id]"); if (tr) open(rows.find(r => r.id === tr.dataset.id)); };
  body.addEventListener("click", go); body.addEventListener("keydown", e => { if (e.key === "Enter") go(e); });
  $("#csv", host).addEventListener("click", () => { const t = [cols.map(c => c[0]), ...view.map(r => cols.map(c => c[1](r)))].map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t], { type: "text/csv" })); a.download = "export.csv"; a.click(); });
  draw();
}

/* ---------- field helpers ---------- */
const F = (k, l, t = "text", x = {}) => ({ k, l, t, ...x });
function fieldHtml(f, v, ro) {
  const id = "x_" + f.k, dis = ro ? "disabled" : "", val = v ?? "";
  if (f.t === "checkbox") return `<div class="field"><div class="consent"><input type="checkbox" id="${id}" data-k="${f.k}" ${val ? "checked" : ""}><label for="${id}">${f.l}</label></div></div>`;
  const c = f.t === "select" ? `<select id="${id}" data-k="${f.k}" ${dis}><option value="">Select…</option>${f.o.map(o => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>` : f.t === "textarea" ? `<textarea id="${id}" data-k="${f.k}" ${dis}>${esc(val)}</textarea>` : `<input id="${id}" data-k="${f.k}" type="${f.t}" value="${esc(val)}" ${dis} ${f.t === "number" ? 'step="any"' : ""}>`;
  return `<div class="field"><label for="${id}">${f.l}${f.req ? " *" : ""}</label>${c}${f.h ? `<span class="hint">${f.h}</span>` : ""}</div>`;
}
const readForm = (root, fields) => { const o = {}; fields.forEach(f => { const e = root.querySelector(`[data-k="${f.k}"]`); if (!e) return; o[f.k] = f.t === "checkbox" ? e.checked : f.t === "number" ? (e.value === "" ? "" : Number(e.value)) : e.value.trim(); }); return o; };

/* ================== MODULE DEFINITIONS ================== */
const STAT_FLOW = { Submitted: ["Under Review", "Cancelled"], "Under Review": ["Additional Documents Required", "Verified", "Rejected", "Cancelled"], "Additional Documents Required": ["Under Review", "Cancelled"], Verified: ["Approved", "Rejected", "Under Review"], Approved: ["Agreement Pending", "Rejected", "Cancelled"], "Agreement Pending": ["Agreement Executed", "Cancelled"], "Agreement Executed": ["Disbursement Pending", "Cancelled"], "Disbursement Pending": ["Disbursed", "Cancelled"], Disbursed: ["Closed"], Rejected: ["Under Review"], Cancelled: ["Under Review"], Closed: [] };
const LOCKED = ["Agreement Executed", "Disbursement Pending", "Disbursed", "Closed"];
const CID = F("customerId", "Customer ID", "text", { req: 1 }), APP = F("applicationId", "Application ID", "text");
const agreementText = r => `LOAN AGREEMENT - ${r.status === "Executed" ? "EXECUTED COPY" : "DRAFT / NOT EXECUTED"}\n\nReference: ${r.ref}\nCustomer ID: ${r.customerId}\nApplication: ${r.applicationId || "-"}\nLoan amount: ${rs(r.loanAmount)}\nInterest rate: ${r.interestRatePct}% per year\nTenure: ${r.tenureMonths} months\nCharges: ${r.charges || "As disclosed in Key Facts Statement"}\nRepayment terms: ${r.repaymentTerms || "-"}\nStatus: ${r.status}\n${r.status === "Executed" ? "Signed copy reference: " + r.signedRef : "This document is not signed and has no legal effect until executed by all parties."}`;
const MODS = {
  tds: { title: "TDS & Transaction Management", col: "tdsRecords", prefix: "TDS", statuses: ["Pending Verification", "Under Review", "Verified", "Rejected"],
    fields: [CID, F("transactionRef", "Transaction reference", "text", { req: 1 }), F("transactionDate", "Transaction date", "date", { req: 1 }), F("transactionType", "Transaction type", "select", { req: 1, o: ["Interest payment", "Commission", "Fee", "Other"] }), F("amount", "Transaction amount (₹)", "number", { req: 1 }), F("tdsRate", "TDS rate (%)", "number", { h: "Enter the rate applicable under the relevant rules. Nothing is assumed." }), F("evidenceRef", "Supporting document reference", "text")],
    calc: p => ({ tdsAmount: p.tdsRate !== "" && p.tdsRate != null ? Math.round(p.amount * p.tdsRate) / 100 : null }),
    cols: [["Reference", r => r.ref], ["Customer ID", r => r.customerId], ["Type", r => r.transactionType], ["Amount", r => inr(r.amount)], ["TDS", r => inr(r.tdsAmount)], ["Date", r => r.transactionDate], ["Status", r => r.status]],
    pdf: r => pdf("Transaction / TDS record", [["Reference", r.ref], ["Customer ID", r.customerId], ["Transaction ref", r.transactionRef], ["Date", r.transactionDate], ["Type", r.transactionType], ["Amount", rs(r.amount)], ["TDS rate", r.tdsRate], ["TDS amount", r.tdsAmount], ["Status", r.status], ["Remarks", r.remarks]], { mark: r.status === "Verified" ? "" : "Not verified", file: r.ref + ".pdf" }) },
  agreements: { title: "Agreement Management", col: "agreements", prefix: "AGR", vis: 1, statuses: ["Draft", "Pending Signature", "Executed", "Cancelled"],
    fields: [CID, APP, F("loanAmount", "Loan amount (₹)", "number"), F("interestRatePct", "Interest rate (% per year)", "number"), F("tenureMonths", "Tenure (months)", "number"), F("charges", "Applicable charges", "textarea"), F("repaymentTerms", "Repayment terms", "textarea"), F("signedRef", "Signed copy reference", "text", { h: "Required to mark an agreement Executed. The site never marks anything signed on its own." })],
    prep: async (p, app) => { const t = app?.terms; if (t) { if (p.loanAmount === "") p.loanAmount = app.loanAmount; if (p.interestRatePct === "") p.interestRatePct = t.interestRatePct; if (p.tenureMonths === "") p.tenureMonths = t.tenureMonths; if (!p.charges) p.charges = `Processing fee ${t.processingFeePct}%. ${t.otherCharges || ""}`; } },
    check: p => p.status === "Executed" && !p.signedRef ? "Add the signed copy reference before marking Executed." : (p.status !== "Draft" && p.status !== "Cancelled" && (p.loanAmount === "" || p.interestRatePct === "" || p.tenureMonths === "")) ? "Loan amount, rate and tenure are required beyond Draft." : "",
    cols: [["Reference", r => r.ref], ["Customer ID", r => r.customerId], ["Application", r => r.applicationId], ["Amount", r => inr(r.loanAmount)], ["Rate", r => r.interestRatePct != null ? r.interestRatePct + "%" : "—"], ["Version", r => (r.versions || []).length], ["Status", r => r.status]],
    extra: r => `<button type="button" class="btn btn-ghost btn-sm" data-x="prev">Preview</button><button type="button" class="btn btn-ghost btn-sm" data-x="pdf">Download PDF</button>`,
    act: (r, k) => { if (k === "prev") show(`<h2>Agreement preview</h2><pre class="pre">${esc(agreementText(r))}</pre><button class="btn btn-primary" data-close>Close</button>`); if (k === "pdf") pdf("Loan Agreement", agreementText(r).split("\n").filter(Boolean).slice(1).map(l => { const i = l.indexOf(": "); return i < 0 ? [l, ""] : [l.slice(0, i), l.slice(i + 2)]; }), { mark: r.status === "Executed" ? "EXECUTED COPY" : "DRAFT - NOT EXECUTED", file: r.ref + ".pdf" }); } },
  rtgs: { title: "RTGS / NEFT Management", col: "rtgsRecords", prefix: "TRF", vis: 1, statuses: ["Pending Verification", "Under Review", "Verified", "Rejected", "Failed", "Reversed"],
    fields: [CID, APP, F("transferType", "Transfer type", "select", { req: 1, o: ["RTGS", "NEFT"] }), F("amount", "Transaction amount (₹)", "number", { req: 1 }), F("transactionDate", "Transaction date", "date", { req: 1 }), F("bankRef", "Bank reference number (UTR)", "text"), F("evidenceRef", "Receipt / evidence reference", "text")],
    check: p => p.status === "Verified" && (!p.bankRef || !p.evidenceRef) ? "Verified needs the bank reference and evidence reference. Recorded entries are NOT proof of a transfer." : "",
    cols: [["Reference", r => r.ref], ["Customer ID", r => r.customerId], ["Type", r => r.transferType], ["Amount", r => inr(r.amount)], ["Date", r => r.transactionDate], ["Entry", r => r.status === "Verified" ? "Verified" : "Manual – awaiting verification"], ["Status", r => r.status]],
    pdf: r => pdf("RTGS / NEFT record", [["Reference", r.ref], ["Customer ID", r.customerId], ["Type", r.transferType], ["Amount", rs(r.amount)], ["Date", r.transactionDate], ["Bank reference", r.bankRef], ["Status", r.status], ["Remarks", r.remarks]], { mark: r.status === "Verified" ? "" : "Manually recorded - not verified", file: r.ref + ".pdf" }) },
  rbi: { title: "RBI Hold & Compliance Management", col: "complianceReviews", prefix: "CMP", vis: 1, statuses: ["Not Started", "Under Review", "Information Required", "Resolved", "Escalated"],
    fields: [CID, APP, F("category", "Compliance category", "select", { req: 1, o: ["Internal compliance review", "Information required from customer", "RBI-directed hold (official – evidence required)"] }), F("reason", "Reason for review", "textarea", { req: 1 }), F("missingDocs", "Missing documents", "text"), F("evidenceRef", "Supporting evidence reference", "text"), F("reviewer", "Assigned reviewer", "text"), F("reviewDate", "Review date", "date"), F("customerMessage", "Message for customer", "textarea", { h: "Shown only if 'Visible to customer' is ticked. Do not mention RBI unless an official RBI action is evidenced." })],
    check: p => p.category?.startsWith("RBI-directed") && !p.evidenceRef ? "An RBI-directed hold needs an evidence reference (official order/letter)." : (!p.category?.startsWith("RBI-directed") && /\brbi\b/i.test(p.customerMessage || "")) ? "Do not mention RBI to the customer for an internal review." : "",
    calc: p => ({ resolutionDate: p.status === "Resolved" ? new Date().toISOString().slice(0, 10) : null }),
    cols: [["Reference", r => r.ref], ["Customer ID", r => r.customerId], ["Category", r => r.category], ["Reviewer", r => r.reviewer], ["Review date", r => r.reviewDate], ["Status", r => r.status]] },
  gst: { title: "GST Management", col: "gstRecords", prefix: "GST", statuses: ["Draft", "Issued", "Cancelled"],
    fields: [CID, F("invoiceNo", "Invoice number", "text", { req: 1 }), F("invoiceDate", "Invoice date", "date", { req: 1 }), F("gstin", "GSTIN (if applicable)", "text"), F("description", "Supply description", "text"), F("taxableAmount", "Taxable amount (₹)", "number", { req: 1 }), F("taxRatePct", "GST rate (%)", "number", { req: 1, h: "Set per the actual transaction. Not every finance charge is taxed the same way." }), F("filingRef", "Return filing reference (only if actually filed)", "text")],
    calc: p => { const t = Math.round(p.taxableAmount * p.taxRatePct) / 100; return { taxAmount: t, totalAmount: Math.round((p.taxableAmount + t) * 100) / 100 }; },
    check: p => p.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/i.test(p.gstin) ? "GSTIN format is invalid." : "",
    cols: [["Invoice", r => r.invoiceNo], ["Customer ID", r => r.customerId], ["Date", r => r.invoiceDate], ["Taxable", r => inr(r.taxableAmount)], ["Tax", r => inr(r.taxAmount)], ["Total", r => inr(r.totalAmount)], ["Status", r => r.status]],
    pdf: r => pdf("Tax Invoice", [["Invoice no", r.invoiceNo], ["Date", r.invoiceDate], ["Customer ID", r.customerId], ["GSTIN", r.gstin], ["Description", r.description], ["Taxable amount", rs(r.taxableAmount)], ["GST rate", r.taxRatePct + "%"], ["GST amount", rs(r.taxAmount)], ["Total", rs(r.totalAmount)], ["Status", r.status]], { mark: r.status === "Issued" ? "" : "DRAFT - not an issued invoice", file: r.invoiceNo + ".pdf" }) },
  noc: { title: "NOC Management", col: "nocRecords", prefix: "NOC", statuses: ["Not Eligible", "Awaiting Closure Verification", "Eligible for Review", "Approved for Issuance", "Issued"],
    fields: [CID, F("applicationId", "Linked loan account (Application ID)", "text", { req: 1 }), F("repaymentStatus", "Repayment status", "select", { req: 1, o: ["Not started", "Ongoing", "Fully repaid"] }), F("outstandingAmount", "Outstanding amount (₹)", "number", { req: 1 }), F("closureVerified", "Loan closure verified against records", "checkbox"), F("closureNote", "Closure verification note", "text"), F("issueDate", "NOC issue date", "date"), F("issuingOfficer", "Authorised issuing officer", "text")],
    check: p => ["Approved for Issuance", "Issued"].includes(p.status) && !(p.closureVerified && p.repaymentStatus === "Fully repaid" && Number(p.outstandingAmount) === 0) ? "Cannot approve/issue: closure must be verified, loan fully repaid and outstanding amount 0." : p.status === "Issued" && (!p.issueDate || !p.issuingOfficer) ? "Issued NOC needs issue date and issuing officer." : "",
    cols: [["Reference", r => r.ref], ["Customer ID", r => r.customerId], ["Loan account", r => r.applicationId], ["Outstanding", r => inr(r.outstandingAmount)], ["Closure verified", r => r.closureVerified ? "Yes" : "No"], ["Status", r => r.status]],
    extra: r => r.status === "Issued" ? `<button type="button" class="btn btn-primary btn-sm" data-x="pdf">Download NOC PDF</button>` : `<span class="hint">NOC PDF is available only after status is Issued.</span>`,
    act: (r, k) => k === "pdf" && pdf("No Objection Certificate", [["NOC reference", r.ref], ["Customer ID", r.customerId], ["Loan account", r.applicationId], ["Outstanding amount", rs(r.outstandingAmount)], ["Issue date", r.issueDate], ["Issuing officer", r.issuingOfficer], ["Statement", "The loan account mentioned above is recorded as closed with no outstanding dues as on the issue date."]], { file: r.ref + ".pdf" }) }
};
MODS.approvals = { title: "Approval Management", col: "applications", statuses: Object.keys(STAT_FLOW),
  cols: [["Application", r => r.applicationId], ["Customer ID", r => r.customerId], ["Name", r => r.customerName], ["Amount", r => inr(r.loanAmount)], ["Tenure", r => r.tenureMonths + " m"], ["Submitted", r => dt(r.createdAt)], ["Status", r => r.status]] };

/* ---------- record create/edit dialog (TDS, Agreements, RTGS, RBI, GST, NOC) ---------- */
async function recordDialog(M, r, reload) {
  const isNew = !r, rec = r || {};
  const fields = [...M.fields, F("status", "Status", "select", { req: 1, o: M.statuses }), F("remarks", "Admin remarks", "textarea"), ...(M.vis ? [F("visibleToCustomer", "Visible to customer in their portal", "checkbox")] : [])];
  show(`<h2>${isNew ? "New record" : esc(rec.ref || rec.invoiceNo || "Record")}</h2><form id="rf" novalidate><div class="row2">${fields.map(f => fieldHtml(f, rec[f.k] ?? (f.k === "status" ? M.statuses[0] : ""), !isNew && f.k === "customerId")).join("")}</div><p class="err" id="rerr" role="alert"></p>
    <div class="btns" style="margin-top:6px"><button class="btn btn-primary" type="submit">${isNew ? "Create record" : "Save changes"}</button>${!isNew && M.pdf ? '<button class="btn btn-ghost" type="button" data-x="pdf">Download PDF</button>' : ""}${!isNew && M.extra ? M.extra(rec) : ""}<button class="btn btn-ghost" type="button" data-close>Close</button></div></form>${isNew ? "" : '<h3 style="margin-top:24px">Audit history</h3><div id="aud">Loading…</div>'}`);
  const form = $("#rf"); form.addEventListener("click", e => { const b = e.target.closest("[data-x]"); if (!b) return; b.dataset.x === "pdf" && M.pdf ? M.pdf(rec) : M.act?.(rec, b.dataset.x); });
  if (!isNew) list("auditLogs", where("recordId", "==", r.id)).then(a => { $("#aud").innerHTML = a.sort((x, y) => ms(y.createdAt) - ms(x.createdAt)).map(l => `<p><small>${dt(l.createdAt)}</small> — ${esc(l.action)} by ${esc(l.actorEmail)} ${esc(l.details)}</p>`).join("") || "<p>No history.</p>"; }).catch(() => $("#aud").textContent = "Could not load history.");
  form.addEventListener("submit", async e => {
    e.preventDefault(); const err = m => $("#rerr").textContent = m, btn = form.querySelector("[type=submit]"); err("");
    const p = readForm(form, fields); if (!isNew) p.customerId = rec.customerId;
    const miss = fields.find(f => f.req && (p[f.k] === "" || p[f.k] == null)); if (miss) return err(`${miss.l} is required.`);
    btn.disabled = true;
    try {
      const cust = await findCustomer(p.customerId); if (!cust) { btn.disabled = false; return err("No customer found with this Customer ID."); }
      p.uid = cust.uid; let app = null;
      if (p.applicationId) { const a = await getDoc(doc(db, "applications", p.applicationId)); if (!a.exists() || a.data().uid !== cust.uid) { btn.disabled = false; return err("Application ID not found for this customer."); } app = a.data(); }
      if (M.prep) await M.prep(p, app);
      const m = M.check?.(p, rec); if (m) { btn.disabled = false; return err(m); }
      Object.assign(p, M.calc?.(p) || {}); p.updatedAt = serverTimestamp(); p.updatedBy = me();
      if (M.col === "agreements") p.versions = [...(rec.versions || []), { v: (rec.versions || []).length + 1, at: Date.now(), by: me(), status: p.status, loanAmount: p.loanAmount, interestRatePct: p.interestRatePct, tenureMonths: p.tenureMonths }];
      let id = r?.id;
      if (isNew) { const ref = doc(collection(db, M.col)); id = ref.id; p.ref = `${M.prefix || "REC"}-${new Date().getFullYear()}-${id.slice(0, 6).toUpperCase()}`; p.createdAt = serverTimestamp(); p.createdBy = me(); p.source = "manual"; await setDoc(ref, p); }
      else await updateDoc(doc(db, M.col, id), p);
      await audit(isNew ? "created" : "updated", M.col, id, cust.uid, `status=${p.status}`);
      dlg.close(); toast("Saved.", "ok"); reload();
    } catch (x) { console.error(x); btn.disabled = false; err("Could not save: " + (x.code === "permission-denied" ? "permission denied." : x.message)); }
  });
}

/* ---------- Approval dialog ---------- */
async function approvalDialog(a, reload) {
  const cust = (await getDoc(doc(db, "customers", a.uid))).data() || {}, t = a.terms || {}, locked = LOCKED.includes(a.status), next = STAT_FLOW[a.status] || [];
  const ratio = cust.monthlyIncome ? Math.round((Number(a.otherObligations || 0) / cust.monthlyIncome) * 100) : null;
  show(`<h2>${esc(a.applicationId)} ${chip(a.status)}</h2>
  ${kv([["Customer", `${esc(a.customerName)} (${esc(a.customerId)})`], ["Requested amount", inr(a.loanAmount)], ["Purpose", esc(a.purpose)], ["Requested tenure", a.tenureMonths + " months"], ["Employment", esc(cust.employmentType) + " · " + esc(cust.employerName)], ["Monthly income", inr(cust.monthlyIncome)], ["Existing obligations", inr(a.otherObligations)], ["Preliminary indicator", ratio == null ? "—" : `Existing obligations are ${ratio}% of declared income (indicator only, not an eligibility decision)`], ["Identity / address / docs", `${chip(cust.identityStatus)} ${chip(cust.addressStatus)} ${chip(cust.docsStatus)}`], ["Decision", a.decisionBy ? `${esc(a.decisionReason)} — ${esc(a.decisionBy)}, ${dt(a.decisionAt)}` : "Not decided"]])}
  <h3 style="margin:18px 0 8px">Interest, fees & tenure ${locked ? "(locked – agreement stage)" : ""}</h3>
  <form id="tf" novalidate><div class="row2">${[F("interestRatePct", "Interest rate (% per year)", "number"), F("processingFeePct", "Processing fee (%)", "number"), F("tenureMonths", "Approved tenure (months)", "number"), F("otherCharges", "Other charges (text)", "text")].map(f => fieldHtml(f, t[f.k], locked)).join("")}</div>
  <div class="consent"><input type="checkbox" id="tv" ${a.termsVisible ? "checked" : ""} ${locked ? "disabled" : ""}><label for="tv">Show these terms to the customer as <b>proposed</b> terms</label></div><p class="err" id="terr" role="alert"></p>
  <div class="btns"><button class="btn btn-primary btn-sm" type="submit" ${locked ? "disabled" : ""}>Save terms &amp; calculate EMI</button>${t.estimatedEmi ? `<span class="hint">Estimated EMI: ${inr(t.estimatedEmi)}</span>` : ""}</div></form>
  <h3 style="margin:18px 0 8px">Decision & workflow</h3><div class="row2"><div class="field"><label for="ns">Move to status</label><select id="ns"><option value="">Select…</option>${next.map(s => `<option>${s}</option>`).join("")}</select></div><div class="field"><label for="nr">Reason / remark (required for Approved / Rejected)</label><input id="nr"></div></div>
  <div class="field"><label for="md">Request additional documents (comma separated)</label><input id="md" value="${esc((a.missingDocs || []).join(", "))}"></div><p class="err" id="derr" role="alert"></p>
  <div class="btns"><button class="btn btn-primary btn-sm" id="chg">Update status</button><button class="btn btn-ghost btn-sm" id="reqd">Request documents</button><button class="btn btn-ghost btn-sm" id="remk">Add internal remark</button><button class="btn btn-ghost btn-sm" id="apdf">Summary PDF</button><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
  ${(a.remarks || []).length ? `<h4 style="margin-top:14px">Internal remarks</h4>${a.remarks.map(x => `<p><small>${dt(x.at)} · ${esc(x.by)}</small><br>${esc(x.text)}</p>`).join("")}` : ""}`);
  const E = id => $("#" + id), ref = doc(db, "applications", a.id);
  const guard = async (fn) => { try { await fn(); } catch (x) { console.error(x); E("derr").textContent = x.message || "Failed."; } };
  E("tf").addEventListener("submit", async e => { e.preventDefault(); const terr = E("terr"); terr.textContent = ""; if (locked) return;
    const p = readForm(E("tf"), [F("interestRatePct", "", "number"), F("processingFeePct", "", "number"), F("tenureMonths", "", "number"), F("otherCharges")]);
    if (p.interestRatePct === "" || p.interestRatePct < 0 || p.interestRatePct > 60) return terr.textContent = "Interest rate must be between 0 and 60.";
    if (p.processingFeePct === "" || p.processingFeePct < 0 || p.processingFeePct > 20) return terr.textContent = "Processing fee must be between 0 and 20.";
    if (!(p.tenureMonths >= 3 && p.tenureMonths <= 360)) return terr.textContent = "Tenure must be 3 to 360 months.";
    p.estimatedEmi = Math.round(emi(a.loanAmount, p.interestRatePct, p.tenureMonths)); p.setBy = me(); p.setAt = Date.now();
    await updateDoc(ref, { terms: p, termsVisible: E("tv").checked, updatedAt: serverTimestamp() }); await audit("terms set", "applications", a.id, a.uid, `rate=${p.interestRatePct} fee=${p.processingFeePct}`);
    if (E("tv").checked) await notify(a.uid, "Proposed loan terms available", `Proposed terms for ${a.applicationId} are now visible in your dashboard.`);
    toast("Terms saved.", "ok"); dlg.close(); reload(); });
  E("chg").addEventListener("click", () => guard(async () => { const s = E("ns").value, why = E("nr").value.trim(); if (!s) throw new Error("Select a status.");
    if (["Approved", "Rejected"].includes(s) && !why) throw new Error("A reason is required for this decision.");
    if (s === "Approved" && !(a.terms && a.terms.interestRatePct != null && a.terms.tenureMonths)) throw new Error("Save interest rate, fee and tenure before approving.");
    if (s === "Agreement Executed" && !(await list("agreements", where("applicationId", "==", a.id))).some(x => x.status === "Executed")) throw new Error("No Executed agreement is recorded for this application.");
    if (s === "Disbursed" && !(await list("rtgsRecords", where("applicationId", "==", a.id))).some(x => x.status === "Verified")) throw new Error("No Verified RTGS/NEFT record is linked. A disbursement is not recorded without verified evidence.");
    const up = { status: s, statusHistory: arrayUnion({ status: s, at: new Date(), by: me() }), updatedAt: serverTimestamp() };
    if (["Approved", "Rejected"].includes(s)) Object.assign(up, { decisionReason: why, decisionBy: me(), decisionAt: serverTimestamp() });
    await updateDoc(ref, up); await audit("status → " + s, "applications", a.id, a.uid, why); await notify(a.uid, "Application status updated", `Your application ${a.applicationId} status is now: ${s}.`); toast("Status updated.", "ok"); dlg.close(); reload(); }));
  E("reqd").addEventListener("click", () => guard(async () => { const docs = E("md").value.split(",").map(s => s.trim()).filter(Boolean); if (!docs.length) throw new Error("List at least one document.");
    await updateDoc(ref, { missingDocs: docs, ...(a.status === "Under Review" ? { status: "Additional Documents Required", statusHistory: arrayUnion({ status: "Additional Documents Required", at: new Date(), by: me() }) } : {}), updatedAt: serverTimestamp() });
    await audit("documents requested", "applications", a.id, a.uid, docs.join(", ")); await notify(a.uid, "Documents requested", `Please provide: ${docs.join(", ")}.`); toast("Request recorded and customer notified in portal.", "ok"); dlg.close(); reload(); }));
  E("remk").addEventListener("click", () => guard(async () => { const x = E("nr").value.trim(); if (!x) throw new Error("Type a remark in the reason box."); await updateDoc(ref, { remarks: arrayUnion({ text: x, by: me(), at: Date.now() }) }); await audit("remark", "applications", a.id, a.uid, x); toast("Remark added.", "ok"); dlg.close(); reload(); }));
  E("apdf").addEventListener("click", () => pdf("Application summary", [["Application", a.applicationId], ["Customer ID", a.customerId], ["Name", a.customerName], ["Amount", rs(a.loanAmount)], ["Purpose", a.purpose], ["Tenure", a.tenureMonths + " months"], ["Status", a.status], ["Interest rate", t.interestRatePct], ["Processing fee %", t.processingFeePct], ["Estimated EMI", t.estimatedEmi ? rs(t.estimatedEmi) : "-"], ["Decision", a.decisionReason || "-"]], { mark: "Internal summary - not a sanction letter", file: a.applicationId + ".pdf" }));
}
async function settingsDialog() {
  const s = (await getDoc(doc(db, "settings", "loanTerms"))).data() || {};
  const fs = [F("interestMin", "Interest rate – minimum (%)", "number"), F("interestMax", "Interest rate – maximum (%)", "number"), F("processingFeePct", "Processing fee (%)", "number"), F("otherCharges", "Other charges (text)", "text"), F("tenures", "Available tenures (text)", "text"), F("note", "Disclosure note shown to public", "textarea")];
  show(`<h2>Loan terms &amp; fees (public)</h2><p class="hint">Shown on the public website. Does not change terms already offered to applicants.</p><form id="sf" novalidate><div class="row2">${fs.map(f => fieldHtml(f, s[f.k])).join("")}</div><p class="err" id="serr"></p><button class="btn btn-primary" type="submit">Save</button> <button class="btn btn-ghost" type="button" data-close>Close</button></form>`);
  $("#sf").addEventListener("submit", async e => { e.preventDefault(); const p = readForm($("#sf"), fs), er = m => $("#serr").textContent = m;
    if (p.interestMin === "" || p.interestMax === "" || p.interestMin < 0 || p.interestMax > 60 || p.interestMin > p.interestMax) return er("Enter a valid rate range (0–60, min ≤ max).");
    if (p.processingFeePct === "" || p.processingFeePct < 0 || p.processingFeePct > 20) return er("Processing fee must be between 0 and 20.");
    await setDoc(doc(db, "settings", "loanTerms"), { ...p, updatedAt: serverTimestamp() }); await audit("loan terms updated", "settings", "loanTerms", "", ""); dlg.close(); toast("Saved.", "ok"); });
}

/* ---------- module page ---------- */
async function modulePage(m, key) {
  const M = MODS[key]; $("#ptitle").textContent = M.title;
  m.innerHTML = `<div class="bar-row"><h1>${M.title}</h1><span class="sp"></span>${key === "approvals" ? '<button class="btn btn-ghost btn-sm" id="tm">Loan terms &amp; fees</button>' : '<button class="btn btn-primary btn-sm" id="nw">+ New record</button>'}</div><div id="list">Loading…</div>`;
  const load = async () => { const h = $("#list"); h.textContent = "Loading…"; try { const rows = await list(M.col, orderBy("createdAt", "desc"), limit(300)); table(h, { rows, cols: M.cols, statuses: M.statuses, open: r => key === "approvals" ? approvalDialog(r, load) : recordDialog(M, r, load) }); } catch (e) { console.error(e); h.innerHTML = `<div class="notice err">Could not load records (${esc(e.code || e.message)}).</div>`; } };
  $("#nw")?.addEventListener("click", () => recordDialog(M, null, load)); $("#tm")?.addEventListener("click", settingsDialog); load();
}

/* ---------- overview ---------- */
async function overview(m) {
  $("#ptitle").textContent = "Overview"; m.innerHTML = "Loading…";
  try {
    const wk = new Date(Date.now() - 7 * 864e5);
    const [cc, nc, apps, rc, aud, ag, rt] = await Promise.all([getCountFromServer(collection(db, "customers")), getCountFromServer(query(collection(db, "customers"), where("createdAt", ">=", wk))), list("applications", orderBy("createdAt", "desc"), limit(1000)), list("customers", orderBy("createdAt", "desc"), limit(6)), list("auditLogs", orderBy("createdAt", "desc"), limit(8)), getCountFromServer(query(collection(db, "agreements"), where("status", "==", "Pending Signature"))), getCountFromServer(query(collection(db, "rtgsRecords"), where("status", "==", "Verified")))]);
    const n = s => apps.filter(a => a.status === s).length, max = Math.max(1, ...Object.keys(STAT_FLOW).map(n));
    const card = (l, v) => `<div class="card stat"><small>${l}</small><b>${v}</b></div>`;
    m.innerHTML = `<h1>Overview</h1><div class="grid g4">${card("Registered customers", cc.data().count)}${card("New (last 7 days)", nc.data().count)}${card("Applications", apps.length)}${card("Pending (Submitted)", n("Submitted"))}${card("Under review", n("Under Review"))}${card("Awaiting documents", n("Additional Documents Required"))}${card("Approved", n("Approved"))}${card("Rejected", n("Rejected"))}${card("Agreements pending signature", ag.data().count)}${card("Verified transactions", rt.data().count)}${card("Disbursed (verified)", n("Disbursed"))}</div>
    <div class="grid g2" style="margin-top:24px"><div class="card"><h3>Applications by status</h3>${Object.keys(STAT_FLOW).map(s => `<div class="barrow"><span>${s}</span><div><i style="width:${n(s) / max * 100}%"></i></div><b>${n(s)}</b></div>`).join("")}</div>
    <div class="card"><h3>Recent registrations</h3>${rc.map(c => `<p>${esc(c.customerId)} · ${esc(c.fullName)}<br><small>${dt(c.createdAt)}</small></p>`).join("") || "<p>None yet.</p>"}<h3 style="margin-top:18px">Recent admin activity</h3>${aud.map(l => `<p><small>${dt(l.createdAt)}</small> ${esc(l.action)} · ${esc(l.module)}<br><small>${esc(l.actorEmail)}</small></p>`).join("") || "<p>No activity yet.</p>"}</div></div>`;
  } catch (e) { console.error(e); m.innerHTML = `<div class="notice err">Could not load overview (${esc(e.code || e.message)}).</div>`; }
}

/* ---------- customers ---------- */
async function customersPage(m) {
  $("#ptitle").textContent = "Customers"; const id = new URLSearchParams(location.search).get("id");
  if (id) return customerDetail(m, id);
  m.innerHTML = '<div class="bar-row"><h1>Customers</h1></div><div id="list">Loading…</div>';
  try {
    const [cs, apps] = await Promise.all([list("customers", orderBy("createdAt", "desc"), limit(500)), list("applications", orderBy("createdAt", "desc"), limit(1000))]);
    const rows = cs.map(c => { const mine = apps.filter(a => a.uid === c.uid); return { ...c, id: c.uid, appCount: mine.length, status: mine[0]?.status || "No application" }; });
    table($("#list"), { rows, statuses: [...Object.keys(STAT_FLOW), "No application"], open: r => location.href = "admin-customers.html?id=" + r.uid, cols: [["Customer ID", r => r.customerId], ["Name", r => r.fullName], ["Mobile", r => r.mobile], ["Email", r => r.email], ["Registered", r => dt(r.createdAt)], ["Applications", r => r.appCount], ["Status", r => r.status], ["Docs", r => r.docsStatus], ["Updated", r => dt(r.updatedAt)]] });
  } catch (e) { console.error(e); $("#list").innerHTML = `<div class="notice err">Could not load customers (${esc(e.code || e.message)}).</div>`; }
}
async function customerDetail(m, uid) {
  m.innerHTML = "Loading…";
  const cs = await getDoc(doc(db, "customers", uid)); if (!cs.exists()) { m.innerHTML = '<div class="notice err">Customer not found.</div>'; return; }
  const c = cs.data(), reload = () => customerDetail(m, uid);
  const [apps, tds, agr, rt, cmp, gst, noc, aud] = await Promise.all([byUid("applications", uid), byUid("tdsRecords", uid), byUid("agreements", uid), byUid("rtgsRecords", uid), byUid("complianceReviews", uid), byUid("gstRecords", uid), byUid("nocRecords", uid), byUid("auditLogs", uid)]);
  const comms = (await getDocs(collection(db, "customers", uid, "communications"))).docs.map(d => d.data()).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const sec = (t, body, open) => `<details class="card" style="margin-bottom:12px" ${open ? "open" : ""}><summary>${t}</summary><div style="padding:0 22px 18px">${body}</div></details>`;
  const lst = (rows, fn) => rows.length ? rows.map(fn).join("") : "<p>None.</p>";
  m.innerHTML = `<p><a href="admin-customers.html">← All customers</a></p><div class="bar-row"><h1>${esc(c.fullName)}</h1><span class="sp"></span><b>${esc(c.customerId)}</b></div>
  <div class="btns" style="margin:0 0 18px"><button class="btn btn-primary btn-sm" id="cpdf">Download PDF summary</button></div>
  ${sec("Personal information", kv([["Name", esc(c.fullName)], ["Date of birth", esc(c.dob)], ["Gender", esc(c.gender)], ["PAN (masked)", maskPan(c.pan)], ["Aadhaar", c.aadhaarLast4 ? "XXXX XXXX " + esc(c.aadhaarLast4) : "Not provided"], ["Identity verification", chip(c.identityStatus)], ["Address verification", chip(c.addressStatus)], ["Documents", chip(c.docsStatus)]]) + `<div class="row2"><div class="field"><label for="vi">Identity status</label><select id="vi">${["Pending verification", "Verified", "Rejected"].map(s => `<option ${s === c.identityStatus ? "selected" : ""}>${s}</option>`).join("")}</select></div><div class="field"><label for="va">Address status</label><select id="va">${["Pending verification", "Verified", "Rejected"].map(s => `<option ${s === c.addressStatus ? "selected" : ""}>${s}</option>`).join("")}</select></div><div class="field"><label for="vd">Documents status</label><select id="vd">${["Pending", "Received", "Verified", "Rejected"].map(s => `<option ${s === c.docsStatus ? "selected" : ""}>${s}</option>`).join("")}</select></div></div><p class="hint">Set to Verified only after you have actually verified through an authorised process.</p><button class="btn btn-ghost btn-sm" id="sv">Save verification status</button>`, 1)}
  ${sec("Contact information", kv([["Mobile", esc(c.mobile)], ["Email", esc(c.email)], ["Current address", esc(c.addressCurrent)], ["Permanent address", esc(c.addressPermanent)], ["Bank (customer provided)", `${esc(c.bankName)} · ${esc(c.accountHolder)} · A/c ****${esc(c.accountLast4)} · ${esc(c.ifsc)}`]]))}
  ${sec("Employment and income", kv([["Type", esc(c.employmentType)], ["Employer", esc(c.employerName)], ["Months", esc(c.employmentMonths)], ["Monthly income", inr(c.monthlyIncome)], ["Income source", esc(c.incomeSource)], ["Existing obligations", inr(c.otherObligations)]]))}
  ${sec(`Loan applications (${apps.length}) & approval history`, lst(apps, a => `<p><b>${esc(a.applicationId)}</b> ${chip(a.status)} ${inr(a.loanAmount)} · ${a.tenureMonths}m<br><small>${(a.statusHistory || []).map(h => esc(h.status) + " " + dt(h.at)).join(" → ")}</small></p>`), 1)}
  ${sec(`Agreements (${agr.length})`, lst(agr, a => `<p>${esc(a.ref)} ${chip(a.status)} ${inr(a.loanAmount)}</p>`))}
  ${sec(`Transactions: TDS (${tds.length}) · RTGS/NEFT (${rt.length})`, lst(tds, a => `<p>${esc(a.ref)} ${chip(a.status)} ${inr(a.amount)}</p>`) + lst(rt, a => `<p>${esc(a.ref)} ${esc(a.transferType)} ${chip(a.status)} ${inr(a.amount)}</p>`))}
  ${sec(`Compliance reviews (${cmp.length})`, lst(cmp, a => `<p>${esc(a.ref)} ${chip(a.status)} ${esc(a.category)}</p>`))}
  ${sec(`GST records (${gst.length})`, lst(gst, a => `<p>${esc(a.invoiceNo)} ${chip(a.status)} ${inr(a.totalAmount)}</p>`))}
  ${sec(`NOC records (${noc.length})`, lst(noc, a => `<p>${esc(a.ref)} ${chip(a.status)}</p>`))}
  ${sec("Communication", `<div class="btns" style="margin:0 0 14px"><button class="btn btn-ghost btn-sm" data-c="email|verification">Send verification email</button><button class="btn btn-ghost btn-sm" data-c="email|update">Send application update</button><button class="btn btn-ghost btn-sm" data-c="email|missing_docs">Request missing documents</button><button class="btn btn-ghost btn-sm" data-c="email|reminder">Send reminder</button><button class="btn btn-ghost btn-sm" data-c="sms|update">Send SMS</button><a class="btn btn-primary btn-sm" href="tel:+91${esc(c.mobile)}">Call ${esc(c.mobile)}</a><button class="btn btn-ghost btn-sm" id="co">Record call outcome</button></div><p class="hint">Status shown is what the email service actually reported. SMS needs a provider (see README).</p><h4>History</h4>${lst(comms, x => `<p><small>${dt(x.createdAt)}</small> ${esc(x.channel)}/${esc(x.kind)} ${chip(x.status)} ${esc(x.outcome || "")} ${esc(x.error || "")}<br>${esc(x.message || "")}</p>`)}`, 1)}
  ${sec("Administrative remarks", lst(c.remarks || [], x => `<p><small>${dt(x.at)} · ${esc(x.by)}</small><br>${esc(x.text)}</p>`) + `<div class="field"><textarea id="rk" placeholder="Add a remark"></textarea></div><button class="btn btn-ghost btn-sm" id="ark">Add remark</button>`)}
  ${sec(`Audit history (${aud.length})`, lst(aud, l => `<p><small>${dt(l.createdAt)}</small> ${esc(l.action)} · ${esc(l.module)} · ${esc(l.actorEmail)}</p>`))}`;
  $("#cpdf").onclick = () => pdf("Customer application summary", [["Customer ID", c.customerId], ["Name", c.fullName], ["Date of birth", c.dob], ["Mobile", c.mobile], ["Email", c.email], ["PAN (masked)", maskPan(c.pan)], ["Address", c.addressCurrent], ["Employment", `${c.employmentType}, ${c.employerName}`], ["Monthly income", rs(c.monthlyIncome)], ["Identity / Address / Docs", `${c.identityStatus} / ${c.addressStatus} / ${c.docsStatus}`], ...apps.map(a => ["Application " + a.applicationId, `${rs(a.loanAmount)}, ${a.tenureMonths} months, ${a.status}`])], { file: c.customerId + ".pdf" });
  $("#sv").onclick = async () => { await updateDoc(doc(db, "customers", uid), { identityStatus: $("#vi").value, addressStatus: $("#va").value, docsStatus: $("#vd").value, updatedAt: serverTimestamp() }); await audit("verification status", "customers", uid, uid, `${$("#vi").value}/${$("#va").value}/${$("#vd").value}`); toast("Saved.", "ok"); reload(); };
  $("#ark").onclick = async () => { const t = $("#rk").value.trim(); if (!t) return; await updateDoc(doc(db, "customers", uid), { remarks: arrayUnion({ text: t, by: me(), at: Date.now() }) }); await audit("remark", "customers", uid, uid, t); reload(); };
  $("#co").onclick = () => { show(`<h2>Record call outcome</h2><div class="field"><label for="oc">Outcome</label><select id="oc">${["Connected", "No answer", "Busy", "Wrong number", "Call back requested"].map(s => `<option>${s}</option>`).join("")}</select></div><div class="field"><label for="on">Note</label><textarea id="on"></textarea></div><button class="btn btn-primary" id="os">Save</button> <button class="btn btn-ghost" data-close>Cancel</button>`);
    $("#os").onclick = async () => { await addDoc(collection(db, "customers", uid, "communications"), { channel: "call", kind: "outcome", outcome: $("#oc").value, message: $("#on").value.trim(), status: "recorded", by: me(), createdAt: serverTimestamp() }); await audit("call outcome", "customers", uid, uid, $("#oc").value); dlg.close(); reload(); }; };
  m.querySelectorAll("[data-c]").forEach(b => b.onclick = () => {
    const [ch, kind] = b.dataset.c.split("|"), send = async msg => { b.disabled = true; try { const r = (await httpsCallable(fns, "sendCommunication")({ uid, channel: ch, kind, message: msg })).data; toast(r.status === "sent" ? "Email sent." : `Not sent (${r.status}): ${r.error}`, r.status === "sent" ? "ok" : "error"); await audit("communication " + ch + "/" + kind, "customers", uid, uid, r.status); } catch (x) { toast(x.message, "error"); } reload(); };
    if (kind === "verification") return send("");
    show(`<h2>Message to customer</h2><div class="field"><textarea id="cm" placeholder="Type the message"></textarea></div><button class="btn btn-primary" id="cs">Send</button> <button class="btn btn-ghost" data-close>Cancel</button>`); $("#cs").onclick = () => { const v = $("#cm").value.trim(); if (!v) return; dlg.close(); send(v); }; });
}

/* ---------- bootstrap ---------- */
const NAV = [["admin-dashboard.html", "Overview", "overview"], ["admin-customers.html", "Customers", "customers"], ["admin-approvals.html", "Approval", "approvals"], ["admin-tds.html", "TDS & Transactions", "tds"], ["admin-agreements.html", "Agreements", "agreements"], ["admin-rtgs.html", "RTGS / NEFT", "rtgs"], ["admin-rbi.html", "RBI Hold & Compliance", "rbi"], ["admin-gst.html", "GST", "gst"], ["admin-noc.html", "NOC", "noc"]];
if (page === "login") {
  const f = $("#adminLogin"), err = m => $("#aerr").textContent = m;
  if (new URLSearchParams(location.search).get("denied")) err("This account is not authorised for admin access.");
  if (!configured) err("Firebase is not configured yet.");
  f.addEventListener("submit", async e => { e.preventDefault(); err(""); if (!configured) return; const b = f.querySelector("button"); b.disabled = true;
    try { const u = (await signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value)).user; const isAd = (await getDoc(doc(db, "admins", u.uid))).exists();
      if (!isAd) { await signOut(auth); err("This account is not authorised for admin access."); b.disabled = false; return; } location.href = "admin-dashboard.html"; }
    catch (x) { err("Incorrect email or password."); b.disabled = false; } });
} else if (!configured) { A.innerHTML = '<div class="notice err" style="margin:40px">Firebase is not configured. Fill firebase-config.js.</div>'; }
else onAuthStateChanged(auth, async u => {
  if (!u) return location.replace("admin-login.html");
  if (!(await getDoc(doc(db, "admins", u.uid))).exists()) { await signOut(auth); return location.replace("admin-login.html?denied=1"); }
  A.innerHTML = `<div class="adm"><aside class="side" id="side"><a class="brand" href="admin-dashboard.html"><span>${esc((window.SITE || {}).name || "[Company Name]")}</span></a><small style="padding:0 14px;color:var(--muted)">Admin panel</small><nav class="sidenav">${NAV.map(n => `<a href="${n[0]}" ${n[2] === page ? 'aria-current="page"' : ""}>${n[1]}</a>`).join("")}</nav></aside>
  <div class="adm-main"><header class="top"><button class="burger" id="sb" aria-label="Menu"><span></span></button><strong id="ptitle"></strong><span class="sp"></span><small class="hide-sm">${esc(u.email)}</small><button class="btn btn-ghost btn-sm" id="out">Logout</button></header><main id="main" class="adm-body"></main></div></div>`;
  $("#sb").onclick = () => $("#side").classList.toggle("open"); $("#out").onclick = () => signOut(auth).then(() => location.href = "admin-login.html");
  const m = $("#main"); page === "overview" ? overview(m) : page === "customers" ? customersPage(m) : modulePage(m, page);
});
