const express = require("express");
const { createGraveyardRepository } = require("../repositories/graveyard.repository");
const { TradingError, uuid } = require("../services/trading-rules.service");

function createGraveyardRoutes(db) {
  const router = express.Router();
  const repository = createGraveyardRepository(db);
  router.post("/rosters/:rosterId/graveyard/:entryId/restore", async (req, res, next) => {
    if (!uuid(req.params.entryId)) return res.status(400).json({ error: "Invalid Graveyard entry ID." });
    try { res.json(await repository.restore(req.params.rosterId, req.params.entryId)); }
    catch (error) {
      if (error instanceof TradingError) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  });
  return router;
}

module.exports = { createGraveyardRoutes };
