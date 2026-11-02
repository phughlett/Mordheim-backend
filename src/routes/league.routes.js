const express = require("express");
const { createLeagueService, suggestTables, calendar, examples } = require("../services/league.service");
const { TradingError, uuid, fail } = require("../services/trading-rules.service");
const { optionalRuleCatalog, league2026Preset } = require("../services/house-rules.service");

function createLeagueRoutes(db) {
  const router = express.Router();
  const service = createLeagueService(db);
  const handle = (action) => async (req, res, next) => {
    try { await action(req, res); }
    catch (error) {
      if (error instanceof TradingError) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  };
  router.get("/scenarios", handle(async (req, res) => res.json(await service.scenarios(req.user.id))));
  router.get("/league/templates/2026", handle(async (_req, res) => res.json({ ...examples, preset: league2026Preset })));
  router.get("/league/rule-options", handle(async (_req, res) => res.json({ optionalRules: optionalRuleCatalog })));
  router.post("/scenarios", handle(async (req, res) => res.status(201).json(await service.saveScenario(req.user.id, req.body))));
  router.post("/scenarios/import", handle(async (req, res) => res.status(201).json(await service.importScenario(req.user.id, req.body?.code))));
  router.get("/campaigns/:campaignId/league", handle(async (req, res) => res.json(await service.get(req.params.campaignId, req.user.id))));
  router.post("/campaigns/:campaignId/rounds", handle(async (req, res) => res.status(201).json(await service.schedule(req.params.campaignId, req.user.id, req.body ?? {}))));
  router.patch("/campaigns/:campaignId/rounds/:roundId", handle(async (req, res) => res.json(await service.schedule(req.params.campaignId, req.user.id, req.body ?? {}, req.params.roundId))));
  for (const action of ["start", "complete"]) router.post(`/campaigns/:campaignId/rounds/:roundId/${action}`, handle(async (req, res) =>
    res.json(await service[action](req.params.campaignId, req.params.roundId, req.user.id))));
  for (const action of ["teams", "start", "results"]) router.post(`/campaigns/:campaignId/tables/:gameId/${action}`, handle(async (req, res) =>
    res.json(await service.gameAction(req.params.campaignId, req.params.gameId, req.user.id, action, req.body ?? {}))));
  router.post("/campaigns/:campaignId/warbands/:rosterId/retire", handle(async (req, res) =>
    res.json(await service.retire(req.params.campaignId, req.params.rosterId, req.user.id))));
  router.post("/campaigns/:campaignId/rounds/:roundId/absence-notes", handle(async (req, res) =>
    res.json(await service.absenceNote(req.params.campaignId, req.params.roundId, req.user.id, req.body ?? {}))));
  router.post("/campaigns/:campaignId/rounds/:roundId/attendance", handle(async (req, res) =>
    res.json(await service.attendance(req.params.campaignId, req.params.roundId, req.user.id, req.body ?? {}))));
  router.post("/campaigns/:campaignId/rounds/:roundId/catch-up", handle(async (req, res) =>
    res.json(await service.catchUp(req.params.campaignId, req.params.roundId, req.user.id, req.body ?? {}))));
  router.delete("/campaigns/:campaignId/rounds/:roundId", handle(async (req, res) => {
    await db.transaction(async (trx) => {
      await service.campaign(trx, req.params.campaignId, req.user.id, true);
      if (!uuid(req.params.roundId)) fail("Invalid round ID.", 400);
      const last = await trx("campaign_rounds").where({ campaign_id: req.params.campaignId }).orderBy("number", "desc").first();
      if (!last || last.id !== req.params.roundId || last.status !== "scheduled") fail("Only the last scheduled scenario can be removed.");
      await trx("campaign_rounds").where({ id: last.id }).delete();
    });
    res.status(204).end();
  }));
  router.post("/campaigns/:campaignId/pairings/suggest", handle(async (req, res) => {
    if (!Number.isInteger(req.body?.tableSize) || req.body.tableSize < 2 || req.body.tableSize > 8
      || !Number.isInteger(req.body?.minPlayers) || req.body.minPlayers < 2 || req.body.minPlayers > req.body.tableSize
      || !["rotation", "rating"].includes(req.body?.strategy)) fail("Choose a valid minimum, 2–8 players per table and rotation or rating pairing strategy.", 400);
    const data = await service.get(req.params.campaignId, req.user.id);
    if (!data.isCommissioner) fail("Only the commissioner can assign pairings.", 403);
    const active = data.rosters.filter((r) => !r.league_retired);
    if (new Set(active.map((r) => r.user_id)).size !== active.length) fail("Retire extra warbands so each player has one active warband.");
    res.json(suggestTables(active.map((r) => ({ id: r.user_id, rating: r.rating })), data.rounds.flatMap((r) => r.tables), req.body.tableSize, req.body.strategy, req.body.minPlayers));
  }));
  router.post("/campaigns/:campaignId/warbands/:rosterId/post-battle/advance", handle(async (req, res) =>
    res.json(await service.postBattle(req.params.campaignId, req.params.rosterId, req.user.id))));
  router.delete("/campaigns/:campaignId/players/:userId", handle(async (req, res) => {
    await db.transaction(async (trx) => {
      const current = await service.campaign(trx, req.params.campaignId, req.user.id, true);
      if (!uuid(req.params.userId)) fail("Invalid player ID.", 400);
      if (req.params.userId === current.owner_id) fail("The commissioner cannot be removed.");
      if (await trx("rosters").where({ campaign_id: current.id, user_id: req.params.userId }).first()) fail("A player with campaign warbands cannot be removed. Preserve their battle history.");
      const removed = await trx("campaign_members").where({ campaign_id: current.id, user_id: req.params.userId }).delete();
      if (!removed) fail("Player not found.", 404);
    });
    res.status(204).end();
  }));
  router.get("/campaigns/:campaignId/calendar.ics", handle(async (req, res) => {
    await service.get(req.params.campaignId, req.user.id);
    const current = await db("campaigns").where({ id: req.params.campaignId }).first();
    const rounds = await db("campaign_rounds").where({ campaign_id: current.id }).orderBy("number");
    res.set("Cache-Control", "no-store");
    res.type("text/calendar").attachment("mordheim-campaign.ics").send(calendar(current, rounds));
  }));
  return router;
}

module.exports = { createLeagueRoutes };
