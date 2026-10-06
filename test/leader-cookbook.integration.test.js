const { after, before, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const knex = require("knex");
const { createApp } = require("../src/app");
const db = knex(require("../knexfile")[process.env.NODE_ENV || "development"]);
let server, base, user, token, warband, types;

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
async function hire(roster, name, typeName, role = "Hero", groupSize = 1) {
  const response = await call("POST", `/rosters/${roster.id}/members`, {
    name, role, groupSize, warriorTypeId: types.find((type) => type.name === typeName).id,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}
async function fixture(campaign = false) {
  const campaignId = campaign ? (await call("POST", "/campaigns", { name: "Leader casualties" })).body.id : undefined;
  const response = await call("POST", "/rosters", { warbandId: warband.id, treasury: 10000, campaignId, ...(!campaign ? { battlesFought: 1 } : {}) });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const roster = response.body;
  const captain = await hire(roster, "Captain", "Mercenary Captain");
  const champion = await hire(roster, "Successor", "Champions (Mercenaries & Amazons)");
  return { roster, captain, champion };
}
const read = async (roster) => (await call("GET", `/rosters/${roster.id}`)).body;
const trading = (roster, suffix = "") => `/rosters/${roster.id}/trading${suffix}`;
async function buyCookbook(roster, quantity = 1) {
  let searchId;
  if (roster.campaignId) {
    await stage(roster, 6);
    const leaderId = (await read(roster)).capacity.leader.id;
    const searched = await call("POST", trading(roster, "/search"), {
      heroId: leaderId, itemId: "halfling-cookbook", mode: "manual", dice: [6, 6],
    });
    assert.equal(searched.status, 201, JSON.stringify(searched.body));
    searchId = searched.body.searches.find((search) => search.heroId === leaderId && search.success && !search.purchased).id;
    await stage(roster, 8);
  }
  const quoted = await call("POST", trading(roster, "/quote"), { itemId: "halfling-cookbook", mode: "manual", dice: [1, 1, 1] });
  assert.equal(quoted.status, 201, JSON.stringify(quoted.body));
  const bought = await call("POST", trading(roster, "/purchase"), { quoteId: quoted.body.id, quantity, searchId });
  assert.equal(bought.status, 201, JSON.stringify(bought.body));
  return bought.body.stash.find((entry) => entry.shopItemId === "halfling-cookbook");
}
async function move(roster, direction, entry, member, quantity = 1) {
  const response = await call("POST", trading(roster, "/transfer"), {
    direction, inventoryId: entry.id, memberId: member.id, quantity, modelIndex: 0,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}
const hasLeaderSkill = async (member) => (await call("GET", `/members/${member.id}/skills`)).body.learnedSkills.some((skill) => skill.isLeaderAbility);
const stage = (roster, step) => db("rosters").where({ id: roster.id }).update({ campaign_phase: "post_battle", campaign_step: step });

describe("leader inventory drives cookbook capacity", () => {
  before(async () => {
    await db.migrate.latest();
    server = createApp(db).listen(0);
    base = `http://127.0.0.1:${server.address().port}/api`;
    const auth = await call("POST", "/auth/register", { username: `leader_${Date.now()}`, password: "Leader-tests-0420b5d9!" });
    user = auth.body.user;
    token = auth.body.token;
    warband = (await call("GET", "/warbands")).body.find((row) => row.name === "Reikland Mercenaries");
    types = (await call("GET", `/warbands/${warband.id}/warrior-types`)).body;
  });
  after(async () => {
    if (user) {
      await db("rosters").where({ user_id: user.id }).delete();
      await db("campaigns").where({ owner_id: user.id }).delete();
      await db("users").where({ id: user.id }).delete();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.destroy();
  });

  test("stash and other Hero copies give no bonus; the leader gives exactly one slot", async () => {
    const { roster, captain, champion } = await fixture();
    const stock = await buyCookbook(roster, 2);
    assert.match(stock.description, /only while carried by its current leader/);
    assert.equal((await read(roster)).capacity.itemBonus, 0);
    let moved = await move(roster, "to_member", stock, champion, 2);
    assert.equal((await read(roster)).capacity.itemBonus, 0);
    moved = await move(roster, "to_stash", moved.memberInventory.find((row) => row.shopItemId === "halfling-cookbook"), champion, 2);
    moved = await move(roster, "to_member", moved.stash.find((row) => row.shopItemId === "halfling-cookbook"), captain, 2);
    const extended = await read(roster);
    assert.deepEqual(extended.capacity.leader, { id: captain.id, name: "Captain" });
    assert.equal(extended.capacity.itemBonus, 1);
    assert.equal(extended.capacity.maxMembers, 16);
    await move(roster, "to_stash", moved.memberInventory.find((row) => row.shopItemId === "halfling-cookbook"), captain, 2);
    const returned = await read(roster);
    assert.equal(returned.capacity.maxMembers, 15);
    assert.equal(returned.treasury, extended.treasury);
  });

  test("leader bonus permits the sixteenth warrior and losing it blocks further recruitment", async () => {
    const { roster, captain } = await fixture();
    for (const size of [5, 5, 3]) await hire(roster, "Warriors", "Warriors (All Other)", "Henchman", size);
    const stock = await buyCookbook(roster);
    const moved = await move(roster, "to_member", stock, captain);
    await hire(roster, "Bonus warrior", "Warriors (All Other)", "Henchman");
    assert.equal((await read(roster)).capacity.currentMembers, 16);
    const extra = await call("POST", `/rosters/${roster.id}/members`, {
      name: "Over limit", role: "Henchman", warriorTypeId: types.find((type) => type.name === "Warriors (All Other)").id,
    });
    assert.equal(extra.status, 409);
    await move(roster, "to_stash", moved.memberInventory.find((row) => row.shopItemId === "halfling-cookbook"), captain);
    const over = await read(roster);
    assert.equal(over.capacity.currentMembers, 16);
    assert.equal(over.capacity.maxMembers, 15);
    assert.equal((await call("POST", `/rosters/${roster.id}/members`, {
      name: "Still over limit", role: "Henchman", warriorTypeId: types.find((type) => type.name === "Warriors (All Other)").id,
    })).status, 409);
  });

  test("leadership changes reassign the temporary skill and item bonus; native leader still takes priority", async () => {
    const { roster, captain, champion } = await fixture();
    const youngblood = await hire(roster, "Other successor", "Youngblood");
    await db("warriors").where({ id: champion.id }).update({ stats: db.raw("jsonb_set(stats, '{Ld}', '9')") });
    assert.equal((await read(roster)).capacity.leader.id, captain.id);
    assert.equal(await hasLeaderSkill(captain), true);
    assert.equal(await hasLeaderSkill(champion), false);
    await call("DELETE", `/members/${captain.id}`);
    assert.equal((await read(roster)).capacity.leader.id, champion.id);
    assert.equal(await hasLeaderSkill(champion), true);
    const moved = await move(roster, "to_member", await buyCookbook(roster), champion);
    assert.equal((await read(roster)).capacity.itemBonus, 1);
    await db("warriors").where({ id: youngblood.id }).update({ stats: db.raw("jsonb_set(stats, '{Ld}', '10')") });
    assert.equal((await read(roster)).capacity.leader.id, youngblood.id);
    assert.equal(await hasLeaderSkill(champion), false);
    assert.equal(await hasLeaderSkill(youngblood), true);
    assert.equal((await read(roster)).capacity.itemBonus, 0);
    assert.ok(moved.memberInventory.some((row) => row.memberId === champion.id && row.shopItemId === "halfling-cookbook"));
    const newCaptain = await hire(roster, "New Captain", "Mercenary Captain");
    assert.equal((await read(roster)).capacity.leader.id, newCaptain.id);
    assert.equal(await hasLeaderSkill(youngblood), false);
    assert.equal(await hasLeaderSkill(newCaptain), true);
  });

  test("leader death destroys the cookbook; the successor needs a purchased replacement", async () => {
    const { roster, captain, champion } = await fixture(true);
    await stage(roster, 8);
    const stock = await buyCookbook(roster);
    await stage(roster, 9);
    await move(roster, "to_member", stock, captain);
    const equipped = await read(roster);
    assert.equal(equipped.capacity.itemBonus, 1);
    await stage(roster, 1);
    const death = await call("POST", `/rosters/${roster.id}/casualties`, { memberId: captain.id, modelIndex: 0 });
    assert.equal(death.status, 200, JSON.stringify(death.body));
    assert.ok(!death.body.stash.some((row) => row.shopItemId === "halfling-cookbook"));
    assert.ok(!death.body.memberInventory.some((row) => row.shopItemId === "halfling-cookbook"));
    const bereaved = await read(roster);
    assert.equal(bereaved.capacity.leader.id, champion.id);
    assert.equal(bereaved.capacity.itemBonus, 0);
    assert.equal(bereaved.treasury, equipped.treasury);
    assert.equal(await hasLeaderSkill(champion), true);
    await stage(roster, 8);
    const replacement = await buyCookbook(roster);
    assert.equal((await read(roster)).capacity.itemBonus, 0);
    await stage(roster, 9);
    await move(roster, "to_member", replacement, champion);
    const restored = await read(roster);
    assert.equal(restored.capacity.itemBonus, 1);
    assert.equal(Number(restored.treasury), Number(bereaved.treasury) - 33);
  });

  test("old selected modifiers cannot grant a slot and excluded warbands never get the bonus", async () => {
    const { roster } = await fixture();
    const modifier = await db("capacity_modifiers").where({ modifier_key: "halfling-cookbook" }).first();
    await db("roster_capacity_modifiers").insert({ roster_id: roster.id, capacity_modifier_id: modifier.id });
    assert.equal((await read(roster)).capacity.itemBonus, 0);
    assert.equal((await call("PUT", `/rosters/${roster.id}/capacity-modifiers`, { modifierIds: [modifier.id] })).status, 409);
    const undead = (await call("GET", "/warbands")).body.find((row) => row.name === "Undead");
    const undeadTypes = (await call("GET", `/warbands/${undead.id}/warrior-types`)).body;
    const created = (await call("POST", "/rosters", { warbandId: undead.id })).body;
    const vampire = (await call("POST", `/rosters/${created.id}/members`, {
      name: "Vampire", role: "Hero", warriorTypeId: undeadTypes.find((row) => row.name === "Vampire").id,
    })).body;
    await db("warrior_inventory").insert({ warrior_id: vampire.id, shop_item_id: "halfling-cookbook", model_index: 0, quantity: 1, unit_cost_paid: 33 });
    assert.equal((await read(created)).capacity.itemBonus, 0);
    assert.equal(await hasLeaderSkill(vampire), true);
  });
});
