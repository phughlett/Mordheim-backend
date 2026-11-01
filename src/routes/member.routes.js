const express = require("express");
const { createMemberController } = require("../controllers/member.controller");
const { createRosterRepository } = require("../repositories/roster.repository");
const { createCampaignGuard } = require("../middleware/campaign-guard");
const { createRosterService } = require("../services/roster.service");
const { cancelTomeUse } = require("../services/tome-cancellation.service");
const { TradingError, uuid } = require("../services/trading-rules.service");

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
      if (actions.includes("remove")) {
        const roster = await repository.findRoster(warrior.roster_id);
        if (roster?.campaign_id && roster.campaign_phase === "post_battle" && roster.campaign_step === 1) {
          return response.status(409).json({ error: "Record a model's death with the casualty action during injuries; deaths do not refund hire fees or carried equipment." });
        }
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
  router.post("/members/:memberId/advances", async (req, res, next) => {
    try {
      const data = await repository.getWarriorAdvancements(req.params.memberId);
      if (data?.canRevise) return next();
      return guard("advance", fromMember)(req, res, next);
    } catch (error) { next(error); }
  }, controller.recordAdvance);
  router.post("/members/:memberId/advance-purchases", controller.purchaseAdvance);
  router.delete("/members/:memberId/advances/:advanceId", controller.removeAdvance);
  router.delete("/members/:memberId/advances/:advanceId/choice", async (req, res, next) => {
    if (!uuid(req.params.advanceId)) return res.status(400).json({ error: "Invalid advance ID." });
    try {
      await db.transaction(async (trx) => {
        const warrior = await trx("warriors").where({ id: req.params.memberId }).first("roster_id");
        if (!warrior) throw new TradingError("Warrior not found.", 404);
        const roster = await trx("rosters").where({ id: warrior.roster_id }).forUpdate().first("battles_fought");
        const advance = await trx("warrior_advances").where({ id: req.params.advanceId, warrior_id: req.params.memberId }).forUpdate().first();
        if (!advance?.reduced_spell_id || advance.resolution_battles_fought !== Number(roster.battles_fought)) {
          throw new TradingError("This spell difficulty choice is fixed or has already been removed.");
        }
        await trx("warrior_spells").where({ id: advance.reduced_spell_id }).increment("casting_difficulty_modifier", 1);
        await trx("warrior_advances").where({ id: advance.id }).update({ reduced_spell_id: null, resolution_battles_fought: null });
      });
      res.json(await repository.getWarriorAdvancements(req.params.memberId));
    } catch (error) {
      if (error instanceof TradingError) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  });
  router.post("/members/:memberId/equipment", guard("buy", fromMember), controller.purchaseEquipment);
  router.delete("/members/:memberId/equipment", controller.sellEquipmentItems);
  router.delete("/members/:memberId/equipment/:inventoryItemId", controller.sellEquipment);
  router.get("/members/:memberId/skills", controller.listSkills);
  router.post("/members/:memberId/skills", controller.learnSkill);
  router.delete("/members/:memberId/skills/:warriorSkillId", controller.forgetSkill);
  router.get("/members/:memberId/spells", controller.listSpells);
  router.post("/members/:memberId/spells", controller.learnSpell);
  router.post("/members/:memberId/spells/roll", controller.rollSpells);
  router.put("/members/:memberId/spells/discipline", controller.setSpellDiscipline);
  router.post("/members/:memberId/spells/tomes", controller.addMagicTome);
  router.post("/members/:memberId/spells/learn-lesser-magic", controller.consumeMagicTome);
  router.delete("/members/:memberId/spells/tomes/:useId", async (req, res, next) => {
    if (!uuid(req.params.useId)) return res.status(400).json({ error: "Invalid consumed Tome ID." });
    try {
      await cancelTomeUse(db, req.params.memberId, req.params.useId);
      res.json(await repository.getWarriorSpells(req.params.memberId));
    } catch (error) {
      if (error instanceof TradingError) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  });
  router.post("/members/:memberId/spells/:warriorSpellId/reduce-difficulty", controller.reduceSpellDifficulty);
  router.delete("/members/:memberId/spells/:warriorSpellId", controller.forgetSpell);
  router.get("/members/:memberId/lads-got-talent-options", controller.getLadsGotTalentOptions);
  router.put("/members/:memberId/skill-category-overrides", controller.setLadsGotTalentChoices);
  router.post("/members/:memberId/promote", guard("advance", fromMember), controller.promote);
  router.patch("/members/:memberId", guardUpdate, controller.update);
  router.delete("/members/:memberId", guard("remove", fromMember), async (request, response, next) => {
    const warrior = await repository.findWarrior(request.params.memberId, ["roster_id"]);
    const roster = warrior ? await repository.findRoster(warrior.roster_id) : null;
    if (roster?.campaign_id && roster.campaign_phase === "post_battle" && roster.campaign_step === 1) {
      return response.status(409).json({ error: "Use the casualty action during injuries. Dead warriors lose their equipment without a refund." });
    }
    return controller.delete(request, response, next);
  });

  return router;
}

module.exports = { createMemberRoutes };
