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
const { createTradingRoutes } = require("./routes/trading.routes");
const { createInjuryRoutes } = require("./routes/injury.routes");
const { createRequestLogger, logRequestError } = require("./middleware/request-logging");

function createApp(db, options = {}) {
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173").split(",");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);

  app.use("/api", createRequestLogger(options.log));
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
  app.use("/api", require("./routes/league.routes").createLeagueRoutes(db));
  app.use("/api", createBattleRoutes(db));
  app.use("/api", createRosterRoutes(db));
  app.use("/api", createMemberRoutes(db));
  app.use("/api", createInjuryRoutes(db));
  app.use("/api", require("./routes/graveyard.routes").createGraveyardRoutes(db));
  app.use("/api", createTradingRoutes(db));
  app.use((error, _request, response, _next) => {
    logRequestError(error, response);
    response.status(500).json({ error: "Internal server error." });
  });

  return app;
}

module.exports = { createApp };
