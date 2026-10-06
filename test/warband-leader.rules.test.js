const { test } = require("node:test");
const assert = require("node:assert/strict");
const { standardLeaders, selectLeader, leaderAbility } = require("../src/services/warband-leader.service");
const catalog = require("../catalog.json");
const { additions } = require("../src/services/warband-source.service");
const { mercenarySects } = require("../src/services/warband-identity.service");

const hero = (id, type, leadership, created = "2026-01-01") => ({
  id, role: "Hero", warrior_type_name: type, stats: { Ld: leadership }, created_at: created,
});

test("every supported warband maps to one of its native Hero types", () => {
  assert.deepEqual(Object.keys(standardLeaders).sort(), [...catalog.warbands, ...additions].map((row) => row.name).concat(mercenarySects).sort());
  for (const [warband, leader] of Object.entries(standardLeaders)) {
    assert.ok(catalog.associations.some((row) => row.warbandName === (mercenarySects.includes(warband) ? "Mercenaries" : warband)
      && row.warriorName === leader && row.category === "Hero")
      || additions.find((band) => band.name === warband)?.warriors.some((type) => type.name === leader && type.role === "Hero"), warband);
  }
});

test("native leader outranks higher Leadership; replacements use numeric current Leadership", () => {
  const captain = hero("captain", "Mercenary Captain", 8);
  const champion = hero("champion", "Champions (Mercenaries & Amazons)", "10");
  const youngblood = hero("youngblood", "Youngblood", "9");
  const hiredSword = { ...hero("hired", "Warlock (HS)", 12), role: "Hired Sword" };
  assert.equal(selectLeader("Mercenaries", [champion, captain, youngblood, hiredSword]).id, "captain");
  assert.equal(selectLeader("Mercenaries", [youngblood, hiredSword, champion]).id, "champion");
  assert.equal(selectLeader("Mercenaries", [hiredSword]), null);
});

test("ties use recruitment time then ID, never display order", () => {
  const first = hero("a", "Youngblood", 7, "2026-01-01");
  const second = hero("b", "Youngblood", 7, "2026-01-02");
  assert.equal(selectLeader("Mercenaries", [second, first]).id, "a");
  assert.equal(selectLeader("Mercenaries", [hero("b", "Youngblood", 7), first]).id, "a");
});

test("Leader is a temporary non-purchasable ability with the sourced six-inch rule", () => {
  const ability = leaderAbility();
  assert.equal(ability.name, "Leader");
  assert.equal(ability.isLeaderAbility, true);
  assert.equal(ability.isLearnable, false);
  assert.equal(ability.purchaseCost, null);
  assert.match(ability.description, /6".*Leadership/);
});
