# GBGOLD.BG

Website of „Голдънбрадърс Груп“ ООД — investment gold and silver and currency exchange, Kardzhali, Bulgaria.

A static site (HTML, CSS, vanilla JS) in Bulgarian, English and Turkish. Every menu item is its own page; on phones a bottom tab bar with a call button replaces the top menu.

## Pages

`index.html` (home), `markets.html`, `products.html`, `calculator.html`, `fx.html`, `about.html`, `contact.html`, `terms.html`.

The root `.html` files are generated. Edit `src/layout.html` (shared header, footer, mobile tab bar) or `src/pages/*.html` (page content), then run:

```sh
python3 tools/build.py 20261030f   # the argument is the asset version for ?v=
```

## Sections

- **Live ticker and hero quotes** — gold and silver spot in EUR per troy ounce, gram and kilo, refreshed every 30 seconds.
- **Market dashboard** — gold, silver, platinum and palladium KPIs, gold/silver ratio, EUR/USD, an interactive TradingView chart (XAU/USD, XAU/EUR, XAG/USD, XAG/EUR, XPT/USD), a live session chart and a metal-value-by-weight table.
- **Products** — gold bars, gold coins, silver bars and silver coins (Argor-Heraeus, PAMP, Valcambi), each showing the live value of its fine metal content. No shop or cart: every product has "Ask for price" (phone) and "Send inquiry" buttons.
- **Calculator** — metal value for any weight and quantity in EUR, USD, TRY, GBP or CHF.
- **Currency** — ECB reference rates for 15 currencies against the euro, a converter and rate-history chart (1M / 3M / 1Y / 5Y).
- **How it works, About, Contact** — contact form opens the visitor's email app (nothing is stored on the site).
- **terms.html** — Terms of use and GDPR policy (Bulgarian binding version, English and Turkish translations).

## Data sources (free, no API key, browser-side)

| Data | Source |
| --- | --- |
| Gold, silver, platinum, palladium spot (USD/oz) | [gold-api.com](https://gold-api.com) — `https://api.gold-api.com/price/{XAU,XAG,XPT,XPD}` |
| Exchange rates (EUR base) and history | European Central Bank via [Frankfurter](https://frankfurter.dev) — `https://api.frankfurter.dev/v1/` |
| Historical market charts | [TradingView](https://www.tradingview.com/widget/) advanced chart widget |

Metal prices are converted to EUR using the ECB EUR/USD rate. If a feed is unreachable the site shows "Price feed unavailable" instead of numbers; it never shows invented prices.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

Upload the repository contents to any static host (GitHub Pages, Netlify, Cloudflare Pages, or the existing web server). Language can be forced with `?lang=bg|en|tr`.

## Editing content

- Text in all three languages: `assets/js/i18n.js`
- Product catalogue: `PRODUCTS` in `assets/js/app.js`
- Contact details: `src/layout.html` (header, footer), `src/pages/contact.html` and `PHONE` / `EMAIL` in `assets/js/app.js`
- Product, calculator and FX buttons link to `contact.html?i=gold|silver|fx&m=<message>`, which prefills the contact form.

After changing any CSS/JS file, rebuild with a new version (`python3 tools/build.py <new-version>`) and update the default in `tools/build.py`, so visitors do not keep an old cached copy.
