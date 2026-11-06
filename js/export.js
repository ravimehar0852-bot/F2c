/* Full customer details for the admin panel (screen, PDF, Excel). Admin-only: nothing is masked here.
   Customer-facing letters and emails (letter.js) keep PAN masked and never include Aadhaar or bank numbers. */
import { dt } from "./util.js";

const txt = v => v == null || v === "" ? "-" : typeof v === "object" ? (typeof v.toDate === "function" ? dt(v) : JSON.stringify(v)) : String(v);
const inr = n => n == null || n === "" ? "" : "Rs. " + Number(n).toLocaleString("en-IN");
const KNOWN = new Set(["id", "uid", "customerId", "name", "fullName", "phone", "mobile", "email", "status", "createdAt", "updatedAt", "dob", "aadhaar", "aadhaarLast4", "pan", "address", "addressCurrent", "addressPermanent", "city", "state", "pincode", "empType", "employmentType", "employer", "employerName", "monthlyIncome", "workYears", "employmentMonths", "otherObligations", "hasOtherLoans", "bankName", "accountHolder", "accountNumber", "accountLast4", "ifsc", "refName", "refPhone", "refRelation", "identityStatus", "addressStatus", "docsStatus"]);
const label = k => k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());

/* returns [[sectionTitle, [[label, value], ...]], ...] following the 7 registration steps */
export function customerSections(c, apps = []) {
  const perm = c.addressPermanent && c.addressPermanent !== c.addressCurrent ? c.addressPermanent : "";
  const sec = [
    ["Step 1 - Account", [["Customer ID", c.customerId], ["Full name", c.name || c.fullName], ["Mobile", c.phone || c.mobile], ["Email", c.email], ["Account status", c.status], ["Registered on", dt(c.createdAt)]]],
    ["Step 2 - Personal details", [["Date of birth", c.dob], ["Aadhaar number", c.aadhaar || (c.aadhaarLast4 ? "XXXX XXXX " + c.aadhaarLast4 : "")], ["PAN", c.pan], ["Address", c.addressCurrent || c.address], ["Permanent address", perm], ["City", c.city], ["State", c.state], ["PIN code", c.pincode]]],
    ["Step 3 - Employment and income", [["Occupation type", c.empType || c.employmentType], ["Employer / business", c.employer || c.employerName], ["Monthly income", inr(c.monthlyIncome)], ["Years in current work", c.workYears], ["Other monthly EMIs", c.otherObligations]]]
  ];
  if (apps.length) apps.forEach((a, i) => sec.push([`Step 4 - Loan requirement${apps.length > 1 ? " (" + (i + 1) + ")" : ""}`, [["Application ID", a.applicationId], ["Loan type", a.loanType], ["Loan amount", inr(a.loanAmount)], ["Tenure", a.tenureMonths ? a.tenureMonths + " months" : ""], ["Purpose", a.purpose], ["Estimated EMI", a.estimatedEmi ? inr(a.estimatedEmi) + (a.emiRate ? " (at " + a.emiRate + "% p.a.)" : "") : ""], ["Application status", a.status], ["Current step in admin", a.stage || "customers"], ["Applied on", dt(a.createdAt)], ["Admin remarks", a.adminRemarks]]]));
  else sec.push(["Step 4 - Loan requirement", [["Application", "No application found"]]]);
  sec.push(
    ["Step 5 - Documents and bank", [["Bank name", c.bankName], ["Account holder", c.accountHolder], ["Account number", c.accountNumber || (c.accountLast4 ? "XXXX" + c.accountLast4 : "")], ["IFSC code", c.ifsc], ["Other running loans", c.hasOtherLoans], ["Aadhaar number", c.aadhaar || (c.aadhaarLast4 ? "XXXX XXXX " + c.aadhaarLast4 : "")], ["PAN", c.pan]]],
    ["Step 6 - Reference", [["Reference name", c.refName], ["Reference mobile", c.refPhone], ["Relationship", c.refRelation]]],
    ["Verification status", [["Identity", c.identityStatus], ["Address", c.addressStatus], ["Documents", c.docsStatus]]]
  );
  const extra = Object.keys(c).filter(k => !KNOWN.has(k) && c[k] != null && c[k] !== "").map(k => [label(k), c[k]]);
  if (extra.length) sec.push(["Other saved details", extra]);
  return sec.map(([t, rows]) => [t, rows.map(([k, v]) => [k, txt(v)])]);
}

