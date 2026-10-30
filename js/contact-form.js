/* Contact form: validation, Firestore save, WhatsApp enquiry */
(function () {
  const f = document.getElementById("contactForm"); if (!f) return;
  const el = n => f.elements[n], val = n => el(n).value.trim(); let busy = false;
  const rules = {
    name: v => v.length >= 2 ? "" : "Enter your full name.",
    mobile: v => V.mobile(v) ? "" : "Enter a valid 10-digit Indian mobile number.",
    email: v => V.email(v) ? "" : "Enter a valid email address.",
    message: v => v.length >= 10 ? "" : "Write at least 10 characters so we can help you."
  };
  const validate = () => { const r = Object.keys(rules).map(n => V.err(el(n), rules[n](val(n)))); const c = el("consent").checked; V.err(el("consent"), c ? "" : "Please accept the privacy consent."); return r.every(Boolean) && c; };
  Object.keys(rules).forEach(n => el(n).addEventListener("blur", () => V.err(el(n), rules[n](val(n)))));
  const text = () => `Hello, I am ${val("name")}. I would like to know more about ${el("type").selectedOptions[0].text.toLowerCase()}.\n${val("message")}\nMobile: ${val("mobile")}`;
  document.getElementById("waSend").addEventListener("click", () => { if (validate()) V.wa(text()); });
  f.addEventListener("submit", async e => {
    e.preventDefault(); if (busy || el("website").value) return;
    if (!validate()) { (f.querySelector("[aria-invalid=true]") || {}).focus?.(); return; }
    if (!(window.firebaseStore && window.firebaseStore.configured)) { toast("Online enquiry submission is temporarily unavailable. Please call or use WhatsApp.", "error"); return; }
    busy = true; const b = document.getElementById("sendBtn"); b.disabled = true; b.innerHTML = '<span class="spin"></span> Sending…';
    try {
      await window.firebaseStore.save("contactMessages", { name: val("name"), mobile: V.mobile(val("mobile")), email: val("email"), loanType: val("type"), message: val("message"), consent: true, source: "contact-form" });
      f.reset(); toast("Thank you. Your message has been sent and our team will get back to you.", "ok");
    } catch (err) { console.error(err); toast("Your message could not be sent. Please try again or contact us directly.", "error"); }
    finally { busy = false; b.disabled = false; b.textContent = "Send message"; }
  });
})();
