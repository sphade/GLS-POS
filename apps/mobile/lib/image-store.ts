import * as FileSystem from "expo-file-system";
import { loadIds, loadOne, put as dbPut, softDelete } from "./db";

/**
 * Item images, kept in SQLite but deliberately *out* of the product document.
 *
 * Why: a base64 photo is 30–80KB of string. Storing it on the product meant
 * every `loadAll("products")` JSON-parsed megabytes of base64 on the JS thread,
 * which froze the Items screen on mount. Images now live in their own
 * `product_images` collection, so the catalog stays small and fast to read.
 *
 * For rendering we materialise each image to a file in the cache directory once
 * and hand `<Image>` a `file://` URI. Native image loading can decode and cache
 * a file efficiently; a `data:` URI is re-decoded on every single mount.
 */

export type ProductImage = {
  /** Same id as the product it belongs to. */
  id: string;
  /** base64 payload without the data-URI prefix. */
  base64: string;
  mime: string;
};

const DIR = `${FileSystem.cacheDirectory}item-images/`;

/** productId -> file:// URI, once materialised this session. */
const fileCache = new Map<string, string>();
/** In-flight materialisations, so concurrent cards don't duplicate work. */
const pending = new Map<string, Promise<string | null>>();

let dirReady: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  if (!dirReady) {
    dirReady = FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  }
  return dirReady;
}

const extFor = (mime: string) => (mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg");

/** Save (or replace) a product's image. `base64` must exclude the data-URI prefix. */
export function saveImage(productId: string, base64: string, mime = "image/jpeg"): void {
  dbPut<ProductImage>("product_images", { id: productId, base64, mime });
  fileCache.delete(productId);
  pending.delete(productId);
}

export function removeImage(productId: string): void {
  softDelete("product_images", productId);
  fileCache.delete(productId);
  pending.delete(productId);
}

/** Which products currently have an image — ids only, no base64 loaded. */
export function loadImageIds(): Set<string> {
  return new Set(loadIds("product_images"));
}

/** Synchronous peek: the file URI if it's already materialised. */
export function cachedImageUri(productId: string): string | undefined {
  return fileCache.get(productId);
}

/**
 * Get a renderable `file://` URI for a product's image, writing it to the cache
 * directory on first request. Returns null when the product has no image.
 */
export function getImageUri(productId: string): Promise<string | null> {
  const hit = fileCache.get(productId);
  if (hit) return Promise.resolve(hit);

  const inFlight = pending.get(productId);
  if (inFlight) return inFlight;

  const task = (async (): Promise<string | null> => {
    try {
      // Targeted read — never load the whole image collection for one photo.
      const row = loadOne<ProductImage>("product_images", productId);
      if (!row?.base64) return null;

      await ensureDir();
      const path = `${DIR}${productId}.${extFor(row.mime)}`;

      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) {
        await FileSystem.writeAsStringAsync(path, row.base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
      fileCache.set(productId, path);
      return path;
    } catch {
      return null;
    } finally {
      pending.delete(productId);
    }
  })();

  pending.set(productId, task);
  return task;
}

/**
 * Materialise many images in the background (after first paint) so scrolling
 * doesn't stall waiting on file writes. Fire-and-forget.
 */
export async function warmImageCache(productIds: string[]): Promise<void> {
  for (const id of productIds) {
    if (fileCache.has(id)) continue;
    await getImageUri(id);
  }
}
