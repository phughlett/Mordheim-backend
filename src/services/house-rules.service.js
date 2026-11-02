const statLabels = ["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"];

// "automated" options are enforced by the app; "manual" options are tabletop or roster-keeping
// rules that players apply themselves and are shown to every player as campaign reference.
const optionalRuleCatalog = [
  { id: "critical-hits-by-weapon", name: "Critical hits by weapon type", automation: "manual", group: "Battle rules",
    summary: "Use the rulebook's optional critical hit charts for missile, bludgeoning, bladed, unarmed and thrusting weapons instead of the standard critical hit." },
  { id: "blackpowder-weapons", name: "Blackpowder weapons", automation: "manual", group: "Battle rules",
    summary: "Use the optional blackpowder rules (misfires and handling) from the main rulebook." },
  { id: "escaping-combat", name: "Escaping from combat", automation: "manual", group: "Battle rules",
    summary: "Allow models to attempt to leave close combat using the optional rule." },
  { id: "mounted-models", name: "Mounted models", automation: "manual", group: "Battle rules",
    summary: "Allow mounts and mounted combat using the optional mounted model rules." },
  { id: "alternative-rout", name: "Alternative rout test", automation: "manual", group: "Battle rules",
    summary: "Use the campaign's alternative rout rule described in the house rules text." },
  { id: "rewards-of-the-shadowlord", name: "Rewards of the Shadowlord", automation: "manual", group: "Campaign rules",
    summary: "Possessed warbands may receive the optional Shadowlord rewards." },
  { id: "opulent-goods", name: "Opulent goods", automation: "manual", group: "Campaign rules",
    summary: "Allow the optional opulent goods. Add any needed items with campaign custom items or record them manually." },
  { id: "lads-got-talent-once", name: "One declared \"Lad's Got Talent\"", automation: "manual", group: "Campaign rules",
    summary: "Each warband may once per campaign declare a henchman advance as \"The Lad's Got Talent\" before rolling." },
  { id: "rank-wyrdstone-table", name: "Rank-based wyrdstone selling", automation: "manual", group: "Campaign rules",
    summary: "Wyrdstone sale prices depend on shards sold and league rank. Record the sale price manually." },
  { id: "deserters", name: "Deserters / ranking catch-up", automation: "manual", group: "Campaign rules",
    summary: "Lower-ranked warbands receive temporary mercenary help in scenarios as described in the house rules." },
  { id: "sector-rewards", name: "Sector control rewards", automation: "manual", group: "Campaign rules",
    summary: "Scenario winners control a sector of the city and roll for sector rewards after each scenario." },
];
const optionalRuleIds = new Set(optionalRuleCatalog.map((rule) => rule.id));

const defaultHouseRuleOptions = { optionalRules: [], startingBonus: null };

function validateHouseRuleOptions(value) {
  if (value === undefined || value === null) return { options: { ...defaultHouseRuleOptions } };
  if (typeof value !== "object" || Array.isArray(value)) return { error: "House rule options must be an object." };
  const optionalRules = value.optionalRules ?? [];
  if (!Array.isArray(optionalRules) || optionalRules.some((id) => !optionalRuleIds.has(id)) || new Set(optionalRules).size !== optionalRules.length) {
    return { error: "Optional rules must be unique, known optional rule IDs." };
  }
  let startingBonus = null;
  if (value.startingBonus != null) {
    const bonus = value.startingBonus;
    const stats = Array.isArray(bonus.stats) ? bonus.stats : [];
    if (!stats.length || stats.some((stat) => !statLabels.includes(stat)) || new Set(stats).size !== stats.length) {
      return { error: "Starting bonus characteristics must be a non-empty list of unique characteristics." };
    }
    if (!Number.isSafeInteger(bonus.pool) || bonus.pool < 1 || bonus.pool > 50) return { error: "Starting bonus pool must be a whole number from 1 to 50." };
    if (!Number.isSafeInteger(bonus.maxPerHero) || bonus.maxPerHero < 1 || bonus.maxPerHero > 9) return { error: "Starting bonuses per Hero must be a whole number from 1 to 9." };
    startingBonus = { stats: statLabels.filter((stat) => stats.includes(stat)), pool: bonus.pool, maxPerHero: bonus.maxPerHero };
  }
  return { options: { optionalRules: optionalRuleCatalog.map((rule) => rule.id).filter((id) => optionalRules.includes(id)), startingBonus } };
}

const paidStats = ["WS", "BS", "I", "Ld"];
const league2026Preset = {
  maxGc: 700,
  scenarioLimit: 10,
  advancePurchaseRules: {
    enabled: true, skillsEnabled: false, skillCost: 40, costEscalation: "hero",
    stats: Object.fromEntries(statLabels.map((stat) => [stat, paidStats.includes(stat)
      ? { firstCost: 15, additionalCost: 30, maxIncreases: 1 }
      : { firstCost: 0, additionalCost: 0, maxIncreases: 0 }])),
  },
  houseRuleOptions: {
    optionalRules: ["blackpowder-weapons", "escaping-combat", "mounted-models", "alternative-rout", "rewards-of-the-shadowlord",
      "opulent-goods", "lads-got-talent-once", "rank-wyrdstone-table", "deserters", "sector-rewards"],
    startingBonus: { stats: ["W"], pool: 4, maxPerHero: 1 },
  },
};

module.exports = { optionalRuleCatalog, defaultHouseRuleOptions, validateHouseRuleOptions, league2026Preset, statLabels };
