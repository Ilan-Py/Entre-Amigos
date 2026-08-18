let grupos = [];
let personas = [];
let todasPersonas = [];
let directorioPersonas = [];
let resumen = null;
let ultimoInforme = null;

const $ = id => document.getElementById(id);


let ultimoDiagnosticoApi = null;


function modoDebugActivo() {
  const params = new URLSearchParams(window.location.search);
  return params.get("debug") === "1";
}

function registrarErrorApi(url, status, data, error = null) {
  const mensaje =
    data?.error ||
    error?.message ||
    "Error desconocido";

  ultimoDiagnosticoApi = {
    fecha: new Date().toISOString(),
    url,
    status,
    mensaje,
    data
  };

  console.error("[Entre Amigos API]", ultimoDiagnosticoApi);

  // En producción el detalle técnico queda solo en consola.
  if (!modoDebugActivo()) {
    return;
  }

  let panel = $("apiDebug");

  if (!panel) {
    panel = document.createElement("div");
    panel.id = "apiDebug";
    panel.className = "api-debug";

    panel.innerHTML = `
      <div class="api-debug-content">
        <b id="apiDebugTitle"></b>
        <span id="apiDebugMessage"></span>
      </div>

      <div class="api-debug-actions">
        <button id="btnCopiarDebug" type="button">
          Copiar diagnóstico
        </button>

        <button id="btnCerrarDebug" type="button">
          Cerrar
        </button>
      </div>
    `;

    document.body.appendChild(panel);

    $("btnCerrarDebug").addEventListener("click", () => {
      panel.remove();
    });

    $("btnCopiarDebug").addEventListener("click", async () => {
      if (!ultimoDiagnosticoApi) return;

      const texto = [
        "Entre Amigos - diagnóstico API",
        `Fecha: ${ultimoDiagnosticoApi.fecha}`,
        `Endpoint: ${ultimoDiagnosticoApi.url}`,
        `HTTP: ${ultimoDiagnosticoApi.status}`,
        `Mensaje: ${ultimoDiagnosticoApi.mensaje}`,
        "",
        "Respuesta:",
        JSON.stringify(ultimoDiagnosticoApi.data, null, 2)
      ].join("\\n");

      try {
        await navigator.clipboard.writeText(texto);
        toast("Diagnóstico copiado");
      } catch (_) {
        console.log(texto);
      }
    });
  }

  $("apiDebugTitle").textContent =
    `Error API · HTTP ${status || "?"}`;

  $("apiDebugMessage").textContent =
    `${url} · ${mensaje}`;
}



async function authRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options
    });

    let data = null;

    try {
      data = await response.json();
    } catch (_) {}

    const authMeSinSesion =
      url === "/api/auth/me" &&
      response.status === 401 &&
      data?.authenticated === false;

    if (!response.ok && !authMeSinSesion) {
      registrarErrorApi(url, response.status, data);
    }

    return {
      ok: response.ok,
      status: response.status,
      data
    };

  } catch (e) {
    registrarErrorApi(
      url,
      0,
      { error: "NETWORK_ERROR" },
      e
    );

    return {
      ok: false,
      status: 0,
      data: { error: e.message }
    };
  }
}


async function limpiarCachesViejos() {
  if (!("caches" in window)) return;

  try {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(key => key !== "entre-amigos-v12-0-2")
        .map(key => caches.delete(key))
    );
  } catch (e) {
    console.warn("No se pudieron limpiar caches viejos:", e);
  }
}

async function obtenerSesionActual() {
  const result = await authRequest("/api/auth/me");
  return result.ok ? result.data : null;
}

async function obtenerCsrfAuth() {
  const result = await authRequest("/auth/csrf");

  if (!result.ok || !result.data?.csrfToken) {
    throw new Error("No se pudo iniciar el flujo de autenticación.");
  }

  return result.data.csrfToken;
}

async function iniciarSesionGoogle() {
  try {
    const csrfToken = await obtenerCsrfAuth();

    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/auth/signin/google";

    const csrf = document.createElement("input");
    csrf.type = "hidden";
    csrf.name = "csrfToken";
    csrf.value = csrfToken;

    const callback = document.createElement("input");
    callback.type = "hidden";
    callback.name = "callbackUrl";
    callback.value = window.location.origin + "/";

    form.append(csrf, callback);
    document.body.appendChild(form);
    form.submit();

  } catch (e) {
    alert(e.message);
  }
}

async function cerrarSesion() {
  try {
    const csrfToken = await obtenerCsrfAuth();

    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/auth/signout";

    const csrf = document.createElement("input");
    csrf.type = "hidden";
    csrf.name = "csrfToken";
    csrf.value = csrfToken;

    const callback = document.createElement("input");
    callback.type = "hidden";
    callback.name = "callbackUrl";
    callback.value = window.location.origin + "/";

    form.append(csrf, callback);
    document.body.appendChild(form);
    form.submit();

  } catch (e) {
    alert(e.message);
  }
}

function mostrarSesion(user) {
  $("authGate").hidden = true;
  $("appAuthenticated").hidden = false;

  $("authUserName").textContent =
    user.name || user.email || "Mi cuenta";

  if (user.image) {
    $("authUserAvatar").src = user.image;
    $("authUserAvatar").hidden = false;
  } else {
    $("authUserAvatar").hidden = true;
  }
}

function mostrarLogin() {
  $("authGate").hidden = false;
  $("appAuthenticated").hidden = true;
}

$("btnGoogleLogin")?.addEventListener(
  "click",
  iniciarSesionGoogle
);

$("btnLogout")?.addEventListener(
  "click",
  cerrarSesion
);

const moneda = n =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(n || 0));

const aCentavos = v => Math.round(Number(v || 0) * 100);
const aPesos = c => c / 100;

function hoy() {
  return new Date().toISOString().slice(0,10);
}

function inicioMesActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
}

function finMesActual() {
  const d = new Date();
  const u = new Date(d.getFullYear(), d.getMonth()+1, 0);

  return `${u.getFullYear()}-${String(u.getMonth()+1).padStart(2,"0")}-${String(u.getDate()).padStart(2,"0")}`;
}

function fechaAR(fecha) {
  if (!fecha) return "";
  const [y,m,d] = String(fecha).slice(0,10).split("-");
  return `${d}/${m}/${y}`;
}

function esSupergrupo() {
  return $("grupoActual")?.value === "super";
}

function grupoId() {
  if (esSupergrupo()) return 0;
  return Number($("grupoActual").value || 0);
}

function grupoNombre() {
  if (esSupergrupo()) return "Todos mis amigos";

  const g = grupos.find(x => x.id === grupoId());
  return g?.nombre || "";
}

function nombreCompleto(p) {
  return [p.nombre, p.apellido].filter(Boolean).join(" ");
}

function toast(msg) {
  $("toast").textContent = msg;
  $("toast").style.display = "block";
  setTimeout(() => $("toast").style.display = "none", 2200);
}


function setLoading(
  activo,
  titulo = "Cargando Entre Amigos",
  texto = "Buscando los datos del grupo..."
) {
  const loader = $("appLoading");

  if (!loader) return;

  if (activo) {
    $("loadingTitle").textContent = titulo;
    $("loadingText").textContent = texto;

    loader.hidden = false;
    document.body.classList.add("is-loading");
  } else {
    loader.hidden = true;
    document.body.classList.remove("is-loading");
  }
}

function setStatsLoading() {
  ["gastoTotal", "totalDeuda", "cantEventos", "cantPersonas"].forEach(id => {
    $(id).textContent = "—";
    $(id).classList.add("loading-value");
  });
}

function clearStatsLoading() {
  ["gastoTotal", "totalDeuda", "cantEventos", "cantPersonas"].forEach(id => {
    $(id).classList.remove("loading-value");
  });
}

