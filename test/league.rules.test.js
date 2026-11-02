const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const { validateScenario, validateWindow, validateTables, suggestTables, calendar, coreScenarios, examples } = require("../src/services/league.service");
const ids = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);

test("scenario formats, windows and complete player assignments are validated", () => {
  assert.equal(coreScenarios.length, 9);
  assert.throws(() => validateScenario({ ...coreScenarios[0], format: "ffa" }), /flexible teams/);
  assert.throws(() => validateScenario({ ...coreScenarios[0], format: "teams", minPlayers: 4, maxPlayers: 3 }), /2 and 8/);
  assert.throws(() => validateWindow({ startsAt: "2026-11-02T18:00", endsAt: "2026-11-03T18:00", timezone: "UTC" }), /timezone offset/);
  assert.throws(() => validateWindow({ startsAt: "2026-11-02T18:00Z", endsAt: "2026-11-02T17:00Z", timezone: "UTC" }), /later end/);
  assert.throws(() => validateWindow({ startsAt: "2026-11-02T18:00Z", endsAt: "2026-11-03T18:00Z", timezone: "Not/AZone" }), /valid IANA/);
  assert.throws(() => validateTables([[ids[0], ids[0]]], [], ids.slice(0, 2), coreScenarios[0]), /exactly once/);
  assert.throws(() => validateTables([[ids[0], ids[1]]], [], ids, coreScenarios[0]), /exactly once/);
  assert.deepEqual(validateTables([[ids[0], ids[1]]], [ids[2]], ids.slice(0, 3), coreScenarios[0]).absences, [ids[2]]);
  assert.throws(() => validateTables([[ids[0]]], ids.slice(1), ids, coreScenarios[0]), /2.*2 players/);
});
test("table suggestions cover every player and vary opponents or prioritize rating", () => {
  const players = ids.map((id, i) => ({ id, rating: [100, 105, 300, 305, 800][i] }));
  const rating = suggestTables(players, [], 2, "rating");
  assert.deepEqual(rating.tables[0], ids.slice(0, 2));
  assert.deepEqual(rating.absences, [ids[4]]);
  const rotation = suggestTables(players.slice(0, 4), rating.tables, 2, "rotation");
  assert.notDeepEqual(rotation.tables[0], rating.tables[0]);
  const flexible = suggestTables(players, [], 4, "rotation");
  assert.deepEqual(new Set(flexible.tables.flat()), new Set(ids));
  assert.deepEqual(flexible.tables.map((t) => t.length), [3, 2]);
  assert.deepEqual(flexible.absences, []);
});
test("all ten 2026 examples have usable structured sections and preserved original map downloads", () => {
  assert.equal(examples.scenarios.length, 10);
  assert.equal(examples.scenarios[3].format, "individual");
  assert.equal(examples.startingGold, 700);
  assert.ok(examples.houseRules.length > 20000 && examples.houseRules.length < 150000);
  for (const scenario of examples.scenarios) {
    const validated = validateScenario(scenario);
    for (const field of ["rules", "victory", "experience", "rewards"]) assert.ok(validated[field].length > 20);
    assert.equal(validated.documentUrl, scenario.documentUrl);
    const document = path.resolve(__dirname, "../../frontend/public", scenario.documentUrl.slice(1));
    if (existsSync(path.resolve(__dirname, "../../frontend"))) {
      assert.ok(existsSync(document), scenario.documentUrl);
      assert.equal(readFileSync(document).subarray(0, 2).toString(), "PK");
    }
  }
});
test("calendar export uses UTC windows, escapes text and folds UTF-8 lines to 75 bytes", () => {
  const ics = calendar({ name: "League,\nBEGIN:VEVENT" }, [{
    id: ids[0], number: 1, updated_at: "2026-11-01T10:00:00Z",
    starts_at: "2026-11-02T10:00:00-07:00", ends_at: "2026-11-09T10:00:00-07:00",
    scenario: { name: "Résumé".repeat(30), source: "Own rules" }, timezone: "America/Denver", location: "Club; room 1",
  }]);
  assert.match(ics, /DTSTART:20261102T170000Z/);
  assert.match(ics, /LOCATION:Club\\; room 1/);
  assert.equal(ics.split("\r\n").filter((line) => line === "BEGIN:VEVENT").length, 1);
  assert.ok(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
});
