const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "entre_amigos",
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true
});

module.exports = pool;