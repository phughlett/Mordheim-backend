const { after, before, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const knex = require("knex");
const knexConfig = require("../knexfile");
const { createApp } = require("../src/app");

const suffix = Date.now().toString(36);
const db = knex(knexConfig[process.env.NODE_ENV || "development"] || knexConfig.development);
let server;
let base;
const users = {};

async function call(token, method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function register(name) {
  const result = await call(null, "POST", "/auth/register", { username: `${name}_${suffix}`, password: "password123" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  users[name] = { token: result.body.token, id: result.body.user.id };
}

describe("multi-user campaigns", () => {
  let campaign;
  let aliceRoster;
  let bobRoster;
  let carolRoster;

  before(async () => {
    await db.migrate.latest();
    server = createApp(db).listen(0);
    base = `http://127.0.0.1:${server.address().port}/api`;
    for (const name of ["alice", "bob", "carol"]) await register(name);
    const warbands = (await call(users.alice.token, "GET", "/warbands")).body;
    const warband = warbands.find((item) => item.name === "Mercenaries") ?? warbands[0];
    campaign = (await call(users.alice.token, "POST", "/campaigns", { name: `Test ${suffix}` })).body;
    assert.equal((await call(users.bob.token, "POST", "/campaigns/join", { code: campaign.inviteCode })).status, 200);
    aliceRoster = (await call(users.alice.token, "POST", "/rosters", { warbandId: warband.id, campaignId: campaign.id })).body;
    bobRoster = (await call(users.bob.token, "POST", "/rosters", { warbandId: warband.id, campaignId: campaign.id })).body;
    assert.ok(aliceRoster.id && bobRoster.id);
  });

  after(async () => {
    const ids = Object.values(users).map((user) => user.id);
    const rosterIds = (await db("rosters").whereIn("user_id", ids).select("id")).map((row) => row.id);
    await db("battle_rosters").whereIn("roster_id", rosterIds).delete();
    await db("rosters").whereIn("id", rosterIds).delete();
    await db("campaigns").where({ owner_id: users.alice.id }).delete();
    await db("users").whereIn("id", ids).delete();
    await new Promise((resolve) => server.close(resolve));
    await db.destroy();
  });

  test("requires sign-in", async () => {
    assert.equal((await call(null, "GET", "/rosters")).status, 401);
  });

  test("each user's own list contains only their warbands", async () => {
    const alice = (await call(users.alice.token, "GET", "/rosters")).body;
    const bob = (await call(users.bob.token, "GET", "/rosters")).body;
    assert.deepEqual(alice.map((item) => item.id), [aliceRoster.id]);
    assert.deepEqual(bob.map((item) => item.id), [bobRoster.id]);
  });

  test("campaign mates can see each other's warbands", async () => {
    const seenByBob = await call(users.bob.token, "GET", `/campaigns/${campaign.id}/rosters`);
    assert.equal(seenByBob.status, 200);
    assert.deepEqual(seenByBob.body.map((item) => item.id).sort(), [aliceRoster.id, bobRoster.id].sort());
    assert.equal(seenByBob.body.find((item) => item.id === aliceRoster.id).player, `alice_${suffix}`);
    const direct = await call(users.bob.token, "GET", `/rosters/${aliceRoster.id}`);
    assert.equal(direct.status, 200);
    assert.equal(direct.body.name, aliceRoster.name);
  });

  test("a user cannot modify a warband they do not own", async () => {
    const writes = [
      ["PATCH", `/rosters/${aliceRoster.id}`, { name: "Hacked" }],
      ["DELETE", `/rosters/${aliceRoster.id}`],
      ["POST", `/rosters/${aliceRoster.id}/members`, { name: "Spy" }],
      ["POST", `/rosters/${aliceRoster.id}/share`],
    ];
    for (const [method, path, body] of writes) {
      assert.equal((await call(users.bob.token, method, path, body)).status, 403, `${method} ${path}`);
    }
    assert.equal((await call(users.alice.token, "GET", `/rosters/${aliceRoster.id}`)).body.name, aliceRoster.name);
  });

  test("non-members cannot see a campaign or its warbands", async () => {
    assert.equal((await call(users.carol.token, "GET", `/campaigns/${campaign.id}/rosters`)).status, 403);
    assert.equal((await call(users.carol.token, "GET", `/rosters/${aliceRoster.id}`)).status, 403);
    assert.equal((await call(users.carol.token, "GET", `/campaigns/${campaign.id}`)).status, 403);
  });

  test("an owner can share a warband by code for read-only access, and revoke it", async () => {
    const shared = await call(users.alice.token, "POST", `/rosters/${aliceRoster.id}/share`);
    assert.equal(shared.status, 200);
    const code = shared.body.shareCode;
    assert.match(code, /^[0-9a-f]{12}$/);
    assert.equal((await call(users.alice.token, "POST", `/rosters/${aliceRoster.id}/share`)).body.shareCode, code);

    assert.equal((await call(users.carol.token, "POST", "/shared-rosters/join", { code: "nope" })).status, 404);
    const joined = await call(users.carol.token, "POST", "/shared-rosters/join", { code });
    assert.equal(joined.status, 200);
    assert.equal(joined.body.id, aliceRoster.id);

    assert.deepEqual((await call(users.carol.token, "GET", "/shared-rosters")).body.map((item) => item.id), [aliceRoster.id]);
    assert.equal((await call(users.carol.token, "GET", `/rosters/${aliceRoster.id}`)).status, 200);
    assert.equal((await call(users.carol.token, "PATCH", `/rosters/${aliceRoster.id}`, { name: "Nope" })).status, 403);
    assert.equal((await call(users.carol.token, "DELETE", `/rosters/${aliceRoster.id}/share`)).status, 403);

    assert.equal((await call(users.alice.token, "DELETE", `/rosters/${aliceRoster.id}/share`)).body.shareCode, null);
    assert.equal((await call(users.carol.token, "GET", `/rosters/${aliceRoster.id}`)).status, 403);
    assert.equal((await call(users.carol.token, "POST", "/shared-rosters/join", { code })).status, 404);
  });

  test("freebuild warbands need no campaign, can be shared, and stay read-only for others", async () => {
    const warband = aliceRoster.warbandId;
    const free = await call(users.alice.token, "POST", "/rosters", { warbandId: warband, treasury: 650 });
    assert.equal(free.status, 201, JSON.stringify(free.body));
    assert.equal(free.body.campaignId, null);
    assert.equal(Number(free.body.treasury), 650);
    assert.equal((await call(users.alice.token, "POST", "/rosters", { warbandId: warband, treasury: -1 })).status, 400);
    assert.equal((await call(users.alice.token, "POST", `/rosters/${free.body.id}/campaign/advance`)).status, 409);
    assert.equal((await call(users.bob.token, "GET", `/rosters/${free.body.id}`)).status, 403);
    const code = (await call(users.alice.token, "POST", `/rosters/${free.body.id}/share`)).body.shareCode;
    assert.equal((await call(users.bob.token, "POST", "/shared-rosters/join", { code })).status, 200);
    assert.equal((await call(users.bob.token, "GET", `/rosters/${free.body.id}`)).status, 200);
    assert.equal((await call(users.bob.token, "PATCH", `/rosters/${free.body.id}`, { name: "Nope" })).status, 403);
  });

  test("players only assign their own warbands to a shared battle", async () => {
    const battle = (await call(users.alice.token, "POST", `/campaigns/${campaign.id}/battles`, { format: "1v1" })).body;
    assert.equal((await call(users.bob.token, "PUT", `/battles/${battle.id}/participants`, { rosterId: aliceRoster.id, team: "A" })).status, 403);
    assert.equal((await call(users.alice.token, "PUT", `/battles/${battle.id}/participants`, { rosterId: aliceRoster.id, team: "A" })).status, 200);
    const result = await call(users.bob.token, "PUT", `/battles/${battle.id}/participants`, { rosterId: bobRoster.id, team: "B" });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.participants.map((entry) => entry.player).sort(), [`alice_${suffix}`, `bob_${suffix}`]);
    assert.equal((await call(users.carol.token, "GET", `/campaigns/${campaign.id}/battles`)).status, 403);
  });

  test("Henchman resizing charges additions, refunds removals, and observes campaign gates", async () => {
    const types = (await call(users.alice.token, "GET", `/warbands/${aliceRoster.warbandId}/warrior-types`)).body;
    const type = types.find((item) => item.category === "Henchman" && item.hireCost > 0);
    assert.ok(type);
    const free = await call(users.alice.token, "POST", "/rosters", { warbandId: aliceRoster.warbandId, treasury: type.hireCost * 3 });
    assert.equal(free.status, 201);
    const member = await call(users.alice.token, "POST", `/rosters/${free.body.id}/members`, {
      name: "Resize test group", role: "Henchman", warriorTypeId: type.id, groupSize: 2,
    });
    assert.equal(member.status, 201, JSON.stringify(member.body));
    const resize = (groupSize) => call(users.alice.token, "PATCH", `/members/${member.body.id}`, { groupSize });
    const read = () => call(users.alice.token, "GET", `/rosters/${free.body.id}`);
    assert.equal((await resize(3)).status, 200);
    assert.equal(Number((await read()).body.treasury), 0);
    assert.equal((await resize(3)).status, 200);
    assert.equal(Number((await read()).body.treasury), 0);
    assert.ok(await db("warrior_inventory").where({ warrior_id: member.body.id, model_index: 2 }).first());
    assert.equal((await resize(4)).status, 409);
    assert.equal((await read()).body.members[0].groupSize, 3);
    assert.equal(Number((await read()).body.treasury), 0);
    assert.equal((await resize(2)).status, 200);
    assert.equal(Number((await read()).body.treasury), type.hireCost);
    assert.equal(await db("warrior_inventory").where({ warrior_id: member.body.id, model_index: 2 }).first(), undefined);
    const repeated = await Promise.all([resize(2), resize(2)]);
    assert.ok(repeated.every((result) => result.status === 200));
    assert.equal(Number((await read()).body.treasury), type.hireCost);
    const simultaneous = await Promise.all([resize(3), resize(3)]);
    assert.ok(simultaneous.every((result) => result.status === 200));
    assert.equal(Number((await read()).body.treasury), 0);
    assert.equal((await resize(1)).status, 200);
    assert.equal(Number((await read()).body.treasury), type.hireCost * 2);
    assert.equal((await resize(0)).status, 400);
    assert.equal((await resize(6)).status, 400);
    await db("rosters").where({ id: free.body.id }).update({ campaign_id: campaign.id, campaign_phase: "battle" });
    assert.equal((await call(users.bob.token, "PATCH", `/members/${member.body.id}`, { groupSize: 2 })).status, 403);
    assert.equal((await resize(2)).status, 409);
    await db("rosters").where({ id: free.body.id }).update({ campaign_phase: "post_battle", campaign_step: 1 });
    assert.equal((await resize(2)).status, 409);
    await db("rosters").where({ id: free.body.id }).update({ campaign_step: 8 });
    assert.equal((await resize(2)).status, 200);
    await db("rosters").where({ id: free.body.id }).update({ campaign_step: 1 });
    assert.equal((await resize(1)).status, 200);
  });

  test("Henchman resizing refunds paid gear assigned to removed models", async () => {
    const types = (await call(users.alice.token, "GET", `/warbands/${aliceRoster.warbandId}/warrior-types`)).body;
    const type = types.find((item) => item.category === "Henchman" && item.hireCost > 0);
    assert.ok(type);
    const roster = await call(users.alice.token, "POST", "/rosters", {
      warbandId: aliceRoster.warbandId,
      treasury: 10000,
    });
    const member = await call(users.alice.token, "POST", `/rosters/${roster.body.id}/members`, {
      name: "Gear refund group",
      role: "Henchman",
      warriorTypeId: type.id,
      groupSize: 2,
    });
    assert.equal(member.status, 201);
    const equipment = await call(users.alice.token, "GET", `/members/${member.body.id}/equipment`);
    const option = equipment.body.availableOptions.find((item) =>
      item.allowIndividualGroupGear && item.unitCost > 0 && !item.firstFree);
    assert.ok(option, "expected an individually assignable paid equipment option");

    const purchase = await call(users.alice.token, "POST", `/members/${member.body.id}/equipment`, {
      equipmentOptionId: option.id,
      modelIndex: 1,
    });
    assert.equal(purchase.status, 201, JSON.stringify(purchase.body));
    const treasuryBeforeRemoval = Number((await call(users.alice.token, "GET", `/rosters/${roster.body.id}`)).body.treasury);
    const resize = await call(users.alice.token, "PATCH", `/members/${member.body.id}`, { groupSize: 1 });
    assert.equal(resize.status, 200);

    const updatedRoster = (await call(users.alice.token, "GET", `/rosters/${roster.body.id}`)).body;
    assert.equal(Number(updatedRoster.treasury), treasuryBeforeRemoval + type.hireCost + option.unitCost);
    assert.equal(await db("warrior_inventory")
      .where({ warrior_id: member.body.id, equipment_option_id: option.id, model_index: 1 })
      .first(), undefined);
  });

  test("a selected Hired Sword type cannot be replaced, cleared, or relabeled", async () => {
    const free = await call(users.alice.token, "POST", "/rosters", { warbandId: aliceRoster.warbandId });
    assert.equal(free.status, 201);
    const types = (await call(users.alice.token, "GET", `/warbands/${aliceRoster.warbandId}/warrior-types`)).body;
    const hiredSwords = types.filter((item) => item.category === "Hired Sword" && item.hireCost != null && !item.equipmentChoices.length);
    assert.ok(hiredSwords.length >= 2);
    const member = await call(users.alice.token, "POST", `/rosters/${free.body.id}/members`, {
      name: "Fixed Hired Sword", role: "Hired Sword", warriorTypeId: hiredSwords[0].id,
    });
    assert.equal(member.status, 201, JSON.stringify(member.body));
    for (const changes of [
      { warriorTypeId: hiredSwords[1].id }, { warriorTypeId: null },
      { warriorTypeId: "" }, { type: "Different Hired Sword" },
    ]) {
      const result = await call(users.alice.token, "PATCH", `/members/${member.body.id}`, changes);
      assert.equal(result.status, 409, JSON.stringify(result.body));
    }
    const edited = await call(users.alice.token, "PATCH", `/members/${member.body.id}`, {
      warriorTypeId: hiredSwords[0].id, name: "Renamed Hired Sword", notes: "Still editable",
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.warriorTypeId, hiredSwords[0].id);
    assert.equal(edited.body.name, "Renamed Hired Sword");
  });

  test("freebuild records mature XP within caps; campaigns allow XP only during allocation", async () => {
    const free = await call(users.alice.token, "POST", "/rosters", { warbandId: aliceRoster.warbandId, treasury: 500 });
    assert.equal(free.status, 201);
    assert.ok(free.body.campaign.allowedActions.includes("experience"));
    assert.ok(free.body.campaign.allowedActions.includes("advance"));
    const types = (await call(users.alice.token, "GET", `/warbands/${aliceRoster.warbandId}/warrior-types`)).body;
    for (const [role, xp, maximum] of [["Hero", 50, 90], ["Henchman", 10, 14]]) {
      const type = types.find((item) => item.category === role && item.canGainExperience !== false && item.hireCost != null);
      assert.ok(type, `Missing hireable ${role}`);
      const body = { name: `Existing ${role}`, role, warriorTypeId: type.id, experience: xp };
      const member = await call(users.alice.token, "POST", `/rosters/${free.body.id}/members`, body);
      assert.equal(member.status, 201, JSON.stringify(member.body));
      assert.equal(Number(member.body.experience), xp);
      const updated = await call(users.alice.token, "PATCH", `/members/${member.body.id}`, { experience: maximum });
      assert.equal(updated.status, 200, JSON.stringify(updated.body));
      assert.equal(Number(updated.body.experience), maximum);
      for (const experience of [maximum + 1, -1, 1.5, 2147483648]) {
        assert.equal((await call(users.alice.token, "PATCH", `/members/${member.body.id}`, { experience })).status, 400);
      }
      assert.equal((await call(users.alice.token, "POST", `/rosters/${free.body.id}/members`, { ...body, experience: maximum + 1 })).status, 400);
      assert.equal((await call(users.bob.token, "PATCH", `/members/${member.body.id}`, { experience: 300 })).status, 403);
      const campaignMember = await call(users.alice.token, "POST", `/rosters/${aliceRoster.id}/members`, { name: `Campaign ${role}`, role, warriorTypeId: type.id });
      assert.equal(campaignMember.status, 201, JSON.stringify(campaignMember.body));
      assert.equal((await call(users.alice.token, "PATCH", `/members/${campaignMember.body.id}`, { experience: xp })).status, 409);
      assert.equal((await call(users.alice.token, "POST", `/rosters/${aliceRoster.id}/members`, { ...body, experience: maximum + 1 })).status, 400);
      await db("rosters").where({ id: aliceRoster.id }).update({ campaign_phase: "post_battle", campaign_step: 2 });
      const allocated = await call(users.alice.token, "PATCH", `/members/${campaignMember.body.id}`, { experience: maximum });
      assert.equal(allocated.status, 200, JSON.stringify(allocated.body));
      assert.equal(Number(allocated.body.experience), maximum);
      assert.equal((await call(users.alice.token, "PATCH", `/members/${campaignMember.body.id}`, { experience: maximum + 1 })).status, 400);
      await db("rosters").where({ id: aliceRoster.id }).update({ campaign_step: 3 });
      assert.equal((await call(users.alice.token, "PATCH", `/members/${campaignMember.body.id}`, { experience: xp })).status, 409);
      await db("rosters").where({ id: aliceRoster.id }).update({ campaign_phase: "setup", campaign_step: 1 });
    }
    const reread = await call(users.alice.token, "GET", `/rosters/${free.body.id}`);
    assert.deepEqual(reread.body.members.map((member) => Number(member.experience)).sort((a, b) => a - b), [14, 90]);
  });
});
