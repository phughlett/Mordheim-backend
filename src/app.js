const cors = require("cors");
const express = require("express");
const { createAuth } = require("./middleware/auth");
const { createAuthRoutes } = require("./routes/auth.routes");
const { createBattleRoutes } = require("./routes/battle.routes");
const { createCampaignRoutes } = require("./routes/campaign.routes");
const { createCatalogRoutes } = require("./routes/catalog.routes");
const { createCorrectionRoutes } = require("./routes/corrections.routes");
const { createMemberRoutes } = require("./routes/member.routes");
const { createRosterRoutes } = require("./routes/roster.routes");

function logApiRequest(request, response, next) {
  const startedAt = process.hrtime.bigint();
  response.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      method: request.method,
      path: request.originalUrl.split("?")[0],
      status: response.statusCode,
      durationMs: Number(durationMs.toFixed(1)),
    }));
  });
  next();
}

function createApp(db, options = {}) {
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173").split(",");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);

  app.use("/api", logApiRequest);
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.includes(origin));
    },
  }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", createAuthRoutes(db));
  app.use("/api", createCatalogRoutes(db));
  app.use("/api", createCorrectionRoutes(db, options.corrections));
  const { requireAuth, authorizeRoster, authorizeMember } = createAuth(db);
  app.use("/api", requireAuth);
  app.use("/api/rosters/:rosterId", authorizeRoster);
  app.use("/api/members/:memberId", authorizeMember);
  app.use("/api", createCampaignRoutes(db));
  app.use("/api", createBattleRoutes(db));
  app.use("/api", createRosterRoutes(db));
  app.use("/api", createMemberRoutes(db));
  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: "Internal server error." });
  });

  return app;
}

module.exports = { createApp };
