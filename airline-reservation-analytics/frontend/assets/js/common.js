/* AeroAndes - shared helpers for the customer portal (/) and the manager panel (/manager). */
(function () {
  "use strict";

  // Backend base URL: injected by frontend/server.py from config.yaml, else same host on :8000.
  const injected = window.AEROANDES_BACKEND || "";
  const API_BASE = (injected && !injected.includes("__CONFIG_"))
    ? injected.replace(/\/+$/, "")
    : `${window.location.protocol}//${window.location.hostname}:8000`;

  // The 12 airports of the AeroAndes network (same list as airline_data/params.py).
  const AIRPORTS = [
    { code: "BOG", city: "Bogotá", airport: "El Dorado" },
    { code: "MDE", city: "Medellín", airport: "José María Córdova" },
    { code: "CLO", city: "Cali", airport: "Alfonso Bonilla Aragón" },
    { code: "CTG", city: "Cartagena", airport: "Rafael Núñez" },
    { code: "BAQ", city: "Barranquilla", airport: "Ernesto Cortissoz" },
    { code: "SMR", city: "Santa Marta", airport: "Simón Bolívar" },
    { code: "BGA", city: "Bucaramanga", airport: "Palonegro" },
    { code: "PEI", city: "Pereira", airport: "Matecaña" },
    { code: "CUC", city: "Cúcuta", airport: "Camilo Daza" },
    { code: "ADZ", city: "San Andrés", airport: "Gustavo Rojas Pinilla" },
    { code: "LET", city: "Leticia", airport: "Alfredo Vásquez Cobo" },
    { code: "PSO", city: "Pasto", airport: "Antonio Nariño" },
  ];
  const BY_CODE = Object.fromEntries(AIRPORTS.map((a) => [a.code, a]));

  const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  /** Accepts "BOG", "bog", "Bogotá", "Bogotá (BOG)" and returns the IATA code (or the raw upper-cased text). */
  function resolveAirport(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    const paren = raw.match(/\(([A-Za-z]{3})\)/);
    if (paren) return paren[1].toUpperCase();
    const up = raw.toUpperCase();
    if (BY_CODE[up]) return up;
    const f = fold(raw);
    const hit = AIRPORTS.find((a) => fold(a.city) === f) || AIRPORTS.find((a) => fold(a.city).startsWith(f));
    return hit ? hit.code : up;
  }

  function searchAirports(text) {
    const f = fold(text);
    if (!f) return AIRPORTS.slice();
    return AIRPORTS.filter((a) => fold(a.code).startsWith(f) || fold(a.city).includes(f) || fold(a.airport).includes(f));
  }

  const cityOf = (code) => (BY_CODE[code] ? BY_CODE[code].city : code);

  /** Tiny DOM builder; children that are strings become text nodes (never parsed as HTML). */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v; // only used with trusted, static icon markup
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
    return node;
  }

  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  const fmtUSD = (cents) => usd.format(Number(cents || 0) / 100);
  const fmtInt = (n) => new Intl.NumberFormat("es-CO").format(Number(n || 0));

  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  /** "2026-11-20" -> "Vie, 20 nov 2026" without timezone shifts. */
  function fmtDate(iso, opts) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return iso || "";
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return cap(d.toLocaleDateString("es-CO", opts || { weekday: "short", day: "numeric", month: "short", year: "numeric" }));
  }

  /** "2023-06" -> "Junio de 2023" */
  function fmtMonth(ym, style) {
    const m = String(ym || "").match(/^(\d{4})-(\d{2})$/);
    if (!m) return ym || "";
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    return cap(d.toLocaleDateString("es-CO", { month: style || "long", year: "numeric" }));
  }

  async function api(path, options) {
    let resp;
    try {
      resp = await fetch(API_BASE + path, options);
    } catch (e) {
      const err = new Error("No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.");
      err.network = true;
      throw err;
    }
    let data = null;
    try { data = await resp.json(); } catch (_) { /* empty body */ }
    if (!resp.ok) {
      const err = new Error((data && typeof data.detail === "string" && data.detail) || `HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return data;
  }

  const ICONS = {
    plane: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 15.5v-1.6l-8-5V3.6a1.5 1.5 0 0 0-3 0v5.3l-8 5v1.6l8-2.4v5.1l-2.2 1.6V21l3.7-1.1 3.7 1.1v-1.2L13 18.2v-5.1z"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m20 20-3.6-3.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h12m0 0-3.5-3.5M19 7l-3.5 3.5M17 17H5m0 0 3.5 3.5M5 17l3.5-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    seat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5v8a2.5 2.5 0 0 0 2.5 2.5H16m-9.5 0L5 20m11-5 2 5M8 4.5h0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 12h7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.5 8.5V6.7a2.2 2.2 0 0 0-2.2-2.2H6.7a2.2 2.2 0 0 0-2.2 2.2v6.6a2.2 2.2 0 0 0 2.2 2.2h1.8" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m0 0-5-5m5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5.5c0 4.2 3 7.9 7 9.5 4-1.6 7-5.3 7-9.5V6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m9 12 2.2 2.2L15.5 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    ticket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 6v12" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2 2.4"/></svg>',
    alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5v5.5M12 16.5h0" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    database: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="2.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  };

  const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Header gets a solid background once the page scrolls.
  function initHeader() {
    const header = document.querySelector(".site-header");
    if (!header) return;
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // Reveal-on-scroll for elements marked .reveal (purely decorative).
  function initReveal() {
    const items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || prefersReducedMotion()) {
      items.forEach((i) => i.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    items.forEach((i) => io.observe(i));
    // Safety net: never leave content hidden (e.g. full-page screenshots, unusual scrolling)
    setTimeout(() => items.forEach((i) => i.classList.add("is-visible")), 4000);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {
      const ta = el("textarea", { style: "position:fixed;opacity:0" }, text);
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  window.AeroAndes = {
    API_BASE, AIRPORTS, BY_CODE, resolveAirport, searchAirports, cityOf, el, fmtUSD, fmtInt, fmtDate, fmtMonth,
    api, ICONS, prefersReducedMotion, initHeader, initReveal, copyText,
  };
})();
