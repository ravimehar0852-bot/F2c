/* Customer registration + loan application (7 steps). Creates Auth user, customers/<uid>, applications/<id>. */
import { auth, db, configured } from "./firebase-config.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, setDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc } from "./util.js";

const host = document.getElementById("regApp"), S = window.SITE || { services: [] };
const F = (k, l, t = "text", x = {}) => ({ k, l, t, ...x });
const loanTypes = (S.services || []).map(s => s.name).concat(["Other / not sure"]);
const STEPS = [
  { t: "Account", f: [F("name", "Full name", "text", { req: 1 }), F("phone", "Mobile number", "tel", { req: 1 }), F("email", "Email address", "email", { req: 1 }), F("password", "Create password (min 8 characters)", "password", { req: 1 }), F("password2", "Confirm password", "password", { req: 1 })] },
  { t: "Personal details", f: [F("dob", "Date of birth", "date", { req: 1 }), F("pan", "PAN", "text", { req: 1 }), F("address", "Address", "textarea", { req: 1 }), F("city", "City", "text", { req: 1 }), F("state", "State", "text", { req: 1 }), F("pincode", "PIN code", "text", { req: 1 })] },
  { t: "Employment & income", f: [F("empType", "Occupation type", "select", { req: 1, o: ["Salaried", "Self-employed", "Business owner", "Professional", "Other"] }), F("employer", "Employer / business name", "text", { req: 1 }), F("monthlyIncome", "Monthly income (Rs.)", "number", { req: 1 }), F("workYears", "Years in current work", "number")] },
  { t: "Loan requirement", f: [F("loanType", "Loan type", "select", { req: 1, o: loanTypes }), F("loanAmount", "Loan amount required (Rs.)", "number", { req: 1 }), F("tenureMonths", "Preferred tenure (months)", "number", { req: 1 }), F("purpose", "Purpose of loan", "textarea")] },
  { t: "Existing obligations", f: [F("hasOtherLoans", "Do you have other running loans?", "select", { req: 1, o: ["No", "Yes"] }), F("existingEmi", "Total monthly EMIs you pay now (Rs.)", "number")] },
  { t: "Reference", f: [F("refName", "Reference person name", "text", { req: 1 }), F("refPhone", "Reference mobile number", "tel", { req: 1 }), F("refRelation", "Relationship", "text")] },
  { t: "Review & consent", f: [] }
];
const st = {}; let i = 0, done = false;
const field = (f, v) => {
  const id = "r_" + f.k, val = v ?? "";
  const c = f.t === "select" ? `<select id="${id}" data-k="${f.k}"><option value="">Select…</option>${f.o.map(o => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>` : f.t === "textarea" ? `<textarea id="${id}" data-k="${f.k}">${esc(val)}</textarea>` : `<input id="${id}" data-k="${f.k}" type="${f.t}" value="${esc(val)}" ${f.t === "password" ? 'autocomplete="new-password"' : ""} ${f.t === "number" ? 'step="any" min="0" inputmode="decimal"' : ""}>`;
  return `<div class="field"><label for="${id}">${f.l}${f.req ? " *" : ""}</label>${c}</div>`;
};
function validate(step, d) {
  for (const f of step.f) if (f.req && (d[f.k] === "" || d[f.k] == null)) return f.l + " is required.";
  if (i === 0) { if (!window.V.email(d.email)) return "Enter a valid email address."; if (!window.V.mobile(d.phone)) return "Enter a valid 10-digit mobile number."; if (d.password.length < 8) return "Password must be at least 8 characters."; if (d.password !== d.password2) return "Passwords do not match."; }
  if (i === 1) { d.pan = d.pan.toUpperCase(); if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(d.pan)) return "Enter a valid PAN (e.g. ABCDE1234F)."; if (!/^\d{6}$/.test(d.pincode)) return "Enter a valid 6-digit PIN code."; const age = (Date.now() - new Date(d.dob)) / 31557600000; if (!(age >= 18)) return "You must be at least 18 years old."; }
  if (i === 3) { if (!(d.loanAmount > 0)) return "Enter a valid loan amount."; if (!(d.tenureMonths >= 1 && d.tenureMonths <= 360)) return "Tenure must be between 1 and 360 months."; }
  if (i === 5 && !window.V.mobile(d.refPhone)) return "Enter a valid reference mobile number.";
  return "";
}
const read = step => { const d = {}; step.f.forEach(f => { const e = host.querySelector(`[data-k="${f.k}"]`); if (e) d[f.k] = f.t === "number" ? (e.value === "" ? "" : Number(e.value)) : e.value.trim(); }); return d; };
function draw() {
  if (done) return;
  const s = STEPS[i], last = i === STEPS.length - 1;
  const review = last ? `<dl class="review">${[["Name", st.name], ["Mobile", st.phone], ["Email", st.email], ["City", st.city], ["Loan type", st.loanType], ["Amount", "Rs. " + Number(st.loanAmount).toLocaleString("en-IN")], ["Tenure", st.tenureMonths + " months"]].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    <div class="field"><div class="consent"><input type="checkbox" id="c1"><label for="c1">I confirm the details above are correct and I agree to the Privacy Policy and Terms.</label></div></div>
    <div class="field"><div class="consent"><input type="checkbox" id="c2"><label for="c2">I understand that submitting this application does not guarantee loan approval.</label></div></div>` : "";
  host.innerHTML = `<p class="hint">Step ${i + 1} of ${STEPS.length}</p><h2 style="margin-bottom:14px">${s.t}</h2><form id="rf" novalidate><div class="row2">${s.f.map(f => field(f, st[f.k])).join("")}</div>${review}<p class="err" id="rerr" role="alert"></p>
    <div class="btns" style="margin-top:14px">${i ? `<button type="button" class="btn btn-ghost" id="back">Back</button>` : ""}<button class="btn btn-primary" type="submit" id="next">${last ? "Submit application" : "Next"}</button></div></form>`;
  const f = host.querySelector("#rf"), err = host.querySelector("#rerr");
  host.querySelector("#back")?.addEventListener("click", () => { Object.assign(st, read(s)); i--; draw(); });
  f.addEventListener("submit", async e => {
    e.preventDefault(); err.textContent = "";
    const d = read(s), msg = validate(s, d); if (msg) { err.textContent = msg; return; }
    Object.assign(st, d);
    if (!last) { i++; draw(); window.scrollTo({ top: host.offsetTop - 80 }); return; }
    if (!host.querySelector("#c1").checked || !host.querySelector("#c2").checked) { err.textContent = "Please tick both confirmations."; return; }
    await submit(err, host.querySelector("#next"));
  });
}
const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
async function submit(err, btn) {
  btn.disabled = true; btn.textContent = "Submitting…";
  let cred;
  try { cred = await createUserWithEmailAndPassword(auth, st.email, st.password); }
  catch (x) { err.textContent = ({ "auth/email-already-in-use": "This email is already registered. Please log in.", "auth/weak-password": "Password is too weak.", "auth/invalid-email": "Enter a valid email address.", "auth/network-request-failed": "Network error. Check your internet.", "auth/operation-not-allowed": "Email/Password sign-in is not enabled in Firebase." }[x.code] || "Could not create account.") + " [" + x.code + "]"; btn.disabled = false; btn.textContent = "Submit application"; return; }
  const uid = cred.user.uid, customerId = "CID-" + String(new Date().getFullYear()).slice(2) + "-" + rid(6), applicationId = "APP-" + new Date().getFullYear() + "-" + rid(6);
  try {
    await setDoc(doc(db, "customers", uid), { uid, customerId, name: st.name, phone: window.V.mobile(st.phone), email: st.email, dob: st.dob, pan: st.pan, address: st.address, city: st.city, state: st.state, pincode: st.pincode, empType: st.empType, employer: st.employer, monthlyIncome: st.monthlyIncome, workYears: st.workYears ?? "", hasOtherLoans: st.hasOtherLoans, existingEmi: st.existingEmi ?? "", refName: st.refName, refPhone: st.refPhone, refRelation: st.refRelation || "", status: "Active", createdAt: serverTimestamp() });
    await addDoc(collection(db, "applications"), { uid, applicationId, customerId, customerName: st.name, loanType: st.loanType, loanAmount: st.loanAmount, tenureMonths: st.tenureMonths, purpose: st.purpose || "", status: "Submitted", statusHistory: [{ status: "Submitted", at: Date.now(), by: "customer", remarks: "" }], createdAt: serverTimestamp() });
  } catch (x) { console.error(x); err.textContent = "Your account was created but saving your details failed (" + (x.code || x.message) + "). Please contact us and mention your email."; btn.disabled = false; btn.textContent = "Submit application"; return; }
  done = true;
  host.innerHTML = `<h2>Application submitted</h2><p>Thank you, ${esc(st.name)}. Your account is ready.</p><div class="card" style="margin:16px 0"><small>Your Customer ID</small><h2>${esc(customerId)}</h2><small>Application ID: ${esc(applicationId)}</small></div><p>Please save your Customer ID. Submitting an application does not guarantee approval.</p><p class="btns" style="margin-top:14px"><a class="btn btn-primary" href="dashboard.html">Go to my dashboard</a></p>`;
}
if (!configured || !auth) host.innerHTML = `<p class="notice err">Registration is temporarily unavailable. Please call us or message us on WhatsApp.</p>`; else draw();
  
