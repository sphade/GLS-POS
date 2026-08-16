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

/** ₦ grouping, matching the POS formatter. */
const money = (minor: number) => {
  const whole = Math.floor(Math.abs(minor) / 100);
  const kobo = Math.abs(minor) % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return grouped + (kobo === 0 ? "" : "." + String(kobo).padStart(2, "0"));
};

/**
 * Premium dark-luxe theme: near-black canvas, warm gold accents, a serif
 * display face for headings against a clean sans for UI. Aims to feel like
 * high-end table service rather than a utility ordering form.
 */
const STYLES = `
  :root {
    --ink:#0E0F0C; --ink-2:#16180F; --card:#1C1E16; --line:rgba(255,255,255,.09);
    --gold:#C9A227; --gold-soft:#E4C767; --green:#5AA02C; --green-soft:#7CC24A;
    --text:#F4F1E8; --muted:#9A9787; --danger:#E05A4E;
  }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html { -webkit-text-size-adjust:100%; }
  body {
    margin:0; padding-bottom:120px; background:var(--ink); color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .serif { font-family:Georgia,"Times New Roman",serif; }

  /* ---------- header ---------- */
  header {
    position:relative; padding:34px 22px 26px; text-align:center;
    background:
      radial-gradient(120% 90% at 50% 0%, rgba(201,162,39,.16) 0%, rgba(201,162,39,0) 60%),
      linear-gradient(180deg,#14160F 0%, var(--ink) 100%);
    border-bottom:1px solid var(--line);
  }
  .crest {
    display:inline-flex; align-items:center; gap:9px; margin-bottom:14px;
    font-size:10px; font-weight:700; letter-spacing:3.4px; color:var(--gold);
  }
  .crest::before, .crest::after {
    content:""; width:26px; height:1px; background:linear-gradient(90deg,transparent,var(--gold));
  }
  .crest::after { background:linear-gradient(90deg,var(--gold),transparent); }
  header h1 {
    margin:0; font-size:30px; font-weight:400; letter-spacing:.4px; line-height:1.18;
  }
  .rule { width:44px; height:1px; background:var(--gold); margin:16px auto 12px; opacity:.75; }
  .seated { font-size:12px; letter-spacing:1.6px; color:var(--muted); text-transform:uppercase; }
  .seated strong { color:var(--text); font-weight:600; letter-spacing:1.6px; }

  /* ---------- category rail ---------- */
  nav {
    position:sticky; top:0; z-index:20; display:flex; gap:8px; overflow-x:auto;
    padding:13px 18px; background:rgba(14,15,12,.94); backdrop-filter:blur(14px);
    border-bottom:1px solid var(--line); scrollbar-width:none;
  }
  nav::-webkit-scrollbar { display:none; }
  nav button {
    flex:0 0 auto; border:1px solid var(--line); background:transparent; color:var(--muted);
    border-radius:100px; padding:9px 16px; font-size:11px; font-weight:700; letter-spacing:1.3px;
    text-transform:uppercase; transition:all .22s ease;
  }
  nav button.on { color:var(--ink); background:var(--gold); border-color:var(--gold); font-weight:800; }

  /* ---------- menu ---------- */
  h2 {
    display:flex; align-items:center; gap:14px; margin:34px 22px 14px;
    font-size:11px; font-weight:700; letter-spacing:3px; color:var(--gold); text-transform:uppercase;
  }
  h2::after { content:""; flex:1; height:1px; background:var(--line); }

  .item {
    display:flex; align-items:center; gap:16px; padding:17px 22px;
    border-bottom:1px solid var(--line);
  }
  .item:last-child { border-bottom:none; }
  .item .info { flex:1; min-width:0; }
  .item .nm { font-size:16px; font-weight:500; letter-spacing:.2px; line-height:1.3; }
  .item .pr { margin-top:6px; font-size:15px; color:var(--gold-soft); letter-spacing:.4px; }
  .item .out {
    margin-top:6px; font-size:10px; font-weight:700; letter-spacing:1.6px;
    color:var(--muted); text-transform:uppercase;
  }
  .item.gone .nm { color:var(--muted); }

  .add {
    flex:0 0 auto; border:1px solid var(--gold); background:transparent; color:var(--gold);
    border-radius:100px; padding:10px 20px; font-size:11px; font-weight:800; letter-spacing:1.4px;
    text-transform:uppercase; transition:all .2s ease;
  }
  .add:active { background:var(--gold); color:var(--ink); }
  .add:disabled { border-color:var(--line); color:var(--muted); }

  .stepper { flex:0 0 auto; display:flex; align-items:center; gap:4px;
             background:var(--card); border:1px solid var(--line); border-radius:100px; padding:4px; }
  .stepper button {
    width:34px; height:34px; border-radius:50%; border:none; background:transparent;
    color:var(--gold); font-size:19px; font-weight:400; line-height:1;
  }
  .stepper button:active { background:rgba(201,162,39,.16); }
  .stepper .q { min-width:26px; text-align:center; font-weight:700; font-size:15px; }

  /* ---------- sticky order bar ---------- */
  footer {
    position:fixed; left:0; right:0; bottom:0; z-index:30; padding:14px 18px 22px;
    background:linear-gradient(180deg, rgba(14,15,12,.4) 0%, var(--ink) 34%);
  }
  .cta {
    width:100%; border:none; height:56px; border-radius:100px; letter-spacing:1.6px;
    font-size:12px; font-weight:800; text-transform:uppercase; color:var(--ink);
    background:linear-gradient(135deg,var(--gold-soft),var(--gold));
    box-shadow:0 10px 30px rgba(201,162,39,.22); transition:opacity .2s ease;
  }
  .cta:disabled {
    background:var(--card); color:var(--muted); box-shadow:none; border:1px solid var(--line);
  }

  /* ---------- sheets ---------- */
  dialog {
    border:none; padding:0; width:min(96vw,470px); background:var(--ink-2); color:var(--text);
    border-radius:20px; border:1px solid var(--line);
  }
  dialog::backdrop { background:rgba(0,0,0,.72); backdrop-filter:blur(3px); }
  .sheet-h {
    padding:22px 22px 0; font-size:11px; font-weight:700; letter-spacing:3px;
    color:var(--gold); text-transform:uppercase; text-align:center;
  }
  .sheet-t { text-align:center; font-size:24px; font-weight:400; margin:8px 0 18px; }
  .sheet-b { padding:0 22px; max-height:56vh; overflow:auto; }
  .row { display:flex; justify-content:space-between; gap:12px; padding:11px 0;
         font-size:14px; border-bottom:1px solid var(--line); }
  .row span:first-child { color:var(--text); }
  .row span:last-child { color:var(--muted); white-space:nowrap; }
  .row.tot { border-bottom:none; margin-top:10px; padding-top:16px; border-top:1px solid var(--gold);
             font-size:19px; }
  .row.tot span { color:var(--text) !important; }
  .row.tot span:last-child { color:var(--gold-soft) !important; font-weight:700; }

  label { display:block; font-size:10px; font-weight:700; color:var(--muted);
          letter-spacing:1.8px; text-transform:uppercase; margin:18px 0 0; }
  input, textarea {
    width:100%; border:none; border-bottom:1px solid var(--line); padding:11px 0;
    font-size:15px; font-family:inherit; background:transparent; color:var(--text);
  }
  input:focus, textarea:focus { outline:none; border-bottom-color:var(--gold); }
  input::placeholder, textarea::placeholder { color:#6B6959; }
  textarea { resize:vertical; min-height:54px; }
  .ghost { background:none; border:none; color:var(--muted); font-weight:600;
           padding:14px; width:100%; font-size:13px; letter-spacing:.4px; }

  /* ---------- confirmation ---------- */
  .ok { text-align:center; padding:40px 26px 30px; }
  .ok .seal {
    width:66px; height:66px; margin:0 auto 20px; border-radius:50%;
    border:1px solid var(--gold); display:flex; align-items:center; justify-content:center;
    font-size:28px; color:var(--gold);
  }
  .ok .lead { font-size:11px; letter-spacing:3px; color:var(--muted); text-transform:uppercase; }
  .ok .code { font-size:38px; color:var(--gold); margin:10px 0 18px; letter-spacing:2px; }
  .ok p { color:var(--muted); font-size:14px; line-height:1.65; margin:6px 0; }
  .ok p strong { color:var(--text); font-weight:600; }

  .err { margin:80px 26px; text-align:center; }
  .err h2 { display:block; margin:0 0 12px; color:var(--gold); }
  .err p { color:var(--muted); line-height:1.6; }
`;

