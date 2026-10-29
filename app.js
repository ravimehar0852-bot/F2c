/* Shared behaviour: config binding, nav, modals, services, helpers */
(function () {
  window.SITE_READY = true;
  const S = window.SITE || { services: [], groups: {} }, $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const P = {
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    briefcase:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 13h18"/>',
    home:'<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-6h6v6"/>',
    building:'<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4"/>',
    car:'<path d="M5 16v-5l2-5h10l2 5v5M3 16h18v3H3z"/><circle cx="7.5" cy="16" r="1"/><circle cx="16.5" cy="16" r="1"/>',
    cap:'<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>',
    shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    chat:'<path d="M4 5h16v11H9l-5 4z"/>',lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    doc:'<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7"/>',phone:'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',pin:'<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',calc:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M8 16h2M12 16h2"/>',
    users:'<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6M17 5a3.5 3.5 0 0 1 0 6M22 20c0-3-1.5-5-4-5.7"/>',
    check:'<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',list:'<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'
  };
  window.ico = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${P[n] || ""}</svg>`;
  $$("[data-ico]").forEach(e => { e.classList.add("ico"); e.innerHTML = ico(e.dataset.ico); });

  /* helpers */
  window.V = {
    mobile: v => { const d = v.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, ""); return /^[6-9]\d{9}$/.test(d) ? d : null; },
    email: v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()),
    err(el, msg) { const s = el.closest(".field").querySelector(".err"); if (s) s.textContent = msg || ""; el.setAttribute("aria-invalid", msg ? "true" : "false"); return !msg; },
    inr: n => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n),
    wa(text) {
      if (!S.whatsapp) { toast("WhatsApp number is not set up yet. Please use the contact form instead.", "error"); return; }
      window.open(`https://wa.me/${S.whatsapp}?text=${encodeURIComponent(text || S.waMessage)}`, "_blank", "noopener");
    }
  };
  window.toast = (msg, type = "") => {
    const t = document.createElement("div"); t.className = "t " + type; t.textContent = msg; $("#toast").append(t); setTimeout(() => t.remove(), 4800);
  };

  /* bind config to page */
  $$("[data-site]").forEach(e => { const v = S[e.dataset.site]; if (v) e.textContent = v; });
  $$("[data-link]").forEach(e => {
    const k = e.dataset.link;
    if (k === "tel" && S.phone) e.href = "tel:+" + S.phone.replace(/\D/g, "");
    else if (k === "mail" && S.email) e.href = "mailto:" + S.email;
    else if (k === "wa") e.addEventListener("click", ev => { ev.preventDefault(); V.wa(); });
  });
  if (S.name) { document.title = document.title.replace("[Company Name]", S.name); $$("[data-site=name]").forEach(e => e.textContent = S.name); }
  $$("[data-year]").forEach(e => e.textContent = new Date().getFullYear());

  /* navigation */
  const burger = $(".burger"), nav = $("#nav");
  if (!window.MENU_BOUND) {
  burger.addEventListener("click", () => { const o = nav.classList.toggle("open"); burger.setAttribute("aria-expanded", o); });
  nav.addEventListener("click", e => { if (e.target.closest("a")) { nav.classList.remove("open"); burger.setAttribute("aria-expanded", false); } });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { nav.classList.remove("open"); burger.setAttribute("aria-expanded", false); } });
  }

  /* scroll UI */
  const hdr = $(".site-header"), top = $(".totop");
  const onScroll = () => { hdr.classList.toggle("scrolled", scrollY > 8); top.classList.toggle("show", scrollY > 600); };
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
  top.addEventListener("click", () => scrollTo({ top: 0 }));

  /* modals (privacy / terms) */
  const dlg = $("#modal"), LEGAL = {
    privacy: ["Privacy Policy", "We collect only the details you enter in our forms (such as name, mobile number, email, loan requirement and city) so that our team can respond to your enquiry. We do not ask for bank passwords, card PINs, UPI PINs or OTPs, and you should never share them. Your details are not sold. They may be shared with a lender or partner only to process your enquiry and only with your consent. You may ask us to correct or delete your details by contacting us. [Replace this text with the policy approved by the business owner.]"],
    grievance: ["Grievance Redressal", `If you are not satisfied with our service, please write to our Grievance Officer: ${S.grievanceOfficer || "[Grievance Officer name]"}, ${S.grievanceContact || "[email / phone]"}. We will acknowledge and respond to your complaint within the timelines in our grievance policy [add timelines approved by the company]. If your complaint is not resolved, you may escalate it as per applicable regulatory guidelines [add escalation details].`],
    terms: ["Terms and Conditions", "The information on this website is general and is not a loan offer, commitment or guarantee of approval. Loan availability, eligibility, interest rates, fees and terms depend on the lender and on each applicant's profile and documents. EMI figures from the calculator are estimates only. Submitting an enquiry does not create a loan agreement. [Replace this text with the terms approved by the business owner.]"]
  };
  $$("[data-modal]").forEach(b => b.addEventListener("click", () => {
    const [t, p] = LEGAL[b.dataset.modal]; $("#modalTitle").textContent = t; $("#modalBody").textContent = p; dlg.showModal();
  }));
  dlg.addEventListener("click", e => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });

  /* services rendering (Home overview + Services page) */
  const grid = $("#serviceGrid"), home = $("#homeServices");
  const list = s => `<ul class="checks">${s.map(x => `<li>${x}</li>`).join("")}</ul>`;
  if (home) home.innerHTML = S.services.map(s => `<article class="card rv"><span data-ico="${s.icon}" class="ico">${ico(s.icon)}</span><h3>${s.name}</h3><p>${s.desc}</p><p class="btns" style="margin-top:16px"><a class="btn btn-ghost btn-sm" href="services.html#${s.id}">Learn more</a><a class="btn btn-primary btn-sm" href="eligibility.html?type=${s.id}">Enquire now</a></p></article>`).join("");
  if (grid) {
    grid.innerHTML = S.services.map(s => `<article class="card svc rv" id="${s.id}" data-cat="${s.group}"><span class="ico">${ico(s.icon)}</span><h3>${s.name}</h3><p>${s.desc}</p><p class="uses"><b>Typical uses:</b> ${s.uses.join(", ")}</p>
      <div class="more" id="m-${s.id}"><h4>General eligibility</h4><p>${s.elig}</p><h4>Commonly requested documents</h4>${list(s.docs)}<p class="hint">Actual requirements depend on the lender and applicant.</p></div>
      <div class="acts"><button class="btn btn-ghost btn-sm" aria-expanded="false" aria-controls="m-${s.id}" data-more>Learn more</button><a class="btn btn-primary btn-sm" href="eligibility.html?type=${s.id}">Enquire now</a></div></article>`).join("");
    grid.addEventListener("click", e => { const b = e.target.closest("[data-more]"); if (!b) return; const c = b.closest(".svc"), o = c.classList.toggle("open"); b.setAttribute("aria-expanded", o); b.textContent = o ? "Show less" : "Learn more"; });
    const bar = $("#filters");
    bar.innerHTML = Object.entries(S.groups).map(([k, v], i) => `<button type="button" data-f="${k}" aria-pressed="${i === 0}">${v}</button>`).join("");
    bar.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      $$("button", bar).forEach(x => x.setAttribute("aria-pressed", x === b));
      $$(".svc", grid).forEach(c => c.hidden = b.dataset.f !== "all" && c.dataset.cat !== b.dataset.f);
    });
    const cmp = $("#compareBody"); if (cmp) cmp.innerHTML = S.services.map(s => `<tr><td><b>${s.name}</b></td><td>${s.uses.slice(0, 2).join(", ")}</td><td>${s.secured}</td><td><a href="eligibility.html?type=${s.id}">Enquire</a></td></tr>`).join("");
    if (location.hash) { const t = $(location.hash); if (t) { t.classList.add("open"); const b = $("[data-more]", t); if (b) { b.textContent = "Show less"; b.setAttribute("aria-expanded", true); } } }
  }
  const map = $("#mapBox"); if (map && S.mapEmbedUrl) { map.innerHTML = `<iframe src="${S.mapEmbedUrl}" title="Office location map" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`; }

  /* populate loan type selects */
  $$("select[data-loantypes]").forEach(sel => { sel.insertAdjacentHTML("beforeend", S.services.map(s => `<option value="${s.id}">${s.name}</option>`).join("") + '<option value="other">Other / not sure</option>'); });

  /* reveal on scroll */
  const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: .12 }) : null;
  $$(".rv").forEach(e => io ? io.observe(e) : e.classList.add("in"));

  /* firebase availability notice */
  addEventListener("load", () => { if (!(window.firebaseStore && window.firebaseStore.configured)) $$("[data-fb-notice]").forEach(e => e.hidden = false); });
})();
