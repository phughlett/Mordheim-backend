const { randomInt } = require("node:crypto");

const defaultTradingRules = { overrides: {}, customItems: [] };
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
class TradingError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
function fail(message, status) { throw new TradingError(message, status); }

function validateTradingRules(value, catalog) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !value.overrides || typeof value.overrides !== "object" || Array.isArray(value.overrides)
    || !Array.isArray(value.customItems) || value.customItems.length > 100) {
    return { error: "Trading rules require item overrides and at most 100 custom items." };
  }
  const prices = (rule) => (rule.baseCost === undefined || integer(rule.baseCost, 0, 100000))
    && (rule.priceDice === undefined || integer(rule.priceDice, 0, 10))
    && (rule.priceMultiplier === undefined || integer(rule.priceMultiplier, 1, 100))
    && (rule.rarity === undefined || rule.rarity === null || integer(rule.rarity, 2, 20));
  const overrides = {};
  for (const [id, rule] of Object.entries(value.overrides)) {
    if (!catalog.some((item) => item.id === id) || !rule || typeof rule !== "object" || Array.isArray(rule)
      || !prices(rule) || (rule.disabled !== undefined && typeof rule.disabled !== "boolean")
      || Object.keys(rule).some((key) => !["disabled", "baseCost", "priceDice", "priceMultiplier", "rarity"].includes(key))) {
      return { error: `Invalid trading override for ${id}.` };
    }
    overrides[id] = { ...rule };
  }
  const ids = new Set();
  const customItems = [];
  for (const item of value.customItems) {
    if (!item || typeof item !== "object" || !/^custom-[0-9a-z-]{1,80}$/.test(item.id)
      || ids.has(item.id) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 120
      || typeof item.description !== "string" || !item.description.trim() || item.description.length > 5000
      || !integer(item.baseCost, 0, 100000) || item.rarity === undefined || !prices(item)
      || (item.category !== undefined && !["weapon", "armour", "shield", "misc"].includes(item.category))
      || (item.heroOnly !== undefined && typeof item.heroOnly !== "boolean")
      || (item.requiredSkill !== undefined && (typeof item.requiredSkill !== "string" || !item.requiredSkill.trim() || item.requiredSkill.length > 120))) {
      return { error: "Custom items need a unique custom- ID, name, description, whole-number cost, and rarity (null for Common)." };
    }
    const restrictions = {};
    for (const key of ["allowedWarbands", "excludedWarbands", "allowedTypeNames", "excludedTypeNames"]) {
      if (item[key] !== undefined) {
        if (!Array.isArray(item[key]) || item[key].length > 200
          || item[key].some((name) => typeof name !== "string" || !name.trim() || name.length > 120)) {
          return { error: `Custom ${item.name}: ${key} must be a list of names.` };
        }
        restrictions[key] = [...new Set(item[key].map((name) => name.trim()))];
      }
    }
    ids.add(item.id);
    customItems.push({
      id: item.id, name: item.name.trim(), description: item.description.trim(),
      baseCost: item.baseCost, rarity: item.rarity, category: item.category ?? "misc",
      priceDice: item.priceDice ?? 0, priceMultiplier: item.priceMultiplier ?? 1,
      sourceReference: "Custom campaign item", custom: true, ...restrictions,
      heroOnly: item.heroOnly ?? false, ...(item.requiredSkill ? { requiredSkill: item.requiredSkill.trim() } : {}),
    });
  }
  return { rules: { overrides, customItems } };
}

function diceFor(mode, dice, count) {
  if (!["manual", "simulated"].includes(mode)) fail("Choose manual or simulated dice.", 400);
  if (mode === "simulated") return Array.from({ length: count }, () => randomInt(1, 7));
  if (!Array.isArray(dice) || dice.length !== count || dice.some((die) => !integer(die, 1, 6))) {
    fail(`Enter exactly ${count} dice, each from 1 to 6.`, 400);
  }
  return [...dice];
}
function tradingPermissions(roster) {
  const freebuild = !roster.campaign_id;
  const post = roster.campaign_phase === "post_battle";
  return {
    canPurchase: (freebuild && Number(roster.battles_fought) >= 1) || (!freebuild && post && [6, 7, 8].includes(roster.campaign_step)),
    canSell: (freebuild && Number(roster.battles_fought) >= 1) || (!freebuild && post && [6, 7, 8].includes(roster.campaign_step)),
    canSearch: !freebuild && post && roster.campaign_step === 6,
    canTransfer: freebuild || roster.campaign_phase === "setup" || roster.campaign_phase === "pre_battle"
      || (post && roster.campaign_step === 9),
  };
}
function canRecruitEquipment(roster) {
  return roster.campaign_id ? roster.campaign_phase === "setup" : Number(roster.battles_fought) === 0;
}
module.exports = { defaultTradingRules, validateTradingRules, diceFor, tradingPermissions, canRecruitEquipment, TradingError, fail, integer, uuid };
