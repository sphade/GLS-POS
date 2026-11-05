import type { PublicMenu } from "@gls-pos/types";

/**
 * The VIP guest ordering page, served as a single self-contained HTML document.
 *
 * Deliberately no build step and no framework: it's one screen (browse, add to
 * cart, submit) and serving it straight from the Worker means no extra deploy
 * target, no CORS, and it loads fast on a phone over restaurant wifi.
 */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** First letter of a dish, for its tile (no product photos on this page yet). */
const initialOf = (name: string) => (name.trim().match(/[A-Za-z0-9]/)?.[0] ?? "•").toUpperCase();

/** ₦ grouping, matching the POS formatter. */
const money = (minor: number) => {
  const whole = Math.floor(Math.abs(minor) / 100);
  const kobo = Math.abs(minor) % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return grouped + (kobo === 0 ? "" : "." + String(kobo).padStart(2, "0"));
};

/**
 * GLS brand theme: white canvas, brand green accents, serif display face for
 * headings against a clean sans for UI. Same structure as the original
 * dark-luxe layout — only the palette changed, so guests get the shop's usual
 * colours instead of a one-off gold-on-black look.
 */
const STYLES = `
  :root {
    --bg:#F6F8F6; --card:#FFFFFF; --soft:#EEF5EE; --line:rgba(0,0,0,.07);
    --green:#4CAF50; --green-dark:#2E7D32; --green-soft:#66BB6A;
    --text:#1B1F1B; --muted:#6B736B; --danger:#C62828;
    --radius:18px; --shadow:0 1px 2px rgba(0,0,0,.04), 0 6px 18px rgba(0,0,0,.05);
  }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  /* The quantity steppers start hidden; display:flex must never override that. */
  [hidden] { display:none !important; }
  html { -webkit-text-size-adjust:100%; }
  html, body { overflow-x:hidden; }
  body {
    margin:0; padding-bottom:110px; background:var(--bg); color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  button { font-family:inherit; cursor:pointer; }
  button:focus { outline:none; }
  button:focus-visible { outline:2px solid var(--green); outline-offset:2px; }
  .serif { font-family:Georgia,"Times New Roman",serif; }

  /* ---------- header ---------- */
  header {
    padding:30px 22px 26px; text-align:center; color:#FFFFFF;
    background:
      radial-gradient(120% 120% at 100% 0%, rgba(255,255,255,.18) 0%, rgba(255,255,255,0) 55%),
      linear-gradient(160deg,var(--green-soft) 0%, var(--green-dark) 100%);
    border-radius:0 0 28px 28px;
  }
  .crest {
    display:inline-flex; align-items:center; gap:7px; margin-bottom:12px;
    padding:6px 12px; border-radius:100px; background:rgba(255,255,255,.18);
    font-size:11px; font-weight:700; letter-spacing:1.6px;
  }
  .crest::before { content:"\\2605"; font-size:11px; }
  header h1 { margin:0; font-size:29px; font-weight:400; line-height:1.18; }
  .rule { display:none; }
  .seated {
    display:inline-flex; align-items:center; gap:6px; margin-top:14px;
    padding:8px 14px; border-radius:100px; background:#FFFFFF; color:var(--muted);
    font-size:13px; box-shadow:0 4px 14px rgba(0,0,0,.12);
  }
  .seated strong { color:var(--green-dark); font-weight:800; }

  /* ---------- category rail ---------- */
  nav {
    position:sticky; top:0; z-index:20; display:flex; gap:8px; overflow-x:auto;
    padding:14px 16px 12px; background:rgba(246,248,246,.94); backdrop-filter:blur(14px);
    scrollbar-width:none;
  }
  nav::-webkit-scrollbar { display:none; }
  nav button {
    flex:0 0 auto; border:1px solid var(--line); background:var(--card); color:var(--text);
    border-radius:100px; padding:9px 16px; font-size:14px; font-weight:600;
    transition:background .2s ease, color .2s ease;
  }
  nav button.on { color:#FFFFFF; background:var(--green-dark); border-color:var(--green-dark); }

  /* ---------- menu ---------- */
  main { padding:0 14px; }
  h2 {
    margin:22px 6px 10px; font-family:Georgia,"Times New Roman",serif;
    font-size:21px; font-weight:400; color:var(--text);
  }

  .item {
    display:flex; align-items:center; gap:14px; padding:14px; margin-bottom:10px;
    background:var(--card); border-radius:var(--radius); box-shadow:var(--shadow);
    transition:box-shadow .2s ease, border-color .2s ease; border:1.5px solid transparent;
  }
  .item.picked { border-color:var(--green); }
  .item::before {
    content:attr(data-initial); flex:0 0 auto; width:52px; height:52px; border-radius:14px;
    display:flex; align-items:center; justify-content:center;
    background:var(--soft); color:var(--green-dark);
    font-family:Georgia,"Times New Roman",serif; font-size:22px;
  }
  .item.choices::before { display:none; }
  .item .info { flex:1; min-width:0; }
  .item .nm { font-size:16px; font-weight:600; line-height:1.3; }
  .item .pr { margin-top:5px; font-size:15px; color:var(--green-dark); font-weight:800; }
  .item .out { margin-top:4px; font-size:13px; color:var(--muted); }
  .item.gone { opacity:.6; box-shadow:none; }
  .item.gone .nm { color:var(--muted); }
  .soldout {
    display:inline-block; margin-top:6px; padding:4px 10px; border-radius:100px;
    background:#FDECEA; color:var(--danger); font-size:12px; font-weight:700;
  }
  .variant-row .soldout { margin-top:0; }

  .add {
    flex:0 0 auto; border:none; background:var(--green); color:#FFFFFF;
    border-radius:100px; height:40px; padding:0 18px; font-size:14px; font-weight:700;
    display:inline-flex; align-items:center; gap:4px; transition:transform .12s ease, background .2s ease;
  }
  .add::before { content:"+"; font-size:18px; line-height:1; margin-top:-1px; }
  .add:active { transform:scale(.94); background:var(--green-dark); }

  .item.choices { display:block; }
  .variant-list { margin-top:10px; }
  .variant-row {
    display:flex; align-items:center; gap:12px; padding:11px 12px; margin-top:8px;
    border-radius:14px; background:var(--bg);
  }
  .variant-info { flex:1; min-width:0; }
  .variant-name { font-size:15px; font-weight:600; color:var(--text); }
  .variant-price { margin-top:3px; font-size:14px; color:var(--green-dark); font-weight:700; }
  .variant-row.gone { opacity:.6; }
  .variant-row.gone .variant-name, .variant-row.gone .variant-price { color:var(--muted); }
  .variant-row .add { height:36px; padding:0 14px; }

  .stepper { flex:0 0 auto; display:flex; align-items:center; gap:2px;
             background:var(--green-dark); border-radius:100px; padding:3px; }
  .stepper button {
    width:34px; height:34px; border-radius:50%; border:none; background:rgba(255,255,255,.16);
    color:#FFFFFF; font-size:19px; line-height:1;
  }
  .stepper button:active { background:rgba(255,255,255,.32); }
  .stepper .q { min-width:26px; text-align:center; font-weight:800; font-size:15px; color:#FFFFFF; }

  /* ---------- sticky order bar ---------- */
  footer {
    position:fixed; left:0; right:0; bottom:0; z-index:30; padding:12px 14px 18px;
    background:linear-gradient(180deg, rgba(246,248,246,0) 0%, var(--bg) 40%);
  }
  .cta {
    width:100%; border:none; height:56px; border-radius:18px; padding:0 18px;
    font-size:16px; font-weight:700; color:#FFFFFF; background:var(--green-dark);
    box-shadow:0 10px 26px rgba(46,125,50,.28); transition:transform .12s ease, opacity .2s ease;
  }
  .cta:active { transform:scale(.98); }
  /* Dialogs focus their first button on open; no ring for that. */
  dialog button:focus-visible { outline:none; }
  .cta:disabled { background:#DDE3DD; color:var(--muted); box-shadow:none; }
  #review { display:flex; align-items:center; gap:12px; }
  #review .n {
    min-width:30px; height:30px; padding:0 8px; border-radius:10px; background:rgba(255,255,255,.2);
    display:inline-flex; align-items:center; justify-content:center; font-weight:800;
  }
  #review .l { flex:1; text-align:left; }
  #review:disabled .l { text-align:center; }
  #review .t { font-weight:800; }

  /* ---------- sheets ---------- */
  dialog {
    border:none; padding:0; width:100%; max-width:520px; margin:auto auto 0;
    background:var(--card); color:var(--text); border-radius:26px 26px 0 0;
    box-shadow:0 -10px 40px rgba(0,0,0,.18); max-height:92vh;
  }
  dialog[open] { animation:up .26s ease-out; }
  @keyframes up { from { transform:translateY(40px); opacity:0; } to { transform:none; opacity:1; } }
  dialog::backdrop { background:rgba(0,0,0,.45); backdrop-filter:blur(2px); }
  dialog::before {
    content:""; display:block; width:42px; height:5px; border-radius:3px;
    background:#D5DBD5; margin:10px auto 0;
  }
  .sheet-h { padding:14px 22px 0; font-size:13px; font-weight:600; color:var(--muted); text-align:center; }
  .sheet-t { text-align:center; font-size:24px; font-weight:400; margin:4px 0 14px; }
  .sheet-b { padding:0 20px; max-height:58vh; overflow:auto; }
  .row { display:flex; align-items:center; gap:12px; padding:12px 0; font-size:15px;
         border-bottom:1px solid var(--line); }
  .row .rn { flex:1; min-width:0; font-weight:600; }
  .row .ra { color:var(--text); font-weight:700; white-space:nowrap; }
  .row .stepper { padding:2px; }
  .row .stepper button { width:30px; height:30px; font-size:17px; }
  .row .stepper .q { min-width:22px; font-size:14px; }
  .row.tot { border-bottom:none; margin-top:4px; padding:14px 0 4px; font-size:18px; }
  .row.tot span:first-child { flex:1; color:var(--muted); font-weight:600; }
  .row.tot span:last-child { color:var(--green-dark); font-weight:800; font-size:22px; }

  .fields { margin-top:12px; background:var(--bg); border-radius:16px; padding:4px 14px 10px; }
  label { display:block; font-size:12px; font-weight:700; color:var(--muted); margin:12px 0 4px; }
  input, textarea {
    width:100%; border:1.5px solid transparent; border-radius:12px; padding:12px 13px;
    font-size:16px; font-family:inherit; background:var(--card); color:var(--text);
  }
  input:focus, textarea:focus { outline:none; border-color:var(--green); }
  input::placeholder, textarea::placeholder { color:#9EA59E; }
  textarea { resize:vertical; min-height:70px; }
  .ghost { background:none; border:none; color:var(--muted); font-weight:600;
           padding:14px; width:100%; font-size:15px; }

  /* ---------- confirmation ---------- */
  #done { border-radius:26px; margin:auto; width:calc(100% - 32px); max-width:420px; }
  #done::before { display:none; }
  .ok { text-align:center; padding:34px 24px 22px; }
  .ok .seal {
    width:76px; height:76px; margin:0 auto 18px; border-radius:50%;
    background:var(--green); color:#FFFFFF; font-family:inherit;
    display:flex; align-items:center; justify-content:center; font-size:36px;
    box-shadow:0 0 0 10px var(--soft); animation:pop .4s ease-out;
  }
  @keyframes pop { from { transform:scale(.5); opacity:0; } to { transform:none; opacity:1; } }
  .ok .lead { font-size:13px; color:var(--muted); font-weight:600; }
  .ok .code {
    display:inline-block; font-size:34px; color:var(--green-dark); margin:8px 0 16px;
    padding:6px 18px; border-radius:14px; background:var(--soft); letter-spacing:2px;
  }
  .ok p { color:var(--muted); font-size:15px; line-height:1.6; margin:6px 0; }
  .ok p strong { color:var(--text); font-weight:700; }

  .err { margin:80px 26px; text-align:center; }
  .err h2 { margin:0 0 12px; color:var(--green-dark); }
  .err p { color:var(--muted); line-height:1.6; }
`;

