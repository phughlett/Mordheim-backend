const express = require("express");
const { createMemberController } = require("../controllers/member.controller");
const { createRosterRepository } = require("../repositories/roster.repository");
const { createCampaignGuard } = require("../middleware/campaign-guard");
const { createRosterService } = require("../services/roster.service");

function createMemberRoutes(db) {
  const router = express.Router();
  const repository = createRosterRepository(db);
  const service = createRosterService(repository);
  const controller = createMemberController(repository, service);
  const { guard, fromMember, check } = createCampaignGuard(repository);
  const guardUpdate = async (request, response, next) => {
    try {
      const warrior = await repository.findWarrior(request.params.memberId);
      if (!warrior) return next();
      const body = request.body || {};
      const actions = [];
      if (body.experience !== undefined && Number(body.experience) !== Number(warrior.experience)) actions.push("experience");
      if (body.groupSize !== undefined) {
        const next_ = Number(body.groupSize);
        const current = warrior.group_size || 1;
        if (next_ > current) actions.push("hire");
        else if (next_ < current) actions.push("remove");
      }
      for (const action of actions) {
        const blocked = await check(warrior.roster_id, action);
        if (blocked) return response.status(409).json(blocked);
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  router.get("/members/:memberId/equipment", controller.listEquipment);
  router.put("/members/:memberId/mutations", controller.setMutations);
  router.get("/members/:memberId/advances", controller.getAdvancements);
  router.post("/members/:memberId/advances", guard("advance", fromMember), controller.recordAdvance);
  router.post("/members/:memberId/advance-purchases", controller.purchaseAdvance);
  router.delete("/members/:memberId/advances/:advanceId", async (request, response, next) => {
    try {
      const advance = await db("warrior_advances").where({ id: request.params.advanceId, warrior_id: request.params.memberId }).first("purchase_cost");
      if (!advance || advance.purchase_cost != null) return next();
      return guard("advance", fromMember)(request, response, next);
    } catch (error) {
      next(error);
    }
  }, controller.removeAdvance);
  router.post("/members/:memberId/equipment", guard("buy", fromMember), controller.purchaseEquipment);
  router.delete("/members/:memberId/equipment", guard("sell", fromMember), controller.sellEquipmentItems);
  router.delete("/members/:memberId/equipment/:inventoryItemId", guard("sell", fromMember), controller.sellEquipment);
  router.get("/members/:memberId/skills", controller.listSkills);
  router.post("/members/:memberId/skills", controller.learnSkill);
  router.delete("/members/:memberId/skills/:warriorSkillId", controller.forgetSkill);
  router.get("/members/:memberId/spells", controller.listSpells);
  router.post("/members/:memberId/spells", controller.learnSpell);
  router.post("/members/:memberId/spells/roll", controller.rollSpells);
  router.put("/members/:memberId/spells/discipline", controller.setSpellDiscipline);
  router.post("/members/:memberId/spells/tomes", controller.addMagicTome);
  router.post("/members/:memberId/spells/learn-lesser-magic", controller.consumeMagicTome);
  router.post("/members/:memberId/spells/:warriorSpellId/reduce-difficulty", controller.reduceSpellDifficulty);
  router.delete("/members/:memberId/spells/:warriorSpellId", controller.forgetSpell);
  router.get("/members/:memberId/lads-got-talent-options", controller.getLadsGotTalentOptions);
  router.put("/members/:memberId/skill-category-overrides", controller.setLadsGotTalentChoices);
  router.post("/members/:memberId/promote", guard("advance", fromMember), controller.promote);
  router.patch("/members/:memberId", guardUpdate, controller.update);
  router.delete("/members/:memberId", guard("remove", fromMember), controller.delete);

  return router;
}

module.exports = { createMemberRoutes };