export function customerPdf(S, c, apps = []) {
  if (!window.jspdf) throw new Error("PDF library not loaded. Check internet and refresh.");
  const d = new window.jspdf.jsPDF({ unit: "mm", format: "a4" }), W = 210, M = 14, CW = W - 2 * M, NAVY = [20, 40, 120];
  let y = 18; const need = h => { if (y + h > 282) { d.addPage(); y = 16; } };
  d.setFont("helvetica", "bold"); d.setFontSize(22); d.setTextColor(...NAVY); d.text(S.name || "Company", W / 2, y, { align: "center" }); y += 7;
  d.setFont("helvetica", "normal"); d.setFontSize(9.5); d.setTextColor(80);
  [S.address, [S.phoneDisplay || S.phone, S.email].filter(Boolean).join("   |   "), S.registration].filter(Boolean).forEach(t => d.splitTextToSize(t, CW).forEach(l => { d.text(l, W / 2, y, { align: "center" }); y += 4.4; }));
  y += 1; d.setDrawColor(...NAVY); d.setLineWidth(0.7); d.line(M, y, W - M, y); y += 8;
  d.setFont("helvetica", "bold"); d.setFontSize(13); d.setTextColor(0); d.text("CUSTOMER DETAILS (internal, confidential)", M, y); y += 7;
  customerSections(c, apps).forEach(([title, rows]) => {
    need(20); d.setFont("helvetica", "bold"); d.setFontSize(10.5); d.setTextColor(255); d.setFillColor(...NAVY); d.rect(M, y, CW, 7, "F"); d.text(title, M + 2, y + 5); y += 7; d.setFontSize(9.5);
    rows.forEach(([k, v]) => {
      const l = d.splitTextToSize(v, CW - 62), h = Math.max(7, l.length * 4.6 + 2.6); need(h);
      d.setDrawColor(150); d.setLineWidth(0.2); d.setFillColor(238, 243, 252); d.rect(M, y, 56, h, "FD"); d.rect(M + 56, y, CW - 56, h);
      d.setFont("helvetica", "bold"); d.setTextColor(30); d.text(k, M + 2, y + 4.8); d.setFont("helvetica", "normal"); d.setTextColor(0); d.text(l, M + 58, y + 4.8); y += h;
    }); y += 5;
  });
  d.setFont("helvetica", "normal"); d.setFontSize(8); d.setTextColor(110); d.text(`Generated ${new Date().toLocaleString("en-IN")} | ${S.name || ""} | Handle as confidential`, M, 290);
  d.save(`${c.customerId || "customer"}-details.pdf`);
}

let xlsxP;
export const loadXlsx = () => window.XLSX ? Promise.resolve(window.XLSX) : (xlsxP ||= new Promise((res, rej) => {
  const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  s.onload = () => res(window.XLSX); s.onerror = () => { xlsxP = null; rej(new Error("Excel library could not load. Check internet and try again.")); }; document.head.append(s);
}));
const widths = rows => rows[0].map((_, i) => ({ wch: Math.min(60, Math.max(...rows.map(r => String(r[i] ?? "").length)) + 2) }));
export async function customerXlsx(c, apps = []) {
  const X = await loadXlsx(), wb = X.utils.book_new(), rows = [["Section", "Field", "Value"]];
  customerSections(c, apps).forEach(([t, r]) => r.forEach(([k, v]) => rows.push([t, k, v])));
  const ws = X.utils.aoa_to_sheet(rows); ws["!cols"] = widths(rows); X.utils.book_append_sheet(wb, ws, "Customer");
  X.writeFile(wb, `${c.customerId || "customer"}-details.xlsx`);
}
export async function tableXlsx(head, body, filename = "export.xlsx") {
  const X = await loadXlsx(), wb = X.utils.book_new(), rows = [head, ...body], ws = X.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths(rows); X.utils.book_append_sheet(wb, ws, "Data"); X.writeFile(wb, filename);
}