/** Full page: either the menu, or an error state for a bad link. */
export function renderVipPage(
  input: { menu: PublicMenu; storeId: string; tableId: string } | { error: string },
): string {
  if ("error" in input) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<meta name="theme-color" content="#4CAF50" />
<title>VIP Service</title><style>${STYLES}</style></head>
<body><div class="err"><h2 class="serif">Something isn't right</h2>
<p>${esc(input.error)}</p><p>Please ask a member of our team for assistance.</p></div></body></html>`;
  }

  const { menu, storeId, tableId } = input;
  const used = menu.categories.filter((c) => menu.items.some((i) => i.categoryId === c.id));
  const loose = menu.items.filter((i) => !i.categoryId || !used.some((c) => c.id === i.categoryId));

  const sym = menu.currency === "NGN" ? "&#8358;" : esc(menu.currency) + " ";

  const itemHtml = (i: PublicMenu["items"][number]) => {
    if (i.variants?.length) {
      const variants = i.variants
        .map((variant) => {
          const key = `${i.id}:${variant.id}`;
          return `<div class="variant-row${variant.available ? "" : " gone"}">
            <div class="variant-info">
              <div class="variant-name">${esc(variant.name)}</div>
              <div class="variant-price">${sym}${money(variant.price)}</div>
            </div>
            ${
              variant.available
                ? `<button class="add" data-add="${esc(key)}" data-product="${esc(i.id)}" data-variant="${esc(variant.id)}" data-name="${esc(`${i.name} · ${variant.name}`)}" data-price="${variant.price}">Add</button>
                   <div class="stepper" data-step="${esc(key)}" hidden>
                     <button data-dec="${esc(key)}" aria-label="one fewer">&minus;</button>
                     <span class="q" data-qty="${esc(key)}">0</span>
                     <button data-inc="${esc(key)}" aria-label="one more">+</button>
                   </div>`
                : `<span class="soldout">Out of stock</span>`
            }
          </div>`;
        })
        .join("");

      return `<div class="item choices${i.available ? "" : " gone"}" data-id="${esc(i.id)}" data-initial="${esc(initialOf(i.name))}">
        <div class="info">
          <div class="nm serif">${esc(i.name)}</div>
          <div class="out">${i.available ? "Choose a variant" : "Out of stock"}</div>
          <div class="variant-list">${variants}</div>
        </div>
      </div>`;
    }

    return `<div class="item${i.available ? "" : " gone"}" data-id="${esc(i.id)}" data-initial="${esc(initialOf(i.name))}">
      <div class="info">
        <div class="nm serif">${esc(i.name)}</div>
        ${
          i.available
            ? `<div class="pr">${sym}${money(i.price)}</div>`
            : `<div class="soldout">Out of stock</div>`
        }
      </div>
      ${
        i.available
          ? `<button class="add" data-add="${esc(i.id)}" data-product="${esc(i.id)}" data-name="${esc(i.name)}" data-price="${i.price}">Add</button>
             <div class="stepper" data-step="${esc(i.id)}" hidden>
               <button data-dec="${esc(i.id)}" aria-label="one fewer">&minus;</button>
               <span class="q" data-qty="${esc(i.id)}">0</span>
               <button data-inc="${esc(i.id)}" aria-label="one more">+</button>
             </div>`
          : ``
      }
    </div>`;
  };

  const sections = [
    ...used.map(
      (c) => `<h2 data-cat="${esc(c.id)}">${esc(c.name)}</h2>${menu.items
        .filter((i) => i.categoryId === c.id)
        .map(itemHtml)
        .join("")}`,
    ),
    loose.length ? `<h2>Also</h2>${loose.map(itemHtml).join("")}` : "",
  ].join("");

  const tabs = [
    `<button class="on" data-jump="all">All</button>`,
    ...used.map((c) => `<button data-jump="${esc(c.id)}">${esc(c.name)}</button>`),
  ].join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<meta name="theme-color" content="#4CAF50" />
<title>${esc(menu.storeName)} · VIP Service</title>
<style>${STYLES}</style></head>
<body>
  <header>
    <div class="crest">VIP TABLE SERVICE</div>
    <h1 class="serif">${esc(menu.storeName)}</h1>
    <div class="rule"></div>
    <div class="seated">Seated at <strong>${esc(menu.tableName)}</strong></div>
  </header>

  <nav id="tabs">${tabs}</nav>
  <main id="menu">${sections}</main>

  <footer>
    <button class="cta" id="review" disabled><span class="l">Tap + to add dishes</span></button>
  </footer>

  ${renderDialogs()}
  <script>${clientScript(storeId, tableId, menu.currency)}</script>
</body></html>`;
}

