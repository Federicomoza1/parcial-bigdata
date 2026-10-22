/* AeroAndes - manager panel: occupancy of a route in a month, read from Athena through
 *   GET /analytics/occupancy?route=&month=  ->  {route, month, occupancy (0..1), seats_sold, seats_capacity}
 * The value shown in data-testid="occupancy-value" must match the endpoint (R9): it is written once,
 * already final (no count-up animation), as a percentage with two decimals.
 */
(function () {
  "use strict";
  const A = window.AeroAndes;
  const { el, ICONS } = A;
  const $ = (id) => document.getElementById(id);

  document.querySelectorAll("[data-icon]").forEach((n) => { if (ICONS[n.dataset.icon]) n.innerHTML = ICONS[n.dataset.icon]; });
  A.initHeader();

  const routeInput = $("manager-route");
  const monthInput = $("manager-month");
  const loadBtn = $("manager-load");
  const errBox = $("manager-error");
  const occEl = $("occupancy-value");
  const arc = $("gauge-arc");
  const CIRC = 2 * Math.PI * 86;

  const state = { current: null, token: 0, trend: null };

  /* --------------------------------------------------------------- inputs */
  const normRoute = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();

  function routeLabel(route) {
    const [o, d] = route.split("-");
    if (A.BY_CODE[o] && A.BY_CODE[d]) return `${A.BY_CODE[o].city} → ${A.BY_CODE[d].city}`;
    return route;
  }

  function updateRouteSub() {
    const r = normRoute(routeInput.value);
    $("route-sub").textContent = /^[A-Z]{3}-[A-Z]{3}$/.test(r) ? routeLabel(r) : "Origen-Destino, ej. BOG-MDE";
  }
  function updateMonthSub() {
    $("month-sub").textContent = "Historial: ene 2023 – dic 2024";
  }
  routeInput.addEventListener("input", () => { routeInput.closest(".dfield").classList.remove("is-invalid"); updateRouteSub(); });
  routeInput.addEventListener("blur", () => { routeInput.value = normRoute(routeInput.value); updateRouteSub(); });
  monthInput.addEventListener("input", () => { monthInput.closest(".dfield").classList.remove("is-invalid"); updateMonthSub(); });
  document.querySelectorAll(".dfield").forEach((f) => f.addEventListener("click", (e) => {
    const inp = f.querySelector("input");
    if (e.target !== inp) inp.focus();
  }));

  /* -------------------------------------------------------------- recent */
  const RECENT_KEY = "aeroandes.recent";
  function readRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 5); } catch (_) { return []; }
  }
  function saveRecent(route, month) {
    const list = [{ route, month }, ...readRecent().filter((r) => !(r.route === route && r.month === month))].slice(0, 5);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (_) { /* storage unavailable */ }
    renderRecent();
  }
  function renderRecent() {
    const list = readRecent();
    const box = $("recent");
    if (!list.length) { box.replaceChildren(); return; }
    box.replaceChildren(el("span", { class: "tile-label", text: "Recientes" }), ...list.map((r) =>
      el("button", {
        class: "chip-btn", type: "button",
        onclick: () => { routeInput.value = r.route; monthInput.value = r.month; updateRouteSub(); updateMonthSub(); load(r.route, r.month); },
      }, `${r.route} · ${A.fmtMonth(r.month, "short")}`)));
  }
  renderRecent();

  /* ------------------------------------------------------------- render */
  function setBusy(busy) {
    loadBtn.disabled = busy;
    const slot = loadBtn.querySelector(".btn-icon-slot");
    slot.innerHTML = busy ? '<span class="spinner"></span>' : ICONS.search;
    loadBtn.querySelector(".btn-label").textContent = busy ? "Consultando…" : "Consultar";
    $("gauge-loading").classList.toggle("hidden", !busy);
  }

  function showError(msg) {
    errBox.replaceChildren(el("span", { html: ICONS.alert }), el("span", { text: msg }));
    errBox.classList.remove("hidden");
  }

  function resetValues(title, sub) {
    occEl.textContent = "—";
    occEl.classList.add("is-empty");
    arc.style.strokeDashoffset = CIRC;
    $("gauge-title").textContent = title;
    $("gauge-month").textContent = sub;
    $("status-pill").classList.add("hidden");
    for (const id of ["seats-sold-value", "seats-capacity-value", "seats-empty-value"]) {
      $(id).textContent = "—"; $(id).classList.add("is-empty");
    }
    renderSeatMap(null);
  }

  function statusFor(occ) {
    if (occ >= 0.85) return { cls: "good", icon: ICONS.check, label: "Alta ocupación" };
    if (occ >= 0.65) return { cls: "warn", icon: ICONS.chart, label: "Ocupación media" };
    return { cls: "bad", icon: ICONS.alert, label: "Baja ocupación" };
  }

  const fmtPct = (occ) => `${(Number(occ) * 100).toFixed(2)}%`;

  function renderSeatMap(occ) {
    const filled = occ === null ? 0 : Math.round(Math.max(0, Math.min(1, occ)) * 100);
    const map = $("seat-map");
    if (!map.children.length) map.replaceChildren(...Array.from({ length: 100 }, () => el("i")));
    [...map.children].forEach((s, i) => {
      // fill column by column (front of the cabin first) so it reads like a seat plan
      const col = i % 20, row = Math.floor(i / 20);
      const order = col * 5 + row;
      s.classList.toggle("on", order < filled);
    });
    map.setAttribute("aria-label", occ === null ? "Mapa de 100 sillas" : `${filled} de cada 100 sillas ocupadas`);
    $("seat-caption").replaceChildren(occ === null
      ? el("span", {}, "De cada ", el("b", { text: "100" }), " sillas, ¿cuántas volaron ocupadas?")
      : el("span", {}, "De cada ", el("b", { text: "100" }), " sillas, ", el("b", { text: String(filled) }), " volaron ocupadas."));
  }

  function render(data, ms) {
    const occ = Number(data.occupancy);
    occEl.textContent = fmtPct(occ);
    occEl.classList.remove("is-empty");
    requestAnimationFrame(() => { arc.style.strokeDashoffset = CIRC * (1 - Math.max(0, Math.min(1, occ))); });

    $("gauge-title").textContent = `${data.route}`;
    $("gauge-month").textContent = `${routeLabel(data.route)} · ${A.fmtMonth(data.month)}`;
    const st = statusFor(occ);
    const pill = $("status-pill");
    pill.className = `status-pill ${st.cls}`;
    pill.replaceChildren(el("span", { html: st.icon }), st.label);

    const sold = Number(data.seats_sold), cap = Number(data.seats_capacity);
    const set = (id, v) => { $(id).textContent = A.fmtInt(v); $(id).classList.remove("is-empty"); };
    set("seats-sold-value", sold);
    set("seats-capacity-value", cap);
    set("seats-empty-value", Math.max(0, cap - sold));
    renderSeatMap(occ);

    $("query-time").replaceChildren(String((ms / 1000).toFixed(2)), el("small", { text: " s" }));
    $("query-at").textContent = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    $("gauge-foot").replaceChildren(
      el("span", {}, el("b", { text: A.fmtInt(sold) }), " sillas confirmadas"),
      el("span", {}, "de ", el("b", { text: A.fmtInt(cap) }), " ofrecidas"));
  }

  /* --------------------------------------------------------------- load */
  async function load(route, month) {
    const token = ++state.token;
    errBox.classList.add("hidden");
    resetValues(route, `${routeLabel(route)} · ${A.fmtMonth(month)}`);
    $("gauge-foot").textContent = "Consultando Amazon Athena…";
    setBusy(true);
    const t0 = performance.now();
    try {
      const params = new URLSearchParams({ route, month });
      const data = await A.api(`/analytics/occupancy?${params}`);
      if (token !== state.token) return;
      render(data, performance.now() - t0);
      state.current = { route: data.route, month: data.month, data };
      saveRecent(data.route, data.month);
      onCurrentChanged();
    } catch (err) {
      if (token !== state.token) return;
      resetValues("Sin datos", `${routeLabel(route)} · ${A.fmtMonth(month)}`);
      $("gauge-foot").textContent = "Prueba con otra ruta o con otro mes.";
      if (err.status === 404) showError(`No hay datos de ${route} para ${A.fmtMonth(month)}. Revisa la ruta (ej. BOG-MDE) y que el mes esté entre enero de 2023 y diciembre de 2024.`);
      else if (err.status === 504) showError("Athena tardó demasiado en responder. Inténtalo de nuevo en unos segundos.");
      else if (err.network) showError(err.message);
      else showError(`No pudimos consultar la ocupación (${err.message}).`);
    } finally {
      if (token === state.token) setBusy(false);
    }
  }

  $("query-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const route = normRoute(routeInput.value);
    const month = monthInput.value.trim();
    routeInput.value = route;
    updateRouteSub();
    const badRoute = !/^[A-Z]{3}-[A-Z]{3}$/.test(route);
    const badMonth = !/^\d{4}-\d{2}$/.test(month);
    routeInput.closest(".dfield").classList.toggle("is-invalid", badRoute);
    monthInput.closest(".dfield").classList.toggle("is-invalid", badMonth);
    if (badRoute || badMonth) {
      showError(badRoute ? "Escribe la ruta con el formato ORIGEN-DESTINO, por ejemplo BOG-MDE." : "Elige el mes que quieres consultar.");
      (badRoute ? routeInput : monthInput).focus();
      return;
    }
    load(route, month);
  });

  /* -------------------------------------------------------------- trend */
  const trendBtn = $("trend-load");
  const chartBox = $("chart");

  function onCurrentChanged() {
    const c = state.current;
    const year = c.month.slice(0, 4);
    trendBtn.disabled = false;
    $("trend-title").textContent = `${c.route} · ${year}`;
    if (state.trend && state.trend.route === c.route && state.trend.year === year) {
      drawChart();
      $("trend-sub").textContent = `${routeLabel(c.route)}. El mes consultado aparece resaltado.`;
    } else {
      state.trend = null;
      chartBox.classList.add("hidden");
      $("trend-empty").classList.remove("hidden");
      $("trend-sub").textContent = `Compara ${A.fmtMonth(c.month).toLowerCase()} con el resto de ${year}.`;
    }
  }

  trendBtn.addEventListener("click", async () => {
    const c = state.current;
    if (!c) return;
    const year = c.month.slice(0, 4);
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    const trend = { route: c.route, year, points: months.map((m) => ({ month: m, status: "pending" })) };
    state.trend = trend;
    $("trend-empty").classList.add("hidden");
    chartBox.classList.remove("hidden");
    trendBtn.disabled = true;
    trendBtn.querySelector(".btn-label").textContent = "Consultando 0/12…";
    drawChart();

    let done = 0;
    const queue = [...trend.points];
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift();
        try {
          const d = await A.api(`/analytics/occupancy?${new URLSearchParams({ route: trend.route, month: p.month })}`);
          Object.assign(p, { status: "ok", occ: Number(d.occupancy), sold: Number(d.seats_sold), cap: Number(d.seats_capacity) });
        } catch (_) {
          p.status = "none";
        }
        done++;
        if (state.trend === trend) {
          trendBtn.querySelector(".btn-label").textContent = `Consultando ${done}/12…`;
          drawChart();
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]); // 3 Athena queries at a time
    if (state.trend === trend) {
      trendBtn.querySelector(".btn-label").textContent = "Actualizar tendencia";
      $("trend-sub").textContent = `${routeLabel(trend.route)}. El mes consultado aparece resaltado.`;
    }
    trendBtn.disabled = false;
  });

  function barPath(x, y, w, h, r) {
    // rounded top corners, square base anchored on the baseline
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function drawChart() {
    const t = state.trend;
    if (!t) return;
    const W = Math.max(320, chartBox.clientWidth), H = 280;
    const m = { l: 44, r: 96, t: 26, b: 30 }; // right margin holds the average label
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const band = iw / 12;
    const bw = Math.min(46, band * 0.58);
    const y = (v) => m.t + ih * (1 - v);
    const ns = "http://www.w3.org/2000/svg";
    const s = (tag, attrs, ...kids) => {
      const n = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
      kids.forEach((k) => n.appendChild(typeof k === "string" ? document.createTextNode(k) : k));
      return n;
    };

    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "group", "aria-label": `Ocupación mensual de ${t.route} en ${t.year}` });
    const grid = s("g", { class: "grid" });
    [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
      grid.appendChild(s("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
      grid.appendChild(s("text", { x: m.l - 10, y: y(v) + 4, "text-anchor": "end" }, `${v * 100}%`));
    });
    svg.appendChild(grid);

    const ok = t.points.filter((p) => p.status === "ok");
    const maxP = ok.reduce((a, p) => (!a || p.occ > a.occ ? p : a), null);
    const current = state.current && state.current.route === t.route ? state.current.month : null;

    t.points.forEach((p, i) => {
      const cx = m.l + band * i + band / 2;
      const x = cx - bw / 2;
      const label = A.fmtMonth(p.month, "short").replace(".", "").split(" ")[0];
      const g = s("g", { class: "col", tabindex: p.status === "ok" ? 0 : -1 });
      g.appendChild(s("rect", { class: "hit", x: m.l + band * i + 1, y: m.t, width: band - 2, height: ih, rx: 8 }));
      if (p.status === "pending") {
        g.appendChild(s("path", { class: "pending", d: barPath(x, y(0.5), bw, ih * 0.5, 4) }));
      } else if (p.status === "none") {
        g.appendChild(s("text", { class: "nodata", x: cx, y: y(0) - 8, "text-anchor": "middle" }, "sin datos"));
      } else {
        const h = Math.max(2, ih * Math.max(0, Math.min(1, p.occ)));
        g.appendChild(s("path", { class: `bar${p.month === current ? " is-current" : ""}`, d: barPath(x, y(0) - h, bw, h, 4) }));
        if (p.month === current || p === maxP) {
          g.appendChild(s("text", { class: "vlabel", x: cx, y: y(0) - h - 8, "text-anchor": "middle" }, `${(p.occ * 100).toFixed(1)}%`));
        }
        g.setAttribute("aria-label", `${A.fmtMonth(p.month)}: ${fmtPct(p.occ)} de ocupación, ${A.fmtInt(p.sold)} de ${A.fmtInt(p.cap)} sillas`);
        const show = () => showTip(p, cx, y(0) - h);
        g.addEventListener("mouseenter", show);
        g.addEventListener("focus", show);
        g.addEventListener("mouseleave", hideTip);
        g.addEventListener("blur", hideTip);
        g.addEventListener("click", () => {
          monthInput.value = p.month; updateMonthSub(); load(t.route, p.month);
        });
      }
      g.appendChild(s("text", { class: "xlab", x: cx, y: H - 8, "text-anchor": "middle" }, label));
      svg.appendChild(g);
    });

    // Reference line: average of the months that have data
    if (ok.length >= 2) {
      const avg = ok.reduce((a, p) => a + p.occ, 0) / ok.length;
      svg.appendChild(s("g", { class: "avg" },
        s("line", { x1: m.l, x2: W - m.r, y1: y(avg), y2: y(avg) }),
        s("text", { x: W - m.r + 10, y: y(avg) - 3 }, "Promedio"),
        s("text", { x: W - m.r + 10, y: y(avg) + 11, class: "avg-val" }, `${(avg * 100).toFixed(1)}%`)));
    }

    // Accessible table view of the same data
    const table = el("table", { class: "sr-only" },
      el("caption", { text: `Ocupación mensual de ${t.route} en ${t.year}` }),
      el("thead", {}, el("tr", {}, el("th", { text: "Mes" }), el("th", { text: "Ocupación" }), el("th", { text: "Sillas vendidas" }), el("th", { text: "Capacidad" }))),
      el("tbody", {}, ...t.points.map((p) => el("tr", {},
        el("td", { text: A.fmtMonth(p.month) }),
        el("td", { text: p.status === "ok" ? fmtPct(p.occ) : p.status === "none" ? "sin datos" : "cargando" }),
        el("td", { text: p.status === "ok" ? A.fmtInt(p.sold) : "" }),
        el("td", { text: p.status === "ok" ? A.fmtInt(p.cap) : "" })))));

    chartBox.replaceChildren(svg, table, el("div", { class: "tooltip hidden", id: "chart-tip", role: "presentation" }));
  }

  function showTip(p, x, yTop) {
    const tip = $("chart-tip");
    if (!tip) return;
    tip.replaceChildren(
      el("b", { text: A.fmtMonth(p.month) }),
      el("div", { class: "row" }, "Ocupación", el("strong", { text: fmtPct(p.occ) })),
      el("div", { class: "row" }, "Vendidas", el("strong", { text: A.fmtInt(p.sold) })),
      el("div", { class: "row" }, "Capacidad", el("strong", { text: A.fmtInt(p.cap) })));
    tip.style.left = `${Math.min(Math.max(x, 90), chartBox.clientWidth - 90)}px`;
    tip.style.top = `${yTop}px`;
    tip.classList.remove("hidden");
  }
  function hideTip() { const tip = $("chart-tip"); if (tip) tip.classList.add("hidden"); }

  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawChart, 150); });

  renderSeatMap(null);
})();
