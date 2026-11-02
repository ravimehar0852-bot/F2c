/* Admin panel: auth guard + Overview + Customers + 7 modules. Access is enforced by the admins/<uid> document AND firestore.rules. */
import { auth, db, fns, configured } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, query, where, orderBy, limit, serverTimestamp, getCountFromServer, arrayUnion, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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
const ascii = s => String(s ?? "").replace(/\u20B9/g, "Rs.").replace(/[\u2013\u2014]/g, "-").replace(/\u2192/g, "->").replace(/[^\x00-\x7F]/g, "?");
function buildPdf(title, rows, mark) {
  const d = new window.jspdf.jsPDF(); d.setFontSize(16); d.text(ascii(title), 14, 18);
  if (mark) { d.setTextColor(190, 0, 0); d.setFontSize(11); d.text(ascii(mark), 14, 26); d.setTextColor(0); }
  d.setFontSize(10); let y = 36;
  rows.forEach(([k, v]) => { const l = d.splitTextToSize(ascii(v === "" ? k : `${k}: ${v ?? "-"}`), 180); if (y + l.length * 5 > 280) { d.addPage(); y = 20; } d.text(l, 14, y); y += l.length * 5 + 2; });
  d.setFontSize(8); d.text(ascii(`Generated ${new Date().toLocaleString("en-IN")} | ${(window.SITE || {}).name || "[Company Name]"}`), 14, 290);
  return d;
}
function pdf(title, rows, { mark, file } = {}) {
  if (!window.jspdf) return toast("PDF library not loaded. Check internet connection.", "error");
  buildPdf(title, rows, mark).save(file || "document.pdf");
}

/* ---------- generic table: search, status/date filters, pagination, CSV ---------- */
function table(host, { rows, cols, statuses, open, size = 10 }) {
  let q = "", st = "", from = "", to = "", arch = false, pg = 0, view = rows;
  host.innerHTML = `<div class="toolbar"><input type="search" placeholder="Search…" aria-label="Search" id="q">${statuses ? `<select id="st" aria-label="Status"><option value="">All statuses</option>${statuses.map(s => `<option>${esc(s)}</option>`).join("")}</select>` : ""}<input type="date" id="df" aria-label="From date"><input type="date" id="dt" aria-label="To date"><label class="hint" style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="arch"> Show archived</label><button class="btn btn-ghost btn-sm" id="csv">Export CSV</button></div>
  <div class="tbl-wrap"><table><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join("")}</tr></thead><tbody></tbody></table></div><div class="pager"></div>`;
  const body = host.querySelector("tbody"), pager = host.querySelector(".pager");
  const draw = () => {
    view = rows.filter(r => (arch || !r.archived) && (!q || Object.values(r).map(v => typeof v === "object" ? "" : v).join(" ").toLowerCase().includes(q)) && (!st || r.status === st) && (!from || ms(r.createdAt) >= new Date(from)) && (!to || ms(r.createdAt) <= new Date(to + "T23:59:59")));
    const pages = Math.max(1, Math.ceil(view.length / size)); pg = Math.min(pg, pages - 1);
    body.innerHTML = view.slice(pg * size, pg * size + size).map(r => `<tr data-id="${esc(r.id)}" tabindex="0">${cols.map(c => `<td>${c[0] === "Status" ? chip(c[1](r)) : esc(c[1](r))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length}" class="empty">No records found.</td></tr>`;
    pager.innerHTML = `<span>${view.length} record(s)</span><span class="sp"></span><button class="btn btn-ghost btn-sm" data-p="-1" ${pg ? "" : "disabled"}>Prev</button> Page ${pg + 1}/${pages} <button class="btn btn-ghost btn-sm" data-p="1" ${pg < pages - 1 ? "" : "disabled"}>Next</button>`;
  };
  host.querySelector(".toolbar").addEventListener("input", e => { q = $("#q", host).value.trim().toLowerCase(); st = $("#st", host)?.value || ""; from = $("#df", host).value; to = $("#dt", host).value; arch = $("#arch", host).checked; pg = 0; draw(); });
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

/* ================== PIPELINE ==================
   Every application sits in ONE section (field "stage") until the admin presses Next.
   Applications without a "stage" (older ones) are treated as being in "customers". */
const STAGES = ["customers", "approvals", "tds", "agreements", "rtgs", "rbi", "gst", "noc"];
const STAGE_LABEL = { customers: "Application received", approvals: "Approval", tds: "TDS & Transactions", agreements: "Agreement", rtgs: "RTGS / NEFT", rbi: "RBI & Compliance", gst: "GST", noc: "NOC", completed: "Completed" };
const stageOf = a => a.stage || "customers";
const nextOf = s => STAGES[STAGES.indexOf(s) + 1] || "completed";
const ENDED = ["Rejected", "Cancelled", "Closed"];
const g = (o, ...ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== "") return o[k]; return ""; };
const mask = (v, n = 4) => { v = String(v ?? ""); return v ? "X".repeat(Math.max(0, v.length - n)) + v.slice(-n) : ""; };
const maskAadhaar = c => c.aadhaar ? "XXXX XXXX " + String(c.aadhaar).slice(-4) : (c.aadhaarLast4 ? "XXXX XXXX " + c.aadhaarLast4 : "");
const secure = (full, masked) => full ? `<span data-sec="${esc(full)}" data-m="${esc(masked)}">${esc(masked)}</span>` : "—";
const getApp = async id => { const s = await getDoc(doc(db, "applications", id)); return s.exists() ? { id: s.id, ...s.data() } : null; };
const getCust = async uid => { if (!uid) return null; const s = await getDoc(doc(db, "customers", uid)); return s.exists() ? { id: s.id, ...s.data() } : null; };
const getRec = async (M, appId) => (await list(M.col, where("applicationId", "==", appId), limit(1)))[0] || null;
const TF = [F("interestRatePct", "Interest rate (% per year)", "number"), F("tenureMonths", "Approved tenure (months)", "number"), F("processingFeePct", "Processing fee (%)", "number"), F("otherCharges", "Other charges", "text")];
const recFields = M => [...M.fields, F("status", "Status", "select", { req: 1, o: M.statuses }), F("remarks", "Admin remarks", "textarea"), ...(M.vis ? [F("visibleToCustomer", "Visible to customer in their portal", "checkbox")] : [])];

/* status the customer sees after the admin presses Next */
function statusAfterNext(from, to, a, rec) {
  if (to === "approvals") return "Under Review";
  if (to === "tds") return "Approved";
  if (to === "agreements") return "Agreement Pending";
  if (to === "rtgs") return "Disbursement Pending";
  if (from === "rtgs" && rec && rec.status === "Verified") return "Disbursed";
  if (to === "completed") return "Closed";
  return a.status;
}

/* ---------- email (Vercel function /api/admin-notify; recipient is looked up on the server, never taken from this page) ---------- */
async function sendMail(payload) {
  try {
    const token = await auth.currentUser.getIdToken();
    const r = await fetch("/api/admin-notify", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ ...payload, company: (window.SITE || {}).name || "" }) });
    const j = await r.json().catch(() => ({}));
    return j.ok ? { ok: true } : { ok: false, error: j.error || "Email could not be sent (" + r.status + ")." };
  } catch (e) { return { ok: false, error: "Network error while sending email." }; }
}

