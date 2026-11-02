/* Customer registration + loan application (7 steps).
   Step 1 creates the login account AND reserves the Customer ID + Application ID (race-safe, unique).
   Final step saves everything to Firestore, e-mails the customer (with PDF), opens a WhatsApp message to the company. */
import { auth, db, configured } from "./firebase-config.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc, emi } from "./util.js";

const host = document.getElementById("regApp"), S = window.SITE || { services: [] };
const RATE = Number(S.emiRate) || 6;                       // indicative EMI rate (% per year) – change in js/config.js
const COMPANY = S.name || "our team";
const F = (k, l, t = "text", x = {}) => ({ k, l, t, ...x });

/* ---- input masks: customer can type ONLY what the field allows ---- */
const digits = n => v => v.replace(/\D/g, "").slice(0, n);
const phone10 = v => { let d = v.replace(/\D/g, ""); if (d.length > 10 && d.startsWith("91")) d = d.slice(2); return d.slice(0, 10); };
const isL = c => c >= "A" && c <= "Z", isD = c => c >= "0" && c <= "9";
const maskBy = (rule, max) => v => { let o = ""; for (const c of v.toUpperCase().replace(/[^A-Z0-9]/g, "")) { if (o.length >= max) break; if (rule(o.length, c)) o += c; } return o; };
const panMask = maskBy((p, c) => p < 5 ? isL(c) : p < 9 ? isD(c) : isL(c), 10);   // ABCDE1234F
const ifscMask = maskBy((p, c) => p < 4 ? isL(c) : p === 4 ? c === "0" : true, 11); // SBIN0001234

const loanTypes = (S.services || []).map(s => s.name).concat(["Wedding", "Travel", "Medical", "Bill Payment", "Other / not sure"]);
const AADHAAR = F("aadhaar", "Aadhaar number (12 digits)", "text", { req: 1, mask: digits(12), max: 12, mode: "numeric", ph: "12-digit Aadhaar number" });
const PAN = F("pan", "PAN", "text", { req: 1, mask: panMask, max: 10, ph: "ABCDE1234F" });
const STEPS = [
  { id: "account", t: "Account", f: [F("name", "Full name", "text", { req: 1 }), F("phone", "Mobile number", "tel", { req: 1, mask: phone10, max: 10, mode: "numeric" }), F("email", "Email address", "email", { req: 1 }), F("password", "Create password (min 8 characters)", "password", { req: 1 }), F("password2", "Confirm password", "password", { req: 1 })] },
  { id: "personal", t: "Personal details", f: [F("dob", "Date of birth", "date", { req: 1 }), AADHAAR, PAN, F("city", "City", "text", { req: 1 }), F("state", "State", "text", { req: 1 }), F("pincode", "PIN code", "text", { req: 1, mask: digits(6), max: 6, mode: "numeric" })] },
  { id: "employment", t: "Employment & income", f: [F("empType", "Occupation type", "select", { req: 1, o: ["Salaried", "Self-employed", "Business owner", "Professional", "Other"] }), F("employer", "Employer / business name", "text", { req: 1 }), F("monthlyIncome", "Monthly income (Rs.)", "number", { req: 1 }), F("workYears", "Years in current work", "number")] },
  { id: "loan", t: "Loan requirement", emiBox: true, f: [F("loanType", "Loan type", "select", { req: 1, o: loanTypes }), F("loanAmount", "Loan amount required (Rs.)", "number", { req: 1 }), F("tenureMonths", "Preferred tenure (months)", "number", { req: 1 })] },
  { id: "documents", t: "Documents", f: [AADHAAR, PAN, F("bankName", "Bank name", "text", { req: 1 }), F("accountNumber", "Account number", "text", { req: 1, mask: digits(18), max: 18, mode: "numeric" }), F("ifsc", "IFSC code", "text", { req: 1, mask: ifscMask, max: 11, ph: "SBIN0001234" }), F("hasOtherLoans", "Do you have other running loans?", "select", { req: 1, o: ["No", "Yes"] })] },
  { id: "reference", t: "Reference", f: [F("refName", "Reference person name", "text", { req: 1 }), F("refPhone", "Reference mobile number", "tel", { req: 1, mask: phone10, max: 10, mode: "numeric" }), F("refRelation", "Relationship", "text")] },
  { id: "review", t: "Review & consent", f: [] }
];
const st = {}; let i = 0, done = false, busy = false;

