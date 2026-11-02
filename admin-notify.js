/* Vercel serverless function: emails the CUSTOMER when an admin moves an application (Next / Under review / Reject / Cancel).
   Secrets (Vercel → Project → Settings → Environment Variables):  GMAIL_USER, GMAIL_APP_PASSWORD
   Safety:
   - the caller must be logged in AND have an admins/<uid> document (checked with the caller's own token against Firestore)
   - the recipient is NEVER taken from the request: the server reads the application and the customer's profile from Firestore */
const nodemailer = require("nodemailer");
const API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyBPHfkF58GQaJDMJBU62L83uMZTVl5MuwI"; // public Firebase web key (not a secret)
const PROJECT = process.env.FIREBASE_PROJECT_ID || "f2c-finance";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = n => "Rs. " + Number(n || 0).toLocaleString("en-IN");
const clip = (s, n) => String(s ?? "").replace(/[\r\n]+/g, " ").slice(0, n);

const fsGet = async (path, token) => {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { Authorization: "Bearer " + token } });
  return r.ok ? r.json() : null;
};
const val = f => f ? (f.stringValue ?? (f.integerValue != null ? Number(f.integerValue) : f.doubleValue ?? f.booleanValue)) : undefined;

const EVENTS = {
  next: s => ({ head: "Your application has moved to the next step", msg: `Your application has been completed at the "${s.from}" step and has moved to the next step: "${s.to}".` }),
  final: s => ({ head: "Your application process is complete", msg: `All steps of your application are now complete (last step: "${s.from}").` }),
  review: s => ({ head: "Your application is under review", msg: `Your application is under review at the "${s.from}" step.` }),
  reject: s => ({ head: "Your application has been rejected", msg: `We are sorry. Your application has been rejected at the "${s.from}" step.` }),
  cancel: s => ({ head: "Your application has been cancelled", msg: `Your application has been cancelled at the "${s.from}" step.` })
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return res.status(503).json({ ok: false, error: "Email is not configured on the server (GMAIL_USER / GMAIL_APP_PASSWORD missing in Vercel)." });
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ ok: false, error: "Login required." });
    const lk = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token }) });
    const u = (await lk.json()).users?.[0];
    if (!u) return res.status(401).json({ ok: false, error: "Invalid login." });

    const adm = await fsGet(`admins/${encodeURIComponent(u.localId)}`, token);          // readable only by the owner of that uid
    if (!adm || adm.fields?.active?.booleanValue === false) return res.status(403).json({ ok: false, error: "Admin access required." });

    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!/^APP-\d{4}-[A-Z2-9]{6}$/.test(b.applicationId || "")) return res.status(400).json({ ok: false, error: "Invalid application ID." });
    const ev = EVENTS[b.event]; if (!ev) return res.status(400).json({ ok: false, error: "Invalid event." });

    const app = await fsGet(`applications/${b.applicationId}`, token);
    if (!app) return res.status(404).json({ ok: false, error: "Application not found." });
    const f = app.fields || {}, cust = await fsGet(`customers/${encodeURIComponent(val(f.uid) || "")}`, token), cf = cust?.fields || {};
    const to = val(cf.email);
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(422).json({ ok: false, error: "The customer has no valid email address." });

    const company = clip(b.company || "Our team", 80), name = clip(val(cf.name) || val(cf.fullName) || val(f.customerName) || "Customer", 80);
    const s = { from: clip(b.fromStage, 60), to: clip(b.toStage, 60) }, status = clip(b.status, 40), remarks = clip(b.remarks, 600);
    const x = ev(s);
    const lines = [["Customer ID", val(f.customerId)], ["Application ID", b.applicationId], ["Loan amount", inr(val(f.loanAmount))], ["Current step", b.event === "next" ? s.to : s.from], ["Status", status]];
    if (remarks) lines.push(["Message from our team", remarks]);
    const withPdf = ["next", "final"].includes(b.event);
    const text = `Dear ${name},\n\n${x.head}.\n\n${x.msg}\n\n${lines.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${withPdf ? "The details of your application are attached as a PDF.\n" : ""}You can also see the current step in your dashboard. Please keep your Customer ID and Application ID safe. Never share your passwords, PINs or OTPs with anyone.\n\n${company}`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px"><h2>${esc(x.head)}</h2><p>Dear ${esc(name)},</p><p>${esc(x.msg)}</p>
      <table cellpadding="8" style="border-collapse:collapse;width:100%">${lines.map(([k, v]) => `<tr><td style="border-bottom:1px solid #eee;color:#555">${esc(k)}</td><td style="border-bottom:1px solid #eee"><b>${esc(v)}</b></td></tr>`).join("")}</table>
      <p style="color:#555;font-size:13px">${withPdf ? "The details of your application are attached as a PDF.<br>" : ""}You can also see the current step in your dashboard. Please keep your Customer ID and Application ID safe. Never share your passwords, PINs or OTPs with anyone.</p><p>${esc(company)}</p></div>`;
    const attachments = [];
    if (withPdf && typeof b.pdfBase64 === "string" && b.pdfBase64.length > 100 && b.pdfBase64.length < 3000000) attachments.push({ filename: `${b.applicationId}-update.pdf`, content: b.pdfBase64, encoding: "base64", contentType: "application/pdf" });
    await nodemailer.createTransport({ service: "gmail", auth: { user, pass } }).sendMail({ from: `"${company.replace(/"/g, "")}" <${user}>`, to, subject: `${x.head} – ${b.applicationId}`, text, html, attachments });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("admin-notify failed:", e && e.message);
    return res.status(500).json({ ok: false, error: "Could not send email." });
  }
};
