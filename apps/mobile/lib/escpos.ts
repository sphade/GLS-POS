/**
 * ESC/POS encoder for 58mm / 80mm thermal receipt printers.
 *
 * These printers don't take images or HTML — they consume a byte stream of
 * printable text interleaved with control codes, and print each line as it
 * arrives. We build that byte array here, then a transport (Bluetooth) writes
 * it to the device. See lib/printer.ts.
 *
 * Reference codes used below:
 *   ESC @      (1B 40)      initialise / reset
 *   ESC a n    (1B 61 n)    align 0=left 1=centre 2=right
 *   ESC E n    (1B 45 n)    bold off/on
 *   GS ! n     (1D 21 n)    character size (0x00 normal, 0x11 double w+h)
 *   LF         (0A)         line feed
 *   GS V m     (1D 56 42)   cut paper (ignored by printers without a cutter)
 */

const ESC = 0x1b;
const GS = 0x1d;

/** Characters per line: 32 for 58mm paper, 48 for 80mm. */
export type PaperWidth = 58 | 80;
export const charsPerLine = (w: PaperWidth): number => (w === 80 ? 48 : 32);

export class EscPosBuilder {
  private bytes: number[] = [];
  readonly width: number;

  constructor(paper: PaperWidth = 58) {
    this.width = charsPerLine(paper);
    this.raw(ESC, 0x40); // init
  }

  raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }

  align(a: "left" | "center" | "right"): this {
    return this.raw(ESC, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** Double width + height, for the store name / total. */
  big(on: boolean): this {
    return this.raw(GS, 0x21, on ? 0x11 : 0x00);
  }

  /**
   * Append text. Thermal printers use single-byte code pages, so we strip
   * characters they can't render (e.g. ₦ becomes "NGN" upstream, curly quotes
   * become plain) to avoid garbage glyphs.
   */
  text(s: string): this {
    const clean = s
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/[^\x20-\x7E\n]/g, "");
    for (let i = 0; i < clean.length; i++) this.bytes.push(clean.charCodeAt(i));
    return this;
  }

  line(s = ""): this {
    return this.text(s).raw(0x0a);
  }

  /** Wrap long text to the paper width instead of letting the printer clip it. */
  wrapped(s: string): this {
    const words = s.split(/\s+/);
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > this.width) {
        this.line(cur.trim());
        cur = w;
      } else {
        cur = (cur + " " + w).trim();
      }
    }
    if (cur) this.line(cur);
    return this;
  }

  /** A full-width separator, e.g. "--------------------------------". */
  rule(ch = "-"): this {
    return this.line(ch.repeat(this.width));
  }

  /** "Label              Value" padded to the paper width. */
  keyValue(label: string, value: string): this {
    const space = Math.max(1, this.width - label.length - value.length);
    return this.line(label + " ".repeat(space) + value);
  }

  /**
   * One receipt item row: name on the left, then qty x price and the line total
   * right-aligned. Long names wrap onto their own line so columns stay straight.
   */
  item(name: string, qty: number, unit: string, total: string): this {
    const right = `${qty} x ${unit}`;
    const nameRoom = this.width - total.length - 1;
    if (name.length > nameRoom) {
      this.wrapped(name);
      this.keyValue(right, total);
    } else {
      this.keyValue(name, total);
      this.line(`  ${right}`);
    }
    return this;
  }

  feed(n = 3): this {
    for (let i = 0; i < n; i++) this.bytes.push(0x0a);
    return this;
  }

  cut(): this {
    return this.raw(GS, 0x56, 0x42, 0x00);
  }

  build(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}
