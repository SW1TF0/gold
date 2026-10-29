/* GBGOLD.BG — main application: i18n, live prices, dashboard, catalogue, calculator, FX */
(function () {
  "use strict";

  const OZ = 31.1034768; // grams per troy ounce
  const PHONE = "+359888272619";
  const EMAIL = "info@gbgold.bg";
  const METALS_API = "https://api.gold-api.com/price/";
  const FX_API = "https://api.frankfurter.dev/v1/";
  const METAL_POLL_MS = 30000;
  const FX_POLL_MS = 15 * 60000;
  const FX_CODES = ["USD", "GBP", "CHF", "TRY", "RON", "PLN", "CZK", "HUF", "SEK", "NOK", "DKK", "JPY", "CAD", "AUD", "CNY"];
  const LOCALES = { bg: "bg-BG", en: "en-GB", tr: "tr-TR" };
  const COLORS = { XAU: "#d4af37", XAG: "#c0c7d1", XPT: "#9fb4c7", XPD: "#b8a99a", FX: "#d4af37" };

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // ---------- storage (best effort) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  // ---------- state ----------
  const state = {
    lang: "bg",
    metals: {},          // XAU: {usd, updatedAt}
    prevMetals: {},
    fx: null,            // {date, rates:{USD:..}, prev:{USD:..}}
    session: store.get("gb_session_v1", { XAU: [], XAG: [] }),
    tvSymbol: "OANDA:XAUUSD",
    sessionMetal: "XAU",
    cat: "goldBars",
    brand: "",
    calcMetal: "XAU",
    histCur: "USD",
    histDays: 365,
    metalsOk: null
  };

  // ---------- i18n ----------
  const T = (key) => (window.GB_I18N[state.lang] && window.GB_I18N[state.lang][key]) || window.GB_I18N.en[key] || key;

  function pickLang() {
    const q = new URLSearchParams(location.search).get("lang");
    if (q && window.GB_I18N[q]) return q;
    const s = store.get("gb_lang", null);
    if (s && window.GB_I18N[s]) return s;
    const n = (navigator.language || "bg").slice(0, 2).toLowerCase();
    return window.GB_I18N[n] ? n : "bg";
  }

  function applyI18n() {
    document.documentElement.lang = state.lang;
    $$("[data-i18n]").forEach((n) => { n.textContent = T(n.dataset.i18n); });
    $$("[data-i18n-html]").forEach((n) => { n.innerHTML = T(n.dataset.i18nHtml); });
    $$("[data-i18n-attr]").forEach((n) => {
      n.dataset.i18nAttr.split(";").forEach((pair) => {
        const [attr, key] = pair.split(":");
        n.setAttribute(attr, T(key));
      });
    });
    document.title = T("meta.title");
    $$("[data-lang]").forEach((b) => b.classList.toggle("is-active", b.dataset.lang === state.lang));
    $$("a[data-keep-lang]").forEach((a) => { a.href = a.getAttribute("href").split("?")[0] + "?lang=" + state.lang; });
  }

  function setLang(l) {
    state.lang = l;
    store.set("gb_lang", l);
    const u = new URL(location.href);
    u.searchParams.set("lang", l);
    history.replaceState(null, "", u);
    applyI18n();
    renderAll();
    renderTradingView();
  }

  // ---------- formatting ----------
  const nf = {};
  function money(v, cur, digits) {
    if (v == null || !isFinite(v)) return "—";
    cur = cur || "EUR";
    if (digits == null) digits = v >= 1000 ? 2 : v >= 1 ? 2 : 4;
    const k = state.lang + cur + digits;
    if (!nf[k]) nf[k] = new Intl.NumberFormat(LOCALES[state.lang], { style: "currency", currency: cur, currencyDisplay: "narrowSymbol", minimumFractionDigits: digits, maximumFractionDigits: digits });
    return nf[k].format(v);
  }
  function num(v, digits) {
    if (v == null || !isFinite(v)) return "—";
    return new Intl.NumberFormat(LOCALES[state.lang], { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  }
  function pct(v) {
    if (v == null || !isFinite(v)) return "—";
    return (v > 0 ? "+" : "") + num(v, 2) + "%";
  }
  function fmtWeight(g) {
    if (Math.abs(g - OZ) < 0.01) return "1 oz";
    if (g >= 1000) return num(g / 1000, 0) + " kg";
    return num(g, g % 1 ? 1 : 0) + " g";
  }
  function curName(code) {
    try { return new Intl.DisplayNames([LOCALES[state.lang]], { type: "currency" }).of(code); } catch (e) { return code; }
  }
  function timeStr(t, withDate) {
    const o = withDate ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" };
    return new Date(t).toLocaleString(LOCALES[state.lang], o);
  }

  // ---------- conversions ----------
  function eurUsd() { return state.fx && state.fx.rates.USD; }
  /** Rate: how many units of `cur` for 1 EUR */
  function rateOf(cur) {
    if (cur === "EUR") return 1;
    return state.fx && state.fx.rates[cur];
  }
  /** USD per troy oz → value in currency */
  function ozIn(sym, cur) {
    const m = state.metals[sym];
    if (!m) return null;
    if (cur === "USD") return m.usd;
    const eu = eurUsd(), r = rateOf(cur);
    if (!eu || !r) return null;
    return (m.usd / eu) * r;
  }
  function gramIn(sym, cur) { const o = ozIn(sym, cur); return o == null ? null : o / OZ; }

  // ---------- data fetching ----------
  async function getJSON(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } finally { clearTimeout(to); }
  }

  async function loadMetals() {
    const syms = ["XAU", "XAG", "XPT", "XPD"];
    const res = await Promise.allSettled(syms.map((s) => getJSON(METALS_API + s)));
    let ok = false;
    res.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value && isFinite(r.value.price)) {
        const s = syms[i];
        if (state.metals[s]) state.prevMetals[s] = state.metals[s];
        state.metals[s] = { usd: +r.value.price, updatedAt: r.value.updatedAt ? new Date(r.value.updatedAt) : new Date() };
        ok = true;
      }
    });
    state.metalsOk = ok || Object.keys(state.metals).length > 0;
    if (ok) recordSession();
    renderPrices();
  }

  function isoDate(d) { return d.toISOString().slice(0, 10); }

  async function loadFx() {
    try {
      const start = new Date(Date.now() - 12 * 864e5);
      const j = await getJSON(`${FX_API}${isoDate(start)}..?base=EUR&symbols=${FX_CODES.join(",")}`);
      const dates = Object.keys(j.rates || {}).sort();
      if (!dates.length) throw new Error("no fx");
      const last = dates[dates.length - 1], prev = dates[dates.length - 2];
      state.fx = { date: last, rates: j.rates[last], prev: prev ? j.rates[prev] : null };
    } catch (e) { /* keep last good rates */ }
    state.fxTried = true;
    renderPrices();
    renderFx();
  }

  // ---------- session history ----------
  function recordSession() {
    const now = Date.now();
    ["XAU", "XAG"].forEach((s) => {
      const m = state.metals[s];
      if (!m) return;
      const arr = (state.session[s] = (state.session[s] || []).filter((p) => now - p.t < 12 * 3600e3));
      const last = arr[arr.length - 1];
      if (!last || now - last.t > 5000) arr.push({ t: now, v: m.usd });
      if (arr.length > 1500) arr.splice(0, arr.length - 1500);
    });
    store.set("gb_session_v1", state.session);
  }

  // ---------- rendering: live prices ----------
  function setStatus() {
    $$("[data-status]").forEach((p) => {
      const b = $("b", p);
      p.classList.remove("is-live", "is-off");
      if (state.metalsOk === null) { b.textContent = T("status.loading"); return; }
      if (state.metalsOk) { p.classList.add("is-live"); b.textContent = T("status.live"); }
      else { p.classList.add("is-off"); b.textContent = T("status.offline"); }
    });
  }

  function flash(node, dir) {
    if (!dir) return;
    node.classList.remove("up", "down");
    void node.offsetWidth;
    node.classList.add(dir > 0 ? "up" : "down");
  }

  function renderPrices() {
    setStatus();
    // hero quote cards
    $$(".quote[data-metal]").forEach((card) => {
      const s = card.dataset.metal;
      const prev = state.prevMetals[s], cur = state.metals[s];
      const set = (f, v) => { const n = $(`[data-field="${f}"]`, card); if (n) n.textContent = v; };
      set("ozEUR", money(ozIn(s, "EUR"), "EUR"));
      set("ozUSD", money(ozIn(s, "USD"), "USD"));
      set("gEUR", money(gramIn(s, "EUR"), "EUR", 2));
      set("kgEUR", money(gramIn(s, "EUR") != null ? gramIn(s, "EUR") * 1000 : null, "EUR", 0));
      if (prev && cur && prev.usd !== cur.usd) flash($('[data-field="ozEUR"]', card), cur.usd - prev.usd);
      const spark = $(`[data-spark="${s}"]`);
      if (spark) GBCharts.sparkline(spark, (state.session[s] || []).map((p) => p.v), COLORS[s]);
    });

    // KPIs
    const k = (key, v) => { const n = $(`[data-kpi="${key}"]`); if (n) n.textContent = v; };
    k("goldOz", money(ozIn("XAU", "EUR"), "EUR"));
    k("goldOzUSD", money(ozIn("XAU", "USD"), "USD") + " · " + money(gramIn("XAU", "EUR"), "EUR") + "/g");
    k("silverOz", money(ozIn("XAG", "EUR"), "EUR"));
    k("silverOzUSD", money(ozIn("XAG", "USD"), "USD") + " · " + money(gramIn("XAG", "EUR"), "EUR", 3) + "/g");
    k("platOz", money(ozIn("XPT", "EUR"), "EUR"));
    k("platOzUSD", money(ozIn("XPT", "USD"), "USD"));
    k("pallOz", money(ozIn("XPD", "EUR"), "EUR"));
    k("pallOzUSD", money(ozIn("XPD", "USD"), "USD"));
    const g = state.metals.XAU, s = state.metals.XAG;
    k("ratio", g && s ? num(g.usd / s.usd, 2) : "—");
    k("eurusd", eurUsd() ? num(eurUsd(), 4) : "—");
    k("eurusdDate", state.fx ? state.fx.date : "—");

    const lu = $("#lastUpdate");
    if (lu) lu.textContent = g ? `${T("status.updated")}: ${timeStr(g.updatedAt, true)}` : "";

    renderTicker();
    renderWeightTable();
    renderSession();
    renderProducts(true);
    renderCalc();
  }

  function renderTicker() {
    const items = [];
    [["XAU", "metal.gold"], ["XAG", "metal.silver"], ["XPT", "metal.platinum"], ["XPD", "metal.palladium"]].forEach(([s, key]) => {
      const cur = state.metals[s], prev = state.prevMetals[s];
      const dir = cur && prev ? Math.sign(cur.usd - prev.usd) : 0;
      items.push({ label: `${T(key)} <i>${s}/EUR</i>`, value: money(ozIn(s, "EUR"), "EUR"), sub: money(ozIn(s, "USD"), "USD"), dir });
    });
    if (state.fx) {
      ["USD", "TRY", "GBP", "CHF", "RON"].forEach((c) => {
        const r = state.fx.rates[c], p = state.fx.prev && state.fx.prev[c];
        const ch = r && p ? ((r - p) / p) * 100 : null;
        items.push({ label: `<i>EUR/${c}</i>`, value: num(r, c === "JPY" ? 2 : 4), sub: pct(ch), dir: ch ? Math.sign(ch) : 0 });
      });
    }
    const html = items.map((i) => `<span class="tick ${i.dir > 0 ? "up" : i.dir < 0 ? "down" : ""}"><span class="tick__l">${i.label}</span><b>${i.value}</b><small>${i.sub}</small></span>`).join("");
    const track = $("#tickerTrack");
    track.innerHTML = `<div class="ticker__group">${html}</div><div class="ticker__group" aria-hidden="true">${html}</div>`;
  }

  const WEIGHTS = [1, 2.5, 5, 10, 20, OZ, 50, 100, 250, 500, 1000];
  function renderWeightTable() {
    const tb = $("#weightTable tbody");
    const gg = gramIn("XAU", "EUR"), sg = gramIn("XAG", "EUR");
    tb.innerHTML = WEIGHTS.map((w) => `<tr><td>${fmtWeight(w)}</td><td class="num">${money(gg != null ? gg * w * 0.9999 : null, "EUR", w >= 100 ? 0 : 2)}</td><td class="num">${money(sg != null ? sg * w * 0.999 : null, "EUR", 2)}</td></tr>`).join("");
  }

  function renderSession() {
    const host = $("#sessionChart");
    const s = state.sessionMetal;
    const eu = eurUsd();
    const pts = (state.session[s] || []).map((p) => ({ t: p.t, v: eu ? p.v / eu : p.v }));
    const cur = eu ? "EUR" : "USD";
    GBCharts.areaChart(host, pts, {
      color: COLORS[s], height: 190,
      format: (v) => money(v, cur, s === "XAG" ? 3 : 2),
      formatTime: (t, full) => timeStr(t, full),
      emptyText: state.metalsOk === false ? T("status.offline") : T("status.loading")
    });
  }

  // ---------- TradingView professional chart ----------
  function renderTradingView() {
    const host = $("#tvChart");
    if (!host) return;
    host.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "tradingview-widget-container";
    wrap.style.height = "100%";
    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    wrap.appendChild(inner);
    const sc = document.createElement("script");
    sc.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    sc.async = true;
    sc.textContent = JSON.stringify({
      autosize: true,
      symbol: state.tvSymbol,
      interval: "60",
      range: "1M",
      timezone: "Europe/Sofia",
      theme: "dark",
      style: "3",
      locale: state.lang === "tr" ? "tr" : "en",
      backgroundColor: "rgba(20, 18, 14, 1)",
      gridColor: "rgba(212, 175, 55, 0.06)",
      allow_symbol_change: false,
      hide_side_toolbar: true,
      hide_volume: true,
      calendar: false,
      save_image: false,
      support_host: "https://www.tradingview.com"
    });
    wrap.appendChild(sc);
    host.appendChild(wrap);
  }

  // ---------- catalogue ----------
  const B = { AH: "Argor-Heraeus", PAMP: "PAMP", VC: "Valcambi" };
  const PRODUCTS = [
    // gold bars
    { cat: "goldBars", metal: "XAU", brand: B.AH, name: "Argor-Heraeus Kinebar", g: 1, fine: 999.9 },
    { cat: "goldBars", metal: "XAU", brand: B.PAMP, name: "PAMP Fortuna", g: 1, fine: 999.9 },
    { cat: "goldBars", metal: "XAU", brand: B.PAMP, name: "PAMP Fortuna", g: 5, fine: 999.9 },
    { cat: "goldBars", metal: "XAU", brand: B.AH, name: "Argor-Heraeus", g: 10, fine: 999.9 },
    { cat: "goldBars", metal: "XAU", brand: B.VC, name: "Valcambi", g: 10, fine: 999.9 },
    { cat: "goldBars", metal: "XAU", brand: B.PAMP, name: "PAMP Fortuna", g: 20, fine: 999.9 },
    { cat: "goldBars", metal: "XAU", brand: B.AH, name: "Argor-Heraeus", g: OZ, fine: 999.9 },
    { cat: "goldBars", metal: "XAU", brand: B.PAMP, name: "PAMP Fortuna", g: OZ, fine: 999.9 },
    { cat: "goldBars", metal: "XAU", brand: B.VC, name: "Valcambi", g: OZ, fine: 999.9 },
    { cat: "goldBars", metal: "XAU", brand: B.VC, name: "Valcambi CombiBar™ 50 × 1 g", g: 50, fine: 999.9, combi: true },
    { cat: "goldBars", metal: "XAU", brand: B.PAMP, name: "PAMP Fortuna", g: 50, fine: 999.9 },
    { cat: "goldBars", metal: "XAU", brand: B.AH, name: "Argor-Heraeus", g: 100, fine: 999.9 },
    { cat: "goldBars", metal: "XAU", brand: B.VC, name: "Valcambi", g: 100, fine: 999.9 },
    { cat: "goldBars", metal: "XAU", brand: B.AH, name: "Argor-Heraeus", g: 250, fine: 999.9 },
    { cat: "goldBars", metal: "XAU", brand: B.VC, name: "Valcambi", g: 500, fine: 999.9 },
    { cat: "goldBars", metal: "XAU", brand: B.AH, name: "Argor-Heraeus", g: 1000, fine: 999.9 },
    // gold coins
    { cat: "goldCoins", metal: "XAU", mint: "Münze Österreich", name: "Wiener Philharmoniker", g: OZ, fine: 999.9, coin: true },
    { cat: "goldCoins", metal: "XAU", mint: "Rand Refinery", name: "Krugerrand", g: 33.93, fineG: OZ, fine: 916.7, coin: true },
    { cat: "goldCoins", metal: "XAU", mint: "Royal Canadian Mint", name: "Maple Leaf", g: OZ, fine: 999.9, coin: true },
    { cat: "goldCoins", metal: "XAU", mint: "The Royal Mint", name: "Britannia", g: OZ, fine: 999.9, coin: true },
    { cat: "goldCoins", metal: "XAU", mint: "U.S. Mint", name: "American Eagle", g: 33.93, fineG: OZ, fine: 916.7, coin: true },
    { cat: "goldCoins", metal: "XAU", mint: "Perth Mint", name: "Kangaroo", g: OZ, fine: 999.9, coin: true },
    // silver bars
    { cat: "silverBars", metal: "XAG", brand: B.PAMP, name: "PAMP Fortuna", g: OZ, fine: 999 },
    { cat: "silverBars", metal: "XAG", brand: B.AH, name: "Argor-Heraeus", g: 100, fine: 999 },
    { cat: "silverBars", metal: "XAG", brand: B.VC, name: "Valcambi CombiBar™ 100 × 1 g", g: 100, fine: 999, combi: true },
    { cat: "silverBars", metal: "XAG", brand: B.PAMP, name: "PAMP", g: 100, fine: 999 },
    { cat: "silverBars", metal: "XAG", brand: B.AH, name: "Argor-Heraeus", g: 250, fine: 999 },
    { cat: "silverBars", metal: "XAG", brand: B.VC, name: "Valcambi", g: 250, fine: 999 },
    { cat: "silverBars", metal: "XAG", brand: B.VC, name: "Valcambi", g: 500, fine: 999 },
    { cat: "silverBars", metal: "XAG", brand: B.AH, name: "Argor-Heraeus", g: 1000, fine: 999 },
    { cat: "silverBars", metal: "XAG", brand: B.PAMP, name: "PAMP", g: 1000, fine: 999 },
    { cat: "silverBars", metal: "XAG", brand: B.VC, name: "Valcambi", g: 1000, fine: 999 },
    // silver coins
    { cat: "silverCoins", metal: "XAG", mint: "Münze Österreich", name: "Wiener Philharmoniker", g: OZ, fine: 999, coin: true },
    { cat: "silverCoins", metal: "XAG", mint: "Royal Canadian Mint", name: "Maple Leaf", g: OZ, fine: 999.9, coin: true },
    { cat: "silverCoins", metal: "XAG", mint: "The Royal Mint", name: "Britannia", g: OZ, fine: 999, coin: true },
    { cat: "silverCoins", metal: "XAG", mint: "Rand Refinery", name: "Krugerrand", g: OZ, fine: 999, coin: true },
    { cat: "silverCoins", metal: "XAG", mint: "Perth Mint", name: "Kangaroo", g: OZ, fine: 999.9, coin: true },
    { cat: "silverCoins", metal: "XAG", mint: "U.S. Mint", name: "American Eagle", g: OZ, fine: 999, coin: true }
  ];
  PRODUCTS.forEach((p, i) => { p.id = i; if (!p.fineG) p.fineG = p.g * (p.fine >= 999 ? 1 : p.fine / 1000); });

  function productValue(p) {
    const gp = gramIn(p.metal, "EUR");
    return gp == null ? null : gp * p.fineG * (p.fine >= 999 ? p.fine / 1000 : 1);
  }

  function productVisual(p) {
    const metal = p.metal === "XAU" ? "gold" : "silver";
    const fine = p.fine.toFixed(p.fine % 1 ? 1 : 0);
    const metalWord = p.metal === "XAU" ? "FINE GOLD" : "FINE SILVER";
    if (p.coin) {
      return `<div class="viz viz--coin viz--${metal}"><div class="coin"><span>${p.name.toUpperCase()}</span><b>1 OZ</b><small>${fine}</small></div></div>`;
    }
    const brandMark = p.brand === B.AH ? "ARGOR-HERAEUS" : p.brand === B.PAMP ? "PAMP SUISSE" : "VALCAMBI SUISSE";
    const size = p.g >= 500 ? "xl" : p.g >= 100 ? "lg" : p.g >= 20 ? "md" : "sm";
    return `<div class="viz viz--bar viz--${metal}"><div class="bar bar--${size}${p.combi ? " bar--combi" : ""}"><small>${brandMark}</small><b>${fmtWeight(p.g)}</b><span>${metalWord}</span><small>${fine}</small></div></div>`;
  }

  function renderProducts(valuesOnly) {
    const grid = $("#productGrid");
    if (valuesOnly && grid.children.length) {
      $$("[data-pv]", grid).forEach((n) => { n.textContent = money(productValue(PRODUCTS[+n.dataset.pv]), "EUR"); });
      return;
    }
    const coins = state.cat.endsWith("Coins");
    $("#brandFilter").closest(".select").style.visibility = coins ? "hidden" : "";
    const list = PRODUCTS.filter((p) => p.cat === state.cat && (coins || !state.brand || p.brand === state.brand));
    grid.innerHTML = list.map((p) => `
      <article class="product">
        ${productVisual(p)}
        <div class="product__body">
          <span class="product__brand">${p.coin ? p.mint : p.brand === B.PAMP ? "PAMP Suisse" : p.brand === B.VC ? "Valcambi Suisse" : "Argor-Heraeus SA"}</span>
          <h3>${p.name}${p.combi ? "" : " " + fmtWeight(p.g)}</h3>
          <dl>
            <div><dt>${T("prod.fine")}</dt><dd>${p.fine.toFixed(p.fine % 1 ? 1 : 0)}</dd></div>
            <div><dt>${T("prod.fineWeight")}</dt><dd>${num(p.fineG, 2)} g</dd></div>
          </dl>
          <div class="product__value"><small>${T("prod.metalValue")}</small><strong data-pv="${p.id}">${money(productValue(p), "EUR")}</strong><em>${T("prod.priceNote")}</em></div>
          <div class="product__cta">
            <a class="btn btn--gold btn--sm" href="tel:${PHONE}">${T("cta.ask")}</a>
            <a class="btn btn--ghost btn--sm" href="#contact" data-product="${p.id}">${T("cta.email")}</a>
          </div>
        </div>
      </article>`).join("");
  }

  function productLabel(p) { return `${p.name}${p.combi ? "" : " " + fmtWeight(p.g)} (${p.fine})`; }

  // ---------- calculator ----------
  const CALC_WEIGHTS = { XAU: [1, 2.5, 5, 10, 20, OZ, 50, 100, 250, 500, 1000], XAG: [OZ, 100, 250, 500, 1000, 5000] };
  function fillCalcWeights() {
    const sel = $("#calcWeight");
    const keep = sel.value;
    sel.innerHTML = CALC_WEIGHTS[state.calcMetal].map((w) => `<option value="${w}">${fmtWeight(w)}</option>`).join("");
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
    else sel.value = String(state.calcMetal === "XAU" ? OZ : 1000);
  }
  function renderCalc() {
    const w = +$("#calcWeight").value, q = Math.max(1, Math.floor(+$("#calcQty").value || 1)), cur = $("#calcCur").value;
    const gp = gramIn(state.calcMetal, cur);
    const fine = state.calcMetal === "XAU" ? 0.9999 : 0.999;
    const unit = gp == null ? null : gp * w * fine;
    $("#calcTotal").textContent = money(unit == null ? null : unit * q, cur);
    $("#calcUnit").textContent = unit == null ? "" : `${money(unit, cur)} ${T("calc.perUnit")} · ${fmtWeight(w)} · ${fine * 1000}`;
  }

  // ---------- FX ----------
  function fillFxSelects() {
    const all = ["EUR", ...FX_CODES];
    const opts = (sel, val) => {
      sel.innerHTML = all.map((c) => `<option value="${c}">${c} — ${curName(c)}</option>`).join("");
      sel.value = val;
    };
    const from = $("#convFrom"), to = $("#convTo"), h = $("#histCur");
    opts(from, from.value || "EUR");
    opts(to, to.value || "USD");
    h.innerHTML = FX_CODES.map((c) => `<option value="${c}">${c}</option>`).join("");
    h.value = state.histCur;
  }

  function renderConverter() {
    const a = +$("#convAmount").value || 0, f = $("#convFrom").value, t = $("#convTo").value;
    const rf = rateOf(f), rt = rateOf(t);
    if (!rf || !rt) { $("#convOut").textContent = "—"; $("#convRate").textContent = T(state.fxTried ? "status.offline" : "status.loading"); return; }
    const r = rt / rf;
    $("#convOut").textContent = money(a * r, t, 2);
    $("#convRate").textContent = `1 ${f} = ${num(r, r < 0.01 ? 6 : 4)} ${t} · ECB ${state.fx.date}`;
  }

  function renderFx() {
    fillFxSelects();
    renderConverter();
    const tb = $("#fxTable tbody");
    $("#fxDate").textContent = state.fx ? state.fx.date : "";
    if (!state.fx) { tb.innerHTML = `<tr><td colspan="4" class="muted">${T(state.fxTried ? "status.offline" : "status.loading")}</td></tr>`; return; }
    tb.innerHTML = FX_CODES.map((c) => {
      const r = state.fx.rates[c], p = state.fx.prev && state.fx.prev[c];
      const ch = r && p ? ((r - p) / p) * 100 : null;
      const cls = ch > 0 ? "up" : ch < 0 ? "down" : "";
      return `<tr data-cur="${c}" class="${c === state.histCur ? "is-sel" : ""}"><td><span class="cur"><b>${c}</b><small>${curName(c)}</small></span></td><td class="num mono">${num(r, r > 100 ? 2 : 4)}</td><td class="num mono">${num(1 / r, 1 / r < 0.01 ? 6 : 4)}</td><td class="num mono ${cls}">${pct(ch)}</td></tr>`;
    }).join("");
  }

  const histCache = {};
  async function renderFxHistory() {
    const host = $("#fxChart");
    const c = state.histCur, d = state.histDays;
    const key = c + d;
    const draw = (pts) => GBCharts.areaChart(host, pts, {
      color: COLORS.FX, height: 240,
      format: (v) => num(v, v > 100 ? 2 : 4),
      formatTime: (t, full) => new Date(t).toLocaleDateString(LOCALES[state.lang], full ? { day: "2-digit", month: "short", year: "numeric" } : d > 400 ? { month: "short", year: "numeric" } : { day: "2-digit", month: "short" }),
      emptyText: T("status.loading")
    });
    if (histCache[key]) return draw(histCache[key]);
    draw([]);
    try {
      const start = isoDate(new Date(Date.now() - d * 864e5));
      const j = await getJSON(`${FX_API}${start}..?base=EUR&symbols=${c}`);
      const pts = Object.keys(j.rates).sort().map((dt) => ({ t: new Date(dt + "T12:00:00Z").getTime(), v: j.rates[dt][c] }));
      histCache[key] = pts;
      if (state.histCur === c && state.histDays === d) draw(pts);
    } catch (e) {
      GBCharts.areaChart(host, [], { emptyText: T("status.offline") });
    }
  }

  // ---------- contact ----------
  function prefillContact(interest, message) {
    const sel = $("#interest");
    if (interest) sel.value = interest;
    if (message != null) $("#message").value = message;
  }

  function bindContact() {
    $("#contactForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target;
      const interest = f.interest.options[f.interest.selectedIndex].text;
      const body = [
        `${T("contact.name")}: ${f.name.value}`,
        `${T("contact.tel")}: ${f.phone.value}`,
        `${T("contact.interest")}: ${interest}`,
        "",
        f.message.value
      ].join("\n");
      location.href = `mailto:${EMAIL}?subject=${encodeURIComponent(T("contact.mailSubject"))}&body=${encodeURIComponent(body)}`;
    });
  }

  // ---------- events ----------
  function bind() {
    $$("[data-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));

    const burger = $("#burger"), nav = $("#nav");
    burger.addEventListener("click", () => {
      const open = !document.body.classList.contains("nav-open");
      document.body.classList.toggle("nav-open", open);
      burger.setAttribute("aria-expanded", open);
    });
    $$("a", nav).forEach((a) => a.addEventListener("click", () => { document.body.classList.remove("nav-open"); burger.setAttribute("aria-expanded", "false"); }));

    const header = $("#header");
    const onScroll = () => header.classList.toggle("is-scrolled", scrollY > 40);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const tabs = (sel, attr, fn) => $$(sel + " button").forEach((b) => b.addEventListener("click", () => {
      $$(sel + " button").forEach((x) => x.classList.toggle("is-active", x === b));
      fn(b.dataset[attr]);
    }));
    tabs("#tvTabs", "symbol", (s) => { state.tvSymbol = s; renderTradingView(); });
    tabs("#sessionTabs", "metal", (m) => { state.sessionMetal = m; renderSession(); });
    tabs("#catTabs", "cat", (c) => { state.cat = c; renderProducts(); });
    tabs("#histRange", "days", (d) => { state.histDays = +d; renderFxHistory(); });
    $$("#calcMetal button").forEach((b) => b.addEventListener("click", () => {
      $$("#calcMetal button").forEach((x) => x.classList.toggle("is-active", x === b));
      state.calcMetal = b.dataset.metal; fillCalcWeights(); renderCalc();
    }));

    $("#brandFilter").addEventListener("change", (e) => { state.brand = e.target.value; renderProducts(); });
    ["#calcWeight", "#calcQty", "#calcCur"].forEach((s) => $(s).addEventListener("input", renderCalc));
    ["#convAmount", "#convFrom", "#convTo"].forEach((s) => $(s).addEventListener("input", renderConverter));
    $("#convSwap").addEventListener("click", () => {
      const f = $("#convFrom"), t = $("#convTo"); const v = f.value; f.value = t.value; t.value = v; renderConverter();
    });
    $("#histCur").addEventListener("change", (e) => { state.histCur = e.target.value; renderFx(); renderFxHistory(); });
    $("#fxTable").addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-cur]");
      if (!tr) return;
      state.histCur = tr.dataset.cur; renderFx(); renderFxHistory();
    });

    // "Inquire" buttons prefill the contact form
    document.addEventListener("click", (e) => {
      const a = e.target.closest("[data-product]");
      if (a) { const p = PRODUCTS[+a.dataset.product]; prefillContact(p.metal === "XAU" ? "gold" : "silver", productLabel(p)); return; }
      const fx = e.target.closest("[data-interest]");
      if (fx) prefillContact(fx.dataset.interest, null);
    });
    $("#calcCta").addEventListener("click", () => {
      const w = +$("#calcWeight").value, q = $("#calcQty").value;
      prefillContact(state.calcMetal === "XAU" ? "gold" : "silver", `${q} × ${T(state.calcMetal === "XAU" ? "metal.gold" : "metal.silver")} ${fmtWeight(w)} — ${$("#calcTotal").textContent}`);
    });

    let rt;
    addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { renderSession(); renderFxHistory(); }, 200); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) loadMetals(); });
  }

  function renderAll() {
    fillCalcWeights();
    renderProducts();
    renderPrices();
    renderFx();
    renderFxHistory();
  }

  // ---------- boot ----------
  function boot() {
    state.lang = pickLang();
    $$("[data-year]").forEach((n) => { n.textContent = new Date().getFullYear(); });
    $$("[data-years]").forEach((n) => { n.textContent = new Date().getFullYear() - 1990 + "+"; });
    applyI18n();
    bind();
    bindContact();
    renderAll();
    renderTradingView();
    loadFx().then(loadMetals);
    loadMetals();
    setInterval(() => { if (!document.hidden) loadMetals(); }, METAL_POLL_MS);
    setInterval(loadFx, FX_POLL_MS);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
