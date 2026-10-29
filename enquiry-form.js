/* Multi-step loan enquiry: validation, review, duplicate prevention, Firestore save */
(function () {
  const f = document.getElementById("enquiryForm"); if (!f) return;
  const S = window.SITE, $ = s => f.querySelector(s), steps = [...f.querySelectorAll(".step")], dots = [...document.querySelectorAll(".stepper li")];
  let i = 0, busy = false;
  const el = n => f.elements[n], val = n => el(n).value.trim();
  const rules = {
    name: v => v.length >= 2 && /^[A-Za-z .'-]+$/.test(v) ? "" : "Enter your full name using letters only.",
    mobile: v => V.mobile(v) ? "" : "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.",
    email: v => V.email(v) ? "" : "Enter a valid email address, e.g. name@example.com.",
    type: v => v ? "" : "Select a loan type.",
    amount: v => { const n = Number(v); return !v ? "Enter the loan amount you need." : isNaN(n) || n < S.amountMin || n > S.amountMax ? `Enter an amount between ${V.inr(S.amountMin)} and ${V.inr(S.amountMax)}.` : ""; },
    employment: v => v ? "" : "Select your employment type.",
    income: v => v ? "" : "Select your monthly income range.",
    city: v => v.length >= 2 ? "" : "Enter your city."
  };
  const stepFields = [["name", "mobile", "email"], ["type", "amount", "employment", "income", "city"], []];
  const check = n => V.err(el(n), rules[n](val(n)));
  const checkStep = k => stepFields[k].map(check).every(Boolean);
  Object.keys(rules).forEach(n => el(n).addEventListener("blur", () => check(n)));

  function show(k) {
    i = k; steps.forEach((s, x) => s.classList.toggle("active", x === k));
    dots.forEach((d, x) => { d.classList.toggle("active", x === k); d.classList.toggle("done", x < k); x === k ? d.setAttribute("aria-current", "step") : d.removeAttribute("aria-current"); });
    if (k === 2) review();
    f.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function review() {
    const label = { name: "Full name", mobile: "Mobile", email: "Email", type: "Loan type", amount: "Loan amount", employment: "Employment", income: "Monthly income", city: "City" };
    $("#review").innerHTML = Object.keys(label).map(n => {
      let v = val(n); if (n === "amount") v = V.inr(v); if (n === "type") v = el(n).selectedOptions[0].text;
      const d = document.createElement("div"), a = document.createElement("dt"), b = document.createElement("dd");
      a.textContent = label[n]; b.textContent = v; d.append(a, b); return d.outerHTML;
    }).join("");
  }
  f.addEventListener("click", e => {
    const b = e.target.closest("[data-nav]"); if (!b) return;
    if (b.dataset.nav === "next") { if (checkStep(i)) show(i + 1); else (f.querySelector("[aria-invalid=true]") || {}).focus?.(); }
    else show(b.dataset.nav === "edit" ? 0 : i - 1);
  });
  const q = new URLSearchParams(location.search).get("type"); if (q && [...el("type").options].some(o => o.value === q)) el("type").value = q;

  f.addEventListener("submit", async e => {
    e.preventDefault(); if (busy) return;
    if (el("website").value) return; /* honeypot: bots only */
    if (![0, 1].every(checkStep)) { show(!checkStep(0) ? 0 : 1); return; }
    if (!el("consent").checked) { V.err(el("consent"), "Please tick the consent box to submit your enquiry."); return; } V.err(el("consent"), "");
    const data = { name: val("name"), mobile: V.mobile(val("mobile")), email: val("email"), loanType: val("type"), amount: Number(val("amount")), employment: val("employment"), income: val("income"), city: val("city"), consent: true, source: "eligibility-form" };
    const sig = JSON.stringify(data), last = JSON.parse(sessionStorage.getItem("enqLast") || "null");
    if (last && last.sig === sig && Date.now() - last.t < 600000) { toast("This enquiry was already submitted. Our team will contact you.", "error"); return; }
    if (!(window.firebaseStore && window.firebaseStore.configured)) { toast("Online enquiry submission is temporarily unavailable. Please call or message us on WhatsApp.", "error"); return; }
    busy = true; const btn = $("#submitBtn"); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Submitting…';
    try {
      await window.firebaseStore.save("enquiries", data);
      sessionStorage.setItem("enqLast", JSON.stringify({ sig, t: Date.now() }));
      f.hidden = true; document.querySelector(".stepper").hidden = true; document.getElementById("successBox").hidden = false; document.getElementById("successBox").focus();
    } catch (err) {
      console.error(err); toast("We could not submit your enquiry. Check your connection and try again, or contact us directly.", "error");
    } finally { busy = false; btn.disabled = false; btn.textContent = "Submit enquiry"; }
  });
  document.getElementById("again")?.addEventListener("click", () => { f.reset(); f.hidden = false; document.querySelector(".stepper").hidden = false; document.getElementById("successBox").hidden = true; show(0); });
})();
