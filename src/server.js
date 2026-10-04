const knex = require("knex");
const knexConfig = require("../knexfile");
const { createApp } = require("./app");

const environment = process.env.NODE_ENV || "development";
const db = knex(knexConfig[environment] || knexConfig.development);
const app = createApp(db);
const port = Number(process.env.PORT || 4000);

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Mordheim API listening on port ${port}`);
});

async function shutdown() {
  server.close(async () => {
    await db.destroy();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);