const express = require("express");
const { catalog } = require("../services/trading-catalog.service");
const { TradingError, integer, uuid } = require("../services/trading-rules.service");
const { createTradingRepository } = require("../repositories/trading.repository");

function createTradingRoutes(db) {
  const router = express.Router();
  const repository = createTradingRepository(db);
  router.get("/shop", (_request, response) => response.json({ items: catalog }));
  const handle = (action) => async (request, response, next) => {
    try {
      if (!uuid(request.params.rosterId)) return response.status(400).json({ error: "Invalid warband ID." });
      await action(request, response);
    } catch (error) {
      if (error instanceof TradingError) return response.status(error.status).json({ error: error.message });
      next(error);
    }
  };
  const invalid = (response, message) => response.status(400).json({ error: message });
  router.get("/rosters/:rosterId/trading", handle(async (request, response) => {
    response.json(await repository.getTrading(request.params.rosterId));
  }));
  router.post("/rosters/:rosterId/trading/search", handle(async (request, response) => {
    if (!uuid(request.body?.heroId) || typeof request.body?.itemId !== "string") return invalid(response, "Hero and shop item are required.");
    await repository.search(request.params.rosterId, request.body);
    response.status(201).json(await repository.getTrading(request.params.rosterId));
  }));
  router.post("/rosters/:rosterId/trading/quote", handle(async (request, response) => {
    if (typeof request.body?.itemId !== "string") return invalid(response, "Shop item is required.");
    response.status(201).json(await repository.quote(request.params.rosterId, request.body));
  }));
  router.post("/rosters/:rosterId/trading/purchase", handle(async (request, response) => {
    const { quoteId, quantity = 1, searchId } = request.body ?? {};
    if (!uuid(quoteId) || !integer(quantity, 1, 1000) || (searchId !== undefined && !uuid(searchId))) return invalid(response, "Valid quote, quantity (1-1000), and optional search ID required.");
    await repository.purchase(request.params.rosterId, { quoteId, quantity, searchId });
    response.status(201).json(await repository.getTrading(request.params.rosterId));
  }));
  router.post("/rosters/:rosterId/trading/transfer", handle(async (request, response) => {
    const { direction, inventoryId, memberId, quantity = 1, modelIndex = -1 } = request.body ?? {};
    if (!["to_member", "to_stash"].includes(direction) || !uuid(inventoryId) || !uuid(memberId)
      || !integer(quantity, 1, 1000) || !integer(modelIndex, -1, 4)) return invalid(response, "Supply transfer direction, inventory/member IDs, quantity and model index.");
    await repository.transfer(request.params.rosterId, { direction, inventoryId, memberId, quantity, modelIndex });
    response.json(await repository.getTrading(request.params.rosterId));
  }));
  router.post("/rosters/:rosterId/trading/hero-status", handle(async (request, response) => {
    if (!uuid(request.body?.heroId) || typeof request.body?.outOfAction !== "boolean") return invalid(response, "Supply a Hero ID and outOfAction boolean.");
    await repository.heroStatus(request.params.rosterId, request.body);
    response.json(await repository.getTrading(request.params.rosterId));
  }));
  router.post("/rosters/:rosterId/casualties", handle(async (request, response) => {
    const { memberId, modelIndex = 0 } = request.body ?? {};
    if (!uuid(memberId) || !integer(modelIndex, 0, 4)) return invalid(response, "Supply a member ID and model index (0-4).");
    await repository.casualty(request.params.rosterId, { memberId, modelIndex });
    response.json(await repository.getTrading(request.params.rosterId));
  }));
  return router;
}
module.exports = { createTradingRoutes };
