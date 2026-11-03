/* Admin panel: auth guard + Overview + Customers + 7 modules. Access is enforced by the admins/<uid> document AND firestore.rules. */
import { auth, db, fns, configured } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, query, where, orderBy, limit, serverTimestamp, getCountFromServer, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { esc, inr, dt, ms, emi, maskPan, $ } from "./util.js";
import { buildLetter, stageCopy, sendMail } from "./letter.js";

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

/* ---------- pipeline: an application moves to the next page ONLY when the admin clicks Next ---------- */
const STAGES = [["customers", "Customers"], ["approvals", "Approvals"], ["tds", "TDS"], ["agreements", "Agreements"], ["rtgs", "RTGS / NEFT"], ["rbi", "RBI & Compliance"], ["gst", "GST"], ["noc", "NOC"]];
const STAGE_STATUS = { approvals: "Under Review", tds: "Approved", agreements: "Agreement Pending", rtgs: "Disbursement Pending", rbi: "Compliance Review", gst: "GST Processing", noc: "NOC Pending", completed: "Completed" };
const stageOf = a => a.stage || "customers";
const stageName = id => (STAGES.find(s => s[0] === id) || [0, "Completed"])[1];
const PIPE_COLS = [["Application", a => a.applicationId], ["Customer ID", a => a.customerId], ["Name", a => a.customerName], ["Amount", a => inr(a.loanAmount)], ["Tenure", a => a.tenureMonths + " m"], ["Waiting since", a => dt(a.updatedAt || a.createdAt)], ["Status", a => a.status]];
const atStage = async id => (await list("applications", orderBy("createdAt", "desc"), limit(500))).filter(a => stageOf(a) === id);
const OWN = `<div class="field"><label for="ownpdf">Use my own PDF instead (optional)</label><input type="file" id="ownpdf" accept="application/pdf"><span class="hint">If you choose a PDF here, it is emailed to the customer instead of the automatic letter.</span></div>`;
const dlB64 = (b64, name) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([u], { type: "application/pdf" })); a.download = name; document.body.append(a); a.click(); a.remove(); };
const readOwn = async el => {
  const f = el && el.files && el.files[0]; if (!f) return null;
  if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) throw new Error("Choose a PDF file.");
  if (f.size > 2 * 1024 * 1024) throw new Error("Your PDF is larger than 2 MB.");
  const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(new Error("Could not read the PDF.")); r.readAsDataURL(f); });
  return { base64: b64, name: f.name.replace(/[^\w.\-]/g, "_") };
};
const stepRowsOf = (M, p) => { const r = M.fields.filter(f => !["customerId", "applicationId"].includes(f.k) && f.t !== "checkbox" && p[f.k] !== "" && p[f.k] != null && !/ref$/i.test(f.k)).map(f => [f.l.replace(/\s*\(.*\)\s*$/, ""), String(p[f.k])]); r.push(["Status", p.status]); return r; };
const hintFor = n => /535|Username and Password|Application-specific/i.test(n) ? "Gmail App Password galat hai, ya Gmail me 2-Step Verification on nahi hai." : /Email failed \(404\)/.test(n) ? "/api/send-mail nahi mila. api/send-mail.mjs repo me daalo aur Vercel me Redeploy karo." : /Server setting missing: (\w+)/.exec(n) ? `Vercel > Settings > Environment Variables me ${/Server setting missing: (\w+)/.exec(n)[1]} daalo aur Redeploy karo.` : /Cannot find module|nodemailer/i.test(n) ? "package.json me nodemailer dependency daalo aur Redeploy karo." : /^Invalid login$|Not signed in/.test(n) ? "Admin panel se Sign out karke dobara login karo." : /Admins only/.test(n) ? "Firestore me admins/<uid> document aur rules check karo." : /customer email not found/.test(n) ? "Is customer ke profile me email nahi mila." : /PDF library/.test(n) ? "PDF library load nahi hui. Internet check karke page refresh karo." : "";
function mailFailDialog(out) {
  show(`<h2>Email was not sent</h2><p class="err">${esc(out.note)}</p>${hintFor(out.note) ? `<p class="hint"><b>Fix:</b> ${esc(hintFor(out.note))}</p>` : ""}<p>The application <b>has moved</b> to the next step. You can download the letter and send it yourself, or try the email again.</p><p class="err" id="mferr" role="alert"></p>
    <div class="btns">${out.pdfBase64 ? `<button type="button" class="btn btn-primary" id="mfdl">Download PDF</button>` : ""}${out.pdfBase64 && out.to ? `<button type="button" class="btn btn-ghost" id="mfretry">Retry email</button>` : ""}<button type="button" class="btn btn-ghost" data-close>Close</button></div>`);
  const dl = dlg.querySelector("#mfdl"), rt = dlg.querySelector("#mfretry"), er = dlg.querySelector("#mferr");
  if (dl) dl.addEventListener("click", () => dlB64(out.pdfBase64, out.filename));
  if (rt) rt.addEventListener("click", async () => { rt.disabled = true; er.textContent = ""; try { await sendMail(auth, { to: out.to, subject: out.copy.subject, text: out.copy.body, pdfBase64: out.pdfBase64, filename: out.filename }); dlg.close(); toast("Email sent.", "ok"); } catch (x) { er.textContent = (x.message || String(x)) + (hintFor(x.message || "") ? " — " + hintFor(x.message || "") : ""); rt.disabled = false; } });
}
async function previewLetter(app, from, extra, rows, o = {}) {
  const i = STAGES.findIndex(s => s[0] === from), nxt = STAGES[i + 1], to = nxt ? nxt[0] : "completed", toName = nxt ? nxt[1] : "Completed", S = window.SITE || {};
  const merged = o.noMove ? { ...app, ...extra } : { ...app, ...extra, stage: to, status: STAGE_STATUS[to] }, cust = app.uid ? ((await getDoc(doc(db, "customers", app.uid))).data() || {}) : {};
  dlB64(await buildLetter({ site: S, app: merged, customer: cust, copy: stageCopy(from, toName, merged, S), rows, ref: o.ref, done: o.done !== false, statusText: o.statusText }), `${app.applicationId || "letter"}-${from}.pdf`);
}
async function downloadRecordLetter(M, rec) {
  const app = (rec.applicationId ? (await list("applications", where("applicationId", "==", rec.applicationId), limit(1)))[0] : null) || (await list("applications", where("customerId", "==", rec.customerId), limit(1)))[0];
  if (!app) throw new Error("No application found for this record.");
  await previewLetter(app, M.key, {}, stepRowsOf(M, rec), { noMove: true, ref: rec.ref || rec.invoiceNo, done: !M.done || rec.status === M.done, statusText: rec.status });
}
async function advance(app, from, extra = {}, rows = [], own = null) {
  const i = STAGES.findIndex(s => s[0] === from), nxt = STAGES[i + 1], to = nxt ? nxt[0] : "completed", status = STAGE_STATUS[to], toName = nxt ? nxt[1] : "Completed";
  await updateDoc(doc(db, "applications", app.id), { ...extra, stage: to, status, updatedAt: serverTimestamp(), statusHistory: arrayUnion({ status, at: Date.now(), by: me(), remarks: `${stageName(from)} done. Moved to ${toName}` }) });
  const merged = { ...app, ...extra, stage: to, status }, out = { note: "", to: "", filename: "", pdfBase64: "", copy: null };
  try {
    const cust = app.uid ? ((await getDoc(doc(db, "customers", app.uid))).data() || {}) : {}, S = window.SITE || {};
    out.to = cust.email || ""; out.copy = stageCopy(from, toName, merged, S);
    out.pdfBase64 = own ? own.base64 : await buildLetter({ site: S, app: merged, customer: cust, copy: out.copy, rows });
    out.filename = own ? own.name : `${merged.applicationId || "letter"}-${from}.pdf`;
    if (!out.to) throw new Error("customer email not found");
    await sendMail(auth, { to: out.to, subject: out.copy.subject, text: out.copy.body, pdfBase64: out.pdfBase64, filename: out.filename });
  } catch (x) { out.note = x.message || String(x); console.error(x); }
  if (app.uid) { try { await notify(app.uid, `Application ${app.applicationId || ""}: ${toName}`, `Your application has moved to the next step: ${toName}.`); } catch { /* ignore */ } }
  try { await audit("next", "applications", app.id, app.uid, `${from} -> ${to}${out.note ? " (email failed)" : ""}`); } catch { /* ignore */ }
  return out;
}
const nextToast = out => { if (out.note) { toast("Moved to next step, but the email was NOT sent.", "error"); mailFailDialog(out); } else toast("Moved to next step and email with PDF sent to the customer.", "ok"); };
async function rejectApp(a, remarks) {
  await updateDoc(doc(db, "applications", a.id), { stage: "rejected", status: "Rejected", adminRemarks: remarks, updatedAt: serverTimestamp(), statusHistory: arrayUnion({ status: "Rejected", at: Date.now(), by: me(), remarks }) });
  let note = "";
  try {
    const cust = a.uid ? ((await getDoc(doc(db, "customers", a.uid))).data() || {}) : {}, S = window.SITE || {};
    if (!cust.email) throw new Error("customer email not found");
    await sendMail(auth, { to: cust.email, subject: `Update on your application ${a.applicationId || ""}`, text: `Dear ${a.customerName || "Customer"},\n\nAfter review, we are unable to proceed with your application ${a.applicationId || ""}.\nReason: ${remarks}\n\nRegards,\n${S.name || "Customer Care"}` });
  } catch (x) { note = x.message || String(x); }
  if (a.uid) { try { await notify(a.uid, `Application ${a.applicationId || ""}: not approved`, remarks); } catch { /* ignore */ } }
  await audit("reject", "applications", a.id, a.uid, remarks);
  return note;
}

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

