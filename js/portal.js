/* Customer portal: login page + dashboard (profile, applications, notifications, documents). */
import { auth, db, configured } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDoc, getDocs, updateDoc, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc, inr, dt, ms, maskPan } from "./util.js";

const page = document.body.dataset.page;
const note = (host, msg, ok) => { let n = host.parentNode.querySelector(".js-msg"); if (!n) { n = document.createElement("p"); n.className = "js-msg notice"; n.setAttribute("role", "alert"); n.style.marginBottom = "14px"; host.parentNode.insertBefore(n, host); } n.classList.toggle("err", !ok); n.textContent = msg; n.hidden = !msg; };
const chip = s => `<span class="chip s-${esc(String(s || "none").toLowerCase().replace(/[^a-z]+/g, "-"))}">${esc(s || "—")}</span>`;
const kv = rows => `<dl class="review">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v || "—"}</dd></div>`).join("")}</dl>`;
const authMsg = c => ({ "auth/invalid-credential": "Wrong email or password.", "auth/wrong-password": "Wrong email or password.", "auth/user-not-found": "No account found with this email.", "auth/invalid-email": "Enter a valid email address.", "auth/too-many-requests": "Too many attempts. Please try again later.", "auth/network-request-failed": "Network error. Check your internet.", "auth/unauthorized-domain": "This website domain is not authorised in Firebase.", "auth/operation-not-allowed": "Email/Password sign-in is not enabled in Firebase." }[c] || "Something went wrong.") + (c ? " [" + c + "]" : "");

/* ---------------- LOGIN ---------------- */
function loginPage() {
  const f = document.getElementById("loginForm"); if (!f) return;
  if (!configured || !auth) { note(f, "Login is temporarily unavailable. Please call us or message us on WhatsApp."); return; }
  onAuthStateChanged(auth, u => { if (u) location.replace("dashboard.html"); });
  f.addEventListener("submit", async e => {
    e.preventDefault(); note(f, "");
    const email = f.email.value.trim(), pw = f.password.value, btn = f.querySelector("button[type=submit]");
    if (!email || !pw) return note(f, "Enter your email and password.");
    btn.disabled = true; btn.textContent = "Logging in…";
    try { await signInWithEmailAndPassword(auth, email, pw); location.replace("dashboard.html"); }
    catch (x) { note(f, authMsg(x.code)); btn.disabled = false; btn.textContent = "Log in"; }
  });
  document.getElementById("forgot")?.addEventListener("click", async () => {
    const email = f.email.value.trim();
    if (!email) return note(f, "Type your email above first, then tap Forgot password.");
    try { await sendPasswordResetEmail(auth, email); } catch (x) { if (x.code === "auth/invalid-email") return note(f, authMsg(x.code)); }
    note(f, "If an account exists for this email, a password reset link has been sent.", true);
  });
}

/* ---------------- DASHBOARD ---------------- */
const safe = async p => { try { return await p; } catch (e) { console.warn(e); return []; } };
async function dashboard() {
  const host = document.getElementById("dash"); if (!host) return;
  if (!configured || !auth) { host.innerHTML = `<p class="notice err">Dashboard is temporarily unavailable. Please call us or message us on WhatsApp.</p>`; return; }
  onAuthStateChanged(auth, async u => {
    if (!u) return location.replace("login.html");
    try {
      const cs = await getDoc(doc(db, "customers", u.uid));
      if (!cs.exists()) { host.innerHTML = `<p class="notice err">No customer profile found for ${esc(u.email)}. If you just registered, please contact us. <button class="btn btn-ghost btn-sm" id="so">Log out</button></p>`; host.querySelector("#so").onclick = out; return; }
      const c = { id: cs.id, ...cs.data() };
      const q = (col, ...x) => safe(getDocs(query(collection(db, col), where("uid", "==", u.uid), ...x)).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))));
      const [apps, agr, trf, cmp, nts] = await Promise.all([
        q("applications"), q("agreements", where("visibleToCustomer", "==", true)), q("rtgsRecords", where("visibleToCustomer", "==", true)), q("complianceReviews", where("visibleToCustomer", "==", true)),
        safe(getDocs(query(collection(db, "customers", u.uid, "notifications"), orderBy("createdAt", "desc"), limit(20))).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))))
      ]);
      const by = (a, b) => ms(b.createdAt) - ms(a.createdAt); apps.sort(by);
      const rs = n => "Rs. " + Number(n || 0).toLocaleString("en-IN");
      host.innerHTML = `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:18px"><h1 style="font-size:clamp(1.6rem,4vw,2.4rem)">Welcome, ${esc(c.name || c.fullName || "customer")}</h1><button class="btn btn-ghost btn-sm" id="so">Log out</button></div>
      <div class="grid g2"><div class="card"><small>Your Customer ID</small><h2 style="margin:6px 0 14px">${esc(c.customerId)}</h2>${kv([["Email", esc(c.email || u.email)], ["Mobile", esc(c.phone || c.mobile)], ["PAN", esc(c.pan ? maskPan(c.pan) : "")], ["City", esc(c.city)], ["Registered", esc(dt(c.createdAt))]])}</div>
      <div class="card"><h3>Messages ${nts.some(n => !n.read) ? chip("New") : ""}</h3>${nts.length ? nts.map(n => `<div style="padding:10px 0;border-top:1px solid var(--line)"><b>${esc(n.title)}</b>${n.read ? "" : ` <button class="btn btn-ghost btn-sm" data-read="${esc(n.id)}">Mark read</button>`}<p>${esc(n.body)}</p><small>${esc(dt(n.createdAt))}</small></div>`).join("") : `<p class="hint">No messages yet.</p>`}</div></div>
      <div class="card" style="margin-top:20px"><h3>My applications</h3>${apps.length ? apps.map(a => `<div style="padding:12px 0;border-top:1px solid var(--line)"><b>${esc(a.applicationId)}</b> ${chip(a.status)}<p>${rs(a.loanAmount)} · ${esc(a.tenureMonths)} months · ${esc(a.loanType || "")}</p><small>Applied ${esc(dt(a.createdAt))}</small>${a.adminRemarks ? `<p class="hint">Note from our team: ${esc(a.adminRemarks)}</p>` : ""}</div>`).join("") : `<p class="hint">No applications yet. <a href="register.html">Apply now</a>.</p>`}</div>
      ${agr.length || trf.length || cmp.length ? `<div class="card" style="margin-top:20px"><h3>Documents &amp; updates</h3>${agr.map(r => `<p>Agreement ${esc(r.ref)} ${chip(r.status)}</p>`).join("")}${trf.map(r => `<p>Transfer ${esc(r.ref)} · ${rs(r.amount)} ${chip(r.status)}</p>`).join("")}${cmp.map(r => `<p>Review ${esc(r.ref)} ${chip(r.status)}${r.customerMessage ? `<br><small>${esc(r.customerMessage)}</small>` : ""}</p>`).join("")}</div>` : ""}`;
      host.querySelector("#so").onclick = out;
      host.addEventListener("click", async e => { const b = e.target.closest("[data-read]"); if (!b) return; b.disabled = true; try { await updateDoc(doc(db, "customers", u.uid, "notifications", b.dataset.read), { read: true }); b.remove(); } catch { b.disabled = false; } });
    } catch (x) { console.error(x); host.innerHTML = `<p class="notice err">Could not load your dashboard: ${esc(x.message || x)}</p>`; }
  });
}
async function out() { await signOut(auth); location.replace("login.html"); }

if (page === "login") loginPage(); else if (page === "dashboard") dashboard();
                                                                                                                                                                                                                                                   
