const express = require("express");
const path = require("path");
const db = require("./db");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const aCentavos = v => Math.round(Number(v || 0) * 100);
const aPesos = c => c / 100;
const nombreCompleto = p => [p.nombre, p.apellido].filter(Boolean).join(" ");

// ---------- GRUPOS ----------

app.get("/api/grupos", async (_, res) => {
  try {
    const [rows] = await db.query(`
      SELECT g.id, g.nombre, COUNT(gp.persona_id) AS integrantes
      FROM grupos g
      LEFT JOIN grupo_persona gp ON gp.grupo_id = g.id
      GROUP BY g.id, g.nombre
      ORDER BY g.nombre
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/grupos", async (req, res) => {
  const nombre = String(req.body.nombre || "").trim();
  if (!nombre) return res.status(400).json({ error: "Ingrese un nombre para el grupo." });

  try {
    const [r] = await db.query(
      "INSERT INTO grupos(nombre) VALUES (?) RETURNING id",
      [nombre]
    );
    res.status(201).json({ id: r[0].id, nombre });
  } catch (e) {
    if (e.code === "23505")
      return res.status(400).json({ error: "Ya existe un grupo con ese nombre." });

    res.status(500).json({ error: e.message });
  }
});

// ---------- PERSONAS ----------

app.get("/api/personas", async (req, res) => {
  const grupoId = Number(req.query.grupo_id || 0);

  try {
    if (grupoId) {
      const [rows] = await db.query(`
        SELECT p.*
        FROM personas p
        JOIN grupo_persona gp ON gp.persona_id = p.id
        WHERE gp.grupo_id = ?
          AND gp.activo = TRUE
        ORDER BY p.nombre, p.apellido
      `, [grupoId]);
      return res.json(rows);
    }

    const [rows] = await db.query(`
      SELECT *
      FROM personas
      ORDER BY nombre, apellido
    `);

    res.json(rows);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/personas", async (req, res) => {
  const {
    nombre,
    apellido,
    telefono,
    alias_bancario,
    grupo_id,
    forzar_nuevo
  } = req.body;

  const n = String(nombre || "").trim();
  const a = String(apellido || "").trim();
  const t = String(telefono || "").trim();
  const alias = String(alias_bancario || "").trim();

  if (!n)
    return res.status(400).json({ error: "Ingrese un nombre." });

  try {
    if (!forzar_nuevo) {
      const condiciones = [];
      const params = [];

      // Nombre + apellido exactos (normalizados)
      condiciones.push(`
        LOWER(TRIM(nombre)) = LOWER(TRIM(?))
        AND LOWER(TRIM(COALESCE(apellido,''))) = LOWER(TRIM(?))
      `);
      params.push(n, a);

      if (t) {
        condiciones.push("TRIM(COALESCE(telefono,'')) = TRIM(?)");
        params.push(t);
      }

      if (alias) {
        condiciones.push("LOWER(TRIM(COALESCE(alias_bancario,''))) = LOWER(TRIM(?))");
        params.push(alias);
      }

      const [coincidencias] = await db.query(`
        SELECT *
        FROM personas
        WHERE ${condiciones.map(c => `(${c})`).join(" OR ")}
        ORDER BY id
        LIMIT 1
      `, params);

      if (coincidencias.length) {
        return res.status(409).json({
          error: "Ya existe una persona que parece coincidir con estos datos.",
          existente: coincidencias[0]
        });
      }
    }

    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();

      const [r] = await conn.query(`
        INSERT INTO personas(nombre, apellido, telefono, alias_bancario)
        VALUES (?, ?, ?, ?)
        RETURNING id
      `, [
        n,
        a || null,
        t || null,
        alias || null
      ]);

      if (grupo_id) {
        await conn.query(`
          INSERT INTO grupo_persona(grupo_id, persona_id, activo)
          VALUES (?, ?, TRUE)
          ON CONFLICT (grupo_id, persona_id)
          DO UPDATE SET activo = TRUE
        `, [grupo_id, r[0].id]);
      }

      await conn.commit();
      res.status(201).json({ id: r[0].id });

    } catch (e) {
      await conn.rollback();
      res.status(500).json({ error: e.message });
    } finally {
      conn.release();
    }

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/personas/:id", async (req, res) => {
  const id = Number(req.params.id);

  const {
    nombre,
    apellido,
    telefono,
    alias_bancario
  } = req.body;

  const n = String(nombre || "").trim();

  if (!n)
    return res.status(400).json({ error: "Ingrese un nombre." });

  try {
    await db.query(`
      UPDATE personas
      SET nombre = ?,
          apellido = ?,
          telefono = ?,
          alias_bancario = ?
      WHERE id = ?
    `, [
      n,
      String(apellido || "").trim() || null,
      String(telefono || "").trim() || null,
      String(alias_bancario || "").trim() || null,
      id
    ]);

    res.json({ ok: true });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/grupos/:grupoId/personas/:personaId", async (req, res) => {
  try {
    await db.query(`
      INSERT INTO grupo_persona(grupo_id, persona_id, activo)
      VALUES (?, ?, TRUE)
      ON CONFLICT (grupo_id, persona_id)
      DO UPDATE SET activo = TRUE
    `, [req.params.grupoId, req.params.personaId]);

    res.json({ ok: true });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/grupos/:grupoId/personas/:personaId", async (req, res) => {
  try {
    const grupoId = Number(req.params.grupoId);
    const personaId = Number(req.params.personaId);

    const balances = await obtenerBalances({ grupoId });
    const persona = balances.find(p => p.id === personaId);

    if (persona && Math.abs(persona.saldoCentavos) > 0) {
      return res.status(400).json({
        error:
          `No se puede ocultar a ${persona.nombre} porque todavía tiene un saldo pendiente ` +
          `de ${Math.abs(persona.saldo).toFixed(2)}. Primero hay que saldarlo.`
      });
    }

    await db.query(`
      UPDATE grupo_persona
      SET activo = FALSE
      WHERE grupo_id = ?
        AND persona_id = ?
    `, [grupoId, personaId]);

    res.json({ ok: true });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.get("/api/directorio-personas", async (_, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        p.id,
        p.nombre,
        p.apellido,
        p.telefono,
        p.alias_bancario,
        STRING_AGG(
          DISTINCT CASE WHEN gp.activo = TRUE THEN g.nombre END,
          ', ' ORDER BY CASE WHEN gp.activo = TRUE THEN g.nombre END
        ) AS grupos_activos,
        STRING_AGG(
          DISTINCT CASE WHEN gp.activo = FALSE THEN g.nombre END,
          ', ' ORDER BY CASE WHEN gp.activo = FALSE THEN g.nombre END
        ) AS grupos_ocultos
      FROM personas p
      LEFT JOIN grupo_persona gp ON gp.persona_id = p.id
      LEFT JOIN grupos g ON g.id = gp.grupo_id
      GROUP BY
        p.id, p.nombre, p.apellido, p.telefono, p.alias_bancario
      ORDER BY p.nombre, p.apellido, p.id
    `);

    // Marca posibles duplicados por nombre+apellido, teléfono o alias.
    const keyCount = new Map();

    const normalizar = v =>
      String(v || "").trim().toLowerCase();

    for (const p of rows) {
      const keys = [
        `n:${normalizar(p.nombre)}|${normalizar(p.apellido)}`,
        p.telefono ? `t:${normalizar(p.telefono)}` : null,
        p.alias_bancario ? `a:${normalizar(p.alias_bancario)}` : null
      ].filter(Boolean);

      p._keys = keys;

      for (const k of keys) {
        keyCount.set(k, (keyCount.get(k) || 0) + 1);
      }
    }

    res.json(rows.map(p => ({
      id: p.id,
      nombre: p.nombre,
      apellido: p.apellido,
      telefono: p.telefono,
      alias_bancario: p.alias_bancario,
      grupos_activos: p.grupos_activos,
      grupos_ocultos: p.grupos_ocultos,
      posible_duplicado: p._keys.some(k => (keyCount.get(k) || 0) > 1)
    })));

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- EVENTOS / GASTOS ----------

app.post("/api/eventos", async (req, res) => {
  const {
    grupo_id,
    descripcion,
    fecha,
    categoria,
    participantes,
    pagos,
    repartoIgual
  } = req.body;

  if (!grupo_id)
    return res.status(400).json({ error: "Seleccione un grupo." });

  if (!descripcion || !fecha || !Array.isArray(participantes) || !participantes.length)
    return res.status(400).json({ error: "Complete descripción, fecha y participantes." });

  const ids = new Set(participantes.map(p => Number(p.persona_id)));

  const pagosValidos = (pagos || [])
    .map(p => ({
      persona_id: Number(p.persona_id),
      centavos: aCentavos(p.monto)
    }))
    .filter(p => p.persona_id && p.centavos > 0 && ids.has(p.persona_id));

  if (!pagosValidos.length)
    return res.status(400).json({ error: "Al menos un participante debe haber pagado." });

  const totalCentavos = pagosValidos.reduce((s, p) => s + p.centavos, 0);

  const categoriaFinal =
    String(categoria || "Otros").trim().slice(0, 80) || "Otros";

  let participantesFinales;

  if (repartoIgual) {
    const cantidad = participantes.length;
    const base = Math.floor(totalCentavos / cantidad);
    const resto = totalCentavos % cantidad;

    participantesFinales = participantes.map((p, i) => ({
      persona_id: Number(p.persona_id),
      centavos_asignados: base + (i < resto ? 1 : 0)
    }));
  } else {
    participantesFinales = participantes.map(p => ({
      persona_id: Number(p.persona_id),
      centavos_asignados: aCentavos(p.monto_asignado)
    }));

    const asignado = participantesFinales.reduce(
      (s, p) => s + p.centavos_asignados,
      0
    );

    if (asignado !== totalCentavos) {
      return res.status(400).json({
        error: `La distribución debe sumar exactamente ${aPesos(totalCentavos).toFixed(2)}.`
      });
    }
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [evento] = await conn.query(`
      INSERT INTO eventos(grupo_id, descripcion, fecha, categoria)
      VALUES (?, ?, ?, ?)
      RETURNING id
    `, [grupo_id, descripcion.trim(), fecha, categoriaFinal]);

    for (const p of participantesFinales) {
      await conn.query(`
        INSERT INTO participantes(evento_id, persona_id, monto_asignado)
        VALUES (?, ?, ?)
      `, [evento[0].id, p.persona_id, aPesos(p.centavos_asignados)]);
    }

    for (const p of pagosValidos) {
      await conn.query(`
        INSERT INTO pagos_evento(evento_id, persona_id, monto)
        VALUES (?, ?, ?)
      `, [evento[0].id, p.persona_id, aPesos(p.centavos)]);
    }

    await conn.commit();
    res.status(201).json({ ok: true });

  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

app.get("/api/eventos", async (req, res) => {
  const grupoId = Number(req.query.grupo_id || 0);
  const desde = req.query.desde || null;
  const hasta = req.query.hasta || null;

  if (!grupoId)
    return res.status(400).json({ error: "Seleccione un grupo." });

  try {
    const params = [grupoId];
    const filtros = ["e.grupo_id = ?"];

    if (desde) {
      filtros.push("e.fecha >= ?");
      params.push(desde);
    }

    if (hasta) {
      filtros.push("e.fecha <= ?");
      params.push(hasta);
    }

    const [eventos] = await db.query(`
      SELECT e.id, e.descripcion, e.fecha, e.categoria
      FROM eventos e
      WHERE ${filtros.join(" AND ")}
      ORDER BY e.fecha, e.id
    `, params);

    for (const e of eventos) {
      const [participantes] = await db.query(`
        SELECT
          p.id,
          p.nombre,
          p.apellido,
          pr.monto_asignado
        FROM participantes pr
        JOIN personas p ON p.id = pr.persona_id
        WHERE pr.evento_id = ?
        ORDER BY p.nombre, p.apellido
      `, [e.id]);

      const [pagadores] = await db.query(`
        SELECT
          p.id,
          p.nombre,
          p.apellido,
          pe.monto
        FROM pagos_evento pe
        JOIN personas p ON p.id = pe.persona_id
        WHERE pe.evento_id = ?
        ORDER BY p.nombre, p.apellido
      `, [e.id]);

      e.participantes = participantes.map(p => ({
        id: p.id,
        nombre: nombreCompleto(p),
        monto_asignado: Number(p.monto_asignado)
      }));

      e.pagadores = pagadores.map(p => ({
        id: p.id,
        nombre: nombreCompleto(p),
        monto: Number(p.monto)
      }));

      e.total = e.pagadores.reduce((s, p) => s + Number(p.monto), 0);
    }

    res.json(eventos);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- TRANSFERENCIAS ----------

app.post("/api/pagos", async (req, res) => {
  const {
    grupo_id,
    deudor_id,
    acreedor_id,
    monto,
    fecha,
    descripcion
  } = req.body;

  const centavos = aCentavos(monto);

  if (!grupo_id || !deudor_id || !acreedor_id || centavos <= 0 || !fecha)
    return res.status(400).json({ error: "Complete todos los datos del pago." });

  if (Number(deudor_id) === Number(acreedor_id))
    return res.status(400).json({ error: "Una persona no puede pagarse a sí misma." });

  try {
    await db.query(`
      INSERT INTO pagos_deuda
      (grupo_id, deudor_id, acreedor_id, monto, fecha, descripcion)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      grupo_id,
      deudor_id,
      acreedor_id,
      aPesos(centavos),
      fecha,
      descripcion || "Transferencia"
    ]);

    res.status(201).json({ ok: true });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- BALANCES ----------

async function obtenerBalances({ grupoId, desde = null, hasta = null }) {
  const paramsEventos = [grupoId];
  const filtrosEventos = ["e.grupo_id = ?"];

  if (desde) {
    filtrosEventos.push("e.fecha >= ?");
    paramsEventos.push(desde);
  }

  if (hasta) {
    filtrosEventos.push("e.fecha <= ?");
    paramsEventos.push(hasta);
  }

  const [personas] = await db.query(`
    SELECT p.id, p.nombre, p.apellido,
           COALESCE(SUM(x.monto),0) AS puso
    FROM personas p
    JOIN grupo_persona gp
      ON gp.persona_id = p.id
     AND gp.grupo_id = ?
     AND gp.activo = TRUE
    LEFT JOIN (
      SELECT pe.persona_id, pe.monto
      FROM pagos_evento pe
      JOIN eventos e ON e.id = pe.evento_id
      WHERE ${filtrosEventos.join(" AND ")}
    ) x ON x.persona_id = p.id
    GROUP BY p.id, p.nombre, p.apellido
    ORDER BY p.nombre, p.apellido
  `, [grupoId, ...paramsEventos]);

  const [consumos] = await db.query(`
    SELECT pr.persona_id,
           COALESCE(SUM(pr.monto_asignado),0) AS consumio
    FROM participantes pr
    JOIN eventos e ON e.id = pr.evento_id
    WHERE ${filtrosEventos.join(" AND ")}
    GROUP BY pr.persona_id
  `, paramsEventos);

  const paramsPagos = [grupoId];
  const filtrosPagos = ["pd.grupo_id = ?"];

  if (desde) {
    filtrosPagos.push("pd.fecha >= ?");
    paramsPagos.push(desde);
  }

  if (hasta) {
    filtrosPagos.push("pd.fecha <= ?");
    paramsPagos.push(hasta);
  }

  const [pagos] = await db.query(`
    SELECT deudor_id, acreedor_id, monto
    FROM pagos_deuda pd
    WHERE ${filtrosPagos.join(" AND ")}
  `, paramsPagos);

  const mapa = {};

  personas.forEach(p => {
    mapa[p.id] = {
      id: p.id,
      nombre: nombreCompleto(p),
      pusoCentavos: aCentavos(p.puso),
      consumioCentavos: 0,
      enviadoCentavos: 0,
      recibidoCentavos: 0
    };
  });

  consumos.forEach(c => {
    if (mapa[c.persona_id])
      mapa[c.persona_id].consumioCentavos = aCentavos(c.consumio);
  });

  pagos.forEach(p => {
    const c = aCentavos(p.monto);

    if (mapa[p.deudor_id])
      mapa[p.deudor_id].enviadoCentavos += c;

    if (mapa[p.acreedor_id])
      mapa[p.acreedor_id].recibidoCentavos += c;
  });

  return Object.values(mapa).map(p => {
    const saldoAntes =
      p.pusoCentavos - p.consumioCentavos;

    const saldoFinal =
      saldoAntes +
      p.enviadoCentavos -
      p.recibidoCentavos;

    return {
      id: p.id,
      nombre: p.nombre,
      puso: aPesos(p.pusoCentavos),
      consumio: aPesos(p.consumioCentavos),
      saldoAntes: aPesos(saldoAntes),
      transferido: aPesos(p.enviadoCentavos),
      recibido: aPesos(p.recibidoCentavos),
      saldo: aPesos(saldoFinal),
      saldoCentavos: saldoFinal
    };
  });
}

function calcularDeudas(balances) {
  const acreedores = balances
    .filter(p => p.saldoCentavos > 0)
    .map(p => ({ ...p, restante: p.saldoCentavos }));

  const deudores = balances
    .filter(p => p.saldoCentavos < 0)
    .map(p => ({ ...p, restante: -p.saldoCentavos }));

  const deudas = [];
  let i = 0;
  let j = 0;

  while (i < deudores.length && j < acreedores.length) {
    const centavos = Math.min(
      deudores[i].restante,
      acreedores[j].restante
    );

    deudas.push({
      deudor_id: deudores[i].id,
      deudor: deudores[i].nombre,
      acreedor_id: acreedores[j].id,
      acreedor: acreedores[j].nombre,
      monto: aPesos(centavos)
    });

    deudores[i].restante -= centavos;
    acreedores[j].restante -= centavos;

    if (deudores[i].restante === 0) i++;
    if (acreedores[j].restante === 0) j++;
  }

  return deudas;
}

async function obtenerDeudasDirectasBase({ grupoId, desde = null, hasta = null }) {
  const params = [grupoId];
  const filtros = ["e.grupo_id = ?"];

  if (desde) {
    filtros.push("e.fecha >= ?");
    params.push(desde);
  }

  if (hasta) {
    filtros.push("e.fecha <= ?");
    params.push(hasta);
  }

  const [eventos] = await db.query(`
    SELECT e.id
    FROM eventos e
    WHERE ${filtros.join(" AND ")}
    ORDER BY e.fecha, e.id
  `, params);

  const aristas = new Map();

  function sumar(deudorId, acreedorId, centavos) {
    if (!centavos || deudorId === acreedorId) return;

    const directa = `${deudorId}:${acreedorId}`;
    const inversa = `${acreedorId}:${deudorId}`;
    const inv = aristas.get(inversa) || 0;

    if (inv > 0) {
      const compensado = Math.min(centavos, inv);
      const resto = inv - compensado;

      if (resto) aristas.set(inversa, resto);
      else aristas.delete(inversa);

      centavos -= compensado;
    }

    if (centavos > 0) {
      aristas.set(directa, (aristas.get(directa) || 0) + centavos);
    }
  }

  const nombres = {};

  for (const e of eventos) {
    const [participantes] = await db.query(`
      SELECT p.id, p.nombre, p.apellido, pr.monto_asignado
      FROM participantes pr
      JOIN personas p ON p.id = pr.persona_id
      WHERE pr.evento_id = ?
    `, [e.id]);

    const [pagadores] = await db.query(`
      SELECT p.id, pe.monto
      FROM pagos_evento pe
      JOIN personas p ON p.id = pe.persona_id
      WHERE pe.evento_id = ?
    `, [e.id]);

    const bs = participantes.map(p => {
      nombres[p.id] = nombreCompleto(p);

      const puesto = pagadores
        .filter(pg => pg.id === p.id)
        .reduce((s, pg) => s + aCentavos(pg.monto), 0);

      const consumo = aCentavos(p.monto_asignado);

      return {
        id: p.id,
        nombre: nombreCompleto(p),
        saldoCentavos: puesto - consumo
      };
    });

    calcularDeudas(bs).forEach(d => {
      sumar(d.deudor_id, d.acreedor_id, aCentavos(d.monto));
    });
  }

  return [...aristas.entries()]
    .filter(([,c]) => c > 0)
    .map(([k,c]) => {
      const [d,a] = k.split(":").map(Number);

      return {
        deudor_id: d,
        deudor: nombres[d],
        acreedor_id: a,
        acreedor: nombres[a],
        monto: aPesos(c)
      };
    });
}

function reconciliarDeudasDirectasConSaldos(deudasBase, balances) {
  /*
    Mantiene relaciones directas cuando todavía son compatibles con los
    saldos actuales, pero TODOS los importes finales quedan limitados por
    lo que cada persona realmente debe pagar o recibir hoy.

    Esto hace que una transferencia proveniente del modo simplificado
    también reduzca correctamente el modo "sin simplificar".
  */
  const deudores = new Map();
  const acreedores = new Map();
  const nombres = new Map();

  for (const b of balances) {
    nombres.set(b.id, b.nombre);

    if (b.saldoCentavos < 0)
      deudores.set(b.id, -b.saldoCentavos);

    if (b.saldoCentavos > 0)
      acreedores.set(b.id, b.saldoCentavos);
  }

  const resultado = [];

  // Primero intentamos conservar las relaciones originales.
  for (const d of deudasBase) {
    const debe = deudores.get(d.deudor_id) || 0;
    const recibe = acreedores.get(d.acreedor_id) || 0;

    if (debe <= 0 || recibe <= 0)
      continue;

    const centavos = Math.min(
      aCentavos(d.monto),
      debe,
      recibe
    );

    if (centavos <= 0)
      continue;

    resultado.push({
      deudor_id: d.deudor_id,
      deudor: nombres.get(d.deudor_id) || d.deudor,
      acreedor_id: d.acreedor_id,
      acreedor: nombres.get(d.acreedor_id) || d.acreedor,
      monto: aPesos(centavos)
    });

    deudores.set(d.deudor_id, debe - centavos);
    acreedores.set(d.acreedor_id, recibe - centavos);
  }

  // Si una transferencia simplificada cambió el camino original,
  // completamos los saldos residuales con transferencias válidas.
  const dRestantes = [...deudores.entries()]
    .filter(([,c]) => c > 0)
    .map(([id,c]) => ({ id, restante: c }));

  const aRestantes = [...acreedores.entries()]
    .filter(([,c]) => c > 0)
    .map(([id,c]) => ({ id, restante: c }));

  let i = 0;
  let j = 0;

  while (i < dRestantes.length && j < aRestantes.length) {
    const centavos = Math.min(
      dRestantes[i].restante,
      aRestantes[j].restante
    );

    resultado.push({
      deudor_id: dRestantes[i].id,
      deudor: nombres.get(dRestantes[i].id),
      acreedor_id: aRestantes[j].id,
      acreedor: nombres.get(aRestantes[j].id),
      monto: aPesos(centavos)
    });

    dRestantes[i].restante -= centavos;
    aRestantes[j].restante -= centavos;

    if (dRestantes[i].restante === 0) i++;
    if (aRestantes[j].restante === 0) j++;
  }

  return resultado;
}

app.get("/api/resumen", async (req, res) => {
  const grupoId = Number(req.query.grupo_id || 0);

  if (!grupoId)
    return res.status(400).json({ error: "Seleccione un grupo." });

  try {
    const desde = req.query.desde || null;
    const hasta = req.query.hasta || null;
    const personaId = Number(req.query.persona_id || 0);
    const simplificar =
      String(req.query.simplificar ?? "true") !== "false";

    const todosBalances = await obtenerBalances({
      grupoId,
      desde,
      hasta
    });

    const balances = personaId
      ? todosBalances.filter(p => p.id === personaId)
      : todosBalances;

    let deudas;

    if (simplificar) {
      deudas = calcularDeudas(todosBalances);
    } else {
      const deudasBase =
        await obtenerDeudasDirectasBase({ grupoId, desde, hasta });

      deudas =
        reconciliarDeudasDirectasConSaldos(deudasBase, todosBalances);
    }

    const deudasFiltradas = personaId
      ? deudas.filter(d =>
          d.deudor_id === personaId ||
          d.acreedor_id === personaId
        )
      : deudas;

    const paramsEventos = [grupoId];
    const filtrosEventos = ["e.grupo_id = ?"];

    if (desde) {
      filtrosEventos.push("e.fecha >= ?");
      paramsEventos.push(desde);
    }

    if (hasta) {
      filtrosEventos.push("e.fecha <= ?");
      paramsEventos.push(hasta);
    }

    const [[stats]] = await db.query(`
      SELECT
        (
          SELECT COUNT(*)
          FROM grupo_persona
          WHERE grupo_id = ?
            AND activo = TRUE
        ) AS personas,

        (
          SELECT COUNT(*)
          FROM eventos e
          WHERE ${filtrosEventos.join(" AND ")}
        ) AS eventos,

        (
          SELECT COALESCE(SUM(pe.monto),0)
          FROM pagos_evento pe
          JOIN eventos e ON e.id = pe.evento_id
          WHERE ${filtrosEventos.join(" AND ")}
        ) AS gasto_total
    `, [grupoId, ...paramsEventos, ...paramsEventos]);

    res.json({
      balances,
      deudas: deudasFiltradas,
      totalDeuda: aPesos(
        deudas.reduce((s,d) => s + aCentavos(d.monto), 0)
      ),
      cantidadTransferencias: deudasFiltradas.length,
      simplificado: simplificar,
      estadisticas: stats
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- MOVIMIENTOS ----------

app.get("/api/movimientos", async (req, res) => {
  const grupoId = Number(req.query.grupo_id || 0);
  const q = String(req.query.q || "").trim();

  if (!grupoId)
    return res.status(400).json({ error: "Seleccione un grupo." });

  try {
    const like = `%${q}%`;

    const [eventos] = await db.query(`
      SELECT
        e.id,
        e.fecha,
        e.descripcion,
        e.categoria,
        COALESCE(SUM(pe.monto),0) AS monto,
        'Gasto' AS tipo
      FROM eventos e
      LEFT JOIN pagos_evento pe ON pe.evento_id = e.id
      WHERE e.grupo_id = ?
        ${q ? "AND (e.descripcion ILIKE ? OR e.categoria ILIKE ?)" : ""}
      GROUP BY e.id, e.fecha, e.descripcion, e.categoria
    `, q ? [grupoId, like, like] : [grupoId]);

    const [pagos] = await db.query(`
      SELECT
        pd.id,
        pd.fecha,
        pd.descripcion,
        pd.monto,
        'Pago' AS tipo,
        CONCAT_WS(' ', d.nombre, NULLIF(d.apellido,'')) AS deudor,
        CONCAT_WS(' ', a.nombre, NULLIF(a.apellido,'')) AS acreedor
      FROM pagos_deuda pd
      JOIN personas d ON d.id = pd.deudor_id
      JOIN personas a ON a.id = pd.acreedor_id
      WHERE pd.grupo_id = ?
        ${q ? `AND (
          pd.descripcion ILIKE ?
          OR d.nombre ILIKE ?
          OR d.apellido ILIKE ?
          OR a.nombre ILIKE ?
          OR a.apellido ILIKE ?
        )` : ""}
    `, q
      ? [grupoId, like, like, like, like, like]
      : [grupoId]
    );

    res.json([...eventos, ...pagos].sort(
      (a,b) =>
        String(b.fecha).localeCompare(String(a.fecha)) ||
        Number(b.id)-Number(a.id)
    ));

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Entre Amigos: http://localhost:${PORT}`);
  });
}

module.exports = app;