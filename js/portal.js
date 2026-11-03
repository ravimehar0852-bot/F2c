/* Customer login + dashboard (shows ALL details the customer filled) */
import { auth, db, configured } from "./firebase-config.js";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getDocs, updateDoc, query, where, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc, inr, dt, ms } from "./util.js";
const page = document.body.dataset.page, toast = (m, t) => window.toast(m, t);

if (page === "login") {
  const f = document.getElementById("loginForm");
  if (!configured) document.querySelector("[data-fb-notice]").hidden = false;
  f.addEventListener("submit", async e => {
    e.preventDefault(); const b = f.querySelector("button[type=submit]");
    if (!configured) return toast("Login is temporarily unavailable.", "error");
    b.disabled = true; b.innerHTML = '<span class="spin"></span> Signing in…';
    try { await signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value); location.href = "dashboard.html"; }
    catch (err) { toast(["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(err.code) ? "Incorrect email or password." : err.code === "auth/too-many-requests" ? "Too many attempts. Please wait and try again." : "Could not sign in. Check your connection.", "error"); b.disabled = false; b.textContent = "Log in"; }
  });
  document.getElementById("forgot").addEventListener("click", async () => {
    const em = f.email.value.trim(); if (!em) return toast("Enter your email first, then press Forgot password.", "error");
    try { await sendPasswordResetEmail(auth, em); } catch (_) {}
    toast("If this email is registered, a reset link has been sent.", "ok");
  });
}

if (page === "dashboard") {
  const host = document.getElementById("dash");
  if (!configured) host.innerHTML = '<div class="notice err">The customer portal is temporarily unavailable.</div>';
  else onAuthStateChanged(auth, async u => { if (!u) return location.replace("login.html"); try { await render(u); } catch (e) { console.error(e); host.innerHTML = '<div class="notice err">Could not load your dashboard. Please refresh or contact support.</div>'; } });

  const chip = s => `<span class="chip s-${esc(String(s || "none").toLowerCase().replace(/[^a-z]+/g, "-"))}">${esc(s || "—")}</span>`;
  const kv = rows => `<dl class="review">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v === "" || v == null ? "—" : v}</dd></div>`).join("")}</dl>`;
  const get = async (col, uid, extra) => (await getDocs(query(collection(db, col), where("uid", "==", uid), ...extra))).docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const maskA = a => a ? "XXXX XXXX " + String(a).slice(-4) : "";
  const maskB = a => a ? "X".repeat(Math.max(0, String(a).length - 4)) + String(a).slice(-4) : (a === 0 ? "" : "");

  async function render(u) {
    const cs = await getDoc(doc(db, "customers", u.uid));
    if (!cs.exists()) { host.innerHTML = '<div class="notice err">Your registration is not complete. Please <a href="register.html"><b>register again</b></a> with the same email, or contact support.</div><p style="margin-top:16px"><button class="btn btn-ghost" id="lo">Logout</button></p>'; document.getElementById("lo").onclick = () => signOut(auth).then(() => location.href = "index.html"); return; }
    const c = cs.data(), name = c.name || c.fullName || "", phone = c.phone || c.mobile || "";
    const [apps, agr, rt, comp] = await Promise.all([get("applications", u.uid, []), get("agreements", u.uid, [where("visibleToCustomer", "==", true)]), get("rtgsRecords", u.uid, [where("visibleToCustomer", "==", true)]), get("complianceReviews", u.uid, [where("visibleToCustomer", "==", true)])]);
    const notes = (await getDocs(collection(db, "customers", u.uid, "notifications"))).docs.map(d => d.data()).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
    host.innerHTML = `
    <div class="bar-row"><div><h1 style="font-size:clamp(1.8rem,4vw,2.6rem)">Welcome, ${esc(name.split(" ")[0])}</h1><p>Customer ID: <b>${esc(c.customerId)}</b>${apps[0] ? ` · Application ID: <b>${esc(apps[0].applicationId)}</b>` : ""}</p></div><span class="sp"></span><button class="btn btn-ghost btn-sm" id="lo">Logout</button></div>
    ${u.emailVerified ? "" : '<div class="notice" style="margin:16px 0">Your email address is not verified yet.</div>'}
    <div class="grid g2" style="margin-top:24px">
      <div class="card"><h3>Account &amp; personal details</h3>${kv([["Customer ID", esc(c.customerId)], ["Name", esc(name)], ["Mobile", esc(phone)], ["Email", esc(c.email)], ["Date of birth", esc(c.dob)], ["Aadhaar", maskA(c.aadhaar) || (c.aadhaarLast4 ? "XXXX XXXX " + esc(c.aadhaarLast4) : "")], ["PAN", esc(c.pan)], ["City", esc(c.city)], ["State", esc(c.state)], ["PIN code", esc(c.pincode)]])}</div>
      <div class="card"><h3>Employment and income</h3>${kv([["Occupation", esc(c.empType || c.employmentType)], ["Employer / business", esc(c.employer || c.employerName)], ["Monthly income", inr(c.monthlyIncome)], ["Years in current work", esc(c.workYears)], ["Other running loans", esc(c.hasOtherLoans)]])}</div>
      <div class="card"><h3>Documents &amp; bank</h3>${kv([["Identity verification", chip(c.identityStatus)], ["Address verification", chip(c.addressStatus)], ["Documents", chip(c.docsStatus)], ["Bank name", esc(c.bankName)], ["Account number", maskB(c.accountNumber) ? esc(maskB(c.accountNumber)) : (c.accountLast4 ? "XXXX" + esc(c.accountLast4) : "")], ["IFSC", esc(c.ifsc)]])}</div>
      <div class="card"><h3>Reference</h3>${kv([["Name", esc(c.refName)], ["Mobile", esc(c.refPhone)], ["Relationship", esc(c.refRelation)]])}
        <h3 style="margin-top:18px">Update location</h3><form id="addrForm" novalidate><div class="row2"><div class="field"><label for="uc">City</label><input id="uc" value="${esc(c.city)}"></div><div class="field"><label for="us">State</label><input id="us" value="${esc(c.state)}"></div></div><div class="field"><label for="up">PIN code</label><input id="up" value="${esc(c.pincode)}" maxlength="6" inputmode="numeric"></div><p class="hint" style="margin-bottom:12px">Verified details (name, mobile, PAN, Aadhaar, bank) can be changed only after re-verification. Please contact support.</p><button class="btn btn-primary btn-sm" type="submit">Save</button></form></div>
      <div class="card"><h3>Messages from our team</h3>${notes.length ? notes.map(n => `<p style="margin-bottom:12px"><b>${esc(n.title)}</b><br>${esc(n.body)}<br><small>${dt(n.createdAt)}</small></p>`).join("") : "<p>No messages yet.</p>"}</div>
    </div>
    <h2 style="font-size:1.6rem;margin:40px 0 16px">My applications</h2>
    ${apps.length ? apps.map(a => { const t = a.termsVisible && a.terms; return `<div class="card" style="margin-bottom:16px"><div class="bar-row"><h3 style="margin:0">${esc(a.applicationId)}</h3><span class="sp"></span>${chip(a.status)}</div>
      ${kv([["Loan type", esc(a.loanType || a.purpose)], ["Requested amount", inr(a.loanAmount)], ["Requested tenure", esc(a.tenureMonths) + " months"], ["Estimated EMI" + (a.emiRate ? " (" + esc(a.emiRate) + "% p.a., indicative)" : ""), a.estimatedEmi ? inr(a.estimatedEmi) + " / month" : ""], ["Submitted", dt(a.createdAt)]])}
      ${a.missingDocs?.length ? `<div class="notice" style="margin:12px 0"><b>Documents requested:</b> ${a.missingDocs.map(esc).join(", ")}</div>` : ""}
      ${t ? `<h4 style="margin:14px 0 8px">Proposed terms</h4>${kv([["Interest rate (per year)", esc(t.interestRatePct) + "%"], ["Processing fee", esc(t.processingFeePct) + "%"], ["Other charges", esc(t.otherCharges || "None stated")], ["Tenure", esc(t.tenureMonths) + " months"], ["Estimated EMI", inr(t.estimatedEmi)]])}<p class="hint">These terms are proposed by the company and are not binding until set out in a written agreement.</p>` : ""}
      <details style="margin-top:12px"><summary>Status history</summary><p>${(a.statusHistory || []).map(h => `${chip(h.status)} <small>${dt(h.at)}</small>`).join("<br>")}</p></details></div>`; }).join("") : "<p>No applications yet.</p>"}
    <div class="grid g2" style="margin-top:28px">
      <div class="card"><h3>Agreements</h3>${agr.length ? agr.map(a => `<p><b>${esc(a.ref)}</b> ${chip(a.status)}<br>${inr(a.loanAmount)} · ${esc(a.interestRatePct)}% · ${esc(a.tenureMonths)} months</p>`).join("") : "<p>No agreements shared with you yet.</p>"}</div>
      <div class="card"><h3>Transactions</h3>${rt.length ? rt.map(a => `<p><b>${esc(a.transferType)}</b> ${inr(a.amount)} ${chip(a.status)}<br><small>${esc(a.transactionDate)} ${a.status !== "Verified" ? "· awaiting verification" : ""}</small></p>`).join("") : "<p>No transactions to show.</p>"}</div>
      ${comp.length ? `<div class="card"><h3>Review status</h3>${comp.map(a => `<p>${chip(a.status)}<br>${esc(a.customerMessage || "")}</p>`).join("")}</div>` : ""}
    </div>`;
    document.getElementById("lo").onclick = () => signOut(auth).then(() => location.href = "index.html");
    document.getElementById("addrForm").addEventListener("submit", async e => {
      e.preventDefault(); const city = document.getElementById("uc").value.trim(), state = document.getElementById("us").value.trim(), pin = document.getElementById("up").value.trim();
      if (!city || !state || !/^\d{6}$/.test(pin)) return toast("Enter city, state and a 6-digit PIN code.", "error");
      const a = `${city}, ${state} - ${pin}`;
      try { await updateDoc(doc(db, "customers", u.uid), { city, state, pincode: pin, addressCurrent: a, addressPermanent: a, updatedAt: serverTimestamp() }); toast("Updated.", "ok"); } catch (err) { toast("Could not update.", "error"); }
    });
  }
}
