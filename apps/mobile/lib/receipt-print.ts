import { EscPosBuilder, type PaperWidth } from "./escpos";
import type { Receipt } from "./cart";

/**
 * Turn a Receipt into ESC/POS bytes for a thermal printer, and into HTML for
 * the OS print/share fallback (PDF, WhatsApp, email).
 *
 * Thermal printers are single-byte, so the currency is rendered as a plain code
 * ("NGN 2,500.00") rather than the ₦ glyph, which most of them cannot render.
 */

/**
 * "250000" minor units -> "2,500" (kobo shown only when non-zero).
 * Hand-rolled grouping so the printed slip matches the app exactly and doesn't
 * depend on Intl being present on the device.
 */
function amount(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100);
  const kobo = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${kobo === 0 ? "" : `.${String(kobo).padStart(2, "0")}`}`;
}

function money(minor: number, currency: string): string {
  return `${currency} ${amount(minor)}`;
}

function when(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/** Bytes for a thermal printer. */
export function buildReceiptBytes(r: Receipt, paper: PaperWidth = 58): Uint8Array {
  const b = new EscPosBuilder(paper);
  const subtotal = r.lines.reduce((s, l) => s + l.price * l.qty, 0);
  const tax = r.total - subtotal;

  b.align("center").big(true).bold(true).line(r.storeName).big(false);
  if (r.storeReference) b.line(r.storeReference);
  b.bold(false).align("left").rule();

  b.line(`Receipt: ${r.number}`);
  b.line(`Date:    ${when(r.createdAt)}`);
  b.line(`Served:  ${r.servedBy}`);
  if (r.customerName) b.line(`Customer: ${r.customerName}`);
  b.rule();

  for (const l of r.lines) {
    b.item(l.name, l.qty, amount(l.price), amount(l.price * l.qty));
  }
  b.rule();

  b.keyValue("Subtotal", money(subtotal, r.currency));
  if (tax > 0) b.keyValue("Tax", money(tax, r.currency));
  b.bold(true).big(true).keyValue("TOTAL", amount(r.total)).big(false).bold(false);

  if (r.cashReceived != null) {
    b.keyValue("Cash", money(r.cashReceived, r.currency));
    b.keyValue("Change", money(Math.max(0, r.cashReceived - r.total), r.currency));
  }

  b.rule();
  b.keyValue("Payment", r.mode.toUpperCase());

  // An unpaid receipt is the customer's request to pay — make that unmissable.
  if (r.status === "unpaid") {
    b.align("center").bold(true).big(true).line("** NOT PAID **").big(false);
    b.line("Please pay this amount").bold(false).align("left");
  } else {
    b.keyValue("Status", "PAID");
  }

  b.align("center").line().line("Thank you!").line("Powered by GLS POS").feed(3).cut();
  return b.build();
}

/**
 * HTML version for expo-print (share as PDF, print to a normal printer, or send
 * on WhatsApp). Styled to look like a receipt at 58mm width.
 */
export function buildReceiptHtml(r: Receipt): string {
  const subtotal = r.lines.reduce((s, l) => s + l.price * l.qty, 0);
  const tax = r.total - subtotal;
  const sym = r.currency === "NGN" ? "&#8358;" : `${r.currency} `;
  const row = (label: string, value: string, bold = false) =>
    `<div class="kv${bold ? " b" : ""}"><span>${label}</span><span>${value}</span></div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  @page { margin: 6mm; }
  body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; max-width: 320px; margin: 0 auto; }
  h1 { font-size: 17px; text-align: center; margin: 0 0 2px; }
  .meta { text-align: center; font-size: 11px; margin-bottom: 8px; }
  hr { border: none; border-top: 1px dashed #000; margin: 7px 0; }
  .kv { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
  .kv.b { font-weight: bold; font-size: 15px; }
  .item { padding: 2px 0; }
  .item .sub { color: #444; font-size: 11px; }
  .unpaid { text-align: center; font-weight: bold; font-size: 15px; border: 2px solid #000; padding: 6px; margin: 8px 0; }
  .foot { text-align: center; margin-top: 10px; font-size: 11px; }
</style></head><body>
  <h1>${escapeHtml(r.storeName)}</h1>
  ${r.storeReference ? `<div class="meta">${escapeHtml(r.storeReference)}</div>` : ""}
  <hr />
  ${row("Receipt", escapeHtml(r.number))}
  ${row("Date", when(r.createdAt))}
  ${row("Served by", escapeHtml(r.servedBy))}
  ${r.customerName ? row("Customer", escapeHtml(r.customerName)) : ""}
  <hr />
  ${r.lines
    .map(
      (l) =>
        `<div class="item"><div class="kv"><span>${escapeHtml(l.name)}</span><span>${sym}${amount(
          l.price * l.qty,
        )}</span></div><div class="sub">${l.qty} x ${sym}${amount(l.price)}</div></div>`,
    )
    .join("")}
  <hr />
  ${row("Subtotal", `${sym}${amount(subtotal)}`)}
  ${tax > 0 ? row("Tax", `${sym}${amount(tax)}`) : ""}
  ${row("TOTAL", `${sym}${amount(r.total)}`, true)}
  ${r.cashReceived != null ? row("Cash", `${sym}${amount(r.cashReceived)}`) : ""}
  ${r.cashReceived != null ? row("Change", `${sym}${amount(Math.max(0, r.cashReceived - r.total))}`) : ""}
  <hr />
  ${row("Payment", r.mode.toUpperCase())}
  ${
    r.status === "unpaid"
      ? `<div class="unpaid">NOT PAID<br/><span style="font-size:11px">Please pay this amount</span></div>`
      : row("Status", "PAID")
  }
  <div class="foot">Thank you!<br/>Powered by GLS POS</div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain text version, for WhatsApp/SMS sharing. */
export function buildReceiptText(r: Receipt): string {
  const lines = [
    r.storeName,
    r.storeReference ?? "",
    `Receipt ${r.number} — ${when(r.createdAt)}`,
    `Served by ${r.servedBy}`,
    "",
    ...r.lines.map((l) => `${l.qty} x ${l.name} — ${money(l.price * l.qty, r.currency)}`),
    "",
    `TOTAL: ${money(r.total, r.currency)}`,
    `Payment: ${r.mode.toUpperCase()}`,
    r.status === "unpaid" ? "STATUS: NOT PAID — please pay this amount" : "STATUS: PAID",
    "",
    "Thank you!",
  ];
  return lines.filter((l) => l !== "").join("\n");
}
