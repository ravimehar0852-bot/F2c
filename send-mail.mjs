/* Vercel serverless function: sends a status letter (PDF) from the company Gmail.
   Only signed-in admins can call it (Firebase ID token + admins/<uid> document are checked).
   Vercel env vars needed: GMAIL_USER, GMAIL_APP_PASSWORD, FIREBASE_API_KEY, FIREBASE_PROJECT_ID, COMPANY_NAME (optional). */
import nodemailer from "nodemailer";

const env = k => { const v = process.env[k]; if (!v) throw new Error("Server setting missing: " + k); return v; };
const clean = s => String(s || "").replace(/[\r\n]+/g, " ").trim();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const token = clean(req.headers.authorization).replace(/^Bearer /i, "");
    if (!token) return res.status(401).json({ error: "Not signed in" });
    const look = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env("FIREBASE_API_KEY")}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token }) });
    const uid = (await look.json()).users?.[0]?.localId;
    if (!uid) return res.status(401).json({ error: "Invalid login" });
    const adm = await fetch(`https://firestore.googleapis.com/v1/projects/${env("FIREBASE_PROJECT_ID")}/databases/(default)/documents/admins/${uid}`, { headers: { Authorization: "Bearer " + token } });
    if (!adm.ok) return res.status(403).json({ error: "Admins only" });
    if ((await adm.json()).fields?.active?.booleanValue === false) return res.status(403).json({ error: "Admin disabled" });

    const { to, subject, text, pdfBase64, filename } = req.body || {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(clean(to))) return res.status(400).json({ error: "Invalid recipient email" });
    if (!clean(subject) || !text || String(text).length > 5000) return res.status(400).json({ error: "Invalid subject/message" });
    if (pdfBase64 && String(pdfBase64).length > 3_000_000) return res.status(400).json({ error: "PDF too large" });

    const user = env("GMAIL_USER");
    const tr = nodemailer.createTransport({ service: "gmail", auth: { user, pass: env("GMAIL_APP_PASSWORD") } });
    await tr.sendMail({
      from: `"${clean(process.env.COMPANY_NAME) || "Customer Care"}" <${user}>`, to: clean(to), subject: clean(subject), text: String(text),
      attachments: pdfBase64 ? [{ filename: clean(filename).replace(/[^\w.\-]/g, "_") || "letter.pdf", content: pdfBase64, encoding: "base64", contentType: "application/pdf" }] : []
    });
    return res.status(200).json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: e.message || "Send failed" }); }
}
