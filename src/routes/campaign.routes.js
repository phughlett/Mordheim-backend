const crypto = require("crypto");
const express = require("express");
const { defaultPurchaseRules, validatePurchaseRules } = require("../services/advance-purchase-rules.service");
const { defaultTradingRules, validateTradingRules } = require("../services/trading-rules.service");
const { catalog } = require("../services/trading-catalog.service");
const { uuid } = require("../services/trading-rules.service");
const { defaultHouseRuleOptions, validateHouseRuleOptions } = require("../services/house-rules.service");

function toCampaignResponse(campaign, warbandCount = 0, userId = null) {
  return {
    id: campaign.id,
    name: campaign.name,
    maxGc: campaign.max_gc,
    warbandCount: Number(warbandCount),
    inviteCode: campaign.invite_code,
    isOwner: Boolean(userId) && campaign.owner_id === userId,
    leagueEnabled: campaign.league_enabled,
    scenarioLimit: campaign.scenario_limit,
    houseRules: campaign.house_rules,
    allowedWarbandIds: campaign.allowed_warband_ids,
    maxWarbandsPerPlayer: campaign.max_warbands_per_player,
    houseRuleOptions: campaign.house_rule_options || defaultHouseRuleOptions,
    advancePurchaseRules: { skillsEnabled: true, ...(campaign.advance_purchase_rules || defaultPurchaseRules) },
    tradingRules: campaign.trading_rules || defaultTradingRules,
  };
}

const newInviteCode = () => crypto.randomBytes(5).toString("hex").toUpperCase();

function validateMaxGc(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 100000;
}

// Validates commissioner settings shared by campaign creation and editing; returns column updates.
async function validateSettings(query, body) {
  const updates = {};
  if (body.scenarioLimit !== undefined) {
    const limit = body.scenarioLimit;
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)) return { error: "Scenario limit must be 1–1000 or null for indefinite." };
    updates.scenario_limit = limit;
  }
  if (body.houseRules !== undefined) {
    if (typeof body.houseRules !== "string" || body.houseRules.length > 150000) return { error: "House rules must be text of at most 150000 characters." };
    updates.house_rules = body.houseRules;
  }
  if (body.maxWarbandsPerPlayer !== undefined) {
    const value = body.maxWarbandsPerPlayer;
    if (value !== null && (!Number.isSafeInteger(value) || value < 1 || value > 100)) return { error: "Warbands per player must be 1–100 or null for unlimited." };
    updates.max_warbands_per_player = value;
  }
  if (body.allowedWarbandIds !== undefined) {
    const ids = body.allowedWarbandIds;
    if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => !uuid(id)) || new Set(ids).size !== ids.length) return { error: "Allowed warbands must be unique warband IDs." };
    const found = await query("warbands").whereIn("id", ids).pluck("id");
    if (found.length !== ids.length) return { error: "Choose existing warbands." };
    updates.allowed_warband_ids = JSON.stringify(ids);
  }
  if (body.houseRuleOptions !== undefined) {
    const options = validateHouseRuleOptions(body.houseRuleOptions);
    if (options.error) return { error: options.error };
    updates.house_rule_options = JSON.stringify(options.options);
  }
  if (body.advancePurchaseRules !== undefined) {
    const rules = validatePurchaseRules(body.advancePurchaseRules);
    if (rules.error) return { error: rules.error };
    updates.advance_purchase_rules = JSON.stringify(rules.rules);
  }
  return { updates };
}

async function customItemRestrictionError(query, items) {
  if (!items.length) return null;
  const [warbands, types, skills] = await Promise.all([
    query("warbands").pluck("name"), query("warrior_types").pluck("name"), query("skills").pluck("name"),
  ]);
  for (const item of items) {
    if ([...(item.allowedWarbands ?? []), ...(item.excludedWarbands ?? [])].some((name) => !warbands.includes(name))
      || [...(item.allowedTypeNames ?? []), ...(item.excludedTypeNames ?? [])].some((name) => !types.includes(name))
      || (item.requiredSkill && !skills.includes(item.requiredSkill))) {
      return `${item.name}: choose existing warband, warrior-type and skill names for restrictions.`;
    }
  }
  return null;
}