async function api(url, options={}) {
  let r;

  try {
    r = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...options
    });
  } catch (networkError) {
    registrarErrorApi(
      url,
      0,
      { error: "NETWORK_ERROR" },
      networkError
    );

    throw networkError;
  }

  let data;

  try {
    data = await r.json();
  } catch (_) {
    data = {
      error: `Respuesta HTTP ${r.status} sin JSON válido`
    };
  }

  if (r.status === 401) {
    const authMeSinSesion =
      url === "/api/auth/me" &&
      data?.authenticated === false;

    if (!authMeSinSesion) {
      registrarErrorApi(url, r.status, data);
    }

    mostrarLogin();

    const error = new Error(
      "La sesión venció. Volvé a iniciar sesión."
    );
    error.status = 401;
    error.data = data;
    throw error;
  }

  if (!r.ok) {
    registrarErrorApi(url, r.status, data);

    const error = new Error(data.error || "Error");
    error.status = r.status;
    error.data = data;
    throw error;
  }

  return data;
}

function abrirTab(nombre) {
  document.querySelectorAll(".tab")
    .forEach(x => x.classList.remove("activo"));

  document.querySelectorAll(".panel")
    .forEach(x => x.classList.remove("activo"));

  document.querySelector(`.tab[data-tab="${nombre}"]`)
    ?.classList.add("activo");

  $(nombre).classList.add("activo");
}

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", async () => {
    abrirTab(btn.dataset.tab);

    if (
      btn.dataset.tab === "directorio" &&
      esSupergrupo()
    ) {
      try {
        directorioPersonas =
          await api("/api/directorio-personas");

        renderDirectorioMaster();
      } catch (e) {
        console.error(e);
        alert("No se pudo cargar el directorio de personas.");
      }
    }
  });
});

// ---------- GRUPOS ----------

async function cargarGrupos() {
  grupos = await api("/api/grupos");

  $("grupoActual").innerHTML =
    `<option value="super">Todos mis amigos</option>` +
    grupos.map(g =>
      `<option value="${g.id}">${g.nombre}</option>`
    ).join("");

  const guardado =
    localStorage.getItem("grupo_actual");

  if (
    guardado === "super" ||
    grupos.some(g => String(g.id) === guardado)
  ) {
    $("grupoActual").value = guardado;
  } else {
    $("grupoActual").value = "super";
    localStorage.setItem("grupo_actual", "super");
  }

  actualizarModoSupergrupo();
}

$("grupoActual").addEventListener("change", async () => {
  localStorage.setItem(
    "grupo_actual",
    $("grupoActual").value
  );

  actualizarModoSupergrupo();

  setStatsLoading();

  setLoading(
    true,
    esSupergrupo()
      ? "Cargando todos tus grupos"
      : "Cambiando de grupo",
    esSupergrupo()
      ? "Consolidando saldos y movimientos..."
      : "Actualizando saldos y movimientos..."
  );

  try {
    if (esSupergrupo()) {
      await actualizarSupergrupo();
      renderDirectorioMaster(
        $("buscarDirectorioMaster")?.value || ""
      );
    } else {
      await actualizarTodo();
    }
  } finally {
    setLoading(false);
  }
});

$("btnNuevoGrupo").addEventListener("click", async () => {
  const nombre = prompt("Nombre del nuevo grupo:");
  if (!nombre?.trim()) return;

  try {
    const g = await api("/api/grupos", {
      method: "POST",
      body: JSON.stringify({ nombre })
    });

    await cargarGrupos();
    $("grupoActual").value = g.id;
    localStorage.setItem("grupo_actual", g.id);

    localStorage.setItem("onboarding_grupo", String(g.id));

    setStatsLoading();
    setLoading(true, "Preparando el grupo", "Ahora agregamos a las personas...");
    try {
      await actualizarTodo();
    } finally {
      setLoading(false);
    }

    abrirTab("personas");
    actualizarOnboardingGrupo();
    toast("Grupo creado. Agregá a sus integrantes.");

  } catch (e) {
    alert(e.message);
  }
});



function actualizarModoSupergrupo() {
  const supergrupo = esSupergrupo();

  $("btnArchivarGrupo")?.classList.toggle("oculto", supergrupo);

  document.querySelector('.tab[data-tab="gasto"]')
    ?.classList.toggle("oculto", supergrupo);

  document.querySelector('.tab[data-tab="pago"]')
    ?.classList.toggle("oculto", supergrupo);

  $("tabPersonas")?.classList.toggle("oculto", supergrupo);
  $("tabDirectorio")?.classList.toggle("oculto", !supergrupo);

  const panelActivo =
    document.querySelector(".panel.activo")?.id;

  if (
    supergrupo &&
    ["gasto", "pago", "personas"].includes(panelActivo)
  ) {
    abrirTab("resumen");
  }

  if (
    !supergrupo &&
    panelActivo === "directorio"
  ) {
    abrirTab("personas");
  }
}


function renderDirectorioMaster(filtro = "") {
  const contenedor = $("directorioPersonasMaster");
  if (!contenedor) return;

  const q = String(filtro || "").trim().toLowerCase();
  const soloDuplicados =
    $("soloDuplicadosMaster")?.checked === true;

  const rows = directorioPersonas.filter(p => {
    if (soloDuplicados && !p.posible_duplicado) {
      return false;
    }

    const texto = [
      p.nombre,
      p.apellido,
      p.telefono,
      p.alias_bancario,
      p.grupos_activos
    ].filter(Boolean).join(" ").toLowerCase();

    return !q || texto.includes(q);
  });

  contenedor.innerHTML = rows.length
    ? rows.map(p => `
        <div class="directory-row ${
          p.posible_duplicado ? "possible-duplicate" : ""
        }">
          <div>
            <div class="person-name">
              ${nombreCompleto(p)}
              ${
                p.posible_duplicado
                  ? `<span class="duplicate-badge">Posible duplicado</span>`
                  : ""
              }
            </div>

            <div class="person-meta">
              ${p.telefono ? `Teléfono: ${p.telefono}` : "Sin teléfono"}
              ·
              ${p.alias_bancario ? `Alias: ${p.alias_bancario}` : "Sin alias"}
            </div>

            <div class="person-meta">
              Grupos: ${p.grupos_activos || "ninguno"}
            </div>
          </div>

          <div class="person-actions">
            <button onclick="editarPersona(${p.id})">
              Editar
            </button>

            <button
              class="danger-soft"
              onclick="ocultarPersonaDirectorio(${p.id})"
            >
              Ocultar
            </button>
          </div>
        </div>
      `).join("")
    : `<p class="muted">No hay coincidencias.</p>`;
}

let timerDirectorioMaster;

$("buscarDirectorioMaster")?.addEventListener("input", e => {
  clearTimeout(timerDirectorioMaster);

  timerDirectorioMaster = setTimeout(() => {
    renderDirectorioMaster(e.target.value);
  }, 180);
});

$("soloDuplicadosMaster")?.addEventListener("change", () => {
  renderDirectorioMaster(
    $("buscarDirectorioMaster")?.value || ""
  );
});

async function cargarPersonasSupergrupo() {
  personas = await api("/api/supergrupo/personas");
  todasPersonas = await api("/api/personas");
  directorioPersonas = await api("/api/directorio-personas");

  renderSelectsPersonas();
  actualizarModoSupergrupo();
  renderDirectorioMaster();
}

