export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const inr = n => (n === "" || n == null || isNaN(n)) ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
export const dt = t => { const d = t?.toDate ? t.toDate() : t ? new Date(t) : null; return d && !isNaN(d) ? d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"; };
export const ms = t => t?.toMillis ? t.toMillis() : t ? new Date(t).getTime() : 0;
export const emi = (P, rate, n) => { const r = rate / 1200; return r === 0 ? P / n : P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1); };
export const maskPan = p => p ? p.slice(0, 2) + "XXXXXX" + p.slice(-2) : "—";
export const $ = (s, r = document) => r.querySelector(s);
