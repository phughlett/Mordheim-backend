const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateTradingRules, diceFor, tradingPermissions } = require("../src/services/trading-rules.service");

test("custom item rules reject malformed prices, rarity, restrictions and duplicate IDs", () => {
  const catalog = [{ id: "pistol" }];
  const item = { id: "custom-sword", name: "Sword", description: "Custom sword", baseCost: 10, rarity: null };
  const rules = { overrides: { pistol: { disabled: true, baseCost: 99, priceDice: 2, priceMultiplier: 10, rarity: 11 } }, customItems: [item] };
  assert.equal(validateTradingRules(rules, catalog).rules.customItems[0].category, "misc");
  for (const patch of [{ baseCost: -1 }, { baseCost: 2.5 }, { rarity: "9" }, { rarity: 21 },
    { name: "" }, { description: "" }, { requiredSkill: 3 }, { allowedWarbands: "Mercenaries" }, { id: "pistol" }]) {
    assert.ok(validateTradingRules({ ...rules, customItems: [{ ...item, ...patch }] }, catalog).error);
  }
  assert.ok(validateTradingRules({ ...rules, customItems: [item, item] }, catalog).error);
  assert.ok(validateTradingRules({ overrides: { unknown: {} }, customItems: [] }, catalog).error);
  assert.ok(validateTradingRules({ overrides: { pistol: { disabled: "false" } }, customItems: [] }, catalog).error);
});

test("physical dice must match dice count and range and simulated dice are D6s", () => {
  assert.deepEqual(diceFor("manual", [1, 6], 2), [1, 6]);
  assert.deepEqual(diceFor("manual", [], 0), []);
  for (const dice of [[1], [0, 6], [7, 2], [1.5, 2], ["1", 3]]) assert.throws(() => diceFor("manual", dice, 2));
  assert.throws(() => diceFor("unknown", [], 0));
  const rolled = diceFor("simulated", undefined, 6);
  assert.equal(rolled.length, 6);
  assert.ok(rolled.every((die) => die >= 1 && die <= 6));
});

test("campaign trading and transfers are locked to their exact phases", () => {
  assert.deepEqual(tradingPermissions({ campaign_id: null }), { canPurchase: true, canSearch: false, canTransfer: true });
  for (const campaign_phase of ["setup", "pre_battle", "battle"]) {
    const result = tradingPermissions({ campaign_id: "campaign", campaign_phase, campaign_step: 1 });
    assert.equal(result.canPurchase, false);
    assert.equal(result.canSearch, false);
    assert.equal(result.canTransfer, campaign_phase !== "battle");
  }
  for (let campaign_step = 1; campaign_step <= 10; campaign_step++) {
    const result = tradingPermissions({ campaign_id: "campaign", campaign_phase: "post_battle", campaign_step });
    assert.equal(result.canPurchase, [6, 7, 8].includes(campaign_step));
    assert.equal(result.canSearch, campaign_step === 6);
    assert.equal(result.canTransfer, campaign_step === 9);
  }
});
