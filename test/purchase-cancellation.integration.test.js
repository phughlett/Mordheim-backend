const { after, before, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const knex = require("knex");
const { createApp } = require("../src/app");
const { releaseRefundedPurchaseSearch } = require("../src/repositories/trading.repository");

const db = knex(require("../knexfile")[process.env.NODE_ENV || "development"]);
const users = [];
let server;
let base;
let warband;
let types;

async function call(method, path, body, user = users[0]) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${user.token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function fixture({ campaign = false, battlesFought = 1 } = {}) {
  let campaignId;
  if (campaign) {
    const result = await call("POST", "/campaigns", {
      name: "Purchase cancellation test",
      tradingRules: { overrides: { "healing-herbs": { rarity: null } }, customItems: [] },
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    campaignId = result.body.id;
  }
  const result = await call("POST", "/rosters", {
    warbandId: warband.id,
    ...(campaignId ? { campaignId } : { battlesFought }),
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const roster = result.body;
  const type = types.find((entry) => entry.name === "Youngblood");
  const member = await call("POST", `/rosters/${roster.id}/members`, {
    role: "Hero", warriorTypeId: type.id, name: "Cancellation test",
  });
  assert.equal(member.status, 201, JSON.stringify(member.body));
  return { roster, member: member.body };
}

const trading = (roster, suffix = "") => `/rosters/${roster.id}/trading${suffix}`;

async function quoteAndBuy(roster, itemId, quantity = 1, dice = []) {
  const quote = await call("POST", trading(roster, "/quote"), { itemId, mode: "manual", dice });
  assert.equal(quote.status, 201, JSON.stringify(quote.body));
  const bought = await call("POST", trading(roster, "/purchase"), {
    quoteId: quote.body.id, quantity,
  });
  assert.equal(bought.status, 201, JSON.stringify(bought.body));
  return { quote: quote.body, bought: bought.body };
}

describe("purchase cancellations", () => {
  before(async () => {
    await db.migrate.latest();
    server = createApp(db).listen(0);
    base = `http://127.0.0.1:${server.address().port}/api`;
    const auth = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: `refund_${Date.now()}`,
        password: "Purchase-cancellation-test-0420!",
      }),
    });
    assert.equal(auth.status, 201);
    const data = await auth.json();
    users.push({ id: data.user.id, token: data.token });
    warband = (await call("GET", "/warbands")).body.find((entry) => entry.name === "Reikland Mercenaries");
    types = (await call("GET", `/warbands/${warband.id}/warrior-types`)).body;
  });

  after(async () => {
    const ids = users.map((user) => user.id);
    const upgradeIds = await db("warrior_inventory as inventory")
      .join("warriors as warrior", "warrior.id", "inventory.warrior_id")
      .join("rosters as roster", "roster.id", "warrior.roster_id")
      .whereIn("roster.user_id", ids).pluck("inventory.shop_item_id");
    await db("rosters").whereIn("user_id", ids).delete();
    await db("campaigns").whereIn("owner_id", ids).delete();
    await db("users").whereIn("id", ids).delete();
    await db("shop_items").whereIn("id", upgradeIds.filter((id) => id?.startsWith("upgrade/"))).delete();
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.destroy();
  });

  test("refunds quote price through inventory transfers and outside sale windows", async () => {
    const { roster, member } = await fixture({ campaign: true });
    await db("rosters").where({ id: roster.id }).update({ campaign_phase: "post_battle", campaign_step: 6 });
    const { quote, bought } = await quoteAndBuy(roster, "healing-herbs", 2, [4, 5]);
    const stash = bought.stash.find((entry) => entry.shopItemId === "healing-herbs");
    assert.equal(stash.canRefund, true);
    assert.equal(stash.unitSaleValue, quote.price);
    const persisted = await db("warband_stash").where({ id: stash.id }).first();
    assert.equal(persisted.purchase_battles_fought, 0);
    assert.ok(persisted.purchase_id);

    await db("rosters").where({ id: roster.id }).update({ campaign_phase: "pre_battle", campaign_step: 0 });
    const sent = await call("POST", trading(roster, "/transfer"), {
      direction: "to_member", inventoryId: stash.id, memberId: member.id, quantity: 1, modelIndex: 0,
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const carried = sent.body.memberInventory.find((entry) => entry.shopItemId === "healing-herbs");
    assert.equal(carried.canRefund, true);
    const carriedRow = await db("warrior_inventory").where({ id: carried.id }).first();
    assert.equal(carriedRow.purchase_id, persisted.purchase_id);
    assert.equal(carriedRow.purchase_battles_fought, persisted.purchase_battles_fought);

    const returned = await call("POST", trading(roster, "/transfer"), {
      direction: "to_stash", inventoryId: carried.id, memberId: member.id, quantity: 1, modelIndex: 0,
    });
    assert.equal(returned.status, 200, JSON.stringify(returned.body));
    const returnedEntry = returned.body.stash.find((entry) => entry.shopItemId === "healing-herbs");
    const returnedRow = await db("warband_stash").where({ id: returnedEntry.id }).first();
    assert.equal(returnedRow.purchase_id, persisted.purchase_id);
    assert.equal(returnedRow.purchase_battles_fought, persisted.purchase_battles_fought);

    const sentAgain = await call("POST", trading(roster, "/transfer"), {
      direction: "to_member", inventoryId: returnedEntry.id, memberId: member.id, quantity: 1, modelIndex: 0,
    });
    const carriedAgain = sentAgain.body.memberInventory.find((entry) => entry.shopItemId === "healing-herbs");
    const carriedRefund = await call("POST", trading(roster, "/sell"), {
      source: "member", inventoryIds: [carriedAgain.id],
    });
    assert.equal(carriedRefund.status, 200, JSON.stringify(carriedRefund.body));
    assert.equal(carriedRefund.body.saleAmount, quote.price);

    await db("rosters").where({ id: roster.id }).update({ campaign_phase: "battle", campaign_step: 1 });
    const remaining = carriedRefund.body.stash.find((entry) => entry.shopItemId === "healing-herbs");
    const refund = await call("POST", trading(roster, "/sell"), {
      source: "stash", inventoryIds: [remaining.id], quantity: 1,
    });
    assert.equal(refund.status, 200, JSON.stringify(refund.body));
    assert.equal(refund.body.saleAmount, quote.price);
    assert.equal(Number(refund.body.treasury), Number(carriedRefund.body.treasury) + quote.price);
  });

  test("legacy and older purchases use normal resale after the actual battle counter changes", async () => {
    const { roster } = await fixture();
    const { bought } = await quoteAndBuy(roster, "axe", 1);
    const axe = bought.stash.find((entry) => entry.shopItemId === "axe");
    assert.equal(axe.canRefund, true);
    await db("rosters").where({ id: roster.id }).update({ battles_fought: 2 });
    const current = (await call("GET", trading(roster))).body;
    const older = current.stash.find((entry) => entry.id === axe.id);
    assert.equal(older.canRefund, false);
    assert.equal(older.unitSaleValue, 2);

    const legacy = await db("warband_stash").insert({
      roster_id: roster.id, shop_item_id: "axe", quantity: 1, unit_cost_paid: 10,
    }).returning("id");
    const legacyItem = (await call("GET", trading(roster))).body.stash.find((entry) => entry.id === legacy[0].id);
    assert.equal(legacyItem.canRefund, false);
    assert.equal(legacyItem.unitSaleValue, 2);
    const spoils = await call("POST", trading(roster, "/spoils"), { itemId: "axe" });
    const spoilsAxe = spoils.body.stash.find((entry) => entry.shopItemId === "axe" && entry.id !== axe.id);
    assert.equal(spoilsAxe.canRefund, false);
    assert.equal(spoilsAxe.unitSaleValue, 2);
    const soldSpoils = await call("POST", trading(roster, "/sell"), {
      source: "stash", inventoryIds: [spoilsAxe.id], quantity: 1,
    });
    assert.equal(soldSpoils.body.saleAmount, 2);

    const sold = await call("POST", trading(roster, "/sell"), {
      source: "stash", inventoryIds: [axe.id], quantity: 1,
    });
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
    assert.equal(sold.body.saleAmount, 2);
  });

  test("refund requests serialize and cannot be replayed for duplicate payment", async () => {
    const { roster } = await fixture();
    const { quote, bought } = await quoteAndBuy(roster, "axe");
    const axe = bought.stash.find((entry) => entry.shopItemId === "axe");
    const sell = () => call("POST", trading(roster, "/sell"), {
      source: "stash", inventoryIds: [axe.id], quantity: 1,
    });
    const results = await Promise.all([sell(), sell()]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 404]);
    const success = results.find((result) => result.status === 200);
    assert.equal(success.body.saleAmount, quote.price);
    const treasury = success.body.treasury;
    assert.equal((await sell()).status, 404);
    assert.equal(Number((await call("GET", trading(roster))).body.treasury), Number(treasury));
  });

  test("a full-price cancellation reopens only the linked successful rarity search", async () => {
    const { roster, member } = await fixture({ campaign: true });
    await db("rosters").where({ id: roster.id }).update({ battles_fought: 1, campaign_phase: "post_battle", campaign_step: 6 });
    const search = await call("POST", trading(roster, "/search"), {
      heroId: member.id, itemId: "pistol", mode: "manual", dice: [6, 6],
    });
    assert.equal(search.status, 201, JSON.stringify(search.body));
    const searchId = search.body.searches[0].id;
    const offer = await call("POST", trading(roster, "/quote"), {
      itemId: "pistol", mode: "manual", dice: [],
    });
    const bought = await call("POST", trading(roster, "/purchase"), {
      quoteId: offer.body.id, quantity: 1, searchId,
    });
    assert.equal(bought.status, 201, JSON.stringify(bought.body));
    const pistol = bought.body.stash.find((entry) => entry.shopItemId === "pistol");
    const purchaseSearch = await db("trading_searches").where({ id: searchId }).first();
    assert.equal(purchaseSearch.purchased, true);
    const purchasedRow = await db("warband_stash").where({ id: pistol.id }).first();
    assert.equal(purchaseSearch.purchase_id, purchasedRow.purchase_id);
    const experience = (await db("warriors").where({ id: member.id }).first("experience")).experience;
    const [consumedUse] = await db("consumed_item_uses").insert({
      roster_id: roster.id,
      warrior_id: member.id,
      battles_fought: 1,
      state: JSON.stringify({ item: { ...purchasedRow, purchase_id: purchasedRow.purchase_id } }),
    }).returning("id");
    await db("rosters").where({ id: roster.id }).update({ campaign_phase: "pre_battle", campaign_step: 0 });
    const assigned = await call("POST", trading(roster, "/transfer"), {
      direction: "to_member", inventoryId: pistol.id, memberId: member.id, quantity: 1, modelIndex: 0,
    });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    const carriedPistol = assigned.body.memberInventory.find((entry) => entry.shopItemId === "pistol");

    const canceled = await call("POST", trading(roster, "/sell"), {
      source: "member", inventoryIds: [carriedPistol.id],
    });
    assert.equal(canceled.status, 200, JSON.stringify(canceled.body));
    assert.equal(canceled.body.saleAmount, offer.body.price);
    const stillLinked = await db("trading_searches").where({ id: searchId }).first();
    assert.equal(stillLinked.purchased, true);
    assert.equal(stillLinked.purchase_id, purchasedRow.purchase_id);
    assert.equal((await db("warriors").where({ id: member.id }).first("experience")).experience, experience);

    await db("consumed_item_uses").where({ id: consumedUse.id }).delete();
    assert.equal(await releaseRefundedPurchaseSearch(db, roster.id, purchasedRow.purchase_id), true);
    const reopened = await db("trading_searches").where({ id: searchId }).first();
    assert.equal(reopened.purchased, false);
    assert.equal(reopened.purchase_id, null);

    await db("rosters").where({ id: roster.id }).update({ campaign_phase: "post_battle", campaign_step: 6 });
    const nextOffer = await call("POST", trading(roster, "/quote"), {
      itemId: "pistol", mode: "manual", dice: [],
    });
    const repurchased = await call("POST", trading(roster, "/purchase"), {
      quoteId: nextOffer.body.id, quantity: 1, searchId,
    });
    assert.equal(repurchased.status, 201, JSON.stringify(repurchased.body));
    assert.equal((await db("trading_searches").where({ id: searchId }).first()).purchased, true);
  });

  test("permanent poison cancellation restores the weapon and refunds only upgrade cost once", async () => {
    const { roster, member } = await fixture();
    const purchased = await quoteAndBuy(roster, "sword", 2);
    const sword = purchased.bought.stash.find((entry) => entry.shopItemId === "sword");
    const sent = await call("POST", trading(roster, "/transfer"), {
      direction: "to_member", inventoryId: sword.id, memberId: member.id, quantity: 2, modelIndex: 0,
    });
    const weapon = sent.body.memberInventory.find((entry) => entry.shopItemId === "sword");
    const originalProvenance = await db("warrior_inventory").where({ id: weapon.id }).first();
    const forest = await db("warbands").where({ name: "Forest Goblins" }).first("id");
    await db("rosters").where({ id: roster.id }).update({ warband_id: forest.id });
    const offer = await call("POST", trading(roster, "/quote"), {
      itemId: "poisoned-weapon", mode: "manual", dice: [],
    });
    assert.equal(offer.status, 201, JSON.stringify(offer.body));
    const before = Number((await call("GET", trading(roster))).body.treasury);
    const upgraded = await call("POST", trading(roster, "/upgrade"), {
      itemId: "poisoned-weapon", inventoryId: weapon.id, quoteId: offer.body.id,
    });
    assert.equal(upgraded.status, 200, JSON.stringify(upgraded.body));
    const poisoned = upgraded.body.memberInventory.find((entry) => entry.nontransferable);
    assert.equal(poisoned.canRefund, true);
    assert.equal(poisoned.canCancelUpgrade, true);
    assert.equal(poisoned.unitSaleValue, offer.body.price);

    const canceled = await call("POST", trading(roster, "/cancel-upgrade"), { inventoryId: poisoned.id });
    assert.equal(canceled.status, 200, JSON.stringify(canceled.body));
    assert.equal(Number(canceled.body.treasury), before);
    const restored = canceled.body.memberInventory.find((entry) => entry.id === weapon.id);
    assert.equal(restored.shopItemId, "sword");
    assert.equal(restored.nontransferable, false);
    assert.equal(restored.quantity, 2);
    const restoredRow = await db("warrior_inventory").where({ id: weapon.id }).first();
    assert.equal(restoredRow.purchase_id, originalProvenance.purchase_id);
    assert.equal(restoredRow.purchase_battles_fought, originalProvenance.purchase_battles_fought);
    assert.equal(restoredRow.unit_cost_paid, originalProvenance.unit_cost_paid);
    assert.equal((await call("POST", trading(roster, "/cancel-upgrade"), { inventoryId: poisoned.id })).status, 404);

    const laterOffer = await call("POST", trading(roster, "/quote"), {
      itemId: "poisoned-weapon", mode: "manual", dice: [],
    });
    const laterUpgrade = await call("POST", trading(roster, "/upgrade"), {
      itemId: "poisoned-weapon", inventoryId: restored.id, quoteId: laterOffer.body.id,
    });
    const laterPoison = laterUpgrade.body.memberInventory.find((entry) => entry.nontransferable);
    await db("rosters").where({ id: roster.id }).update({ battles_fought: 2 });
    const expired = (await call("GET", trading(roster))).body.memberInventory.find((entry) => entry.id === laterPoison.id);
    assert.equal(expired.canRefund, false);
    assert.equal((await call("POST", trading(roster, "/cancel-upgrade"), { inventoryId: laterPoison.id })).status, 409);
  });
});