function renderDialogs(): string {
  return `
  <dialog id="cart">
    <div class="sheet-h">Your order</div>
    <div class="sheet-t serif">Review &amp; send</div>
    <div class="sheet-b">
      <div id="lines"></div>
      <div class="row tot"><span>Total</span><span id="total">0</span></div>
      <div class="fields">
        <label for="gname">Your name <span style="font-weight:500">(optional)</span></label>
        <input id="gname" autocomplete="name" placeholder="So we know who it's for" />
        <label for="gphone">Phone <span style="font-weight:500">(optional)</span></label>
        <input id="gphone" inputmode="tel" placeholder="080..." />
        <label for="gnote">Note for the kitchen</label>
        <textarea id="gnote" placeholder="Allergies, less pepper, no onions..."></textarea>
      </div>
    </div>
    <div style="padding:20px 22px 20px">
      <button class="cta" id="send">Send to kitchen</button>
      <button class="ghost" id="closeCart">Continue browsing</button>
    </div>
  </dialog>

  <dialog id="done">
    <div class="ok">
      <div class="seal serif">&#10003;</div>
      <div class="lead">Order reference</div>
      <div class="code serif" id="code"></div>
      <p><strong>Thank you! Your order is with our kitchen.</strong></p>
      <p>We'll bring it to <strong id="tbl"></strong> shortly.<br/>
         Settle the bill when your receipt arrives.</p>
      <button class="cta" id="again" style="margin-top:24px">Order something else</button>
    </div>
  </dialog>`;
}

