const { test } = require("node:test");
const assert = require("node:assert/strict");
const { equipmentSale, listedItem } = require("../src/services/equipment-sale.service");
const { tradingPermissions, canRecruitEquipment } = require("../src/services/trading-rules.service");

test("Freebuild switches shops and sale permissions at exactly one battle", () => {
  for (const battles_fought of [0, 1, 5]) {
    const roster = { campaign_id: null, battles_fought };
    assert.equal(canRecruitEquipment(roster), battles_fought === 0);
    assert.equal(tradingPermissions(roster).canPurchase, battles_fought >= 1);
    assert.equal(tradingPermissions(roster).canSell, battles_fought >= 1);
    assert.equal(tradingPermissions(roster).canTransfer, true);
  }
  assert.equal(canRecruitEquipment({ campaign_id: "campaign", campaign_phase: "setup", battles_fought: 0 }), true);
  for (const campaign_step of [1, 5, 6, 7, 8, 9]) {
    const roster = { campaign_id: "campaign", campaign_phase: "post_battle", campaign_step };
    assert.equal(tradingPermissions(roster).canSell, [6, 7, 8].includes(campaign_step));
    assert.equal(canRecruitEquipment(roster), false);
  }
});

test("resale uses listed base cost, ignores dice and paid amounts, and rounds down per copy", () => {
  const row = { id: "inventory", shop_item_id: "rare", unit_cost_paid: 900, quantity: 3 };
  assert.equal(equipmentSale(row, null, { id: "rare", baseCost: 35, priceDice: 10 }).unitSaleValue, 17);
  assert.equal(equipmentSale({ ...row, unit_cost_paid: 0 }, null, { id: "rare", baseCost: 35 }).unitSaleValue, 17);
  assert.equal(equipmentSale(row, null, { id: "rare", baseCost: 35 }, [{ id: "rare", baseCost: 9 }]).unitSaleValue, 4);
  assert.equal(equipmentSale({ id: "legacy", unit_cost_paid: 5 }, { name: "Sword", category: "weapon", unit_cost: 5 }).unitSaleValue, 5);
  assert.equal(equipmentSale({ id: "legacy", unit_cost_paid: 7 }, { name: "Unlisted faction weapon", category: "weapon", unit_cost: 7 }).unitSaleValue, 3);
});

test("legacy aliases preserve pistol braces and material prices without matching upgraded variants", () => {
  for (const [name, id, price] of [
    ["Brace of Pistols", "pistol-brace", 30],
    ["Brace of Duelling Pistols", "duelling-pistol-brace", 60],
    ["Brace of Warplock Pistols", "warplock-pistol-brace", 70],
    ["Mace/hammer", "club-mace-hammer", 3],
    ["Gromril hammer", "gromril-club-mace-hammer", 12],
    ["Ithilmar sword", "ithilmar-sword", 30],
    ["Hammer", "club-mace-hammer", 3],
    ["Sword", "sword", 10],
  ]) {
    const item = listedItem({ name, category: "weapon" });
    assert.equal(item?.id, id, name);
    assert.equal(item.baseCost, price, name);
  }
});

test("bound, permanent and free starter equipment cannot be sold", () => {
  const row = { id: "inventory", shop_item_id: "sword", unit_cost_paid: 10 };
  for (const flags of [{ nontransferable: true }, { bound_warrior_id: "wizard" }]) {
    const sale = equipmentSale({ ...row, ...flags }, null, { baseCost: 10 });
    assert.equal(sale.unitSaleValue, null);
    assert.ok(sale.saleRestriction);
  }
  assert.match(equipmentSale({ id: "free", unit_cost_paid: 0 }, { name: "Dagger", unit_cost: 2 }).saleRestriction, /Free starting/);
});
