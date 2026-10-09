const { test } = require("node:test");
const assert = require("node:assert/strict");
const { canUseEquipment } = require("../src/services/equipment-access.service");
const { catalog, canEquipItem } = require("../src/services/trading-catalog.service");
const equipment = require("../equipment-catalog.json");

const sword = { name: "Sword", category: "weapon", ranged: false };
const bow = { name: "Bow", category: "weapon", ranged: true };
const heavyArmour = { name: "Heavy armour", category: "armour" };
const shield = { name: "Shield", category: "shield" };

test("Night Runners have an explicit Henchmen equipment assignment despite their Hero role", () => {
  const assignment = equipment.assignments.find((row) => row.warbandName === "Skaven"
    && row.warriorTypeNames?.includes("Night Runners"));
  assert.equal(assignment.listKey, "skaven-henchman");
  assert.ok(equipment.assignments.find((row) => row.warbandName === "Skaven" && row.listKey === "skaven-hero")
    .excludeWarriorTypes.includes("Night Runners"));
});

test("Norse Hunters get bows and javelins while Marauders get throwing axes and light armour", () => {
  const names = (key) => equipment.lists.find((row) => row.warbandName === "Norse" && row.key === key)
    .items.map((item) => item.name);
  assert.ok(names("norse-hunter").includes("Bow"));
  assert.ok(names("norse-hunter").includes("Javelins"));
  assert.ok(!names("norse-hunter").includes("Light armour"));
  assert.ok(!names("norse-hunter").includes("Throwing axes"));
  assert.ok(names("norse-henchman").includes("Light armour"));
  assert.ok(names("norse-henchman").includes("Throwing axes"));
  assert.ok(!names("norse-henchman").includes("Bow"));
  assert.ok(!names("norse-henchman").includes("Javelins"));
});

test("Possessed cannot use weapons or armour, and shields require an Extra Arm", () => {
  const context = { warbandName: "Cult of the Possessed", typeName: "The Possessed" };
  for (const mutationIds of [[], ["extra-arm"]]) {
    assert.equal(canUseEquipment(sword, { ...context, mutationIds }), false);
    assert.equal(canUseEquipment(heavyArmour, { ...context, mutationIds }), false);
    assert.equal(canUseEquipment(shield, { ...context, mutationIds }), mutationIds.includes("extra-arm"));
    for (const name of ["shield", "buckler"]) {
      const item = catalog.find((row) => row.id === name);
      assert.ok(item, name);
      assert.equal(canEquipItem(item, { ...context, role: "Hero", mutationIds }), mutationIds.includes("extra-arm"));
    }
  }
  assert.equal(canUseEquipment(sword, { ...context, typeName: "Mutants" }), true);
});

test("Fellblades cannot bypass their missile prohibition with weapon skills or custom items", () => {
  const context = { warbandName: "Dark Elves", typeName: "Fellblades", role: "Hero",
    skillNames: ["Weapons Expert"], permittedNames: ["Bow", "Sword"] };
  assert.equal(canUseEquipment(sword, context), true);
  assert.equal(canUseEquipment(bow, context), false);
  assert.equal(canUseEquipment({ name: "Unclassified weapon", category: "weapon" }, context), false);
  assert.equal(canEquipItem({ ...bow, custom: true }, context), false);
  assert.equal(canUseEquipment(bow, { ...context, typeName: "High Born" }), true);
});

test("Priests of Taal cannot wear heavy armour and Orc Shamans cannot use armour or shields", () => {
  for (const warbandName of ["Ostlanders", "Horned Hunters"]) {
    const context = { warbandName, typeName: "Priest of Taal" };
    assert.equal(canUseEquipment(heavyArmour, context), false);
    assert.equal(canUseEquipment({ name: "Light armour", category: "armour" }, context), true);
    assert.equal(canUseEquipment(shield, context), true);
  }
  const shaman = { warbandName: "Orc", typeName: "Orc Shaman" };
  assert.equal(canUseEquipment(heavyArmour, shaman), false);
  assert.equal(canUseEquipment(shield, shaman), false);
  assert.equal(canUseEquipment(sword, shaman), true);
  assert.equal(canUseEquipment(heavyArmour, { ...shaman, typeName: "Orc Boss" }), true);
});

test("Condemned equipment unlocks only when all four variable characteristics are fixed", () => {
  const context = { warbandName: "Marauders of Chaos", typeName: "Condemned" };
  const fixed = { WS: "4", S: "4", T: "4", A: "2" };
  for (const stat of ["WS", "S", "T", "A"]) {
    for (const value of ["D6", "D3+1", "", "0", undefined]) {
      assert.equal(canUseEquipment(sword, { ...context, stats: { ...fixed, [stat]: value } }), false);
    }
  }
  assert.equal(canUseEquipment(sword, context), false);
  assert.equal(canUseEquipment(sword, { ...context, stats: fixed }), true);
  assert.equal(canEquipItem(catalog.find((item) => item.id === "sword"),
    { ...context, role: "Hero", stats: fixed, permittedNames: ["Sword"] }), true);
  const rope = catalog.find((item) => item.id === "rope-hook");
  assert.ok(rope);
  assert.equal(canEquipItem(rope, context), false);
});