const field = (f, v, ro) => {
  const id = "r_" + f.k, val = v ?? "";
  const c = f.t === "select" ? `<select id="${id}" data-k="${f.k}"><option value="">Select…</option>${f.o.map(o => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`
    : `<input id="${id}" data-k="${f.k}" type="${f.t}" value="${esc(val)}" ${f.t === "password" ? 'autocomplete="new-password"' : ""} ${f.t === "number" ? 'step="any" min="0" inputmode="decimal"' : ""} ${f.mode ? `inputmode="${f.mode}"` : ""} ${f.ph ? `placeholder="${f.ph}"` : ""} ${ro ? "readonly" : ""}>`;
  return `<div class="field"><label for="${id}">${f.l}${f.req ? " *" : ""}</label>${c}</div>`;
};
function validate(step, d) {
  for (const f of step.f) { if (st._uid && /^password/.test(f.k)) continue; if (f.req && (d[f.k] === "" || d[f.k] == null)) return f.l + " is required."; }
  const V = window.V;
  if (step.id === "account" && !st._uid) { if (!V.email(d.email)) return "Enter a valid email address."; if (!V.mobile(d.phone)) return "Enter a valid 10-digit mobile number."; if (d.password.length < 8) return "Password must be at least 8 characters."; if (d.password !== d.password2) return "Passwords do not match."; }
  if (step.id === "account" && st._uid && !V.mobile(d.phone)) return "Enter a valid 10-digit mobile number.";
  if (step.id === "personal") {
    if (!/^\d{12}$/.test(d.aadhaar)) return "Aadhaar number must be exactly 12 digits.";
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(d.pan)) return "PAN must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).";
    if (!/^\d{6}$/.test(d.pincode)) return "PIN code must be exactly 6 digits.";
    if (!((Date.now() - new Date(d.dob)) / 31557600000 >= 18)) return "You must be at least 18 years old.";
  }
  if (step.id === "loan") { if (!(d.loanAmount > 0)) return "Enter a valid loan amount."; if (!(d.tenureMonths >= 1 && d.tenureMonths <= 360)) return "Tenure must be between 1 and 360 months."; }
  if (step.id === "documents") {
    if (!/^\d{12}$/.test(d.aadhaar)) return "Aadhaar number must be exactly 12 digits.";
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(d.pan)) return "PAN must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).";
    if (!/^\d{9,18}$/.test(d.accountNumber)) return "Account number must be 9 to 18 digits.";
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(d.ifsc)) return "IFSC must be 11 characters, e.g. SBIN0001234.";
  }
  if (step.id === "reference" && !V.mobile(d.refPhone)) return "Enter a valid 10-digit reference mobile number.";
  return "";
}
const read = step => { const d = {}; step.f.forEach(f => { const e = host.querySelector(`[data-k="${f.k}"]`); if (e) d[f.k] = f.t === "number" ? (e.value === "" ? "" : Number(e.value)) : e.value.trim(); }); return d; };
const money = n => "Rs. " + Number(n).toLocaleString("en-IN");
const maskAadhaar = a => a ? "XXXX XXXX " + a.slice(-4) : "";
const maskAcct = a => a ? "X".repeat(Math.max(0, a.length - 4)) + a.slice(-4) : "";
const monthlyEmi = (amt, n) => (amt > 0 && n >= 1) ? emi(amt, RATE, n) : null;

