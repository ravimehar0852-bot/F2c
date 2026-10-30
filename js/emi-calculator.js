/* EMI = P × r × (1+r)^n / ((1+r)^n − 1), r = annual rate / 12 / 100 */
(function () {
  const $ = id => document.getElementById(id); if (!$("emiAmount")) return;
  const calc = (P, annual, n) => {
    const r = annual / 12 / 100;
    const emi = r === 0 ? P / n : P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    return { emi, total: emi * n, interest: emi * n - P };
  };
  window.calcEMI = calc;
  function run() {
    const P = parseFloat($("emiAmount").value), rate = parseFloat($("emiRate").value);
    let t = parseFloat($("emiTenure").value); const n = $("emiUnit").value === "years" ? Math.round(t * 12) : Math.round(t);
    const ok = [
      V.err($("emiAmount"), P > 0 && P <= window.SITE.amountMax ? "" : "Enter a loan amount greater than 0."),
      V.err($("emiRate"), rate >= 0 && rate <= 60 ? "" : "Enter an annual rate between 0 and 60."),
      V.err($("emiTenure"), n >= 1 && n <= 600 ? "" : "Enter a tenure of 1 to 600 months (or up to 50 years).")
    ].every(Boolean);
    if (!ok || isNaN(P) || isNaN(rate) || isNaN(n)) { ["emiMonthly", "emiInterest", "emiTotal"].forEach(i => $(i).textContent = "—"); return; }
    const r = calc(P, rate, n);
    $("emiMonthly").textContent = V.inr(r.emi); $("emiInterest").textContent = V.inr(r.interest); $("emiTotal").textContent = V.inr(r.total);
    $("emiDonut").style.setProperty("--p", (P / r.total * 100).toFixed(1) + "%");
  }
  ["emiAmount", "emiRate", "emiTenure", "emiUnit"].forEach(i => $(i).addEventListener("input", run)); run();
})();