async function insertCustomItems(query, campaignId, items) {
  for (const item of items) {
    await query("shop_items").insert({ id: `${campaignId}/${item.id}`, campaign_id: campaignId,
      definition: JSON.stringify({ ...item, id: `${campaignId}/${item.id}` }) });
  }
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
    const settings = await validateSettings(db, {
      ...request.body, advancePurchaseRules: request.body?.advancePurchaseRules === undefined ? defaultPurchaseRules : request.body.advancePurchaseRules,
    });
    if (settings.error) return response.status(400).json({ error: settings.error });
    const trading = validateTradingRules(request.body?.tradingRules ?? defaultTradingRules, catalog);
    if (trading.error) return response.status(400).json({ error: trading.error });
    const restrictionError = await customItemRestrictionError(db, trading.rules.customItems);
    if (restrictionError) return response.status(400).json({ error: restrictionError });
    const campaign = await db.transaction(async (trx) => {
      const [created] = await trx("campaigns").insert({
        ...settings.updates, name, max_gc: maxGc, owner_id: request.user.id, invite_code: newInviteCode(), trading_rules: JSON.stringify(trading.rules),
      }).returning("*");
      await insertCustomItems(trx, created.id, trading.rules.customItems);
      await trx("campaign_members").insert({ campaign_id: created.id, user_id: request.user.id });
      return created;
    });
    response.status(201).json(toCampaignResponse(campaign, 0, request.user.id));
  });

  router.patch("/campaigns/:campaignId", async (request, response) => db.transaction(async (trx) => {
    const membership = await loadForMember(request, response, true);
    if (!membership) return;
    const locked = await trx("campaigns").where({ id: membership.id }).forUpdate().first();
    const current = toCampaignResponse(locked, membership.warbandCount, request.user.id);
    const updates = {};
    if (request.body?.name !== undefined) {
      if (typeof request.body.name !== "string" || !request.body.name.trim()) return response.status(400).json({ error: "Campaign name must not be empty." });
      updates.name = request.body.name.trim();
    }
    if (request.body?.maxGc !== undefined && Number(request.body.maxGc) !== current.maxGc) {
      const maxGc = Number(request.body.maxGc);
      if (!validateMaxGc(maxGc)) return response.status(400).json({ error: "Maximum GC must be a whole number of 0 or more." });
      updates.max_gc = maxGc;
    }
    const settings = await validateSettings(trx, request.body ?? {});
    if (settings.error) return response.status(400).json({ error: settings.error });
    Object.assign(updates, settings.updates);
    if (updates.scenario_limit != null) {
      const [{ count }] = await trx("campaign_rounds").where({ campaign_id: current.id }).count();
      if (updates.scenario_limit < Number(count)) return response.status(409).json({ error: "Scenario limit cannot be below the number of scheduled scenarios." });
    }
    if (request.body?.tradingRules !== undefined) {
      const rules = validateTradingRules(request.body.tradingRules, catalog);
      if (rules.error) return response.status(400).json({ error: rules.error });
      // Existing custom items stay unchanged so purchased copies remain valid; new items may be appended.
      const existing = validateTradingRules(current.tradingRules, catalog).rules.customItems;
      if (JSON.stringify(rules.rules.customItems.slice(0, existing.length)) !== JSON.stringify(existing)) return response.status(409).json({ error: "Existing campaign custom items must be preserved when editing trading rules." });
      const added = rules.rules.customItems.slice(existing.length);
      const restrictionError = await customItemRestrictionError(trx, added);
      if (restrictionError) return response.status(400).json({ error: restrictionError });
      await insertCustomItems(trx, current.id, added);
      updates.trading_rules = JSON.stringify(rules.rules);
    }
    if (Object.keys(updates).length === 0) return response.status(400).json({ error: "No valid campaign fields supplied." });
    const [updated] = await trx("campaigns").where({ id: current.id }).update({ ...updates, updated_at: new Date() }).returning("*");
    response.json(toCampaignResponse(updated, membership.warbandCount, request.user.id));
  }));

  router.delete("/campaigns/:campaignId", async (request, response) => {
    const current = await loadForMember(request, response, true);
    if (!current) return;
    if (String(request.body?.confirmName ?? "").trim() !== current.name.trim()) {
      return response.status(400).json({ error: "Type the campaign name exactly to confirm deletion." });
    }
    const movedWarbandCount = await db.transaction(async (trx) => {
      if (!await trx("campaigns").where({ id: current.id }).forUpdate().first()) return null;
      // Warbands become Freebuild rosters; schedules, battles, standings and memberships cascade away.
      const moved = await trx("rosters").where({ campaign_id: current.id }).update({
        campaign_id: null, campaign_phase: "setup", campaign_step: 1, scenario: null, league_retired: false, updated_at: new Date(),
      }).returning("id");
      // Custom items still owned or in progress are detached so they keep displaying; the rest are deleted.
      await trx("shop_items").where({ campaign_id: current.id }).where((owned) => owned
        .whereIn("id", trx("warrior_inventory").whereNotNull("shop_item_id").select("shop_item_id"))
        .orWhereIn("id", trx("warband_stash").whereNotNull("shop_item_id").select("shop_item_id"))
        .orWhereIn("id", trx("trading_searches").select("item_id"))
        .orWhereIn("id", trx("trading_quotes").select("item_id")))
        .update({ campaign_id: null });
      await trx("campaigns").where({ id: current.id }).delete();
      return moved.length;
    });
    if (movedWarbandCount === null) return response.status(404).json({ error: "Campaign not found." });
    response.json({ deleted: true, movedWarbandCount });
  });

  return router;
}

module.exports = { createCampaignRoutes };
