const { test } = require("node:test");
const assert = require("node:assert/strict");
const { defaultPurchaseRules, validatePurchaseRules, canPurchaseAdvances } = require("../src/services/advance-purchase-rules.service");

test("paid advancement defaults include all requested prices and uncapped purchases", () => {
  assert.equal(defaultPurchaseRules.enabled, false);
  assert.equal(defaultPurchaseRules.skillsEnabled, true);
  assert.equal(defaultPurchaseRules.skillCost, 40);
  assert.deepEqual(Object.entries(defaultPurchaseRules.stats).map(([stat, rule]) => [stat, rule.firstCost, rule.additionalCost, rule.maxIncreases]), [
    ["M", 15, 15, null], ["WS", 15, 15, null], ["BS", 15, 15, null], ["S", 25, 35, null],
    ["T", 30, 45, null], ["W", 20, 30, null], ["I", 10, 10, null], ["A", 25, 35, null], ["Ld", 15, 15, null],
  ]);
  assert.deepEqual(validatePurchaseRules(defaultPurchaseRules).rules, defaultPurchaseRules);
  for (const value of [null, {}, { ...defaultPurchaseRules, enabled: "true" }, { ...defaultPurchaseRules, skillCost: -1 },
    { ...defaultPurchaseRules, stats: {} }, { ...defaultPurchaseRules, skillCost: 1.5 }]) {
    assert.ok(validatePurchaseRules(value).error);
  }
  for (const maxIncreases of [-1, 1.5, "1", 22]) {
    const invalid = structuredClone(defaultPurchaseRules);
    invalid.stats.S.maxIncreases = maxIncreases;
    assert.ok(validatePurchaseRules(invalid).error);
  }
});

test("skill purchases can be independently disabled and legacy rules remain compatible", () => {
  const disabled = { ...defaultPurchaseRules, enabled: true, skillsEnabled: false };
  assert.deepEqual(validatePurchaseRules(disabled).rules, disabled);
  const { skillsEnabled, ...legacy } = defaultPurchaseRules;
  assert.equal(validatePurchaseRules(legacy).rules.skillsEnabled, true);
  for (const skillsEnabled of [null, "false", 0]) {
    assert.ok(validatePurchaseRules({ ...defaultPurchaseRules, skillsEnabled }).error);
  }
});

test("paid advancement access is strictly Hero-only initial campaign creation", () => {
  const warrior = { campaignId: "campaign", role: "Hero", canGainExperience: true, phase: "setup", battlesFought: 0 };
  const rules = { ...defaultPurchaseRules, enabled: true };
  assert.equal(canPurchaseAdvances(warrior, rules), true);
  assert.equal(canPurchaseAdvances(warrior, defaultPurchaseRules), false);
  for (const patch of [{ campaignId: null }, { role: "Henchman" }, { role: "Hired Sword" }, { canGainExperience: false },
    { phase: "post_battle" }, { phase: "battle" }, { phase: "pre_battle" }, { battlesFought: 1 }]) {
    assert.equal(canPurchaseAdvances({ ...warrior, ...patch }, rules), false);
  }
});
