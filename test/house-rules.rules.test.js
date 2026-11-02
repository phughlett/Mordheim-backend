const { test } = require("node:test");
const assert = require("node:assert/strict");
const { optionalRuleCatalog, validateHouseRuleOptions, league2026Preset, defaultHouseRuleOptions } = require("../src/services/house-rules.service");
const { validatePurchaseRules } = require("../src/services/advance-purchase-rules.service");

test("house rule options default to no optional rules and no starting bonus", () => {
  assert.deepEqual(validateHouseRuleOptions(undefined).options, defaultHouseRuleOptions);
  assert.deepEqual(validateHouseRuleOptions(null).options, defaultHouseRuleOptions);
  assert.deepEqual(validateHouseRuleOptions({}).options, defaultHouseRuleOptions);
});

test("house rule options keep catalog order and normalise starting bonus characteristics", () => {
  const result = validateHouseRuleOptions({
    optionalRules: ["deserters", "critical-hits-by-weapon"],
    startingBonus: { stats: ["Ld", "W"], pool: 4, maxPerHero: 1 },
  });
  assert.deepEqual(result.options, {
    optionalRules: ["critical-hits-by-weapon", "deserters"],
    startingBonus: { stats: ["W", "Ld"], pool: 4, maxPerHero: 1 },
  });
  assert.ok(optionalRuleCatalog.every((rule) => ["manual", "automated"].includes(rule.automation) && rule.summary));
});

test("house rule options reject unknown, duplicate and out-of-range values", () => {
  for (const value of [
    [], "x", { optionalRules: ["unknown"] }, { optionalRules: ["deserters", "deserters"] },
    { startingBonus: { stats: [], pool: 4, maxPerHero: 1 } }, { startingBonus: { stats: ["Q"], pool: 4, maxPerHero: 1 } },
    { startingBonus: { stats: ["W", "W"], pool: 4, maxPerHero: 1 } }, { startingBonus: { stats: ["W"], pool: 0, maxPerHero: 1 } },
    { startingBonus: { stats: ["W"], pool: 4, maxPerHero: 0 } }, { startingBonus: { stats: ["W"], pool: 1.5, maxPerHero: 1 } },
  ]) assert.ok(validateHouseRuleOptions(value).error, JSON.stringify(value));
});

test("the 2026 preset validates and matches the supplied starting rules", () => {
  assert.equal(league2026Preset.maxGc, 700);
  assert.deepEqual(validateHouseRuleOptions(league2026Preset.houseRuleOptions).options, league2026Preset.houseRuleOptions);
  assert.deepEqual(league2026Preset.houseRuleOptions.startingBonus, { stats: ["W"], pool: 4, maxPerHero: 1 });
  const rules = validatePurchaseRules(league2026Preset.advancePurchaseRules);
  assert.equal(rules.error, undefined);
  assert.equal(rules.rules.costEscalation, "hero");
  assert.equal(rules.rules.skillsEnabled, false);
  assert.deepEqual(Object.entries(rules.rules.stats).filter(([, rule]) => rule.maxIncreases !== 0).map(([stat]) => stat), ["WS", "BS", "I", "Ld"]);
  assert.ok(!league2026Preset.houseRuleOptions.optionalRules.includes("critical-hits-by-weapon"));
});

test("paid advancement cost escalation defaults to per-characteristic and rejects unknown modes", () => {
  const base = { enabled: true, skillCost: 1, stats: league2026Preset.advancePurchaseRules.stats };
  assert.equal(validatePurchaseRules(base).rules.costEscalation, "characteristic");
  assert.ok(validatePurchaseRules({ ...base, costEscalation: "warband" }).error);
});
