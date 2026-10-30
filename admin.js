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
    <div class="btns" style="margin-top:6px"><button class="btn btn-primary" type="submit">${isNew ? "Create record" : "Save changes"}</button>${!isNew && M.pdf ? '<button cla