/** Full page: either the menu, or an error state for a bad link. */
export function renderVipPage(
  input: { menu: PublicMenu; storeId: string; tableId: string } | { error: string },
): string {
  if ("error" in input) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<meta name="theme-color" content="#0E0F0C" />
<title>VIP Service</title><style>${STYLES}</style></head>
<body><div class="err"><h2 class="serif">Something isn't right</h2>
<p>${esc(input.error)}</p><p>Please ask a member of our team for assistance.</p></div></body></html>`;
  }

  const { menu, storeId, tableId } = input;
  const used = menu.categories.filter((c) => menu.items.some((i) => i.categoryId === c.id));
  const loose = menu.items.filter((i) => !i.categoryId || !used.some((c) => c.id === i.categoryId));

  const sym = menu.currency === "NGN" ? "&#8358;" : esc(menu.currency) + " ";

  const itemHtml = (i: PublicMenu["items"][number]) => `
    <div class="item${i.available ? "" : " gone"}" data-id="${esc(i.id)}">
      <div class="info">
        <div class="nm serif">${esc(i.name)}</div>
        ${
          i.available
            ? `<div class="pr">${sym}${money(i.price)}</div>`
            : `<div class="out">Unavailable</div>`
        }
      </div>
      ${
        i.available
          ? `<button class="add" data-add="${esc(i.id)}" data-name="${esc(i.name)}" data-price="${i.price}">Add</button>
             <div class="stepper" data-step="${esc(i.id)}" hidden>
               <button data-dec="${esc(i.id)}" aria-label="one fewer">&minus;</button>
               <span class="q" data-qty="${esc(i.id)}">0</span>
               <button data-inc="${esc(i.id)}" aria-label="one more">+</button>
             </div>`
          : `<button class="add" disabled>Add</button>`
      }
    </div>`;

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
<meta name="theme-color" content="#0E0F0C" />
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
    <button class="cta" id="review" disabled>Your order is empty</button>
  </footer>

  ${renderDialogs()}
  <script>${clientScript(storeId, tableId, menu.currency)}</script>
</body></html>`;
}

