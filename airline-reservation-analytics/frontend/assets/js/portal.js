/* AeroAndes - customer portal: search, reserve, boarding pass and reservation lookup.
 * Talks to the backend contract (contract/API.md):
 *   GET  /flights/search?origin=&destination=&date=
 *   POST /reservations            {flight_id, passenger_name, fare_class}
 *   GET  /reservations/{id}
 * The data-testid attributes required by the harness (R8) live in index.html and in renderFlight/renderPass.
 */
(function () {
  "use strict";
  const A = window.AeroAndes;
  const { el, ICONS } = A;
  const $ = (id) => document.getElementById(id);

  // Static icons (trusted markup)
  document.querySelectorAll("[data-icon]").forEach((n) => {
    const svg = ICONS[n.dataset.icon];
    if (!svg) return;
    if (n.classList.contains("tab")) n.insertAdjacentHTML("afterbegin", svg);
    else n.innerHTML = svg;
  });
  $("swap-btn").innerHTML = ICONS.swap;

  A.initHeader();
  A.initReveal();

  const state = { search: null, flights: [], selected: null, lastReservation: null };

  /* ------------------------------------------------------------ autocomplete */
  function setupAirportField(input, subEl, list) {
    let active = -1;
    let items = [];

    const updateSub = () => {
      const code = A.resolveAirport(input.value);
      const a = A.BY_CODE[code];
      subEl.textContent = a ? `${a.city} · ${a.airport}` : (input.value.trim() ? "Aeropuerto no encontrado en la red" : "Ciudad o código");
    };
    const close = () => { list.classList.add("hidden"); input.setAttribute("aria-expanded", "false"); active = -1; };
    // Open the list where it fits: below the field if there is room, otherwise above it.
    const placeList = () => {
      const r = input.closest(".field").getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 16;
      const above = r.top - 16;
      const wanted = Math.min(340, list.scrollHeight || 340);
      const up = below < wanted && above > below;
      list.classList.toggle("up", up);
      list.style.setProperty("--suggest-max", `${Math.max(160, Math.min(340, up ? above : below))}px`);
    };
    const choose = (a) => {
      input.value = a.code;
      updateSub();
      close();
      input.closest(".field").classList.remove("is-invalid");
      input.dispatchEvent(new CustomEvent("airport:chosen", { bubbles: true }));
    };
    const render = () => {
      items = A.searchAirports(input.value);
      list.replaceChildren(...items.map((a, i) => el("li", {
        role: "option", id: `${list.id}-${a.code}`, "aria-selected": i === active ? "true" : "false",
        onmousedown: (e) => { e.preventDefault(); choose(a); },
      }, el("span", { class: "code", text: a.code }), el("span", { class: "city" }, a.city, el("span", { class: "apt", text: a.airport })))));
      const show = items.length > 0 && document.activeElement === input;
      list.classList.toggle("hidden", !show);
      if (show) placeList();
      input.setAttribute("aria-expanded", show ? "true" : "false");
      if (active >= 0 && items[active]) input.setAttribute("aria-activedescendant", `${list.id}-${items[active].code}`);
      else input.removeAttribute("aria-activedescendant");
    };

    input.addEventListener("focus", () => { active = -1; render(); });
    input.addEventListener("input", () => { active = -1; updateSub(); render(); input.closest(".field").classList.remove("is-invalid"); });
    input.addEventListener("blur", () => {
      close();
      const code = A.resolveAirport(input.value);
      if (A.BY_CODE[code]) input.value = code;
      updateSub();
    });
    input.addEventListener("keydown", (e) => {
      if (list.classList.contains("hidden") && e.key !== "ArrowDown") return;
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
      else if (e.key === "Enter" && active >= 0 && items[active]) { e.preventDefault(); choose(items[active]); }
      else if (e.key === "Escape") { close(); }
    });
    return { updateSub, choose };
  }

  const originInput = $("search-origin");
  const destInput = $("search-destination");
  const dateInput = $("search-date");
  const origin = setupAirportField(originInput, $("origin-sub"), $("suggest-origin"));
  const dest = setupAirportField(destInput, $("destination-sub"), $("suggest-destination"));
  originInput.addEventListener("airport:chosen", () => { if (!destInput.value) destInput.focus(); });
  destInput.addEventListener("airport:chosen", () => { if (!dateInput.value) dateInput.focus(); });

  // Click anywhere on a field box focuses its input
  document.querySelectorAll(".field").forEach((f) => f.addEventListener("click", (e) => {
    const inp = f.querySelector("input");
    if (e.target !== inp && inp) inp.focus();
  }));

  // Date: no past dates in the picker; show a friendly label
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  dateInput.min = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  dateInput.addEventListener("input", () => {
    $("date-sub").textContent = dateInput.value ? A.fmtDate(dateInput.value, { weekday: "long", day: "numeric", month: "long" }) : "Elige el día de tu vuelo";
    dateInput.closest(".field").classList.remove("is-invalid");
  });

  $("swap-btn").addEventListener("click", () => {
    [originInput.value, destInput.value] = [destInput.value, originInput.value];
    origin.updateSub(); dest.updateSub();
  });

  /* ----------------------------------------------------------------- tabs */
  const tabs = { book: $("tab-book"), lookup: $("tab-lookup") };
  const panels = { book: $("panel-book"), lookup: $("panel-lookup") };
  function showTab(name) {
    for (const k of Object.keys(tabs)) {
      tabs[k].setAttribute("aria-selected", k === name ? "true" : "false");
      panels[k].classList.toggle("hidden", k !== name);
    }
  }
  tabs.book.addEventListener("click", () => showTab("book"));
  tabs.lookup.addEventListener("click", () => { showTab("lookup"); $("lookup-code").focus(); });

  document.querySelectorAll("[data-open-lookup]").forEach((a) => a.addEventListener("click", () => {
    showTab("lookup");
    setTimeout(() => $("lookup-code").focus({ preventScroll: true }), 350);
  }));
  document.querySelectorAll("[data-focus-search]").forEach((a) => a.addEventListener("click", () => {
    showTab("book");
    setTimeout(() => originInput.focus({ preventScroll: true }), 350);
  }));

  /* ------------------------------------------------------------- helpers */
  function setBusy(btn, busy, label) {
    btn.disabled = busy;
    const slot = btn.querySelector(".btn-icon-slot");
    const lab = btn.querySelector(".btn-label");
    if (busy) {
      btn.dataset.label = lab.textContent;
      if (slot) slot.innerHTML = '<span class="spinner"></span>';
      lab.textContent = label;
    } else {
      if (slot) slot.innerHTML = ICONS.search;
      if (btn.dataset.label) lab.textContent = btn.dataset.label;
    }
  }
  function showError(box, msg) {
    box.replaceChildren(el("span", { html: ICONS.alert }), el("span", { text: msg }));
    box.classList.remove("hidden");
  }

  /* -------------------------------------------------------------- search */
  const resultsSection = $("results-section");
  const flightsContainer = $("flights-container");
  const searchError = $("search-error");

  function validateSearch() {
    const o = A.resolveAirport(originInput.value);
    const d = A.resolveAirport(destInput.value);
    const date = dateInput.value.trim();
    const bad = [];
    if (!/^[A-Z]{3}$/.test(o)) bad.push([originInput, "Indica la ciudad o el código del aeropuerto de origen."]);
    if (!/^[A-Z]{3}$/.test(d)) bad.push([destInput, "Indica la ciudad o el código del aeropuerto de destino."]);
    if (!bad.length && o === d) bad.push([destInput, "El origen y el destino deben ser diferentes."]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) bad.push([dateInput, "Elige la fecha de salida."]);
    document.querySelectorAll("#panel-book .field").forEach((f) => f.classList.remove("is-invalid"));
    bad.forEach(([inp]) => inp.closest(".field").classList.add("is-invalid"));
    return bad.length ? { error: bad[0][1], focus: bad[0][0] } : { o, d, date };
  }

  function renderResultsHead(o, d, date, count) {
    const title = $("results-title");
    title.replaceChildren(
      `${A.cityOf(o)}`, el("span", { class: "arrow", html: ICONS.arrow }), `${A.cityOf(d)}`
    );
    $("results-kicker").textContent = count === null ? "Buscando vuelos…" : "Vuelos disponibles";
    $("results-meta").textContent = count === null
      ? A.fmtDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : `${A.fmtDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${count} ${count === 1 ? "vuelo" : "vuelos"}`;
  }

  function renderFlight(f) {
    const [o, d] = String(f.route || "").split("-");
    const low = Number(f.seats_available) <= 9;
    const reserveBtn = el("button", {
      class: "btn btn-dark", type: "button", "data-testid": "reserve-button",
      "aria-label": `Reservar vuelo ${f.flight_id} de ${A.cityOf(o)} a ${A.cityOf(d)}`,
      onclick: () => openBooking(f),
    }, "Reservar");

    return el("article", { class: "flight-card", "data-testid": "flight-row" },
      el("div", { class: "fc-id" },
        el("span", { class: "flight-no", text: f.flight_id }),
        el("span", { class: "date", text: A.fmtDate(f.flight_date) })),
      el("div", { class: "fc-route" },
        el("div", { class: "end" }, el("span", { class: "code", text: o }), el("span", { class: "city", text: A.cityOf(o) })),
        el("div", { class: "fc-path" },
          el("span", { class: "dot" }), el("span", { class: "plane", html: ICONS.plane }), el("span", { class: "tag", text: "Directo" }), el("span", { class: "dot" })),
        el("div", { class: "end" }, el("span", { class: "code", text: d }), el("span", { class: "city", text: A.cityOf(d) }))),
      el("div", { class: "fc-seats" },
        el("div", { class: "seat-line" }, el("span", { html: ICONS.seat }), `${A.fmtInt(f.seats_available)} ${Number(f.seats_available) === 1 ? "silla disponible" : "sillas disponibles"}`),
        el("span", { class: low ? "chip low" : "chip", text: low ? "¡Últimas sillas!" : "Disponible" })),
      el("div", { class: "fc-buy" },
        el("div", { class: "fc-price" },
          el("span", { class: "from", text: "Tarifa" }),
          el("span", { class: "amount", text: A.fmtUSD(f.price_cents) }),
          el("span", { class: "per", text: "por pasajero" })),
        reserveBtn));
  }

  async function runSearch({ silent } = {}) {
    const q = state.search;
    if (!q) return;
    if (!silent) {
      renderResultsHead(q.o, q.d, q.date, null);
      flightsContainer.replaceChildren(...[0, 1, 2].map(() => el("div", { class: "skeleton", "aria-hidden": "true" })));
      resultsSection.classList.remove("hidden");
    }
    const params = new URLSearchParams({ origin: q.o, destination: q.d, date: q.date });
    const flights = await A.api(`/flights/search?${params}`);
    state.flights = (Array.isArray(flights) ? flights : []).filter((f) => Number(f.seats_available) > 0);
    renderResultsHead(q.o, q.d, q.date, state.flights.length);
    if (!state.flights.length) {
      flightsContainer.replaceChildren(el("div", { class: "empty" },
        el("div", { class: "icon", html: ICONS.calendar }),
        el("h3", { text: "No hay vuelos con sillas para ese día" }),
        el("p", { text: `Prueba con otra fecha o explora otro destino desde ${A.cityOf(q.o)}.` })));
      return;
    }
    flightsContainer.replaceChildren(...state.flights.map(renderFlight));
  }

  $("panel-book").addEventListener("submit", async (e) => {
    e.preventDefault();
    searchError.classList.add("hidden");
    const v = validateSearch();
    if (v.error) { showError(searchError, v.error); v.focus.focus(); return; }
    originInput.value = v.o; destInput.value = v.d; origin.updateSub(); dest.updateSub();
    state.search = v;
    const btn = $("search-submit");
    setBusy(btn, true, "Buscando…");
    try {
      const p = runSearch();
      resultsSection.scrollIntoView({ behavior: A.prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      await p;
    } catch (err) {
      resultsSection.classList.add("hidden");
      showError(searchError, err.network ? err.message : `No pudimos buscar vuelos (${err.message}). Inténtalo de nuevo.`);
    } finally {
      setBusy(btn, false);
    }
  });

  /* ------------------------------------------------------------- booking */
  const dialog = $("booking-dialog");
  const bookingForm = $("booking-section");
  const confirmSection = $("confirmation-section");
  const bookingError = $("booking-error");
  const nameInput = $("passenger-name");
  const confirmBtn = $("confirm-submit");

  function tripSummary(f) {
    const [o, d] = String(f.route || "").split("-");
    return [
      el("div", { class: "row" },
        el("div", {}, el("span", { class: "code", text: o }), el("span", { class: "city", text: A.cityOf(o) })),
        el("div", { class: "mid", html: ICONS.plane }),
        el("div", { style: "text-align:right" }, el("span", { class: "code", text: d }), el("span", { class: "city", text: A.cityOf(d) }))),
      el("div", { class: "facts" },
        el("span", {}, "Vuelo ", el("b", { text: f.flight_id })),
        el("span", {}, el("b", { text: A.fmtDate(f.flight_date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) })),
        el("span", {}, el("b", { text: A.fmtInt(f.seats_available) }), " sillas disponibles")),
    ];
  }

  function openBooking(f) {
    state.selected = f;
    $("trip-summary").replaceChildren(...tripSummary(f));
    $("booking-price").textContent = A.fmtUSD(f.price_cents);
    $("booking-title").textContent = "Completa tu reserva";
    bookingError.classList.add("hidden");
    nameInput.classList.remove("is-invalid");
    $("fare-economy").checked = true;
    confirmBtn.disabled = false;
    confirmBtn.querySelector(".btn-label").textContent = "Confirmar reserva";
    bookingForm.classList.remove("hidden");
    confirmSection.classList.add("hidden");
    if (!dialog.open) dialog.showModal();
    nameInput.focus();
  }

  function closeDialog() { if (dialog.open) dialog.close(); }
  $("booking-close").addEventListener("click", closeDialog);
  $("pass-close").addEventListener("click", closeDialog);
  $("pass-new").addEventListener("click", () => {
    closeDialog();
    showTab("book");
    $("buscar").scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => originInput.focus({ preventScroll: true }), 400);
  });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closeDialog(); });
  nameInput.addEventListener("input", () => nameInput.classList.remove("is-invalid"));

  bookingForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = state.selected;
    if (!f) return;
    bookingError.classList.add("hidden");
    const passenger = nameInput.value.trim().replace(/\s+/g, " ");
    if (passenger.length < 2) {
      nameInput.classList.add("is-invalid");
      showError(bookingError, "Escribe el nombre completo del pasajero.");
      nameInput.focus();
      return;
    }
    const fare = document.querySelector('input[name="fare"]:checked').value;
    confirmBtn.disabled = true;
    confirmBtn.querySelector(".btn-label").replaceChildren(el("span", { class: "spinner" }), " Confirmando…");
    try {
      const res = await A.api("/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flight_id: f.flight_id, passenger_name: passenger, fare_class: fare }),
      });
      state.lastReservation = res;
      $("pass-slot").replaceChildren(renderPass(res, f, fare, { primary: true }));
      $("booking-title").textContent = "¡Reserva confirmada!";
      bookingForm.classList.add("hidden");
      confirmSection.classList.remove("hidden");
      runSearch({ silent: true }).catch(() => {}); // refresh seat counts in the background
    } catch (err) {
      let msg = err.message;
      if (err.status === 409) msg = "Este vuelo se acaba de llenar. Elige otro vuelo de la lista.";
      else if (err.status === 404) msg = "Este vuelo ya no está disponible.";
      else if (!err.network) msg = `No pudimos confirmar tu reserva (${err.message}). Inténtalo de nuevo.`;
      showError(bookingError, msg);
      if (err.status === 409 || err.status === 404) runSearch({ silent: true }).catch(() => {});
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.querySelector(".btn-label").textContent = "Confirmar reserva";
    }
  });

  /* ------------------------------------------------------ boarding pass */
  function barcode(text) {
    // Decorative barcode derived from the reservation id (deterministic)
    let h = 2166136261;
    const bars = [];
    let x = 0;
    for (let i = 0; x < 300; i++) {
      h ^= text.charCodeAt(i % text.length) + i;
      h = Math.imul(h, 16777619) >>> 0;
      const w = 1 + (h % 3);
      if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="54" />`);
      x += w + 1 + ((h >> 3) % 2);
    }
    return `<svg viewBox="0 0 300 54" preserveAspectRatio="none" aria-hidden="true" fill="currentColor">${bars.join("")}</svg>`;
  }

  /** Builds the boarding-pass card. Only the pass shown after booking carries data-testid="confirmation-id". */
  function renderPass(res, flight, fare, { primary } = {}) {
    const route = flight ? String(flight.route || "").split("-") : null;
    const idAttrs = { class: "confirmation-code", text: res.reservation_id };
    if (primary) { idAttrs.id = "confirmation-id"; idAttrs["data-testid"] = "confirmation-id"; }

    const copyBtn = el("button", { class: "btn copy-btn", type: "button", html: `${ICONS.copy}<span>Copiar</span>` });
    copyBtn.addEventListener("click", async () => {
      if (await A.copyText(res.reservation_id)) {
        copyBtn.classList.add("is-done");
        copyBtn.innerHTML = `${ICONS.check}<span>Copiado</span>`;
        setTimeout(() => { copyBtn.classList.remove("is-done"); copyBtn.innerHTML = `${ICONS.copy}<span>Copiar</span>`; }, 1800);
      }
    });

    const status = String(res.status || "").toUpperCase();
    const statusLabel = status === "CONFIRMED" ? "Confirmada" : status === "CANCELLED" ? "Cancelada" : status;
    const fareLabel = fare ? (fare === "BUSINESS" ? "Business" : "Económica") : null;

    return el("div", { class: "pass" },
      el("div", { class: "pass-top" },
        el("span", { class: "brand", html: '<svg class="logo-mark"><use href="#logo"/></svg><span>AeroAndes</span>' }),
        el("span", { class: "pass-status", html: `${ICONS.check}` }, statusLabel)),
      route ? el("div", { class: "pass-route" },
        el("div", { class: "end" }, el("span", { class: "code", text: route[0] }), el("span", { class: "city", text: A.cityOf(route[0]) })),
        el("div", { class: "mid", html: ICONS.plane }),
        el("div", { class: "end" }, el("span", { class: "code", text: route[1] }), el("span", { class: "city", text: A.cityOf(route[1]) }))) : null,
      el("div", { class: "pass-grid" },
        el("div", { class: "wide" }, el("span", { class: "k", text: "Pasajero" }), el("span", { class: "v", text: res.passenger_name })),
        el("div", {}, el("span", { class: "k", text: "Vuelo" }), el("span", { class: "v", text: res.flight_id })),
        flight ? el("div", { class: "wide" }, el("span", { class: "k", text: "Fecha" }), el("span", { class: "v", text: A.fmtDate(flight.flight_date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) })) : null,
        fareLabel ? el("div", {}, el("span", { class: "k", text: "Clase" }), el("span", { class: "v", text: fareLabel })) : null,
        flight ? el("div", {}, el("span", { class: "k", text: "Tarifa" }), el("span", { class: "v", text: A.fmtUSD(flight.price_cents) })) : null),
      el("div", { class: "pass-tear" }),
      el("div", { class: "pass-code" },
        el("div", {}, el("span", { class: "k", text: "Código de reserva" }), el("span", idAttrs)),
        copyBtn),
      el("div", { class: "barcode", html: barcode(res.reservation_id) }));
  }

  /* -------------------------------------------------------------- lookup */
  const lookupError = $("lookup-error");
  $("panel-lookup").addEventListener("submit", async (e) => {
    e.preventDefault();
    lookupError.classList.add("hidden");
    const code = $("lookup-code").value.trim().toUpperCase();
    if (!code) { showError(lookupError, "Escribe tu código de reserva."); return; }
    const btn = $("lookup-submit");
    setBusy(btn, true, "Consultando…");
    try {
      const res = await A.api(`/reservations/${encodeURIComponent(code)}`);
      // Reuse flight details if that flight is in the current results
      const flight = state.flights.find((f) => f.flight_id === res.flight_id) || null;
      $("results-kicker").textContent = "Tu reserva";
      $("results-title").textContent = res.passenger_name;
      $("results-meta").textContent = `Código ${res.reservation_id}`;
      flightsContainer.replaceChildren(el("div", { class: "lookup-result" }, renderPass(res, flight, null)));
      resultsSection.classList.remove("hidden");
      resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      showError(lookupError, err.status === 404 ? "No encontramos una reserva con ese código. Revísalo e inténtalo de nuevo." : err.message);
    } finally {
      setBusy(btn, false);
    }
  });

  /* -------------------------------------------------------- destinations */
  document.querySelectorAll("[data-dest]").forEach((card) => card.addEventListener("click", () => {
    const code = card.dataset.dest;
    showTab("book");
    destInput.value = code;
    dest.updateSub();
    if (A.resolveAirport(originInput.value) === code) { originInput.value = ""; origin.updateSub(); }
    $("buscar").scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => (originInput.value ? dateInput : originInput).focus({ preventScroll: true }), 450);
  }));
})();
