/* Status / approval letter PDF (jsPDF) + e-mail sender for the admin pipeline.
   All company details come from window.SITE (js/config.js). Nothing is invented:
   the green "approved" tick appears only on the letter created when the admin approves an application. */
import { maskPan } from "./util.js";

export const emiCalc = (P, rate, n) => {
  P = +P; n = +n; const r = (+rate) / 1200;
  if (!(P > 0 && n > 0)) return null;
  if (!(r > 0)) return { emi: P / n, total: P, interest: 0 };
  const f = Math.pow(1 + r, n), emi = P * r * f / (f - 1);
  return { emi, total: emi * n, interest: emi * n - P };
};
const money = n => "Rs. " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const COPY = {
  customers: { title: "APPLICATION STATUS UPDATE", tick: "Your application has been accepted for review", intro: "We have received your loan application and our team has accepted it for review." },
  approvals: { title: "LOAN APPROVAL LETTER", tick: "Your loan has been approved", intro: "We are pleased to inform you that your loan application has been reviewed and approved on the terms shown below." },
  tds: { title: "TDS & TRANSACTION VERIFICATION", tick: "Transaction / TDS verification completed", intro: "The transaction and TDS details for your loan have been verified." },
  agreements: { title: "AGREEMENT STAGE COMPLETED", tick: "Your loan agreement stage is complete", intro: "The agreement formalities for your loan have been completed." },
  rtgs: { title: "RTGS / NEFT STAGE COMPLETED", tick: "Your fund transfer step is complete", intro: "The RTGS / NEFT transfer entry for your loan has been verified and recorded." },
  rbi: { title: "COMPLIANCE REVIEW COMPLETED", tick: "Compliance review completed", intro: "The compliance review for your loan account has been completed." },
  gst: { title: "GST INVOICE STAGE COMPLETED", tick: "GST invoice processed", intro: "The GST invoice for your loan account has been processed." },
  noc: { title: "PROCESS COMPLETED", tick: "All steps of your loan process are complete", intro: "All steps of your loan process, including the No Objection Certificate stage, are now complete." }
};
COPY.rejected = { title: "APPLICATION STATUS UPDATE", tick: "Your application could not be approved", intro: "After review, we are unable to proceed with your application." };
export const fromStageFor = app => { const order = ["customers", "approvals", "tds", "agreements", "rtgs", "rbi", "gst", "noc"], st = app.stage || "customers"; if (st === "rejected") return "rejected"; if (st === "completed") return "noc"; const i = order.indexOf(st); return i <= 0 ? "customers" : order[i - 1]; };
export function stageCopy(from, toName, app, S) {
  const c = COPY[from] || COPY.customers, co = S.name || "our company";
  return { ...c,
    subject: `${c.title.charAt(0) + c.title.slice(1).toLowerCase()} - ${app.applicationId || ""} - ${co}`.slice(0, 150),
    body: `Dear ${app.customerName || "Customer"},\n\n${c.intro}\n\nApplication ID: ${app.applicationId || "-"}\nCurrent step: ${toName}\n\nPlease find your letter attached as a PDF.\n\nFor your safety: ${co} never asks for any fee, OTP, PIN or password before disbursement. If anyone asks you for money in our name, do not pay and contact us on ${S.phoneDisplay || S.phone || "our official number"}.\n\nRegards,\n${co}${S.email ? "\n" + S.email : ""}` };
}

async function loadLogo(S) {
  if (!S.logo) return null;
  try { const b = await (await fetch(S.logo)).blob(); const url = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); return { url, fmt: b.type.includes("png") ? "PNG" : "JPEG" }; } catch { return null; }
}

