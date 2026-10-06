const { test } = require("node:test");
const assert = require("node:assert/strict");
const { index, additions, definitions, audits, validateDefinitions } = require("../src/services/warband-source.service");
const { standardLeaders } = require("../src/services/warband-leader.service");
const { getStatMaximumProfile, racialMaximums } = require("../src/services/advancement-rules.service");

test("source manifest includes every Core, 1A and 1B entry and retains existing 1C warbands", () => {
  validateDefinitions();
  assert.equal(index.warbands.filter((band) => band.grade === "core").length, 6);
  assert.equal(index.warbands.filter((band) => band.grade === "1a").length, 7);
  assert.equal(index.warbands.filter((band) => band.grade === "1b").length, 23);
  assert.equal(index.warbands.filter((band) => band.grade === "1c").length, 3);
  assert.equal(new Set(index.warbands.map((band) => band.name)).size, 39);
  assert.equal(additions.length, 15);
  const audited = new Set(audits.map((audit) => audit.warbandName));
  for (const entry of index.warbands) {
    assert.ok(additions.some((band) => band.name === entry.name) || audited.has(entry.name), entry.name);
  }
});

test("new warbands have complete playable profiles, native leaders, permissions and race limits", () => {
  for (const band of additions) {
    assert.equal(standardLeaders[band.name], band.leaderType);
    for (const type of band.warriors) {
      assert.equal(typeof type.canGainExperience, "boolean", `${band.name}/${type.name}`);
      assert.equal(typeof type.large, "boolean");
      if (!type.canGainExperience) assert.notEqual(type.promotionEligibility, "eligible", type.name);
      if (type.maximumProfile) {
        assert.ok(racialMaximums[type.maximumProfile], type.maximumProfile);
        assert.equal(getStatMaximumProfile(band.name, type.name), type.maximumProfile);
      }
      for (const listKey of type.equipmentListKeys) assert.ok(band.equipmentLists.some((list) => list.key === listKey));
    }
  }
});

test("corrections are source anchored and leave manual rules distinct from learnable skills", () => {
  for (const band of definitions) {
    assert.match(band.sourceUrl, /^https:\/\/mordheimer\.net\/docs\/warbands\//);
    for (const rule of band.specialRules ?? []) {
      assert.ok(rule.name);
      assert.ok(rule.summary);
    }
  }
  assert.ok(audits.some((audit) => audit.warbandName === "Dwarf Treasure Hunters"));
});