function reviewHtml() {
  const e = monthlyEmi(st.loanAmount, st.tenureMonths);
  const rows = [["Customer ID", st._ids?.customerId], ["Application ID", st._ids?.applicationId], ["Name", st.name], ["Mobile", st.phone], ["Email", st.email], ["Date of birth", st.dob], ["Aadhaar", st.aadhaar], ["PAN", st.pan], ["City", st.city], ["State", st.state], ["PIN code", st.pincode],
    ["Occupation", st.empType], ["Employer / business", st.employer], ["Monthly income", money(st.monthlyIncome)], ["Years in current work", st.workYears === "" || st.workYears == null ? "—" : st.workYears],
    ["Loan type", st.loanType], ["Loan amount", money(st.loanAmount)], ["Tenure", st.tenureMonths + " months"], ["Estimated EMI (" + RATE + "% p.a.)", e ? money(Math.round(e)) + " / month" : "—"],
    ["Bank name", st.bankName], ["Account number", st.accountNumber], ["IFSC", st.ifsc], ["Other running loans", st.hasOtherLoans], ["Reference", `${st.refName} (${st.refPhone})${st.refRelation ? ", " + st.refRelation : ""}`]];
  return `<dl class="review">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    <div class="field"><div class="consent"><input type="checkbox" id="c1"><label for="c1">I confirm the details above are correct and I agree to the Privacy Policy and Terms.</label></div></div>
    <div class="field"><div class="consent"><input type="checkbox" id="c2"><label for="c2">I understand that submitting this application does not guarantee loan approval.</label></div></div>`;
}
const emiBoxHtml = () => `<div class="out" id="emiBox" style="margin:6px 0 14px" aria-live="polite"><small>Estimated monthly EMI (at ${RATE}% p.a.)</small><div class="big" id="emiVal">—</div>
  <div class="row2"><div class="kv"><span>Total interest</span><b id="emiInt">—</b></div><div class="kv"><span>Total payment</span><b id="emiTot">—</b></div></div><p class="hint">*Indicative only. Actual terms may vary based on eligibility.</p></div>`;
function updateEmi() {
  const a = Number(host.querySelector('[data-k="loanAmount"]')?.value), n = Number(host.querySelector('[data-k="tenureMonths"]')?.value), e = monthlyEmi(a, n);
  const set = (id, v) => { const el = host.querySelector("#" + id); if (el) el.textContent = v; };
  set("emiVal", e ? money(Math.round(e)) + " / month" : "—"); set("emiInt", e ? money(Math.round(e * n - a)) : "—"); set("emiTot", e ? money(Math.round(e * n)) : "—");
}

function draw() {
  if (done) return;
  const s = STEPS[i], last = s.id === "review", locked = !!st._uid;
  const fields = s.id === "account" && locked ? s.f.filter(f => !/^password/.test(f.k)) : s.f;
  const ids = st._ids ? `<div class="notice" style="margin-bottom:16px"><b>Customer ID:</b> ${esc(st._ids.customerId)}<br><b>Application ID:</b> ${esc(st._ids.applicationId)}</div>` : "";
  host.innerHTML = `<p class="hint">Step ${i + 1} of ${STEPS.length}</p><h2 style="margin-bottom:14px">${s.t}</h2>${ids}<form id="rf" novalidate><div class="row2">${fields.map(f => field(f, st[f.k], locked && f.k === "email")).join("")}</div>${s.emiBox ? emiBoxHtml() : ""}${last ? reviewHtml() : ""}<p class="err" id="rerr" role="alert"></p>
    <div class="btns" style="margin-top:14px">${i ? `<button type="button" class="btn btn-ghost" id="back">Back</button>` : ""}<button class="btn btn-primary" type="submit" id="next">${last ? "Submit application" : s.id === "account" && !locked ? "Create account & continue" : "Next"}</button></div></form>`;
  const f = host.querySelector("#rf"), err = host.querySelector("#rerr"), btn = host.querySelector("#next");
  fields.forEach(fl => { if (fl.mask) { const el = host.querySelector(`[data-k="${fl.k}"]`); el.addEventListener("input", () => { el.value = fl.mask(el.value); }); } });
  if (s.emiBox) { ["loanAmount", "tenureMonths"].forEach(k => host.querySelector(`[data-k="${k}"]`).addEventListener("input", updateEmi)); updateEmi(); }
  host.querySelector("#back")?.addEventListener("click", () => { Object.assign(st, read(s)); i--; draw(); });
  f.addEventListener("submit", async e => {
    e.preventDefault(); if (busy) return; err.textContent = "";
    const d = read(s), msg = validate(s, d); if (msg) { err.textContent = msg; return; }
    Object.assign(st, d);
    if (s.id === "account" && !st._uid) {
      busy = true; btn.disabled = true; btn.textContent = "Creating account…";
      try { await createAccount(); } catch (x) { err.textContent = x.message; busy = false; btn.disabled = false; btn.textContent = "Create account & continue"; return; }
      busy = false;
    }
    if (!last) { i++; draw(); window.scrollTo({ top: host.offsetTop - 80 }); return; }
    if (!host.querySelector("#c1").checked || !host.querySelector("#c2").checked) { err.textContent = "Please tick both confirmations."; return; }
    /* open the WhatsApp tab NOW (inside the click) so the browser does not block it later */
    const wa = S.whatsapp ? window.open("about:blank", "_blank") : null;
    await submit(err, btn, wa);
  });
}

