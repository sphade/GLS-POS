/**
 * Local preview for the restaurant website.
 *
 * The site is plain HTML/CSS/JS in `static/` (index.html, menu.html, ...), so
 * there is nothing to compile while editing it. SvelteKit still owns the two
 * product pages (/pos and /film); run `pnpm dev:svelte` for those.
 *
 * Serves `static/` with the same behaviour Cloudflare's static assets use:
 *   /              -> index.html
 *   /menu          -> menu.html
 *   /img/hero.webp -> the file
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../static", import.meta.url)));
const port = Number(process.env.PORT ?? 5174);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

async function resolveFile(urlPath) {
  const clean = decodeURIComponent((urlPath ?? "/").split("?")[0].split("#")[0]);
  const relative = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${sep}`)) return null;

  for (const candidate of [target, `${target}.html`, join(target, "index.html")]) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // Try the next shape.
    }
  }
  return null;
}

const server = createServer(async (request, response) => {
  const file = await resolveFile(request.url);
  if (!file) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  try {
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Could not read that file");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`GLS website: http://127.0.0.1:${port}`);
});
