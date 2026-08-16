/** Reproduce the guest order failure exactly as the page does it. */
const base = "https://gls-pos-server.sphade012.workers.dev";
const storeId = "store_5c7f7d15-3923-4812-9758-83d26d373180";
const tableId = "tbl_vip1";

// 1. What items does the page actually offer?
const menu = await fetch(`${base}/vip/api/${storeId}/${tableId}/menu`).then((r) => r.json());
console.log("menu ok:", menu.ok);
console.log("items:", JSON.stringify(menu.data?.items));

const first = menu.data?.items?.[0];
if (!first) { console.log("NO ITEMS — nothing to order"); process.exit(0); }

// 2. Post an order exactly like the browser does.
const res = await fetch(`${base}/vip/api/${storeId}/${tableId}/order`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ items: [{ productId: first.id, quantity: 1 }] }),
});
console.log("\nPOST status:", res.status);
console.log("content-type:", res.headers.get("content-type"));
const text = await res.text();
console.log("raw body:", text.slice(0, 400));
try { JSON.parse(text); console.log("parses as JSON: yes"); }
catch (e) { console.log("parses as JSON: NO ->", e.message); }