function renderDialogs(): string {
  return `
  <dialog id="cart">
    <div class="sheet-h">Your Selection</div>
    <div class="sheet-t serif">Review &amp; confirm</div>
    <div class="sheet-b">
      <div id="lines"></div>
      <div class="row tot"><span>Total</span><span id="total">0</span></div>
      <label for="gname">Your name</label>
      <input id="gname" autocomplete="name" placeholder="Optional" />
      <label for="gphone">Phone</label>
      <input id="gphone" inputmode="tel" placeholder="Optional" />
      <label for="gnote">Note for the kitchen</label>
      <textarea id="gnote" placeholder="Allergies, preferences, anything at all"></textarea>
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
      <p><strong>Thank you — your order is with our kitchen.</strong></p>
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
  var cart = {};   // id -> { name, price, qty }
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
    var cta = document.getElementById("review");
    cta.disabled = true;
    cta.textContent = "Your order is empty";
  }

  function paint(id) {
    var step = document.querySelector('[data-step="' + id + '"]');
    var add = document.querySelector('[data-add="' + id + '"]');
    var qty = document.querySelector('[data-qty="' + id + '"]');
    var has = cart[id] && cart[id].qty > 0;
    if (step) step.hidden = !has;
    if (add) add.hidden = !!has;
    if (qty && cart[id]) qty.textContent = cart[id].qty;

    var cta = document.getElementById("review");
    var n = count();
    cta.disabled = n === 0;
    cta.textContent = n === 0 ? "Your order is empty"
      : "Review \\u00B7 " + n + (n === 1 ? " item \\u00B7 " : " items \\u00B7 ") + money(total());
  }

  document.getElementById("menu").addEventListener("click", function (e) {
    var t = e.target.closest("button");
    if (!t) return;
    var id = t.getAttribute("data-add") || t.getAttribute("data-inc") || t.getAttribute("data-dec");
    if (!id) return;

    if (t.hasAttribute("data-add")) {
      cart[id] = { name: t.getAttribute("data-name"), price: +t.getAttribute("data-price"), qty: 1 };
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
    var box = document.getElementById("lines");
    box.innerHTML = "";
    for (var id in cart) {
      var c = cart[id], row = document.createElement("div");
      row.className = "row";
      row.innerHTML = "<span>" + c.qty + " \\u00D7 " + c.name + "</span><span>" + money(c.qty * c.price) + "</span>";
      box.appendChild(row);
    }
    document.getElementById("total").textContent = money(total());
    cartDlg.showModal();
  });

  document.getElementById("closeCart").addEventListener("click", function () { cartDlg.close(); });

  document.getElementById("send").addEventListener("click", function () {
    var btn = this;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Sending\\u2026";

    var items = [];
    for (var id in cart) items.push({ productId: id, quantity: cart[id].qty });

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
