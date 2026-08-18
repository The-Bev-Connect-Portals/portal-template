import { BRAND } from "../brand.config.js";

/* ═══════════════════════════════════════════════════════════
   Boot: theme tokens, fonts, document chrome
   ═══════════════════════════════════════════════════════════ */

const root = document.documentElement;
const C = BRAND.colors;
root.style.setProperty("--bg", C.bg);
root.style.setProperty("--surface", C.surface);
root.style.setProperty("--surface-alt", C.surfaceAlt);
root.style.setProperty("--text", C.text);
root.style.setProperty("--muted", C.muted);
root.style.setProperty("--line", C.line);
root.style.setProperty("--accent", C.accent);
root.style.setProperty("--accent-text", C.accentText);
root.style.setProperty("--gold", C.gold);
root.style.setProperty("--font-display", BRAND.fonts.display);
root.style.setProperty("--font-body", BRAND.fonts.body);

function link(rel, href, extra = {}) {
  const el = document.createElement("link");
  el.rel = rel; el.href = href;
  Object.assign(el, extra);
  document.head.appendChild(el);
}
link("stylesheet", BRAND.fonts.googleFontsHref);
if (BRAND.favicon) link("icon", BRAND.favicon);

document.title = `Shop ${BRAND.name}`;

/* ═══════════════════════════════════════════════════════════
   Storefront API
   ═══════════════════════════════════════════════════════════ */

const ENDPOINT = `https://${BRAND.shopDomain}/api/${BRAND.apiVersion}/graphql.json`;
const CACHE_KEY = `catalog:${BRAND.slug}`;
const CACHE_TTL = 5 * 60 * 1000;

async function gql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": BRAND.storefrontToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Storefront API returned ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message || "Query failed");
  return json.data;
}

// Catalog is scoped by COLLECTION HANDLE, not by vendor.
//
// The vendor field on this store is written to by installed apps (Route,
// Rise.ai, Fast Bundle, BYOB), so filtering on it returns wrong or partial
// catalogs with no error. A smart collection built on the `portal:<slug>`
// tag is the only reliable boundary between brands.
//
// `collection` comes back null when the handle doesn't exist — that is
// caught below and raised loudly rather than rendering an empty grid,
// because an empty grid looks like "no stock" and hides a config typo.
const CATALOG_QUERY = `
  query Catalog($handle: String!) {
    collection(handle: $handle) {
      handle
      products(first: 100) {
        edges { node {
          id title handle description descriptionHtml tags availableForSale
          featuredImage { url altText width height }
          priceRange { minVariantPrice { amount currencyCode } }
          variants(first: 20) { edges { node {
            id title availableForSale
            price { amount currencyCode }
            selectedOptions { name value }
          }}}
        }}
      }
    }
  }`;

// Demo mode: while BRAND.demoProducts is a non-empty array the portal
// renders from it and never calls Shopify. Used for pitch previews before
// the client's products exist in the store. Set it to [] to go live.
const DEMO = Array.isArray(BRAND.demoProducts) && BRAND.demoProducts.length > 0;

function demoCatalog() {
  return BRAND.demoProducts.map((p) => ({
    ...p,
    variants: [{
      id: `${p.id}-variant`,
      title: "Default Title",
      inStock: p.inStock !== false,
      price: p.price,
    }],
  }));
}

function splitDescription(html, fallback) {
  if (!html) return { description: fallback || "", specs: [] };
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const lead = doc.querySelector("p")?.textContent?.trim();
    const specs = [...doc.querySelectorAll("li")]
      .map((li) => li.textContent.trim()).filter(Boolean);
    return { description: lead || fallback || "", specs };
  } catch {
    return { description: fallback || "", specs: [] };
  }
}

async function loadCatalog() {
  if (DEMO) return demoCatalog();

  try {
    const hit = sessionStorage.getItem(CACHE_KEY);
    if (hit) {
      const { at, data } = JSON.parse(hit);
      if (Date.now() - at < CACHE_TTL) return data;
    }
  } catch { /* cache is best-effort */ }

  const data = await gql(CATALOG_QUERY, { handle: BRAND.collectionHandle });

  // Fail loud. A missing collection is a configuration error, not an
  // empty catalog, and the two must never look the same on screen.
  if (!data.collection) {
    throw new Error(
      `Collection "${BRAND.collectionHandle}" was not found on ` +
      `${BRAND.shopDomain}. Check collectionHandle in brand.config.js, ` +
      `and that the collection is published to this Headless storefront.`
    );
  }

  const products = data.collection.products.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    tags: node.tags || [],
    ...splitDescription(node.descriptionHtml, node.description),
    inStock: node.availableForSale,
    image: node.featuredImage?.url || null,
    alt: node.featuredImage?.altText || node.title,
    price: node.priceRange.minVariantPrice,
    variants: node.variants.edges.map((v) => ({
      id: v.node.id,
      title: v.node.title,
      inStock: v.node.availableForSale,
      price: v.node.price,
      options: v.node.selectedOptions || [],
    })),
  }));

  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: products }));
  } catch { /* quota — non-fatal */ }

  return products;
}

