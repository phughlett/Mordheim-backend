const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getMutationAccess, mutationOptions, priceMutations } = require("../src/services/mutation-rules.service");

test("mutation catalog prices and eligibility match the Cult rules", () => {
  assert.deepEqual(mutationOptions.map((option) => [option.id, option.unitCost]), [
    ["daemon-soul", 20], ["great-claw", 50], ["cloven-hoofs", 40], ["tentacle", 35],
    ["blackblood", 30], ["spines", 35], ["scorpion-tail", 40], ["extra-arm", 40], ["hideous", 40],
  ]);
  assert.ok(mutationOptions.every((option) => option.effectText && option.sourceReference));
  assert.equal(getMutationAccess("Cult of the Possessed", "Mutants", "Hero").required, true);
  assert.equal(getMutationAccess("Cult of the Possessed", "The Possessed", "Hero").required, false);
  for (const [warband, type, role] of [
    ["Mercenaries", "Mutants", "Hero"], ["Cult of the Possessed", "Magister", "Hero"],
    ["Cult of the Possessed", "Mutants", "Henchman"], ["Cult of the Possessed", "Beastmen", "Hero"],
  ]) assert.equal(getMutationAccess(warband, type, role).eligible, false);
});

test("mutation pricing charges the first normally and every later purchase double", () => {
  const access = getMutationAccess("Cult of the Possessed", "Mutants", "Hero");
  assert.ok(priceMutations([], access).error);
  assert.equal(priceMutations([], access, false).totalCost, 0);
  assert.equal(priceMutations(["daemon-soul", "great-claw", "extra-arm"], access).totalCost, 200);
  assert.equal(priceMutations(["great-claw", "daemon-soul"], access).totalCost, 90);
  assert.equal(priceMutations(["great-claw", "great-claw"], access).totalCost, 150);
  for (const ids of [null, {}, "daemon-soul", [null], ["unverified"]]) assert.ok(priceMutations(ids, access).error);
});
