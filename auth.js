import { ExpressAuth, getSession } from "@auth/express";
import Google from "@auth/express/providers/google";
import db from "./db.js";

export const authConfig = {
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET
    })
  ],
  callbacks: {
    async session({ session, token }) {
      if (session?.user && token?.sub) {
        session.user.authId = token.sub;
      }
      return session;
    }
  }
};

export const authHandler = ExpressAuth(authConfig);

export async function getAuthSession(req) {
  return getSession(req, authConfig);
}

async function ensureAppUser(sessionUser) {
  const email = String(sessionUser?.email || "").trim().toLowerCase();

  if (!email) {
    throw new Error("La cuenta de Google no devolvió un email válido.");
  }

  const nombre = String(sessionUser?.name || "").trim() || null;
  const avatar = String(sessionUser?.image || "").trim() || null;

  const [rows] = await db.query(`
    INSERT INTO usuarios(email, nombre, avatar, last_login_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (email)
    DO UPDATE SET
      nombre = EXCLUDED.nombre,
      avatar = EXCLUDED.avatar,
      last_login_at = CURRENT_TIMESTAMP
    RETURNING id, email, nombre, avatar
  `, [email, nombre, avatar]);

  const usuario = rows[0];

  // Bootstrap seguro para esta migración:
  // solo el PRIMER usuario creado puede reclamar datos legacy sin propietario.
  const [[conteo]] = await db.query(`
    SELECT COUNT(*)::int AS total
    FROM usuarios
  `);

  if (Number(conteo.total) === 1) {
    await db.query(`
      UPDATE grupos
      SET usuario_id = ?
      WHERE usuario_id IS NULL
    `, [usuario.id]);

    await db.query(`
      UPDATE personas
      SET usuario_id = ?
      WHERE usuario_id IS NULL
    `, [usuario.id]);
  }

  return usuario;
}

export async function requireAppUser(req, res, next) {
  try {
    const session = await getAuthSession(req);

    if (!session?.user?.email) {
      return res.status(401).json({
        error: "AUTH_REQUIRED"
      });
    }

    req.session = session;
    req.appUser = await ensureAppUser(session.user);
    next();

  } catch (e) {
    console.error("Auth middleware:", e);

    res.status(500).json({
      error: "No se pudo validar la sesión."
    });
  }
}

export async function authMe(req, res) {
  try {
    const session = await getAuthSession(req);

    if (!session?.user?.email) {
      return res.status(401).json({
        authenticated: false
      });
    }

    const usuario = await ensureAppUser(session.user);

    res.json({
      authenticated: true,
      user: {
        id: usuario.id,
        email: usuario.email,
        name: usuario.nombre,
        image: usuario.avatar
      }
    });

  } catch (e) {
    console.error("auth/me:", e);

    res.status(500).json({
      error: "No se pudo leer la sesión."
    });
  }
}

export async function requireOwnedGroupParam(paramName = "id") {
  return async function ownedGroupMiddleware(req, res, next) {
    try {
      const grupoId = Number(req.params[paramName]);

      const [rows] = await db.query(`
        SELECT id
        FROM grupos
        WHERE id = ?
          AND usuario_id = ?
      `, [grupoId, req.appUser.id]);

      if (!rows.length) {
        return res.status(404).json({
          error: "Grupo no encontrado."
        });
      }

      next();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  };
}

export function requireOwnedGroupFromRequest(source = "query", field = "grupo_id") {
  return async function ownedGroupRequestMiddleware(req, res, next) {
    try {
      const raw =
        source === "body"
          ? req.body?.[field]
          : req.query?.[field];

      const grupoId = Number(raw || 0);

      if (!grupoId) {
        return res.status(400).json({
          error: "Grupo inválido."
        });
      }

      const [rows] = await db.query(`
        SELECT id
        FROM grupos
        WHERE id = ?
          AND usuario_id = ?
      `, [grupoId, req.appUser.id]);

      if (!rows.length) {
        return res.status(404).json({
          error: "Grupo no encontrado."
        });
      }

      next();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  };
}

export async function requireOwnedPerson(req, res, next) {
  try {
    const personaId = Number(
      req.params.personaId ||
      req.params.id ||
      req.body?.persona_id ||
      0
    );

    const [rows] = await db.query(`
      SELECT id
      FROM personas
      WHERE id = ?
        AND usuario_id = ?
    `, [personaId, req.appUser.id]);

    if (!rows.length) {
      return res.status(404).json({
        error: "Persona no encontrada."
      });
    }

    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}