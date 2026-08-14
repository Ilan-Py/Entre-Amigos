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
    const [r] = await db.query("INSERT INTO grupos(nombre) VALUES (?)", [nombre]);
    res.status(201).json({ id: r.insertId, nombre });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
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
    grupo_id
  } = req.body;

  const n = String(nombre || "").trim();

  if (!n)
    return res.status(400).json({ error: "Ingrese un nombre." });

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [r] = await conn.query(`
      INSERT INTO personas(nombre, apellido, telefono, alias_bancario)
      VALUES (?, ?, ?, ?)
    `, [
      n,
      String(apellido || "").trim() || null,
      String(telefono || "").trim() || null,
      String(alias_bancario || "").trim() || null
    ]);

    if (grupo_id) {
      await conn.query(`
        INSERT INTO grupo_persona(grupo_id, persona_id)
        VALUES (?, ?)
      `, [grupo_id, r.insertId]);
    }

    await conn.commit();
    res.status(201).json({ id: r.insertId });

  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
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
      INSERT IGNORE INTO grupo_persona(grupo_id, persona_id)
      VALUES (?, ?)
    `, [req.params.grupoId, req.params.personaId]);

    res.json({ ok: true });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/grupos/:grupoId/personas/:personaId", async (req, res) => {
  try {
    const [[uso]] = await db.query(`
      SELECT COUNT(*) AS c
      FROM participantes pr
      JOIN eventos e ON e.id = pr.evento_id
      WHERE e.grupo_id = ?
        AND pr.persona_id = ?
    `, [req.params.grupoId, req.params.personaId]);

    if (uso.c > 0) {
      return res.status(400).json({
        error: "La persona ya tiene movimientos en este grupo y no puede quitarse."
      });
    }

    await db.query(`
      DELETE FROM grupo_persona
      WHERE grupo_id = ?
        AND persona_id = ?
    `, [req.params.grupoId, req.params.personaId]);

    res.json({ ok: true });

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
      INSERT INTO eventos(grupo_id, descripcion, fecha)
      VALUES (?, ?, ?)
    `, [grupo_id, descripcion.trim(), fecha]);

    for (const p of participantesFinales) {
      await conn.query(`
        INSERT INTO participantes(evento_id, persona_id, monto_asignado)
        VALUES (?, ?, ?)
      `, [evento.insertId, p.persona_id, aPesos(p.centavos_asignados)]);
    }

    for (const p of pagosValidos) {
      await conn.query(`
        INSERT INTO pagos_evento(evento_id, persona_id, monto)
        VALUES (?, ?, ?)
      `, [evento.insertId, p.persona_id, aPesos(p.centavos)]);
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
      SELECT e.id, e.descripcion, e.fecha
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

async function obtenerDeudasDirectas({ grupoId, desde = null, hasta = null }) {
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

  pagos.forEach(p => {
    const key = `${p.deudor_id}:${p.acreedor_id}`;
    const actual = aristas.get(key) || 0;
    const pagado = aCentavos(p.monto);

    if (pagado <= actual) {
      const resto = actual - pagado;
      if (resto) aristas.set(key, resto);
      else aristas.delete(key);
    } else {
      aristas.delete(key);
      sumar(p.acreedor_id, p.deudor_id, pagado - actual);
    }
  });

  const ids = new Set();

  [...aristas.keys()].forEach(k => {
    const [a,b] = k.split(":").map(Number);
    ids.add(a);
    ids.add(b);
  });

  const nombres = {};

  if (ids.size) {
    const marks = [...ids].map(() => "?").join(",");
    const [rows] = await db.query(`
      SELECT id, nombre, apellido
      FROM personas
      WHERE id IN (${marks})
    `, [...ids]);

    rows.forEach(p => nombres[p.id] = nombreCompleto(p));
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

    const deudas = simplificar
      ? calcularDeudas(todosBalances)
      : await obtenerDeudasDirectas({ grupoId, desde, hasta });

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
        COALESCE(SUM(pe.monto),0) AS monto,
        'Gasto' AS tipo
      FROM eventos e
      LEFT JOIN pagos_evento pe ON pe.evento_id = e.id
      WHERE e.grupo_id = ?
        ${q ? "AND e.descripcion LIKE ?" : ""}
      GROUP BY e.id, e.fecha, e.descripcion
    `, q ? [grupoId, like] : [grupoId]);

    const [pagos] = await db.query(`
      SELECT
        pd.id,
        pd.fecha,
        pd.descripcion,
        pd.monto,
        'Pago' AS tipo,
        CONCAT(d.nombre, IF(d.apellido IS NULL OR d.apellido='', '', CONCAT(' ',d.apellido))) AS deudor,
        CONCAT(a.nombre, IF(a.apellido IS NULL OR a.apellido='', '', CONCAT(' ',a.apellido))) AS acreedor
      FROM pagos_deuda pd
      JOIN personas d ON d.id = pd.deudor_id
      JOIN personas a ON a.id = pd.acreedor_id
      WHERE pd.grupo_id = ?
        ${q ? `AND (
          pd.descripcion LIKE ?
          OR d.nombre LIKE ?
          OR d.apellido LIKE ?
          OR a.nombre LIKE ?
          OR a.apellido LIKE ?
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

app.listen(3000, () => {
  console.log("Entre Amigos v6: http://localhost:3000");
});