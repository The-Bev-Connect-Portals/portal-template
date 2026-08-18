# Brand Portal Template — Breweries

Go-To Gifting LLC. Copy this repo to stand up a brand-skinned storefront for a
brewery client. The client's brand wears the shopping experience; Go-To Gifting
stays the seller of record because it holds the Type 21 license.

Derived from the Hellbent portal (`jgrasty123/hellbent-cocktials`), with the
Hellbent-specific work removed and three things added: collection-handle
catalog filtering, a variant chooser for pack sizes, and adult-signature
disclosure.

**Target:** intake → preview URL inside one working session.

---

## Scope guard

This is a catalog browser plus a cart handoff. It is **not** a headless
commerce platform. Do not add customer accounts, reviews, subscriptions, or a
custom checkout — each of those pulls compliance surface out of Shopify, which
is exactly where it needs to stay.

There is deliberately no pack *builder*. Samplers are fixed selections with
pack-size variants. A build-your-own-6 UI is a different product and a
different conversation.

---

## Naming

Pick the slug once. It has to match across five systems, and every silent
failure in this architecture is a handle mismatch.

```
slug                  rincon
repo                  jgrasty123/portal-rincon
Shopify product tag   portal:rincon
smart collection      portal-rincon        ← brand.config.js collectionHandle
cart attribute        portal = rincon      ← brand.config.js sourceTag
Netlify site          portal-rincon
localStorage cart     cart:rincon          (derived, no config needed)
```

Repos are named `portal-<slug>` going forward so they sort together in the repo
list. The older portals (`Rincon_brewery`, `hellbent-cocktials`) predate this
and are not worth renaming.

**Product titles in Shopify are `<BRAND.name> - <Beer>`** so they stay legible
in an admin that serves several brands. The portal strips the prefix on
display, matching on `BRAND.name` exactly — if the two drift, the brand name
shows up twice on every card.

---

## Onboarding a brewery

### 1. Shopify — nothing on the front end works until these are true

1. Products created in `bro-basket.myshopify.com` with real prices and **real
   weights** (see *Weights* below).
2. Every product tagged `portal:<slug>`.
3. Smart collection built on that tag. Note its handle.
4. **Products published to the Headless sales channel.** Installing the channel
   publishes nothing by default — this is the single most common failure, and
   it presents as an empty grid rather than an error.
5. Headless channel → Create storefront, named for the brand → copy the
   **public** token (~32 hex chars).
6. Shopify Flow order-tagging workflow keyed on the **cart attribute**
   `portal`, value = slug.

`templates/brewery_matrixify_import.csv` is the import starting point. Every
value in it marked `REPLACE` must be replaced, including the copy — do not
write tasting notes on the brewery's behalf.

### 2. Repo

1. Copy this repo to `jgrasty123/portal-<slug>`.
2. Edit `brand.config.js`. **Search the file for `‹REPLACE›`** — nothing else
   should need touching.
3. Update the help form name in `index.html` in **both** places (the form's
   `name` attribute and the hidden `form-name` input) to match
   `helpForm.formName`.
4. Drop `logo.png` and `favicon.png` into `assets/`.

Extract the palette and fonts from the client's live site — do not invent
them. Check whether their site is light or dark before designing anything; the
Rincon build was drafted dark and had to be inverted, and that single
correction did more for on-brand feel than anything else.

### 3. Deploy

Netlify, publish directory `.`, no build command. Review the preview URL before
pointing a domain at it.

**If the site has a form, enable form detection in the Netlify dashboard.** A
404 on POST with correct markup means detection was never enabled — it is not a
code bug. The reliable signal that it worked: Netlify's post-processor strips
`data-netlify` and the honeypot attributes from the deployed HTML. Then set the
notification email under Site configuration → Forms, or nobody sees a
submission.

### Definition of done

A brewery onboards by copying the repo, editing `brand.config.js`, editing two
strings in `index.html`, and adding two images. **If you are editing
`assets/app.js` or `assets/styles.css` to onboard a client, the abstraction
leaked.** Fix it here in the template and let every future brand inherit it.

---

## Samplers — pack sizes

A mixed sampler is **one Shopify product with one variant per pack size**
(6-Pack, 12-Pack), each with its own SKU, price, and weight.

**Bundling lives in SumTracker, not Shopify.** Shopify sees a single sellable
SKU per variant; SumTracker holds the recipe that decomposes it into loose cans
and pushes the resulting availability back. Nothing in this repo knows about
components, and it should stay that way.

The portal renders a chooser for any product with more than one variant:
segmented buttons up to four options, a `<select>` beyond that. The price and
Add button track the selection, and sold-out pack sizes are shown struck
through rather than hidden — a shopper who can't find the 12-pack assumes the
site is broken.

**Loose-can picking is a warehouse commitment.** Cases get broken down to fill
samplers, so the brewery has to ship inventory in a form that allows it. Confirm
this per client before promising a mixed pack.

---

## Weights