/* ═══════════════════════════════════════════════════════════
   Cart — localStorage, keyed per brand so two portals open in
   one browser never collide.
   ═══════════════════════════════════════════════════════════ */

const CART_KEY = `cart:${BRAND.slug}`;
let cart = [];

try {
  cart = JSON.parse(localStorage.getItem(CART_KEY)) || [];
  if (!Array.isArray(cart)) cart = [];
} catch { cart = []; }

function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
  renderCartButton();
  renderCart();
}

// `variant` is explicit. Products with more than one variant (the 6-pack
// / 12-pack samplers) render a chooser, and the card passes whichever the
// shopper selected. Falling back to "first in stock" here would silently
// add a 6-pack when they picked the 12.
function addToCart(product, variant) {
  if (!variant) variant = product.variants.find((v) => v.inStock) || product.variants[0];
  if (!variant) return;
  const existing = cart.find((l) => l.variantId === variant.id);
  if (existing) existing.qty += 1;
  else cart.push({
    variantId: variant.id,
    title: product.title,
    variantTitle: variant.title === "Default Title" ? null : variant.title,
    price: variant.price.amount,
    currency: variant.price.currencyCode,
    image: product.image,
    qty: 1,
  });
  saveCart();
}

function setQty(variantId, qty) {
  const line = cart.find((l) => l.variantId === variantId);
  if (!line) return;
  line.qty = qty;
  if (line.qty < 1) cart = cart.filter((l) => l.variantId !== variantId);
  saveCart();
}

const cartCount = () => cart.reduce((n, l) => n + l.qty, 0);
const cartTotal = () => cart.reduce((n, l) => n + Number(l.price) * l.qty, 0);

/* ── Minimum order quantity ──────────────────────────────────
   This is expectation-setting, not enforcement. The cart lives in
   localStorage and the Shopify checkout URL is a plain link, so anything
   decided here can be walked around. The binding rule is the Yuko
   validation function on the store, which runs server-side at checkout
   and cannot be bypassed — including by Shop Pay and the other express
   buttons. Keep BRAND.minOrder.scope in step with how Yuko is configured
   or the site will promise one rule and checkout will enforce another.
   ──────────────────────────────────────────────────────────── */

const MIN = BRAND.minOrder || {};
const MIN_QTY = Number(MIN.qty) || 0;
const MIN_ON = MIN.active === true && MIN_QTY > 1;

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Returns a shopper-facing string when the cart is below the minimum,
// or null when it's fine. Null is the signal that checkout may proceed.
function minOrderIssue() {
  if (!MIN_ON || !cart.length) return null;

  if (MIN.scope === "line") {
    const under = cart.filter((l) => l.qty < MIN_QTY);
    if (!under.length) return null;
    if (under.length === 1) {
      const l = under[0];
      return `Minimum ${MIN_QTY} of each item. Add ` +
             `${plural(MIN_QTY - l.qty, "more")} of ${shortTitle(l.title)}.`;
    }
    return `Minimum ${MIN_QTY} of each item. ` +
           `${under.length} items in your cart are below that.`;
  }

  const short = MIN_QTY - cartCount();
  if (short <= 0) return null;
  return `Minimum order is ${plural(MIN_QTY, "item")}. ` +
         `Add ${plural(short, "more item")} to check out.`;
}

const money = (amount, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));

/* ═══════════════════════════════════════════════════════════
   Render
   ═══════════════════════════════════════════════════════════ */

const $ = (sel) => document.querySelector(sel);
let allProducts = [];
let activeFilter = null;

// Derive a display style label from the product's tags.
const STYLE_TAGS = BRAND.filters.filter((f) => f.tag).map((f) => f.tag);
function styleLabel(product) {
  const match = STYLE_TAGS.find((t) => product.tags.includes(t));
  if (!match) return "";
  return BRAND.filters.find((f) => f.tag === match)?.label || "";
}

function matchesFilter(product) {
  return !activeFilter || product.tags.includes(activeFilter);
}

