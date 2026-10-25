const { test } = require("node:test");
const assert = require("node:assert/strict");
const { equipmentKey, summarizeGroup, groupEquipmentError } = require("../src/services/group-equipment.service");

const member = { id: "thunderers", name: "Thunderers", group_size: 4 };
const row = (name, model_index, quantity = 1, extra = {}) => ({ name, model_index, quantity, ...extra });

test("recruitment and shop equipment match by canonical identity, not price or source", () => {
  for (const name of ["Mace", "Hammer", "Staff", "Club"]) {
    assert.equal(equipmentKey(row(name)), equipmentKey({ shop_item_id: "club-mace-hammer" }));
  }
  const group = summarizeGroup(member, [
    ...[0, 1, 2].map((index) => row("Crossbow", index)),
    row("Crossbow", 3, 1, { shop_item_id: "crossbow", unit_cost_paid: 99 }),
  ]);
  assert.equal(group.valid, true);
  assert.deepEqual(group.items[0].quantities, [1, 1, 1, 1]);
  assert.equal(groupEquipmentError([group]), null);
});

test("reports per-model deficits including multiple copies and uneven distributions", () => {
  const group = summarizeGroup(member, [row("Mace", 0, 2), row("Mace", 1, 1), row("Mace", 2, 2)]);
  assert.equal(group.valid, false);
  assert.deepEqual(group.items[0], {
    key: "shop:club-mace-hammer", name: "Mace", quantities: [2, 1, 2, 0], perModel: 2, total: 5, missing: 3,
  });
  assert.match(groupEquipmentError([group]), /Thunderers \(Mace: missing 3\)/);
});

test("individual equipment permissions and empty loadouts do not falsely block groups", () => {
  assert.equal(summarizeGroup(member, [row("Crossbow", 0)], true).valid, true);
  assert.equal(summarizeGroup(member, []).valid, true);
  assert.equal(summarizeGroup({ ...member, group_size: 1 }, [row("Crossbow", 0)]).valid, true);
});

test("special material and permanently upgraded items remain distinct", () => {
  assert.notEqual(equipmentKey(row("Mace")), equipmentKey({ shop_item_id: "gromril-club-mace-hammer" }));
  assert.notEqual(equipmentKey(row("Sword")), equipmentKey({ shop_item_id: "upgrade/poisoned-sword" }));
});
