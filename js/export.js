/* Simple customer PDF (company name on top, customer details below) and Excel (.xlsx) exports. */
import { maskPan, dt } from "./util.js";

const val = v => (v == null || v === "" ? "-" : String(v));
export const customerRows = c => [
  ["Customer ID", c.customerId], ["Name", c.name || c.fullName], ["Email", c.email], ["Mobile", c.phone || c.mobile],
  ["PAN", c.pan ? maskPan(c.pan) : ""], ["Date of birth", c.dob], ["Address", [c.address || c.addressCurrent, c.city, c.state, c.pincode].filter(Boolean).join(", ")],
  ["Occupation", c.empType], ["Employer / business", c.employer], ["Monthly income (Rs.)", c.monthlyIncome], ["Other running loans", c.hasOtherLoans], ["Registered on", dt(c.createdAt)]
].map(([k, v]) => [k, val(v)]);
const APP_HEAD = ["Application ID", "Loan type", "Amount (Rs.)", "Tenure (months)", "Status", "Applied on"];
const appRows = apps => apps.map(a => [a.applicationId, a.loanType, a.loanAmount, a.tenureMonths, a.status, dt(a.createdAt)].map(val));

export function customerPdf(S, c, apps = []) {
  if (!window.jspdf) throw new Error("PDF library not loaded. Check internet and refresh.");
  const d = new window.jspdf.jsPDF({ unit: "mm", format: "a4" }), W = 210, M = 14, CW = W - 2 * M, NAVY = [20, 40, 120];
  let y = 18;
  const need = h => { if (y + h > 282) { d.addPage(); y = 16; } };
  d.setFont("helvetica", "bold"); d.setFontSize(22); d.setTextColor(...NAVY); d.text(S.name || "Company", W / 2, y, { align: "center" }); y += 7;
  d.setFont("helvetica", "normal"); d.setFontSize(9.5); d.setTextColor(80);
  [S.address, [S.phoneDisplay || S.phone, S.email].filter(Boolean).join("   |   "), S.registration].filter(Boolean).forEach(t => d.splitTextToSize(t, CW).forEach(l => { d.text(l, W / 2, y, { align: "center" }); y += 4.4; }));
  y += 1; d.setDrawColor(...NAVY); d.setLineWidth(0.7); d.line(M, y, W - M, y); y += 9;
  d.setFont("helvetica", "bold"); d.setFontSize(13); d.setTextColor(0); d.text("CUSTOMER DETAILS", M, y); y += 6;
  d.setFontSize(10);
  customerRows(c).forEach(([k, v]) => {
    const l = d.splitTextToSize(v, CW - 62), h = Math.max(7.5, l.length * 4.8 + 3); need(h);
    d.setDrawColor(150); d.setLineWidth(0.2); d.setFillColor(238, 243, 252); d.rect(M, y, 56, h, "FD"); d.rect(M + 56, y, CW - 56, h);
    d.setFont("helvetica", "bold"); d.setTextColor(30); d.text(k, M + 2, y + 5); d.setFont("helvetica", "normal"); d.setTextColor(0); d.text(l, M + 58, y + 5); y += h;
  });
  if (apps.length) {
    y += 9; need(24); d.setFont("helvetica", "bold"); d.setFontSize(13); d.text("APPLICATIONS", M, y); y += 6;
    const cw = [34, 36, 30, 26, 32, 24], row = (cells, bold) => {
      const ls = cells.map((t, i) => d.splitTextToSize(String(t), cw[i] - 3)), h = Math.max(7.5, Math.max(...ls.map(l => l.length)) * 4.4 + 3); need(h);
      let x = M; d.setFont("helvetica", bold ? "bold" : "normal"); d.setFontSize(8.5);
      ls.forEach((l, i) => { if (bold) { d.setFillColor(238, 243, 252); d.rect(x, y, cw[i], h, "FD"); } else d.rect(x, y, cw[i], h); d.setTextColor(0); d.text(l, x + 1.5, y + 4.8); x += cw[i]; }); y += h;
    };
    d.setDrawColor(150); d.setLineWidth(0.2); row(APP_HEAD, true); appRows(apps).forEach(r => row(r, false));
  }
  d.setFont("helvetica", "normal"); d.setFontSize(8); d.setTextColor(110);
  d.text(`Generated ${new Date().toLocaleString("en-IN")} | ${S.name || ""}`, M, 290);
  d.save(`${c.customerId || "customer"}-details.pdf`);
}

let xlsxP;
export const loadXlsx = () => window.XLSX ? Promise.resolve(window.XLSX) : (xlsxP ||= new Promise((res, rej) => {
  const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  s.onload = () => res(window.XLSX); s.onerror = () => { xlsxP = null; rej(new Error("Excel library could not load. Check internet and try again.")); }; document.head.append(s);
}));
const widths = rows => rows[0].map((_, i) => ({ wch: Math.min(50, Math.max(...rows.map(r => String(r[i] ?? "").length)) + 2) }));
export async function customerXlsx(c, apps = []) {
  const X = await loadXlsx(), wb = X.utils.book_new(), cr = [["Field", "Value"], ...customerRows(c)];
  const s1 = X.utils.aoa_to_sheet(cr); s1["!cols"] = widths(cr); X.utils.book_append_sheet(wb, s1, "Customer");
  if (apps.length) { const ar = [APP_HEAD, ...appRows(apps)], s2 = X.utils.aoa_to_sheet(ar); s2["!cols"] = widths(ar); X.utils.book_append_sheet(wb, s2, "Applications"); }
  X.writeFile(wb, `${c.customerId || "customer"}-details.xlsx`);
}
export async function tableXlsx(head, body, filename = "export.xlsx") {
  const X = await loadXlsx(), wb = X.utils.book_new(), rows = [head, ...body], ws = X.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths(rows); X.utils.book_append_sheet(wb, ws, "Data"); X.writeFile(wb, filename);
}
