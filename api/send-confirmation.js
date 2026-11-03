/* Vercel serverless function: sends the "application received" email (with PDF) from the company Gmail.
   Secrets live in Vercel → Project → Settings → Environment Variables:  GMAIL_USER, GMAIL_APP_PASSWORD
   Safety: the email goes ONLY to the logged-in customer's own address (verified through their Firebase login token). */
const nodemailer = require("nodemailer");
const API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyBPHfkF58GQaJDMJBU62L83uMZTVl5MuwI"; // public Firebase web key (not a secret)
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = n => "Rs. " + Number(n).toLocaleString("en-IN");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return res.status(503).json({ ok: false, error: "Email is not configured on the server." });
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ ok: false, error: "Login required." });
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token }) });
    const u = (await r.json()).users?.[0];
    if (!u || !u.email) return res.status(401).json({ ok: false, error: "Invalid login." });

    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const id = /^CID-\d{2}-[A-Z2-9]{6}$/.test(b.customerId || "") && /^APP-\d{4}-[A-Z2-9]{6}$/.test(b.applicationId || "");
    if (!id) return res.status(400).json({ ok: false, error: "Invalid IDs." });
    const company = String(b.company || "Our team").slice(0, 80), name = String(b.customerName || "Customer").slice(0, 80);
    const lines = [["Customer ID", b.customerId], ["Application ID", b.applicationId], ["Loan type", String(b.loanType || "").slice(0, 60)], ["Loan amount", inr(b.loanAmount)], ["Tenure", `${Number(b.tenureMonths)} months`]];
    if (b.emi) lines.push([`Estimated EMI (${Number(b.rate)}% p.a., indicative)`, inr(b.emi) + " / month"]);
    const text = `Congratulations on your loan registration!\nThank you for choosing ${company}.\n\nDear ${name},\n\nWe have received your application. Our customer care executive will be in touch within the next 12-24 hours.\n\n${lines.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nPlease keep your Customer ID and Application ID safe. Your application summary is attached as a PDF.\nSubmitting an application does not guarantee loan approval. Never share your passwords, PINs or OTPs with anyone.\n\n${company}`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px"><h2>Congratulations on your loan registration!</h2><p>Thank you for choosing <b>${esc(company)}</b>.</p><p>Dear ${esc(name)},</p><p>We have received your application. Our customer care executive will be in touch within the next 12-24 hours.</p>
      <table cellpadding="8" style="border-collapse:collapse;width:100%">${lines.map(([k, v]) => `<tr><td style="border-bottom:1px solid #eee;color:#555">${esc(k)}</td><td style="border-bottom:1px solid #eee"><b>${esc(v)}</b></td></tr>`).join("")}</table>
      <p style="color:#555;font-size:13px">Please keep your Customer ID and Application ID safe. Your application summary is attached as a PDF.<br>Submitting an application does not guarantee loan approval. Never share your passwords, PINs or OTPs with anyone.</p></div>`;
    const attachments = [];
    if (typeof b.pdfBase64 === "string" && b.pdfBase64.length > 100 && b.pdfBase64.length < 900000) attachments.push({ filename: `${b.applicationId}.pdf`, content: b.pdfBase64, encoding: "base64", contentType: "application/pdf" });
    await nodemailer.createTransport({ service: "gmail", auth: { user, pass } }).sendMail({ from: `"${company.replace(/"/g, "")}" <${user}>`, to: u.email, subject: `Your loan application is received – ${b.applicationId}`, text, html, attachments });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("send-confirmation failed:", e && e.message);
    return res.status(500).json({ ok: false, error: "Could not send email." });
  }
};
