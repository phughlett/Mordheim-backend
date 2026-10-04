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

  test("players only assign their own warbands to a shared battle", async () => {
    const battle = (await call(users.alice.token, "POST", `/campaigns/${campaign.id}/battles`, { format: "1v1" })).body;
    assert.equal((await call(users.bob.token, "PUT", `/battles/${battle.id}/participants`, { rosterId: aliceRoster.id, team: "A" })).status, 403);
    assert.equal((await call(users.alice.token, "PUT", `/battles/${battle.id}/participants`, { rosterId: aliceRoster.id, team: "A" })).status, 200);
    const result = await call(users.bob.token, "PUT", `/battles/${battle.id}/participants`, { rosterId: bobRoster.id, team: "B" });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.participants.map((entry) => entry.player).sort(), [`alice_${suffix}`, `bob_${suffix}`]);
    assert.equal((await call(users.carol.token, "GET", `/campaigns/${campaign.id}/battles`)).status, 403);
  });
});
