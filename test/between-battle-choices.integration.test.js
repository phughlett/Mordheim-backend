const { before, after, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const knex = require("knex");
const { createApp } = require("../src/app");
const db = knex(require("../knexfile")[process.env.NODE_ENV || "development"]);
let server, base, warbands;
const users = [];
async function call(method, path, body, user = users[0]) {
  const response = await fetch(`${base}${path}`, { method,
    headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${user.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function fixture(wizard = false, campaign = false) {
  const band = warbands.find((band) => band.name === (wizard ? "Undead" : "Reikland Mercenaries"));
  const types = (await call("GET", `/warbands/${band.id}/warrior-types`)).body;
  const type = types.find((type) => wizard ? type.name.startsWith("Necromancer") : type.name === "Youngblood");
  const campaignId = campaign ? (await call("POST", "/campaigns", { name: "Choice corrections" })).body.id : null;
  const roster = (await call("POST", "/rosters", { warbandId: band.id, ...(campaignId ? { campaignId } : {}) })).body;
  const hired = await call("POST", `/rosters/${roster.id}/members`, { warriorTypeId: type.id, role: "Hero", name: "Choice tester" });
  assert.equal(hired.status, 201, JSON.stringify(hired.body));
  return { member: hired.body, roster };
}
async function award(member, counter = undefined) {
  const [row] = await db("warrior_advances").insert({ warrior_id: member.id, advance_table: "Hero",
    experience_threshold: 2, result: "new_skill", mode: "manual",
    ...(counter === undefined ? {} : { choice_battles_fought: counter }) }).returning("*");
  return row;
}
describe("choices are correctable only before the next battle", () => {
  before(async () => {
    await db.migrate.latest();
    server = createApp(db).listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
    for (const name of ["owner", "other"]) {
      const auth = await call("POST", "/auth/register", { username: `choices_${name}_${randomUUID().slice(0, 12)}`, password: "Between-battle-tests-123!" }, null);
      assert.equal(auth.status, 201); users.push({ id: auth.body.user.id, token: auth.body.token });
    }
    warbands = (await call("GET", "/warbands")).body;
  });
  after(async () => {
    const ids = users.map((user) => user.id);
    await db("rosters").whereIn("user_id", ids).delete();
    await db("campaigns").whereIn("owner_id", ids).delete();
    await db("users").whereIn("id", ids).delete();
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.destroy();
  });
  test("an old pending skill award can be chosen now, revised now, and never forgotten after another battle", async () => {
    const { member, roster } = await fixture();
    const advance = await award(member);
    await db("rosters").where({ id: roster.id }).update({ battles_fought: 1 });
    const data = (await call("GET", `/members/${member.id}/skills`)).body;
    const skill = data.availableSkills[0];
    assert.ok(skill);
    const learned = await call("POST", `/members/${member.id}/skills`, { skillId: skill.id, advanceId: advance.id });
    assert.equal(learned.status, 201, JSON.stringify(learned.body));
    const choice = learned.body.learnedSkills.find((row) => row.id === skill.id);
    assert.equal(choice.canForget, true);
    assert.equal((await call("DELETE", `/members/${member.id}/skills/${choice.warriorSkillId}`, undefined, users[1])).status, 403);
    assert.equal((await call("DELETE", `/members/${member.id}/skills/${choice.warriorSkillId}`, undefined, null)).status, 401);
    assert.equal((await call("DELETE", `/members/${member.id}/skills/${choice.warriorSkillId}`)).status, 200);
    assert.equal((await db("warrior_advances").where({ id: advance.id }).first()).learned_skill_id, null);
    const replacement = (await call("POST", `/members/${member.id}/skills`, { skillId: data.availableSkills[1].id, advanceId: advance.id })).body.learnedSkills.find((row) => row.id === data.availableSkills[1].id);
    await db("rosters").where({ id: roster.id }).update({ battles_fought: 2 });
    assert.equal((await call("DELETE", `/members/${member.id}/skills/${replacement.warriorSkillId}`)).status, 409);
    assert.equal((await call("GET", `/members/${member.id}/skills`)).body.learnedSkills.find((row) => row.warriorSkillId === replacement.warriorSkillId).canForget, false);
    assert.equal((await call("DELETE", `/members/${member.id}/advances/${advance.id}`)).status, 409);
  });
  test("advancement reversal restores stats, allows a replacement across campaign stages, and locks next battle", async () => {
    const { member, roster } = await fixture(false, true);
    await db("warriors").where({ id: member.id }).update({ experience: 2 });
    await db("rosters").where({ id: roster.id }).update({ campaign_phase: "post_battle", campaign_step: 2 });
    const recorded = await call("POST", `/members/${member.id}/advances`, { mode: "manual", result: "stat_increase", stat: "WS" });
    assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
    await db("rosters").where({ id: roster.id }).update({ campaign_phase: "battle" });
    const id = recorded.body.history[0].id;
    assert.equal((await call("DELETE", `/members/${member.id}/advances/${id}`)).status, 200);
    const restored = await db("warriors").where({ id: member.id }).first("stats");
    assert.equal(restored.stats.WS, member.stats.WS);
    const replacement = await call("POST", `/members/${member.id}/advances`, { mode: "manual", result: "new_skill" });
    assert.equal(replacement.status, 201, JSON.stringify(replacement.body));
    await db("rosters").where({ id: roster.id }).update({ battles_fought: 1 });
    assert.equal((await call("DELETE", `/members/${member.id}/advances/${replacement.body.history[0].id}`)).status, 409);
    assert.equal((await call("GET", `/members/${member.id}/advances`)).body.history[0].canRemove, false);
  });
  test("starting and advance spells may be corrected now, while old spells and legacy choices stay fixed", async () => {
    const { member, roster } = await fixture(true);
    const data = (await call("GET", `/members/${member.id}/spells`)).body;
    const discipline = data.availableDisciplines[0];
    const first = discipline.spells[0];
    const learned = await call("POST", `/members/${member.id}/spells`, { spellId: first.id, acquisitionMethod: "starting" });
    assert.equal(learned.status, 201, JSON.stringify(learned.body));
    const known = learned.body.knownSpells[0];
    assert.equal(known.canForget, true);
    assert.equal((await call("DELETE", `/members/${member.id}/spells/${known.warriorSpellId}`)).status, 200);
    const replacement = await call("POST", `/members/${member.id}/spells`, { spellId: discipline.spells[1].id, acquisitionMethod: "starting" });
    assert.equal(replacement.status, 201);
    const advance = await award(member);
    const second = await call("POST", `/members/${member.id}/spells`, { spellId: first.id, advanceId: advance.id, acquisitionMethod: "advance" });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    const secondSpell = second.body.knownSpells.find((spell) => spell.spellId === first.id);
    assert.equal((await call("DELETE", `/members/${member.id}/spells/${secondSpell.warriorSpellId}`)).status, 200);
    assert.equal((await db("warrior_advances").where({ id: advance.id }).first()).learned_spell_id, null);
    await db("rosters").where({ id: roster.id }).update({ battles_fought: 1 });
    assert.equal((await call("DELETE", `/members/${member.id}/spells/${replacement.body.knownSpells[0].warriorSpellId}`)).status, 409);
    const old = await award(member, -1);
    assert.equal((await call("DELETE", `/members/${member.id}/advances/${old.id}`)).status, 409);
  });
  test("a current spell difficulty resolution of an old award can be undone without forgetting an old spell", async () => {
    const { member, roster } = await fixture(true);
    const data = (await call("GET", `/members/${member.id}/spells`)).body;
    const learned = await call("POST", `/members/${member.id}/spells`, { spellId: data.availableDisciplines[0].spells[0].id, acquisitionMethod: "starting" });
    const spell = learned.body.knownSpells[0];
    const advance = await award(member);
    await db("rosters").where({ id: roster.id }).update({ battles_fought: 1 });
    const reduced = await call("POST", `/members/${member.id}/spells/${spell.warriorSpellId}/reduce-difficulty`, { advanceId: advance.id });
    assert.equal(reduced.status, 200, JSON.stringify(reduced.body));
    assert.equal((await call("GET", `/members/${member.id}/advances`)).body.history[0].canResetChoice, true);
    const undo = await call("DELETE", `/members/${member.id}/advances/${advance.id}/choice`);
    assert.equal(undo.status, 200, JSON.stringify(undo.body));
    assert.equal((await db("warrior_spells").where({ id: spell.warriorSpellId }).first()).casting_difficulty_modifier, 0);
    assert.equal((await call("DELETE", `/members/${member.id}/advances/${advance.id}/choice`)).status, 409);
  });
});
