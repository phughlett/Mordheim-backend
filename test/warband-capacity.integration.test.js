const { after, before, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const knex = require("knex");
const knexConfig = require("../knexfile");
const { createApp } = require("../src/app");
const capacities = require("../warband-capacity.json");
const catalog = require("../catalog.json");

const db = knex(knexConfig[process.env.NODE_ENV || "development"] || knexConfig.development);
let server;
let base;
let user;
let token;
let warbands;

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describe("source-backed warband model limits", () => {
  before(async () => {
    await db.migrate.latest();
    server = createApp(db).listen(0);
    base = `http://127.0.0.1:${server.address().port}/api`;
    const registered = await call("POST", "/auth/register", {
      username: `capacity_${Date.now()}`, password: "Capacity-test-123!",
    });
    assert.equal(registered.status, 201);
    user = registered.body.user;
    token = registered.body.token;
    warbands = (await call("GET", "/warbands")).body;
  });

  after(async () => {
    if (user) {
      await db("rosters").where({ user_id: user.id }).delete();
      await db("users").where({ id: user.id }).delete();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.destroy();
  });

  test("every supported warband has an audited base maximum and a specific reference", async () => {
    const names = capacities.map(({ name }) => name);
    assert.equal(new Set(names).size, names.length);
    assert.deepEqual([...names].sort(), catalog.warbands.map(({ name }) => name).sort());
    assert.deepEqual(warbands.map(({ name }) => name).sort(), [...names].sort());
    const twelve = new Set(["Bretonnian", "Dark Elves", "Dwarf Treasure Hunters", "Shadow Warrior", "Witch Hunters"]);
    const twenty = new Set(["Lizardmen", "Night Goblins", "Orc", "Skaven"]);
    for (const rule of capacities) {
      const expected = twelve.has(rule.name) ? 12 : twenty.has(rule.name) ? 20 : 15;
      assert.equal(rule.maxMembers, expected, rule.name);
      const warband = warbands.find(({ name }) => name === rule.name);
      assert.equal(warband.maxMembers, expected, rule.name);
      assert.equal(warband.limitsSourceReference, rule.source);
      const roster = await call("POST", "/rosters", { warbandId: warband.id });
      assert.equal(roster.status, 201);
      assert.equal(roster.body.maxMembers, expected, rule.name);
      assert.equal(roster.body.capacity.baseMaxMembers, expected, rule.name);
      assert.equal(roster.body.capacity.maxMembers, expected, rule.name);
      assert.equal(roster.body.capacity.limitsSourceReference, rule.source);
      const read = (await call("GET", `/rosters/${roster.body.id}`)).body;
      assert.equal(read.maxMembers, expected, rule.name);
      const updated = (await call("PATCH", `/rosters/${roster.body.id}`, { name: `${rule.name} audit` })).body;
      assert.equal(updated.maxMembers, expected, rule.name);
    }
  });

  test("Lizardmen permit exactly 20 models and the corrected smaller warbands permit exactly 12", async () => {
    for (const name of ["Lizardmen", "Bretonnian", "Dark Elves", "Witch Hunters"]) {
      const warband = warbands.find((item) => item.name === name);
      const roster = (await call("POST", "/rosters", { warbandId: warband.id, treasury: 10000 })).body;
      const types = (await call("GET", `/warbands/${warband.id}/warrior-types?category=Henchman`)).body;
      const type = types.find((item) => item.hireCost !== null && item.maxCount === null && !item.maxCountReferenceTypes?.length);
      assert.ok(type, `Need an uncapped Henchman type for ${name}`);
      let count = 0;
      let latestMember;
      while (count < warband.maxMembers) {
        const groupSize = Math.min(5, warband.maxMembers - count);
        const hired = await call("POST", `/rosters/${roster.id}/members`, {
          name: `${name} group ${count}`, role: "Henchman", warriorTypeId: type.id, groupSize,
        });
        assert.equal(hired.status, 201, JSON.stringify(hired.body));
        latestMember = hired.body;
        count += groupSize;
      }
      const full = (await call("GET", `/rosters/${roster.id}`)).body;
      assert.equal(full.capacity.currentMembers, warband.maxMembers);
      const extra = await call("POST", `/rosters/${roster.id}/members`, {
        name: "Over capacity", role: "Henchman", warriorTypeId: type.id,
      });
      assert.equal(extra.status, 409);
      assert.match(extra.body.error, new RegExp(`maximum size of ${warband.maxMembers}`));
      if (latestMember.groupSize < 5) {
        const resized = await call("PATCH", `/members/${latestMember.id}`, { groupSize: latestMember.groupSize + 1 });
        assert.equal(resized.status, 409);
      }
      const unchanged = (await call("GET", `/rosters/${roster.id}`)).body;
      assert.equal(unchanged.capacity.currentMembers, warband.maxMembers);
      assert.equal(unchanged.treasury, full.treasury);
      if (name === "Lizardmen") {
        const cookbook = full.capacity.availableModifiers.find((item) => item.name === "Halfling Cookbook");
        assert.ok(cookbook);
        const extended = await call("PUT", `/rosters/${roster.id}/capacity-modifiers`, { modifierIds: [cookbook.id] });
        assert.equal(extended.status, 200);
        assert.equal(extended.body.capacity.baseMaxMembers, 20);
        assert.equal(extended.body.capacity.maxMembers, 21);
        const hired = await call("POST", `/rosters/${roster.id}/members`, {
          name: "Bonus slot", role: "Henchman", warriorTypeId: type.id,
        });
        assert.equal(hired.status, 201);
        const overBonus = await call("POST", `/rosters/${roster.id}/members`, {
          name: "Over bonus capacity", role: "Henchman", warriorTypeId: type.id,
        });
        assert.equal(overBonus.status, 409);
        assert.equal((await call("PUT", `/rosters/${roster.id}/capacity-modifiers`, { modifierIds: [] })).status, 409);
      }
    }
  });
});
