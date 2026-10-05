const { after, before, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const knex = require("knex");
const knexConfig = require("../knexfile");
const { createApp } = require("../src/app");

const db = knex(knexConfig[process.env.NODE_ENV || "development"] || knexConfig.development);
const users = [];
let server;
let base;
let campaign;
let warband;
let types;

async function call(method, path, body, user = users[0]) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function createRoster(campaignMode = false, treasury = 500) {
  const result = await call("POST", "/rosters", {
    warbandId: warband.id, treasury, ...(campaignMode ? { campaignId: campaign.id } : {}),
  });
  assert.equal(result.status, 201);
  return result.body;
}

function hire(roster, name, mutationIds) {
  return call("POST", `/rosters/${roster.id}/members`, {
    name, role: "Hero", warriorTypeId: types.find((type) => type.name === name).id,
    ...(mutationIds === undefined ? {} : { mutationIds }),
  });
}

describe("mutation special equipment", () => {
  before(async () => {
    await db.migrate.latest();
    server = createApp(db).listen(0);
    base = `http://127.0.0.1:${server.address().port}/api`;
    for (const name of ["owner", "viewer"]) {
      const response = await fetch(`${base}/auth/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: `mutation_${name}_${Date.now()}`, password: "Mutation-test-123!" }),
      });
      assert.equal(response.status, 201);
      const auth = await response.json();
      users.push({ id: auth.user.id, token: auth.token });
    }
    warband = (await call("GET", "/warbands")).body.find((item) => item.name === "Cult of the Possessed");
    types = (await call("GET", `/warbands/${warband.id}/warrior-types`)).body;
    campaign = (await call("POST", "/campaigns", { name: "Mutation tests" })).body;
  });

  after(async () => {
    const ids = users.map((user) => user.id);
    await db("rosters").whereIn("user_id", ids).delete();
    await db("campaigns").whereIn("owner_id", ids).delete();
    await db("users").whereIn("id", ids).delete();
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.destroy();
  });

  test("campaign Mutants require mutations and recruitment persists the combined cost atomically", async () => {
    const roster = await createRoster(true);
    assert.equal(types.find((type) => type.name === "Mutants").mutationRequired, true);
    assert.equal(types.find((type) => type.name === "Mutants").mutationOptions.length, 9);
    assert.equal(types.find((type) => type.name === "Magister").mutationOptions.length, 0);
    for (const ids of [undefined, [], null, ["unknown"], "daemon-soul"]) assert.equal((await hire(roster, "Mutants", ids)).status, 400);
    const member = await hire(roster, "Mutants", ["daemon-soul", "great-claw", "extra-arm"]);
    assert.equal(member.status, 201, JSON.stringify(member.body));
    const reread = (await call("GET", `/rosters/${roster.id}`)).body;
    assert.equal(reread.members.length, 1);
    assert.equal(Number(reread.treasury), 275);
    const equipment = (await call("GET", `/members/${member.body.id}/equipment`)).body;
    assert.equal(equipment.mutations.canEdit, false);
    assert.deepEqual(equipment.mutations.entries.map((entry) => [entry.mutationId, entry.unitCostPaid]), [
      ["daemon-soul", 20], ["great-claw", 100], ["extra-arm", 80],
    ]);
    assert.ok(equipment.mutations.entries.every((entry) => entry.effectText));
    assert.equal(equipment.mutations.totalCost, 200);
    assert.equal((await call("PUT", `/members/${member.body.id}/mutations`, { mutationIds: ["hideous"] })).status, 409);
    const mutationId = equipment.mutations.entries[0].id;
    assert.equal((await call("DELETE", `/members/${member.body.id}/equipment/${mutationId}`)).status, 404);
    assert.equal((await call("DELETE", `/members/${member.body.id}/equipment`, { inventoryItemIds: [mutationId] })).status, 404);
    assert.equal((await call("POST", `/members/${member.body.id}/equipment`, { equipmentOptionId: mutationId })).status, 400);
    assert.equal((await call("GET", `/members/${member.body.id}/equipment`)).body.mutations.totalCost, 200);
  });

  test("Possessed mutations are optional and other types cannot buy mutations", async () => {
    const roster = await createRoster(true);
    const possessed = await hire(roster, "The Possessed");
    assert.equal(possessed.status, 201);
    assert.equal(Number((await call("GET", `/rosters/${roster.id}`)).body.treasury), 410);
    assert.equal((await call("GET", `/members/${possessed.body.id}/equipment`)).body.mutations.entries.length, 0);
    assert.equal((await hire(roster, "Magister", ["daemon-soul"])).status, 400);
    const repeated = await hire(roster, "The Possessed", ["great-claw", "great-claw"]);
    assert.equal(repeated.status, 201);
    assert.equal(Number((await call("GET", `/rosters/${roster.id}`)).body.treasury), 170);
  });

  test("insufficient recruitment gold leaves no warrior, inventory, or treasury change", async () => {
    const roster = await createRoster(false, 44);
    assert.equal((await hire(roster, "Mutants", ["daemon-soul"])).status, 409);
    const reread = (await call("GET", `/rosters/${roster.id}`)).body;
    assert.equal(reread.members.length, 0);
    assert.equal(Number(reread.treasury), 44);
  });

  test("Freebuild edits charge and refund differences without charging repeated requests twice", async () => {
    const roster = await createRoster();
    const member = await hire(roster, "Mutants");
    assert.equal(member.status, 201);
    const path = `/members/${member.body.id}/mutations`;
    const save = (mutationIds) => call("PUT", path, { mutationIds });
    assert.equal((await save(["daemon-soul", "great-claw"])).status, 200);
    assert.equal(Number((await call("GET", `/rosters/${roster.id}`)).body.treasury), 355);
    assert.ok((await Promise.all([save(["daemon-soul", "great-claw"]), save(["daemon-soul", "great-claw"])]))
      .every((result) => result.status === 200));
    assert.equal(Number((await call("GET", `/rosters/${roster.id}`)).body.treasury), 355);
    assert.equal((await save(["great-claw"])).status, 200);
    assert.equal(Number((await call("GET", `/rosters/${roster.id}`)).body.treasury), 425);
    assert.equal((await save([])).status, 200);
    assert.equal(Number((await call("GET", `/rosters/${roster.id}`)).body.treasury), 475);
    const equipment = (await call("GET", `/members/${member.body.id}/equipment`)).body;
    assert.equal(equipment.mutations.required, true);
    assert.equal(equipment.mutations.canEdit, true);
    assert.equal(equipment.mutations.entries.length, 0);
    for (const ids of [null, [123], ["invalid"]]) assert.equal((await save(ids)).status, 400);
    const magister = await hire(roster, "Magister");
    assert.equal(magister.status, 201);
    assert.equal((await call("PUT", `/members/${magister.body.id}/mutations`, { mutationIds: ["daemon-soul"] })).status, 400);
  });

  test("Freebuild mutations check affordability and ownership; recipients see the special equipment", async () => {
    const roster = await createRoster(false, 45);
    const member = await hire(roster, "Mutants", ["daemon-soul"]);
    assert.equal(member.status, 201);
    const path = `/members/${member.body.id}`;
    assert.equal((await call("PUT", `${path}/mutations`, { mutationIds: ["daemon-soul", "hideous"] })).status, 409);
    assert.equal((await call("GET", `${path}/equipment`)).body.mutations.totalCost, 20);
    assert.equal(Number((await call("GET", `/rosters/${roster.id}`)).body.treasury), 0);
    const shared = (await call("POST", `/rosters/${roster.id}/share`)).body;
    assert.equal((await call("POST", "/shared-rosters/join", { code: shared.shareCode }, users[1])).status, 200);
    assert.equal((await call("GET", `${path}/equipment`, undefined, users[1])).body.mutations.entries[0].name, "Daemon soul");
    assert.equal((await call("PUT", `${path}/mutations`, { mutationIds: [] }, users[1])).status, 403);
    assert.equal((await call("DELETE", path)).status, 204);
    assert.equal(await db("warrior_mutations").where({ warrior_id: member.body.id }).first(), undefined);
    assert.equal(Number((await call("GET", `/rosters/${roster.id}`)).body.treasury), 25);
  });
});
