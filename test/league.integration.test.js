const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const knex = require("knex");
const { createApp } = require("../src/app");
const db = knex(require("../knexfile")[process.env.NODE_ENV || "development"]);
const users = [], campaigns = [];
let server, base, commissioner, player, third, absent, outsider, campaign, rosters, warband, catalog;
async function call(method, route, body, token = commissioner?.token) {
  const res = await fetch(`${base}${route}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw && res.headers.get("content-type")?.includes("json") ? JSON.parse(raw) : raw };
}
async function expect(method, route, body, status = 200, token) {
  const result = await call(method, route, body, token);
  assert.equal(result.status, status, JSON.stringify(result.body));
  return result.body;
}
async function register() {
  const data = await expect("POST", "/auth/register", {
    username: `league_${randomUUID().slice(0, 14)}`, password: "League-test-password-123!",
  }, 201);
  users.push(data.user.id); return data;
}
async function createWarband(owner, name, existing) {
  const roster = existing ?? await expect("POST", "/rosters", { campaignId: campaign.id, warbandId: warband.id, name }, 201, owner.token);
  const type = (await expect("GET", `/warbands/${warband.id}/warrior-types`)).find((t) => t.name === "Youngblood");
  const hero = await expect("POST", `/rosters/${roster.id}/members`, { name: "Test hero", role: "Hero", warriorTypeId: type.id }, 201, owner.token);
  await expect("POST", `/rosters/${roster.id}/campaign/advance`, {}, 200, owner.token);
  return { ...roster, heroId: hero.id };
}
const schedule = (number, scenarioId, tables, absences = []) => ({
  scenarioId, startsAt: `2026-12-${String(number * 7).padStart(2, "0")}T18:00:00Z`,
  endsAt: `2026-12-${String(number * 7 + 6).padStart(2, "0")}T22:00:00Z`,
  timezone: "America/Denver", location: "Club", tables, absences,
});
const league = () => expect("GET", `/campaigns/${campaign.id}/league`);
const action = (round, act, token) => expect("POST", `/campaigns/${campaign.id}/rounds/${round.id}/${act}`, {}, 200, token);
async function prepare(roster, owner) {
  for (let i = 0; i < 2; i++) await expect("POST", `/rosters/${roster.id}/campaign/advance`, { scenario: "Not the assigned scenario" }, 200, owner.token);
}
before(async () => {
  await db.migrate.latest();
  server = createApp(db, { log() {} }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  commissioner = await register(); player = await register(); third = await register(); absent = await register(); outsider = await register();
  campaign = await expect("POST", "/campaigns", { name: "2026 league test" }, 201);
  campaigns.push(campaign.id);
  for (const owner of [player, third, absent]) await expect("POST", "/campaigns/join", { code: campaign.inviteCode }, 200, owner.token);
  warband = (await expect("GET", "/warbands")).find((w) => w.name === "Reikland Mercenaries");
  catalog = await expect("GET", "/scenarios");
  rosters = [];
  for (const [i, owner] of [commissioner, player, third, absent].entries()) rosters.push(await createWarband(owner, `League ${i}`));
});
after(async () => {
  for (const id of campaigns) {
    await db("battles").where({ campaign_id: id }).delete();
    await db("rosters").where({ campaign_id: id }).delete();
    await db("campaigns").where({ id }).delete();
  }
  for (const id of users) await db("users").where({ id }).delete();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.destroy();
});
test("commissioner rules remain member-readable, owner-only and prospective; examples are available", async () => {
  const template = await expect("GET", "/league/templates/2026");
  assert.equal(template.scenarios.length, 10);
  await expect("PATCH", `/campaigns/${campaign.id}`, { scenarioLimit: 2, maxGc: 700, maxWarbandsPerPlayer: 1, allowedWarbandIds: [warband.id], houseRules: template.houseRules });
  await expect("PATCH", `/campaigns/${campaign.id}`, { houseRules: "Not mine" }, 403, player.token);
  await expect("GET", `/campaigns/${campaign.id}/league`, undefined, 403, outsider.token);
  const visible = await expect("GET", `/campaigns/${campaign.id}`, undefined, 200, player.token);
  assert.equal(visible.maxGc, 700);
  assert.equal(visible.houseRules, template.houseRules);
  assert.equal(Number((await expect("GET", `/rosters/${rosters[0].id}`)).treasury), 485);
  await expect("POST", "/rosters", { campaignId: campaign.id, warbandId: warband.id }, 409);
  const other = (await expect("GET", "/warbands")).find((w) => w.id !== warband.id);
  await expect("POST", "/rosters", { campaignId: campaign.id, warbandId: other.id }, 409, player.token);
  const current = await expect("GET", `/campaigns/${campaign.id}`);
  await expect("PATCH", `/campaigns/${campaign.id}`, { tradingRules: { ...current.tradingRules, overrides: { dagger: { baseCost: 3 } } } });
  assert.equal((await expect("GET", `/campaigns/${campaign.id}`)).tradingRules.overrides.dagger.baseCost, 3);
});
test("structured custom scenarios import as independent copies and retain original map references", async () => {
  const example = catalog.find((s) => s.id === "2026-01");
  const created = await expect("POST", "/scenarios", { ...example, name: "Custom team game" }, 201);
  await expect("POST", "/scenarios", { ...created, format: "ffa" }, 400);
  assert.ok(!(await expect("GET", "/scenarios", undefined, 200, player.token)).some((s) => s.id === created.id));
  const copy = await expect("POST", "/scenarios/import", { code: created.shareCode }, 201, player.token);
  assert.notEqual(copy.id, created.id);
  assert.equal(copy.rules, example.rules);
  assert.equal(copy.documentUrl, example.documentUrl);
  assert.notEqual(copy.shareCode, created.shareCode);
  await expect("POST", "/scenarios/import", { code: "bad" }, 400);
});
test("schedule covers each player, absences, scenario limits, edits and private calendar export", async () => {
  const first = schedule(1, "2026-01", [[commissioner.user.id, player.user.id, third.user.id]], [absent.user.id]);
  await expect("POST", `/campaigns/${campaign.id}/rounds`, first, 403, player.token);
  await expect("POST", `/campaigns/${campaign.id}/rounds`, { ...first, absences: [] }, 400);
  const scheduled = await expect("POST", `/campaigns/${campaign.id}/rounds`, first, 201);
  await expect("PATCH", `/campaigns/${campaign.id}/rounds/${scheduled.id}`, { ...first, location: "New venue" });
  await expect("POST", `/campaigns/${campaign.id}/rounds`, first, 409);
  await expect("POST", `/campaigns/${campaign.id}/rounds`, schedule(2, "2026-04", [[commissioner.user.id, player.user.id, third.user.id, absent.user.id]]), 201);
  await expect("POST", `/campaigns/${campaign.id}/rounds`, schedule(3, "2026-01", first.tables, first.absences), 409);
  await expect("PATCH", `/campaigns/${campaign.id}`, { scenarioLimit: 1 }, 409);
  await expect("DELETE", `/rosters/${rosters[0].id}`, undefined, 409);
  const suggested = await expect("POST", `/campaigns/${campaign.id}/pairings/suggest`, { tableSize: 4, minPlayers: 2, strategy: "rating" });
  assert.equal(suggested.tables[0].length, 4);
  const ics = await expect("GET", `/campaigns/${campaign.id}/calendar.ics`, undefined, 200, player.token);
  assert.match(ics, /BEGIN:VCALENDAR/); assert.match(ics, /New venue/);
  await expect("GET", `/campaigns/${campaign.id}/calendar.ics`, undefined, 403, outsider.token);
});
test("tables resolve teams at the event and finalize consistent results exactly once", async () => {
  const [first, second] = (await league()).rounds;
  await expect("POST", `/rosters/${rosters[0].id}/campaign/advance`, {}, 409);
  await expect("POST", `/campaigns/${campaign.id}/rounds/${second.id}/start`, {}, 409);
  await expect("POST", `/campaigns/${campaign.id}/rounds/${first.id}/start`, {}, 403, player.token);
  const starts = await Promise.all([call("POST", `/campaigns/${campaign.id}/rounds/${first.id}/start`, {}), call("POST", `/campaigns/${campaign.id}/rounds/${first.id}/start`, {})]);
  assert.deepEqual(starts.map((r) => r.status).sort(), [200, 409]);
  await expect("POST", `/rosters/${rosters[2].id}/campaign/advance`, {}, 200, third.token);
  const attendance = `/campaigns/${campaign.id}/rounds/${first.id}/attendance`;
  const reduced = { tables: [[commissioner.user.id, player.user.id]], absences: [third.user.id, absent.user.id] };
  await expect("POST", attendance, reduced, 403, player.token);
  await expect("POST", attendance, reduced);
  assert.equal((await expect("GET", `/rosters/${rosters[2].id}`, undefined, 200, third.token)).campaign.step, 1);
  await expect("POST", attendance, { tables: first.tables, absences: first.absences });
  const game = (await league()).rounds[0].games[0];
  const table = `/campaigns/${campaign.id}/tables/${game.id}`;
  await expect("POST", `/campaigns/${campaign.id}/battles`, { format: "1v1" }, 409);
  await expect("POST", `${table}/start`, {}, 403, absent.token);
  await expect("POST", `${table}/start`, {}, 409);
  await expect("POST", `${table}/teams`, { teams: [null, null, null] }, 400);
  const teams = game.seats.map((s, i) => ({ playerId: s.playerId, team: i < 2 ? "A" : "B" }));
  await expect("POST", `${table}/teams`, { teams }, 200, player.token);
  await expect("POST", `${table}/start`, {}, 409);
  for (const [i, owner] of [commissioner, player, third].entries()) {
    await prepare(rosters[i], owner);
    assert.equal((await expect("GET", `/rosters/${rosters[i].id}`)).campaign.scenario, "The Poor Quarter Thieves Hideout");
  }
  await expect("POST", `${table}/start`, {}, 200, player.token);
  await expect("POST", attendance, reduced, 409);
  const injuryOptions = await expect("GET", `/members/${rosters[0].heroId}/injuries`);
  assert.deepEqual(injuryOptions.hatredOpponents.map((r) => r.name), [rosters[2].name]);
  await expect("POST", `/campaigns/${campaign.id}/rounds/${first.id}/complete`, {}, 409);
  await expect("POST", `${table}/teams`, { teams }, 409);
  const results = teams.map((s) => ({ playerId: s.playerId, outcome: s.team === "A" ? "win" : "loss" }));
  await expect("POST", `${table}/results`, { results: results.map((r) => ({ ...r, outcome: "win" })) }, 400);
  const writes = await Promise.all([call("POST", `${table}/results`, { results, notes: "Rewards applied manually." }), call("POST", `${table}/results`, { results })]);
  assert.deepEqual(writes.map((r) => r.status).sort(), [200, 409]);
  await expect("POST", `/campaigns/${campaign.id}/rounds/${first.id}/absence-notes`, { playerId: absent.user.id, notes: "30gc and participation XP to be applied manually by the player." });
  assert.match((await league()).rounds[0].absenceNotes[absent.user.id].notes, /30gc/);
  assert.equal((await expect("GET", `/rosters/${rosters[3].id}`, undefined, 200, absent.token)).campaign.phase, "pre_battle");
  await action(first, "complete");
  await expect("POST", `/campaigns/${campaign.id}/rounds/${second.id}/start`, {}, 409);
});
test("catch-up awards are commissioner-approved, capped and applied once without counting a battle", async () => {
  const first = (await league()).rounds[0];
  const path = `/campaigns/${campaign.id}/rounds/${first.id}/catch-up`;
  const body = { playerId: absent.user.id, gold: 30, experience: 2 };
  await expect("POST", path, body, 403, absent.token);
  await expect("POST", path, { ...body, gold: -1 }, 400);
  await db("warriors").where({ id: rosters[3].heroId }).update({ experience: 89 });
  const before = await expect("GET", `/rosters/${rosters[3].id}`, undefined, 200, absent.token);
  const writes = await Promise.all([call("POST", path, body), call("POST", path, body)]);
  assert.deepEqual(writes.map((r) => r.status).sort(), [200, 409]);
  const after = await expect("GET", `/rosters/${rosters[3].id}`, undefined, 200, absent.token);
  assert.equal(Number(after.treasury), Number(before.treasury) + 30);
  assert.equal(Number(after.members.find((m) => m.id === rosters[3].heroId).experience), 90);
  assert.equal(after.campaign.battlesFought, before.campaign.battlesFought);
  const record = (await league()).rounds[0].absenceNotes[absent.user.id];
  assert.equal(record.award.experienceAwards[0].experience, 1);
  await expect("POST", `/campaigns/${campaign.id}/rounds/${first.id}/absence-notes`, { playerId: absent.user.id, notes: "Catch-up confirmed." });
  assert.deepEqual((await league()).rounds[0].absenceNotes[absent.user.id].award, record.award);
});
test("commissioner advances post-battle steps; replacements preserve player standings and original game snapshots", async () => {
  await expect("POST", `/campaigns/${campaign.id}/warbands/${rosters[0].id}/post-battle/advance`, {}, 403, player.token);
  for (const roster of rosters.slice(0, 3)) for (let i = 0; i < 10; i++) await expect("POST", `/campaigns/${campaign.id}/warbands/${roster.id}/post-battle/advance`, {});
  const old = rosters[0];
  await expect("POST", `/campaigns/${campaign.id}/warbands/${old.id}/retire`, {}, 403, player.token);
  await expect("POST", `/campaigns/${campaign.id}/warbands/${old.id}/retire`, {});
  await expect("PATCH", `/rosters/${old.id}`, { name: "Changed history" }, 409);
  await expect("PATCH", `/members/${old.heroId}`, { name: "Changed hero" }, 409);
  const enrollments = await Promise.all([0, 1].map(() => call("POST", "/rosters", { campaignId: campaign.id, warbandId: warband.id, name: "Replacement league warband" })));
  assert.deepEqual(enrollments.map((r) => r.status).sort(), [201, 409]);
  rosters[0] = await createWarband(commissioner, "Replacement league warband", enrollments.find((r) => r.status === 201).body);
  assert.equal(Number(rosters[0].treasury), 700);
  const data = await league();
  assert.equal(data.standings.find((p) => p.id === commissioner.user.id).wins, 1);
  assert.equal(data.rounds[0].games[0].seats.find((s) => s.playerId === commissioner.user.id).rosterId, old.id);
  assert.equal(data.rosters.find((r) => r.id === old.id).league_retired, true);
});
test("individual scenarios allow independent outcomes, tie results, and finite or indefinite continuation", async () => {
  const second = (await league()).rounds[1];
  await action(second, "start");
  const game = (await league()).rounds[1].games[0];
  assert.equal(game.seats.find((s) => s.playerId === commissioner.user.id).rosterId, rosters[0].id);
  for (const [i, owner] of [commissioner, player, third, absent].entries()) await prepare(rosters[i], owner);
  const table = `/campaigns/${campaign.id}/tables/${game.id}`;
  await expect("POST", `${table}/teams`, { teams: [] }, 409);
  await expect("POST", `${table}/start`, {});
  assert.equal((await expect("GET", `/members/${rosters[0].heroId}/injuries`)).hatredOpponents.length, 3);
  const results = game.seats.map((s, i) => ({ playerId: s.playerId, outcome: ["win", "draw", "loss", "draw"][i], score: [12, 4, 0, 4][i] }));
  await expect("POST", `${table}/results`, { results }, 403, outsider.token);
  await expect("POST", `${table}/results`, { results });
  await action(second, "complete");
  let data = await league();
  assert.equal(data.finished, true);
  assert.equal(data.standings.find((p) => p.id === commissioner.user.id).wins, 2);
  assert.equal(data.standings.find((p) => p.id === absent.user.id).draws, 1);
  await expect("PATCH", `/campaigns/${campaign.id}`, { scenarioLimit: null });
  data = await league();
  assert.equal(data.finished, false);
  await expect("POST", `/campaigns/${campaign.id}/rounds`, schedule(3, "2026-01", [[commissioner.user.id, player.user.id], [third.user.id, absent.user.id]]), 201);
});

test("campaign setup accepts league settings at creation and commissioners may append custom items", async () => {
  const template = await expect("GET", "/league/templates/2026");
  const options = await expect("GET", "/league/rule-options");
  assert.ok(options.optionalRules.some((rule) => rule.id === "critical-hits-by-weapon" && rule.automation === "manual"));
  const item = (name) => ({ id: `custom-${randomUUID()}`, name, description: "House item", category: "misc", baseCost: 10, priceDice: 0, priceMultiplier: 1, rarity: null, sourceReference: "Campaign custom item" });
  const created = await expect("POST", "/campaigns", {
    name: "Setup view campaign", maxGc: template.preset.maxGc, scenarioLimit: template.preset.scenarioLimit,
    houseRules: template.houseRules, allowedWarbandIds: [warband.id], maxWarbandsPerPlayer: 1,
    advancePurchaseRules: template.preset.advancePurchaseRules, houseRuleOptions: template.preset.houseRuleOptions,
    tradingRules: { overrides: {}, customItems: [item("Lucky charm copy")] },
  }, 201);
  campaigns.push(created.id);
  assert.equal(created.maxGc, 700);
  assert.equal(created.scenarioLimit, 10);
  assert.deepEqual(created.allowedWarbandIds, [warband.id]);
  assert.deepEqual(created.houseRuleOptions, template.preset.houseRuleOptions);
  assert.equal(created.advancePurchaseRules.costEscalation, "hero");
  assert.equal(created.houseRules.length, template.houseRules.length);
  await expect("POST", "/campaigns", { name: "Bad options", houseRuleOptions: { optionalRules: ["nope"] } }, 400);
  await expect("POST", "/campaigns", { name: "Bad warbands", allowedWarbandIds: [randomUUID()] }, 400);

  const existing = created.tradingRules.customItems;
  await expect("PATCH", `/campaigns/${created.id}`, { tradingRules: { overrides: {}, customItems: [] } }, 409);
  const appended = await expect("PATCH", `/campaigns/${created.id}`, {
    tradingRules: { overrides: {}, customItems: [...existing, item("Commissioner addition")] },
    houseRuleOptions: { optionalRules: ["critical-hits-by-weapon"], startingBonus: null },
  });
  assert.deepEqual(appended.tradingRules.customItems.map((entry) => entry.name), ["Lucky charm copy", "Commissioner addition"]);
  assert.deepEqual(appended.houseRuleOptions, { optionalRules: ["critical-hits-by-weapon"], startingBonus: null });
  assert.equal(await db("shop_items").where({ campaign_id: created.id }).count("id as count").first().then((row) => Number(row.count)), 2);
  await expect("PATCH", `/campaigns/${created.id}`, { houseRuleOptions: { startingBonus: { stats: ["W"], pool: 4 } } }, 400);
  await expect("PATCH", `/campaigns/${created.id}`, { houseRuleOptions: {} }, 403, player.token);
});

test("commissioners delete campaigns permanently after typing the name; warbands move to Freebuild", async () => {
  const item = (name) => ({ id: `custom-${randomUUID()}`, name, description: "House item", category: "misc", baseCost: 10, priceDice: 0, priceMultiplier: 1, rarity: null, sourceReference: "Campaign custom item" });
  const doomed = await expect("POST", "/campaigns", { name: "Doomed campaign", tradingRules: { overrides: {}, customItems: [item("Kept charm"), item("Unused charm")] } }, 201);
  campaigns.push(doomed.id);
  await expect("POST", "/campaigns/join", { code: doomed.inviteCode }, 200, player.token);
  const own = await expect("POST", "/rosters", { campaignId: doomed.id, warbandId: warband.id, name: "Survivor" }, 201);
  const other = await expect("POST", "/rosters", { campaignId: doomed.id, warbandId: warband.id, name: "Player survivor" }, 201, player.token);
  const [kept, unused] = doomed.tradingRules.customItems.map((entry) => `${doomed.id}/${entry.id}`);
  await db("warband_stash").insert({ roster_id: own.id, shop_item_id: kept, quantity: 1, unit_cost_paid: 10 });
  await expect("POST", `/campaigns/${doomed.id}/rounds`, schedule(1, "2026-01", [[commissioner.user.id, player.user.id]]), 201);
  await db("rosters").where({ id: other.id }).update({ league_retired: true });
  await db("rosters").where({ id: own.id }).update({ campaign_phase: "post_battle", campaign_step: 3 });

  await expect("DELETE", `/campaigns/${doomed.id}`, { confirmName: "Doomed campaign" }, 403, player.token);
  await expect("DELETE", `/campaigns/${doomed.id}`, {}, 400);
  await expect("DELETE", `/campaigns/${doomed.id}`, { confirmName: "doomed campaign" }, 400);
  assert.deepEqual(await expect("DELETE", `/campaigns/${doomed.id}`, { confirmName: " Doomed campaign " }), { deleted: true, movedWarbandCount: 2 });

  assert.equal(await db("campaigns").where({ id: doomed.id }).first(), undefined);
  assert.equal(await db("campaign_rounds").where({ campaign_id: doomed.id }).first(), undefined);
  assert.equal(await db("campaign_members").where({ campaign_id: doomed.id }).first(), undefined);
  for (const roster of await db("rosters").whereIn("id", [own.id, other.id])) {
    assert.equal(roster.campaign_id, null);
    assert.equal(roster.campaign_phase, "setup");
    assert.equal(roster.campaign_step, 1);
    assert.equal(roster.league_retired, false);
  }
  assert.equal((await db("shop_items").where({ id: kept }).first()).campaign_id, null);
  assert.equal(await db("shop_items").where({ id: unused }).first(), undefined);
  const stash = await expect("GET", `/rosters/${own.id}/trading`);
  assert.ok(stash.stash.some((entry) => entry.name === "Kept charm"));
  await expect("PATCH", `/rosters/${other.id}`, { name: "Player survivor (Freebuild)" }, 200, player.token);
  assert.ok(!(await expect("GET", "/campaigns")).some((entry) => entry.id === doomed.id));
  await expect("DELETE", `/campaigns/${doomed.id}`, { confirmName: "Doomed campaign" }, 404);
  await db("rosters").whereIn("id", [own.id, other.id]).delete();
  await db("shop_items").where({ id: kept }).delete();
});
