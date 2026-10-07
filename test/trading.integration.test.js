const { after, before, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const knex = require("knex");
const { createApp } = require("../src/app");
const db = knex(require("../knexfile")[process.env.NODE_ENV || "development"]);
let server, base, warband, types;
const users = [];
const temporaryWarbands = [];
const temporaryEquipmentLists = [];
async function call(method, path, body, user = users[0]) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
async function fixture(campaign = false, tradingRules, warbandName = "Mercenaries", heroTypeName = "Youngblood") {
  let campaignId;
  if (campaign) {
    const created = await call("POST", "/campaigns", { name: "Trading regression", tradingRules });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    campaignId = created.body.id;
  }
  const selectedBand = warbandName === "Mercenaries" ? warband : (await call("GET", "/warbands")).body.find((row) => row.name === warbandName);
  const selectedTypes = warbandName === "Mercenaries" ? types : (await call("GET", `/warbands/${selectedBand.id}/warrior-types`)).body;
  const created = await call("POST", "/rosters", { warbandId: selectedBand.id, ...(campaignId ? { campaignId } : { battlesFought: 1 }) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const roster = created.body;
  const selectedType = selectedTypes.find((type) => type.name === heroTypeName);
  assert.ok(selectedType, `${warbandName}: ${heroTypeName}`);
  const member = (await call("POST", `/rosters/${roster.id}/members`, {
    role: "Hero", warriorTypeId: selectedType.id, name: "Trader",
  })).body;
  assert.ok(member.id, JSON.stringify(member));
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
    warband = (await call("GET", "/warbands")).body.find((row) => row.name === "Reikland Mercenaries");
    types = (await call("GET", `/warbands/${warband.id}/warrior-types`)).body;
  });
  after(async () => {
    const ids = users.map((user) => user.id);
    const upgradeIds = await db("warrior_inventory as inventory").join("warriors as warrior", "warrior.id", "inventory.warrior_id")
      .join("rosters as roster", "roster.id", "warrior.roster_id").whereIn("roster.user_id", ids).pluck("inventory.shop_item_id");
    await db("rosters").whereIn("user_id", ids).delete();
    await db("campaigns").whereIn("owner_id", ids).delete();
    await db("users").whereIn("id", ids).delete();
    await db("warbands").whereIn("id", temporaryWarbands).delete();
    for (const list of temporaryEquipmentLists) await db("equipment_lists").where(list).delete();
    await db("shop_items").whereIn("id", upgradeIds.filter((id) => id?.startsWith("upgrade/"))).delete();
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.destroy();
  });
  test("map purchases record separate D6 results, persist through transfers, and reject invalid choices atomically", async () => {
    const { roster, member } = await fixture();
    const quote = await call("POST", path(roster, "/quote"), { itemId: "mordheim-map", mode: "manual", dice: [1, 1, 1, 1] });
    assert.equal(quote.status, 201);
    const purchase = { quoteId: quote.body.id, quantity: 2 };
    const before = (await call("GET", path(roster))).body;
    for (const mapSelection of [undefined, { mode: "choose", type: "unknown" }, { mode: "manual", dice: [6] }]) {
      assert.equal((await call("POST", path(roster, "/purchase"), { ...purchase, mapSelection })).status, 400);
      const unchanged = (await call("GET", path(roster))).body;
      assert.equal(unchanged.treasury, before.treasury);
      assert.deepEqual(unchanged.stash, before.stash);
    }
    const bought = await call("POST", path(roster, "/purchase"), { ...purchase, mapSelection: { mode: "manual", dice: [2, 6] } });
    assert.equal(bought.status, 201, JSON.stringify(bought.body));
    assert.equal(Number(bought.body.treasury), Number(before.treasury) - quote.body.price * 2);
    const maps = bought.body.stash.filter((entry) => entry.shopItemId === "mordheim-map");
    assert.equal(maps.length, 2);
    assert.deepEqual(maps.map((entry) => entry.mapResult.type).sort(), ["master", "vague"]);
    const master = maps.find((entry) => entry.mapResult.type === "master");
    const sent = await call("POST", path(roster, "/transfer"), {
      direction: "to_member", inventoryId: master.id, memberId: member.id, quantity: 1, modelIndex: 0,
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const carried = sent.body.memberInventory.find((entry) => entry.shopItemId === "mordheim-map");
    assert.deepEqual(carried.mapResult, master.mapResult);
    const equipment = (await call("GET", `/members/${member.id}/equipment`)).body.inventory.find((entry) => entry.id === carried.id);
    assert.equal(equipment.name, "Mordheim Map (Master map)");
    assert.match(equipment.description, /Hero.*not taken out of action/);
    const returned = await call("POST", path(roster, "/transfer"), {
      direction: "to_stash", inventoryId: carried.id, memberId: member.id, quantity: 1, modelIndex: 0,
    });
    assert.equal(returned.status, 200);
    assert.deepEqual(returned.body.stash.find((entry) => entry.mapResult?.type === "master").mapResult, master.mapResult);
  });
  test("map spoils support all manual types and simulated results; legacy stacks resolve one copy only", async () => {
    const { roster, member } = await fixture();
    for (const type of ["fake", "vague", "catacomb", "accurate", "master"]) {
      const added = await call("POST", path(roster, "/spoils"), { itemId: "mordheim-map", mapSelection: { mode: "choose", type } });
      assert.equal(added.status, 201, JSON.stringify(added.body));
      assert.ok(added.body.stash.some((entry) => entry.mapResult?.type === type && entry.mapResult.roll === null));
    }
    const simulated = await call("POST", path(roster, "/spoils"), { itemId: "mordheim-map", quantity: 3, mapSelection: { mode: "simulated" } });
    assert.equal(simulated.status, 201);
    assert.equal(simulated.body.stash.filter((entry) => entry.mapResult?.mode === "simulated").length, 3);
    const [legacy] = await db("warband_stash").insert({ roster_id: roster.id, shop_item_id: "mordheim-map", quantity: 2, unit_cost_paid: 24 }).returning("*");
    const resolved = await call("POST", path(roster, "/map"), { source: "stash", inventoryId: legacy.id, mapSelection: { mode: "manual", dice: [4] } });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    assert.equal(resolved.body.stash.find((entry) => entry.id === legacy.id).quantity, 1);
    const catacomb = resolved.body.stash.find((entry) => entry.mapResult?.roll === 4);
    assert.equal(catacomb.mapResult.type, "catacomb");
    assert.equal((await call("POST", path(roster, "/map"), { source: "stash", inventoryId: catacomb.id, mapSelection: { mode: "simulated" } })).status, 409);
    assert.equal((await call("POST", path(roster, "/map"), { source: "stash", inventoryId: legacy.id, mapSelection: { mode: "simulated" } }, users[1])).status, 403);
    const [carried] = await db("warrior_inventory").insert({ warrior_id: member.id, shop_item_id: "mordheim-map", quantity: 1, model_index: 0, unit_cost_paid: 24 }).returning("*");
    const recorded = await call("POST", path(roster, "/map"), { source: "member", inventoryId: carried.id, mapSelection: { mode: "choose", type: "accurate" } });
    assert.equal(recorded.status, 200);
    assert.equal(recorded.body.memberInventory.find((entry) => entry.id === carried.id).mapResult.type, "accurate");
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
  test("battle counts persist, validate, switch Freebuild shops, and cannot override campaigns", async () => {
    const { roster, member } = await fixture();
    assert.equal(roster.battlesFought, 1);
    assert.equal((await call("PATCH", `/rosters/${roster.id}`, { battlesFought: 0 })).status, 200);
    const equipment = (await call("GET", `/members/${member.id}/equipment`)).body;
    const axe = equipment.availableOptions.find((option) => option.name === "Axe");
    assert.ok(axe);
    const initial = (await call("GET", path(roster))).body;
    assert.equal(initial.canPurchase, false);
    assert.equal(initial.canSell, false);
    assert.ok(initial.shop.every((item) => item.canPurchase === false));
    assert.equal((await call("POST", path(roster, "/quote"), { itemId: "axe", mode: "simulated" })).status, 409);
    assert.equal((await call("POST", path(roster, "/spoils"), { itemId: "axe" })).status, 409);
    const bought = await call("POST", `/members/${member.id}/equipment`, { equipmentOptionId: axe.id });
    assert.equal(bought.status, 201, JSON.stringify(bought.body));
    const entry = bought.body.inventory.find((item) => item.equipmentOptionId === axe.id);
    const refunded = await call("DELETE", `/members/${member.id}/equipment/${entry.id}`);
    assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
    assert.equal(refunded.body.refundAmount, axe.unitCost);
    for (const battlesFought of [-1, 1.5, null, true, "", "abc", 2147483648]) {
      assert.equal((await call("PATCH", `/rosters/${roster.id}`, { battlesFought })).status, 400, JSON.stringify(battlesFought));
    }
    const updated = await call("PATCH", `/rosters/${roster.id}`, { battlesFought: 1 });
    assert.equal(updated.body.battlesFought, 1);
    assert.equal((await call("GET", `/rosters/${roster.id}`)).body.battlesFought, 1);
    assert.deepEqual((await call("GET", `/members/${member.id}/equipment`)).body.availableOptions, []);
    assert.equal((await call("POST", `/members/${member.id}/equipment`, { equipmentOptionId: axe.id })).status, 409);
    assert.equal((await call("POST", `/members/${member.id}/spells/tomes`, {})).status, 409);
    assert.equal((await buy(roster, "axe")).status, 201);
    const campaign = await fixture(true);
    assert.equal((await call("PATCH", `/rosters/${campaign.roster.id}`, { battlesFought: 99 })).status, 409);
    assert.equal((await call("POST", "/rosters", { campaignId: campaign.campaignId, warbandId: warband.id, battlesFought: 1 })).status, 409);
  });
  test("stash sales use half the base price for fixed, variable and free spoils and are atomic", async () => {
    const { roster } = await fixture();
    const bought = await buy(roster, "axe", 3);
    const axe = bought.body.stash.find((item) => item.shopItemId === "axe");
    assert.equal(axe.unitSaleValue, 2);
    const treasury = Number(bought.body.treasury);
    const sell = (inventoryIds, quantity, user) => call("POST", path(roster, "/sell"), { source: "stash", inventoryIds, quantity }, user);
    assert.equal((await sell([axe.id], 4)).status, 400);
    assert.equal((await sell([axe.id, axe.id], 1)).status, 400);
    assert.equal((await sell([axe.id], 1, users[1])).status, 403);
    assert.equal(Number((await call("GET", path(roster))).body.treasury), treasury);
    const sold = await sell([axe.id], 2);
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
    assert.equal(sold.body.saleAmount, 4);
    assert.equal(Number(sold.body.treasury), treasury + 4);
    assert.equal(sold.body.stash.find((item) => item.id === axe.id).quantity, 1);
    const rare = await buy(roster, "elf-bow", 1, [6, 6, 6]);
    const rifle = rare.body.stash.find((item) => item.shopItemId === "elf-bow");
    const baseCost = rare.body.shop.find((item) => item.id === "elf-bow").baseCost;
    const soldRare = await sell([rifle.id], 1);
    assert.equal(soldRare.body.saleAmount, Math.floor(baseCost / 2));
    const spoils = await call("POST", path(roster, "/spoils"), { itemId: "sword" });
    const free = spoils.body.stash.find((item) => item.shopItemId === "sword");
    assert.equal(free.unitCostPaid, 0);
    assert.equal((await sell([free.id], 1)).body.saleAmount, 5);
    assert.equal((await sell([free.id], 1)).status, 404);
    const other = await fixture();
    assert.equal((await call("POST", path(other.roster, "/sell"), { source: "stash", inventoryIds: [axe.id], quantity: 1 })).status, 404);
    const concurrent = await Promise.all([sell([axe.id], 1), sell([axe.id], 1)]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 404]);
  });
  test("member sales replace full refunds after battle one and preserve shared Henchman equipment", async () => {
    const { roster, member } = await fixture();
    await call("PATCH", `/rosters/${roster.id}`, { battlesFought: 0 });
    const initial = (await call("GET", `/members/${member.id}/equipment`)).body;
    const sword = initial.availableOptions.find((option) => option.name === "Sword");
    const bought = await call("POST", `/members/${member.id}/equipment`, { equipmentOptionId: sword.id });
    const entry = bought.body.inventory.find((item) => item.equipmentOptionId === sword.id && item.unitCostPaid > 0);
    await call("PATCH", `/rosters/${roster.id}`, { battlesFought: 1 });
    const sold = await call("DELETE", `/members/${member.id}/equipment/${entry.id}`);
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
    assert.equal(sold.body.refundAmount, 5);
    const starter = sold.body.inventory.find((item) => item.name === "Dagger" && item.unitCostPaid === 0);
    assert.equal((await call("DELETE", `/members/${member.id}/equipment/${starter.id}`)).status, 409);
    const henchman = (await call("POST", `/rosters/${roster.id}/members`, {
      role: "Henchman", name: "Sale group", groupSize: 2,
      warriorTypeId: types.find((type) => type.name === "Warriors (All Other)").id,
    })).body;
    const gear = await buy(roster, "sword", 2);
    const stash = gear.body.stash.find((item) => item.shopItemId === "sword");
    const assigned = await call("POST", path(roster, "/transfer"), {
      direction: "to_member", inventoryId: stash.id, memberId: henchman.id, modelIndex: -1, quantity: 1,
    });
    const ids = assigned.body.memberInventory.filter((item) => item.memberId === henchman.id && item.shopItemId === "sword").map((item) => item.id);
    assert.equal(ids.length, 2);
    assert.equal((await call("DELETE", `/members/${henchman.id}/equipment/${ids[0]}`)).status, 409);
    assert.equal((await call("POST", path(roster, "/sell"), { source: "member", inventoryIds: [ids[0]] })).status, 409);
    const grouped = await call("DELETE", `/members/${henchman.id}/equipment`, { inventoryItemIds: ids });
    assert.equal(grouped.status, 200, JSON.stringify(grouped.body));
    assert.equal(grouped.body.refundAmount, 10);
    assert.ok(!grouped.body.inventory.some((item) => ids.includes(item.id)));
  });
  test("campaign sales respect purchase phases, overrides and custom variable-price base costs", async () => {
    const { roster, member } = await fixture(true, { overrides: { axe: { baseCost: 9 } }, customItems: [
      { id: "custom-sale", name: "Sale token", description: "A sale regression token.", baseCost: 35, priceDice: 1, rarity: null },
    ] });
    await stage(roster, "post_battle", 8);
    const customId = (await call("GET", path(roster))).body.shop.find((item) => item.name === "Sale token").id;
    const bought = await buy(roster, customId, 1, [6]);
    const entry = bought.body.stash.find((item) => item.shopItemId === customId);
    assert.equal(entry.unitCostPaid, 41);
    const sale = () => call("POST", path(roster, "/sell"), { source: "stash", inventoryIds: [entry.id], quantity: 1 });
    for (const [phase, step] of [["battle", 1], ["post_battle", 5], ["post_battle", 9], ["pre_battle", 1], ["setup", 1]]) {
      await stage(roster, phase, step);
      assert.equal((await sale()).status, 409);
    }
    await stage(roster, "post_battle", 6);
    const sold = await sale();
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
    assert.equal(sold.body.saleAmount, 17);
    const axe = (await buy(roster, "axe")).body.stash.find((item) => item.shopItemId === "axe");
    await stage(roster, "post_battle", 9);
    const transfer = await call("POST", path(roster, "/transfer"), { direction: "to_member", inventoryId: axe.id, memberId: member.id, quantity: 1 });
    const carried = transfer.body.memberInventory.find((item) => item.shopItemId === "axe");
    assert.equal((await call("DELETE", `/members/${member.id}/equipment/${carried.id}`)).status, 409);
    await stage(roster, "post_battle", 7);
    const memberSale = await call("DELETE", `/members/${member.id}/equipment/${carried.id}`);
    assert.equal(memberSale.status, 200, JSON.stringify(memberSale.body));
    assert.equal(memberSale.body.refundAmount, 4);
  });
  test("Familiar rituals charge on failure, award once on success, and bind to the summoner", async () => {
    const { roster, member } = await fixture(false, undefined, "Undead", "Necromancer (Lahmia & Undead))");
    const before = (await call("GET", path(roster))).body;
    assert.equal(before.heroes.find((hero) => hero.id === member.id).spellcaster, true);
    assert.equal((await call("POST", path(roster, "/spoils"), { itemId: "familiar" })).status, 409);
    assert.equal((await call("POST", path(roster, "/search"), { itemId: "familiar", heroId: member.id, mode: "manual", dice: [1, 1] })).status, 409);
    const offer = await call("POST", path(roster, "/quote"), { itemId: "familiar", buyerId: member.id, mode: "manual", dice: [3] });
    assert.equal(offer.status, 201, JSON.stringify(offer.body));
    assert.equal((await call("POST", path(roster, "/purchase"), { quoteId: offer.body.id })).status, 409);
    const failed = await call("POST", path(roster, "/search"), { itemId: "familiar", heroId: member.id, quoteId: offer.body.id, mode: "manual", dice: [1, 1] });
    assert.equal(failed.status, 201, JSON.stringify(failed.body));
    assert.equal(failed.body.attempt.success, false);
    assert.equal(failed.body.stash.length, 0);
    assert.equal(Number(failed.body.treasury), Number(before.treasury) - 23);
    assert.equal((await call("POST", path(roster, "/search"), { itemId: "familiar", heroId: member.id, quoteId: offer.body.id, mode: "manual", dice: [6, 6] })).status, 409);
    const successQuote = await call("POST", path(roster, "/quote"), { itemId: "familiar", buyerId: member.id, mode: "manual", dice: [1] });
    const success = await call("POST", path(roster, "/search"), { itemId: "familiar", heroId: member.id, quoteId: successQuote.body.id, mode: "manual", dice: [6, 6] });
    assert.equal(success.status, 201, JSON.stringify(success.body));
    assert.equal(success.body.attempt.success, true);
    assert.equal(Number(success.body.treasury), Number(before.treasury) - 44);
    const familiar = success.body.stash.find((row) => row.shopItemId === "familiar");
    assert.equal(familiar.boundWarriorId, member.id);
    assert.equal(familiar.unitCostPaid, 21);
    assert.equal((await call("POST", path(roster, "/sell"), { source: "stash", inventoryIds: [familiar.id], quantity: 1 })).status, 409);
    assert.deepEqual(familiar.eligibleRecipients.map((recipient) => recipient.memberId), [member.id]);
    const assigned = await call("POST", path(roster, "/transfer"), { inventoryId: familiar.id, direction: "to_member", memberId: member.id });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    const carried = assigned.body.memberInventory.find((row) => row.shopItemId === "familiar");
    assert.equal((await call("DELETE", `/members/${member.id}/equipment/${carried.id}`)).status, 409);
    const returned = await call("POST", path(roster, "/transfer"), { inventoryId: carried.id, direction: "to_stash", memberId: member.id });
    assert.equal(returned.status, 200, JSON.stringify(returned.body));
    assert.equal(returned.body.stash[0].boundWarriorId, member.id);
    const campaign = await call("POST", "/campaigns", { name: "Bound familiar casualty" });
    assert.equal(campaign.status, 201, JSON.stringify(campaign.body));
    await db("rosters").where({ id: roster.id }).update({ campaign_id: campaign.body.id });
    await stage(roster, "post_battle", 1);
    const died = await call("POST", `/rosters/${roster.id}/casualties`, { memberId: member.id });
    assert.equal(died.status, 200, JSON.stringify(died.body));
    assert.equal(died.body.stash.length, 0);
  });
  test("summoning enforces caster, Prayer exclusion, OOA, phase and once-per-battle rules without unpaid retries", async () => {
    const mundane = await fixture();
    assert.equal((await call("POST", path(mundane.roster, "/quote"), { itemId: "familiar", buyerId: mundane.member.id, mode: "manual", dice: [1] })).status, 409);
    const priest = await fixture(false, undefined, "Witch Hunters", "Warrior Priest");
    assert.equal((await call("GET", path(priest.roster))).body.heroes[0].spellcaster, false);
    assert.equal((await call("POST", path(priest.roster, "/quote"), { itemId: "familiar", buyerId: priest.member.id, mode: "manual", dice: [1] })).status, 409);
    const { roster, member } = await fixture(true, undefined, "Undead", "Necromancer (Lahmia & Undead))");
    assert.equal((await call("POST", path(roster, "/quote"), { itemId: "familiar", buyerId: member.id, mode: "manual", dice: [1] })).status, 409);
    await stage(roster, "post_battle", 6);
    const offer = (await call("POST", path(roster, "/quote"), { itemId: "familiar", buyerId: member.id, mode: "manual", dice: [1] })).body;
    const before = Number((await call("GET", path(roster))).body.treasury);
    await db("rosters").where({ id: roster.id }).update({ treasury: 0 });
    assert.equal((await call("POST", path(roster, "/search"), { itemId: "familiar", heroId: member.id, quoteId: offer.id, mode: "manual", dice: [6, 6] })).status, 409);
    assert.equal((await db("trading_quotes").where({ id: offer.id }).first()).consumed, false);
    assert.equal((await call("GET", path(roster))).body.searches.length, 0);
    await db("rosters").where({ id: roster.id }).update({ treasury: before });
    await db("trading_hero_status").insert({ roster_id: roster.id, hero_id: member.id, battle_number: 1, out_of_action: true });
    assert.equal((await call("POST", path(roster, "/search"), { itemId: "familiar", heroId: member.id, quoteId: offer.id, mode: "manual", dice: [1, 1] })).status, 409);
    await db("trading_hero_status").where({ roster_id: roster.id }).delete();
    assert.equal((await call("POST", path(roster, "/search"), { itemId: "familiar", heroId: member.id, quoteId: offer.id, mode: "manual", dice: [7, 1] })).status, 400);
    assert.equal(Number((await call("GET", path(roster))).body.treasury), before);
    const failed = await call("POST", path(roster, "/search"), { itemId: "familiar", heroId: member.id, quoteId: offer.id, mode: "manual", dice: [1, 1] });
    assert.equal(failed.status, 201, JSON.stringify(failed.body));
    assert.equal(failed.body.searches.length, 1);
    assert.equal(failed.body.searches[0].success, false);
    assert.equal(Number(failed.body.treasury), before - 21);
    const again = (await call("POST", path(roster, "/quote"), { itemId: "familiar", buyerId: member.id, mode: "manual", dice: [1] })).body;
    assert.equal((await call("POST", path(roster, "/search"), { itemId: "familiar", heroId: member.id, quoteId: again.id, mode: "manual", dice: [6, 6] })).status, 409);
    assert.equal(Number((await call("GET", path(roster))).body.treasury), before - 21);
  });
  test("creation-only Standard of Nagarythe is purchasable in setup but not after creation", async () => {
    const { roster } = await fixture(true, undefined, "Shadow Warrior", "Shadow Master");
    const initial = (await call("GET", path(roster))).body;
    assert.equal(initial.canPurchase, false);
    assert.equal(initial.shop.find((item) => item.id === "standard-of-nagarythe").canPurchase, true);
    const bought = await buy(roster, "standard-of-nagarythe", 1, [1, 1, 1]);
    assert.equal(bought.status, 201, JSON.stringify(bought.body));
    assert.equal(bought.body.stash[0].unitCostPaid, 78);
    await stage(roster, "pre_battle", 1);
    assert.equal((await call("POST", path(roster, "/quote"), { itemId: "standard-of-nagarythe", mode: "manual", dice: [1, 1, 1] })).status, 409);
    await stage(roster, "post_battle", 6);
    assert.equal((await call("POST", path(roster, "/quote"), { itemId: "standard-of-nagarythe", mode: "manual", dice: [1, 1, 1] })).status, 409);
    const free = await fixture(false, undefined, "Shadow Warrior", "Shadow Master");
    await db("rosters").where({ id: free.roster.id }).update({ battles_fought: 1 });
    assert.equal((await call("POST", path(free.roster, "/spoils"), { itemId: "standard-of-nagarythe" })).status, 409);
  });
  test("Peg Legs enforce per-model limits and Barding recipients must actually carry a warhorse", async () => {
    const pirate = await fixture(false, undefined, "Pirate", "Pirate Captain");
    const legs = await call("POST", path(pirate.roster, "/spoils"), { itemId: "peg-leg", quantity: 2 });
    const entry = legs.body.stash.find((item) => item.shopItemId === "peg-leg");
    const sent = await call("POST", path(pirate.roster, "/transfer"), { inventoryId: entry.id, direction: "to_member", memberId: pirate.member.id });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.deepEqual(sent.body.stash.find((item) => item.id === entry.id).eligibleRecipients, []);
    assert.equal((await call("POST", path(pirate.roster, "/transfer"), { inventoryId: entry.id, direction: "to_member", memberId: pirate.member.id })).status, 409);
    const { roster, member } = await fixture();
    const barding = (await call("POST", path(roster, "/spoils"), { itemId: "barding" })).body.stash[0];
    assert.deepEqual(barding.eligibleRecipients, []);
    assert.equal((await call("POST", path(roster, "/transfer"), { inventoryId: barding.id, direction: "to_member", memberId: member.id })).status, 409);
    const horse = (await call("POST", path(roster, "/spoils"), { itemId: "warhorse" })).body.stash.find((item) => item.shopItemId === "warhorse");
    const mounted = await call("POST", path(roster, "/transfer"), { inventoryId: horse.id, direction: "to_member", memberId: member.id });
    assert.equal(mounted.status, 200, JSON.stringify(mounted.body));
    assert.deepEqual(mounted.body.stash.find((item) => item.id === barding.id).eligibleRecipients.map((recipient) => recipient.memberId), [member.id]);
    assert.equal((await call("POST", path(roster, "/transfer"), { inventoryId: barding.id, direction: "to_member", memberId: member.id })).status, 200);
    const carriedHorse = mounted.body.memberInventory.find((item) => item.shopItemId === "warhorse");
    assert.equal((await call("POST", path(roster, "/transfer"), { inventoryId: carriedHorse.id, direction: "to_stash", memberId: member.id })).status, 409);
    assert.equal((await call("POST", path(roster, "/sell"), { source: "member", inventoryIds: [carriedHorse.id] })).status, 409);
  });
  test("Skink Hero prices are buyer-scoped and campaign price overrides take precedence", async () => {
    const { roster, member } = await fixture(false, undefined, "Lizardmen", "Skink Priest");
    const special = await call("POST", path(roster, "/quote"), { itemId: "black-lotus", buyerId: member.id, mode: "manual", dice: [] });
    assert.equal(special.status, 201, JSON.stringify(special.body));
    assert.equal(special.body.price, 10);
    const standard = await call("POST", path(roster, "/quote"), { itemId: "black-lotus", mode: "manual", dice: [6] });
    assert.equal(standard.body.price, 16);
    assert.notEqual(standard.body.id, special.body.id);
    assert.equal((await call("POST", path(roster, "/purchase"), { quoteId: special.body.id })).status, 201);
    const campaign = await fixture(true, { overrides: { "black-lotus": { baseCost: 42, priceDice: 0, rarity: null } }, customItems: [] }, "Lizardmen", "Skink Priest");
    await stage(campaign.roster, "post_battle", 8);
    const offer = await call("POST", path(campaign.roster, "/quote"), { itemId: "black-lotus", buyerId: campaign.member.id, mode: "manual", dice: [] });
    assert.equal(offer.status, 201, JSON.stringify(offer.body));
    assert.equal(offer.body.price, 42);
    assert.equal((await call("POST", path(campaign.roster, "/purchase"), { quoteId: offer.body.id })).status, 201);
  });
  test("permanent weapon upgrades split stacks, preserve profiles, charge groups and cannot be traded", async () => {
    const { roster, member } = await fixture();
    const hired = await call("POST", `/rosters/${roster.id}/members`, { role: "Henchman", name: "Poison group", groupSize: 2,
      warriorTypeId: types.find((type) => type.name === "Warriors (All Other)").id });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    const swords = (await call("POST", path(roster, "/spoils"), { itemId: "sword", quantity: 4 })).body.stash[0];
    await call("POST", path(roster, "/transfer"), { inventoryId: swords.id, direction: "to_member", memberId: member.id, quantity: 2 });
    const groupGear = await call("POST", path(roster, "/transfer"), { inventoryId: swords.id, direction: "to_member", memberId: hired.body.id, modelIndex: -1 });
    assert.equal(groupGear.status, 200, JSON.stringify(groupGear.body));
    const { id } = await db("warbands").where({ name: "Forest Goblins" }).first("id");
    await db("rosters").where({ id: roster.id }).update({ warband_id: id });
    const source = (await call("GET", path(roster))).body;
    const weapon = source.memberInventory.find((item) => item.memberId === member.id && item.shopItemId === "sword");
    const quote = (await call("POST", path(roster, "/quote"), { itemId: "poisoned-weapon", mode: "manual", dice: [] })).body;
    assert.equal((await call("POST", path(roster, "/spoils"), { itemId: "poisoned-weapon" })).status, 409);
    assert.equal((await call("POST", path(roster, "/purchase"), { quoteId: quote.id })).status, 409);
    const upgraded = await call("POST", path(roster, "/upgrade"), { itemId: "poisoned-weapon", inventoryId: weapon.id, quoteId: quote.id });
    assert.equal(upgraded.status, 200, JSON.stringify(upgraded.body));
    assert.equal(Number(upgraded.body.treasury), Number(source.treasury) - 25);
    const poisoned = upgraded.body.memberInventory.find((item) => item.nontransferable);
    assert.equal(poisoned.quantity, 1);
    assert.equal(upgraded.body.memberInventory.find((item) => item.id === weapon.id).quantity, 1);
    assert.match(poisoned.name, /Sword \(Poisoned\)/);
    const profile = await db("shop_items").where({ id: poisoned.shopItemId }).first();
    assert.equal(profile.weapon_profile_id, (await db("shop_items").where({ id: "sword" }).first()).weapon_profile_id);
    assert.equal((await call("POST", path(roster, "/transfer"), { inventoryId: poisoned.id, memberId: member.id, direction: "to_stash" })).status, 409);
    assert.equal((await call("POST", path(roster, "/sell"), { source: "member", inventoryIds: [poisoned.id] })).status, 409);
    assert.equal((await call("DELETE", `/members/${member.id}/equipment/${poisoned.id}`)).status, 409);
    const groupWeapon = upgraded.body.memberInventory.find((item) => item.memberId === hired.body.id && item.modelIndex === 0 && item.shopItemId === "sword");
    const groupQuote = (await call("POST", path(roster, "/quote"), { itemId: "poisoned-weapon", mode: "manual", dice: [] })).body;
    const groupUpgrade = await call("POST", path(roster, "/upgrade"), { itemId: "poisoned-weapon", inventoryId: groupWeapon.id, quoteId: groupQuote.id });
    assert.equal(groupUpgrade.status, 200, JSON.stringify(groupUpgrade.body));
    assert.equal(Number(groupUpgrade.body.treasury), Number(source.treasury) - 75);
    assert.equal(groupUpgrade.body.memberInventory.filter((item) => item.memberId === hired.body.id && item.nontransferable).length, 2);
    assert.equal((await call("POST", path(roster, "/upgrade"), { itemId: "poisoned-weapon", inventoryId: poisoned.id, quoteId: groupQuote.id })).status, 409);
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
  test("Swivel Guns count legacy carried and stashed stock toward their warband limit", async () => {
    const { roster, member } = await fixture(false, undefined, "Pirate", "Pirate Captain");
    const gunnerTypes = (await call("GET", `/warbands/${roster.warbandId}/warrior-types`)).body;
    const gunner = await call("POST", `/rosters/${roster.id}/members`, { role: "Henchman", warriorTypeId: gunnerTypes.find((type) => type.name === "Gunners").id, name: "Gunner" });
    assert.equal(gunner.status, 201, JSON.stringify(gunner.body));
    const stock = await buy(roster, "swivel-gun");
    assert.equal(stock.status, 201, JSON.stringify(stock.body));
    assert.deepEqual(stock.body.stash[0].eligibleRecipients.map((recipient) => recipient.memberId), [gunner.body.id]);
    assert.equal((await call("POST", path(roster, "/spoils"), { itemId: "swivel-gun" })).status, 409);
    const list = { warband_id: roster.warbandId, list_key: `test-limit-${roster.id}` };
    await db("equipment_lists").insert({ ...list, name: "Stock limit fixture", source_reference: "Test fixture" });
    temporaryEquipmentLists.push(list);
    const option = await db("equipment_options").insert({ ...list, name: "Swivel Gun", category: "weapon", unit_cost: 65, source_reference: "Test fixture" }).returning("id");
    await db("warband_stash").where({ roster_id: roster.id }).delete();
    await db("warrior_inventory").insert({ warrior_id: member.id, equipment_option_id: option[0].id, quantity: 1, model_index: 0, unit_cost_paid: 65 });
    assert.equal((await call("POST", path(roster, "/spoils"), { itemId: "swivel-gun" })).status, 409);
    await db("warrior_inventory").where({ warrior_id: member.id, equipment_option_id: option[0].id }).delete();
    await db("warband_stash").insert({ roster_id: roster.id, equipment_option_id: option[0].id, quantity: 1, unit_cost_paid: 65 });
    assert.equal((await call("POST", path(roster, "/spoils"), { itemId: "swivel-gun" })).status, 409);
    await db("warband_stash").where({ roster_id: roster.id }).delete();
    await db("equipment_options").where({ id: option[0].id }).delete();
  });
  test("incompatible mounts and ten-die campaign prices cannot bypass validated purchase rules", async () => {
    const goblins = await fixture(false, undefined, "Night Goblins", "Bosses (Night Goblins)");
    const wolf = await call("POST", path(goblins.roster, "/spoils"), { itemId: "giant-wolf" });
    assert.equal(wolf.status, 201, JSON.stringify(wolf.body));
    assert.equal((await call("POST", path(goblins.roster, "/spoils"), { itemId: "giant-spider" })).status, 409);
    const { roster } = await fixture(true, { overrides: {}, customItems: [{
      id: "custom-ten-die-wagon", name: "Scenario Wagon", description: "A variable cost wagon.", category: "misc", baseCost: 200, priceDice: 10, priceMultiplier: 1, rarity: null,
    }] });
    await stage(roster, "post_battle", 8);
    const state = (await call("GET", path(roster))).body;
    const wagon = state.shop.find((item) => item.name === "Scenario Wagon");
    assert.ok(wagon);
    const bought = await buy(roster, wagon.id, 1, Array(10).fill(1));
    assert.equal(bought.status, 201, JSON.stringify(bought.body));
    assert.equal(bought.body.stash[0].unitCostPaid, 210);
    assert.equal((await call("POST", path(roster, "/quote"), { itemId: wagon.id, mode: "manual", dice: Array(9).fill(1) })).status, 400);
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
    const created = await call("POST", "/rosters", { warbandId: undead.id, battlesFought: 1 });
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
    assert.equal(repurchased.status, 409);
    await call("PATCH", `/rosters/${roster.id}`, { battlesFought: 0 });
    const creationPurchase = await call("POST", `/members/${henchman.id}/equipment`, { equipmentOptionId: dagger.equipmentOptionId, quantity: 1, modelIndex: -1 });
    assert.equal(creationPurchase.status, 201, JSON.stringify(creationPurchase.body));
    assert.equal(creationPurchase.body.purchaseCost, 4);
    await call("PATCH", `/rosters/${roster.id}`, { battlesFought: 1 });
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
  test("Thunderers and Engineers can receive their listed melee weapons without broader Dwarf Warrior access", async () => {
    const { roster, member: engineer } = await fixture(false, undefined, "Dwarf Treasure Hunters", "Dwarf Engineer");
    const dwarfTypes = (await call("GET", `/warbands/${roster.warbandId}/warrior-types`)).body;
    const hired = await call("POST", `/rosters/${roster.id}/members`, {
      name: "Thunderer mace regression", role: "Henchman", groupSize: 2,
      warriorTypeId: dwarfTypes.find((type) => type.name === "Dwarf Thunderers").id,
    });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    const thunderers = hired.body;
    const migration = require("../migrations/20261011020000_restore_thunderer_melee_equipment");
    const options = () => db("equipment_options").where({ warband_id: roster.warbandId, list_key: "dwarf-thunderer" })
      .whereIn("name", ["Dagger", "Mace", "Hammer", "Axe", "Sword"]).orderBy("name");
    const before = await options();
    await db.transaction((trx) => migration.up(trx));
    assert.deepEqual((await options()).map((row) => row.id), before.map((row) => row.id));
    assert.equal(before.length, 5);
    assert.ok(before.every((row) => row.weapon_profile_id));
    await call("PATCH", `/rosters/${roster.id}`, { battlesFought: 0 });
    for (const warrior of [engineer, thunderers]) {
      const equipment = (await call("GET", `/members/${warrior.id}/equipment`)).body;
      for (const name of ["Dagger", "Mace", "Hammer", "Axe", "Sword"]) {
        assert.ok(equipment.availableOptions.some((item) => item.name === name && item.stats.weapon), name);
      }
      assert.ok(!equipment.availableOptions.some((item) => ["Dwarf axe", "Spear", "Halberd"].includes(item.name)));
    }
    const starter = (await call("GET", `/members/${thunderers.id}/equipment`)).body.inventory.filter((item) => item.name === "Dagger");
    assert.equal(starter.length, 2);
    assert.ok(starter.every((item) => item.unitCostPaid === 0));
    const recruitmentMace = before.find((option) => option.name === "Mace");
    const purchased = await call("POST", `/members/${engineer.id}/equipment`, { equipmentOptionId: recruitmentMace.id, quantity: 2 });
    assert.equal(purchased.status, 201, JSON.stringify(purchased.body));
    const carriedMace = purchased.body.inventory.find((item) => item.equipmentOptionId === recruitmentMace.id);
    const returned = await call("POST", path(roster, "/transfer"), {
      direction: "to_stash", inventoryId: carriedMace.id, memberId: engineer.id, quantity: 2,
    });
    assert.equal(returned.status, 200, JSON.stringify(returned.body));
    const legacyMace = returned.body.stash.find((entry) => entry.equipmentOptionId === recruitmentMace.id);
    assert.ok(legacyMace.eligibleRecipients.some((recipient) => recipient.memberId === thunderers.id));
    const legacyAssigned = await call("POST", path(roster, "/transfer"), {
      direction: "to_member", inventoryId: legacyMace.id, memberId: thunderers.id, modelIndex: -1, quantity: 1,
    });
    assert.equal(legacyAssigned.status, 200, JSON.stringify(legacyAssigned.body));
    assert.equal(legacyAssigned.body.memberInventory.filter((item) => item.memberId === thunderers.id
      && item.equipmentOptionId === recruitmentMace.id).length, 2);
    await call("PATCH", `/rosters/${roster.id}`, { battlesFought: 1 });
    for (const itemId of ["club-mace-hammer", "axe", "sword", "dagger"]) {
      const bought = await buy(roster, itemId, 3);
      assert.equal(bought.status, 201, JSON.stringify(bought.body));
      const entry = bought.body.stash.find((item) => item.shopItemId === itemId);
      assert.ok(entry.eligibleRecipients.some((recipient) => recipient.memberId === thunderers.id), itemId);
      assert.ok(entry.eligibleRecipients.some((recipient) => recipient.memberId === engineer.id), itemId);
      if (itemId === "club-mace-hammer") {
        assert.equal((await call("POST", path(roster, "/transfer"), {
          direction: "to_member", inventoryId: entry.id, memberId: thunderers.id, modelIndex: 0, quantity: 1,
        })).status, 409);
      }
      const assigned = await call("POST", path(roster, "/transfer"), {
        direction: "to_member", inventoryId: entry.id, memberId: thunderers.id, modelIndex: -1, quantity: 1,
      });
      assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
      assert.equal(assigned.body.memberInventory.filter((item) => item.memberId === thunderers.id && item.shopItemId === itemId).length, 2);
      assert.equal((await call("POST", path(roster, "/transfer"), {
        direction: "to_member", inventoryId: entry.id, memberId: engineer.id, quantity: 1,
      })).status, 200);
    }
    for (const itemId of ["dwarf-axe", "spear", "halberd"]) {
      const bought = await buy(roster, itemId);
      assert.equal(bought.status, 201, JSON.stringify(bought.body));
      const entry = bought.body.stash.find((item) => item.shopItemId === itemId);
      assert.ok(!entry.eligibleRecipients.some((recipient) => [thunderers.id, engineer.id].includes(recipient.memberId)), itemId);
      assert.equal((await call("POST", path(roster, "/transfer"), {
        direction: "to_member", inventoryId: entry.id, memberId: thunderers.id, modelIndex: -1, quantity: 1,
      })).status, 409);
    }
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