/* ---------- Step 1: account + IDs ---------- */
const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
async function reserveIds(uid) {
  const reg = await getDoc(doc(db, "registrations", uid)); if (reg.exists()) return { customerId: reg.data().customerId, applicationId: reg.data().applicationId };
  let lastErr;
  for (let a = 0; a < 6; a++) {
    const customerId = "CID-" + String(new Date().getFullYear()).slice(2) + "-" + rid(6), applicationId = "APP-" + new Date().getFullYear() + "-" + rid(6);
    try {
      const b = writeBatch(db);
      b.set(doc(db, "idIndex", customerId), { uid, kind: "customer", createdAt: serverTimestamp() });
      b.set(doc(db, "idIndex", applicationId), { uid, kind: "application", createdAt: serverTimestamp() });
      b.set(doc(db, "registrations", uid), { customerId, applicationId, createdAt: serverTimestamp() });
      await b.commit(); return { customerId, applicationId };       /* an ID that already exists is refused by the rules, so we simply try a new one */
    } catch (x) { lastErr = x; if (x.code !== "permission-denied") throw x; }
  }
  throw new Error("Could not create your IDs (" + (lastErr?.code || "error") + "). Please try again.");
}
async function createAccount() {
  let cred;
  try { cred = await createUserWithEmailAndPassword(auth, st.email, st.password); }
  catch (x) {
    if (x.code === "auth/email-already-in-use") {
      try { cred = await signInWithEmailAndPassword(auth, st.email, st.password); } catch { throw new Error("This email is already registered. Please log in."); }
      if ((await getDoc(doc(db, "customers", cred.user.uid))).exists()) throw new Error("This email is already registered. Please log in.");
    } else throw new Error(({ "auth/weak-password": "Password is too weak.", "auth/invalid-email": "Enter a valid email address.", "auth/network-request-failed": "Network error. Check your internet.", "auth/operation-not-allowed": "Email/Password sign-in is not enabled in Firebase." }[x.code] || "Could not create account.") + " [" + x.code + "]");
  }
  st._uid = cred.user.uid; st._ids = await reserveIds(st._uid); delete st.password; delete st.password2;
}