function renderFilters() {
  const list = $("#filters");
  list.innerHTML = "";
  for (const f of BRAND.filters) {
    const count = f.tag
      ? allProducts.filter((p) => p.tags.includes(f.tag)).length
      : allProducts.length;
    if (f.tag && count === 0) continue;   // hide filters with nothing behind them

    const li = document.createElement("li");
    li.className = "filters__item";
    const btn = document.createElement("button");
    btn.className = "filters__btn";
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(activeFilter === f.tag));
    btn.innerHTML = `<span>${f.label}</span><span class="filters__count">${count}</span>`;
    btn.addEventListener("click", () => {
      activeFilter = f.tag;
      renderFilters();
      renderGrid();
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
}

function renderGrid() {
  const grid = $("#grid");
  const shown = allProducts.filter(matchesFilter);

  if (!shown.length) {
    grid.innerHTML = "";
    grid.className = "";
    const L = BRAND.labels || {};
    grid.innerHTML = `<div class="state">
      <h2 class="state__title">${escapeHtml(L.emptyFilterTitle || "Nothing here yet")}</h2>
      <p>${escapeHtml(L.emptyFilterLine || "Nothing matches that filter right now.")}</p>
    </div>`;
    return;
  }

  grid.className = "grid";
  grid.innerHTML = "";

  for (const p of shown) grid.appendChild(renderCard(p));
}

/* ── Product card ─────────────────────────────────────────────
   Single-variant products show a price and an Add button, as before.
   Multi-variant products (samplers: 6-pack / 12-pack) get a chooser
   above the price, and the price and Add button track the selection.

   The chooser is segmented buttons up to four options and a <select>
   beyond that — buttons are a bigger tap target and show all the prices
   at once, but stop fitting on a 375px card past four.
   ──────────────────────────────────────────────────────────── */

const MULTI_AS_BUTTONS_MAX = 4;

function renderCard(p) {
  const L = BRAND.labels || {};
  const card = document.createElement("article");
  card.className = "card" + (p.inStock ? "" : " card--out");

  const style = styleLabel(p);
  const limited = p.tags.includes("limited-release");
  const multi = p.variants.length > 1;

  // Default to the first in-stock variant so a sold-out 12-pack doesn't
  // land the shopper on a disabled button for a product that IS buyable.
  let selected = p.variants.find((v) => v.inStock) || p.variants[0];

  card.innerHTML = `
    <div class="card__media">
      ${p.image
        ? `<img src="${p.image}" alt="${escapeAttr(p.alt)}" loading="lazy" width="600" height="600">`
        : ""}
      ${!p.inStock ? `<span class="card__flag card__flag--out">${escapeHtml(L.soldOutLabel || "Sold out")}</span>`
        : limited ? `<span class="card__flag">Limited</span>` : ""}
    </div>
    <div class="card__body">
      ${style ? `<span class="card__style">${style}</span>` : ""}
      <h3 class="card__title">${escapeHtml(shortTitle(p.title))}</h3>
      ${p.description ? `<p class="card__note">${escapeHtml(p.description)}</p>` : ""}
      ${p.specs?.length ? `<p class="card__spec">${escapeHtml(p.specs.join(" \u00b7 "))}</p>` : ""}
      <div class="card__foot">
        <span class="card__price"></span>
      </div>
    </div>`;

  const body = card.querySelector(".card__body");
  const foot = card.querySelector(".card__foot");
  const priceEl = card.querySelector(".card__price");

  const btn = document.createElement("button");
  btn.className = "add-btn";
  btn.type = "button";

  function paint() {
    priceEl.textContent = money(selected.price.amount, selected.price.currencyCode);
    const buyable = p.inStock && selected.inStock;
    btn.textContent = buyable ? (L.addLabel || "Add") : (L.soldOutLabel || "Sold out");
    btn.disabled = !buyable;
  }

  if (multi) {
    // Label the chooser with the product's own option name ("Size",
    // "Pack") rather than a hardcoded word, so it reads correctly
    // whatever the client called it in Shopify.
    const optionName = selected.options?.[0]?.name || "Option";
    const group = document.createElement("div");
    group.className = "variants";

    if (p.variants.length <= MULTI_AS_BUTTONS_MAX) {
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", optionName);
      for (const v of p.variants) {
        const b = document.createElement("button");
        b.className = "variants__btn";
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(v.id === selected.id));
        b.disabled = !v.inStock;
        b.textContent = v.title;
        if (!v.inStock) b.title = L.soldOutLabel || "Sold out";
        b.addEventListener("click", () => {
          selected = v;
          [...group.children].forEach((c, i) =>
            c.setAttribute("aria-checked", String(p.variants[i].id === selected.id)));
          paint();
        });
        group.appendChild(b);
      }
    } else {
      const id = `variant-${p.handle}`;
      const label = document.createElement("label");
      label.className = "variants__label";
      label.setAttribute("for", id);
      label.textContent = optionName;

      const sel = document.createElement("select");
      sel.className = "variants__select";
      sel.id = id;
      for (const v of p.variants) {
        const o = document.createElement("option");
        o.value = v.id;
        o.textContent = v.inStock ? v.title : `${v.title} \u2014 ${L.soldOutLabel || "Sold out"}`;
        o.disabled = !v.inStock;
        o.selected = v.id === selected.id;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => {
        selected = p.variants.find((v) => v.id === sel.value) || selected;
        paint();
      });
      group.append(label, sel);
    }

    body.insertBefore(group, foot);
  }

  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    addToCart(p, selected);
    openDrawer();
  });

  paint();
  foot.appendChild(btn);
  return card;
}

