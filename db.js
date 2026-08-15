const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.warn(
    "DATABASE_URL no está configurada. " +
    "En producción debe venir de Neon/Vercel."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : process.env.DATABASE_URL
        ? { rejectUnauthorized: false }
        : false
});

// Adaptador pequeño para mantener el patrón existente:
// const [rows] = await db.query(...)
function pgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function query(sql, params = []) {
  const result = await pool.query(pgSql(sql), params);
  return [result.rows, result];
}

async function getConnection() {
  const client = await pool.connect();

  return {
    async beginTransaction() {
      await client.query("BEGIN");
    },

    async commit() {
      await client.query("COMMIT");
    },

    async rollback() {
      await client.query("ROLLBACK");
    },

    async query(sql, params = []) {
      const result = await client.query(pgSql(sql), params);
      return [result.rows, result];
    },

    release() {
      client.release();
    }
  };
}

module.exports = {
  query,
  getConnection,
  pool
};