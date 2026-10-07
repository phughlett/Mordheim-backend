const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mapTypes, resolveMaps, describeMap } = require("../src/services/mordheim-map.service");

test("all six D6 outcomes resolve to the five core map types", () => {
  const results = resolveMaps({ mode: "manual", dice: [1, 2, 3, 4, 5, 6] }, 6);
  assert.deepEqual(results.map((result) => result.type), ["fake", "vague", "vague", "catacomb", "accurate", "master"]);
  assert.deepEqual(results.map((result) => result.roll), [1, 2, 3, 4, 5, 6]);
  assert.ok(results.every((result) => result.mode === "manual"));
  for (const result of results) {
    const described = describeMap(result);
    assert.match(described.name, /^Mordheim Map \(/);
    assert.match(described.description, /not applied automatically/);
  }
});

test("manual choice supports every type without claiming a dice result", () => {
  for (const type of mapTypes) {
    assert.deepEqual(resolveMaps({ mode: "choose", type: type.id }, 2),
      [{ type: type.id, mode: "choose", roll: null }, { type: type.id, mode: "choose", roll: null }]);
  }
  assert.match(describeMap({ type: "master" }).description, /Hero.*not taken out of action/);
  assert.deepEqual(describeMap(null), {});
});

test("simulated rolls generate one valid independently recorded result per map", () => {
  const results = resolveMaps({ mode: "simulated" }, 100);
  assert.equal(results.length, 100);
  for (const result of results) {
    assert.ok(mapTypes.find((type) => type.id === result.type).rolls.includes(result.roll));
    assert.equal(result.mode, "simulated");
  }
});

test("invalid selections and missing or malformed dice fail explicitly", () => {
  for (const selection of [undefined, null, [], {}, { mode: "choose", type: "unknown" },
    { mode: "manual", dice: [] }, { mode: "manual", dice: [0] },
    { mode: "manual", dice: [7] }, { mode: "manual", dice: [1.5] },
    { mode: "manual", dice: ["6"] }, { mode: "manual", dice: [1, 2] }]) {
    assert.throws(() => resolveMaps(selection, 1), (error) => error.status === 400);
  }
});
