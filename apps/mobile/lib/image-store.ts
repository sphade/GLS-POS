import * as FileSystem from "expo-file-system";
import { getActiveStore, loadIds, loadOne, put as dbPut, softDelete } from "./db";

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

/**
 * Cache directory is per store. Seeded product ids are deterministic
 * (`gls_1`…`gls_62`), so two branches would otherwise overwrite each other's
 * photos in a shared folder.
 */
const dirFor = (storeId: string) =>
  `${FileSystem.cacheDirectory}item-images/${storeId.replace(/[^A-Za-z0-9_-]/g, "")}/`;

/** "<storeId>/<productId>" -> file:// URI, once materialised this session. */
const fileCache = new Map<string, string>();
/** In-flight materialisations, so concurrent cards don't duplicate work. */
const pending = new Map<string, Promise<string | null>>();

const dirsReady = new Map<string, Promise<void>>();
function ensureDir(storeId: string): Promise<void> {
  let task = dirsReady.get(storeId);
  if (!task) {
    task = FileSystem.makeDirectoryAsync(dirFor(storeId), { intermediates: true }).catch(() => {});
    dirsReady.set(storeId, task);
  }
  return task;
}

/** Scope cache keys by store so ids can't collide across branches. */
const keyFor = (productId: string) => `${getActiveStore()}/${productId}`;

const extFor = (mime: string) => (mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg");

/** Save (or replace) a product's image. `base64` must exclude the data-URI prefix. */
export function saveImage(productId: string, base64: string, mime = "image/jpeg"): void {
  dbPut<ProductImage>("product_images", { id: productId, base64, mime });
  fileCache.delete(keyFor(productId));
  pending.delete(keyFor(productId));
}

export function removeImage(productId: string): void {
  softDelete("product_images", productId);
  fileCache.delete(keyFor(productId));
  pending.delete(keyFor(productId));
}

/** Which products currently have an image — ids only, no base64 loaded. */
export function loadImageIds(): Set<string> {
  return new Set(loadIds("product_images"));
}

/** Synchronous peek: the file URI if it's already materialised. */
export function cachedImageUri(productId: string): string | undefined {
  return fileCache.get(keyFor(productId));
}

/**
 * Get a renderable `file://` URI for a product's image, writing it to the cache
 * directory on first request. Returns null when the product has no image.
 */
export function getImageUri(productId: string): Promise<string | null> {
  const storeId = getActiveStore();
  const key = `${storeId}/${productId}`;

  const hit = fileCache.get(key);
  if (hit) return Promise.resolve(hit);

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const task = (async (): Promise<string | null> => {
    try {
      // Targeted read — never load the whole image collection for one photo.
      const row = loadOne<ProductImage>("product_images", productId);
      if (!row?.base64) return null;

      await ensureDir(storeId);
      const path = `${dirFor(storeId)}${productId}.${extFor(row.mime)}`;

      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) {
        await FileSystem.writeAsStringAsync(path, row.base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
      fileCache.set(key, path);
      return path;
    } catch {
      return null;
    } finally {
      pending.delete(key);
    }
  })();

  pending.set(key, task);
  return task;
}

/**
 * Materialise many images in the background (after first paint) so scrolling
 * doesn't stall waiting on file writes. Fire-and-forget.
 */
export async function warmImageCache(productIds: string[]): Promise<void> {
  for (const id of productIds) {
    if (fileCache.has(keyFor(id))) continue;
    await getImageUri(id);
  }
}
