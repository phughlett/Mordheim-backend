const express = require("express");
const { TradingError, uuid } = require("../services/trading-rules.service");
const { createInjuryRepository } = require("../repositories/injury.repository");

function createInjuryRoutes(db) {
  const router = express.Router();
  const repository = createInjuryRepository(db);
  const handle = (action) => async (request, response, next) => {
    try { await action(request, response); }
    catch (error) {
      if (error instanceof TradingError) return response.status(error.status).json({ error: error.message });
      next(error);
    }
  };
  router.get("/members/:memberId/injuries", handle(async (req, res) => res.json(await repository.get(req.params.memberId))));
  router.post("/members/:memberId/injuries/preview", handle(async (req, res) => {
    if (req.body?.resolvesId !== undefined && !uuid(req.body.resolvesId)) return res.status(400).json({ error: "Invalid pending injury ID." });
    res.status(201).json(await repository.preview(req.params.memberId, req.body ?? {}));
  }));
  router.post("/members/:memberId/injuries/old-wound", handle(async (req, res) => res.json(await repository.checkOldWound(req.params.memberId, req.body ?? {}))));
  router.post("/members/:memberId/injuries/:previewId/apply", handle(async (req, res) => {
    if (!uuid(req.params.previewId)) return res.status(400).json({ error: "Invalid preview ID." });
    res.json(await repository.apply(req.params.memberId, req.params.previewId, req.body ?? {}));
  }));
  router.delete("/members/:memberId/injuries/:previewId", handle(async (req, res) => {
    if (!uuid(req.params.previewId)) return res.status(400).json({ error: "Invalid preview ID." });
    await repository.cancel(req.params.memberId, req.params.previewId);
    res.status(204).end();
  }));
  return router;
}
module.exports = { createInjuryRoutes };
