const { after, before, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const knex = require("knex");
const { createApp } = require("../src/app");
const db = knex(require("../knexfile")[process.env.NODE_ENV || "development"]);
let server, base, warband, types;
const users = [];
async function call(method, path, body, user = users[0]) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
async function fixture(campaign = false, tradingRules) {
  let campaignId;
  if (campaign) {
    const created = await call("POST", "/campaigns", { name: "Trading regression", tradingRules });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    campaignId = created.body.id;
  }
  const roster = (await call("POST", "/rosters", { warbandId: warband.id, ...(campaignId ? { campaignId } : {}) })).body;
  const member = (await call("POST", `/rosters/${roster.id}/members`, {
    role: "Hero", warriorTypeId: types.find((type) => type.name === "Youngblood").id, name: "Trader",
  })).body;
  return { roster, member, campaignId };
}
const path = (roster, suffix = "") => `/rosters/${roster.id}/trading${suffix}`;
async function stage(roster, phase, step) { await db("rosters").where({ id: roster.id }).update({ campaign_phase: phase, campaign_step: step }); }
async function buy(roster, itemId, quantity = 1, dice = [], searchId) {
  const quote = await call("POST", path(roster, "/quote"), { itemId, mode: "manual", dice });
  assert.equal(quote.status, 201, JSON.stringify(quote.body));
  return call("POST", path(roster, "/purchase"), { quoteId: quote.body.id, quantity, ...(searchId ? { searchId } : {}) });
}

describe("warband stash and trading", () => {
  before(async () => {
    await db.migrate.latest();
    server = createApp(db).listen(0);
    base = `http://127.0.0.1:${server.address().port}/api`;
    for (const suffix of ["owner", "other"]) {
      const auth = await fetch(`${base}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: `trade_${suffix}_${Date.now()}`, password: "Trading-tests-0420b5d9!" }) });
      assert.equal(auth.status, 201);
      const data = await auth.json();
      users.push({ id: data.user.id, token: data.token });
    }
    warband = (await call("GET", "/warbands")).body.find((row) => row.name === "Mercenaries");
    types = (await call("GET", `/warbands/${warband.id}/warrior-types`)).body;
  });
  after(async () => {
    const ids = users.map((user) => user.id);
    await db("rosters").whereIn("user_id", ids).delete();
    await db("campaigns").whereIn("owner_id", ids).delete();
    await db("users").whereIn("id", ids).delete();
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.destroy();
  });
  test("Freebuild combat spoils are free, persist, and transfer with zero paid cost", async () => {
    const { roster, member } = await fixture();
    await db("rosters").where({ id: roster.id }).update({ treasury: 0 });
    for (const itemId of ["sword", "healing-herbs"]) {
      const added = await call("POST", path(roster, "/spoils"), { itemId, quantity: 2 });
      assert.equal(added.status, 201, JSON.stringify(added.body));
      assert.equal(Number(added.body.treasury), 0);
      const entry = added.body.stash.find((row) => row.shopItemId === itemId);
      assert.equal(entry.quantity, 2);
      assert.equal(entry.unitCostPaid, 0);
    }
    assert.equal(await db("trading_quotes").where({ roster_id: roster.id }).count("* as count").first().then((row) => Number(row.count)), 0);
    assert.equal(await db("trading_searches").where({ roster_id: roster.id }).count("* as count").first().then((row) => Number(row.count)), 0);
    const state = (await call("GET", path(roster))).body;
    const sword = state.stash.find((row) => row.shopItemId === "sword");
    const assigned = await call("POST", path(roster, "/transfer"), {
      direction: "to_member", inventoryId: sword.id, memberId: member.id, quantity: 1, modelIndex: 0,
    });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    const carried = assigned.body.memberInventory.find((row) => row.shopItemId === "sword");
    assert.equal(carried.unitCostPaid, 0);
    const returned = await call("POST", path(roster, "/transfer"), {
      direction: "to_stash", inventoryId: carried.id, memberId: member.id, quantity: 1, modelIndex: 0,
    });
    assert.equal(returned.status, 200, JSON.stringify(returned.body));
    assert.equal(Number(returned.body.treasury), 0);
    assert.equal(returned.body.stash.filter((row) => row.shopItemId === "sword").reduce((total, row) => total + row.quantity, 0), 2);
  });
  test("combat spoils reject campaigns, unavailable items, invalid quantities and non-owners", async () => {
    const { roster } = await fixture();
    for (const quantity of [0, -1, 1001, 1.5, "2"]) {
      assert.equal((await call("POST", path(roster, "/spoils"), { itemId: "sword", quantity })).status, 400);
    }
    assert.equal((await call("POST", path(roster, "/spoils"), {})).status, 400);
    assert.equal((await call("POST", path(roster, "/spoils"), { itemId: "missing" })).status, 404);
    assert.equal((await call("POST", path(roster, "/spoils"), { itemId: "warplock-pistol" })).status, 409);
    assert.equal((await call("POST", path(roster, "/spoils"), { itemId: "sword" }, users[1])).status, 403);
    const campaign = await fixture(true);
    for (const [phase, step] of [["setup", 0], ["battle", 0], ["post_battle", 6]]) {
      await stage(campaign.roster, phase, step);
      assert.equal((await call("POST", path(campaign.roster, "/spoils"), { itemId: "sword" })).status, 409);
    }
    assert.equal((await call("GET", path(roster))).body.stash.length, 0);
    assert.equal((await call("GET", path(campaign.roster))).body.stash.length, 0);
  });
  test("campaign rarity overrides replace item-specific availability exceptions", async () => {
    const { roster, member } = await fixture(true, {
      overrides: { "hunting-rifle": { rarity: 12 } }, customItems: [],
    });
    await stage(roster, "post_battle", 6);
    const found = await call("POST", path(roster, "/search"), {
      heroId: member.id, itemId: "hunting-rifle", mode: "manual", dice: [5, 5],
    });
    assert.equal(found.status, 201, JSON.stringify(found.body));
    assert.equal(found.body.searches[0].success, false);
    const item = found.body.shop.find((row) => row.id === "hunting-rifle");
    assert.equal(item.rarity, 12);
    assert.deepEqual(item.rarityOverrides, []);
  });
  test("a native Undead wizard can carry a shop Tome of Magic", async () => {
    const undead = (await call("GET", "/warbands")).body.find((row) => row.name === "Undead");
    const undeadTypes = (await call("GET", `/warbands/${undead.id}/warrior-types`)).body;
    const created = await call("POST", "/rosters", { warbandId: undead.id });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const roster = created.body;
    const hired = await call("POST", `/rosters/${roster.id}/members`, {
      role: "Hero", warriorTypeId: undeadTypes.find((row) => row.name.startsWith("Necromancer")).id, name: "Book keeper",
    });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    const quote = await call("POST", path(roster, "/quote"), { itemId: "tome-of-magic", mode: "simulated" });
    assert.equal(quote.status, 201, JSON.stringify(quote.body));
    const bought = await call("POST", path(roster, "/purchase"), { quoteId: quote.body.id, quantity: 1 });
    assert.equal(bought.status, 201, JSON.stringify(bought.body));
    const assigned = await call("POST", path(roster, "/transfer"), {
      direction: "to_member", inventoryId: bought.body.stash[0].id, memberId: hired.body.id, quantity: 1, modelIndex: 0,
    });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    assert.ok(assigned.body.memberInventory.some((row) => row.name === "Tome of Magic"));
  });
  test("voluntary Henchman resizing returns shop gear to stash without a purchase refund", async () => {
    const { roster } = await fixture();
    const hired = await call("POST", `/rosters/${roster.id}/members`, {
      role: "Henchman", name: "Resizing traders", groupSize: 2,
      warriorTypeId: types.find((row) => row.name === "Warriors (All Other)").id,
    });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    const bought = await buy(roster, "sword", 2);
    assert.equal(bought.status, 201, JSON.stringify(bought.body));
    const assigned = await call("POST", path(roster, "/transfer"), {
      direction: "to_member", inventoryId: bought.body.stash[0].id,
      memberId: hired.body.id, quantity: 1, modelIndex: -1,
    });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    const balance = Number(assigned.body.treasury);
    const resized = await call("PATCH", `/members/${hired.body.id}`, { groupSize: 1 });
    assert.equal(resized.status, 200, JSON.stringify(resized.body));
    const state = (await call("GET", path(roster))).body;
    assert.equal(Number(state.treasury), balance + 25);
    assert.equal(state.stash.find((row) => row.shopItemId === "sword").quantity, 1);
    assert.equal(state.memberInventory.filter((row) => row.shopItemId === "sword").length, 1);
  });
  test("Freebuild purchases, price dice and transfers persist without altering GC on transfers", async () => {
    const { roster, member } = await fixture();
    const bought = await buy(roster, "pistol");
    assert.equal(bought.status, 201, JSON.stringify(bought.body));
    assert.equal(bought.body.stash[0].name, "Pistol");
    const treasury = bought.body.treasury;
    const moved = await call("POST", path(roster, "/transfer"), { direction: "to_member", inventoryId: bought.body.stash[0].id, memberId: member.id, quantity: 1 });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.stash.length, 0);
    assert.equal(moved.body.treasury, treasury);
    const carried = moved.body.memberInventory.find((row) => row.shopItemId === "pistol");
    const equipment = await call("GET", `/members/${member.id}/equipment`);
    assert.ok(equipment.body.inventory.some((row) => row.name === "Pistol" && row.stats.weapon));
    const returned = await call("POST", path(roster, "/transfer"), { direction: "to_stash", inventoryId: carried.id, memberId: member.id, quantity: 1 });
    assert.equal(returned.status, 200);
    assert.equal(returned.body.stash[0].unitCostPaid, 15);
    assert.equal(returned.body.treasury, treasury);
    const variable = await buy(roster, "healing-herbs", 1, [2, 5]);
    assert.equal(variable.status, 201, JSON.stringify(variable.body));
    assert.equal(variable.body.stash.find((row) => row.shopItemId === "healing-herbs").unitCostPaid, 27);
    assert.equal((await call("GET", path(roster))).body.stash.length, 2);
  });
  test("searches enforce OOA, exact phase, failed attempts, Streetwise and one rare purchase", async () => {
    const { roster, member } = await fixture(true);
    assert.equal((await call("POST", path(roster, "/quote"), { itemId: "pistol", mode: "simulated" })).status, 409);
    await stage(roster, "post_battle", 1);
    assert.equal((await call("POST", path(roster, "/hero-status"), { heroId: member.id, outOfAction: true })).status, 200);
    await stage(roster, "post_battle", 6);
    assert.equal((await call("POST", path(roster, "/search"), { heroId: member.id, itemId: "pistol", mode: "manual", dice: [6, 6] })).status, 409);
    await stage(roster, "post_battle", 1);
    await call("POST", path(roster, "/hero-status"), { heroId: member.id, outOfAction: false });
    await stage(roster, "post_battle", 6);
    const failed = await call("POST", path(roster, "/search"), { heroId: member.id, itemId: "pistol", mode: "manual", dice: [1, 1] });
    assert.equal(failed.status, 201);
    assert.equal(failed.body.searches[0].success, false);
    assert.equal((await call("POST", path(roster, "/search"), { heroId: member.id, itemId: "pistol", mode: "manual", dice: [6, 6] })).status, 409);
    assert.equal((await buy(roster, "pistol")).status, 409);
    await db("rosters").where({ id: roster.id }).update({ battles_fought: 1 });
    const streetwise = await db("skills").where({ name: "Streetwise", warband_id: null }).first("id");
    await db("warrior_skills").insert({ warrior_id: member.id, skill_id: streetwise.id });
    const found = await call("POST", path(roster, "/search"), { heroId: member.id, itemId: "pistol", mode: "manual", dice: [3, 3] });
    assert.equal(found.status, 201);
    assert.equal(found.body.searches[0].total, 8);
    assert.equal(found.body.searches[0].modifier, 2);
    const searchId = found.body.searches[0].id;
    assert.equal((await buy(roster, "pistol", 2, [], searchId)).status, 409);
    assert.equal((await buy(roster, "pistol", 1, [], searchId)).status, 201);
    assert.equal((await buy(roster, "pistol", 1, [], searchId)).status, 409);
  });
  test("duplicate purchases and searches are serialized, quotes cannot be rerolled", async () => {
    const { roster, member } = await fixture(true);
    await stage(roster, "post_battle", 6);
    const outcomes = await Promise.all([1, 2].map(() => call("POST", path(roster, "/search"),
      { heroId: member.id, itemId: "healing-herbs", mode: "manual", dice: [6, 6] })));
    assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), [201, 409]);
    const searchId = outcomes.find((outcome) => outcome.status === 201).body.searches[0].id;
    const q1 = await call("POST", path(roster, "/quote"), { itemId: "healing-herbs", mode: "manual", dice: [1, 1] });
    const q2 = await call("POST", path(roster, "/quote"), { itemId: "healing-herbs", mode: "manual", dice: [6, 6] });
    assert.equal(q1.body.id, q2.body.id);
    assert.equal(q2.body.price, 22);
    const purchases = await Promise.all([1, 2].map(() => call("POST", path(roster, "/purchase"), { quoteId: q1.body.id, quantity: 1, searchId })));
    assert.deepEqual(purchases.map((outcome) => outcome.status).sort(), [201, 409]);
    assert.equal((await call("GET", path(roster))).body.stash.length, 1);
  });
  test("simultaneous transfers cannot duplicate a stash item", async () => {
    const { roster, member } = await fixture();
    const stock = (await buy(roster, "sword")).body.stash[0];
    const before = (await call("GET", path(roster))).body.treasury;
    const transfers = await Promise.all([1, 2].map(() => call("POST", path(roster, "/transfer"), {
      direction: "to_member", inventoryId: stock.id, memberId: member.id, quantity: 1,
    })));
    assert.deepEqual(transfers.map((outcome) => outcome.status).sort(), [200, 404]);
    const after = (await call("GET", path(roster))).body;
    assert.equal(after.stash.length, 0);
    assert.equal(after.memberInventory.filter((row) => row.shopItemId === "sword").length, 1);
    assert.equal(after.treasury, before);
  });
  test("death loses carried equipment without refund while stash survives; battle transfers blocked", async () => {
    const { roster, member } = await fixture(true);
    await stage(roster, "post_battle", 8);
    const bought = await buy(roster, "sword", 2);
    assert.equal(bought.status, 201);
    await stage(roster, "post_battle", 9);
    const moved = await call("POST", path(roster, "/transfer"), { direction: "to_member", inventoryId: bought.body.stash[0].id, memberId: member.id, quantity: 1 });
    assert.equal(moved.status, 200);
    const treasury = moved.body.treasury;
    const item = moved.body.memberInventory.find((row) => row.shopItemId === "sword");
    await stage(roster, "battle", 1);
    assert.equal((await call("POST", path(roster, "/transfer"), { direction: "to_stash", inventoryId: item.id, memberId: member.id })).status, 409);
    await stage(roster, "post_battle", 1);
    assert.equal((await call("DELETE", `/members/${member.id}`)).status, 409);
    const died = await call("POST", `/rosters/${roster.id}/casualties`, { memberId: member.id });
    assert.equal(died.status, 200, JSON.stringify(died.body));
    assert.equal(died.body.stash[0].quantity, 1);
    assert.equal(died.body.memberInventory.length, 0);
    assert.equal(died.body.treasury, treasury);
    assert.equal((await call("POST", `/rosters/${roster.id}/casualties`, { memberId: member.id })).status, 404);
  });
  test("equipment eligibility, Henchman quantities, free gear grants, and cross-owner access", async () => {
    const { roster, member } = await fixture();
    const hired = await call("POST", `/rosters/${roster.id}/members`, { role: "Henchman", name: "Trading group", groupSize: 2,
      warriorTypeId: types.find((type) => type.name === "Warriors (All Other)").id });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    const henchman = hired.body;
    const bought = await buy(roster, "sword", 2);
    assert.ok(bought.body.stash[0].eligibleRecipients.some((recipient) => recipient.memberId === member.id));
    assert.deepEqual(bought.body.stash[0].eligibleRecipients.find((recipient) => recipient.memberId === henchman.id), {
      memberId: henchman.id, allowIndividualGroupGear: false,
    });
    assert.equal((await call("POST", path(roster, "/transfer"), { direction: "to_member", inventoryId: bought.body.stash[0].id, memberId: henchman.id, quantity: 1, modelIndex: 0 })).status, 409);
    const grouped = await call("POST", path(roster, "/transfer"), { direction: "to_member", inventoryId: bought.body.stash[0].id, memberId: henchman.id, quantity: 1, modelIndex: -1 });
    assert.equal(grouped.status, 200, JSON.stringify(grouped.body));
    assert.equal(grouped.body.memberInventory.filter((row) => row.shopItemId === "sword").length, 2);
    assert.ok(grouped.body.memberInventory.filter((row) => row.shopItemId === "sword")
      .every((row) => row.returnModelIndex === -1 && row.returnQuantity === 1));
    const rifle = await buy(roster, "hunting-rifle");
    assert.ok(!rifle.body.stash[0].eligibleRecipients.some((recipient) => recipient.memberId === member.id));
    assert.equal((await call("POST", path(roster, "/transfer"), { direction: "to_member", inventoryId: rifle.body.stash[0].id, memberId: member.id })).status, 409);
    const skill = await db("skills").where({ name: "Weapons Expert", warband_id: null }).first("id");
    await db("warrior_skills").insert({ warrior_id: member.id, skill_id: skill.id });
    const eligibleRifle = (await call("GET", path(roster))).body.stash.find((row) => row.shopItemId === "hunting-rifle");
    assert.ok(eligibleRifle.eligibleRecipients.some((recipient) => recipient.memberId === member.id));
    assert.equal((await call("POST", path(roster, "/transfer"), { direction: "to_member", inventoryId: rifle.body.stash[0].id, memberId: member.id })).status, 200);
    const gear = (await call("GET", path(roster))).body.memberInventory;
    const dagger = gear.find((row) => row.memberId === henchman.id && row.unitCostPaid === 0 && row.modelIndex === 0);
    assert.equal((await call("POST", path(roster, "/transfer"), { direction: "to_stash", inventoryId: dagger.id, memberId: henchman.id })).status, 200);
    const repurchased = await call("POST", `/members/${henchman.id}/equipment`, { equipmentOptionId: dagger.equipmentOptionId, quantity: 1, modelIndex: -1 });
    assert.equal(repurchased.status, 201, JSON.stringify(repurchased.body));
    assert.equal(repurchased.body.purchaseCost, 4);
    const movedAgain = (await call("GET", path(roster))).body.memberInventory.find((row) => row.memberId === henchman.id && row.equipmentOptionId === dagger.equipmentOptionId);
    assert.equal((await call("POST", path(roster, "/transfer"), { direction: "to_stash", inventoryId: movedAgain.id, memberId: henchman.id })).status, 200);
    assert.equal((await call("PATCH", `/members/${henchman.id}`, { groupSize: 3 })).status, 200);
    assert.equal((await call("GET", path(roster))).body.memberInventory.filter((row) => row.memberId === henchman.id && row.name === "Dagger" && row.modelIndex === 0).length, 0);
    assert.equal((await call("GET", path(roster), undefined, users[1])).status, 403);
    assert.equal((await call("POST", path(roster, "/quote"), { itemId: "sword", mode: "simulated" }, users[1])).status, 403);
    const another = await fixture();
    const old = (await call("GET", path(roster))).body.stash[0];
    assert.equal((await call("POST", path(another.roster, "/transfer"), { direction: "to_member", inventoryId: old.id, memberId: another.member.id })).status, 404);
  });
  test("campaign overrides and restricted custom items persist and reject unavailable purchases", async () => {
    const custom = { id: "custom-token", name: "Trader token", description: "A campaign token.", baseCost: 7, rarity: null,
      category: "misc", heroOnly: true, requiredSkill: "Streetwise", allowedWarbands: ["Mercenaries"] };
    const { roster, member, campaignId } = await fixture(true, { overrides: { sword: { disabled: true }, pistol: { baseCost: 2, rarity: null } }, customItems: [custom] });
    await stage(roster, "post_battle", 8);
    assert.equal((await call("POST", path(roster, "/quote"), { itemId: "sword", mode: "simulated" })).status, 409);
    assert.equal((await buy(roster, "pistol")).body.stash[0].unitCostPaid, 2);
    const itemId = `${campaignId}/${custom.id}`;
    const token = await buy(roster, itemId);
    assert.equal(token.status, 201, JSON.stringify(token.body));
    await stage(roster, "post_battle", 9);
    const stock = token.body.stash.find((row) => row.shopItemId === itemId);
    assert.deepEqual(stock.eligibleRecipients, []);
    assert.equal((await call("POST", path(roster, "/transfer"), { direction: "to_member", inventoryId: stock.id, memberId: member.id })).status, 409);
    const skill = await db("skills").where({ name: "Streetwise", warband_id: null }).first("id");
    await db("warrior_skills").insert({ warrior_id: member.id, skill_id: skill.id });
    const eligibleToken = (await call("GET", path(roster))).body.stash.find((row) => row.shopItemId === itemId);
    assert.ok(eligibleToken.eligibleRecipients.some((recipient) => recipient.memberId === member.id));
    assert.equal((await call("POST", path(roster, "/transfer"), { direction: "to_member", inventoryId: stock.id, memberId: member.id })).status, 200);
    assert.equal((await call("GET", `/campaigns/${campaignId}`)).body.tradingRules.customItems[0].requiredSkill, "Streetwise");
  });
  test("invalid dice and insufficient funds do not create stock or consume quotes/searches", async () => {
    const { roster, member } = await fixture(true);
    await stage(roster, "post_battle", 6);
    const invalid = await call("POST", path(roster, "/search"), { heroId: member.id, itemId: "healing-herbs", mode: "manual", dice: [7, 1] });
    assert.equal(invalid.status, 400);
    assert.equal((await call("GET", path(roster))).body.searches.length, 0);
    const valid = await call("POST", path(roster, "/search"), { heroId: member.id, itemId: "healing-herbs", mode: "manual", dice: [6, 6] });
    const searchId = valid.body.searches[0].id;
    assert.equal((await call("POST", path(roster, "/quote"), { itemId: "healing-herbs", mode: "manual", dice: [1] })).status, 400);
    const quote = await call("POST", path(roster, "/quote"), { itemId: "healing-herbs", mode: "manual", dice: [6, 6] });
    await db("rosters").where({ id: roster.id }).update({ treasury: 5 });
    const poor = await call("POST", path(roster, "/purchase"), { quoteId: quote.body.id, quantity: 1, searchId });
    assert.equal(poor.status, 409);
    const after = (await call("GET", path(roster))).body;
    assert.equal(after.stash.length, 0);
    assert.equal(after.treasury, "5");
    assert.equal(after.searches[0].purchased, false);
    await db("rosters").where({ id: roster.id }).update({ treasury: 100 });
    assert.equal((await call("POST", path(roster, "/purchase"), { quoteId: quote.body.id, quantity: 1, searchId })).status, 201);
  });
  test("a Henchman casualty removes exactly that model's stock and preserves the other models", async () => {
    const { roster } = await fixture(true);
    const hired = await call("POST", `/rosters/${roster.id}/members`, { role: "Henchman", name: "Casualty group", groupSize: 3,
      warriorTypeId: types.find((type) => type.name === "Warriors (All Other)").id });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    const group = hired.body;
    await stage(roster, "post_battle", 8);
    const bought = await buy(roster, "sword", 4);
    await stage(roster, "post_battle", 9);
    const geared = await call("POST", path(roster, "/transfer"), { direction: "to_member", inventoryId: bought.body.stash[0].id, memberId: group.id, modelIndex: -1 });
    assert.equal(geared.status, 200, JSON.stringify(geared.body));
    await stage(roster, "post_battle", 1);
    const died = await call("POST", `/rosters/${roster.id}/casualties`, { memberId: group.id, modelIndex: 1 });
    assert.equal(died.status, 200, JSON.stringify(died.body));
    const stock = died.body.memberInventory.filter((item) => item.memberId === group.id && item.shopItemId === "sword");
    assert.deepEqual(stock.map((item) => item.modelIndex).sort(), [0, 1]);
    assert.equal(died.body.stash[0].quantity, 1);
    assert.equal(died.body.treasury, geared.body.treasury);
    assert.equal((await call("GET", `/rosters/${roster.id}`)).body.members.find((member) => member.id === group.id).groupSize, 2);
  });
});
