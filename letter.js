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

export async function buildLetter({ site: S, app, customer: c, copy, rows = [] }) {
  if (!window.jspdf) throw new Error("PDF library not loaded");
  const d = new window.jspdf.jsPDF({ unit: "mm", format: "a4" }), W = 210, M = 14, CW = W - 2 * M, NAVY = [16, 50, 110], GREEN = [30, 140, 70];
  let y = 14;
  const need = h => { if (y + h > 280) { d.addPage(); y = 16; } };
  const lines = (s, w) => d.splitTextToSize(String(s ?? "-"), w);

  /* header */
  const logo = await loadLogo(S), tx = logo ? M + 26 : M;
  if (logo) { try { d.addImage(logo.url, logo.fmt, M, y - 2, 22, 22); } catch { /* skip logo */ } }
  d.setTextColor(...NAVY); d.setFont("helvetica", "bold"); d.setFontSize(17); d.text(S.name || "Company", tx, y + 6);
  d.setFont("helvetica", "normal"); d.setFontSize(9); d.setTextColor(70);
  let hy = y + 11;
  [S.tagline, S.address, [S.phoneDisplay || S.phone, S.email].filter(Boolean).join("   |   "), S.registration].filter(Boolean).forEach(t => { lines(t, CW - (tx - M)).forEach(l => { d.text(l, tx, hy); hy += 4.2; }); });
  y = Math.max(hy, y + 24) + 1; d.setDrawColor(...NAVY); d.setLineWidth(0.7); d.line(M, y, W - M, y); y += 7;

  /* ref + date */
  d.setTextColor(0); d.setFont("helvetica", "bold"); d.setFontSize(10);
  d.text("Ref. No.: " + (app.applicationId || "-"), M, y);
  d.text("Date: " + new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }), W - M, y, { align: "right" }); y += 8;

  /* title */
  d.setFillColor(...NAVY); d.roundedRect(M + 8, y, CW - 16, 12, 3, 3, "F");
  d.setTextColor(255); d.setFontSize(14); d.text(copy.title, W / 2, y + 8, { align: "center" }); y += 20;

  /* greeting */
  d.setTextColor(0); d.setFontSize(11); d.text("Dear " + (app.customerName || "Customer") + ",", M, y); y += 6;
  d.setFont("helvetica", "normal"); d.setFontSize(10);
  const intro = lines(copy.intro, CW); d.text(intro, M, y); y += intro.length * 5 + 4;

  /* status box with green tick */
  need(18); d.setFillColor(232, 245, 236); d.setDrawColor(...GREEN); d.setLineWidth(0.4); d.roundedRect(M, y, CW, 14, 3, 3, "FD");
  d.setFillColor(...GREEN); d.circle(M + 9, y + 7, 4.2, "F"); d.setDrawColor(255); d.setLineWidth(0.9);
  d.line(M + 7, y + 7, M + 8.4, y + 8.6); d.line(M + 8.4, y + 8.6, M + 11.4, y + 5.4);
  d.setTextColor(...GREEN); d.setFont("helvetica", "bold"); d.setFontSize(12); d.text(copy.tick, M + 17, y + 8.6); y += 21;

  /* tables */
  const bar = t => { need(20); d.setFillColor(...NAVY); d.rect(M, y, CW, 8, "F"); d.setTextColor(255); d.setFont("helvetica", "bold"); d.setFontSize(10.5); d.text(t, W / 2, y + 5.6, { align: "center" }); y += 8; };
  const tbl = (t, data) => {
    bar(t); d.setFontSize(9.5);
    data.forEach(([k, v]) => {
      const l = lines(v, CW - 62), h = Math.max(7, l.length * 4.8 + 2.4); need(h);
      d.setFillColor(222, 236, 250); d.setDrawColor(150); d.setLineWidth(0.2); d.rect(M, y, 54, h, "FD"); d.rect(M + 54, y, CW - 54, h, "S");
      d.setTextColor(0); d.setFont("helvetica", "bold"); d.text(String(k), M + 2, y + 4.8);
      d.setFont("helvetica", "normal"); d.text(l, M + 56, y + 4.8); y += h;
    }); y += 6;
  };
  const addr = [c.address, c.city, c.state, c.pincode].filter(Boolean).join(", ");
  tbl("CUSTOMER DETAILS", [["Applicant name", app.customerName || c.name], ["Customer ID", app.customerId || c.customerId], ["Application ID", app.applicationId], ["Email", c.email], ["Mobile", c.phone || c.mobile], ["Address", addr || "-"], ["PAN", c.pan ? maskPan(c.pan) : "-"]]);

  const t = app.terms, emi = t ? emiCalc(app.loanAmount, t.interestRatePct, t.tenureMonths || app.tenureMonths) : null;
  if (t && emi) {
    const fee = (Number(app.loanAmount) || 0) * (Number(t.processingFeePct) || 0) / 100;
    tbl("LOAN & EMI DETAILS", [["Loan amount", money(app.loanAmount)], ["Interest rate", t.interestRatePct + "% per year (reducing balance)"], ["Tenure", (t.tenureMonths || app.tenureMonths) + " months"], ["Processing fee", t.processingFeePct + "% (" + money(fee) + ")"], ["Other charges", t.otherCharges || "None"], ["Monthly EMI", money(emi.emi)], ["Total interest", money(emi.interest)], ["Total payable", money(emi.total)]]);
  } else tbl("LOAN DETAILS", [["Loan amount requested", money(app.loanAmount)], ["Tenure requested", (app.tenureMonths || "-") + " months"], ["Interest rate & EMI", "Will be shared when your loan is approved"]]);
  if (rows.length) tbl("STEP DETAILS", rows);

  /* terms */
  const terms = S.terms && S.terms.length ? S.terms : [
    "This letter is generated from the details submitted by the applicant and the status recorded by the company.",
    "The EMI shown is an estimate on the reducing-balance method. Final repayment terms are those in the signed loan agreement.",
    "Final disbursement is subject to completion of all steps, verification and the signed agreement.",
    `${S.name || "The company"} never asks for any fee, OTP, PIN or password before disbursement. Do not pay anyone who asks for money in our name.`,
    "Please inform us immediately if any detail in this letter is incorrect."
  ];
  bar("TERMS AND CONDITIONS"); y += 3; d.setFont("helvetica", "normal"); d.setFontSize(9.5); d.setTextColor(0);
  terms.forEach((s, i) => { const l = lines(`${i + 1}. ${s}`, CW - 4); need(l.length * 4.8 + 1.5); d.text(l, M + 2, y + 3); y += l.length * 4.8 + 1.5; }); y += 6;

  /* footer */
  need(26); d.setDrawColor(...NAVY); d.setLineWidth(0.5); d.line(M, y, W - M, y); y += 5; d.setFontSize(8.5); d.setTextColor(80);
  const foot = [`This is a computer-generated letter and does not need a signature.`, [S.grievanceOfficer && "Grievance Officer: " + S.grievanceOfficer, S.grievanceContact].filter(Boolean).join(", "), [S.name, S.phoneDisplay || S.phone, S.email].filter(Boolean).join("  |  ")].filter(Boolean);
  foot.forEach(f => lines(f, CW).forEach(l => { d.text(l, W / 2, y, { align: "center" }); y += 4.2; }));
  return d.output("datauristring").split(",")[1];
}

export async function sendMail(auth, { to, subject, text, pdfBase64, filename }) {
  const token = await auth.currentUser.getIdToken();
  const r = await fetch("/api/send-mail", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ to, subject, text, pdfBase64, filename }) });
  let j = {}; try { j = await r.json(); } catch { /* ignore */ }
  if (!r.ok) throw new Error(j.error || "Email failed (" + r.status + ")");
}