The rate calculator is only as good as the product data, so weights are not
optional and not guesses.

The figures in `templates/brewery_matrixify_import.csv` are **placeholders**.
Replace every one with a scale reading of the actual packed carton — beer,
shipper, dunnage, and all — not a calculated sum of can weights. Dimensional
weight usually governs on a 12-pack, so record the outer carton dimensions at
the same time.

**Verify the carrier before building any zone lookup.** WeShip zones are not UPS
zones; substituting one chart for the other produces mis-assignments that pass
every sanity check and are invisible until a customer is overcharged.

---

## Adult signature

`$5.99`, **once per order**, applied at Shopify checkout as part of the
shipping rate. `brand.config.js` carries the disclosure copy only — no fee is
added to a cart line here.

This has gone wrong before on bundled products, where the fee stacked per line
item. If a shopper sees `$5.99` in the drawer and is charged `$17.97` at
checkout, that is a checkout-side misconfiguration. Fix it there. Do not
"correct" the disclosure copy to match a broken charge.

---

## Compliance

Destination-state screening and age verification live **entirely in the Shopify
checkout**, where Go-To Gifting is the seller of record. That is the upside of
this architecture: one place to get it right, shared by every portal.

- The shipping line on the storefront is **display only**. It sets
  expectations and must never be the enforcement layer.
- **Do not name states anywhere in this codebase.** Not in the announcement
  bar, not in the FAQ, not in the help copy. Checkout decides.
- Entity separation is load-bearing. The storefront wears the client's brand;
  checkout, receipt, confirmation email, and shipping label are all Go-To
  Gifting. Do not blur this to make the handoff feel more seamless. The
  disclosure line in the cart drawer stays visible.

Portals stay `noindex` until the client agreement is signed. At launch, remove
**both** `robots.txt` and the `X-Robots-Tag` line in `netlify.toml` — removing
only one leaves the site deindexed.

---

## How the front end works

| Concern | Approach |
|---|---|
| Fetch | One GraphQL query on load, scoped by collection handle, up to 100 products. Cached in `sessionStorage` for 5 minutes. |
| Filtering | Client-side over the fetched set. Never re-query per filter. |
| Cart | `localStorage`, keyed per slug so two portals open in one browser don't collide. |
| Checkout | Shopify cart built at checkout time via `cartCreate`, not on every add. |
| Attribution | `portal` cart attribute. Shopify Flow keys on this. |
| Failure | Plain message with support contact. Never an endless spinner, never a stack trace. |

**Catalog is filtered by collection handle, not by vendor.** Installed apps
(Route, Rise.ai, Fast Bundle, BYOB) write to the vendor field on this store, so
that namespace is polluted and returns wrong or partial catalogs with no error.
A missing collection raises a named error rather than rendering an empty grid,
because an empty grid reads as "no stock" and hides a config typo.

### Quality floor — not optional

- Responsive to 375px.
- Visible keyboard focus; the cart drawer traps focus and closes on Escape.
- `prefers-reduced-motion` respected, including the promo ticker.
- Images lazy-loaded with dimensions set; real alt text from Shopify.
- Sold-out products and sold-out pack sizes shown disabled, not hidden.

---

## Config blocks

All off by default. Switch on per client in `brand.config.js`.

| Block | What it does |
|---|---|
| `presale` | Pre-order treatment across the announcement bar, a notice card, and the cart drawer. |
| `minOrder` | MOQ expectation-setting. **Not enforcement** — see below. |
| `promo` | Scrolling ticker under the hero. Copy only; anything promised is fulfilled by hand. |
| `helpForm` | Floating "?" → Netlify Forms. No backend. |
| `adultSignature` | Drawer disclosure. |

**`minOrder` does not enforce anything.** The cart is `localStorage` and the
Shopify checkout URL is a plain shareable link. Real enforcement is the Yuko
validation function on the store, which runs server-side and covers Shop Pay
and the other express buttons. Keep `minOrder.scope` in step with how Yuko is
configured, and **scope the Yuko rule to this brand's collection** — the store
also serves BroBasket and Go-To Gifting, and an unscoped rule puts a minimum on
every gift basket order on the account.

---

## Git

Claude pushes from the chat sandbox using a fine-grained token in the clone
URL. No local git, no terminal.

```
git clone https://<TOKEN>@github.com/jgrasty123/portal-<slug>.git
cd portal-<slug>
git config user.name "James Grasty"
git config user.email "james@gotogifting.com"

git add -A && git commit -m "..."
git pull --rebase origin main
git push origin main
```

Fine-grained tokens scoped to selected repos. Never classic, never "all
repositories". Short expiry, **revoked at session end**.

---

## Open items across all portals

| Item | Status |
|---|---|
| Transactional email (Klaviyo tier, sender identity) | Not built |
| Rate calculator v2 — WeShip zone map, fuel surcharge, ASR treatment | In flight |
| Hellbent Flow workflow keyed on product tags instead of cart attribute | Needs correcting to `portal` |
