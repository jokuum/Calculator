    "use strict";

    // === Referencias ===
    const contenedor    = document.getElementById("evaluaciones");
    const btnAgregar    = document.getElementById("agregar");
    const escalaSel     = document.getElementById("escala");
    const aprobacionInp = document.getElementById("aprobacion");
    const eximicionInp  = document.getElementById("eximicion");
    const btnBorrar     = document.getElementById("borrar");
    const barraRelleno  = document.getElementById("barra-relleno");
    const barraTexto    = document.getElementById("barra-texto");
    const chkExamen     = document.getElementById("tiene-examen");
    const configExamen  = document.getElementById("config-examen");
    const presPctInp    = document.getElementById("pres-pct");
    const examPctInp    = document.getElementById("exam-pct");

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const EPS = 1e-9;

    const OBJ_APROBAR = { id: "res-aprobar", etiqueta: "Para aprobar",  ok: "Apruebas ✓",  no: "No apruebas" };
    const OBJ_EXIMIR  = { id: "res-eximir",  etiqueta: "Para eximirte", ok: "Te eximes ✓", no: "Vas a examen" };

    // === Escala y formato ===
    function limitesEscala() {
      if (escalaSel.value === "100") return { min: 0, max: 100, decimales: 0 };
      return { min: 1, max: 7, decimales: 1 };
    }
    function fmt(valor, dec) { return valor.toFixed(dec); }

    // Redondeo HACIA ARRIBA: una nota requerida nunca debe mostrarse
    // por debajo de lo real (4.04 -> 4.1), o el cálculo sería engañoso.
    function techo(valor, dec) {
      const f = Math.pow(10, dec);
      return Math.ceil(valor * f - 1e-7) / f;
    }
    function redondear(valor, dec) {
      const f = Math.pow(10, dec);
      return Math.round(valor * f) / f;
    }

    function aplicarLimites() {
      const lim = limitesEscala();
      const step = lim.decimales === 0 ? "1" : "0.1";
      [aprobacionInp, eximicionInp].concat(
        Array.from(document.querySelectorAll(".nota, .ponderacion"))
      ).forEach(function (inp) {
        if (inp.classList.contains("ponderacion")) { inp.min = 0; inp.max = 100; inp.step = "1"; }
        else { inp.min = lim.min; inp.max = lim.max; inp.step = step; }
      });
    }

    // === Vibración suave (solo si el dispositivo lo soporta) ===
    function vibrar(patron) {
      if (!reduceMotion && navigator.vibrate) { try { navigator.vibrate(patron); } catch (e) {} }
    }

    // === localStorage ===
    const CLAVE = "calculadora-notas";
    function guardar() {
      const filas = Array.from(document.querySelectorAll("#evaluaciones .fila")).map(function (f) {
        return {
          nombre: f.querySelector(".nombre").value,
          ponderacion: f.querySelector(".ponderacion").value,
          nota: f.querySelector(".nota").value
        };
      });
      try {
        localStorage.setItem(CLAVE, JSON.stringify({
          escala: escalaSel.value,
          aprobacion: aprobacionInp.value,
          eximicion: eximicionInp.value,
          tieneExamen: chkExamen.checked,
          presPct: presPctInp.value,
          examPct: examPctInp.value,
          filas: filas
        }));
      } catch (e) {}
    }
    function cargar() {
      try { return JSON.parse(localStorage.getItem(CLAVE)); } catch (e) { return null; }
    }

    // === Crear / eliminar filas ===
    function crearFila(datos, animar) {
      const fila = document.createElement("div");
      fila.className = "fila" + (animar && !reduceMotion ? " entrando" : "");
      fila.innerHTML =
        '<div class="celda celda-nombre">' +
          '<span class="etiqueta-mini">Evaluación</span>' +
          '<input type="text" class="nombre" placeholder="Ej: Prueba 1" autocomplete="off" enterkeyhint="next">' +
        '</div>' +
        '<div class="celda celda-pond">' +
          '<span class="etiqueta-mini">Ponderación</span>' +
          '<div class="input-sufijo">' +
            '<input type="number" class="ponderacion" placeholder="0" inputmode="numeric" enterkeyhint="next">' +
            '<span class="sufijo">%</span>' +
          '</div>' +
        '</div>' +
        '<div class="celda celda-nota">' +
          '<span class="etiqueta-mini">Nota</span>' +
          '<input type="text" class="nota" placeholder="—" inputmode="decimal" enterkeyhint="done">' +
        '</div>' +
        '<button type="button" class="btn-eliminar" aria-label="Eliminar evaluación">✕</button>';

      if (datos) {
        fila.querySelector(".nombre").value = datos.nombre || "";
        fila.querySelector(".ponderacion").value = datos.ponderacion || "";
        fila.querySelector(".nota").value = datos.nota || "";
      }

      fila.querySelector(".btn-eliminar").addEventListener("click", function () {
        eliminarFila(fila);
      });

      // Enter en la nota agrega otra evaluación (entrada rápida)
      fila.querySelector(".nota").addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); agregarYEnfocar(); }
      });

      contenedor.appendChild(fila);
      aplicarLimites();
      return fila;
    }

    function eliminarFila(fila) {
      if (reduceMotion) { fila.remove(); calcular(); return; }
      fila.classList.add("saliendo");
      fila.addEventListener("animationend", function () {
        fila.remove();
        if (!document.querySelector("#evaluaciones .fila")) crearFila(null, true);
        calcular();
      }, { once: true });
    }

    function agregarYEnfocar() {
      const fila = crearFila(null, true);
      vibrar(8);
      const inp = fila.querySelector(".nombre");
      if (inp) inp.focus();
      calcular();
    }

    // === Cálculo en vivo ===
    function calcular() {
      const lim = limitesEscala();
      const aprobacion = parseFloat(aprobacionInp.value);
      const eximicion  = parseFloat(eximicionInp.value);

      const filas = document.querySelectorAll("#evaluaciones .fila");
      let sumaPond = 0, notaAcumulada = 0, pondRestante = 0;

      filas.forEach(function (fila) {
        const pondInp = fila.querySelector(".ponderacion");
        const notaInp = fila.querySelector(".nota");
        const pond = parseFloat(pondInp.value);
        const notaStr = notaInp.value.trim();
        const nota = parseFloat(notaStr);

        const pondValida = !isNaN(pond) && pond >= 0 && pond <= 100;
        pondInp.classList.toggle("invalido", pondInp.value.trim() !== "" && !pondValida);

        const notaValida = notaStr !== "" && !isNaN(nota) && nota >= lim.min && nota <= lim.max;
        notaInp.classList.toggle("invalido", notaStr !== "" && !notaValida);
        notaInp.classList.toggle("valido", notaValida);

        if (pondValida) sumaPond += pond;
        if (pondValida && notaValida) notaAcumulada += nota * (pond / 100);
        else if (pondValida) pondRestante += pond;
      });

      const pondUsada = sumaPond - pondRestante;

      // Stats (con animación de conteo)
      animarNumero(document.getElementById("stat-acumulada"), notaAcumulada, lim.decimales);
      document.getElementById("stat-usada").textContent = fmt(redondear(pondUsada, 0), 0) + "%";
      document.getElementById("stat-restante").textContent = fmt(redondear(pondRestante, 0), 0) + "%";

      // Barra de ponderación total
      const pct = Math.max(0, Math.min(sumaPond, 100));
      barraRelleno.style.width = pct + "%";
      barraRelleno.classList.toggle("completa", Math.round(sumaPond) === 100);
      barraRelleno.classList.toggle("exceso", sumaPond > 100 + EPS);
      barraTexto.textContent = fmt(redondear(sumaPond, 0), 0) + "%";

      // Aviso
      const aviso = document.getElementById("aviso");
      if (filas.length > 0 && Math.round(sumaPond) !== 100) {
        aviso.hidden = false;
        aviso.textContent = "Las ponderaciones suman " + fmt(redondear(sumaPond, 0), 0) +
                            "%, no 100%. Revisa los porcentajes para que el resultado sea exacto.";
      } else {
        aviso.hidden = true;
      }

      // === Resultados, según el ramo tenga examen o no ===
      const resExamen = document.getElementById("res-examen");
      const completo = filas.length > 0 && pondRestante <= EPS && sumaPond > EPS;
      const NP = completo ? notaAcumulada / (sumaPond / 100) : null; // nota de presentación

      if (chkExamen.checked) {
        resExamen.hidden = false;

        // Fila 1 pasa a mostrar la Nota de Presentación
        if (completo) {
          const npRed = redondear(NP, lim.decimales);
          const seExime = NP >= eximicion - EPS;
          pintar(OBJ_APROBAR.id, "Nota de presentación", fmt(npRed, lim.decimales),
                 seExime ? "ok" : "neutro",
                 seExime ? "Te eximes con tu presentación" : "Promedio de tus evaluaciones");
        } else {
          pintar(OBJ_APROBAR.id, "Nota de presentación", "—", "neutro",
                 "Completa tus notas para calcularla");
        }

        // La eximición sigue dependiendo de la presentación
        evaluarObjetivo(OBJ_EXIMIR, eximicion, notaAcumulada, pondRestante, sumaPond, lim);

        // Y el examen que necesitas si no te eximes
        evaluarExamen(NP, completo, aprobacion, eximicion, lim);
      } else {
        resExamen.hidden = true;
        evaluarObjetivo(OBJ_APROBAR, aprobacion, notaAcumulada, pondRestante, sumaPond, lim);
        evaluarObjetivo(OBJ_EXIMIR,  eximicion,  notaAcumulada, pondRestante, sumaPond, lim);
      }

      guardar();
    }

    function evaluarObjetivo(cfg, objetivo, notaAcumulada, pondRestante, sumaPond, lim) {
      if (isNaN(objetivo)) { pintar(cfg.id, cfg.etiqueta, "—", "neutro", ""); return; }

      // Sin ponderaciones válidas no hay nada que promediar
      if (sumaPond <= EPS) { pintar(cfg.id, cfg.etiqueta, "—", "neutro", "Ingresa las ponderaciones"); return; }

      // Base real sobre la que se promedian las notas (no asumimos 100%)
      const factor = sumaPond / 100;

      // Ya no quedan evaluaciones pendientes -> nota final definitiva
      if (pondRestante <= EPS) {
        const final = redondear(notaAcumulada / factor, lim.decimales);
        const logra = final >= objetivo - EPS;
        pintar(cfg.id, "Nota final", fmt(final, lim.decimales), logra ? "ok" : "mal", logra ? cfg.ok : cfg.no);
        return;
      }

      // Promedio uniforme necesario en lo que queda (normalizado a la ponderación real)
      const necesaria = (objetivo * factor - notaAcumulada) / (pondRestante / 100);

      if (necesaria <= lim.min + EPS) {
        pintar(cfg.id, cfg.etiqueta, "¡Asegurado!", "ok", "Lo logras con cualquier nota");
      } else if (necesaria > lim.max + EPS) {
        pintar(cfg.id, cfg.etiqueta, "No alcanzable", "mal", "Ni con la nota máxima alcanza");
      } else {
        pintar(cfg.id, cfg.etiqueta, fmt(techo(necesaria, lim.decimales), lim.decimales),
               "neutro", "Promedio en lo que falta");
      }
    }

    // === ¿Qué nota necesito en el examen para aprobar? ===
    // Nota final = NP * (%presentación) + Examen * (%examen)
    function evaluarExamen(NP, completo, aprobacion, eximicion, lim) {
      const id = "res-examen";
      const etiqueta = "Examen para aprobar";

      if (!completo || NP === null) {
        pintar(id, etiqueta, "—", "neutro", "Ingresa todas tus notas de presentación");
        return;
      }
      if (!isNaN(eximicion) && NP >= eximicion - EPS) {
        pintar(id, "Examen", "No rindes ✓", "ok", "Te eximes con tu presentación");
        return;
      }

      let presPct = parseFloat(presPctInp.value);
      let examPct = parseFloat(examPctInp.value);
      if (isNaN(presPct)) presPct = 60;
      if (isNaN(examPct)) examPct = 100 - presPct;
      const pres = presPct / 100, exam = examPct / 100;

      if (exam <= EPS) {
        pintar(id, etiqueta, "—", "neutro", "Asigna un % de examen mayor a 0");
        return;
      }
      if (isNaN(aprobacion)) { pintar(id, etiqueta, "—", "neutro", ""); return; }

      const necesaria = (aprobacion - NP * pres) / exam;

      if (necesaria <= lim.min + EPS) {
        pintar(id, etiqueta, "¡Asegurado!", "ok", "Apruebas con cualquier nota");
      } else if (necesaria > lim.max + EPS) {
        pintar(id, etiqueta, "No alcanzable", "mal", "Ni con la nota máxima alcanza");
      } else {
        pintar(id, etiqueta, fmt(techo(necesaria, lim.decimales), lim.decimales),
               "neutro", "Nota mínima en el examen");
      }
    }
    function pintar(id, etiqueta, valor, estado, sub) {
      const el = document.getElementById(id);
      const valEl = el.querySelector(".valor");
      const estadoAnterior = el.dataset.estado || "";

      el.querySelector(".etiqueta").textContent = etiqueta;
      el.querySelector(".sub").textContent = sub || "";

      const num = parseFloat(valor);
      const esNumero = !isNaN(num) && /^[\d.]/.test(valor);

      if (esNumero && /^[\d.]/.test(valEl.dataset.num || "")) {
        animarNumero(valEl, num, valor.includes(".") ? (valor.split(".")[1] || "").length : 0);
        valEl.dataset.num = valor;
      } else {
        valEl.textContent = valor;
        valEl.dataset.num = esNumero ? valor : "";
      }

      const cambio = el.dataset.estado !== estado || el.dataset.valor !== valor;
      el.className = "resultado estado-" + estado;
      el.dataset.estado = estado;
      el.dataset.valor = valor;

      // Pulso sutil cada vez que cambia el resultado
      if (cambio && !reduceMotion) {
        void el.offsetWidth;
        el.classList.add("pulso");
        el.addEventListener("animationend", function () { el.classList.remove("pulso"); }, { once: true });
      }

      // Festejo cuando un objetivo PASA a estar logrado
      if (estado === "ok" && estadoAnterior && estadoAnterior !== "ok") {
        festejar(el);
        vibrar([10, 40, 25]);
      }
    }

    // Conteo animado de un número
    function animarNumero(el, destino, dec) {
      if (reduceMotion) { el.textContent = fmt(destino, dec); return; }
      const inicio = parseFloat(el.dataset.num || el.textContent) || 0;
      if (Math.abs(inicio - destino) < Math.pow(10, -dec) / 2) { el.textContent = fmt(destino, dec); el.dataset.num = fmt(destino, dec); return; }
      if (el._anim) cancelAnimationFrame(el._anim);
      const t0 = performance.now(), dur = 350;
      function paso(t) {
        const k = Math.min((t - t0) / dur, 1);
        const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
        el.textContent = fmt(inicio + (destino - inicio) * e, dec);
        if (k < 1) el._anim = requestAnimationFrame(paso);
        else { el.textContent = fmt(destino, dec); el.dataset.num = fmt(destino, dec); }
      }
      el._anim = requestAnimationFrame(paso);
    }

    // Destello + chispas al lograr un objetivo
    function festejar(el) {
      if (reduceMotion) return;
      el.classList.add("festejo");
      el.addEventListener("animationend", function () { el.classList.remove("festejo"); }, { once: true });

      const colores = ["#30d158", "#0071e3", "#ff9f0a", "#ff375f", "#5e5ce6"];
      const rect = el.getBoundingClientRect();
      for (let i = 0; i < 16; i++) {
        const c = document.createElement("span");
        c.className = "chispa";
        c.style.background = colores[i % colores.length];
        c.style.left = (rect.width - 30) + "px";
        c.style.top = (rect.height / 2) + "px";
        el.appendChild(c);
        const ang = (Math.PI * (0.15 + Math.random() * 0.7)) * -1; // hacia arriba
        const dist = 40 + Math.random() * 55;
        const dx = Math.cos(ang) * dist * (Math.random() < 0.5 ? -1 : 1);
        const dy = Math.sin(ang) * dist;
        c.animate([
          { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
          { transform: "translate(" + dx + "px," + dy + "px) rotate(" + (Math.random() * 360) + "deg)", opacity: 0 }
        ], { duration: 650 + Math.random() * 350, easing: "cubic-bezier(.2,.7,.3,1)" })
         .onfinish = function () { c.remove(); };
      }
    }

    // === Eventos ===
    btnAgregar.addEventListener("click", agregarYEnfocar);

    // Mostrar/ocultar la configuración de examen
    chkExamen.addEventListener("change", function () {
      configExamen.hidden = !chkExamen.checked;
      if (chkExamen.checked && !reduceMotion) {
        configExamen.classList.remove("aparece");
        void configExamen.offsetWidth;
        configExamen.classList.add("aparece");
      }
      vibrar(8);
      calcular();
    });

    // % presentación y % examen siempre suman 100
    presPctInp.addEventListener("input", function () {
      let v = parseFloat(presPctInp.value);
      if (isNaN(v)) return;
      v = Math.max(0, Math.min(100, v));
      examPctInp.value = redondear(100 - v, 0);
    });
    examPctInp.addEventListener("input", function () {
      let v = parseFloat(examPctInp.value);
      if (isNaN(v)) return;
      v = Math.max(0, Math.min(100, v));
      presPctInp.value = redondear(100 - v, 0);
    });

    escalaSel.addEventListener("change", function () {
      if (escalaSel.value === "100") { aprobacionInp.value = 60; eximicionInp.value = 70; }
      else { aprobacionInp.value = "4.0"; eximicionInp.value = "5.0"; }
      aplicarLimites();
      calcular();
    });

    btnBorrar.addEventListener("click", function () {
      if (!confirm("¿Borrar todos los datos y empezar de cero?")) return;
      try { localStorage.removeItem(CLAVE); } catch (e) {}
      escalaSel.value = "7";
      aprobacionInp.value = "4.0";
      eximicionInp.value = "5.0";
      chkExamen.checked = false;
      configExamen.hidden = true;
      presPctInp.value = "60";
      examPctInp.value = "40";
      contenedor.innerHTML = "";
      crearFila(null, true); crearFila(null, true); crearFila(null, true);
      aplicarLimites();
      calcular();
    });

    document.addEventListener("input", function (e) {
      const t = e.target;
      if (t && (t.classList.contains("nota") || t === aprobacionInp || t === eximicionInp)) {
        if (t.value.indexOf(",") !== -1) t.value = t.value.replace(/,/g, ".");
      }
      calcular();
    });

    // === Inicio ===
    const guardado = cargar();
    if (guardado) {
      escalaSel.value = guardado.escala || "7";
      aprobacionInp.value = guardado.aprobacion;
      eximicionInp.value = guardado.eximicion;
      chkExamen.checked = !!guardado.tieneExamen;
      configExamen.hidden = !chkExamen.checked;
      if (guardado.presPct != null) presPctInp.value = guardado.presPct;
      if (guardado.examPct != null) examPctInp.value = guardado.examPct;
      const fg = guardado.filas || [];
      if (fg.length) fg.forEach(function (d) { crearFila(d, false); });
      else crearFila(null, false);
    } else {
      crearFila(null, false); crearFila(null, false); crearFila(null, false);
    }
    aplicarLimites();
    calcular();
