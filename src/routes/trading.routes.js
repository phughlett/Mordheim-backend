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
    if (request.body.quoteId !== undefined && !uuid(request.body.quoteId)) return invalid(response, "Supply a valid ritual quote ID.");
    const attempt = await repository.search(request.params.rosterId, request.body);
    response.status(201).json({ ...await repository.getTrading(request.params.rosterId), attempt: {
      heroName: attempt.hero_name, success: attempt.success, dice: typeof attempt.dice === "string" ? JSON.parse(attempt.dice) : attempt.dice,
      total: attempt.total, modifier: attempt.modifier,
    } });
  }));
  router.post("/rosters/:rosterId/trading/quote", handle(async (request, response) => {
    if (typeof request.body?.itemId !== "string") return invalid(response, "Shop item is required.");
    if (request.body.buyerId !== undefined && !uuid(request.body.buyerId)) return invalid(response, "Supply a valid buyer ID.");
    response.status(201).json(await repository.quote(request.params.rosterId, request.body));
  }));
  router.post("/rosters/:rosterId/trading/purchase", handle(async (request, response) => {
    const { quoteId, quantity = 1, searchId, mapSelection } = request.body ?? {};
    if (!uuid(quoteId) || !integer(quantity, 1, 1000) || (searchId !== undefined && !uuid(searchId))) return invalid(response, "Valid quote, quantity (1-1000), and optional search ID required.");
    await repository.purchase(request.params.rosterId, { quoteId, quantity, searchId, mapSelection });
    response.status(201).json(await repository.getTrading(request.params.rosterId));
  }));
  router.post("/rosters/:rosterId/trading/spoils", handle(async (request, response) => {
    const { itemId, quantity = 1, mapSelection } = request.body ?? {};
    if (typeof itemId !== "string" || !itemId.trim() || !integer(quantity, 1, 1000)) return invalid(response, "Supply a shop item and quantity (1-1000).");
    await repository.addSpoils(request.params.rosterId, { itemId, quantity, mapSelection });
    response.status(201).json(await repository.getTrading(request.params.rosterId));
  }));
  router.post("/rosters/:rosterId/trading/map", handle(async (request, response) => {
    const { source, inventoryId, mapSelection } = request.body ?? {};
    if (!["stash", "member"].includes(source) || !uuid(inventoryId)) return invalid(response, "Select a stash or carried map.");
    await repository.resolveMap(request.params.rosterId, { source, inventoryId, mapSelection });
    response.json(await repository.getTrading(request.params.rosterId));
  }));
  router.post("/rosters/:rosterId/trading/transfer", handle(async (request, response) => {
    const { direction, inventoryId, memberId, quantity = 1, modelIndex = -1 } = request.body ?? {};
    if (!["to_member", "to_stash"].includes(direction) || !uuid(inventoryId) || !uuid(memberId)
      || !integer(quantity, 1, 1000) || !integer(modelIndex, -1, 4)) return invalid(response, "Supply transfer direction, inventory/member IDs, quantity and model index.");
    await repository.transfer(request.params.rosterId, { direction, inventoryId, memberId, quantity, modelIndex });
    response.json(await repository.getTrading(request.params.rosterId));
  }));
  router.post("/rosters/:rosterId/trading/sell", handle(async (request, response) => {
    const { source, inventoryIds, quantity } = request.body ?? {};
    if (!["stash", "member"].includes(source) || !Array.isArray(inventoryIds) || !inventoryIds.length
      || inventoryIds.length > 1000 || inventoryIds.some((id) => !uuid(id)) || new Set(inventoryIds).size !== inventoryIds.length
      || (source === "stash" && (inventoryIds.length !== 1 || !integer(quantity, 1, 1000)))
      || (source === "member" && quantity !== undefined)) {
      return invalid(response, "Supply a stash stack and quantity (1-1000), or unique carried inventory IDs.");
    }
    const sale = await repository.sell(request.params.rosterId, { source, inventoryIds, quantity });
    response.json({ ...await repository.getTrading(request.params.rosterId), saleAmount: sale.refundAmount });
  }));
  router.post("/rosters/:rosterId/trading/upgrade", handle(async (request, response) => {
    const { itemId, inventoryId, quoteId } = request.body ?? {};
    if (typeof itemId !== "string" || !uuid(inventoryId) || !uuid(quoteId)) return invalid(response, "Select an upgrade, carried weapon and price quote.");
    await repository.upgrade(request.params.rosterId, { itemId, inventoryId, quoteId });
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