/**
 * Browser logic: cart state, quantity steppers, category jump, submit.
 * Plain DOM so there's nothing to bundle. Returned as a string and inlined.
 */
function clientScript(storeId: string, tableId: string, currency: string): string {
  const sym = currency === "NGN" ? "\\u20A6" : currency + " ";
  return `
(function () {
  var cart = {};   // productId or productId:variantId -> selection
  var SYM = "${sym}";

  function money(minor) {
    var whole = Math.floor(Math.abs(minor) / 100), kobo = Math.abs(minor) % 100;
    var g = String(whole).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
    return SYM + g + (kobo === 0 ? "" : "." + String(kobo).padStart(2, "0"));
  }
  function count() { var n = 0; for (var k in cart) n += cart[k].qty; return n; }
  function total() { var t = 0; for (var k in cart) t += cart[k].qty * cart[k].price; return t; }

  /** Reset every row's stepper back to "Add" (used after an order is sent). */
  function paintAll() {
    [].forEach.call(document.querySelectorAll("[data-step]"), function (el) {
      el.hidden = true;
    });
    [].forEach.call(document.querySelectorAll("[data-add]"), function (el) {
      el.hidden = false;
    });
    [].forEach.call(document.querySelectorAll(".item.picked"), function (el) {
      el.classList.remove("picked");
    });
    paintBar();
  }

  /** The sticky order bar: count, label and running total. */
  function paintBar() {
    var cta = document.getElementById("review");
    var n = count();
    cta.disabled = n === 0;
    cta.innerHTML = n === 0
      ? '<span class="l">Tap + to add dishes</span>'
      : '<span class="n"></span><span class="l">View order</span><span class="t"></span>';
    if (n > 0) {
      cta.querySelector(".n").textContent = n;
      cta.querySelector(".t").textContent = money(total());
    }
  }

  /** Highlight a dish card while any of its choices is in the order. */
  function paintCard(id) {
    var add = document.querySelector('[data-add="' + id + '"]');
    var card = add && add.closest(".item");
    if (!card) return;
    var picked = false;
    [].forEach.call(card.querySelectorAll("[data-add]"), function (b) {
      var key = b.getAttribute("data-add");
      if (cart[key] && cart[key].qty > 0) picked = true;
    });
    card.classList.toggle("picked", picked);
  }

  /** Cart sheet rows, each with its own stepper so guests can fix quantities here. */
  function paintLines() {
    var box = document.getElementById("lines");
    box.innerHTML = "";
    for (var id in cart) {
      var c = cart[id], row = document.createElement("div");
      row.className = "row";
      var name = document.createElement("span");
      name.className = "rn";
      name.textContent = c.name;
      var step = document.createElement("div");
      step.className = "stepper";
      var dec = document.createElement("button");
      dec.setAttribute("data-cdec", id);
      dec.setAttribute("aria-label", "one fewer");
      dec.innerHTML = "&minus;";
      var q = document.createElement("span");
      q.className = "q";
      q.textContent = c.qty;
      var inc = document.createElement("button");
      inc.setAttribute("data-cinc", id);
      inc.setAttribute("aria-label", "one more");
      inc.textContent = "+";
      step.appendChild(dec); step.appendChild(q); step.appendChild(inc);
      var amount = document.createElement("span");
      amount.className = "ra";
      amount.textContent = money(c.qty * c.price);
      row.appendChild(name); row.appendChild(step); row.appendChild(amount);
      box.appendChild(row);
    }
    document.getElementById("total").textContent = money(total());
  }

  function paint(id) {
    var step = document.querySelector('[data-step="' + id + '"]');
    var add = document.querySelector('[data-add="' + id + '"]');
    var qty = document.querySelector('[data-qty="' + id + '"]');
    var has = cart[id] && cart[id].qty > 0;
    if (step) step.hidden = !has;
    if (add) add.hidden = !!has;
    if (qty && cart[id]) qty.textContent = cart[id].qty;
    paintCard(id);
    paintBar();
  }

  document.getElementById("menu").addEventListener("click", function (e) {
    var t = e.target.closest("button");
    if (!t) return;
    var id = t.getAttribute("data-add") || t.getAttribute("data-inc") || t.getAttribute("data-dec");
    if (!id) return;

    if (t.hasAttribute("data-add")) {
      cart[id] = {
        productId: t.getAttribute("data-product"),
        variantId: t.getAttribute("data-variant") || undefined,
        name: t.getAttribute("data-name"),
        price: +t.getAttribute("data-price"),
        qty: 1
      };
    } else if (t.hasAttribute("data-inc")) {
      if (cart[id] && cart[id].qty < 99) cart[id].qty++;
    } else {
      if (cart[id]) { cart[id].qty--; if (cart[id].qty <= 0) delete cart[id]; }
    }
    if (navigator.vibrate) navigator.vibrate(8);
    paint(id);
  });

  // Category tabs scroll to the matching heading.
  document.getElementById("tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    [].forEach.call(this.querySelectorAll("button"), function (x) { x.classList.remove("on"); });
    b.classList.add("on");
    var key = b.getAttribute("data-jump");
    if (key === "all") { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    // Headings carry their category id, so this doesn't depend on label text.
    var head = document.querySelector('#menu h2[data-cat="' + key + '"]');
    if (head) window.scrollTo({ top: head.offsetTop - 76, behavior: "smooth" });
  });

  var cartDlg = document.getElementById("cart");
  var doneDlg = document.getElementById("done");

  document.getElementById("review").addEventListener("click", function () {
    paintLines();
    cartDlg.showModal();
  });

  // Quantity changes inside the cart sheet keep the menu in step.
  document.getElementById("lines").addEventListener("click", function (e) {
    var t = e.target.closest("button");
    if (!t) return;
    var id = t.getAttribute("data-cinc") || t.getAttribute("data-cdec");
    if (!id || !cart[id]) return;
    if (t.hasAttribute("data-cinc")) { if (cart[id].qty < 99) cart[id].qty++; }
    else { cart[id].qty--; if (cart[id].qty <= 0) delete cart[id]; }
    if (navigator.vibrate) navigator.vibrate(8);
    paint(id);
    if (count() === 0) { cartDlg.close(); return; }
    paintLines();
  });

  // Tapping the dimmed backdrop closes the sheet, like any phone sheet.
  cartDlg.addEventListener("click", function (e) { if (e.target === cartDlg) cartDlg.close(); });

  document.getElementById("closeCart").addEventListener("click", function () { cartDlg.close(); });

  document.getElementById("send").addEventListener("click", function () {
    var btn = this;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Sending\\u2026";

    var items = [];
    for (var id in cart) {
      var selection = cart[id];
      items.push({
        productId: selection.productId,
        variantId: selection.variantId,
        quantity: selection.qty
      });
    }

    fetch("/vip/api/${storeId}/${tableId}/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items,
        guestName: document.getElementById("gname").value || undefined,
        guestPhone: document.getElementById("gphone").value || undefined,
        note: document.getElementById("gnote").value || undefined
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        btn.disabled = false;
        btn.textContent = "Send to kitchen";
        if (!body.ok) {
          alert((body.error && body.error.message) || "We couldn't send your order. Please let a member of our team know.");
          // Something sold out since the page loaded: reload so it shows as out of stock.
          if (body.error && body.error.code === "insufficient_stock") location.reload();
          return;
        }
        cart = {};
        cartDlg.close();
        document.getElementById("code").textContent = body.data.code;
        // Read the table name defensively: a missing node must never turn a
        // successful order into a scary error (this exact bug shipped once).
        var seatedEl = document.querySelector("header .seated strong");
        document.getElementById("tbl").textContent = seatedEl ? seatedEl.textContent : "your table";
        paintAll();
        doneDlg.showModal();
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "Send to kitchen";
        // Only a genuine fetch rejection means the network failed. Anything
        // else is our bug, so say so rather than blaming the connection.
        var offline = (err && err.name === "TypeError") || !navigator.onLine;
        alert(offline
          ? "No connection just now. Please try again or ask a member of our team."
          : "Your order may have gone through — please check with a member of our team before re-sending.");
      });
  });

  document.getElementById("again").addEventListener("click", function () {
    doneDlg.close();
    location.reload();
  });
})();
`;
}
