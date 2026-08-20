const BASE = "https://gls-pos-server.sphade012.workers.dev";
const headers = { "content-type": "application/json", origin: "glspos://" };
const login = await fetch(`${BASE}/api/auth/sign-in/username`, { method: "POST", headers, body: JSON.stringify({ username: "admin", password: "adminGLS" }) });
console.log("login", login.status);
const cookie = (login.headers.getSetCookie?.() ?? []).map((v) => v.split(";")[0]).join("; ");
if (!cookie) throw new Error("no session cookie");
const storesRes = await fetch(`${BASE}/api/stores`, { headers: { cookie } });
const storesBody = await storesRes.json();
console.log("stores", storesRes.status, JSON.stringify(storesBody));
for (const store of storesBody.data ?? []) {
  const pull = await fetch(`${BASE}/api/sync?cursor=0`, { headers: { cookie, "x-store-id": store.id } });
  const body = await pull.json();
  const changes = body.data?.changes ?? [];
  const tables = changes.filter((c) => c.collection === "tables" && !c.deleted);
  const products = changes.filter((c) => c.collection === "products" && !c.deleted);
  const orders = changes.filter((c) => c.collection === "web_orders" && !c.deleted);
  console.log(JSON.stringify({ store: store.name, id: store.id, status: pull.status, cursor: body.data?.cursor, tables: tables.map((x) => [x.id, x.data?.name]), products: products.length, orders: orders.map((x) => ({ id: x.id, code: x.data?.code, table: x.data?.tableName, status: x.data?.status, createdAt: x.data?.createdAt })) }, null, 2));
}