/* ---------- PDF for the customer (Aadhaar / PAN / account number are masked) ---------- */
function stagePdf(a, c, fromKey, toKey, rec, M, remarks) {
  if (!window.jspdf) return "";
  const name = (window.SITE || {}).name || "[Company Name]", cc = c || {};
  const rows = [["APPLICATION UPDATE", ""], ["Application ID", a.applicationId], ["Customer ID", a.customerId], ["Moved from", STAGE_LABEL[fromKey]], ["Now at", STAGE_LABEL[toKey]], ["Status", a.status], ["Date", new Date().toLocaleString("en-IN")], ["Message from our team", remarks || "-"],
    ["LOAN DETAILS", ""], ["Loan type", g(a, "loanType", "purpose") || "-"], ["Loan amount", rs(a.loanAmount)], ["Tenure requested", a.tenureMonths + " months"], ["Estimated EMI", a.estimatedEmi ? rs(a.estimatedEmi) + " / month (" + a.emiRate + "% p.a., indicative)" : "-"]];
  if (a.terms) rows.push(["APPROVED TERMS", ""], ["Interest rate", a.terms.interestRatePct + "% per year"], ["Approved tenure", a.terms.tenureMonths + " months"], ["Processing fee", a.terms.processingFeePct + "%"], ["Other charges", a.terms.otherCharges || "None"], ["Estimated EMI", a.terms.estimatedEmi ? rs(a.terms.estimatedEmi) + " / month" : "-"]);
  if (rec && M && M.fields) {
    rows.push([(M.title || "").toUpperCase(), ""]);
    M.fields.forEach(f => { if (f.k === "customerId" || f.k === "applicationId") return; const v = rec[f.k]; if (v !== "" && v != null) rows.push([f.l.replace(/\s*\(.\)/, ""), f.t === "checkbox" ? (v ? "Yes" : "No") : v]); });
    rows.push(["Section status", rec.status], ["Reference", rec.ref || "-"]);
  }
  rows.push(["CUSTOMER DETAILS", ""], ["Name", g(cc, "name", "fullName") || a.customerName], ["Mobile", g(cc, "phone", "mobile") || "-"], ["Email", cc.email || "-"], ["Date of birth", cc.dob || "-"], ["Aadhaar", maskAadhaar(cc) || "-"], ["PAN", cc.pan ? maskPan(cc.pan) : "-"],
    ["City / State / PIN", [cc.city, cc.state, cc.pincode].filter(Boolean).join(", ") || "-"], ["Occupation", g(cc, "empType", "employmentType") || "-"], ["Employer / business", g(cc, "employer", "employerName") || "-"], ["Monthly income", cc.monthlyIncome != null && cc.monthlyIncome !== "" ? rs(cc.monthlyIncome) : "-"],
    ["Bank", cc.bankName || "-"], ["Account number", cc.accountNumber ? mask(cc.accountNumber) : (cc.accountLast4 ? "XXXX" + cc.accountLast4 : "-")], ["IFSC", cc.ifsc || "-"]);
  try { return buildPdf(name + " - Application update", rows, "").output("datauristring").split("base64,").pop() || ""; } catch (e) { console.error(e); return ""; }
}

