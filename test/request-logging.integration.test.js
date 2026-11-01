const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const knex = require("knex");
const { createApp } = require("../src/app");
const db = knex(require("../knexfile")[process.env.NODE_ENV || "development"]);
const records = [];
let server, base, user, token;
async function call(method, path, body, authorization = token) {
  const response = await fetch(`${base}${path}`, { method,
    headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, requestId: response.headers.get("x-request-id") };
}
before(async () => {
  await db.migrate.latest();
  server = createApp(db, { log: (entry) => records.push(entry) }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  if (user) {
    await db("rosters").where({ user_id: user.id }).delete();
    await db("users").where({ id: user.id }).delete();
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.destroy();
});
test("real authentication, roster creation, autosave and logout produce useful safe interaction records", async () => {
  const password = "Logging-fixture-password-123!";
  const username = `logs_${randomUUID().slice(0, 16)}`;
  const registered = await call("POST", "/auth/register", { username, password });
  assert.equal(registered.status, 201);
  user = registered.body.user; token = registered.body.token;
  assert.equal(records.at(-1).interaction, "account.register");
  assert.equal(records.at(-1).userId, user.id);
  const signedIn = await call("POST", "/auth/login", { username, password });
  assert.equal(signedIn.status, 200);
  token = signedIn.body.token;
  assert.equal(records.at(-1).interaction, "account.login");
  assert.equal(records.at(-1).userId, user.id);
  const warband = (await call("GET", "/warbands")).body.find((band) => band.name === "Reikland Mercenaries");
  const roster = await call("POST", "/rosters", { warbandId: warband.id });
  assert.equal(roster.status, 201);
  assert.equal(records.at(-1).rosterId, roster.body.id);
  const types = (await call("GET", `/warbands/${warband.id}/warrior-types`)).body;
  const type = types.find((type) => type.name === "Youngblood");
  const hired = await call("POST", `/rosters/${roster.body.id}/members`, { name: "Private logging fixture", role: "Hero", warriorTypeId: type.id });
  assert.equal(hired.status, 201);
  assert.equal(records.at(-1).interaction, "member.hire");
  assert.equal(records.at(-1).memberId, hired.body.id);
  assert.equal(records.at(-1).rosterId, roster.body.id);
  const patched = await call("PATCH", `/members/${hired.body.id}`, { notes: "Private campaign notes" });
  assert.equal(patched.status, 200);
  assert.equal(records.at(-1).interaction, "members.update");
  assert.deepEqual(records.at(-1).changedFields, ["notes"]);
  assert.equal(records.at(-1).rosterId, roster.body.id);
  assert.equal(records.at(-1).requestId, patched.requestId);
  const read = await call("GET", `/rosters/${roster.body.id}`);
  assert.equal(read.body.members.find((member) => member.id === hired.body.id).notes, "Private campaign notes");
  const denied = await call("GET", `/rosters/${roster.body.id}`, undefined, "invalid-session-secret");
  assert.equal(denied.status, 401);
  assert.equal(records.at(-1).userId, null);
  assert.equal(records.at(-1).outcome, "rejected");
  assert.equal(records.at(-1).rosterId, roster.body.id);
  const logout = await call("POST", "/auth/logout");
  assert.equal(logout.status, 204);
  assert.equal(records.at(-1).interaction, "account.logout");
  assert.equal(records.at(-1).userId, user.id);
  assert.equal(records.at(-1).requestId, logout.requestId);
  assert.doesNotMatch(JSON.stringify(records), /Logging-fixture-password|Private logging fixture|Private campaign notes|invalid-session-secret/);
  assert.ok(!JSON.stringify(records).includes(token));
  assert.ok(!JSON.stringify(records).includes(username));
});
