import { EscPosBuilder, type PaperWidth } from "./escpos";
import {
  escapePrintHtml,
  printableAmount as amount,
  printableMoney as money,
  printableWhen as when,
} from "./receipt-print";
import { isVoidReturn, reasonLabel, returnLineNetOf, type SaleReturn } from "./return-model";

/**
 * Turn a return into a printable credit note: ESC/POS bytes for a thermal
 * printer, HTML for the OS print/PDF path, and plain text for chat apps.
 *
 * The slip is deliberately unmistakable — headed RETURN and always quoting the
 * original invoice number — so it can never be mistaken for a second sale.
 */

/** Bytes for a thermal printer. */
export function buildReturnBytes(r: SaleReturn, paper: PaperWidth = 58): Uint8Array {
  const b = new EscPosBuilder(paper);
  const voided = isVoidReturn(r);

  b.align("center").big(true).bold(true).line(r.storeName).big(false);
  if (r.storeReference) b.line(r.storeReference);
  b.line();
  b.big(true).line(voided ? "VOID" : "RETURN").big(false);
  b.line("CREDIT NOTE").bold(false).align("left").rule();

  b.line(`Credit:  ${r.number}`);
  b.line(`Against: ${r.receiptNumber}`);
  b.line(`Date:    ${when(r.createdAt)}`);
  b.line(`Staff:   ${r.servedBy}`);
  b.rule();

  for (const line of r.lines) {
    b.item(line.name, line.qty, amount(line.price), amount(returnLineNetOf(line)));
  }
  b.rule();

  b.keyValue("Subtotal", money(r.subtotal, r.currency));
  if (r.taxTotal > 0) b.keyValue("Tax", money(r.taxTotal, r.currency));
  b.bold(true)
    .big(true)
    .keyValue(voided ? "VOIDED" : "REFUND", amount(r.total))
    .big(false)
    .bold(false);
  b.rule();

  b.keyValue("Reason", reasonLabel(r.reason));
  b.keyValue("Method", r.method);
  if (r.note) b.line(`Note: ${r.note}`);

  b.align("center").line().line("Customer copy").line("Powered by GLS POS").feed(3).cut();
  return b.build();
}

/** HTML version for expo-print (PDF, system print, WhatsApp). */
export function buildReturnHtml(r: SaleReturn): string {
  const sym = r.currency === "NGN" ? "&#8358;" : `${r.currency} `;
  const voided = isVoidReturn(r);
  const row = (label: string, value: string, bold = false) =>
    `<div class="kv${bold ? " b" : ""}"><span>${label}</span><span>${value}</span></div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  @page { margin: 6mm; }
  body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; max-width: 320px; margin: 0 auto; }
  h1 { font-size: 17px; text-align: center; margin: 0 0 2px; }
  .meta { text-align: center; font-size: 11px; margin-bottom: 8px; }
  .banner { text-align: center; font-weight: bold; font-size: 15px; border: 2px solid #000; padding: 6px; margin: 8px 0; letter-spacing: 1px; }
  hr { border: none; border-top: 1px dashed #000; margin: 7px 0; }
  .kv { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
  .kv.b { font-weight: bold; font-size: 15px; }
  .item { padding: 2px 0; }
  .item .sub { color: #444; font-size: 11px; }
  .foot { text-align: center; margin-top: 10px; font-size: 11px; }
</style></head><body>
  <h1>${escapePrintHtml(r.storeName)}</h1>
  ${r.storeReference ? `<div class="meta">${escapePrintHtml(r.storeReference)}</div>` : ""}
  <div class="banner">${voided ? "VOID" : "RETURN"} &middot; CREDIT NOTE</div>
  ${row("Credit note", escapePrintHtml(r.number))}
  ${row("Against receipt", escapePrintHtml(r.receiptNumber))}
  ${row("Date", when(r.createdAt))}
  ${row("Staff", escapePrintHtml(r.servedBy))}
  <hr />
  ${r.lines
    .map(
      (line) =>
        `<div class="item"><div class="kv"><span>${escapePrintHtml(line.name)}</span><span>${sym}${amount(
          returnLineNetOf(line),
        )}</span></div><div class="sub">${line.qty} x ${sym}${amount(line.price)}${
          line.restock ? "" : " &middot; not restocked"
        }</div></div>`,
    )
    .join("")}
  <hr />
  ${row("Subtotal", `${sym}${amount(r.subtotal)}`)}
  ${r.taxTotal > 0 ? row("Tax", `${sym}${amount(r.taxTotal)}`) : ""}
  ${row(voided ? "VOIDED" : "REFUND", `${sym}${amount(r.total)}`, true)}
  <hr />
  ${row("Reason", escapePrintHtml(reasonLabel(r.reason)))}
  ${row("Method", escapePrintHtml(r.method))}
  ${r.note ? `<div class="meta">Note: ${escapePrintHtml(r.note)}</div>` : ""}
  <div class="foot">Customer copy<br/>Powered by GLS POS</div>
</body></html>`;
}

/** Plain text version, for WhatsApp/SMS sharing. */
export function buildReturnText(r: SaleReturn): string {
  const voided = isVoidReturn(r);
  const lines = [
    r.storeName,
    r.storeReference ?? "",
    voided ? "VOID / CREDIT NOTE" : "RETURN / CREDIT NOTE",
    `${r.number} against receipt ${r.receiptNumber}`,
    when(r.createdAt),
    `Staff: ${r.servedBy}`,
    "",
    ...r.lines.map(
      (line) =>
        `${line.qty} x ${line.name} — ${money(returnLineNetOf(line), r.currency)}${
          line.restock ? "" : " (not restocked)"
        }`,
    ),
    "",
    `${voided ? "VOIDED" : "REFUND"}: ${money(r.total, r.currency)}`,
    `Reason: ${reasonLabel(r.reason)}`,
    `Method: ${r.method}`,
    r.note ? `Note: ${r.note}` : "",
  ];
  return lines.filter((line) => line !== "").join("\n");
}