const DONE = { tds: "Verified", agreements: "Executed", rtgs: "Verified", rbi: "Resolved", gst: "Issued", noc: "Issued" };
Object.entries(MODS).forEach(([k, m]) => { m.key = k; m.done = DONE[k]; });
MODS.approvals = { title: "Approval Management", col: "applications", statuses: Object.keys(STAT_FLOW),
  cols: [["Application", r => r.applicationId], ["Customer ID", r => r.customerId], ["Name", r => r.customerName], ["Amount", r => inr(r.loanAmount)], ["Tenure", r => r.tenureMonths + " m"], ["Submitted", r => dt(r.createdAt)], ["Status", r => r.status]] };

/* ---------- record create/edit dialog (TDS, Agreements, RTGS, RBI, GST, NOC) ---------- */
async function recordDialog(M, r, reload, app) {
  const isNew = !r, rec = r || (app ? { customerId: app.customerId, applicationId: app.applicationId } : {});
  const fields = [...M.fields, F("status", "Status", "select", { req: 1, o: M.statuses }), F("remarks", "Admin remarks", "textarea"), ...(M.vis ? [F("visibleToCustomer", "Visible to customer in their portal", "checkbox")] : [])];
  show(`<h2>${isNew ? "New record" : esc(rec.ref || rec.invoiceNo || "Record")}</h2><form id="rf" novalidate><div class="row2">${fields.map(f => fieldHtml(f, rec[f.k] ?? (f.k === "status" ? M.statuses[0] : ""), !isNew && f.k === "customerId")).join("")}</div>${app && M.done ? OWN : ""}<p class="err" id="rerr" role="alert"></p>
    <div class="btns" style="margin-top:14px"><button class="btn btn-primary" type="submit" id="rsave">${app ? "Save only" : isNew ? "Create record" : "Save changes"}</button>${app && M.done ? `<button class="btn btn-primary" type="submit" id="rnext">Save &amp; Next &rarr; ${esc(stageName((STAGES[STAGES.findIndex(s => s[0] === M.key) + 1] || [0, "Completed"])[0]))}</button><button type="button" class="btn btn-ghost btn-sm" id="rprev">Download PDF</button>` : ""}${!isNew && M.extra ? M.extra(rec) : ""}${!isNew && !String(M.extra ? M.extra(rec) : "").includes('data-x="pdf"') ? `<button type="button" class="btn btn-ghost btn-sm" data-x="pdf">Download PDF</button>` : ""}<button type="button" class="btn btn-ghost" data-close>Cancel</button></div></form>`);
  const form = dlg.querySelector("#rf"), err = form.querySelector("#rerr");
  form.addEventListener("click", e => { const b = e.target.closest("[data-x]"); if (!b) return; if (b.dataset.x === "pdf") { err.textContent = ""; downloadRecordLetter(M, rec).catch(x => { err.textContent = x.message || String(x); }); } else if (M.act) M.act(rec, b.dataset.x); });
  form.querySelector("#rprev")?.addEventListener("click", async () => { err.textContent = ""; try { { const pp = readForm(form, fields); await previewLetter(app, M.key, {}, stepRowsOf(M, pp), { ref: rec.ref, done: !M.done || pp.status === M.done, statusText: pp.status }); } } catch (x) { err.textContent = x.message || String(x); } });
  form.addEventListener("submit", async e => {
    e.preventDefault(); err.textContent = "";
    const p = readForm(form, fields);
    const miss = fields.find(f => f.req && (p[f.k] === "" || p[f.k] == null));
    if (miss) { err.textContent = miss.l + " is required."; return; }
    const goNext = !!app && !!M.done && e.submitter && e.submitter.id === "rnext";
    if (goNext && p.status !== M.done) { err.textContent = `To go to the next step, set Status to "${M.done}" first.`; return; }
    let own = null; if (goNext) { try { own = await readOwn(form.querySelector("#ownpdf")); } catch (x) { err.textContent = x.message; return; } }
    const btn = form.querySelector("#rsave"), btn2 = form.querySelector("#rnext"); btn.disabled = true; if (btn2) btn2.disabled = true;
    try {
      const cust = rec.uid ? { uid: rec.uid } : await findCustomer(p.customerId);
      if (!cust) throw new Error("No customer found with this Customer ID.");
      const uid = cust.uid || cust.id;
      if (M.prep) { const app = p.applicationId ? (await list("applications", where("applicationId", "==", p.applicationId), limit(1)))[0] : null; await M.prep(p, app); }
      const msg = M.check ? M.check(p) : ""; if (msg) throw new Error(msg);
      Object.assign(p, M.calc ? M.calc(p) : {});
      const data = { ...p, uid, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid };
      if (app) data.applicationId = app.applicationId;
      let id = rec.id;
      if (isNew) {
        data.ref = `${M.prefix}-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        data.createdAt = serverTimestamp(); data.createdBy = auth.currentUser.uid;
        if (M.col === "agreements") data.versions = [{ at: Date.now(), by: me(), status: p.status }];
        id = (await addDoc(collection(db, M.col), data)).id;
      } else {
        if (M.col === "agreements") data.versions = arrayUnion({ at: Date.now(), by: me(), status: p.status, loanAmount: p.loanAmount, interestRatePct: p.interestRatePct, tenureMonths: p.tenureMonths });
        await updateDoc(doc(db, M.col, id), data);
      }
      if (M.vis && p.visibleToCustomer && (isNew || rec.status !== p.status || !rec.visibleToCustomer)) await notify(uid, `${M.title}: ${p.status}`, p.customerMessage || "Your record has been updated. Please check your dashboard.");
      await audit(isNew ? "create" : "update", M.col, id, uid, p.status);
      dlg.close();
      if (goNext) nextToast(await advance(app, M.key, {}, stepRowsOf(M, p), own));
      else toast("Saved.", "ok");
      reload();
    } catch (x) { err.textContent = x.message || "Could not save."; btn.disabled = false; if (btn2) btn2.disabled = false; }
  });
}

/* ---------- Approvals dialog: admin sets charges, then "Go to next" ---------- */
function approvalDialog(a, reload) {
  const t = a.terms || {};
  const TF = [F("interestRatePct", "Interest rate (% per year)", "number"), F("tenureMonths", "Approved tenure (months)", "number"), F("processingFeePct", "Processing fee (%)", "number"), F("otherCharges", "Other charges", "text")];
  show(`<h2>${esc(a.applicationId || a.id)}</h2>${chip(a.status)}${kv([["Customer ID", esc(a.customerId)], ["Name", esc(a.customerName)], ["Loan amount", rs(a.loanAmount)], ["Tenure requested", esc(a.tenureMonths) + " months"], ["Submitted", esc(dt(a.createdAt))]])}
    <form id="af" novalidate><div class="row2">${TF.map(f => fieldHtml(f, t[f.k] ?? (f.k === "tenureMonths" ? a.tenureMonths : ""), false)).join("")}</div>
    <div class="field"><label for="nr">Remarks (required to reject)</label><textarea id="nr"></textarea></div>${OWN}
    <p class="hint">Interest rate, tenure and processing fee are required to go to the next step. The customer is emailed an approval letter (PDF) with these charges and the EMI.</p><p class="err" id="aerr2" role="alert"></p>
    <div class="btns"><button class="btn btn-primary" type="submit" id="asave">Go to next &rarr; TDS</button><button type="button" class="btn btn-ghost" id="aprev">Download PDF</button><button type="button" class="btn btn-ghost" id="arej">Reject</button><button type="button" class="btn btn-ghost" data-close>Close</button></div></form>`);
  const f = dlg.querySelector("#af"), err = f.querySelector("#aerr2"), btns = () => f.querySelectorAll("button");
  f.querySelector("#aprev").addEventListener("click", async () => {
    err.textContent = ""; const terms = readForm(f, TF);
    if (terms.interestRatePct === "" || terms.tenureMonths === "") { err.textContent = "Fill interest rate and tenure to download the letter."; return; }
    try { await previewLetter(a, "approvals", { terms }, []); } catch (x) { err.textContent = x.message || String(x); }
  });
  f.querySelector("#arej").addEventListener("click", async () => {
    const remarks = f.querySelector("#nr").value.trim(); err.textContent = "";
    if (!remarks) { err.textContent = "Write the reason in Remarks to reject."; return; }
    btns().forEach(b => b.disabled = true);
    try { const note = await rejectApp(a, remarks); dlg.close(); toast(note ? "Rejected. Email not sent: " + note : "Application rejected and customer informed.", note ? "error" : "ok"); reload(); } catch (x) { err.textContent = x.message; btns().forEach(b => b.disabled = false); }
  });
  f.addEventListener("submit", async e => {
    e.preventDefault(); err.textContent = "";
    const remarks = f.querySelector("#nr").value.trim(), terms = readForm(f, TF);
    if (terms.interestRatePct === "" || terms.tenureMonths === "" || terms.processingFeePct === "") { err.textContent = "Interest rate, tenure and processing fee are required."; return; }
    if (!(terms.interestRatePct >= 0) || !(terms.tenureMonths >= 1)) { err.textContent = "Enter a valid rate and tenure."; return; }
    btns().forEach(b => b.disabled = true);
    try { const own = await readOwn(f.querySelector("#ownpdf")); const out = await advance(a, "approvals", { terms, adminRemarks: remarks, approvedBy: me(), approvedAt: serverTimestamp() }, [], own); dlg.close(); nextToast(out); reload(); }
    catch (x) { err.textContent = x.message || "Could not move to next step."; btns().forEach(b => b.disabled = false); }
  });
}

/* ---------- New application dialog (Customers page): Next -> Approvals ---------- */
async function applicationDialog(a, reload) {
  const c = a.uid ? ((await getDoc(doc(db, "customers", a.uid))).data() || {}) : {};
  show(`<h2>${esc(a.applicationId || a.id)}</h2>${chip(a.status)}${kv([["Customer ID", esc(a.customerId)], ["Name", esc(a.customerName || c.name)], ["Email", esc(c.email)], ["Mobile", esc(c.phone || c.mobile)], ["PAN", esc(c.pan ? maskPan(c.pan) : "")], ["City", esc(c.city)], ["Loan type", esc(a.loanType)], ["Loan amount", rs(a.loanAmount)], ["Tenure", esc(a.tenureMonths) + " months"], ["Purpose", esc(a.purpose)], ["Applied", esc(dt(a.createdAt))]])}
    <form id="nf" novalidate><div class="field"><label for="nm">Remarks (required to reject)</label><textarea id="nm"></textarea></div>${OWN}<p class="hint">This application stays here until you click Next. Next moves only this application to Approvals and emails the customer a PDF letter.</p><p class="err" id="nerr" role="alert"></p>
    <div class="btns"><button class="btn btn-primary" type="submit" id="ngo">Next &rarr; Approvals</button><button type="button" class="btn btn-ghost" id="nprev">Download PDF</button><button type="button" class="btn btn-ghost" id="nrej">Reject</button><button type="button" class="btn btn-ghost" data-close>Close</button></div></form>`);
  const f = dlg.querySelector("#nf"), err = f.querySelector("#nerr"), btns = () => f.querySelectorAll("button");
  f.querySelector("#nprev").addEventListener("click", async () => { err.textContent = ""; try { await previewLetter(a, "customers", {}, []); } catch (x) { err.textContent = x.message || String(x); } });
  f.querySelector("#nrej").addEventListener("click", async () => {
    const remarks = f.querySelector("#nm").value.trim(); err.textContent = "";
    if (!remarks) { err.textContent = "Write the reason in Remarks to reject."; return; }
    btns().forEach(b => b.disabled = true);
    try { const note = await rejectApp(a, remarks); dlg.close(); toast(note ? "Rejected. Email not sent: " + note : "Application rejected and customer informed.", note ? "error" : "ok"); reload(); } catch (x) { err.textContent = x.message; btns().forEach(b => b.disabled = false); }
  });
  f.addEventListener("submit", async e => {
    e.preventDefault(); err.textContent = ""; btns().forEach(b => b.disabled = true);
    try { const own = await readOwn(f.querySelector("#ownpdf")); const out = await advance(a, "customers", { adminRemarks: f.querySelector("#nm").value.trim() }, [], own); dlg.close(); nextToast(out); reload(); }
    catch (x) { err.textContent = x.message || "Could not move to next step."; btns().forEach(b => b.disabled = false); }
  });
}

/* ---------- Customer dialog ---------- */
async function customerDialog(c) {
  const uid = c.uid || c.id;
  show(`<h2>${esc(c.name || c.fullName || c.customerId)}</h2>${kv([["Customer ID", esc(c.customerId)], ["Email", esc(c.email)], ["Phone", esc(c.phone || c.mobile)], ["PAN", esc(c.pan ? maskPan(c.pan) : "")], ["City", esc(c.city)], ["Registered", esc(dt(c.createdAt))]])}<h3>Applications</h3><div id="capps">Loading…</div>
    <form id="mf" novalidate style="margin-top:16px"><div class="field"><label for="mt">Send a message to this customer</label><textarea id="mt"></textarea></div><p class="err" id="merr" role="alert"></p><div class="btns"><button class="btn btn-primary" type="submit">Send message</button><button type="button" class="btn btn-ghost" data-close>Close</button></div></form>`);
  byUid("applications", uid).then(l => { const h = dlg.querySelector("#capps"); if (h) h.innerHTML = l.length ? l.map(a => `<p>${esc(a.applicationId)} · ${rs(a.loanAmount)} · ${chip(a.status)}</p>`).join("") : "<p class='hint'>No applications.</p>"; }).catch(() => { const h = dlg.querySelector("#capps"); if (h) h.textContent = "Could not load applications."; });
  dlg.querySelector("#mf").addEventListener("submit", async e => {
    e.preventDefault(); const t = dlg.querySelector("#mt").value.trim(), err = dlg.querySelector("#merr");
    if (!t) { err.textContent = "Write a message first."; return; }
    try { await notify(uid, "Message from our team", t); await audit("message", "customers", c.id, uid, t); dlg.querySelector("#mt").value = ""; err.textContent = ""; toast("Message sent.", "ok"); } catch (x) { err.textContent = x.message; }
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
  const by = {}; apps.forEach(a => { const k = stageName(stageOf(a)); by[k] = (by[k] || 0) + 1; });
  const max = Math.max(1, ...Object.values(by));
  const stat = (l, v) => `<div class="card stat"><small>${l}</small><b>${v}</b></div>`;
  $("#ov").innerHTML = `<div class="grid g4">${stat("Customers", cu)}${stat("Applications", ap)}${stat("TDS records", tds)}${stat("Agreements", agr)}${stat("RTGS / NEFT", rt)}${stat("Compliance reviews", cmp)}${stat("GST records", gst)}${stat("NOC records", noc)}</div>
  <div class="card" style="margin-top:20px"><h3>Applications by step</h3>${Object.entries(by).map(([k, v]) => `<div class="barrow"><span>${esc(k)}</span><div><i style="width:${Math.round(v / max * 100)}%"></i></div><b>${v}</b></div>`).join("") || "<p class='hint'>No applications yet.</p>"}</div>`;
}

async function customersPage() {
  shell("Customers", `<h2 style="font-size:1.25rem;margin:4px 0 10px">New applications (waiting for you)</h2><div id="pend">Loading…</div><h2 style="font-size:1.25rem;margin:26px 0 10px">All registered customers</h2><div id="tbl">Loading…</div>`);
  const load = async () => { const apps = await atStage("customers"); table($("#pend"), { rows: apps, cols: PIPE_COLS, open: a => applicationDialog(a, load) }); };
  await load();
  const rows = await list("customers", orderBy("createdAt", "desc"), limit(500));
  table($("#tbl"), { rows, open: customerDialog, cols: [["Customer ID", r => r.customerId], ["Name", r => r.name || r.fullName], ["Email", r => r.email], ["Phone", r => r.phone || r.mobile], ["Registered", r => dt(r.createdAt)]] });
}

async function approvalsPage() {
  shell("Approvals", `<h2 style="font-size:1.25rem;margin:4px 0 10px">Waiting for approval</h2><div id="tbl">Loading…</div>`);
  const load = async () => table($("#tbl"), { rows: await atStage("approvals"), cols: PIPE_COLS, open: a => approvalDialog(a, load) });
  await load();
}

async function modulePage(key) {
  const M = MODS[key], nextName = (STAGES[STAGES.findIndex(s => s[0] === key) + 1] || [0, "Completed"])[1];
  shell(M.title, `<h2 style="font-size:1.25rem;margin:4px 0 10px">Waiting at this step</h2><p class="hint">Open an application, fill the details, then click "Save &amp; Next &rarr; ${esc(nextName)}". It stays here until you do.</p><div id="pipe">Loading…</div><h2 style="font-size:1.25rem;margin:26px 0 10px">All records</h2><div id="tbl">Loading…</div>`, `<button class="btn btn-primary btn-sm" id="newRec">New record</button>`);
  const load = async () => {
    table($("#pipe"), { rows: await atStage(key), cols: PIPE_COLS, open: async a => { const ex = (await list(M.col, where("applicationId", "==", a.applicationId), limit(1)))[0]; recordDialog(M, ex || null, load, a); } });
    const rows = await list(M.col, orderBy("createdAt", "desc"), limit(500));
    table($("#tbl"), { rows, cols: M.cols, statuses: M.statuses, open: r => recordDialog(M, r, load) });
  };
  $("#newRec").addEventListener("click", () => recordDialog(M, null, load));
  await load();
}

/* ---------- auth ---------- */
const isAdmin = async u => { try { const s = await getDoc(doc(db, "admins", u.uid)); return s.exists() && s.data().active !== false; } catch { return false; } };
let busy = false;
function loginPage() {
  const f = document.getElementById("adminLogin"), err = document.getElementById("aerr"), btn = document.getElementById("adminLoginButton");
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
      const m = { "auth/invalid-credential": "Wrong email or password.", "auth/wrong-password": "Wrong email or password.", "auth/user-not-found": "No account with this email.", "auth/invalid-email": "Enter a valid email.", "auth/too-many-requests": "Too many attempts. Try again later.", "auth/unauthorized-domain": "This website domain is not added in Firebase Authentication > Settings > Authorized domains.", "auth/operation-not-allowed": "Email/Password sign-in is not enabled in Firebase.", "auth/network-request-failed": "Network error. Check your internet.", "app/not-admin": "This account has no admin access (admins/<uid> document missing)." };
      err.textContent = (m[x.code] || "Login failed.") + (x.code ? " [" + x.code + "]" : "");
      busy = false; btn.disabled = false; btn.textContent = "Log in";
    }
  });
}

async function render() {
  if (page === "overview") return overviewPage();
  if (page === "customers") return customersPage();
  if (page === "approvals") return approvalsPage();
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
