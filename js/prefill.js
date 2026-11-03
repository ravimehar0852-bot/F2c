/* Eligibility page helper (does not change the enquiry form itself):
   - adds a box where the customer types the exact monthly salary / income; the income RANGE below it is selected automatically
   - if the customer is logged in, name, mobile, email, city, employment and salary are filled from their own profile
   - remembers what was typed (this browser tab only) so the Register & apply page starts with the same salary, loan type and amount */
import { auth, db, configured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("enquiryForm"), sel = document.getElementById("income");
if (form && sel) {
  const $ = id => document.getElementById(id), S = window.SITE || {};
  const bucket = n => n < 25000 ? "below-25k" : n <= 50000 ? "25k-50k" : n <= 100000 ? "50k-1l" : n <= 200000 ? "1l-2l" : "above-2l";
  const EMP = { salaried: "Salaried", "self-employed": "Self-employed", business: "Business owner", other: "Other" };
  const EMP_BACK = { Salaried: "salaried", "Self-employed": "self-employed", Professional: "self-employed", "Business owner": "business", Other: "other" };

  const row = sel.closest(".row2") || sel.closest(".field"), box = document.createElement("div");
  box.className = "field";
  box.innerHTML = `<label for="salary">Your exact monthly salary / income (₹)</label><input id="salary" type="number" inputmode="numeric" min="0" step="1" placeholder="e.g. 45000"><span class="hint">Type your monthly income. The income range below is selected for you.</span>`;
  row.parentNode.insertBefore(box, row.nextSibling);
  const salary = $("salary");

  const save = () => {
    try {
      const n = Number(salary.value), v = id => ($(id) ? $(id).value.trim() : ""), t = (S.services || []).find(s => s.id === v("type"));
      sessionStorage.setItem("f2c_prefill", JSON.stringify({ name: v("name"), mobile: v("mobile"), email: v("email"), city: v("city"), empType: EMP[v("employment")] || "", monthlyIncome: n > 0 ? n : "", loanType: t ? t.name : "", amount: Number(v("amount")) > 0 ? Number(v("amount")) : "" }));
    } catch { /* storage not available */ }
  };
  const sync = () => { const n = Number(salary.value); if (n > 0) { sel.value = bucket(n); sel.dispatchEvent(new Event("change", { bubbles: true })); } };
  salary.addEventListener("input", () => { sync(); save(); });
  form.addEventListener("input", save); form.addEventListener("change", save);

  const setIfEmpty = (id, v) => { const el = $(id); if (el && v !== undefined && v !== null && v !== "" && !el.value) { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); } };
  if (configured && auth) onAuthStateChanged(auth, async u => {
    if (!u) return;
    try {
      const s = await getDoc(doc(db, "customers", u.uid)); if (!s.exists()) return; const c = s.data();
      setIfEmpty("name", c.name || c.fullName); setIfEmpty("mobile", c.phone || c.mobile); setIfEmpty("email", c.email); setIfEmpty("city", c.city);
      setIfEmpty("employment", EMP_BACK[c.empType || c.employmentType]);
      if (c.monthlyIncome > 0 && !salary.value) { salary.value = c.monthlyIncome; sync(); save(); }
    } catch { /* profile not readable: the customer can type the values */ }
  });
  const p = (() => { try { return JSON.parse(sessionStorage.getItem("f2c_prefill") || "{}"); } catch { return {}; } })();   // coming back to this page in the same tab
  if (p.monthlyIncome > 0 && !salary.value) { salary.value = p.monthlyIncome; sync(); }
}
