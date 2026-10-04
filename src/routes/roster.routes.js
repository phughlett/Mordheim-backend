const express = require("express");
const { createRosterController } = require("../controllers/roster.controller");
const { createRosterRepository } = require("../repositories/roster.repository");
const { createCampaignGuard } = require("../middleware/campaign-guard");
const { createRosterService } = require("../services/roster.service");

function createRosterRoutes(db) {
  const router = express.Router();
  const repository = createRosterRepository(db);
  const service = createRosterService(repository);
  const controller = createRosterController(repository, service);
  const { guard, fromRoster, check: campaignCheck } = createCampaignGuard(repository);

  router.get("/rosters", controller.list);
  router.post("/rosters", controller.create);
  router.get("/rosters/:rosterId", controller.get);
  router.put("/rosters/:rosterId/member-order", controller.reorderMembers);
  router.patch("/rosters/:rosterId", async (request, response, next) => {
    try {
      const roster = await repository.findRoster(request.params.rosterId);
      const body = request.body || {};
      const changes = [];
      if (roster && body.treasury !== undefined && Number(body.treasury) !== Number(roster.treasury)) changes.push("treasury");
      if (roster && (body.warbandId !== undefined || body.warband_id !== undefined) && (body.warbandId ?? body.warband_id ?? null) !== (roster.warband_id ?? null)) changes.push("warband");
      for (const action of changes) {
        const blocked = await campaignCheck(roster.id, action);
        if (blocked) return response.status(409).json(blocked);
      }
      next();
    } catch (error) {
      next(error);
    }
  }, controller.update);
  router.put("/rosters/:rosterId/capacity-modifiers", controller.setCapacityModifiers);
  router.delete("/rosters/:rosterId", controller.delete);
  router.post("/rosters/:rosterId/members", guard("hire", fromRoster), controller.addMember);
  router.post("/rosters/:rosterId/campaign/advance", controller.advanceCampaign);
  router.post("/rosters/:rosterId/campaign/reopen", controller.reopenCampaign);

  return router;
}

module.exports = { createRosterRoutes };