// Products in Shopify are named "<Brand> - <Beer>" so they stay
// legible in the admin across every portal. The brand prefix is
// redundant on the brand's own storefront, so strip it here.
function shortTitle(title) {
  for (const prefix of [`${BRAND.name} - `, `${BRAND.name} `]) {
    if (title.startsWith(prefix)) return title.slice(prefix.length);
  }
  return title;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const escapeAttr = escapeHtml;

function renderCartButton() {
  const n = cartCount();
  const badge = $("#cart-count");
  badge.textContent = n;
  badge.hidden = n === 0;
}

function renderCart() {
  const body = $("#drawer-body");
  const foot = $("#drawer-foot");

  if (!cart.length) {
    const L = BRAND.labels || {};
    body.innerHTML = `<div class="drawer__empty">
      <p>${escapeHtml(L.cartEmptyTitle || "Your cart is empty.")}</p>
      <p style="font-size:0.8rem">${escapeHtml(L.cartEmptyLine || "")}</p>
    </div>`;
    foot.hidden = true;
    return;
  }

  foot.hidden = false;
  body.innerHTML = "";

  for (const line of cart) {
    const el = document.createElement("div");
    el.className = "line";
    el.innerHTML = `
      ${line.image ? `<img class="line__img" src="${line.image}" alt="" loading="lazy">`
                   : `<div class="line__img"></div>`}
      <div class="line__main">
        <p class="line__name">${escapeHtml(shortTitle(line.title))}</p>
        ${line.variantTitle ? `<p class="line__variant">${escapeHtml(line.variantTitle)}</p>` : ""}
        <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
          <span class="stepper">
            <button type="button" aria-label="Decrease quantity">−</button>
            <output>${line.qty}</output>
            <button type="button" aria-label="Increase quantity">+</button>
          </span>
          <span class="line__price">${money(Number(line.price) * line.qty, line.currency)}</span>
        </div>
        <button class="line__remove" type="button">Remove</button>
      </div>`;

    const [minus, plus] = el.querySelectorAll(".stepper button");
    minus.addEventListener("click", () => setQty(line.variantId, line.qty - 1));
    plus.addEventListener("click", () => setQty(line.variantId, line.qty + 1));
    el.querySelector(".line__remove")
      .addEventListener("click", () => setQty(line.variantId, 0));

    body.appendChild(el);
  }

  $("#cart-total").textContent = money(cartTotal(), cart[0].currency);
  renderCartGate();
}

// Pre-sale disclosure and the minimum-order gate, both painted from config.
// The gate disables our own checkout button and says why; Yuko is what
// actually stops a short order at Shopify's checkout.
function renderCartGate() {
  // Adult signature. Disclosure only — the fee is applied at Shopify
  // checkout as part of the shipping rate, not as a line here. It is
  // charged ONCE PER ORDER, so this figure must not be multiplied by
  // the cart count no matter how tempting that looks.
  const sigEl = $("#drawer-signature");
  const SIG = BRAND.adultSignature || {};
  if (sigEl) {
    if (SIG.active && SIG.line) {
      sigEl.textContent = SIG.line;
      sigEl.hidden = false;
    } else {
      sigEl.hidden = true;
    }
  }

  const presaleEl = $("#drawer-presale");
  const P = BRAND.presale || {};
  if (presaleEl) {
    if (P.active && P.note) {
      presaleEl.textContent = P.window ? `${P.note} ${P.window}.` : P.note;
      presaleEl.hidden = false;
    } else {
      presaleEl.hidden = true;
    }
  }

  const box = $("#drawer-min");
  const btn = $("#checkout");
  if (!box || !btn) return;

  const issue = minOrderIssue();
  if (issue) {
    box.textContent = issue;
    box.hidden = false;
    btn.disabled = true;
    btn.dataset.blocked = "true";
    btn.setAttribute("aria-describedby", "drawer-min");
  } else {
    box.hidden = true;
    box.textContent = "";
    // Never re-enable mid-checkout — checkout() owns the button while it's
    // preparing the Shopify cart and sets its own label.
    if (btn.textContent === "Checkout") btn.disabled = false;
    delete btn.dataset.blocked;
    btn.removeAttribute("aria-describedby");
  }
}

/* ═══════════════════════════════════════════════════════════
   Drawer + focus management
   ═══════════════════════════════════════════════════════════ */

let lastFocus = null;

function openDrawer() {
  // The cart drawer and the help FAB both live bottom-right. The drawer
  // wins: close the panel and pull the button out of the way rather than
  // letting a "?" float over the checkout button.
  const panel = $("#help-panel");
  if (panel?.dataset.open === "true") closeHelp();
  document.body.dataset.drawer = "open";

  lastFocus = document.activeElement;
  $("#drawer").dataset.open = "true";
  $("#scrim").dataset.open = "true";
  $("#drawer").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  $("#drawer-close").focus();
  document.addEventListener("keydown", onDrawerKey);
}

function closeDrawer() {
  document.body.dataset.drawer = "closed";
  $("#drawer").dataset.open = "false";
  $("#scrim").dataset.open = "false";
  $("#drawer").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  document.removeEventListener("keydown", onDrawerKey);
  lastFocus?.focus();
}

function onDrawerKey(e) {
  if (e.key === "Escape") { closeDrawer(); return; }
  if (e.key !== "Tab") return;
  const focusables = $("#drawer").querySelectorAll(
    'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* ═══════════════════════════════════════════════════════════
   Checkout handoff

   The cart is built in Shopify at checkout time, not on every
   add — fewer API calls, simpler local state. The customer then
   leaves for Shopify's domain, where Go-To Gifting is the seller
   of record. Destination-state screening and age verification
   live THERE, not here. See COMPLIANCE in the README.
   ═══════════════════════════════════════════════════════════ */

const CART_CREATE = `
  mutation CartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart { checkoutUrl }
      userErrors { field message }
    }
  }`;

async function checkout() {
  const btn = $("#checkout");
  const errBox = $("#drawer-error");
  errBox.hidden = true;

  // Second gate. The button is already disabled below the minimum; this
  // catches the case where something re-enabled it. Cheaper to stop here
  // than to send the shopper to a checkout Yuko will reject.
  const issue = minOrderIssue();
  if (issue) {
    errBox.textContent = issue;
    errBox.hidden = false;
    return;
  }

  // Demo mode has no Shopify cart behind it. Say so rather than throwing a
  // stack trace or spinning forever.
  if (DEMO) {
    errBox.textContent =
      "This is a preview. Checkout goes live once the catalog is connected to Shopify.";
    errBox.hidden = false;
    return;
  }

  btn.disabled = true;
  btn.textContent = "Preparing checkout…";

  try {
    const data = await gql(CART_CREATE, {
      input: {
        lines: cart.map((l) => ({ merchandiseId: l.variantId, quantity: l.qty })),
        // Portal attribution. The Shopify Flow order-tagging workflow keys
        // on THIS attribute — not on product tags. If it's missing or the
        // value drifts from the slug, orders land untagged and the client's
        // commission cannot be calculated. Verify with a live test order.
        attributes: [{ key: "portal", value: BRAND.sourceTag }],
        note: `Order placed via the ${BRAND.name} portal.`,
      },
    });

    const result = data.cartCreate;
    if (result.userErrors?.length) throw new Error(result.userErrors[0].message);
    const url = result.cart?.checkoutUrl;
    if (!url) throw new Error("No checkout URL returned.");

    window.location.href = url;
  } catch (err) {
    const reach = BRAND.supportPhone
      ? `call us at ${BRAND.supportPhone}`
      : `email ${BRAND.supportEmail}`;
    errBox.textContent = `Couldn't start checkout: ${err.message} Try again, or ${reach}.`;
    errBox.hidden = false;
    btn.disabled = false;
    btn.textContent = "Checkout";
  }
}

/* ═══════════════════════════════════════════════════════════
   Help widget

   Floating "?" → panel → Netlify Forms. No backend, no third-party
   script, no cookies. The form markup lives in index.html because
   Netlify registers forms by parsing deployed HTML; a JS-injected form
   is never registered and every submission 404s.

   Submissions land in Netlify → Site configuration → Forms. THEY GO
   NOWHERE ELSE until a form notification is configured there. That step
   is in the Netlify UI, not in this repo.
   ═══════════════════════════════════════════════════════════ */

let helpLastFocus = null;

function openHelp() {
  helpLastFocus = document.activeElement;
  $("#help-panel").dataset.open = "true";
  $("#help-panel").setAttribute("aria-hidden", "false");
  $("#help-open").setAttribute("aria-expanded", "true");
  $("#help-name").focus();
  document.addEventListener("keydown", onHelpKey);
}

function closeHelp() {
  $("#help-panel").dataset.open = "false";
  $("#help-panel").setAttribute("aria-hidden", "true");
  $("#help-open").setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", onHelpKey);
  helpLastFocus?.focus();
}

// Escape closes. Deliberately NOT focus-trapped: this is a popover, not a
// modal — the page behind it stays usable, so trapping focus would be wrong.
function onHelpKey(e) {
  if (e.key === "Escape") closeHelp();
}

async function submitHelp(e) {
  e.preventDefault();
  const form = $("#help-form");
  const status = $("#help-status");
  const btn = $("#help-submit");

  status.hidden = true;
  status.className = "help-form__status";
  btn.disabled = true;
  btn.textContent = "Sending…";

  try {
    // Netlify expects a urlencoded POST to any path on the site, with the
    // form's own name in `form-name`. Read that from the DOM rather than
    // config so the two can never drift apart.
    const data = new FormData(form);
    data.set("form-name", form.getAttribute("name"));

    const res = await fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(data).toString(),
    });
    if (!res.ok) throw new Error(`Netlify returned ${res.status}`);

    form.reset();
    status.textContent = BRAND.helpForm?.success ||
      "Thanks — we've got it. We'll reply by email shortly.";
    status.classList.add("help-form__status--ok");
    status.hidden = false;
    btn.disabled = false;
    btn.textContent = "Send message";
  } catch (err) {
    // Never swallow it. A shopper who thinks they sent a message and didn't
    // is worse off than one who's told to email instead.
    status.innerHTML =
      `That didn't send. Please email ` +
      `<a href="mailto:${escapeAttr(BRAND.supportEmail)}">${escapeHtml(BRAND.supportEmail)}</a> ` +
      `and we'll pick it up there.`;
    status.classList.add("help-form__status--bad");
    status.hidden = false;
    btn.disabled = false;
    btn.textContent = "Send message";
    console.error("[help]", err);
  }
}

function initHelp() {
  const H = BRAND.helpForm || {};
  const fab = $("#help-open");
  const panel = $("#help-panel");
  if (!fab || !panel) return;

  if (!H.active) { fab.remove(); panel.remove(); return; }

  $("#help-title").textContent = H.heading || "Need a hand?";
  $("#help-line").textContent = H.line || "";

  fab.addEventListener("click", () => {
    panel.dataset.open === "true" ? closeHelp() : openHelp();
  });
  $("#help-close").addEventListener("click", closeHelp);
  $("#help-form").addEventListener("submit", submitHelp);
}

/* ═══════════════════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Caution-tape ticker

   Drawn in CSS from the brand palette rather than hotlinking a client's
   asset — no dependency on their CDN, and it recolors with the tokens.

   Speed is derived by measuring the built track and computing a duration
   from it (~30px/s), so the cadence stays right no matter how long the
   promo copy is.

   The track is two identical halves and animates to -50%, which is what
   makes the loop seamless. Screen readers get one clean copy from the
   visually-hidden paragraph; the scrolling duplicates are aria-hidden.

   Motion: WCAG 2.2.2 wants a way to stop content that moves for more
   than five seconds, so there's a pause control, it pauses on hover and
   on keyboard focus, and prefers-reduced-motion drops the scroll for a
   static line instead. Their site does none of this; ours should.
   ═══════════════════════════════════════════════════════════ */

const TAPE_SPEED = 30;   // px per second — measured off their ticker

function paintTape() {
  const tape = $("#tape");
  if (!tape) return;

  const R = BRAND.promo || {};
  const text = R.tickerText || R.line;
  if (!R.active || !text) { tape.remove(); return; }

  tape.hidden = false;
  $("#tape-readable").textContent = R.line || text;
  $("#tape-static").textContent = R.line || text;

  const track = $("#tape-track");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduced) {
    // No scroll at all. The static line carries the message instead —
    // a marquee frozen mid-transform would just be clipped copy.
    track.remove();
    $("#tape-static").hidden = false;
    $("#tape-pause").remove();
    return;
  }

  // Build one half wide enough to cover the viewport, then clone it. A
  // half narrower than the screen would show a gap at the wrap point.
  const half = document.createElement("div");
  half.className = "tape__half";
  const makeSpan = () => {
    const s = document.createElement("span");
    s.textContent = text;
    return s;
  };

  half.appendChild(makeSpan());
  track.appendChild(half);
  let guard = 0;
  while (half.offsetWidth < window.innerWidth && guard++ < 40) {
    half.appendChild(makeSpan());
  }

  const halfWidth = half.offsetWidth;
  track.appendChild(half.cloneNode(true));
  track.style.setProperty("--tape-duration", `${(halfWidth / TAPE_SPEED).toFixed(1)}s`);

  const pause = $("#tape-pause");
  pause.addEventListener("click", () => {
    const now = tape.dataset.paused !== "true";
    tape.dataset.paused = String(now);
    pause.setAttribute("aria-pressed", String(now));
    pause.querySelector(".visually-hidden").textContent =
      now ? "Resume the scrolling banner" : "Pause the scrolling banner";
  });
}

