let grupos = [];
let personas = [];
let todasPersonas = [];
let resumen = null;
let ultimoInforme = null;

const $ = id => document.getElementById(id);

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

function grupoId() {
  return Number($("grupoActual").value || 0);
}

function grupoNombre() {
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

async function api(url, options={}) {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const data = await r.json();

  if (!r.ok)
    throw new Error(data.error || "Error");

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
  btn.addEventListener("click", () => abrirTab(btn.dataset.tab));
});

// ---------- GRUPOS ----------

async function cargarGrupos() {
  grupos = await api("/api/grupos");

  $("grupoActual").innerHTML = grupos.map(g =>
    `<option value="${g.id}">${g.nombre}</option>`
  ).join("");

  if (!grupos.length) return;

  const guardado = Number(localStorage.getItem("grupo_actual"));

  if (grupos.some(g => g.id === guardado))
    $("grupoActual").value = guardado;
}

$("grupoActual").addEventListener("change", async () => {
  localStorage.setItem("grupo_actual", grupoId());
  await actualizarTodo();
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

    await actualizarTodo();
    toast("Grupo creado");

  } catch (e) {
    alert(e.message);
  }
});

// ---------- PERSONAS ----------

async function cargarPersonas() {
  if (!grupoId()) return;

  [personas, todasPersonas] = await Promise.all([
    api(`/api/personas?grupo_id=${grupoId()}`),
    api("/api/personas")
  ]);

  renderListaPersonas();
  renderSelectsPersonas();
  renderParticipantes();
  renderPersonaExistente();
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
              <button onclick="quitarDelGrupo(${p.id})">Quitar</button>
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
  if (!confirm("¿Quitar esta persona del grupo actual?")) return;

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

$("formPersona").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    await api("/api/personas", {
      method: "POST",
      body: JSON.stringify({
        nombre: $("nombrePersona").value,
        apellido: $("apellidoPersona").value,
        telefono: $("telefonoPersona").value,
        alias_bancario: $("aliasPersona").value,
        grupo_id: grupoId()
      })
    });

    $("formPersona").reset();
    await actualizarTodo();
    toast("Persona agregada");

  } catch (e) {
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

  const simplificar = $("simplificarDeudas").checked;

  const [mensual, general, sinSimplificar] = await Promise.all([
    api(
      `/api/resumen?grupo_id=${grupoId()}` +
      `&desde=${inicioMesActual()}` +
      `&hasta=${finMesActual()}`
    ),
    api(
      `/api/resumen?grupo_id=${grupoId()}` +
      `&simplificar=${simplificar}`
    ),
    api(
      `/api/resumen?grupo_id=${grupoId()}` +
      `&simplificar=false`
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

  const ahorro =
    sinSimplificar.cantidadTransferencias -
    general.cantidadTransferencias;

  $("infoTransferencias").textContent = simplificar
    ? ahorro > 0
      ? `${general.cantidadTransferencias} transferencias · ${ahorro} menos con simplificación`
      : `${general.cantidadTransferencias} transferencias · ya está optimizado`
    : `${general.cantidadTransferencias} transferencias sin simplificar`;

  $("deudas").innerHTML = general.deudas.length
    ? general.deudas.map((d,i) => `
        <div class="debt">
          <div><b>${d.deudor}</b> le debe a <b>${d.acreedor}</b></div>
          <div class="amount">${moneda(d.monto)}</div>
          <button class="primary" onclick="saldarDeuda(${i})">Saldar deuda</button>
        </div>
      `).join("")
    : `<p class="pending-positive">No hay deudas pendientes.</p>`;

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

    const signoFinal = b.saldo >= 0 ? "+" : "−";

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

$("simplificarDeudas").addEventListener("change", async () => {
  await cargarResumen();
  await generarInforme();
});

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
    cargarMovimientos(e.target.value);
  }, 250);
});

