/* Firebase client setup (single place for config). Web config values are NOT secrets — security comes from firestore.rules.
   Paste values from Firebase Console → Project settings → Your apps → Web app. Never put Admin SDK keys here. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBPHfkF58GQaJDMJBU62L83uMZTVl5MuwI",
  authDomain: "f2c-finance.firebaseapp.com",
  projectId: "f2c-finance",
  storageBucket: "f2c-finance.firebasestorage.app",
  messagingSenderId: "129473064237",
  appId: "1:129473064237:web:003ecce53a81d87d9277a4",
  measurementId: "G-ME884D6SXE"
};
export const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
export const app = configured ? initializeApp(firebaseConfig) : null;
export const db = app ? getFirestore(app) : null;
export const auth = app ? getAuth(app) : null;
export const fns = app ? getFunctions(app, "asia-south1") : null; // must match REGION in functions/index.js

window.firebaseStore = {
  configured,
  async save(name, data) { if (!db) throw new Error("Firebase is not configured"); return addDoc(collection(db, name), { ...data, createdAt: serverTimestamp() }); }
};

/* Public loan terms (set by Admin → Approval → "Loan terms & fees"). Shown wherever <div data-terms> exists. */
const box = document.querySelectorAll("[data-terms]");
if (box.length) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const draw = t => box.forEach(b => {
    b.innerHTML = t ? `<div class="tbl-wrap"><table><tbody>
      <tr><th>Interest rate (per year)</th><td>${t.interestMin != null ? esc(t.interestMin) + "% – " + esc(t.interestMax) + "%" : "Set per applicant"}</td></tr>
      <tr><th>Processing fee</th><td>${t.processingFeePct != null ? esc(t.processingFeePct) + "% of loan amount (plus applicable taxes)" : "Disclosed before you accept"}</td></tr>
      <tr><th>Other charges</th><td>${esc(t.otherCharges || "Disclosed before you accept")}</td></tr>
      <tr><th>Repayment tenures</th><td>${esc(t.tenures || "Confirmed in your offer")}</td></tr></tbody></table></div>
      <p class="hint" style="margin-top:10px">${esc(t.note || "Final rate, fees and tenure are decided for each applicant and shown in your written terms and Key Facts Statement before you are bound. Submitting an application does not guarantee approval.")}</p>`
      : `<div class="notice">Current interest rates and fees will be published here by the company. Final terms are shown to each applicant before they accept. Submitting an application does not guarantee approval.</div>`;
  });
  if (db) getDoc(doc(db, "settings", "loanTerms")).then(s => draw(s.exists() ? s.data() : null)).catch(() => draw(null)); else draw(null);
}