/* ---------- Final submit ---------- */
function buildDocs() {
  const d = st, ids = d._ids, ph = window.V.mobile(d.phone), rp = window.V.mobile(d.refPhone), wy = d.workYears === "" || d.workYears == null ? 0 : d.workYears, addr = `${d.city}, ${d.state} - ${d.pincode}`, e = monthlyEmi(d.loanAmount, d.tenureMonths);
  return {
    customer: { uid: d._uid, customerId: ids.customerId, name: d.name, fullName: d.name, phone: ph, mobile: ph, email: d.email, dob: d.dob, aadhaar: d.aadhaar, aadhaarLast4: d.aadhaar.slice(-4), pan: d.pan, city: d.city, state: d.state, pincode: d.pincode, addressCurrent: addr, addressPermanent: addr,
      empType: d.empType, employmentType: d.empType, employer: d.employer, employerName: d.employer, monthlyIncome: d.monthlyIncome, workYears: wy, employmentMonths: Math.round(wy * 12), hasOtherLoans: d.hasOtherLoans, otherObligations: null,
      bankName: d.bankName, accountHolder: d.name, accountNumber: d.accountNumber, accountLast4: d.accountNumber.slice(-4), ifsc: d.ifsc, refName: d.refName, refPhone: rp, refRelation: d.refRelation || "",
      identityStatus: "Pending verification", addressStatus: "Pending verification", docsStatus: "Pending", status: "Active", createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
    application: { uid: d._uid, applicationId: ids.applicationId, customerId: ids.customerId, customerName: d.name, loanType: d.loanType, loanAmount: d.loanAmount, tenureMonths: d.tenureMonths, purpose: d.loanType, monthlyIncome: d.monthlyIncome, employmentType: d.empType, otherObligations: null, hasOtherLoans: d.hasOtherLoans,
      emiRate: RATE, estimatedEmi: e ? Math.round(e) : null, status: "Submitted", statusHistory: [{ status: "Submitted", at: Date.now(), by: "customer", remarks: "" }], createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
  };
}
const loadPdfLib = () => window.jspdf ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"; s.onload = ok; s.onerror = () => no(new Error("PDF library failed to load")); document.head.append(s); });
async function makePdf() {
  await loadPdfLib(); const d = st, e = monthlyEmi(d.loanAmount, d.tenureMonths), pdf = new window.jspdf.jsPDF();
  pdf.setFontSize(18); pdf.text(`${S.name || "Loan Application"} - Application Summary`, 14, 18); pdf.setFontSize(10); pdf.setTextColor(90); pdf.text("Generated " + new Date().toLocaleString("en-IN"), 14, 25); pdf.setTextColor(0);
  const sec = [["Reference", [["Customer ID", d._ids.customerId], ["Application ID", d._ids.applicationId], ["Status", "Submitted (not an approval)"]]],
    ["Account", [["Name", d.name], ["Mobile", d.phone], ["Email", d.email]]],
    ["Personal", [["Date of birth", d.dob], ["Aadhaar", maskAadhaar(d.aadhaar)], ["PAN", d.pan], ["City", d.city], ["State", d.state], ["PIN code", d.pincode]]],
    ["Employment & income", [["Occupation", d.empType], ["Employer / business", d.employer], ["Monthly income", money(d.monthlyIncome)], ["Years in current work", d.workYears === "" || d.workYears == null ? "-" : d.workYears]]],
    ["Loan requirement", [["Loan type", d.loanType], ["Loan amount", money(d.loanAmount)], ["Tenure", d.tenureMonths + " months"], [`Estimated EMI (${RATE}% p.a., indicative)`, e ? money(Math.round(e)) + " / month" : "-"]]],
    ["Documents & bank", [["Bank name", d.bankName], ["Account number", maskAcct(d.accountNumber)], ["IFSC", d.ifsc], ["Other running loans", d.hasOtherLoans]]],
    ["Reference", [["Name", d.refName], ["Mobile", d.refPhone], ["Relationship", d.refRelation || "-"]]]];
  let y = 36;
  sec.forEach(([h, rows]) => { if (y > 255) { pdf.addPage(); y = 20; } pdf.setFontSize(12); pdf.setFont("helvetica", "bold"); pdf.text(h, 14, y); y += 6; pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); rows.forEach(([k, v]) => { pdf.text(k + ":", 16, y); pdf.text(String(v ?? "-"), 75, y); y += 6; }); y += 4; });
  pdf.setFontSize(8); pdf.text("Submitting an application does not guarantee loan approval. Aadhaar and account numbers are masked in this document. EMI is an estimate only.", 14, 285);
  return pdf;
}
const waText = () => { const d = st, e = monthlyEmi(d.loanAmount, d.tenureMonths); return [`Hi ${COMPANY}`, `I am applying for a ${d.loanType} loan. Please find my details:`, `Customer ID: ${d._ids.customerId}`, `Application ID: ${d._ids.applicationId}`, `Name: ${d.name}`, `Mobile: ${d.phone}`, `Email: ${d.email}`, `PAN: ${d.pan}`, `Aadhaar: ${maskAadhaar(d.aadhaar)}`, `City: ${d.city}`, `State: ${d.state}`, `Occupation: ${d.empType}`, `Monthly Income: ${d.monthlyIncome}`, `Loan Amount: ${d.loanAmount}`, `Tenure: ${d.tenureMonths} months`, e ? `Estimated EMI (${RATE}%): ${Math.round(e)}` : "", `Bank Name: ${d.bankName}`, `IFSC: ${d.ifsc}`, `Account Number: ${maskAcct(d.accountNumber)}`].filter(Boolean).join("\n"); };
const waUrl = () => `https://wa.me/${S.whatsapp}?text=${encodeURIComponent(waText())}`;

async function submit(err, btn, wa) {
  busy = true; btn.disabled = true; btn.textContent = "Submitting…";
  const { customer, application } = buildDocs();
  try {
    const b = writeBatch(db); b.set(doc(db, "customers", st._uid), customer); b.set(doc(db, "applications", st._ids.applicationId), application); await b.commit();
  } catch (x) {
    console.error(x); if (wa) wa.close(); busy = false; btn.disabled = false; btn.textContent = "Submit application";
    err.textContent = "Could not save your application (" + (x.code || x.message) + "). Nothing was submitted. Please try again or contact us."; return;
  }
  done = true;
  host.innerHTML = `<h2>Application submitted</h2><p>Thank you, ${esc(st.name)}. Your application has been received. This is not a loan approval.</p>
    <div class="card" style="margin:16px 0"><small>Your Customer ID</small><h2>${esc(st._ids.customerId)}</h2><small>Application ID: ${esc(st._ids.applicationId)}</small></div>
    <ul class="checks" id="status"><li>Application saved</li><li id="sEmail">Sending confirmation email…</li><li id="sPdf">Preparing your PDF…</li></ul>
    <p class="btns" style="margin-top:14px"><button class="btn btn-ghost" id="dlPdf" type="button" hidden>Download PDF</button>${S.whatsapp ? '<a class="btn btn-ghost" id="waBtn" target="_blank" rel="noopener">Send details on WhatsApp</a>' : ""}<a class="btn btn-primary" href="dashboard.html">Go to my dashboard</a></p>`;
  const $ = id => host.querySelector("#" + id);
  if (S.whatsapp) { const u = waUrl(); $("waBtn").href = u; if (wa) wa.location.href = u; }
  let pdf = null, b64 = "";
  try { pdf = await makePdf(); b64 = pdf.output("datauristring").split(",")[1]; $("sPdf").textContent = "PDF ready"; $("dlPdf").hidden = false; $("dlPdf").onclick = () => pdf.save(`${st._ids.applicationId}.pdf`); }
  catch (x) { console.error(x); $("sPdf").textContent = "PDF could not be created (you can download it later from support)."; }
  try {
    const token = await auth.currentUser.getIdToken(), e = monthlyEmi(st.loanAmount, st.tenureMonths);
    const r = await fetch("/api/send-confirmation", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ company: S.name || "", customerName: st.name, customerId: st._ids.customerId, applicationId: st._ids.applicationId, loanType: st.loanType, loanAmount: st.loanAmount, tenureMonths: st.tenureMonths, emi: e ? Math.round(e) : null, rate: RATE, pdfBase64: b64 }) });
    const j = await r.json().catch(() => ({}));
    $("sEmail").textContent = r.ok && j.ok ? `Confirmation email sent to ${st.email}` : "Confirmation email could not be sent right now. Your application is saved and our team will contact you.";
  } catch (x) { console.error(x); $("sEmail").textContent = "Confirmation email could not be sent right now. Your application is saved and our team will contact you."; }
}
if (!configured || !auth) host.innerHTML = `<p class="notice err">Registration is temporarily unavailable. Please call us or message us on WhatsApp.</p>`; else draw();