/* ═══════════════════════════════════════════════════════════
   Notice strip — pre-sale, minimum order

   Icons are inline SVG in the brand's own accent colors rather than
   image files, so there's nothing to art-direct, nothing to load, and
   they inherit the palette automatically. To swap in real artwork later,
   add `icon: "/assets/whatever.png"` to the config block and it's used
   instead of the drawn mark.
   ═══════════════════════════════════════════════════════════ */

const MARKS = {
  // Two cans side by side with a "×2" — reads as the minimum at a glance.
  min: `<svg viewBox="0 0 60 40" fill="none" aria-hidden="true">
    <rect x="2" y="7" width="13" height="27" rx="3.2" stroke="currentColor" stroke-width="2.2"/>
    <rect x="17" y="7" width="13" height="27" rx="3.2" stroke="currentColor" stroke-width="2.2"/>
    <path d="M2 14h13M17 14h13" stroke="currentColor" stroke-width="2.2"/>
    <text x="58" y="28" font-size="19" font-weight="700" fill="currentColor"
          text-anchor="end" font-family="system-ui, sans-serif">&#215;2</text>
  </svg>`,

  // Clock — pre-sale, shipping later.
  presale: `<svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <circle cx="20" cy="20" r="15" stroke="currentColor" stroke-width="2.2"/>
    <path d="M20 11v9.5l6 3.5" stroke="currentColor" stroke-width="2.2"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
};

function paintNotices() {
  const strip = $("#notices");
  if (!strip) return;

  const P = BRAND.presale || {};
  const M = BRAND.minOrder || {};

  const items = [];

  if (M.active && Number(M.qty) > 1) {
    items.push({ key: "min", icon: M.icon, heading: M.heading, line: M.line, lead: true });
  }
  // The 250-order promo is NOT here — it has its own caution-tape band
  // above the strip. Adding it back would say the same thing twice.
  if (P.active) {
    const heading = [P.label, P.line].filter(Boolean).join(" \u2014 ");
    const line = P.window
      ? `${P.note} ${P.window}.`
      : P.note;
    items.push({ key: "presale", icon: P.icon, heading, line });
  }

  if (!items.length) { strip.remove(); return; }

  strip.hidden = false;
  strip.innerHTML = "";

  for (const n of items) {
    const el = document.createElement("div");
    el.className = "notice" + (n.lead ? " notice--lead" : "");
    // Config-supplied artwork wins over the drawn mark. Decorative either
    // way — the heading and line carry the meaning for screen readers.
    const mark = n.icon
      ? `<img class="notice__icon" src="${escapeAttr(n.icon)}" alt="" width="40" height="40">`
      : `<span class="notice__icon">${MARKS[n.key] || ""}</span>`;
    el.innerHTML = `
      ${mark}
      <div class="notice__body">
        <p class="notice__heading">${escapeHtml(n.heading || "")}</p>
        ${n.line ? `<p class="notice__line">${escapeHtml(n.line)}</p>` : ""}
      </div>`;
    strip.appendChild(el);
  }
}

function paintStaticCopy() {
  // Announcement bar carries the pre-sale flag first — it's the thing a
  // shopper most needs to know before they start adding to a cart — then
  // the shipping line, which stays display-only.
  const announce = $("#announce");
  const P = BRAND.presale || {};
  announce.innerHTML = "";
  if (P.active && P.label) {
    const flag = document.createElement("strong");
    flag.className = "announce__flag";
    flag.textContent = [P.label, P.line].filter(Boolean).join(" \u2014 ");
    announce.appendChild(flag);
  }
  announce.appendChild(document.createTextNode(BRAND.shippingLine));
  const nameEl = $("#brand-name");
  if (BRAND.logo && BRAND.logoIncludesName) {
    nameEl.className = "visually-hidden";   // keep for screen readers
  }
  nameEl.textContent = BRAND.name;
  $("#hero-kicker").textContent = BRAND.heroKicker;
  // Hero headline. When BRAND.heroMark is set the brand name is rendered as
  // the wordmark image instead of type; the text stays in the alt so the H1
  // still reads "Shop <Brand>" to search engines and screen readers.
  $("#hero-lead").className = "thin";
  $("#hero-lead").textContent = "Shop";
  const mark = $("#hero-mark");
  if (BRAND.heroMark) {
    mark.src = BRAND.heroMark;
    mark.alt = BRAND.name;
    mark.hidden = false;
  } else {
    mark.remove();
    $("#hero-lead").insertAdjacentText("afterend", ` ${BRAND.name}`);
  }

  // Product claim badge, sitting in the hero's open right side. It's the
  // brand's own artwork, so it ships as an image with the claim in the alt.
  const badge = $("#hero-badge");
  if (badge && BRAND.heroBadge?.image) {
    badge.src = BRAND.heroBadge.image;
    badge.alt = BRAND.heroBadge.label || "";
    badge.hidden = false;
  } else if (badge) {
    badge.remove();
  }
  $("#hero-tagline").textContent = BRAND.tagline;
  $("#handoff").textContent = BRAND.sellerNote;
  $("#footer-legal").textContent =
    `Sold by ${BRAND.sellerOfRecord}, a licensed California retailer. ` +
    `Must be 21 or older to purchase. Valid ID required at delivery.`;
  $("#footer-year").textContent = new Date().getFullYear();

  // Brewery vocabulary lives in BRAND.labels so a client who calls their
  // filter axis "Series" or "Pack" doesn't require an app.js edit.
  const L = BRAND.labels || {};
  const fh = $("#filters-heading");
  if (fh) fh.textContent = L.filtersHeading || "Style";
  const fnav = $("#filters-nav");
  if (fnav) fnav.setAttribute("aria-label", `Filter by ${(L.filtersHeading || "style").toLowerCase()}`);
  const bnav = $("#brand-nav");
  if (bnav) bnav.setAttribute("aria-label", BRAND.name);

  // The logo is the thread back to the brand's own site. Because that isn't
  // where a logo normally goes, it carries an explicit label for screen readers.
  const home = $("#brand-home");
  home.href = BRAND.backToSiteUrl;
  home.setAttribute("aria-label", `${BRAND.name} \u2014 ${BRAND.backToSiteLabel}`);

  const logo = $("#brand-logo");
  if (BRAND.logo) { logo.src = BRAND.logo; logo.alt = BRAND.name; }
  else logo.remove();

  renderNav();
}

// Header nav, driven entirely by BRAND.nav so onboarding a brand stays a
// config edit. External links open in a new tab: a shopper mid-cart who taps
// "Merch" should not lose the shop.
function renderNav() {
  const nav = $("#brand-nav");
  if (!nav) return;
  const links = BRAND.nav || [];
  if (!links.length) { nav.remove(); return; }

  nav.innerHTML = "";
  for (const item of links) {
    const a = document.createElement("a");
    a.className = "masthead__link";
    a.href = item.href;
    a.textContent = item.label;
    if (item.external) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    nav.appendChild(a);
  }
}

function showLoading() {
  const grid = $("#grid");
  grid.className = "grid";
  grid.innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton"></div>`).join("");
}

