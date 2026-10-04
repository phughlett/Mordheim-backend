const path = require("node:path");

const connection = process.env.DATABASE_URL || {
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "mordheim",
  password: process.env.PGPASSWORD || "mordheim",
  database: process.env.PGDATABASE || "mordheim",
};

const sharedConfig = {
  client: "pg",
  connection,
  pool: { min: 0, max: 10 },
  migrations: { directory: path.join(__dirname, "migrations") },
};

module.exports = {
  development: sharedConfig,
  test: sharedConfig,
  production: sharedConfig,
};