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
import {
  loadDocsByField,
  loadDocsInRange,
  loadOne,
  loadRecentDocs,
  mergeById,
  putWithDeviceSequence,
  runAtomic,
} from "./db";
import { logAudit } from "./audit";
import { uid } from "./ids";
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

/** React keeps only the hot edge; SQLite retains every credit note offline. */
export const RETURN_LIVE_LIMIT = 100;

const boundReturns = (rows: readonly SaleReturn[]): SaleReturn[] =>
  [...rows]
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    .slice(0, RETURN_LIVE_LIMIT);

/** One credit note, including records older than the live provider window. */
export function loadReturnById(id: string | undefined): SaleReturn | null {
  return id ? loadOne<SaleReturn>("returns", id) : null;
}

/** Every credit note against one receipt, oldest first for refund calculations. */
export function loadReturnsForReceipt(receiptId: string): SaleReturn[] {
  return loadDocsByField<SaleReturn>("returns", "receiptId", receiptId, {
    field: "createdAt",
    direction: "asc",
  });
}

/** Credit notes raised inside a half-open report range, newest first. */
export function loadReturnsInRange(from: number, to: number): SaleReturn[] {
  return loadDocsInRange<SaleReturn>("returns", "createdAt", from, to);
}

/** A bounded recent page for list screens. */
export function loadRecentReturns(limit = RETURN_LIVE_LIMIT, offset = 0): SaleReturn[] {
  return loadRecentDocs<SaleReturn>("returns", "createdAt", limit, offset);
}

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
  /** Newest credit-note window only; complete permitted history stays in SQLite. */
  returns: SaleReturn[];
  /** Resolve freshly-created returns in memory before permitted SQLite history. */
  returnById: (id: string | undefined) => SaleReturn | null;
  /** Changes for both live-window and historical return query consumers. */
  returnRevision: number;
  /** Returns raised against one receipt, in the order they happened. */
  returnsFor: (receiptId: string) => SaleReturn[];
  /** Total refunded against one receipt. */
  refundedFor: (receiptId: string) => number;
  createReturn: (input: CreateReturnInput) => CreateReturnResult;
};

const ReturnsContext = createContext<ReturnsState | null>(null);

const returnId = () => uid("ret");

export function ReturnsProvider({
  children,
  canReadHistory,
}: {
  children: ReactNode;
  canReadHistory: boolean;
}) {
  const { recordReturn } = useCatalog();
  const [returns, setReturns] = useState<SaleReturn[]>(() =>
    canReadHistory ? loadRecentReturns() : [],
  );
  const [returnRevision, setReturnRevision] = useState(0);
  const returnById = useCallback(
    (id: string | undefined): SaleReturn | null => {
      if (!id) return null;
      return (
        returns.find((ret) => ret.id === id) ??
        (canReadHistory ? loadReturnById(id) : null)
      );
    },
    [canReadHistory, returns],
  );

  // A return can be raised on another till. Ignore every sync event that did
  // not actually apply a return row on this device.
  useEffect(
    () =>
      onSynced(({ pulledIds }) => {
        const ids = pulledIds.get("returns");
        if (canReadHistory && ids?.length) {
          setReturns((prev) =>
            boundReturns(mergeById(prev, "returns", ids, (row) => row.createdAt)),
          );
          // Older rows may not enter the bounded array, but historical screens
          // still need to rerun their local SQLite query.
          setReturnRevision((revision) => revision + 1);
        }
      }),
    [canReadHistory],
  );

  const returnsFor = useCallback(
    (receiptId: string) => (canReadHistory ? loadReturnsForReceipt(receiptId) : []),
    [canReadHistory],
  );

  const refundedFor = useCallback(
    (receiptId: string) => returnsFor(receiptId).reduce((sum, ret) => sum + ret.total, 0),
    [returnsFor],
  );

  const createReturn = useCallback(
    (input: CreateReturnInput): CreateReturnResult => {
      const { receipt } = input;
      if (!canReadHistory) {
        return {
          ok: false,
          message: "Receipt history is not available for this role.",
        };
      }
      // Refund safety always checks permitted SQLite history, not the bounded
      // provider window.
      const prior = returnsFor(receipt.id);
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

      // The credit note, the restock movements it authorises and its audit entry
      // are one financial event: a crash must not leave a refund whose stock was
      // never returned, or restocked units with no credit note to justify them.
      const ret = runAtomic(() => {
      const created = putWithDeviceSequence<SaleReturn>(
        "returns",
        "return_sequence_v1",
        (tag, sequence) => ({
          id: returnId(),
          number: `R#${tag}${1000 + sequence}`,
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
        }),
      );

      setReturns((prev) =>
        boundReturns([created, ...prev.filter((row) => row.id !== created.id)]),
      );
      setReturnRevision((revision) => revision + 1);

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
      if (restockLines.length > 0) recordReturn(restockLines, created.number);

      const writtenOff = lines.reduce((sum, line) => (line.restock ? sum : sum + line.qty), 0);
      logAudit({
        action: "sale.return",
        entity: "return",
        entityId: created.id,
        summary:
          `Return ${created.number} against ${receipt.number} · ${quote.itemCount} item${quote.itemCount === 1 ? "" : "s"}` +
          ` · ${formatMoney(created.total, created.currency)} · ${input.method} · ${reasonLabel(input.reason)}` +
          (writtenOff > 0 ? ` · ${writtenOff} not restocked` : ""),
      });

        return created;
      });

      return { ok: true, ret };
    },
    [canReadHistory, recordReturn, returnsFor],
  );

  const value = useMemo<ReturnsState>(
    () => ({ returns, returnById, returnRevision, returnsFor, refundedFor, createReturn }),
    [returns, returnById, returnRevision, returnsFor, refundedFor, createReturn],
  );

  return <ReturnsContext.Provider value={value}>{children}</ReturnsContext.Provider>;
}

export function useReturns(): ReturnsState {
  const ctx = useContext(ReturnsContext);
  if (!ctx) throw new Error("useReturns must be used within a ReturnsProvider");
  return ctx;
}
