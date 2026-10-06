const { after, before, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const knex = require("knex");
const knexConfig = require("../knexfile");
const { createApp } = require("../src/app");
const { defaultPurchaseRules } = require("../src/services/advance-purchase-rules.service");

const db = knex(knexConfig[process.env.NODE_ENV || "development"] || knexConfig.development);
const users = [];
let server;
let base;
let warband;
let types;
const rules = () => ({ ...structuredClone(defaultPurchaseRules), enabled: true });

async function call(method, path, body, user = users[0]) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function fixture(purchaseRules = rules(), name = "Youngblood", role = "Hero") {
  const campaign = (await call("POST", "/campaigns", { name: "Paid advancement tests", advancePurchaseRules: purchaseRules })).body;
  const roster = (await call("POST", "/rosters", { warbandId: warband.id, campaignId: campaign.id })).body;
  const member = await call("POST", `/rosters/${roster.id}/members`, { name, role, warriorTypeId: types.find((type) => type.name === name).id });
  assert.equal(member.status, 201, JSON.stringify(member.body));
  return { campaign, roster, member: member.body };
}

const purchase = (member, body, user) => call("POST", `/members/${member.id}/advance-purchases`, body, user);
const advanceData = async (member) => (await call("GET", `/members/${member.id}/advances`)).body;
const rosterData = async (roster) => (await call("GET", `/rosters/${roster.id}`)).body;
const refund = (member, advanceId) => call("DELETE", `/members/${member.id}/advances/${advanceId}`);

describe("campaign paid advancements", () => {
  before(async () => {
    await db.migrate.latest();
    server = createApp(db).listen(0);
    base = `http://127.0.0.1:${server.address().port}/api`;
    for (const name of ["owner", "viewer"]) {
      const response = await fetch(`${base}/auth/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: `paid_${name}_${Date.now()}`, password: "Paid-advance-test-123!" }),
      });
      assert.equal(response.status, 201);
      const auth = await response.json();
      users.push({ id: auth.user.id, token: auth.token });
    }
    warband = (await call("GET", "/warbands")).body.find((item) => item.name === "Reikland Mercenaries");
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

  test("campaign settings persist custom prices and caps, with purchases disabled by default", async () => {
    const plain = await call("POST", "/campaigns", { name: "Default purchase settings" });
    assert.equal(plain.status, 201);
    assert.deepEqual(plain.body.advancePurchaseRules, defaultPurchaseRules);
    const custom = rules();
    custom.stats.A = { firstCost: 9, additionalCost: 12, maxIncreases: 2 };
    custom.stats.S.maxIncreases = 0;
    custom.skillCost = 7;
    const { campaign, roster, member } = await fixture(custom);
    assert.deepEqual((await call("GET", `/campaigns/${campaign.id}`)).body.advancePurchaseRules, custom);
    const before = Number((await rosterData(roster)).treasury);
    const first = await purchase(member, { stat: "A" });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.history[0].purchaseCost, 9);
    const second = await purchase(member, { stat: "A" });
    assert.equal(second.status, 201);
    assert.equal(second.body.history[1].purchaseCost, 12);
    assert.equal((await purchase(member, { stat: "A" })).status, 409);
    assert.equal((await purchase(member, { stat: "S" })).status, 409);
    assert.equal(Number((await rosterData(roster)).treasury), before - 21);
    const invalid = rules();
    invalid.stats.T.additionalCost = -1;
    assert.equal((await call("POST", "/campaigns", { name: "Invalid", advancePurchaseRules: invalid })).status, 400);
  });

  test("disabling skill purchases preserves stat purchases and rejects direct skill requests", async () => {
    const custom = { ...rules(), skillsEnabled: false };
    const { campaign, roster, member } = await fixture(custom);
    assert.equal((await call("GET", `/campaigns/${campaign.id}`)).body.advancePurchaseRules.skillsEnabled, false);
    const first = await purchase(member, { stat: "A" });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.purchases.skillsEnabled, false);
    assert.equal(first.body.purchases.skillAllowance, 0);
    assert.deepEqual(first.body.purchases.availableSkills, []);
    const skill = await db("skills").where({ category: "Combat", warband_id: null }).first("id");
    const before = await rosterData(roster);
    const rejected = await purchase(member, { skillId: skill.id });
    assert.equal(rejected.status, 409);
    assert.match(rejected.body.error, /disabled/);
    assert.equal((await rosterData(roster)).treasury, before.treasury);
    assert.equal((await advanceData(member)).experience, first.body.experience);
    assert.equal((await purchase(member, { stat: "WS" })).status, 201);
  });

  test("legacy campaign settings retain skill purchase access", async () => {
    const { campaign, member } = await fixture();
    const legacy = rules();
    delete legacy.skillsEnabled;
    await db("campaigns").where({ id: campaign.id }).update({ advance_purchase_rules: JSON.stringify(legacy) });
    assert.equal((await call("GET", `/campaigns/${campaign.id}`)).body.advancePurchaseRules.skillsEnabled, true);
    const first = await purchase(member, { stat: "A" });
    assert.equal(first.status, 201);
    assert.equal(first.body.purchases.skillsEnabled, true);
    assert.ok(first.body.purchases.availableSkills.length > 0);
  });

  test("pistol singles and braces have separate prices, inventory units and refunds", async () => {
    const { roster, member } = await fixture();
    const gear = (await call("GET", `/members/${member.id}/equipment`)).body;
    for (const [singleName, braceName] of [["Pistol", "Brace of Pistols"], ["Duelling pistol", "Brace of Duelling Pistols"]]) {
      const single = gear.availableOptions.find((option) => option.name === singleName);
      const brace = gear.availableOptions.find((option) => option.name === braceName && option.listKey === single?.listKey);
      assert.ok(single);
      assert.ok(brace);
      assert.equal(brace.unitCost, single.unitCost * 2);
      assert.deepEqual(brace.stats, single.stats);
      assert.match(brace.ruleText, /counts? as one missile weapon/);
      const before = Number((await rosterData(roster)).treasury);
      const bought = await call("POST", `/members/${member.id}/equipment`, { equipmentOptionId: brace.id, quantity: 1, modelIndex: -1 });
      assert.equal(bought.status, 201, JSON.stringify(bought.body));
      const inventory = (await call("GET", `/members/${member.id}/equipment`)).body.inventory;
      const owned = inventory.find((item) => item.equipmentOptionId === brace.id);
      assert.equal(owned.quantity, 1);
      assert.equal(owned.unitCostPaid, brace.unitCost);
      assert.equal(Number((await rosterData(roster)).treasury), before - brace.unitCost);
      assert.equal((await call("DELETE", `/members/${member.id}/equipment/${owned.id}`)).status, 200);
      assert.equal(Number((await rosterData(roster)).treasury), before);
    }
  });

  test("stat and skill purchases advance XP once, obey normal eligibility, and refund recorded prices", async () => {
    const { roster, member } = await fixture();
    const startingGold = Number((await rosterData(roster)).treasury);
    assert.equal((await purchase(member, { skillId: "00000000-0000-0000-0000-000000000000" })).status, 409);
    const first = await purchase(member, { stat: "A" });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.experience, 2);
    assert.equal(first.body.stats.A, "2");
    assert.equal(first.body.pendingCount, 0);
    assert.equal(first.body.history[0].experienceBeforePurchase, 0);
    assert.equal(first.body.history[0].purchaseCost, 25);
    assert.equal(first.body.purchases.skillAllowance, 1);
    const skill = first.body.purchases.availableSkills[0];
    assert.ok(skill);
    const ineligible = await db("skills").where({ category: "Academic", warband_id: null }).first("id");
    assert.equal((await purchase(member, { skillId: ineligible.id })).status, 409);
    const bought = await purchase(member, { skillId: skill.id });
    assert.equal(bought.status, 201, JSON.stringify(bought.body));
    assert.equal(bought.body.experience, 4);
    assert.equal(bought.body.pendingCount, 0);
    assert.equal(bought.body.history[1].purchaseCost, 40);
    assert.equal(bought.body.purchases.skillAllowance, 0);
    assert.equal((await purchase(member, { skillId: skill.id })).status, 409);
    assert.equal((await refund(member, first.body.history[0].id)).status, 409);
    const learned = (await call("GET", `/members/${member.id}/skills`)).body.learnedSkills.find((item) => item.id === skill.id);
    assert.equal(learned.purchaseCost, 40);
    assert.equal((await call("DELETE", `/members/${member.id}/skills/${learned.warriorSkillId}`)).status, 200);
    assert.equal((await advanceData(member)).experience, 2);
    assert.equal(Number((await rosterData(roster)).treasury), startingGold - 25);
    assert.equal((await refund(member, first.body.history[0].id)).status, 200);
    assert.equal((await advanceData(member)).experience, 0);
    assert.equal((await advanceData(member)).stats.A, "1");
    assert.equal(Number((await rosterData(roster)).treasury), startingGold);
    assert.equal((await refund(member, first.body.history[0].id)).status, 404);
    assert.equal((await purchase(member, { stat: "A" })).body.history[0].purchaseCost, 25);
  });

  test("all configured prices and racial maximums are respected", async () => {
    const { member } = await fixture();
    const available = (await advanceData(member)).purchases.stats;
    assert.deepEqual(available.map((item) => [item.stat, item.cost]), [
      ["M", 15], ["WS", 15], ["BS", 15], ["S", 25], ["T", 30], ["W", 20], ["I", 10], ["A", 25], ["Ld", 15],
    ]);
    assert.equal((await purchase(member, { stat: "M" })).status, 409);
    for (const stat of ["S", "T"]) {
      assert.equal((await purchase(member, { stat })).status, 201);
      assert.equal((await purchase(member, { stat })).status, 409);
    }
    assert.equal((await purchase(member, { stat: "W" })).body.history.at(-1).purchaseCost, 20);
    assert.equal((await purchase(member, { stat: "W" })).body.history.at(-1).purchaseCost, 30);
    assert.equal((await purchase(member, { stat: "W" })).status, 409);
  });

  test("purchases are blocked for non-Heroes, disabled campaigns, Freebuild and later phases", async () => {
    const henchman = await fixture(rules(), "Marksmen (All Others)", "Henchman");
    assert.equal((await purchase(henchman.member, { stat: "WS" })).status, 409);
    const hired = await fixture(rules(), "Pit Fighter", "Hired Sword");
    assert.equal((await purchase(hired.member, { stat: "WS" })).status, 409);
    const disabled = await fixture(defaultPurchaseRules);
    assert.equal((await purchase(disabled.member, { stat: "WS" })).status, 409);
    const { roster, member } = await fixture();
    for (const phase of ["pre_battle", "battle", "post_battle"]) {
      await db("rosters").where({ id: roster.id }).update({ campaign_phase: phase, campaign_step: 8 });
      assert.equal((await purchase(member, { stat: "WS" })).status, 409);
    }
    await db("rosters").where({ id: roster.id }).update({ campaign_phase: "setup", battles_fought: 1 });
    assert.equal((await purchase(member, { stat: "WS" })).status, 409);
    await db("rosters").where({ id: roster.id }).update({ campaign_id: null, battles_fought: 0 });
    assert.equal((await purchase(member, { stat: "WS" })).status, 409);
  });

  test("treasury, XP bounds, pending awards and ownership are enforced without partial updates", async () => {
    const { roster, member } = await fixture();
    await db("rosters").where({ id: roster.id }).update({ treasury: 24 });
    assert.equal((await purchase(member, { stat: "A" })).status, 409);
    assert.equal((await advanceData(member)).experience, 0);
    assert.equal((await advanceData(member)).history.length, 0);
    await db("rosters").where({ id: roster.id }).update({ treasury: 25 });
    const bought = await purchase(member, { stat: "A" });
    assert.equal(bought.status, 201);
    assert.equal(Number((await rosterData(roster)).treasury), 0);
    const shared = (await call("POST", `/rosters/${roster.id}/share`)).body;
    await call("POST", "/shared-rosters/join", { code: shared.shareCode }, users[1]);
    assert.equal((await purchase(member, { stat: "WS" }, users[1])).status, 403);
    assert.equal((await call("DELETE", `/members/${member.id}/advances/${bought.body.history[0].id}`, undefined, users[1])).status, 403);
    assert.equal((await call("PATCH", `/members/${member.id}`, { experience: 1 })).status, 409);
    for (const input of [{}, { stat: "S", skillId: "x" }, { stat: 1 }, { skillId: null }]) assert.equal((await purchase(member, input)).status, 400);
    await db("warriors").where({ id: member.id }).update({ experience: 4 });
    assert.equal((await purchase(member, { stat: "WS" })).status, 409);
    assert.equal((await refund(member, bought.body.history[0].id)).status, 409);
    await db("warriors").where({ id: member.id }).update({ experience: 90, advance_baseline: 20 });
    assert.equal((await purchase(member, { stat: "WS" })).status, 409);
    assert.equal(Number((await rosterData(roster)).treasury), 0);
  });

  test("recorded purchase refunds are unavailable after creation and new XP", async () => {
    const { roster, member } = await fixture();
    const bought = await purchase(member, { stat: "WS" });
    assert.equal(bought.status, 201);
    const advanceId = bought.body.history[0].id;
    await db("rosters").where({ id: roster.id }).update({ campaign_phase: "post_battle", campaign_step: 2 });
    assert.equal((await refund(member, advanceId)).status, 409);
    assert.equal((await advanceData(member)).history[0].canRemove, false);
    assert.equal((await call("PATCH", `/members/${member.id}`, { experience: 3 })).status, 200);
    await db("rosters").where({ id: roster.id }).update({ campaign_phase: "setup" });
    assert.equal((await refund(member, advanceId)).status, 409);
    assert.equal((await advanceData(member)).experience, 3);
  });

  test("simultaneous purchases respect caps and simultaneous refunds cannot credit twice", async () => {
    const custom = rules();
    custom.stats.WS.maxIncreases = 1;
    const { roster, member } = await fixture(custom);
    const starting = Number((await rosterData(roster)).treasury);
    const purchases = await Promise.all([purchase(member, { stat: "WS" }), purchase(member, { stat: "WS" })]);
    assert.deepEqual(purchases.map((result) => result.status).sort(), [201, 409]);
    const data = await advanceData(member);
    assert.equal(data.experience, 2);
    assert.equal(data.history.length, 1);
    assert.equal(Number((await rosterData(roster)).treasury), starting - 15);
    const refunds = await Promise.all([refund(member, data.history[0].id), refund(member, data.history[0].id)]);
    assert.deepEqual(refunds.map((result) => result.status).sort(), [200, 404]);
    assert.equal(Number((await rosterData(roster)).treasury), starting);
    assert.equal((await advanceData(member)).experience, 0);
  });

  test("starting experience jumps to the actual next threshold and zero-price purchases still track limits", async () => {
    const { member } = await fixture(rules(), "Mercenary Captain");
    assert.equal(Number(member.experience), 20);
    const bought = await purchase(member, { stat: "WS" });
    assert.equal(bought.status, 201);
    assert.equal(bought.body.experience, 24);
    assert.equal(bought.body.pendingCount, 0);
    assert.equal(bought.body.history[0].experienceBeforePurchase, 20);
    assert.equal((await refund(member, bought.body.history[0].id)).body.experience, 20);
    const free = rules();
    free.stats.A = { firstCost: 0, additionalCost: 0, maxIncreases: 1 };
    free.skillCost = 0;
    const fixtureFree = await fixture(free);
    const starting = Number((await rosterData(fixtureFree.roster)).treasury);
    const freeStat = await purchase(fixtureFree.member, { stat: "A" });
    assert.equal(freeStat.status, 201);
    assert.equal(freeStat.body.history[0].purchaseCost, 0);
    assert.equal(freeStat.body.experience, 2);
    assert.equal((await purchase(fixtureFree.member, { stat: "A" })).status, 409);
    const skill = freeStat.body.purchases.availableSkills[0];
    const freeSkill = await purchase(fixtureFree.member, { skillId: skill.id });
    assert.equal(freeSkill.body.experience, 4);
    assert.equal(freeSkill.body.history[1].purchaseCost, 0);
    assert.equal(Number((await rosterData(fixtureFree.roster)).treasury), starting);
    assert.equal((await refund(fixtureFree.member, freeSkill.body.history[1].id)).status, 200);
    assert.equal((await refund(fixtureFree.member, freeStat.body.history[0].id)).status, 200);
    assert.equal((await advanceData(fixtureFree.member)).experience, 0);
    assert.equal(Number((await rosterData(fixtureFree.roster)).treasury), starting);
  });
});