/* ---------- save the section record (TDS / Agreement / RTGS / RBI / GST / NOC) ---------- */
async function saveRecord(M, a, root, rec) {
  const fields = recFields(M), p = readForm(root, fields);
  const miss = fields.find(f => f.req && (p[f.k] === "" || p[f.k] == null));
  if (miss) throw new Error(miss.l + " is required.");
  let uid = a && a.uid, app = a;
  if (!a) {
    const cust = await findCustomer(p.customerId);
    if (!cust) throw new Error("No customer found with this Customer ID.");
    uid = cust.uid || cust.id;
    app = p.applicationId ? (await list("applications", where("applicationId", "==", p.applicationId), limit(1)))[0] || null : null;
  }
  if (M.prep) await M.prep(p, app);
  const msg = M.check ? M.check(p) : ""; if (msg) throw new Error(msg);
  if (a) { p.customerId = a.customerId; p.applicationId = a.applicationId; }
  const calc = M.calc ? M.calc(p) : {}, data = { ...p, ...calc, uid, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid };
  let id = rec && rec.id, ref = rec && rec.ref;
  if (!rec) {
    ref = `${M.prefix}-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    Object.assign(data, { ref, createdAt: serverTimestamp(), createdBy: auth.currentUser.uid });
    if (M.col === "agreements") data.versions = [{ at: Date.now(), by: me(), status: p.status }];
    id = (await addDoc(collection(db, M.col), data)).id;
  } else {
    if (M.col === "agreements") data.versions = arrayUnion({ at: Date.now(), by: me(), status: p.status, loanAmount: p.loanAmount, interestRatePct: p.interestRatePct, tenureMonths: p.tenureMonths });
    await updateDoc(doc(db, M.col, id), data);
  }
  await audit(rec ? "update" : "create", M.col, id, uid, p.status);
  return { ...(rec || {}), ...p, ...calc, id, ref };
}

/* ---------- delete helpers ---------- */
async function deleteApplication(a) {
  for (const k of Object.keys(MODS)) { const M = MODS[k]; if (k === "approvals") continue; for (const r of await list(M.col, where("applicationId", "==", a.applicationId))) await deleteDoc(doc(db, M.col, r.id)); }
  await deleteDoc(doc(db, "applications", a.id));
  await audit("delete", "applications", a.applicationId, a.uid, "deleted forever");
}

/* ---------- customer details block (full details are visible to admins only; sensitive numbers are masked until "Show") ---------- */
function custBlock(c) {
  if (!c) return `<p class="hint">Customer profile was not found.</p>`;
  const aad = c.aadhaar ? secure(c.aadhaar, maskAadhaar(c)) : (c.aadhaarLast4 ? esc(maskAadhaar(c)) : "—");
  const acc = c.accountNumber ? secure(c.accountNumber, mask(c.accountNumber)) : (c.accountLast4 ? "XXXX" + esc(c.accountLast4) : "—");
  return `<details open class="card" style="margin:12px 0"><summary><b>Customer details</b></summary>
    ${kv([["Customer ID", esc(c.customerId)], ["Name", esc(g(c, "name", "fullName"))], ["Email", esc(c.email)], ["Mobile", esc(g(c, "phone", "mobile"))], ["Date of birth", esc(c.dob)], ["Aadhaar", aad], ["PAN", c.pan ? secure(c.pan, maskPan(c.pan)) : "—"], ["City", esc(c.city)], ["State", esc(c.state)], ["PIN code", esc(c.pincode)],
      ["Occupation", esc(g(c, "empType", "employmentType"))], ["Employer / business", esc(g(c, "employer", "employerName"))], ["Monthly income", c.monthlyIncome != null && c.monthlyIncome !== "" ? rs(c.monthlyIncome) : "—"], ["Years in current work", esc(g(c, "workYears", "employmentMonths"))], ["Other running loans", esc(c.hasOtherLoans)], ["Other obligations", esc(c.otherObligations)],
      ["Bank name", esc(c.bankName)], ["Account holder", esc(c.accountHolder)], ["Account number", acc], ["IFSC", esc(c.ifsc)], ["Reference name", esc(c.refName)], ["Reference mobile", esc(c.refPhone)], ["Reference relation", esc(c.refRelation)], ["Registered", esc(dt(c.createdAt))]])}
    <p><button type="button" class="btn btn-ghost btn-sm" data-a="reveal">Show full Aadhaar / PAN / account number</button></p>
    <h4 style="margin:14px 0 8px">Verification and location (admin can change)</h4>
    <div class="row2">${[F("identityStatus", "Identity verification", "select", { o: ["Pending verification", "Verified", "Rejected"] }), F("addressStatus", "Address verification", "select", { o: ["Pending verification", "Verified", "Rejected"] }), F("docsStatus", "Documents", "select", { o: ["Pending", "Received", "Verified", "Rejected"] }), F("city", "City"), F("state", "State"), F("pincode", "PIN code")].map(f => fieldHtml(f, c[f.k])).join("")}</div>
    <p><button type="button" class="btn btn-ghost btn-sm" data-a="savecust">Save customer changes</button></p></details>`;
}

/* ---------- ONE dialog for every section: shows the application, lets the admin edit this section's details, and press Next / Under review / Reject / Cancel ---------- */
async function stageDialog(row, reload) {
  const noApp = !!row._noApp;
  const [a, c] = await Promise.all([noApp ? null : getApp(row.id), getCust(row.uid || (noApp ? row.id : ""))]);
  if (!noApp && !a) { toast("This application no longer exists.", "error"); return reload && reload(); }
  const key = a ? stageOf(a) : "customers", M = MODS[key] || null, rec = a && M && M.fields ? await getRec(M, a.applicationId) : null;
  const hasForm = !!a && (key === "approvals" || !!(M && M.fields)), ended = !!a && ENDED.includes(a.status), done = key === "completed", nx = nextOf(key);
  const mfields = M && M.fields ? recFields(M).filter(f => f.k !== "remarks") : [];
  const val = f => rec && rec[f.k] != null ? rec[f.k] : f.k === "customerId" ? a.customerId : f.k === "applicationId" ? a.applicationId : f.k === "status" ? M.statuses[0] : "";
  const t = (a && a.terms) || {};
  let formHtml = "";
  if (hasForm && !done && key === "approvals") formHtml = `<h4 style="margin:14px 0 8px">Approval terms and charges</h4><form id="sf" novalidate><div class="row2">${TF.map(f => fieldHtml(f, t[f.k] ?? (f.k === "interestRatePct" ? a.emiRate : f.k === "tenureMonths" ? a.tenureMonths : ""))).join("")}</div><div class="field"><div class="consent"><input type="checkbox" id="tv" ${a.termsVisible === false ? "" : "checked"}><label for="tv">Show these terms to the customer in their dashboard</label></div></div></form>`;
  else if (hasForm && !done) formHtml = `<h4 style="margin:14px 0 8px">${esc(M.title)}</h4><form id="sf" novalidate><div class="row2">${mfields.map(f => fieldHtml(f, val(f), f.k === "customerId" || f.k === "applicationId")).join("")}</div></form>${rec ? `<div class="btns" style="margin:10px 0">${M.extra ? M.extra(rec) : ""}${M.pdf ? `<button type="button" class="btn btn-ghost btn-sm" data-x="pdf">Download PDF</button>` : ""}</div>` : ""}`;
  const hist = a ? (a.statusHistory || []) : [];
  const msgBox = `<div class="field" style="margin-top:14px"><label for="rmk">Remarks / message for the customer (included in the email)</label><textarea id="rmk" data-k="remarks">${esc(rec && rec.remarks || "")}</textarea></div>`;
  const B = (k, cls, txt) => `<button type="button" class="btn ${cls}" data-a="${k}">${txt}</button>`;
  const actions = a ? [
    hasForm && !done && !ended ? B("save", "btn-ghost", "Save details") : "",
    !done && !ended ? B("next", "btn-primary", key === "noc" ? "Complete &amp; close" : "Next → " + esc(STAGE_LABEL[nx])) : "",
    !done ? B("review", "btn-ghost", ended ? "Re-open (Under review)" : "Under review") : "",
    !done && !ended ? B("reject", "btn-ghost", "Reject") + B("cancel", "btn-ghost", "Cancel application") : "",
    B("archive", "btn-ghost", a.archived ? "Restore" : "Archive"), B("delete", "btn-ghost", "Delete forever")].join("")
    : B("archcust", "btn-ghost", c && c.archived ? "Restore customer" : "Archive customer");
  show(`<h2>${a ? esc(a.applicationId) : esc((c && c.customerId) || "Customer")}</h2>
    ${a ? `<p>${chip(STAGE_LABEL[key])} ${chip(a.status)}${a.archived ? " " + chip("Archived") : ""}</p>${kv([["Customer ID", esc(a.customerId)], ["Name", esc(a.customerName || g(c || {}, "name", "fullName"))], ["Loan type", esc(g(a, "loanType", "purpose"))], ["Loan amount", rs(a.loanAmount)], ["Tenure requested", esc(a.tenureMonths) + " months"], ["Estimated EMI", a.estimatedEmi ? rs(a.estimatedEmi) + " / month (" + esc(a.emiRate) + "% p.a.)" : "—"], ["Current step", esc(STAGE_LABEL[key])], ["Submitted", esc(dt(a.createdAt))]])}` : `<p class="hint">This customer has no application yet.</p>`}
    ${ended ? `<div class="notice" style="margin:10px 0">This application is ${esc(a.status)}. Use "Re-open" to continue it.</div>` : ""}
    ${hist.length ? `<details class="card" style="margin:10px 0"><summary>Status history (${hist.length})</summary><div style="padding:6px 0">${hist.slice().reverse().map(h => `<p>${chip(h.status)} ${h.stage ? esc(STAGE_LABEL[h.stage] || h.stage) : ""} <small>${esc(dt(h.at))}</small>${h.remarks ? " · " + esc(h.remarks) : ""}</p>`).join("")}</div></details>` : ""}
    ${custBlock(c)}${formHtml}${a ? msgBox : `<div class="field" style="margin-top:14px"><label for="rmk">Send a message to this customer (dashboard)</label><textarea id="rmk" data-k="remarks"></textarea></div>${B("msg", "btn-ghost", "Send message")}`}
    <p class="err" id="serr" role="alert"></p>
    <div class="btns" style="margin-top:14px;flex-wrap:wrap">${actions}${a ? B("msg", "btn-ghost", "Send message only") : ""}<button type="button" class="btn btn-ghost" data-close>Close</button></div>
    ${a && !done && !ended ? `<p class="hint" style="margin-top:10px">Next, Under review, Reject and Cancel send an email to the customer. Next also attaches a PDF with the details.</p>` : ""}`);
  const root = dlg.querySelector(".dlg"), err = $("#serr", root), setBusy = b => root.querySelectorAll("[data-a]").forEach(x => x.disabled = b);
  const rmk = () => $("#rmk", root).value.trim();

  const run = async kind => {
    err.textContent = "";
    const remarks = rmk();
    if ((kind === "reject" || kind === "cancel") && !remarks) { err.textContent = "Write the reason in Remarks first. It is sent to the customer."; return; }
    if (kind === "reject" && !confirm("Reject this application and email the customer?")) return;
    if (kind === "cancel" && !confirm("Cancel this application and email the customer?")) return;
    if (kind === "next" && !confirm(key === "noc" ? "Complete this application? The customer gets the final email with a PDF." : `Move this application to "${STAGE_LABEL[nx]}"? The customer gets an email with a PDF.`)) return;
    setBusy(true);
    try {
      let newRec = rec, terms = null;
      if ((kind === "save" || kind === "next") && hasForm && key !== "approvals") newRec = await saveRecord(M, a, root, rec);
      if ((kind === "save" || kind === "next") && key === "approvals") {
        terms = readForm($("#sf", root), TF);
        if (kind === "next" && (terms.interestRatePct === "" || terms.tenureMonths === "" || terms.processingFeePct === "")) throw new Error("Interest rate, approved tenure and processing fee are required before Next.");
        if (terms.interestRatePct !== "" && (terms.interestRatePct < 0 || terms.interestRatePct > 100)) throw new Error("Interest rate must be between 0 and 100.");
        if (terms.tenureMonths !== "" && (!Number.isInteger(terms.tenureMonths) || terms.tenureMonths < 1 || terms.tenureMonths > 480)) throw new Error("Approved tenure must be a whole number of months (1 to 480).");
        if (terms.interestRatePct !== "" && terms.tenureMonths !== "") { const e = Math.round(emi(a.loanAmount, terms.interestRatePct, terms.tenureMonths)); if (isFinite(e)) terms.estimatedEmi = e; }
      }
      if (kind === "save") {
        const u = { updatedAt: serverTimestamp() }; if (terms) u.terms = terms;
        await updateDoc(doc(db, "applications", a.id), u);
        await audit("save", key, a.applicationId, a.uid, "details saved");
        dlg.close(); toast("Saved.", "ok"); return reload && reload();
      }
      const toKey = kind === "next" ? nx : key, upd = {};
      let status = a.status;
      if (kind === "next") { status = statusAfterNext(key, toKey, a, newRec); upd.stage = toKey; }
      if (kind === "review") status = "Under Review";
      if (kind === "reject") status = "Rejected";
      if (kind === "cancel") status = "Cancelled";
      upd.status = status; upd.adminRemarks = remarks;
      if (terms) { upd.terms = terms; if (kind === "next") upd.termsVisible = $("#tv", root).checked; }
      await updateDoc(doc(db, "applications", a.id), { ...upd, updatedAt: serverTimestamp(), statusHistory: arrayUnion({ status, stage: upd.stage || key, action: kind, at: Date.now(), by: me(), remarks }) });
      const merged = { ...a, ...upd };
      const event = kind === "next" && toKey === "completed" ? "final" : kind;
      const pdfBase64 = kind === "next" ? stagePdf(merged, c, key, toKey, newRec, M, remarks) : "";
      const note = { next: `Your application moved from "${STAGE_LABEL[key]}" to "${STAGE_LABEL[toKey]}".`, final: "All steps of your application are complete.", review: `Your application is under review at the "${STAGE_LABEL[key]}" step.`, reject: "Your application was rejected.", cancel: "Your application was cancelled." }[event];
      await notify(a.uid, `Application ${a.applicationId}: ${status}`, note + (remarks ? " " + remarks : "")).catch(() => {});
      const mail = await sendMail({ applicationId: a.applicationId, event, fromStage: STAGE_LABEL[key], toStage: STAGE_LABEL[toKey], status, remarks, pdfBase64 });
      await audit(kind, key, a.applicationId, a.uid, `${key} -> ${toKey}; status ${status}; email ${mail.ok ? "sent" : "FAILED: " + mail.error}`).catch(() => {});
      dlg.close();
      if (mail.ok) toast("Done. Email sent to the customer.", "ok"); else toast("Application updated, but the email was NOT sent: " + mail.error, "error");
      reload && reload();
    } catch (x) { err.textContent = x.message || "Could not complete this action."; setBusy(false); }
  };

  root.addEventListener("click", async e => {
    const xb = e.target.closest("[data-x]");
    if (xb && M && rec) { if (M.act) M.act(rec, xb.dataset.x); else if (xb.dataset.x === "pdf" && M.pdf) M.pdf(rec); return; }
    const b = e.target.closest("[data-a]"); if (!b) return;
    const k = b.dataset.a;
    if (["save", "next", "review", "reject", "cancel"].includes(k)) return run(k);
    err.textContent = "";
    try {
      if (k === "reveal") {
        const spans = root.querySelectorAll("[data-sec]"), open = b.dataset.open !== "1";
        spans.forEach(s => s.textContent = open ? s.dataset.sec : s.dataset.m);
        b.dataset.open = open ? "1" : ""; b.textContent = open ? "Hide full numbers" : "Show full Aadhaar / PAN / account number";
        if (open) audit("reveal", "customers", c && c.customerId, c && (c.uid || c.id), "viewed full details").catch(() => {});
      }
      if (k === "savecust") {
        const f = [F("identityStatus"), F("addressStatus"), F("docsStatus"), F("city"), F("state"), F("pincode")], p = readForm(root, f), u = {};
        f.forEach(x => { if (p[x.k]) u[x.k] = p[x.k]; });
        if (u.pincode && !/^\d{6}$/.test(u.pincode)) throw new Error("PIN code must be 6 digits.");
        const city = u.city || c.city, state = u.state || c.state, pin = u.pincode || c.pincode;
        if (u.city || u.state || u.pincode) { u.addressCurrent = u.addressPermanent = `${city}, ${state} - ${pin}`; }
        await updateDoc(doc(db, "customers", c.id), { ...u, updatedAt: serverTimestamp() });
        await audit("update", "customers", c.customerId, c.uid || c.id, "customer changes saved");
        toast("Customer updated.", "ok"); if (reload) reload();
      }
      if (k === "msg") {
        const m = rmk(); if (!m) throw new Error("Write a message first.");
        const uid = (a && a.uid) || (c && (c.uid || c.id)); if (!uid) throw new Error("Customer not found.");
        await notify(uid, "Message from our team", m); await audit("message", "customers", c && c.customerId, uid, m);
        $("#rmk", root).value = ""; toast("Message sent to the customer's dashboard.", "ok");
      }
      if (k === "archive") { await updateDoc(doc(db, "applications", a.id), { archived: !a.archived, updatedAt: serverTimestamp() }); await audit(a.archived ? "restore" : "archive", key, a.applicationId, a.uid, ""); dlg.close(); toast(a.archived ? "Restored." : "Archived. Tick 'Show archived' in the table to see it.", "ok"); reload && reload(); }
      if (k === "archcust") { await updateDoc(doc(db, "customers", c.id), { archived: !c.archived, updatedAt: serverTimestamp() }); await audit(c.archived ? "restore" : "archive", "customers", c.customerId, c.uid || c.id, ""); dlg.close(); toast(c.archived ? "Restored." : "Archived.", "ok"); reload && reload(); }
      if (k === "delete") {
        if ((prompt(`This permanently deletes ${a.applicationId} and its records in every section. It cannot be undone.\nType DELETE to confirm.`) || "").trim() !== "DELETE") return;
        setBusy(true); await deleteApplication(a); dlg.close(); toast("Deleted.", "ok"); reload && reload();
      }
    } catch (x) { err.textContent = x.message || "Something went wrong."; setBusy(false); }
  });
}

/* ---------- legacy record dialog: every record of a section (also records not linked to an application) ---------- */
async function recordDialog(M, r, reload) {
  const isNew = !r, rec = r || {}, fields = recFields(M);
  show(`<h2>${isNew ? "New record" : esc(rec.ref || rec.invoiceNo || "Record")}</h2><form id="rf" novalidate><div class="row2">${fields.map(f => fieldHtml(f, rec[f.k] ?? (f.k === "status" ? M.statuses[0] : ""), !isNew && f.k === "customerId")).join("")}</div><p class="err" id="rerr" role="alert"></p>
    <div class="btns" style="margin-top:14px;flex-wrap:wrap"><button class="btn btn-primary" type="submit" id="rsave">${isNew ? "Create record" : "Save changes"}</button>${!isNew && M.extra ? M.extra(rec) : ""}${!isNew && M.pdf ? `<button type="button" class="btn btn-ghost btn-sm" data-x="pdf">Download PDF</button>` : ""}${!isNew ? `<button type="button" class="btn btn-ghost" data-x="arch">${rec.archived ? "Restore" : "Archive"}</button><button type="button" class="btn btn-ghost" data-x="del">Delete forever</button>` : ""}<button type="button" class="btn btn-ghost" data-close>Cancel</button></div></form>`);
  const form = dlg.querySelector("#rf"), err = form.querySelector("#rerr");
  form.addEventListener("click", async e => {
    const b = e.target.closest("[data-x]"); if (!b) return; const k = b.dataset.x;
    try {
      if (k === "arch") { await updateDoc(doc(db, M.col, rec.id), { archived: !rec.archived, updatedAt: serverTimestamp() }); await audit(rec.archived ? "restore" : "archive", M.col, rec.id, rec.uid, ""); dlg.close(); toast("Done.", "ok"); return reload(); }
      if (k === "del") { if ((prompt("This permanently deletes the record. Type DELETE to confirm.") || "").trim() !== "DELETE") return; await deleteDoc(doc(db, M.col, rec.id)); await audit("delete", M.col, rec.id, rec.uid, "deleted forever"); dlg.close(); toast("Deleted.", "ok"); return reload(); }
      if (k === "pdf" && M.pdf) return M.pdf(rec);
      if (M.act) M.act(rec, k);
    } catch (x) { err.textContent = x.message || "Could not do this."; }
  });
  form.addEventListener("submit", async e => {
    e.preventDefault(); err.textContent = ""; const btn = form.querySelector("#rsave"); btn.disabled = true;
    try { await saveRecord(M, null, form, r); dlg.close(); toast("Saved.", "ok"); reload(); }
    catch (x) { err.textContent = x.message || "Could not save."; btn.disabled = false; }
  });
}

/* ---------- page shell ---------- */
const NAV = [["overview", "admin-dashboard.html", "Overview"], ["customers", "admin-customers.html", "Customers"], ["approvals", "admin-approvals.html", "Approvals"], ["tds", "admin-tds.html", "TDS"], ["agreements", "admin-agreements.html", "Agreements"], ["rtgs", "admin-rtgs.html", "RTGS / NEFT"], ["rbi", "admin-rbi.html", "RBI & Compliance"], ["gst", "admin-gst.html", "GST"], ["noc", "admin-noc.html", "NOC"]];
function shell(title, inner, actions = "") {
  A.innerHTML = `<div class="adm"><aside class="side" id="side"><div class="brand"><b>${esc((window.SITE || {}).name || "Admin")}</b></div><nav class="sidenav" aria-label="Admin">${NAV.map(n => `<a href="${n[1]}" ${n[0] === page ? 'aria-current="page"' : ""}>${n[2]}</a>`).join("")}</nav></aside>
  <div class="adm-main"><div class="top"><button class="burger" id="sb" aria-label="Menu"><span></span></button><b>${esc(title)}</b><span style="flex:1"></span><span class="hide-sm hint">${esc(me())}</span>${actions}<button class="btn btn-ghost btn-sm" id="so">Sign out</button></div><div class="adm-body"><h1>${esc(title)}</h1>${inner}</div></div></div>`;
  $("#sb").addEventListener("click", () => $("#side").classList.toggle("open"));
  $("#so").addEventListener("click", async () => { await signOut(auth); location.replace("admin-login.html"); });
}

async function overviewPage() {
  shell("Overview", `<div id="ov">Loading…</div>`);
  const cnt = async c => { try { return (await getCountFromServer(query(collection(db, c)))).data().count; } catch { return "—"; } };
  const [cu, ap, tds, agr, rt, cmp, gst, noc] = await Promise.all(["customers", "applications", "tdsRecords", "agreements", "rtgsRecords", "complianceReviews", "gstRecords", "nocRecords"].map(cnt));
  const apps = await list("applications", orderBy("createdAt", "desc"), limit(200));
  const by = {}, bs = {}; apps.forEach(a => { by[a.status || "—"] = (by[a.status || "—"] || 0) + 1; const s = stageOf(a); bs[s] = (bs[s] || 0) + 1; });
  const max = Math.max(1, ...Object.values(by), ...Object.values(bs));
  const stat = (l, v) => `<div class="card stat"><small>${l}</small><b>${v}</b></div>`;
  const bars = o => Object.entries(o).map(([k, v]) => `<div class="barrow"><span>${esc(STAGE_LABEL[k] || k)}</span><div><i style="width:${Math.round(v / max * 100)}%"></i><b>${v}</b></div></div>`).join("") || `<p class="hint">No applications yet.</p>`;
  $("#ov").innerHTML = `<div class="grid g4">${stat("Customers", cu)}${stat("Applications", ap)}${stat("TDS records", tds)}${stat("Agreements", agr)}${stat("RTGS / NEFT", rt)}${stat("Compliance reviews", cmp)}${stat("GST records", gst)}${stat("NOC records", noc)}</div>
    <div class="card" style="margin-top:20px"><h3>Applications by step</h3>${bars(bs)}</div>
    <div class="card" style="margin-top:20px"><h3>Applications by status</h3>${bars(by)}</div>`;
}

async function customersPage() {
  shell("Customers", `<p class="hint" style="margin-bottom:10px">New applications wait here. Open one and press <b>Next</b> to send it to Approvals.</p><div class="toolbar" style="margin-bottom:10px"><select id="cv" aria-label="View"><option value="wait">Waiting in this step</option><option value="all">All applications and customers</option></select></div><div id="tbl">Loading…</div>`);
  let apps = [], custs = [];
  const enrich = a => { const c = custs.find(x => (x.uid || x.id) === a.uid) || {}; return { ...a, email: c.email || "", phone: g(c, "phone", "mobile"), customerName: a.customerName || g(c, "name", "fullName") }; };
  const draw = () => {
    const all = $("#cv").value === "all";
    let rows = apps.filter(a => all || stageOf(a) === "customers").map(enrich);
    if (all) custs.filter(c => !apps.some(a => a.uid === (c.uid || c.id))).forEach(c => rows.push({ id: c.id, uid: c.uid || c.id, customerId: c.customerId, customerName: g(c, "name", "fullName"), email: c.email || "", phone: g(c, "phone", "mobile"), createdAt: c.createdAt, status: "No application", archived: c.archived, _noApp: true }));
    table($("#tbl"), { rows, statuses: [...Object.keys(STAT_FLOW), "No application"], open: r => stageDialog(r, load),
      cols: [["Customer ID", r => r.customerId], ["Name", r => r.customerName], ["Email", r => r.email], ["Phone", r => r.phone], ["Application", r => r.applicationId || "—"], ["Amount", r => r.loanAmount != null ? inr(r.loanAmount) : "—"], ["Step", r => r._noApp ? "—" : STAGE_LABEL[stageOf(r)]], ["Registered", r => dt(r.createdAt)], ["Status", r => r.status]] });
  };
  const load = async () => { [apps, custs] = await Promise.all([list("applications", orderBy("createdAt", "desc"), limit(500)), list("customers", orderBy("createdAt", "desc"), limit(500))]); draw(); };
  $("#cv").addEventListener("change", draw);
  await load();
}

async function modulePage(key) {
  const M = MODS[key], isAppr = key === "approvals";
  shell(M.title, `<p class="hint" style="margin-bottom:10px">${isAppr ? "Applications sent here from Customers." : `Applications sent here by Next from the previous step.`} Open one, update the details, then press <b>Next</b>.</p><div id="tbl">Loading…</div>${isAppr ? "" : `<h2 style="font-size:1.3rem;margin:32px 0 12px">All ${esc(M.title)} records</h2><div id="tbl2"></div>`}`, isAppr ? "" : `<button class="btn btn-primary btn-sm" id="newRec">New record</button>`);
  const load = async () => {
    const [apps, recs] = await Promise.all([list("applications", orderBy("createdAt", "desc"), limit(500)), isAppr ? [] : list(M.col, orderBy("createdAt", "desc"), limit(500))]);
    const by = {}; recs.forEach(r => { if (r.applicationId) by[r.applicationId] = r; });
    const rows = apps.filter(a => stageOf(a) === key).map(a => ({ ...a, recStatus: by[a.applicationId] ? by[a.applicationId].status : "Not started" }));
    table($("#tbl"), { rows, statuses: Object.keys(STAT_FLOW), open: r => stageDialog(r, load),
      cols: [["Application", r => r.applicationId], ["Customer ID", r => r.customerId], ["Name", r => r.customerName], ["Amount", r => inr(r.loanAmount)], ["Tenure", r => r.tenureMonths + " m"], ...(isAppr ? [] : [["Section record", r => r.recStatus]]), ["Submitted", r => dt(r.createdAt)], ["Status", r => r.status]] });
    if (!isAppr) table($("#tbl2"), { rows: recs, cols: M.cols, statuses: M.statuses, open: r => recordDialog(M, r, load) });
  };
  if (!isAppr) $("#newRec").addEventListener("click", () => recordDialog(M, null, load));
  await load();
}

/* ---------- auth ---------- */
const isAdmin = async u => { try { const s = await getDoc(doc(db, "admins", u.uid)); return s.exists() && s.data().active !== false; } catch { return false; } };
let busy = false;
function loginPage() {
  const f = document.getElementById("adminLogin"), err = document.getElementById("aerr"), btn = document.getElementById("adminLoginBtn");
  if (new URLSearchParams(location.search).get("denied")) err.textContent = "This account does not have admin access.";
  if (!configured || !auth) { err.textContent = "Firebase is not configured. Check js/firebase-config.js."; }
  f.addEventListener("submit", async e => {
    e.preventDefault(); err.textContent = "";
    const email = f.email.value.trim(), pw = f.password.value;
    if (!email || !pw) { err.textContent = "Enter your email and password."; return; }
    if (!configured || !auth) return;
    busy = true; btn.disabled = true; btn.textContent = "Logging in…";
    try {
      const cred = await signInWithEmailAndPassword(auth, email, pw);
      if (!(await isAdmin(cred.user))) { await signOut(auth); throw { code: "app/not-admin" }; }
      location.replace("admin-dashboard.html");
    } catch (x) {
      const m = { "auth/invalid-credential": "Wrong email or password.", "auth/wrong-password": "Wrong email or password.", "auth/user-not-found": "No account with this email.", "auth/invalid-email": "Enter a valid email.", "auth/too-many-requests": "Too many attempts. Try again later.", "auth/unauthorized-domain": "This website domain is not added in Firebase Authentication > Settings > Authorized domains.", "auth/operation-not-allowed": "Email/Password sign-in is not enabled in Firebase.", "auth/network-request-failed": "Network error. Check your internet.", "app/not-admin": "This account has no admin access (admins/<uid> document missing)." }[x.code];
      err.textContent = (m || "Login failed.") + (x.code ? " [" + x.code + "]" : "");
      busy = false; btn.disabled = false; btn.textContent = "Log in";
    }
  });
}

async function render() {
  if (page === "overview") return overviewPage();
  if (page === "customers") return customersPage();
  if (MODS[page]) return modulePage(page);
  A.innerHTML = `<p class="notice err">Unknown page.</p>`;
}

if (page === "login") {
  loginPage();
  if (configured && auth) onAuthStateChanged(auth, async u => { if (u && !busy && await isAdmin(u)) location.replace("admin-dashboard.html"); });
} else if (!configured || !auth) {
  A.innerHTML = `<p class="notice err">Firebase is not configured. Check js/firebase-config.js.</p>`;
} else {
  let started = false;
  onAuthStateChanged(auth, async u => {
    if (!u) return location.replace("admin-login.html");
    if (!(await isAdmin(u))) { await signOut(auth); return location.replace("admin-login.html?denied=1"); }
    if (started) return; started = true;
    try { await render(); } catch (x) { console.error(x); A.innerHTML = `<p class="notice err">Could not load this page: ${esc(x.message || x)}</p>`; }
  });
}