export async function buildLetter({ site: S, app, customer: c, copy, rows = [], ref, done = true, statusText }) {
  if (!window.jspdf) throw new Error("PDF library not loaded");
  /* A step that is not complete must never show a green tick or "completed" wording. */
  if (!done) copy = { ...copy, title: "STEP STATUS UPDATE", tick: null, intro: "This is the current status of your application at this step. This step has not been completed yet.", pendingText: "Current status: " + (statusText || "In progress") + " (step not complete)" };
  const d = new window.jspdf.jsPDF({ unit: "mm", format: "a4" }), W = 210, M = 12, CW = W - 2 * M, NAVY = [20, 40, 120], BLUE = [0, 60, 200], GREEN = [30, 140, 70], co = S.name || "Company";
  let y = 12;
  const need = h => { if (y + h > 282) { d.addPage(); y = 14; } };
  const lines = (s, w) => d.splitTextToSize(String(s ?? "-"), w);
  const now = new Date(), dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
  const phone = S.phoneDisplay || S.phone || "";

  /* title */
  d.setFont("times", "bold"); d.setFontSize(21); d.setTextColor(...NAVY); d.text(copy.title, W / 2, y + 6, { align: "center" });
  const tw = d.getTextWidth(copy.title); d.setDrawColor(...NAVY); d.setLineWidth(0.5); d.line(W / 2 - tw / 2, y + 8, W / 2 + tw / 2, y + 8); y += 16;

  /* company block (left) + logo (right) */
  const logo = await loadLogo(S); let ly = y + 4;
  d.setFont("times", "bold"); d.setFontSize(15); d.setTextColor(...BLUE); d.text(co, M, ly); ly += 5.5;
  d.setFont("times", "normal"); d.setFontSize(10.5); d.setTextColor(20);
  lines(S.address || "", 90).forEach(l => { d.text(l, M, ly); ly += 4.8; });
  if (phone) { d.text("Phone No. : " + phone, M, ly); ly += 4.8; }
  if (S.email) { d.text("Email : " + S.email, M, ly); ly += 4.8; }
  if (S.registration) { lines(S.registration, 100).forEach(l => { d.text(l, M, ly); ly += 4.8; }); }
  if (logo) { try { const p = d.getImageProperties(logo.url), h = 22, w = Math.min(55, h * p.width / p.height); d.addImage(logo.url, logo.fmt, W - M - w, y, w, h); } catch { /* skip logo */ } }
  y = Math.max(ly, y + 24) + 3;

  /* To (left) + reference block (right) */
  let ty = y; d.setFont("times", "bold"); d.setFontSize(13); d.setTextColor(...NAVY); d.text("To,", M, ty); ty += 6;
  d.setFontSize(11); d.setTextColor(20); d.text(String(app.customerName || c.name || "Customer").toUpperCase(), M, ty); ty += 5;
  d.setFont("times", "normal"); d.setFontSize(10.5);
  [[c.address || c.addressCurrent, c.city, c.state, c.pincode].filter(Boolean).join(", "), c.email && "Email: " + c.email, (c.phone || c.mobile) && "Phone: " + (c.phone || c.mobile)].filter(Boolean).forEach(t => lines(t, 95).forEach(l => { d.text(l, M, ty); ty += 4.8; }));
  let ry = y; d.setFontSize(10.5);
  [phone && "Phone No. : " + phone, "Document: " + (app.applicationId || "-"), "Customer ID: " + (app.customerId || "-"), "Date: " + dateStr].filter(Boolean).forEach(t => { d.text(t, W - M, ry, { align: "right" }); ry += 5.2; });
  y = Math.max(ty, ry) + 4;

  /* letter box */
  const IW = CW - 10, loanTxt = `${app.loanType || "loan"} of Rs. ${Number(app.loanAmount || 0).toLocaleString("en-IN")}`;
  const para = [
    { t: "Dear " + (app.customerName || "Customer") + ",", b: 1 },
    { t: copy.intro },
    { t: `Your application ${app.applicationId ? "(" + app.applicationId + ") " : ""}is for a ${loanTxt}. The details below are as recorded in the ${co} system. Kindly review them and notify us immediately if you notice any discrepancy.` },
    { t: "Your Application Details:", b: 1, u: 1 },
    ...[["Applicant Name", app.customerName || c.name], ["PAN Card Number", c.pan ? maskPan(c.pan) : "-"], ["Date", dateStr]].map(([k, v]) => ({ kv: [k, v] })),
    { t: "We request you to verify the accuracy of the above information and inform us of any discrepancy at your earliest convenience. This letter is an intimation of the status shown below." },
    { t: "Thank you for choosing " + co + "." }
  ];
  d.setFontSize(10.5); let bh = 6;
  para.forEach(p => { bh += p.kv ? 5.2 : lines(p.t, IW).length * 4.9 + 2.2; });
  need(bh + 4); d.setFillColor(238, 244, 255); d.setDrawColor(130, 160, 230); d.setLineWidth(0.4); d.roundedRect(M, y, CW, bh, 3, 3, "FD");
  let by = y + 6;
  para.forEach(p => {
    d.setTextColor(20);
    if (p.kv) { d.setFont("times", "bold"); d.text(p.kv[0], M + 8, by); d.text(":", M + 52, by); d.setFont("times", "normal"); d.text(String(p.kv[1] ?? "-"), M + 58, by); by += 5.2; return; }
    d.setFont("times", p.b ? "bold" : "normal"); if (p.u) d.setTextColor(...NAVY);
    const l = lines(p.t, IW); d.text(l, M + 5, by); if (p.u) { d.setDrawColor(...NAVY); d.setLineWidth(0.3); d.line(M + 5, by + 1, M + 5 + d.getTextWidth(p.t), by + 1); }
    by += l.length * 4.9 + 2.2;
  });
  y += bh + 6;

  /* status row: green tick only when the step is really complete */
  need(18);
  if (app.status === "Rejected") {
    d.setFillColor(252, 233, 233); d.setDrawColor(190, 40, 40); d.setLineWidth(0.4); d.roundedRect(M, y, CW, 14, 3, 3, "FD");
    d.setFillColor(190, 40, 40); d.circle(M + 9, y + 7, 4.2, "F"); d.setDrawColor(255); d.setLineWidth(0.9); d.line(M + 7, y + 5, M + 11, y + 9); d.line(M + 11, y + 5, M + 7, y + 9);
    d.setTextColor(190, 40, 40); d.setFont("helvetica", "bold"); d.setFontSize(11.5); d.text(lines(copy.tick || "Application not approved", CW - 24)[0], M + 17, y + 8.6);
  } else if (copy.tick) {
    d.setFillColor(232, 245, 236); d.setDrawColor(...GREEN); d.setLineWidth(0.4); d.roundedRect(M, y, CW, 14, 3, 3, "FD");
    d.setFillColor(...GREEN); d.circle(M + 9, y + 7, 4.2, "F"); d.setDrawColor(255); d.setLineWidth(0.9);
    d.line(M + 7, y + 7, M + 8.4, y + 8.6); d.line(M + 8.4, y + 8.6, M + 11.4, y + 5.4);
    d.setTextColor(...GREEN); d.setFont("helvetica", "bold"); d.setFontSize(12); d.text(copy.tick, M + 17, y + 8.6);
  } else {
    d.setFillColor(255, 246, 225); d.setDrawColor(200, 140, 20); d.setLineWidth(0.4); d.roundedRect(M, y, CW, 14, 3, 3, "FD");
    d.setTextColor(150, 95, 0); d.setFont("helvetica", "bold"); d.setFontSize(10.5); d.text(lines(copy.pendingText || "In progress", CW - 10)[0], M + 5, y + 8.6);
  }
  y += 21;

  /* bordered tables, same style as the sample letter */
  const tbl = (t, data) => {
    need(20); d.setDrawColor(40); d.setLineWidth(0.35); d.rect(M, y, CW, 9);
    d.setFont("times", "bold"); d.setFontSize(13); d.setTextColor(...NAVY); d.text(t, W / 2, y + 6.4, { align: "center" }); y += 9.8;
    data.forEach(([k, v]) => {
      const l = lines(v, CW - 66), h = Math.max(8, l.length * 4.9 + 3.2); need(h);
      d.setDrawColor(40); d.setLineWidth(0.3); d.rect(M, y, 58, h); d.rect(M + 58, y, CW - 58, h);
      d.setFont("times", "bold"); d.setFontSize(10.5); d.setTextColor(...NAVY); d.text(String(k), M + 2, y + 5.4);
      d.setFont("times", "normal"); d.setTextColor(20); d.text(l, M + 61, y + 5.4); y += h;
    }); y += 7;
  };
  tbl("APPLICATION DETAILS", [...(ref ? [["Reference No", ref]] : []), ["Customer ID", app.customerId], ["Application No", app.applicationId], ["Applicant Name", app.customerName || c.name], ["Applicant Address", [c.address || c.addressCurrent, c.city, c.state, c.pincode].filter(Boolean).join(", ") || "-"], ["PAN Card No", c.pan ? maskPan(c.pan) : "-"], ["Mobile", c.phone || c.mobile || "-"], ["Email", c.email || "-"], ["Loan Type", app.loanType || "-"]]);
  const t = app.terms, emi = t ? emiCalc(app.loanAmount, t.interestRatePct, t.tenureMonths || app.tenureMonths) : null;
  if (t && emi) {
    const fee = (Number(app.loanAmount) || 0) * (Number(t.processingFeePct) || 0) / 100;
    tbl("EMI AND LOAN AMOUNT APPROVED", [["Loan Amount", money(app.loanAmount)], ["Interest Rate", t.interestRatePct + "% per year (reducing balance)"], ["Tenure", (t.tenureMonths || app.tenureMonths) + " months"], ["Processing Fee", t.processingFeePct + "% (" + money(fee) + ")"], ["Other Charges", t.otherCharges || "None"], ["EMI", money(emi.emi)], ["Total Interest", money(emi.interest)], ["Total Payable", money(emi.total)]]);
  } else tbl("LOAN DETAILS", [["Loan Amount Requested", money(app.loanAmount)], ["Tenure Requested", (app.tenureMonths || "-") + " months"], ["Interest Rate & EMI", "Will be shared when your loan is approved"]]);
  if (rows.length) tbl("STEP DETAILS", rows);

  /* terms */
  const terms = S.terms && S.terms.length ? S.terms : [
    "This letter is generated from the details submitted by the applicant and the status recorded by the company.",
    "The EMI shown is an estimate on the reducing-balance method. Final repayment terms are those in the signed loan agreement.",
    "Final disbursement is subject to completion of all steps, verification and the signed agreement.",
    `${co} never asks for any fee, OTP, PIN or password before disbursement. Do not pay anyone who asks for money in our name.`,
    "Please inform us immediately if any detail in this letter is incorrect."
  ];
  need(14); d.setDrawColor(40); d.setLineWidth(0.35); d.rect(M, y, CW, 9); d.setFont("times", "bold"); d.setFontSize(13); d.setTextColor(...NAVY); d.text("TERMS AND CONDITIONS", W / 2, y + 6.4, { align: "center" }); y += 13;
  d.setFont("times", "normal"); d.setFontSize(10); d.setTextColor(20);
  terms.forEach((s, i) => { const l = lines(`${i + 1}. ${s}`, CW - 4); need(l.length * 4.8 + 1.5); d.text(l, M + 2, y); y += l.length * 4.8 + 1.5; }); y += 5;

  /* footer */
  need(24); d.setDrawColor(...NAVY); d.setLineWidth(0.5); d.line(M, y, W - M, y); y += 5; d.setFont("helvetica", "normal"); d.setFontSize(8.5); d.setTextColor(80);
  [`This is a computer-generated letter and does not need a signature.`, [S.grievanceOfficer && "Grievance Officer: " + S.grievanceOfficer, S.grievanceContact].filter(Boolean).join(", "), [co, phone, S.email].filter(Boolean).join("  |  ")].filter(Boolean).forEach(f => lines(f, CW).forEach(l => { d.text(l, W / 2, y, { align: "center" }); y += 4.2; }));
  return d.output("datauristring").split(",")[1];
}

export async function sendMail(auth, { to, subject, text, pdfBase64, filename }) {
  const token = await auth.currentUser.getIdToken();
  const r = await fetch("/api/send-mail", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ to, subject, text, pdfBase64, filename }) });
  let j = {}; try { j = await r.json(); } catch { /* ignore */ }
  if (!r.ok) throw new Error(j.error || "Email failed (" + r.status + ")");
}