async function verDetalleGasto(id) {
  const eventos = await api(`/api/eventos?grupo_id=${grupoId()}`);
  const e = eventos.find(x => x.id === id);

  if (!e) return;

  $("modalContenido").innerHTML = `
    <h2>${e.descripcion}</h2>
    <p class="muted">${fechaAR(e.fecha)}</p>

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
  const simplificar = $("simplificarDeudas").checked;

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

  $("contenidoInforme").innerHTML = `
    <div class="report-summary">
      <h3>
        ${persona ? `Informe de ${nombreCompleto(persona)}` : `Informe del grupo ${grupoNombre()}`}
      </h3>

      <p class="muted">
        Período: ${desde ? fechaAR(desde) : "inicio"} a ${hasta ? fechaAR(hasta) : "actualidad"}
      </p>

      <p>
        Gasto total del período:
        <b>${moneda(data.estadisticas.gasto_total)}</b>
      </p>
    </div>

    <h3>Saldos</h3>

    <table>
      <thead>
        <tr>
          <th>Persona</th>
          <th>Aportó</th>
          <th>Consumió</th>
          <th>Transf. enviadas</th>
          <th>Transf. recibidas</th>
          <th>Saldo pendiente</th>
        </tr>
      </thead>

      <tbody>
        ${data.balances.map(b => `
          <tr>
            <td>${b.nombre}</td>
            <td>${moneda(b.puso)}</td>
            <td>${moneda(b.consumio)}</td>
            <td>${moneda(b.transferido)}</td>
            <td>${moneda(b.recibido)}</td>
            <td>${moneda(b.saldo)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    <h3>Cómo saldar</h3>

    ${
      data.deudas.length
        ? `<ul>${data.deudas.map(d =>
            `<li>${d.deudor} debe transferir <b>${moneda(d.monto)}</b> a ${d.acreedor}</li>`
          ).join("")}</ul>`
        : `<p>No hay deudas pendientes en este período.</p>`
    }
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

  let texto = "";

  texto += `RESUMEN DE GASTOS - ${grupoNombre()}\n`;
  texto += `Período: ${desde ? fechaAR(desde) : "inicio"} al ${hasta ? fechaAR(hasta) : "actualidad"}\n`;

  if (persona) {
    texto += `Persona: ${nombreCompleto(persona)}\n`;
  }

  texto += `\n`;

  if (!persona) {
    texto += `GASTOS\n`;

    if (!eventos.length) {
      texto += `No hay gastos registrados en el período.\n`;
    } else {
      eventos.forEach((e, index) => {
        texto += `\n${index + 1}. ${e.descripcion} - ${fechaAR(e.fecha)}\n`;
        texto += `Total: ${moneda(e.total)}\n`;

        texto += `Pagó:\n`;
        e.pagadores.forEach(p => {
          texto += `- ${p.nombre}: ${moneda(p.monto)}\n`;
        });

        texto += `Participantes:\n`;
        e.participantes.forEach(p => {
          texto += `- ${p.nombre}: ${moneda(p.monto_asignado)}\n`;
        });
      });
    }
  }

  texto += `\nSALDOS\n`;

  data.balances.forEach(b => {
    if (b.saldo > 0.01) {
      texto += `- ${b.nombre}: debe recibir ${moneda(b.saldo)}\n`;
    } else if (b.saldo < -0.01) {
      texto += `- ${b.nombre}: debe pagar ${moneda(-b.saldo)}\n`;
    } else {
      texto += `- ${b.nombre}: está al día\n`;
    }
  });

  texto += `\nCÓMO SALDAR\n`;

  if (!data.deudas.length) {
    texto += `No hay transferencias pendientes.\n`;
  } else {
    data.deudas.forEach((d, index) => {
      const personaAcreedora = todasPersonas.find(p => p.id === d.acreedor_id);

      texto += `${index + 1}. ${d.deudor} → ${d.acreedor}: ${moneda(d.monto)}`;

      if (personaAcreedora?.alias_bancario) {
        texto += ` | Alias: ${personaAcreedora.alias_bancario}`;
      }

      texto += `\n`;
    });
  }

  texto += `\nTotal pendiente a transferir: ${moneda(data.totalDeuda)}\n`;
  texto += `\nEste resumen contempla las transferencias ya registradas y los saldos pendientes al cierre del período.`;

  $("resumenCompartible").value = texto;
}

$("btnGenerarInforme").addEventListener("click", generarInforme);

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

// ---------- INIT ----------

async function actualizarTodo() {
  await cargarPersonas();

  await Promise.all([
    cargarResumen(),
    cargarMovimientos()
  ]);

  await generarInforme();
}

$("fechaGasto").value = hoy();
$("fechaPago").value = hoy();
$("informeDesde").value = inicioMesActual();
$("informeHasta").value = finMesActual();

(async function iniciar() {
  await cargarGrupos();

  if (grupoId())
    await actualizarTodo();
})();