async function cargarResumenSupergrupo() {
  const desde = inicioMesActual();
  const hasta = finMesActual();

  const [mensual, general] = await Promise.all([
    api(`/api/supergrupo/resumen?desde=${desde}&hasta=${hasta}`),
    api("/api/supergrupo/resumen")
  ]);

  resumen = general;

  $("gastoTotal").textContent =
    moneda(mensual.estadisticas.gasto_total);

  $("totalDeuda").textContent =
    moneda(general.totalDeuda);

  $("cantEventos").textContent =
    mensual.estadisticas.eventos;

  $("cantPersonas").textContent =
    general.estadisticas.personas;

  $("infoTransferencias").textContent =
    general.cantidadTransferencias === 0
      ? "Todo saldado entre todos tus grupos"
      : `${general.cantidadTransferencias} ${
          general.cantidadTransferencias === 1
            ? "transferencia pendiente"
            : "transferencias pendientes"
        } en la vista consolidada`;

  $("deudas").innerHTML = general.deudas.length
    ? general.deudas.map(d => `
        <div class="debt">
          <div>
            <b>${d.deudor}</b>
            le debe a
            <b>${d.acreedor}</b>
          </div>

          <div class="amount">${moneda(d.monto)}</div>

          <div class="muted">
            Vista consolidada: registrá los pagos dentro del grupo correspondiente.
          </div>
        </div>
      `).join("")
    : `
      <div class="all-settled">
        <div class="all-settled-title">Todo saldado</div>
        <div class="muted">
          Considerando todos los grupos activos, no hay saldo pendiente.
        </div>
      </div>
    `;

  $("balances").innerHTML = general.balances.map(b => {
    const clase =
      b.saldo > 0.01
        ? "pending-positive"
        : b.saldo < -0.01
          ? "pending-negative"
          : "";

    const texto =
      b.saldo > 0.01
        ? `Tiene que recibir ${moneda(b.saldo)}`
        : b.saldo < -0.01
          ? `Tiene que pagar ${moneda(-b.saldo)}`
          : "Está al día";

    return `
      <div class="balance ${clase}">
        <div class="balance-head">
          <div class="balance-name">${b.nombre}</div>
          <b>${texto}</b>
        </div>

        <div class="balance-equation">
          <div>
            Aportó <b>${moneda(b.puso)}</b>
            − consumió <b>${moneda(b.consumio)}</b>
            = saldo inicial <b>${moneda(b.saldoAntes)}</b>
          </div>

          <div>
            + transferencias enviadas <b>${moneda(b.transferido)}</b>
            − transferencias recibidas <b>${moneda(b.recibido)}</b>
            = saldo consolidado <b>${moneda(b.saldo)}</b>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

async function cargarMovimientosSupergrupo(q = "") {
  const url = q
    ? `/api/supergrupo/movimientos?q=${encodeURIComponent(q)}`
    : "/api/supergrupo/movimientos";

  const movimientos = await api(url);

  $("listaMovimientos").innerHTML = movimientos.length
    ? movimientos.map(m => {
        if (m.tipo === "Gasto") {
          return `
            <div class="movement">
              <div class="movement-title">${m.descripcion}</div>
              <div class="movement-category">
                ${m.categoria || "Otros"} · ${m.grupo}
              </div>
              <div>${moneda(m.monto)}</div>
              <div class="movement-meta">
                ${fechaAR(m.fecha)}
              </div>
            </div>
          `;
        }

        return `
          <div class="movement">
            <div class="movement-title">
              ${m.descripcion || "Transferencia"}
            </div>
            <div>${moneda(m.monto)}</div>
            <div class="movement-meta">
              ${fechaAR(m.fecha)}
              · ${m.grupo}
              · ${m.deudor} → ${m.acreedor}
            </div>
          </div>
        `;
      }).join("")
    : `<p class="muted">No hay movimientos.</p>`;
}

async function generarInformeSupergrupo() {
  const desde = $("informeDesde").value;
  const hasta = $("informeHasta").value;
  const personaId = $("informePersona").value;

  const params = new URLSearchParams();

  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  if (personaId) params.set("persona_id", personaId);

  const paramsEventos = new URLSearchParams();

  if (desde) paramsEventos.set("desde", desde);
  if (hasta) paramsEventos.set("hasta", hasta);

  const [data, eventos] = await Promise.all([
    api(`/api/supergrupo/resumen?${params.toString()}`),
    api(`/api/supergrupo/eventos?${paramsEventos.toString()}`)
  ]);

  ultimoInforme = {
    data,
    eventos,
    desde,
    hasta,
    personaId
  };

  const persona =
    personaId
      ? personas.find(p => p.id === Number(personaId))
      : null;

  const titulo = persona
    ? `Informe general de ${nombreCompleto(persona)}`
    : "Informe general · Todos mis amigos";

  const periodo =
    `${desde ? fechaAR(desde) : "Inicio"} — ${
      hasta ? fechaAR(hasta) : "Actualidad"
    }`;

  const filas = data.balances.map(b => {
    let estado = "Al día";
    let clase = "ok";

    if (b.saldo > 0.01) {
      estado = `Recibe ${moneda(b.saldo)}`;
      clase = "receive";
    } else if (b.saldo < -0.01) {
      estado = `Paga ${moneda(-b.saldo)}`;
      clase = "pay";
    }

    return `
      <tr>
        <td><b>${b.nombre}</b></td>
        <td>${moneda(b.puso)}</td>
        <td>${moneda(b.consumio)}</td>
        <td>${moneda(b.transferido)}</td>
        <td>${moneda(b.recibido)}</td>
        <td>
          <span class="report-status ${clase}">
            ${estado}
          </span>
        </td>
      </tr>
    `;
  }).join("");

  const deudas = data.deudas.length
    ? `
      <div class="report-debt-list">
        ${data.deudas.map(d => `
          <div class="report-debt-row">
            <div><b>${d.deudor}</b></div>
            <div class="arrow">→</div>
            <div class="receiver"><b>${d.acreedor}</b></div>
            <div class="debt-amount">${moneda(d.monto)}</div>
          </div>
        `).join("")}
      </div>
    `
    : `<p class="pending-positive">No hay saldo consolidado pendiente.</p>`;

  $("contenidoInforme").innerHTML = `
    <div class="report-header">
      <div>
        <h3>${titulo}</h3>
        <div class="report-period">${periodo}</div>
      </div>

      <div class="report-total-box">
        <span>Gasto total de todos los grupos</span>
        <b>${moneda(data.estadisticas.gasto_total)}</b>
      </div>
    </div>

    <div class="report-section">
      <h3 class="report-section-title">
        Resumen consolidado
      </h3>

      <table>
        <thead>
          <tr>
            <th>Persona</th>
            <th>Aportó</th>
            <th>Consumió</th>
            <th>Transf. enviadas</th>
            <th>Transf. recibidas</th>
            <th>Estado actual</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>

    <div class="report-section">
      <h3 class="report-section-title">
        Compensación general
      </h3>
      ${deudas}
    </div>

    <div class="report-section">
      <p class="muted">
        Este informe consolida todos los grupos activos.
        Los movimientos originales permanecen asociados a sus grupos reales.
      </p>
    </div>
  `;

  generarResumenCompartible();
}

async function actualizarSupergrupo() {
  await cargarPersonasSupergrupo();

  await Promise.all([
    cargarResumenSupergrupo(),
    cargarMovimientosSupergrupo()
  ]);

  await generarInformeSupergrupo();
  clearStatsLoading();
}

$("btnArchivarGrupo")?.addEventListener("click", async () => {
  if (esSupergrupo() || !grupoId()) return;

  const nombre = grupoNombre();

  if (!confirm(
    `¿Archivar el grupo "${nombre}"?\n\n` +
    `Va a dejar de aparecer entre los grupos activos, ` +
    `pero no se borrará ningún gasto ni movimiento.`
  )) {
    return;
  }

  setLoading(
    true,
    "Archivando grupo",
    "Verificando que no queden saldos pendientes..."
  );

  try {
    await api(`/api/grupos/${grupoId()}/archivar`, {
      method: "POST"
    });

    toast("Grupo archivado correctamente");

    localStorage.setItem("grupo_actual", "super");

    await cargarGrupos();
    $("grupoActual").value = "super";

    actualizarModoSupergrupo();
    await actualizarSupergrupo();

    abrirTab("resumen");

  } catch (e) {
    if (e.data?.pendientes?.length) {
      const detalle = e.data.pendientes.map(p => {
        return p.saldo > 0
          ? `• ${p.nombre}: debe recibir ${moneda(p.saldo)}`
          : `• ${p.nombre}: debe pagar ${moneda(-p.saldo)}`;
      }).join("\n");

      alert(
        `No se puede archivar el grupo todavía.\n\n${detalle}`
      );
    } else {
      alert(e.message);
    }
  } finally {
    setLoading(false);
  }
});

async function mostrarGruposArchivados() {
  try {
    const todos =
      await api("/api/grupos?incluir_archivados=true");

    const archivados =
      todos.filter(g => !g.activo);

    $("modalContenido").innerHTML = `
      <h2>Grupos archivados</h2>

      <p class="muted">
        Archivar solo oculta el grupo de la vista normal.
        Todo su historial permanece guardado.
      </p>

      ${
        archivados.length
          ? archivados.map(g => `
              <div class="archived-group-row">
                <div><b>${g.nombre}</b></div>

                <button
                  type="button"
                  onclick="restaurarGrupo(${g.id})"
                >
                  Restaurar grupo
                </button>
              </div>
            `).join("")
          : `<p class="muted">No hay grupos archivados.</p>`
      }
    `;

    $("modal").classList.remove("oculto");

  } catch (e) {
    alert(e.message);
  }
}

async function restaurarGrupo(id) {
  try {
    await api(`/api/grupos/${id}/restaurar`, {
      method: "POST"
    });

    await cargarGrupos();

    $("grupoActual").value = String(id);
    localStorage.setItem("grupo_actual", String(id));

    actualizarModoSupergrupo();
    cerrarModal();

    await actualizarTodo();
    abrirTab("resumen");

    toast("Grupo restaurado");

  } catch (e) {
    alert(e.message);
  }
}

// ---------- PERSONAS ----------

async function cargarPersonas() {
  if (!grupoId()) return;

  [personas, todasPersonas, directorioPersonas] = await Promise.all([
    api(`/api/personas?grupo_id=${grupoId()}`),
    api("/api/personas"),
    api("/api/directorio-personas")
  ]);

  renderListaPersonas();
  renderSelectsPersonas();
  renderParticipantes();
  renderPersonaExistente();
  renderDirectorio();
  actualizarOnboardingGrupo();
}

function renderListaPersonas() {
  $("listaPersonas").innerHTML = personas.length
    ? personas.map(p => `
        <div class="person-card">
          <div class="person-card-top">
            <div>
              <div class="person-name">${nombreCompleto(p)}</div>
              <div class="person-meta">
                ${p.telefono ? `Teléfono: ${p.telefono}<br>` : ""}
                ${p.alias_bancario ? `Alias: ${p.alias_bancario}` : ""}
              </div>
            </div>

            <div class="person-actions">
              <button onclick="editarPersona(${p.id})">Editar</button>
              <button onclick="quitarDelGrupo(${p.id})">Ocultar</button>
            </div>
          </div>
        </div>
      `).join("")
    : `<p class="muted">Este grupo todavía no tiene integrantes.</p>`;
}

function renderSelectsPersonas() {
  const opts =
    `<option value="">Seleccionar...</option>` +
    personas.map(p =>
      `<option value="${p.id}">${nombreCompleto(p)}</option>`
    ).join("");

  $("deudor").innerHTML = opts;
  $("acreedor").innerHTML = opts;

  $("informePersona").innerHTML =
    `<option value="">Todo el grupo</option>` +
    personas.map(p =>
      `<option value="${p.id}">${nombreCompleto(p)}</option>`
    ).join("");
}

function renderParticipantes() {
  $("participantes").innerHTML = personas.map(p => `
    <label class="chip">
      <input type="checkbox" class="participante" value="${p.id}">
      ${nombreCompleto(p)}
    </label>
  `).join("");

  document.querySelectorAll(".participante").forEach(i => {
    i.addEventListener("change", () => {
      renderPagadores();
      renderMontosPersonalizados();
    });
  });

  renderPagadores();
}


function setTodosParticipantes(marcado) {
  document.querySelectorAll(".participante").forEach(i => {
    i.checked = marcado;
  });

  renderPagadores();
  renderMontosPersonalizados();
}

$("btnSeleccionarTodos")?.addEventListener("click", () => {
  setTodosParticipantes(true);
});

$("btnDeseleccionarTodos")?.addEventListener("click", () => {
  setTodosParticipantes(false);
});

$("categoriaGasto")?.addEventListener("change", e => {
  const personalizada = e.target.value === "__otra__";
  $("categoriaOtraWrap").classList.toggle("oculto", !personalizada);

  if (personalizada) {
    $("categoriaOtra").focus();
  } else {
    $("categoriaOtra").value = "";
  }
});

function categoriaSeleccionada() {
  if ($("categoriaGasto").value === "__otra__") {
    return $("categoriaOtra").value.trim() || "Otros";
  }

  return $("categoriaGasto").value || "Otros";
}

function renderPersonaExistente() {
  const idsActuales = new Set(personas.map(p => p.id));
  const disponibles = todasPersonas.filter(p => !idsActuales.has(p.id));

  $("personaExistente").innerHTML = disponibles.length
    ? `<option value="">Seleccionar...</option>` +
      disponibles.map(p =>
        `<option value="${p.id}">${nombreCompleto(p)}</option>`
      ).join("")
    : `<option value="">No hay personas disponibles</option>`;
}


function actualizarOnboardingGrupo() {
  const onboardingId =
    Number(localStorage.getItem("onboarding_grupo") || 0);

  const activo =
    onboardingId === grupoId();

  $("onboardingGrupo")?.classList.toggle("oculto", !activo);
  $("onboardingContinuar")?.classList.toggle(
    "oculto",
    !(activo && personas.length > 0)
  );

  if (activo && personas.length > 0) {
    $("onboardingGrupo").querySelector("h2").textContent =
      personas.length === 1
        ? "Ya agregaste 1 integrante"
        : `Ya agregaste ${personas.length} integrantes`;

    $("onboardingGrupo").querySelector(".muted").textContent =
      "Podés seguir agregando personas o continuar al primer gasto.";
  }
}

$("btnPrimerGasto")?.addEventListener("click", () => {
  localStorage.removeItem("onboarding_grupo");
  actualizarOnboardingGrupo();
  abrirTab("gasto");
  window.scrollTo({ top: 0, behavior: "smooth" });
});


function renderDirectorio(filtro = "") {
  const q = String(filtro || "").trim().toLowerCase();
  const soloDuplicados = $("soloDuplicados")?.checked === true;

  const rows = directorioPersonas.filter(p => {
    if (soloDuplicados && !p.posible_duplicado) return false;
    const texto = [
      p.nombre,
      p.apellido,
      p.telefono,
      p.alias_bancario,
      p.grupos_activos,
      p.grupos_ocultos
    ].filter(Boolean).join(" ").toLowerCase();

    return !q || texto.includes(q);
  });

  $("directorioPersonas").innerHTML = rows.length
    ? rows.map(p => {
        const estaActivo =
          String(p.grupos_activos || "")
            .split(",")
            .map(x => x.trim())
            .includes(grupoNombre());

        return `
          <div class="directory-row ${p.posible_duplicado ? "possible-duplicate" : ""}">
            <div>
              <div class="person-name">
                ${nombreCompleto(p)}
                ${p.posible_duplicado ? `<span class="duplicate-badge">Posible duplicado</span>` : ""}
              </div>

              <div class="person-meta">
                ${p.telefono ? `Teléfono: ${p.telefono}` : "Sin teléfono"}
                ·
                ${p.alias_bancario ? `Alias: ${p.alias_bancario}` : "Sin alias"}
              </div>

              <div class="person-meta">
                Grupos activos: ${p.grupos_activos || "ninguno"}
                ${p.grupos_ocultos ? `<br>Historial en: ${p.grupos_ocultos}` : ""}
              </div>
            </div>

            <div class="person-actions">
              <button onclick="editarPersona(${p.id})">Editar</button>

              ${
                esSupergrupo()
                  ? `
                    <button
                      class="danger-soft"
                      onclick="ocultarPersonaDirectorio(${p.id})"
                    >
                      Ocultar
                    </button>
                  `
                  : estaActivo
                    ? `<span class="directory-current">En este grupo</span>`
                    : `<button onclick="agregarPersonaDirectorio(${p.id})">Agregar al grupo</button>`
              }
            </div>
          </div>
        `;
      }).join("")
    : `<p class="muted">No hay coincidencias.</p>`;
}

async function agregarPersonaDirectorio(id) {
  try {
    await api(`/api/grupos/${grupoId()}/personas/${id}`, {
      method: "POST"
    });

    await actualizarTodo();
    toast("Persona agregada al grupo");

  } catch (e) {
    alert(e.message);
  }
}


async function ocultarPersonaDirectorio(id) {
  const persona = directorioPersonas.find(p => p.id === id);
  const nombre = persona ? nombreCompleto(persona) : "esta persona";

  if (!confirm(
    `¿Ocultar a ${nombre} del directorio?\n\n` +
    `No se borrará su historial y dejará de aparecer como opción ` +
    `para agregarla a grupos.`
  )) return;

  setLoading(true, "Ocultando persona", "Verificando saldos pendientes...");

  try {
    await api(`/api/personas/${id}/ocultar`, { method: "POST" });

    toast("Persona ocultada");

    if (esSupergrupo()) {
      await actualizarSupergrupo();
      renderDirectorioMaster(
        $("buscarDirectorioMaster")?.value || ""
      );
    } else {
      await actualizarTodo();
    }
  } catch (e) {
    if (e.data?.pendientes?.length) {
      const detalle = e.data.pendientes.map(p =>
        p.saldo > 0
          ? `• ${p.grupo}: debe recibir ${moneda(p.saldo)}`
          : `• ${p.grupo}: debe pagar ${moneda(-p.saldo)}`
      ).join("\n");

      alert(`No se puede ocultar todavía.\n\n${detalle}`);
    } else {
      alert(e.message);
    }
  } finally {
    setLoading(false);
  }
}

async function mostrarPersonasOcultas() {
  try {
    const todas = await api("/api/directorio-personas?incluir_ocultas=true");
    const ocultas = todas.filter(p => !p.activo);

    $("modalContenido").innerHTML = `
      <h2>Personas ocultas</h2>
      <p class="muted">
        Conservan todo su historial y pueden restaurarse al directorio.
      </p>

      ${
        ocultas.length
          ? ocultas.map(p => `
              <div class="archived-group-row">
                <div>
                  <b>${nombreCompleto(p)}</b>
                  <div class="muted">
                    ${p.alias_bancario ? `Alias: ${p.alias_bancario}` : "Sin alias"}
                    ${p.telefono ? ` · Tel: ${p.telefono}` : ""}
                  </div>
                </div>

                <button
                  type="button"
                  onclick="restaurarPersona(${p.id})"
                >
                  Restaurar persona
                </button>
              </div>
            `).join("")
          : `<p class="muted">No hay personas ocultas.</p>`
      }
    `;

    $("modal").classList.remove("oculto");
  } catch (e) {
    alert(e.message);
  }
}

async function restaurarPersona(id) {
  try {
    await api(`/api/personas/${id}/restaurar`, { method: "POST" });

    cerrarModal();

    if (esSupergrupo()) {
      await actualizarSupergrupo();
    } else {
      await actualizarTodo();
    }

    toast("Persona restaurada");
  } catch (e) {
    alert(e.message);
  }
}

$("btnPersonasOcultas")?.addEventListener(
  "click",
  mostrarPersonasOcultas
);


let timerDirectorio;

$("buscarDirectorio")?.addEventListener("input", e => {
  clearTimeout(timerDirectorio);

  timerDirectorio = setTimeout(() => {
    renderDirectorio(e.target.value);
  }, 180);
});

$("soloDuplicados")?.addEventListener("change", () => {
  renderDirectorio($("buscarDirectorio")?.value || "");
});

$("btnAgregarExistente").addEventListener("click", async () => {
  const personaId = Number($("personaExistente").value);
  if (!personaId) return;

  try {
    await api(`/api/grupos/${grupoId()}/personas/${personaId}`, {
      method: "POST"
    });

    await actualizarTodo();
    toast("Persona agregada al grupo");

  } catch (e) {
    alert(e.message);
  }
});

async function quitarDelGrupo(id) {
  if (!confirm("¿Ocultar esta persona del grupo actual? El historial de gastos se conservará.")) return;

  try {
    await api(`/api/grupos/${grupoId()}/personas/${id}`, {
      method: "DELETE"
    });

    await actualizarTodo();

  } catch (e) {
    alert(e.message);
  }
}

function editarPersona(id) {
  const p = todasPersonas.find(x => x.id === id);
  if (!p) return;

  $("modalContenido").innerHTML = `
    <h2>Editar persona</h2>

    <form id="formEditarPersona">
      <div class="form-grid">
        <label>
          Nombre *
          <input id="editNombre" value="${p.nombre || ""}" required>
        </label>
        <label>
          Apellido
          <input id="editApellido" value="${p.apellido || ""}">
        </label>
        <label>
          Teléfono
          <input id="editTelefono" value="${p.telefono || ""}">
        </label>
        <label>
          Alias bancario
          <input id="editAlias" value="${p.alias_bancario || ""}">
        </label>
      </div>

      <button class="primary">Guardar cambios</button>
    </form>
  `;

  $("modal").classList.remove("oculto");

  $("formEditarPersona").addEventListener("submit", async e => {
    e.preventDefault();

    try {
      await api(`/api/personas/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          nombre: $("editNombre").value,
          apellido: $("editApellido").value,
          telefono: $("editTelefono").value,
          alias_bancario: $("editAlias").value
        })
      });

      cerrarModal();
      await actualizarTodo();
      toast("Persona actualizada");

    } catch (e) {
      alert(e.message);
    }
  });
}


