/* Trusted backend: Customer ID issuing + customer registration + admin communications. Region must match js firebase-config.js */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
admin.initializeApp();
const db = admin.firestore(), FV = admin.firestore.FieldValue, TS = admin.firestore.Timestamp;
const REGION = "asia-south1";
const SMTP_URL = defineSecret("SMTP_URL");                        // e.g. smtps://user:pass@smtp.gmail.com:465
const PREFIX = defineString("CUSTOMER_PREFIX", { default: "FIN" }); // Customer ID prefix, e.g. FIN-CUST-2026-000001
const MAIL_FROM = defineString("MAIL_FROM", { default: "" });       // e.g. "Company <support@company.com>"

const bad = m => { throw new HttpsError("invalid-argument", m); };
const str = (v, k, min, max) => { v = typeof v === "string" ? v.trim() : ""; if (v.length < min || v.length > max) bad(`Invalid ${k}.`); return v; };
const num = (v, k, min, max) => { v = Number(v); if (!isFinite(v) || v < min || v > max) bad(`Invalid ${k}.`); return v; };
const opt = (v, k, re) => { v = typeof v === "string" ? v.trim().toUpperCase() : ""; if (v && !re.test(v)) bad(`Invalid ${k}.`); return v; };
const pad = (n, w) => String(n).padStart(w, "0");

exports.registerCustomer = onCall({ region: REGION }, async req => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please sign in first.");
  const d = req.data || {}, uid = req.auth.uid, email = req.auth.token.email;
  if (!email) bad("Account has no email.");
  const dob = str(d.dob, "date of birth", 10, 10); const age = (Date.now() - new Date(dob)) / 31557600000; if (!(age >= 18 && age <= 90)) bad("Applicant must be an adult.");
  const mobile = str(d.mobile, "mobile", 10, 10); if (!/^[6-9]\d{9}$/.test(mobile)) bad("Invalid mobile number.");
  const pan = opt(d.pan, "PAN", /^[A-Z]{5}[0-9]{4}[A-Z]$/); if (!pan) bad("PAN is required.");
  const aadhaarLast4 = opt(d.aadhaarLast4, "Aadhaar digits", /^\d{4}$/);   // only last 4 digits are ever accepted
  const ifsc = opt(d.ifsc, "IFSC", /^[A-Z]{4}0[A-Z0-9]{6}$/);
  const accountLast4 = opt(d.accountLast4, "account digits", /^\d{4}$/);
  if (!d.idConsent || !d.privacy || !d.terms || !d.declaration) bad("All consents and the declaration are required.");
  const profile = {
    fullName: str(d.fullName, "name", 2, 80), dob, gender: str(d.gender, "gender", 1, 20), mobile, email,
    addressCurrent: str(d.addressCurrent, "current address", 10, 300), addressPermanent: (d.addressPermanent || "").toString().trim().slice(0, 300) || str(d.addressCurrent, "address", 10, 300),
    pan, aadhaarLast4, employmentType: str(d.employmentType, "employment type", 2, 40), employerName: str(d.employerName, "employer", 2, 100),
    employmentMonths: num(d.employmentMonths, "employment duration", 0, 720), monthlyIncome: num(d.monthlyIncome, "monthly income", 0, 1e8),
    incomeSource: str(d.incomeSource, "income source", 2, 60), otherObligations: num(d.otherObligations || 0, "obligations", 0, 1e8),
    bankName: str(d.bankName, "bank name", 2, 80), accountHolder: str(d.accountHolder, "account holder", 2, 80), accountLast4, ifsc
  };
  const loan = { loanAmount: num(d.loanAmount, "loan amount", 10000, 1e8), purpose: str(d.purpose, "purpose", 2, 80), tenureMonths: num(d.tenureMonths, "tenure", 3, 360) };

  return db.runTransaction(async t => {
    const cRef = db.doc(`customers/${uid}`), existing = await t.get(cRef);
    if (existing.exists) return { customerId: existing.data().customerId, applicationId: null, existing: true };
    const cc = db.doc("counters/customer"), ac = db.doc("counters/application");
    const [cs, as] = await Promise.all([t.get(cc), t.get(ac)]);
    const cn = (cs.exists ? cs.data().n : 0) + 1, an = (as.exists ? as.data().n : 0) + 1, y = new Date().getFullYear();
    const customerId = `${PREFIX.value()}-CUST-${y}-${pad(cn, 6)}`, applicationId = `${PREFIX.value()}-APP-${y}-${pad(an, 6)}`;
    t.set(cc, { n: cn }); t.set(ac, { n: an });
    t.set(cRef, { ...profile, uid, customerId, identityStatus: "Pending verification", addressStatus: "Pending verification", docsStatus: "Pending", remarks: [], createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() });
    t.set(db.doc(`applications/${applicationId}`), {
      ...loan, applicationId, uid, customerId, customerName: profile.fullName, employmentType: profile.employmentType, monthlyIncome: profile.monthlyIncome, otherObligations: profile.otherObligations,
      status: "Submitted", statusHistory: [{ status: "Submitted", at: TS.now(), by: "customer" }], approvalReady: true, terms: null, termsVisible: false, missingDocs: [], remarks: [], createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
    });
    return { customerId, applicationId };
  });
});

exports.sendCommunication = onCall({ region: REGION, secrets: [SMTP_URL] }, async req => {
  if (!req.auth || req.auth.token.admin !== true) throw new HttpsError("permission-denied", "Admins only.");
  const { uid, channel, kind } = req.data || {}, message = String(req.data?.message || "").slice(0, 1500);
  if (!["email", "sms"].includes(channel) || !["verification", "update", "missing_docs", "reminder"].includes(kind)) bad("Invalid request.");
  const snap = await db.doc(`customers/${uid}`).get(); if (!snap.exists) bad("Customer not found.");
  const c = snap.data(), log = { channel, kind, message, by: req.auth.token.email || req.auth.uid, createdAt: FV.serverTimestamp() };
  let status = "failed", error = "";
  if (channel === "sms") { status = "not_configured"; error = "No SMS provider is connected. Add one in functions/index.js."; }
  else if (!MAIL_FROM.value()) { error = "MAIL_FROM is not configured."; }
  else {
    try {
      let body = message, subject = "Update on your loan application";
      if (kind === "verification") { subject = "Verify your email address"; body = "Please verify your email address using this link:\n" + await admin.auth().generateEmailVerificationLink(c.email); }
      if (kind === "missing_docs") subject = "Documents required for your application";
      if (kind === "reminder") subject = "Reminder regarding your application";
      const r = await nodemailer.createTransport(SMTP_URL.value()).sendMail({ from: MAIL_FROM.value(), to: c.email, subject, text: `Dear ${c.fullName},\n\n${body}\n\nCustomer ID: ${c.customerId}\n\nNever share passwords, PINs or OTPs with anyone.` });
      status = r.accepted && r.accepted.length ? "sent" : "failed"; if (status === "failed") error = "Mail server did not accept the message.";
    } catch (e) { error = String(e.message || e).slice(0, 200); }
  }
  await db.collection(`customers/${uid}/communications`).add({ ...log, status, error });
  if (status === "sent" && kind !== "verification") await db.collection(`customers/${uid}/notifications`).add({ title: kind === "missing_docs" ? "Documents requested" : "Message from our team", body: message, read: false, createdAt: FV.serverTimestamp() });
  return { status, error };
});
