/* 7-step customer registration. Password goes ONLY to Firebase Auth. Profile + Customer ID are created by the trusted registerCustomer function. */
import { auth, fns, configured } from "../firebase-config.js";
import { createUserWithEmailAndPassword, sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { esc, inr } from "./util.js";

const host = document.getElementById("regApp");
const T = (k, l, t = "text", x = {}) => ({ k, l, t, req: 1, ...x });
const SEL = (k, l, o, x = {}) => T(k, l, "select", { o, ...x });
const NUM = (min, max, m) => v => { const n = Number(v); return v === "" || isNaN(n) || n < min || n > max ? m : ""; };
const RE = (re, m) => v => re.test(String(v).trim().toUpperCase()) ? "" : m;
const AGE = v => { const d = new Date(v); if (isNaN(d)) return "Enter a valid date of birth."; const a = (Date.now() - d) / 31557600000; return a < 18 ? "You must be at least 18 years old." : a > 90 ? "Please check the date of birth." : ""; };
const STEPS = [
  { t: "Personal information", f: [
    T("fullName", "Full legal name (as on PAN)", "text", { v: v => v.trim().length >= 2 ? "" : "Enter your full legal name.", ac: "name" }),
    T("dob", "Date of birth", "date", { v: AGE }), SEL("gender", "Gender", ["Male", "Female", "Other", "Prefer not to say"]),
    T("mobile", "Mobile number", "tel", { v: RE(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number."), ac: "tel", ph: "10-digit number" }),
    T("email", "Email address", "email", { v: RE(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i, "Enter a valid email address."), ac: "email" }),
    T("addressCurrent", "Current address", "textarea", { v: v => v.trim().length >= 10 ? "" : "Enter your full current address." }),
    { k: "addressPermanent", l: "Permanent address (leave blank if same)", t: "textarea" }] },
  { t: "Identity and verification", note: "Verification of your PAN and address is done later by our team using an authorised process. Nothing is marked verified until that happens. We never store your full Aadhaar number or Aadhaar images here.", f: [
    T("pan", "PAN", "text", { v: RE(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Enter a valid PAN, e.g. ABCDE1234F."), ph: "ABCDE1234F" }),
    { k: "aadhaarLast4", l: "Aadhaar — last 4 digits only (optional)", t: "text", v: v => !v || /^\d{4}$/.test(v) ? "" : "Enter exactly 4 digits." },
    T("idConsent", "I consent to my PAN, address and identity being verified through authorised procedures.", "checkbox", { v: v => v ? "" : "Consent is required to continue." })] },
  { t: "Employment and income", f: [
    SEL("employmentType", "Employment type", ["Salaried", "Self-employed professional", "Business owner", "Other"]),
    T("employerName", "Employer or business name"), T("employmentMonths", "Time in current employment/business (months)", "number", { v: NUM(0, 720, "Enter months (0–720).") }),
    T("monthlyIncome", "Monthly income (₹)", "number", { v: NUM(1, 1e8, "Enter your monthly income.") }),
    SEL("incomeSource", "Income source", ["Salary", "Business profit", "Professional fees", "Rent", "Other"]),
    T("otherObligations", "Total monthly EMIs / existing obligations (₹)", "number", { v: NUM(0, 1e8, "Enter 0 if none.") })] },
  { t: "Loan application", note: "Our team will ask for supporting documents (such as income proof and bank statements) after you submit. You can see requests in your dashboard.", f: [
    T("loanAmount", "Requested loan amount (₹)", "number", { v: NUM(10000, 1e8, "Enter ₹10,000 to ₹10,00,00,000.") }),
    SEL("purpose", "Loan purpose", ["Personal", "Business", "Home", "Property", "Vehicle", "Education", "Medical", "Other"]),
    T("tenureMonths", "Requested repayment tenure (months)", "number", { v: NUM(3, 360, "Enter 3 to 360 months.") })] },
  { t: "Banking information", note: "We collect only what is needed to identify your account. Never share internet-banking passwords, card PINs or OTPs with anyone.", f: [
    T("bankName", "Bank name"), T("accountHolder", "Account holder name"),
    T("accountLast4", "Account number — last 4 digits", "text", { v: RE(/^\d{4}$/, "Enter exactly 4 digits.") }),
    T("ifsc", "IFSC code", "text", { v: RE(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC, e.g. SBIN0001234.") })] },
  { t: "Account security", f: [
    T("password", "Create password", "password", { v: v => v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v) ? "" : "Use at least 8 characters with letters and a number.", ac: "new-password" }),
    T("confirm", "Confirm password", "password", { v: (v, d) => v === d.password ? "" : "Passwords do not match.", ac: "new-password" }),
    T("privacy", "I accept the Privacy Policy and consent to my data being processed for this application.", "checkbox", { v: v => v ? "" : "Required." }),
    T("terms", "I accept the Terms and Conditions.", "checkbox", { v: v => v ? "" : "Required." }),
    T("declaration", "I declare that the information I have provided is true and accurate.", "checkbox", { v: v => v ? "" : "Required." })] },
  { t: "Review and submit", review: true, f: [] }
];
const data = {}; let i = 0, busy = false;
const ALL = STEPS.flatMap(s => s.f);

function fieldHtml(f) {
  const val = data[f.k] ?? "", id = "f_" + f.k, err = `<span class="err" role="alert"></span>`;
  if (f.t === "checkbox") return `<div class="field"><div class="consent"><input type="checkbox" id="${id}" data-k="${f.k}" ${val ? "checked" : ""}><label for="${id}">${f.l}</label></div>${err}</div>`;
  const ctl = f.t === "select" ? `<select id="${id}" data-k="${f.k}"><option value="">Select…</option>${f.o.map(o => `<option ${o === val ? "selected" : ""}>${o}</option>`).join("")}</select>`
    : f.t === "textarea" ? `<textarea id="${id}" data-k="${f.k}">${esc(val)}</textarea>`
    : `<input id="${id}" data-k="${f.k}" type="${f.t}" value="${f.t === "password" ? "" : esc(val)}" ${f.ph ? `placeholder="${f.ph}"` : ""} ${f.ac ? `autocomplete="${f.ac}"` : ""} ${f.t === "number" ? 'inputmode="decimal"' : ""}>`;
  return `<div class="field"><label for="${id}">${f.l}</label>${ctl}${err}</div>`;
}
function read() { host.querySelectorAll("[data-k]").forEach(e => { data[e.dataset.k] = e.type === "checkbox" ? e.checked : e.value.trim(); }); }
function validate() {
  read(); let ok = true;
  STEPS[i].f.forEach(f => {
    const el = host.querySelector(`[data-k="${f.k}"]`), v = data[f.k]; let m = "";
    if (f.req && (v === "" || v === undefined || v === false) && f.t !== "checkbox") m = "This field is required.";
    else if (f.v) m = f.v(v, data);
    const s = el.closest(".field").querySelector(".err"); s.textContent = m; el.setAttribute("aria-invalid", m ? "true" : "false"); if (m) ok = false;
  });
  return ok;
}
function review() {
  return `<dl class="review">${ALL.filter(f => !["password", "confirm", "checkbox"].includes(f.t) && data[f.k] !== "" && data[f.k] !== undefined).map(f => `<div><dt>${f.l.replace(/ \(.*\)/, "")}</dt><dd>${esc(["monthlyIncome", "loanAmount", "otherObligations"].includes(f.k) ? inr(data[f.k]) : data[f.k])}</dd></div>`).join("")}</dl>
  <p class="hint" style="margin-bottom:16px">Submitting this application does not guarantee loan approval. Approval, rate and fees are decided by the company after verification.</p>`;
}
function draw() {
  const s = STEPS[i];
  host.innerHTML = `<ol class="stepper" aria-label="Progress">${STEPS.map((x, n) => `<li class="${n === i ? "active" : n < i ? "done" : ""}" title="${x.t}">${n + 1}</li>`).join("")}</ol>
  <h2 style="font-size:1.5rem;margin-bottom:6px">${s.t}</h2><p class="hint" style="margin-bottom:18px">Step ${i + 1} of ${STEPS.length}</p>
  ${s.note ? `<div class="notice" style="margin-bottom:18px">${s.note}</div>` : ""}
  ${s.review ? review() : `<div class="row2">${s.f.map(fieldHtml).join("")}</div>`}
  <div class="nav-btns">${i ? '<button class="btn btn-ghost" data-nav="prev" type="button">Previous</button>' : "<span></span>"}
  ${s.review ? '<button class="btn btn-primary" id="submitReg" type="button">Submit and create account</button>' : '<button class="btn btn-primary" data-nav="next" type="button">Next</button>'}</div>`;
  host.scrollIntoView({ behavior: "smooth", block: "start" });
}
host.addEventListener("click", async e => {
  const b = e.target.closest("[data-nav]");
  if (b) { if (b.dataset.nav === "next") { if (validate()) { i++; draw(); } else (host.querySelector("[aria-invalid=true]") || {}).focus?.(); } else { read(); i--; draw(); } return; }
  if (e.target.id === "submitReg") submit(e.target);
});
async function submit(btn) {
  if (busy) return;
  if (!configured) { toast("Online registration is temporarily unavailable. Please contact us.", "error"); return; }
  busy = true; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Creating account…';
  let user = null;
  try {
    user = (await createUserWithEmailAndPassword(auth, data.email, data.password)).user;
    const payload = { ...data }; delete payload.password; delete payload.confirm;
    const res = (await httpsCallable(fns, "registerCustomer")(payload)).data;
    sendEmailVerification(user).catch(() => {});
    host.innerHTML = `<div class="success"><span class="ico" data-ico="check"></span><h2 style="font-size:1.8rem">Registration complete</h2>
      <p style="margin:10px 0">Your Customer ID</p><div class="big" style="margin-bottom:14px">${esc(res.customerId)}</div>
      <p style="max-width:46ch;margin:0 auto 20px">Your application ${esc(res.applicationId || "")} has been submitted for review. This is not a loan approval. We have sent a verification link to your email.</p>
      <a class="btn btn-primary" href="dashboard.html">Go to my dashboard</a></div>`;
    host.querySelector("[data-ico]").innerHTML = window.ico("check");
  } catch (err) {
    console.error(err);
    if (user) { try { await user.delete(); } catch (_) {} }   // avoid half-created accounts; the form data is still on screen
    busy = false; btn.disabled = false; btn.textContent = "Submit and create account";
    const code = err.code || "";
    toast(code === "auth/email-already-in-use" ? "This email is already registered. Please log in instead." : code === "auth/weak-password" ? "Please choose a stronger password." : (err.message || "Registration failed. Please try again."), "error");
  }
}
const toast = (m, t) => window.toast(m, t);
draw();
