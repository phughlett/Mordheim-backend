const crypto = require("crypto");
const express = require("express");
const { defaultPurchaseRules, validatePurchaseRules } = require("../services/advance-purchase-rules.service");
const { defaultTradingRules, validateTradingRules } = require("../services/trading-rules.service");
const { catalog } = require("../services/trading-catalog.service");

function toCampaignResponse(campaign, warbandCount = 0, userId = null) {
  return {
    id: campaign.id,
    name: campaign.name,
    maxGc: campaign.max_gc,
    warbandCount: Number(warbandCount),
    inviteCode: campaign.invite_code,
    isOwner: Boolean(userId) && campaign.owner_id === userId,
    advancePurchaseRules: { skillsEnabled: true, ...(campaign.advance_purchase_rules || defaultPurchaseRules) },
    tradingRules: campaign.trading_rules || defaultTradingRules,
  };
}

const newInviteCode = () => crypto.randomBytes(5).toString("hex").toUpperCase();

function validateMaxGc(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 100000;
}

function createCampaignRoutes(db) {
  const router = express.Router();

  async function load(id, userId) {
    const campaign = await db("campaigns").where({ id }).first();
    if (!campaign) return null;
    const [{ count }] = await db("rosters").where({ campaign_id: id }).count("id as count");
    return toCampaignResponse(campaign, count, userId);
  }

  // Resolves a campaign the caller belongs to, or answers the request with 404/403.
  async function loadForMember(request, response, ownerOnly = false) {
    const campaign = await load(request.params.campaignId, request.user.id);
    if (!campaign) {
      response.status(404).json({ error: "Campaign not found." });
      return null;
    }
    const member = await db("campaign_members").where({ campaign_id: campaign.id, user_id: request.user.id }).first();
    if (!member) {
      response.status(403).json({ error: "You have not joined this campaign." });
      return null;
    }
    if (ownerOnly && !campaign.isOwner) {
      response.status(403).json({ error: "Only the campaign owner can do that." });
      return null;
    }
    return campaign;
  }

  router.get("/campaigns", async (request, response) => {
    const rows = await db("campaigns")
      .join("campaign_members", "campaign_members.campaign_id", "campaigns.id")
      .where({ "campaign_members.user_id": request.user.id })
      .orderBy("campaigns.created_at", "asc")
      .select("campaigns.*", db.raw("(select count(*) from rosters where rosters.campaign_id = campaigns.id) as warband_count"));
    response.json(rows.map((row) => toCampaignResponse(row, row.warband_count, request.user.id)));
  });

  router.post("/campaigns/join", async (request, response) => {
    const code = typeof request.body?.code === "string" ? request.body.code.trim().toUpperCase() : "";
    const campaign = code ? await db("campaigns").where({ invite_code: code }).first() : null;
    if (!campaign) return response.status(404).json({ error: "No campaign matches that invite code." });
    await db("campaign_members").insert({ campaign_id: campaign.id, user_id: request.user.id }).onConflict(["campaign_id", "user_id"]).ignore();
    response.json(await load(campaign.id, request.user.id));
  });

  router.get("/campaigns/:campaignId", async (request, response) => {
    const campaign = await loadForMember(request, response);
    if (!campaign) return;
    const rosters = await db("rosters").leftJoin("users", "users.id", "rosters.user_id").where({ "rosters.campaign_id": campaign.id }).orderBy("rosters.created_at", "asc").select("rosters.id", "rosters.name", "rosters.warband", "users.username as player");
    const players = await db("campaign_members").join("users", "users.id", "campaign_members.user_id").where({ campaign_id: campaign.id }).orderBy("campaign_members.joined_at").pluck("users.username");
    response.json({ ...campaign, warbands: rosters, players });
  });

  router.post("/campaigns", async (request, response) => {
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    const maxGc = request.body?.maxGc === undefined ? 500 : Number(request.body.maxGc);
    if (!name) return response.status(400).json({ error: "Campaign name must not be empty." });
    if (!validateMaxGc(maxGc)) return response.status(400).json({ error: "Maximum GC must be a whole number of 0 or more." });
    const purchaseRules = validatePurchaseRules(request.body?.advancePurchaseRules === undefined ? defaultPurchaseRules : request.body.advancePurchaseRules);
    if (purchaseRules.error) return response.status(400).json({ error: purchaseRules.error });
    const trading = validateTradingRules(request.body?.tradingRules ?? defaultTradingRules, catalog);
    if (trading.error) return response.status(400).json({ error: trading.error });
    const [warbands, types, skills] = await Promise.all([
      db("warbands").pluck("name"), db("warrior_types").pluck("name"), db("skills").pluck("name"),
    ]);
    for (const item of trading.rules.customItems) {
      if ([...(item.allowedWarbands ?? []), ...(item.excludedWarbands ?? [])].some((name) => !warbands.includes(name))
        || [...(item.allowedTypeNames ?? []), ...(item.excludedTypeNames ?? [])].some((name) => !types.includes(name))
        || (item.requiredSkill && !skills.includes(item.requiredSkill))) {
        return response.status(400).json({ error: `${item.name}: choose existing warband, warrior-type and skill names for restrictions.` });
      }
    }
    const campaign = await db.transaction(async (trx) => {
      const [created] = await trx("campaigns").insert({ name, max_gc: maxGc, owner_id: request.user.id, invite_code: newInviteCode(), advance_purchase_rules: JSON.stringify(purchaseRules.rules), trading_rules: JSON.stringify(trading.rules) }).returning("*");
      for (const item of trading.rules.customItems) {
        await trx("shop_items").insert({ id: `${created.id}/${item.id}`, campaign_id: created.id,
          definition: JSON.stringify({ ...item, id: `${created.id}/${item.id}` }) });
      }
      await trx("campaign_members").insert({ campaign_id: created.id, user_id: request.user.id });
      return created;
    });
    response.status(201).json(toCampaignResponse(campaign, 0, request.user.id));
  });

  router.patch("/campaigns/:campaignId", async (request, response) => {
    const current = await loadForMember(request, response, true);
    if (!current) return;
    const updates = {};
    if (request.body?.name !== undefined) {
      if (typeof request.body.name !== "string" || !request.body.name.trim()) return response.status(400).json({ error: "Campaign name must not be empty." });
      updates.name = request.body.name.trim();
    }
    if (request.body?.maxGc !== undefined && Number(request.body.maxGc) !== current.maxGc) {
      const maxGc = Number(request.body.maxGc);
      if (!validateMaxGc(maxGc)) return response.status(400).json({ error: "Maximum GC must be a whole number of 0 or more." });
      if (current.warbandCount > 0) return response.status(409).json({ error: "Maximum GC cannot change once warbands have joined the campaign." });
      updates.max_gc = maxGc;
    }
    if (Object.keys(updates).length === 0) return response.status(400).json({ error: "No valid campaign fields supplied." });
    await db("campaigns").where({ id: current.id }).update({ ...updates, updated_at: new Date() });
    response.json(await load(current.id, request.user.id));
  });

  router.delete("/campaigns/:campaignId", async (request, response) => {
    const current = await loadForMember(request, response, true);
    if (!current) return;
    if (current.warbandCount > 0) return response.status(409).json({ error: "Remove the campaign's warbands before deleting it." });
    await db("campaigns").where({ id: current.id }).delete();
    response.status(204).end();
  });

  return router;
}

module.exports = { createCampaignRoutes };
