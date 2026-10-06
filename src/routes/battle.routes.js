const express = require("express");
const { PRE_BATTLE_STEPS, advanceCampaign, toCampaign } = require("../services/campaign.service");
const { warbandTitle } = require("../services/warband-identity.service");

const FORMATS = { "1v1": 1, "2v2": 2 };
const TEAMS = ["A", "B"];

function createBattleRoutes(db) {
  const router = express.Router();

  async function present(battle) {
    const participants = await db("battle_rosters")
      .join("rosters", "rosters.id", "battle_rosters.roster_id")
      .where({ battle_id: battle.id })
      .orderBy("battle_rosters.team")
      .orderBy("rosters.created_at")
      .leftJoin("users", "users.id", "rosters.user_id")
      .select("rosters.*", "battle_rosters.team", "users.username as player");
    const lead = participants[0];
    const stage = lead && battle.status === "active" ? toCampaign(lead) : null;
    return {
      id: battle.id,
      campaignId: battle.campaign_id,
      format: battle.format,
      status: battle.status,
      teamSize: FORMATS[battle.format],
      participants: participants.map((row) => ({
        rosterId: row.id,
        name: row.name,
        warband: warbandTitle(row.warband),
        team: row.team,
        player: row.player ?? null,
        ownerId: row.user_id,
        phase: row.campaign_phase,
        step: row.campaign_step,
        ready: row.campaign_phase === "pre_battle" && row.campaign_step === PRE_BATTLE_STEPS.length,
      })),
      round: stage?.battleTurn ?? null,
      firstTeam: battle.first_team,
      activeTeam: stage ? battle.active_team : null,
      phase: stage?.step ?? null,
      phaseLabel: stage?.stepLabel ?? null,
      nextLabel: stage
        ? stage.step < 4 ? "Next phase" : battle.active_team === battle.first_team ? `Team ${battle.active_team === "A" ? "B" : "A"}'s turn` : "Next round"
        : null,
    };
  }

  async function find(id) {
    return db("battles").where({ id }).first();
  }

  async function busyRosterIds(excludeBattleId) {
    const rows = await db("battle_rosters")
      .join("battles", "battles.id", "battle_rosters.battle_id")
      .whereNot("battles.status", "finished")
      .modify((query) => { if (excludeBattleId) query.whereNot("battles.id", excludeBattleId); })
      .select("battle_rosters.roster_id");
    return new Set(rows.map((row) => row.roster_id));
  }

  async function membership(request, response, campaignId) {
    const campaign = await db("campaigns").where({ id: campaignId }).first();
    if (!campaign) {
      response.status(404).json({ error: "Campaign not found." });
      return null;
    }
    if (!(await db("campaign_members").where({ campaign_id: campaignId, user_id: request.user.id }).first())) {
      response.status(403).json({ error: "You have not joined this campaign." });
      return null;
    }
    return campaign;
  }

  async function loadBattle(request, response) {
    const battle = await find(request.params.battleId);
    if (!battle) {
      response.status(404).json({ error: "Battle not found." });
      return null;
    }
    return (await membership(request, response, battle.campaign_id)) ? battle : null;
  }

  // Players run their own warbands; the campaign owner may manage any.
  async function mayManage(request, campaignId, rosterIds) {
    const campaign = await db("campaigns").where({ id: campaignId }).first();
    if (campaign.owner_id === request.user.id) return true;
    const rows = await db("rosters").whereIn("id", rosterIds).select("user_id");
    return rows.length > 0 && rows.every((row) => row.user_id === request.user.id);
  }

  async function mayRun(request, battle) {
    const campaign = await db("campaigns").where({ id: battle.campaign_id }).first();
    if (campaign.owner_id === request.user.id) return true;
    const rows = await db("battle_rosters").join("rosters", "rosters.id", "battle_rosters.roster_id").where({ battle_id: battle.id }).select("rosters.user_id");
    return rows.some((row) => row.user_id === request.user.id);
  }

  router.get("/campaigns/:campaignId/battles", async (request, response) => {
    if (!(await membership(request, response, request.params.campaignId))) return;
    const battles = await db("battles").where({ campaign_id: request.params.campaignId }).whereNot({ status: "finished" }).orderBy("created_at");
    response.json(await Promise.all(battles.map(present)));
  });

  router.post("/campaigns/:campaignId/battles", async (request, response) => {
    const format = request.body?.format;
    if (!FORMATS[format]) return response.status(400).json({ error: "Battle format must be 1v1 or 2v2." });
    const campaign = await membership(request, response, request.params.campaignId);
    if (!campaign) return;
    const [battle] = await db("battles").insert({ campaign_id: campaign.id, format }).returning("*");
    response.status(201).json(await present(battle));
  });

  router.put("/battles/:battleId/participants", async (request, response) => {
    const battle = await loadBattle(request, response);
    if (!battle) return;
    if (battle.status !== "forming") return response.status(409).json({ error: "Teams can only change before the battle starts." });
    const { rosterId, team } = request.body ?? {};
    if (!TEAMS.includes(team)) return response.status(400).json({ error: "Team must be A or B." });
    const roster = await db("rosters").where({ id: rosterId, campaign_id: battle.campaign_id }).first();
    if (!roster) return response.status(404).json({ error: "That warband is not part of this campaign." });
    if (!(await mayManage(request, battle.campaign_id, [roster.id]))) return response.status(403).json({ error: "You can only assign your own warbands." });
    if ((await busyRosterIds(battle.id)).has(roster.id)) return response.status(409).json({ error: `${roster.name} is already in another battle.` });
    const current = await db("battle_rosters").where({ battle_id: battle.id });
    const others = current.filter((row) => row.roster_id !== roster.id && row.team === team);
    if (others.length >= FORMATS[battle.format]) return response.status(409).json({ error: `Team ${team} is full for a ${battle.format} battle.` });
    await db("battle_rosters").where({ battle_id: battle.id, roster_id: roster.id }).delete();
    await db("battle_rosters").insert({ battle_id: battle.id, roster_id: roster.id, team });
    response.json(await present(battle));
  });

  router.delete("/battles/:battleId/participants/:rosterId", async (request, response) => {
    const battle = await loadBattle(request, response);
    if (!battle) return;
    if (battle.status !== "forming") return response.status(409).json({ error: "Teams can only change before the battle starts." });
    if (!(await mayManage(request, battle.campaign_id, [request.params.rosterId]))) return response.status(403).json({ error: "You can only remove your own warbands." });
    await db("battle_rosters").where({ battle_id: battle.id, roster_id: request.params.rosterId }).delete();
    response.json(await present(battle));
  });

  router.delete("/battles/:battleId", async (request, response) => {
    const battle = await loadBattle(request, response);
    if (!battle) return;
    if (battle.status === "active") return response.status(409).json({ error: "End the battle before removing it." });
    await db("battles").where({ id: battle.id }).delete();
    response.status(204).end();
  });

  router.post("/battles/:battleId/start", async (request, response) => {
    const battle = await loadBattle(request, response);
    if (!battle) return;
    if (battle.status !== "forming") return response.status(409).json({ error: "This battle has already started." });
    if (!(await mayRun(request, battle))) return response.status(403).json({ error: "Only a player in this battle can start it." });
    const view = await present(battle);
    for (const team of TEAMS) {
      const count = view.participants.filter((entry) => entry.team === team).length;
      if (count !== view.teamSize) return response.status(409).json({ error: `Team ${team} needs ${view.teamSize} warband${view.teamSize > 1 ? "s" : ""} for a ${view.format} battle.` });
    }
    const firstTeam = request.body?.firstTeam ?? "A";
    if (!TEAMS.includes(firstTeam)) return response.status(400).json({ error: "First team must be A or B." });
    const waiting = view.participants.filter((entry) => !entry.ready);
    if (waiting.length > 0) return response.status(409).json({ error: `${waiting.map((entry) => entry.name).join(", ")} must finish the pre-battle sequence first.` });
    await db.transaction(async (trx) => {
      await trx("rosters").whereIn("id", view.participants.map((entry) => entry.rosterId)).update({ campaign_phase: "battle", campaign_step: 1, battle_turn: 1, updated_at: new Date() });
      await trx("battles").where({ id: battle.id }).update({ status: "active", first_team: firstTeam, active_team: firstTeam, updated_at: new Date() });
    });
    response.json(await present(await find(battle.id)));
  });

  router.post("/battles/:battleId/advance", async (request, response) => {
    const battle = await loadBattle(request, response);
    if (!battle) return;
    if (battle.status !== "active") return response.status(409).json({ error: "This battle is not in progress." });
    if (!(await mayRun(request, battle))) return response.status(403).json({ error: "Only a player in this battle can advance it." });
    const endBattle = request.body?.endBattle === true;
    const rosters = await db("battle_rosters").join("rosters", "rosters.id", "battle_rosters.roster_id").where({ battle_id: battle.id }).select("rosters.*");
    const result = advanceCampaign(rosters[0], { endBattle });
    if (result.error) return response.status(409).json({ error: result.error });
    const updates = { ...result.updates };
    const battleUpdates = endBattle ? { status: "finished" } : {};
    const step = Number(rosters[0].campaign_step) || 1;
    if (!endBattle && step >= 4) {
      const other = battle.active_team === "A" ? "B" : "A";
      if (battle.active_team === battle.first_team) {
        updates.battle_turn = Number(rosters[0].battle_turn) || 1;
        battleUpdates.active_team = other;
      } else {
        battleUpdates.active_team = battle.first_team;
      }
    }
    await db.transaction(async (trx) => {
      await trx("rosters").whereIn("id", rosters.map((row) => row.id)).update({ ...updates, updated_at: new Date() });
      if (Object.keys(battleUpdates).length) await trx("battles").where({ id: battle.id }).update({ ...battleUpdates, updated_at: new Date() });
    });
    response.json(await present(await find(battle.id)));
  });

  return router;
}

module.exports = { createBattleRoutes };
