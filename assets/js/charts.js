/* GBGOLD.BG — lightweight SVG charts (line/area with crosshair tooltip, sparklines) */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  let uid = 0;

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function niceTicks(min, max, count) {
    const span = max - min || Math.abs(max) || 1;
    const step0 = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(+v.toPrecision(12));
    return ticks;
  }

  /**
   * Render an area chart into `host`.
   * points: [{t: Date|number, v: number}], opts: {color, format(v), formatTime(t), height}
   */
  function areaChart(host, points, opts) {
    opts = opts || {};
    host.innerHTML = "";
    if (!points || points.length < 2) {
      const empty = document.createElement("div");
      empty.className = "chart__empty";
      empty.textContent = opts.emptyText || "—";
      host.appendChild(empty);
      return;
    }
    const id = "g" + (++uid);
    const W = host.clientWidth || 600;
    const H = opts.height || host.clientHeight || 260;
    const pad = { l: 8, r: 64, t: 12, b: 26 };
    const color = opts.color || "#d4af37";
    const fmt = opts.format || ((v) => v.toFixed(2));
    const fmtT = opts.formatTime || ((t) => new Date(t).toLocaleDateString());

    const xs = points.map((p) => +p.t);
    const vs = points.map((p) => p.v);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...vs), y1 = Math.max(...vs);
    const m = (y1 - y0) * 0.12 || Math.abs(y1) * 0.002 || 1;
    y0 -= m; y1 += m;

    const X = (t) => pad.l + ((t - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "chart__svg", role: "img" }, host);
    const defs = el("defs", {}, svg);
    const grad = el("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": color, "stop-opacity": ".32" }, grad);
    el("stop", { offset: "1", "stop-color": color, "stop-opacity": "0" }, grad);

    // grid + y labels
    niceTicks(y0, y1, 4).forEach((v) => {
      const y = Y(v);
      if (y < pad.t - 1 || y > H - pad.b + 1) return;
      el("line", { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: "chart__grid" }, svg);
      const tx = el("text", { x: W - pad.r + 8, y: y + 4, class: "chart__label" }, svg);
      tx.textContent = fmt(v);
    });
    // x labels
    const nx = Math.max(2, Math.min(6, Math.floor(W / 120)));
    for (let i = 0; i < nx; i++) {
      const t = x0 + ((x1 - x0) * i) / (nx - 1);
      const tx = el("text", { x: X(t), y: H - 6, class: "chart__label", "text-anchor": i === 0 ? "start" : i === nx - 1 ? "end" : "middle" }, svg);
      tx.textContent = fmtT(t);
    }

    const line = points.map((p, i) => (i ? "L" : "M") + X(+p.t).toFixed(1) + " " + Y(p.v).toFixed(1)).join(" ");
    el("path", { d: `${line} L${X(x1)} ${H - pad.b} L${X(x0)} ${H - pad.b} Z`, fill: `url(#${id})` }, svg);
    el("path", { d: line, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);

    // last value marker
    const last = points[points.length - 1];
    el("line", { x1: pad.l, x2: W - pad.r, y1: Y(last.v), y2: Y(last.v), class: "chart__last" }, svg);
    const tagY = Y(last.v);
    el("rect", { x: W - pad.r + 2, y: tagY - 10, width: pad.r - 4, height: 20, rx: 4, fill: color }, svg);
    const tag = el("text", { x: W - pad.r + 8, y: tagY + 4, class: "chart__tag" }, svg);
    tag.textContent = fmt(last.v);
    el("circle", { cx: X(+last.t), cy: Y(last.v), r: 3.5, fill: color, class: "chart__pulse" }, svg);

    // crosshair
    const cross = el("g", { class: "chart__cross", style: "display:none" }, svg);
    const vline = el("line", { y1: pad.t, y2: H - pad.b }, cross);
    const dot = el("circle", { r: 4, fill: color, stroke: "#0b0a08", "stroke-width": 2 }, cross);
    const tip = document.createElement("div");
    tip.className = "chart__tip";
    host.appendChild(tip);

    function move(clientX) {
      const r = svg.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * W;
      const t = x0 + ((px - pad.l) / (W - pad.l - pad.r)) * (x1 - x0);
      let lo = 0, hi = points.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (+points[mid].t < t) lo = mid; else hi = mid; }
      const p = Math.abs(+points[lo].t - t) < Math.abs(+points[hi].t - t) ? points[lo] : points[hi];
      const cx = X(+p.t), cy = Y(p.v);
      cross.style.display = "";
      vline.setAttribute("x1", cx); vline.setAttribute("x2", cx);
      dot.setAttribute("cx", cx); dot.setAttribute("cy", cy);
      tip.innerHTML = `<b>${fmt(p.v)}</b><span>${fmtT(+p.t, true)}</span>`;
      tip.style.display = "block";
      const left = (cx / W) * r.width;
      tip.style.left = Math.min(Math.max(left, 60), r.width - 60) + "px";
      tip.style.top = Math.max((cy / H) * r.height - 54, 0) + "px";
    }
    function leave() { cross.style.display = "none"; tip.style.display = "none"; }
    svg.addEventListener("mousemove", (e) => move(e.clientX));
    svg.addEventListener("touchmove", (e) => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    svg.addEventListener("mouseleave", leave);
    svg.addEventListener("touchend", leave);
  }

  /** Sparkline into an existing <svg viewBox="0 0 300 60"> */
  function sparkline(svg, values, color) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!values || values.length < 2) return;
    const W = 300, H = 60, id = "s" + (++uid);
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || max * 0.001 || 1;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 6 - ((v - min) / span) * (H - 12)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const defs = el("defs", {}, svg);
    const g = el("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": color, "stop-opacity": ".35" }, g);
    el("stop", { offset: "1", "stop-color": color, "stop-opacity": "0" }, g);
    el("path", { d: d + ` L${W} ${H} L0 ${H} Z`, fill: `url(#${id})` }, svg);
    el("path", { d, fill: "none", stroke: color, "stroke-width": 2, "vector-effect": "non-scaling-stroke" }, svg);
  }

  window.GBCharts = { areaChart, sparkline };
})();
