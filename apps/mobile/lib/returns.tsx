import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { formatMoney } from "@/constants/theme";
import { loadAll, put as dbPut } from "./db";
import { logAudit } from "./audit";
import { onSynced } from "./sync";
import { useCatalog } from "./catalog";
import type { Receipt } from "./cart";
import {
  lineNetForQty,
  quoteReturn,
  reasonLabel,
  remainingByLine,
  type RefundMethod,
  type ReturnLine,
  type ReturnReason,
  type SaleReturn,
} from "./return-model";

/**
 * Store of returns for the active store, plus the one write path that creates
 * them. The types and money rules live in `return-model.ts` (no React), and are
 * re-exported here so screens can import everything from one place.
 */
export * from "./return-model";

export type CreateReturnInput = {
  receipt: Receipt;
  lines: { lineIndex: number; qty: number; restock: boolean }[];
  reason: ReturnReason;
  note?: string;
  method: RefundMethod;
  storeName: string;
  storeReference?: string;
  servedBy: string;
};

export type CreateReturnResult =
  | { ok: true; ret: SaleReturn }
  | { ok: false; message: string };

type ReturnsState = {
  /** Every return, newest first. */
  returns: SaleReturn[];
  /** Returns raised against one receipt, in the order they happened. */
  returnsFor: (receiptId: string) => SaleReturn[];
  /** Total refunded against one receipt. */
  refundedFor: (receiptId: string) => number;
  createReturn: (input: CreateReturnInput) => CreateReturnResult;
};

const ReturnsContext = createContext<ReturnsState | null>(null);

const uid = () => `ret_${Date.now()}_${Math.round(Math.random() * 1e4)}`;

const newestFirst = (list: SaleReturn[]) => list.sort((a, b) => b.createdAt - a.createdAt);

export function ReturnsProvider({ children }: { children: ReactNode }) {
  const { recordReturn } = useCatalog();
  const [returns, setReturns] = useState<SaleReturn[]>(() =>
    newestFirst(loadAll<SaleReturn>("returns")),
  );

  // A return can be raised on another till, so refresh after each sync.
  useEffect(
    () => onSynced(() => setReturns(newestFirst(loadAll<SaleReturn>("returns")))),
    [],
  );

  const returnsFor = useCallback(
    (receiptId: string) =>
      returns
        .filter((ret) => ret.receiptId === receiptId)
        .sort((a, b) => a.createdAt - b.createdAt),
    [returns],
  );

  const refundedFor = useCallback(
    (receiptId: string) =>
      returns.reduce((sum, ret) => (ret.receiptId === receiptId ? sum + ret.total : sum), 0),
    [returns],
  );

  const createReturn = useCallback(
    (input: CreateReturnInput): CreateReturnResult => {
      const { receipt } = input;
      const prior = returns
        .filter((ret) => ret.receiptId === receipt.id)
        .sort((a, b) => a.createdAt - b.createdAt);
      const remaining = remainingByLine(receipt, prior);

      // Clamp to what's actually returnable, then drop empty selections. The
      // screen caps too, but this is the last gate before a money document is
      // written, so it must not trust its caller.
      const lines: ReturnLine[] = [];
      const takenByLine = new Map<number, number>();
      for (const selection of input.lines) {
        const source = receipt.lines[selection.lineIndex];
        if (!source) continue;
        const taken = takenByLine.get(selection.lineIndex) ?? 0;
        const cap = Math.max(0, (remaining[selection.lineIndex] ?? 0) - taken);
        const qty = Math.min(Math.max(0, Math.trunc(selection.qty)), cap);
        if (qty <= 0) continue;
        takenByLine.set(selection.lineIndex, taken + qty);
        lines.push({
          lineIndex: selection.lineIndex,
          productId: source.productId,
          variantId: source.variantId,
          variantName: source.variantName,
          name: source.name,
          qty,
          price: source.price,
          // Snapshot the discounted value so the credit note prints what was
          // actually refunded, not the list price.
          net: lineNetForQty(source, qty),
          restock: selection.restock,
        });
      }

      if (lines.length === 0) {
        return { ok: false, message: "Nothing left to return on this receipt." };
      }

      const quote = quoteReturn(
        receipt,
        lines.map((line) => ({ lineIndex: line.lineIndex, qty: line.qty })),
        prior,
      );

      const ret: SaleReturn = {
        id: uid(),
        number: `R#${1000 + returns.length + 1}`,
        receiptId: receipt.id,
        receiptNumber: receipt.number,
        lines,
        itemCount: quote.itemCount,
        subtotal: quote.subtotal,
        taxTotal: quote.taxTotal,
        total: quote.total,
        currency: receipt.currency,
        reason: input.reason,
        note: input.note?.trim() ? input.note.trim() : undefined,
        method: input.method,
        createdAt: Date.now(),
        storeName: input.storeName,
        storeReference: input.storeReference,
        servedBy: input.servedBy,
        synced: false,
      };

      dbPut("returns", ret);
      setReturns((prev) => [ret, ...prev]);

      /**
       * Put stock back only for lines flagged restock.
       *
       * When a line isn't restocked the units stay written off: stock was
       * already decremented at the sale and is not restored, so the shop loses
       * both the item and the revenue — which is exactly what a damaged return
       * costs. Lines without a productId (VIP web-order receipts) refund money
       * but can't be matched to a product, so they never touch stock.
       */
      const restockLines = lines
        .filter((line) => line.restock && line.productId)
        .map((line) => ({ productId: line.productId!, variantId: line.variantId, qty: line.qty }));
      if (restockLines.length > 0) recordReturn(restockLines, ret.number);

      const writtenOff = lines.reduce((sum, line) => (line.restock ? sum : sum + line.qty), 0);
      logAudit({
        action: "sale.return",
        entity: "return",
        entityId: ret.id,
        summary:
          `Return ${ret.number} against ${receipt.number} · ${quote.itemCount} item${quote.itemCount === 1 ? "" : "s"}` +
          ` · ${formatMoney(ret.total, ret.currency)} · ${input.method} · ${reasonLabel(input.reason)}` +
          (writtenOff > 0 ? ` · ${writtenOff} not restocked` : ""),
      });

      return { ok: true, ret };
    },
    [returns, recordReturn],
  );

  const value = useMemo<ReturnsState>(
    () => ({ returns, returnsFor, refundedFor, createReturn }),
    [returns, returnsFor, refundedFor, createReturn],
  );

  return <ReturnsContext.Provider value={value}>{children}</ReturnsContext.Provider>;
}

export function useReturns(): ReturnsState {
  const ctx = useContext(ReturnsContext);
  if (!ctx) throw new Error("useReturns must be used within a ReturnsProvider");
  return ctx;
}