function showFailure(err) {
  const grid = $("#grid");
  grid.className = "";
  const phone = BRAND.supportPhone
    ? ` or call <a href="tel:${BRAND.supportPhone.replace(/[^\d+]/g, "")}">${BRAND.supportPhone}</a>`
    : "";
  grid.innerHTML = `<div class="state">
    <h2 class="state__title">The catalog didn't load</h2>
    <p>Something went wrong reaching our catalog. Refresh the page to try again.</p>
    <p>Still stuck? Email <a href="mailto:${BRAND.supportEmail}">${BRAND.supportEmail}</a>${phone}.</p>
  </div>`;
  console.error("[catalog]", err);
}

async function init() {
  // Painting the chrome must never take the catalog down with it. A stale
  // cached app.js against newer HTML threw here once and blanked the whole
  // page; a shop that renders without its header still sells.
  try {
    paintStaticCopy();
    paintTape();
    paintNotices();
    initHelp();
  } catch (err) {
    console.error("[chrome] header/footer failed to paint", err);
  }
  renderCartButton();
  renderCart();

  $("#cart-open").addEventListener("click", openDrawer);
  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#scrim").addEventListener("click", closeDrawer);
  $("#checkout").addEventListener("click", checkout);

  showLoading();
  try {
    allProducts = await loadCatalog();
    if (!allProducts.length) {
      $("#grid").className = "";
      $("#grid").innerHTML = `<div class="state">
        <h2 class="state__title">Nothing on tap yet</h2>
        <p>This shop doesn't have anything listed right now. Check back soon.</p>
      </div>`;
      return;
    }
    renderFilters();
    renderGrid();
  } catch (err) {
    showFailure(err);
  }
}

init();