function mostrarFormularioNuevaPersona(mostrar) {
  const form = $("formPersona");
  const boton = $("btnMostrarNuevaPersona");

  form.classList.toggle("oculto", !mostrar);
  boton.setAttribute("aria-expanded", String(mostrar));

  if (mostrar) {
    boton.classList.add("activo");
    setTimeout(() => $("nombrePersona")?.focus(), 50);
  } else {
    boton.classList.remove("activo");
    form.reset();
  }
}

$("btnMostrarNuevaPersona")?.addEventListener("click", () => {
  const estaOculto = $("formPersona").classList.contains("oculto");
  mostrarFormularioNuevaPersona(estaOculto);
});

$("btnCancelarNuevaPersona")?.addEventListener("click", () => {
  mostrarFormularioNuevaPersona(false);
});

$("formPersona").addEventListener("submit", async e => {
  e.preventDefault();

  const payload = {
    nombre: $("nombrePersona").value,
    apellido: $("apellidoPersona").value,
    telefono: $("telefonoPersona").value,
    alias_bancario: $("aliasPersona").value,
    grupo_id: grupoId()
  };

  try {
    await api("/api/personas", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    mostrarFormularioNuevaPersona(false);
    await actualizarTodo();
    toast("Persona agregada");

  } catch (e) {
    if (e.status === 409 && e.data?.existente) {
      const existente = e.data.existente;
      const nom = nombreCompleto(existente);

      const usarExistente = confirm(
        `Ya existe una persona similar: ${nom}.\n\n` +
        `Aceptar: usar esa persona en el grupo actual.\n` +
        `Cancelar: crear otra persona distinta igualmente.`
      );

      try {
        if (usarExistente) {
          await api(`/api/grupos/${grupoId()}/personas/${existente.id}`, {
            method: "POST"
          });
        } else {
          await api("/api/personas", {
            method: "POST",
            body: JSON.stringify({
              ...payload,
              forzar_nuevo: true
            })
          });
        }

        mostrarFormularioNuevaPersona(false);
        await actualizarTodo();

        toast(
          usarExistente
            ? "Persona existente agregada"
            : "Nueva persona creada"
        );

      } catch (e2) {
        alert(e2.message);
      }

      return;
    }

    alert(e.message);
  }
});

// ---------- GASTOS ----------

function seleccionados() {
  return [...document.querySelectorAll(".participante:checked")]
    .map(x => Number(x.value));
}

function renderPagadores() {
  const ids = seleccionados();

  $("pagadores").innerHTML = ids.length
    ? ids.map(id => {
        const p = personas.find(x => x.id === id);

        return `
          <div class="money-row">
            <span>${nombreCompleto(p)}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              class="monto-pagador"
              data-id="${id}"
              placeholder="0,00"
            >
          </div>
        `;
      }).join("")
    : `<p class="muted">Primero seleccioná participantes.</p>`;

  document.querySelectorAll(".monto-pagador").forEach(i => {
    i.addEventListener("input", () => {
      previewTotal();
      previewDistribuido();
    });
  });

  previewTotal();
}

function totalGastoCentavos() {
  return [...document.querySelectorAll(".monto-pagador")]
    .reduce((s,i) => s + aCentavos(i.value), 0);
}

function previewTotal() {
  $("previewTotal").textContent =
    moneda(aPesos(totalGastoCentavos()));
}

function renderMontosPersonalizados() {
  if (!$("divisionPersonalizada").checked) return;

  const ids = seleccionados();

  $("montosParticipantes").innerHTML = ids.length
    ? ids.map(id => {
        const p = personas.find(x => x.id === id);

        return `
          <div class="money-row">
            <span>${nombreCompleto(p)}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              class="monto-participante"
              data-id="${id}"
              placeholder="0,00"
            >
          </div>
        `;
      }).join("")
    : `<p class="muted">Primero seleccioná participantes.</p>`;

  document.querySelectorAll(".monto-participante").forEach(i => {
    i.addEventListener("input", previewDistribuido);
  });

  previewDistribuido();
}

function previewDistribuido() {
  const c = [...document.querySelectorAll(".monto-participante")]
    .reduce((s,i) => s + aCentavos(i.value), 0);

  $("previewDistribuido").textContent = moneda(aPesos(c));
}

$("divisionPersonalizada").addEventListener("change", e => {
  $("repartoPersonalizado").classList.toggle("oculto", !e.target.checked);

  if (e.target.checked)
    renderMontosPersonalizados();
});

$("formGasto").addEventListener("submit", async e => {
  e.preventDefault();

  const ids = seleccionados();

  if (!ids.length)
    return alert("Seleccione al menos un participante.");

  const pagos = [...document.querySelectorAll(".monto-pagador")]
    .filter(x => Number(x.value) > 0)
    .map(x => ({
      persona_id: Number(x.dataset.id),
      monto: Number(x.value)
    }));

  if (!pagos.length)
    return alert("Indique quién pagó el gasto.");

  const personalizada = $("divisionPersonalizada").checked;

  let participantes;

  if (personalizada) {
    participantes = [...document.querySelectorAll(".monto-participante")]
      .map(x => ({
        persona_id: Number(x.dataset.id),
        monto_asignado: Number(x.value || 0)
      }));

    const distribuido = participantes.reduce(
      (s,p) => s + aCentavos(p.monto_asignado),
      0
    );

    if (distribuido !== totalGastoCentavos()) {
      return alert(
        `La distribución debe sumar exactamente ${moneda(aPesos(totalGastoCentavos()))}.`
      );
    }
  } else {
    participantes = ids.map(id => ({ persona_id: id }));
  }

  try {
    await api("/api/eventos", {
      method: "POST",
      body: JSON.stringify({
        grupo_id: grupoId(),
        descripcion: $("descGasto").value,
        fecha: $("fechaGasto").value,
        participantes,
        pagos,
        repartoIgual: !personalizada
      })
    });

    $("formGasto").reset();
    $("fechaGasto").value = hoy();
    $("repartoPersonalizado").classList.add("oculto");
    $("montosParticipantes").innerHTML = "";
    renderPagadores();

    await actualizarTodo();
    toast("Gasto guardado");

  } catch (e) {
    alert(e.message);
  }
});

// ---------- RESUMEN ----------

async function cargarResumen() {
  if (!grupoId()) return;

  const [mensual, general] = await Promise.all([
    api(
      `/api/resumen?grupo_id=${grupoId()}` +
      `&desde=${inicioMesActual()}` +
      `&hasta=${finMesActual()}`
    ),
    api(
      `/api/resumen?grupo_id=${grupoId()}` +
      `&simplificar=true`
    )
  ]);

  resumen = general;

  $("gastoTotal").textContent =
    moneda(mensual.estadisticas.gasto_total);

  $("totalDeuda").textContent =
    moneda(general.totalDeuda);

  $("cantEventos").textContent =
    mensual.estadisticas.eventos;

  $("cantPersonas").textContent =
    general.estadisticas.personas;

  $("infoTransferencias").textContent =
    general.cantidadTransferencias === 0
      ? "Todo saldado"
      : `${general.cantidadTransferencias} ${
          general.cantidadTransferencias === 1
            ? "transferencia pendiente"
            : "transferencias pendientes"
        } para dejar el grupo en $0`;

  $("deudas").innerHTML = general.deudas.length
    ? general.deudas.map((d,i) => `
        <div class="debt">
          <div><b>${d.deudor}</b> le debe a <b>${d.acreedor}</b></div>
          <div class="amount">${moneda(d.monto)}</div>
          <button class="primary" onclick="saldarDeuda(${i})">
            Saldar deuda
          </button>
        </div>
      `).join("")
    : `
      <div class="all-settled">
        <div class="all-settled-title">Todo saldado</div>
        <div class="muted">
          No quedan transferencias pendientes en este grupo.
        </div>
      </div>
    `;

  $("balances").innerHTML = general.balances.map(b => {
    const clase =
      b.saldo > 0.01 ? "pending-positive" :
      b.saldo < -0.01 ? "pending-negative" : "";

    const texto =
      b.saldo > 0.01
        ? `Tiene que recibir ${moneda(b.saldo)}`
        : b.saldo < -0.01
          ? `Tiene que pagar ${moneda(-b.saldo)}`
          : "Está al día";

    return `
      <div class="balance ${clase}">
        <div class="balance-head">
          <div class="balance-name">${b.nombre}</div>
          <b>${texto}</b>
        </div>

        <div class="balance-equation">
          <div>
            Aportó <b>${moneda(b.puso)}</b>
            − consumió <b>${moneda(b.consumio)}</b>
            = saldo inicial <b>${moneda(b.saldoAntes)}</b>
          </div>

          <div>
            + transferencias enviadas <b>${moneda(b.transferido)}</b>
            − transferencias recibidas <b>${moneda(b.recibido)}</b>
            = saldo pendiente <b>${moneda(b.saldo)}</b>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function mostrarExplicacionCalculo() {
  if (!resumen) return;

  const filas = resumen.balances.map(b => {
    let estado = "Está al día";
    let clase = "calc-ok";

    if (b.saldo < -0.01) {
      estado = `Debe aportar ${moneda(-b.saldo)}`;
      clase = "calc-pay";
    }

    if (b.saldo > 0.01) {
      estado = `Debe recibir ${moneda(b.saldo)}`;
      clase = "calc-receive";
    }

    return `
      <div class="calc-person">
        <div class="calc-person-head">
          <b>${b.nombre}</b>
          <span class="${clase}">${estado}</span>
        </div>

        <div class="calc-formula">
          <span>Aportó ${moneda(b.puso)}</span>
          <span>−</span>
          <span>Consumió ${moneda(b.consumio)}</span>
          <span>+</span>
          <span>Envió ${moneda(b.transferido)}</span>
          <span>−</span>
          <span>Recibió ${moneda(b.recibido)}</span>
          <span>=</span>
          <b>${moneda(b.saldo)}</b>
        </div>
      </div>
    `;
  }).join("");

  const transferencias = resumen.deudas.length
    ? resumen.deudas.map((d, i) => `
        <div class="calc-transfer">
          <div class="calc-transfer-number">${i + 1}</div>
          <div>
            <b>${d.deudor}</b>
            <span> → </span>
            <b>${d.acreedor}</b>
          </div>
          <div class="calc-transfer-amount">
            ${moneda(d.monto)}
          </div>
        </div>
      `).join("")
    : `
      <div class="all-settled compact">
        Todos los saldos ya son $0. No hace falta ninguna transferencia.
      </div>
    `;

  $("modalContenido").innerHTML = `
    <h2>Cómo se calcularon las deudas</h2>

    <p class="muted">
      Primero se calcula el saldo real de cada persona.
      Después la app conecta a quienes deben pagar con quienes deben recibir,
      usando esos saldos netos. El objetivo es que, después de realizar
      las transferencias propuestas, todos queden exactamente en $0.
    </p>

    <div class="calc-section">
      <h3>1. Saldo de cada persona</h3>
      ${filas}
    </div>

    <div class="calc-section">
      <h3>2. Transferencias propuestas</h3>
      ${transferencias}
    </div>

    <div class="calc-note">
      La aplicación no intenta reconstruir cada deuda histórica por separado:
      compensa todo el grupo con los saldos actuales. Por eso puede reemplazar
      varias transferencias encadenadas por una sola.
    </div>
  `;

  $("modal").classList.remove("oculto");
}

$("btnExplicarCalculo")?.addEventListener(
  "click",
  mostrarExplicacionCalculo
);

function saldarDeuda(i) {
  const d = resumen.deudas[i];

  $("deudor").value = d.deudor_id;
  $("acreedor").value = d.acreedor_id;
  $("montoPago").value = Number(d.monto).toFixed(2);
  $("fechaPago").value = hoy();
  $("descPago").value = `Transferencia de ${d.deudor} a ${d.acreedor}`;

  abrirTab("pago");
  toast("Transferencia autocompletada");
}

// ---------- PAGOS ----------

$("formPago").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    await api("/api/pagos", {
      method: "POST",
      body: JSON.stringify({
        grupo_id: grupoId(),
        deudor_id: Number($("deudor").value),
        acreedor_id: Number($("acreedor").value),
        monto: Number($("montoPago").value),
        fecha: $("fechaPago").value,
        descripcion: $("descPago").value
      })
    });

    $("formPago").reset();
    $("fechaPago").value = hoy();

    await actualizarTodo();
    abrirTab("resumen");
    toast("Transferencia registrada");

  } catch (e) {
    alert(e.message);
  }
});

// ---------- MOVIMIENTOS ----------

async function cargarMovimientos(q="") {
  if (!grupoId()) return;

  const url =
    `/api/movimientos?grupo_id=${grupoId()}` +
    (q ? `&q=${encodeURIComponent(q)}` : "");

  const movimientos = await api(url);

  $("listaMovimientos").innerHTML = movimientos.length
    ? movimientos.map(m => {
        if (m.tipo === "Gasto") {
          return `
            <div class="movement clickable" onclick="verDetalleGasto(${m.id})">
              <div class="movement-title">${m.descripcion}</div>
              <div class="movement-category">${m.categoria || "Otros"}</div>
              <div>${moneda(m.monto)}</div>
              <div class="movement-meta">
                ${fechaAR(m.fecha)} · Ver detalle
              </div>
            </div>
          `;
        }

        return `
          <div class="movement">
            <div class="movement-title">${m.descripcion || "Transferencia"}</div>
            <div>${moneda(m.monto)}</div>
            <div class="movement-meta">
              ${fechaAR(m.fecha)} · ${m.deudor} → ${m.acreedor}
            </div>
          </div>
        `;
      }).join("")
    : `<p class="muted">No hay movimientos.</p>`;
}

let timerBusqueda;

$("buscarMovimiento").addEventListener("input", e => {
  clearTimeout(timerBusqueda);

  timerBusqueda = setTimeout(() => {
    if (esSupergrupo()) {
      cargarMovimientosSupergrupo(e.target.value);
    } else {
      cargarMovimientos(e.target.value);
    }
  }, 250);
});

async function verDetalleGasto(id) {
  const eventos = await api(`/api/eventos?grupo_id=${grupoId()}`);
  const e = eventos.find(x => x.id === id);

  if (!e) return;

  $("modalContenido").innerHTML = `
    <h2>${e.descripcion}</h2>
    <p class="muted">
      ${fechaAR(e.fecha)}
      ·
      <span class="category-pill">${e.categoria || "Otros"}</span>
    </p>

    <h3>Total: ${moneda(e.total)}</h3>

    <h3>Quién pagó</h3>
    ${e.pagadores.map(p =>
      `<div class="movement">${p.nombre}: <b>${moneda(p.monto)}</b></div>`
    ).join("")}

    <h3>Participantes</h3>
    ${e.participantes.map(p =>
      `<div class="movement">${p.nombre}: <b>${moneda(p.monto_asignado)}</b></div>`
    ).join("")}
  `;

  $("modal").classList.remove("oculto");
}

function cerrarModal() {
  $("modal").classList.add("oculto");
}

$("modal").addEventListener("click", e => {
  if (e.target.id === "modal") cerrarModal();
});

// ---------- INFORMES ----------

async function generarInforme() {
  if (!grupoId()) return;

  const desde = $("informeDesde").value;
  const hasta = $("informeHasta").value;
  const personaId = $("informePersona").value;
  const simplificar = true;

  const params = new URLSearchParams({
    grupo_id: grupoId(),
    simplificar: simplificar
  });

  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  if (personaId) params.set("persona_id", personaId);

  const paramsEventos = new URLSearchParams({
    grupo_id: grupoId()
  });

  if (desde) paramsEventos.set("desde", desde);
  if (hasta) paramsEventos.set("hasta", hasta);

  const [data, eventos] = await Promise.all([
    api(`/api/resumen?${params.toString()}`),
    api(`/api/eventos?${paramsEventos.toString()}`)
  ]);

  ultimoInforme = { data, eventos, desde, hasta, personaId };

  const persona =
    personaId
      ? personas.find(p => p.id === Number(personaId))
      : null;

  const titulo =
    persona
      ? `Informe de ${nombreCompleto(persona)}`
      : `Informe de gastos · ${grupoNombre()}`;

  const periodo =
    `${desde ? fechaAR(desde) : "Inicio"} — ${hasta ? fechaAR(hasta) : "Actualidad"}`;

  const filas = data.balances.map(b => {
    let estado = "Al día";
    let clase = "ok";

    if (b.saldo > 0.01) {
      estado = `Recibe ${moneda(b.saldo)}`;
      clase = "receive";
    } else if (b.saldo < -0.01) {
      estado = `Paga ${moneda(-b.saldo)}`;
      clase = "pay";
    }

    return `
      <tr>
        <td><b>${b.nombre}</b></td>
        <td>${moneda(b.puso)}</td>
        <td>${moneda(b.consumio)}</td>
        <td>${moneda(b.transferido)}</td>
        <td>${moneda(b.recibido)}</td>
        <td><span class="report-status ${clase}">${estado}</span></td>
      </tr>
    `;
  }).join("");

  const deudas = data.deudas.length
    ? `
      <div class="report-debt-list">
        ${data.deudas.map(d => `
          <div class="report-debt-row">
            <div>
              <b>${d.deudor}</b>
              <div class="muted">Debe transferir</div>
            </div>
            <div class="arrow">→</div>
            <div class="receiver">
              <b>${d.acreedor}</b>
              <div class="muted">Debe recibir</div>
              ${
                (() => {
                  const receptor =
                    todasPersonas.find(p => p.id === d.acreedor_id);

                  const datos = [
                    receptor?.alias_bancario
                      ? `Alias: ${receptor.alias_bancario}`
                      : null,
                    receptor?.telefono
                      ? `Tel: ${receptor.telefono}`
                      : null
                  ].filter(Boolean);

                  return datos.length
                    ? `<div class="transfer-contact">${datos.join(" · ")}</div>`
                    : "";
                })()
              }
            </div>
            <div class="debt-amount">${moneda(d.monto)}</div>
          </div>
        `).join("")}
      </div>
    `
    : `<p class="pending-positive">No hay deudas pendientes para este período.</p>`;

  $("contenidoInforme").innerHTML = `
    <div class="report-header">
      <div>
        <h3>${titulo}</h3>
        <div class="report-period">${periodo}</div>
      </div>

      <div class="report-total-box">
        <span>Gasto total del período</span>
        <b>${moneda(data.estadisticas.gasto_total)}</b>
      </div>
    </div>

    <div class="report-quick">
      <div class="report-quick-title">Situación del grupo</div>
      <div class="report-quick-grid">
        <div>
          <span>Gasto del período</span>
          <b>${moneda(data.estadisticas.gasto_total)}</b>
        </div>
        <div>
          <span>Pendiente de transferir</span>
          <b>${moneda(data.totalDeuda)}</b>
        </div>
        <div>
          <span>Transferencias necesarias</span>
          <b>${data.deudas.length}</b>
        </div>
      </div>
    </div>

    <div class="report-section report-settle-first">
      <h3 class="report-section-title">Qué tiene que hacer cada uno</h3>
      ${deudas}
    </div>

    <div class="report-section">
      <h3 class="report-section-title">Detalle de saldos</h3>
      <table>
        <thead>
          <tr>
            <th>Persona</th>
            <th>Aportó</th>
            <th>Consumió</th>
            <th>Transf. enviadas</th>
            <th>Transf. recibidas</th>
            <th>Estado actual</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>

    <div class="report-section">
      <p class="muted">
        Este informe contempla los gastos y las transferencias registradas
        dentro del período seleccionado. Los importes pendientes reflejan
        el saldo al momento de generar el informe.
      </p>
    </div>
  `;

  generarResumenCompartible();
}

function generarResumenCompartible() {
  if (!ultimoInforme) return;

  const {
    data,
    eventos,
    desde,
    hasta,
    personaId
  } = ultimoInforme;

  const persona =
    personaId
      ? personas.find(p => p.id === Number(personaId))
      : null;

  const separador = "────────────────────────";
  let texto = "";

  texto += `*RESUMEN DE GASTOS · ${grupoNombre().toUpperCase()}*
`;
  texto += `${desde ? fechaAR(desde) : "Inicio"} al ${hasta ? fechaAR(hasta) : "Actualidad"}
`;

  if (persona) {
    texto += `Persona: ${nombreCompleto(persona)}
`;
  }

  texto += `${separador}

`;

  if (!persona) {
    texto += `*GASTOS DEL PERÍODO*
`;

    if (!eventos.length) {
      texto += `No hay gastos registrados.
`;
    } else {
      eventos.forEach((e, index) => {
        texto += `
${index + 1}) *${e.descripcion}* · ${fechaAR(e.fecha)}
`;
        texto += `Total: ${moneda(e.total)}
`;

        texto += `Pagó:
`;
        e.pagadores.forEach(p => {
          texto += `• ${p.nombre}: ${moneda(p.monto)}
`;
        });

        texto += `Correspondió:
`;
        e.participantes.forEach(p => {
          texto += `• ${p.nombre}: ${moneda(p.monto_asignado)}
`;
        });
      });
    }

    texto += `
${separador}
`;
  }

  texto += `
*SALDOS ACTUALES*
`;

  data.balances.forEach(b => {
    if (b.saldo > 0.01) {
      texto += `• ${b.nombre}: debe recibir *${moneda(b.saldo)}*
`;
    } else if (b.saldo < -0.01) {
      texto += `• ${b.nombre}: debe pagar *${moneda(-b.saldo)}*
`;
    } else {
      texto += `• ${b.nombre}: al día
`;
    }
  });

  texto += `
${separador}
`;
  texto += `
*CÓMO SALDAR*
`;

  if (!data.deudas.length) {
    texto += `No hay transferencias pendientes.
`;
  } else {
    data.deudas.forEach((d, index) => {
      const personaAcreedora =
        todasPersonas.find(p => p.id === d.acreedor_id);

      texto += `${index + 1}. ${d.deudor} → ${d.acreedor}
`;
      texto += `   *${moneda(d.monto)}*`;

      if (personaAcreedora?.alias_bancario) {
        texto += ` · Alias: ${personaAcreedora.alias_bancario}`;
      }

      texto += `
`;
    });
  }

  texto += `
Total pendiente a transferir: *${moneda(data.totalDeuda)}*
`;
  texto += `
Generado con Entre Amigos.`;

  $("resumenCompartible").value = texto;
}

$("btnGenerarInforme").addEventListener("click", () => {
  if (esSupergrupo()) {
    generarInformeSupergrupo();
  } else {
    generarInforme();
  }
});

$("btnCopiarResumen").addEventListener("click", async () => {
  const texto = $("resumenCompartible").value;

  if (!texto) return;

  try {
    await navigator.clipboard.writeText(texto);
    toast("Resumen copiado");
  } catch {
    $("resumenCompartible").select();
    document.execCommand("copy");
    toast("Resumen copiado");
  }
});


const btnArchivados = document.createElement("button");
btnArchivados.id = "btnGruposArchivados";
btnArchivados.type = "button";
btnArchivados.textContent = "Archivados";
btnArchivados.className = "archived-groups-action";

$("btnArchivarGrupo")?.insertAdjacentElement(
  "afterend",
  btnArchivados
);

btnArchivados.addEventListener(
  "click",
  mostrarGruposArchivados
);


// ---------- INIT ----------

async function actualizarTodo() {
  await cargarPersonas();

  await Promise.all([
    cargarResumen(),
    cargarMovimientos()
  ]);

  await generarInforme();
  clearStatsLoading();
}

$("fechaGasto").value = hoy();
$("fechaPago").value = hoy();
$("informeDesde").value = inicioMesActual();
$("informeHasta").value = finMesActual();

(async function iniciar() {
  await limpiarCachesViejos();

  const sesion = await obtenerSesionActual();

  if (!sesion?.authenticated || !sesion.user) {
    mostrarLogin();

    const loader = $("appLoading");
    if (loader) loader.hidden = true;

    return;
  }

  mostrarSesion(sesion.user);

  setStatsLoading();
  setLoading(true);

  try {
    await cargarGrupos();

    if (esSupergrupo()) {
      await actualizarSupergrupo();
    } else if (grupoId()) {
      await actualizarTodo();
    } else {
      clearStatsLoading();
    }

    actualizarModoSupergrupo();

  } catch (e) {
    console.error(e);

    if (e.status !== 401) {
      alert(
        "No se pudieron cargar los datos. Revisá la conexión e intentá nuevamente."
      );
    }
  } finally {
    setLoading(false);

    const loader = $("appLoading");
    if (loader) loader.hidden = true;
  }
})();

// ---------- PWA / SERVICE WORKER ----------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration =
        await navigator.serviceWorker.register("/service-worker.js");

      await registration.update();

      console.log("Entre Amigos: Service Worker actualizado.");
    } catch (error) {
      console.error("No se pudo registrar el Service Worker:", error);
    }
  });
}

