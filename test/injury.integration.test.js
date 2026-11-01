const { before, after, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const knex = require("knex");
const { createApp } = require("../src/app");
const db = knex(require("../knexfile")[process.env.NODE_ENV || "development"]);
let server, base, token, userId, band, types;

async function call(method, path, body, auth = token) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
async function fixture(role = "Hero", extra = {}) {
  const roster = await call("POST", "/rosters", { warbandId: band.id, treasury: 5000, battlesFought: 1, ...extra });
  assert.equal(roster.status, 201, JSON.stringify(roster.body));
  const type = types.find((type) => type.category === role && type.name === (role === "Hero" ? "Youngblood" : role === "Henchman" ? "Warriors (All Other)" : "Pit Fighter"));
  assert.ok(type, role);
  const hired = await call("POST", `/rosters/${roster.body.id}/members`, {
    name: "Injury test", role, warriorTypeId: type.id, ...(role === "Henchman" ? { groupSize: 3 } : {}),
  });
  assert.equal(hired.status, 201, JSON.stringify(hired.body));
  return { roster: roster.body, member: hired.body, path: `/members/${hired.body.id}/injuries` };
}
async function record(f, selection, extra = {}) {
  const preview = await call("POST", `${f.path}/preview`, { mode: "manual", modelIndex: 0, selection, ...extra });
  assert.equal(preview.status, 201, JSON.stringify(preview.body));
  return call("POST", `${f.path}/${preview.body.id}/apply`, {});
}

describe("persistent post-battle injuries", () => {
  before(async () => {
    await db.migrate.latest();
    server = createApp(db).listen(0);
    base = `http://127.0.0.1:${server.address().port}/api`;
    const auth = await call("POST", "/auth/register", { username: `injury_${randomUUID().slice(0, 20)}`, password: "Injury-tests-12345!" });
    token = auth.body.token; userId = auth.body.user.id;
    band = (await call("GET", "/warbands")).body.find((band) => band.name === "Reikland Mercenaries");
    types = (await call("GET", `/warbands/${band.id}/warrior-types`)).body;
  });
  after(async () => {
    if (userId) {
      await db("rosters").where({ user_id: userId }).delete();
      await db("campaigns").where({ owner_id: userId }).delete();
      await db("users").where({ id: userId }).delete();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.destroy();
  });
  test("preview and cancellation save no effects; confirmation adjusts stats exactly once", async () => {
    const f = await fixture();
    const before = await db("warriors").where({ id: f.member.id }).first();
    const p = await call("POST", `${f.path}/preview`, { mode: "manual", selection: { resultId: "leg-wound" } });
    assert.equal(p.status, 201);
    assert.deepEqual(await db("warriors").where({ id: f.member.id }).first(), before);
    assert.equal((await call("DELETE", `${f.path}/${p.body.id}`)).status, 204);
    assert.equal((await db("warrior_injuries").where({ warrior_id: f.member.id })).length, 0);
    const preview = await call("POST", `${f.path}/preview`, { mode: "manual", selection: { resultId: "chest-wound" } });
    const applied = await call("POST", `${f.path}/${preview.body.id}/apply`, {});
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    const after = await db("warriors").where({ id: f.member.id }).first();
    assert.equal(Number(after.stats.T), Number(before.stats.T) - 1);
    assert.equal(after.experience, before.experience);
    assert.equal((await call("POST", `${f.path}/${preview.body.id}/apply`, {})).status, 404);
    const roster = (await call("GET", `/rosters/${f.roster.id}`)).body;
    assert.equal(roster.members.find((member) => member.id === f.member.id).injuryConditions[0].stat, "T");
    assert.equal(roster.injuryHistory.length, 1);
    assert.equal(roster.injuryHistory[0].result.effects[0].previousValue, Number(before.stats.T));
    assert.equal(roster.injuryHistory[0].result.effects[0].currentValue, Number(before.stats.T) - 1);
  });
  test("Bitter Enmity targets can be entered at confirmation without rerolling, with validation and independent nested targets", async () => {
    const f = await fixture();
    assert.equal((await call("GET", f.path)).body.hatredOpponents, null);
    const preview = await call("POST", `${f.path}/preview`, { mode: "manual", selection: {
      resultId: "multiple-injuries", secondaryRoll: 2, injuries: [
        { resultId: "bitter-enmity", secondaryRoll: 5 }, { resultId: "bitter-enmity", secondaryRoll: 6 },
      ],
    } });
    assert.equal(preview.status, 201);
    const path = `${f.path}/${preview.body.id}/apply`;
    for (const hatredTargets of [null, ["Only one"], ["Enemy", 1], ["Enemy", "x".repeat(301)], ["A", "B", "C"]]) {
      assert.equal((await call("POST", path, { hatredTargets })).status, 400);
    }
    assert.equal((await db("warrior_injuries").where({ warrior_id: f.member.id })).length, 0);
    assert.equal((await call("POST", path, { hatredTargets: ["  Enemy band  ", "All Skaven warbands"] })).status, 200);
    const result = (await call("GET", f.path)).body;
    assert.deepEqual(result.conditions.filter((effect) => effect.type === "hatred").map((effect) => effect.targetDescription),
      ["Enemy band", "All Skaven warbands"]);
    assert.deepEqual(result.history.map((entry) => entry.result.secondaryRoll).sort(), [5, 6]);
    assert.ok(result.history.some((entry) => entry.result.hatredTarget === "Enemy band"));
    assert.equal((await call("POST", path, { hatredTargets: ["A", "B"] })).status, 404);
  });
  test("Injury correction reverses stats and conditions without overwriting unrelated changes, then rejects replay", async () => {
    const f = await fixture();
    const original = await db("warriors").where({ id: f.member.id }).first();
    const applied = await record(f, { resultId: "leg-wound" });
    const path = `/rosters/${f.roster.id}/injuries/${applied.body.injuryId}`;
    assert.equal((await call("GET", f.path)).body.history[0].canRemove, true);
    await db("warriors").where({ id: f.member.id }).update({ notes: "Keep this new note", name: "Renamed Hero" });
    assert.equal((await call("DELETE", path)).status, 200);
    const restored = await db("warriors").where({ id: f.member.id }).first();
    assert.deepEqual(restored.stats, original.stats);
    assert.deepEqual(restored.injury_conditions, []);
    assert.equal(restored.notes, "Keep this new note");
    assert.equal(restored.name, "Renamed Hero");
    assert.equal((await call("DELETE", path)).status, 404);
  });
  test("Correction blocks dependent stat changes but allows independent injuries and reverse-order corrections", async () => {
    const f = await fixture();
    const original = (await db("warriors").where({ id: f.member.id }).first()).stats;
    const first = await record(f, { resultId: "leg-wound" });
    const independent = await record(f, { resultId: "madness", secondaryRoll: 6 });
    assert.equal((await call("DELETE", `/rosters/${f.roster.id}/injuries/${first.body.injuryId}`)).status, 200);
    assert.equal((await call("GET", f.path)).body.conditions[0].rule, "frenzy");
    assert.equal((await call("DELETE", `/rosters/${f.roster.id}/injuries/${independent.body.injuryId}`)).status, 200);
    const wound = await record(f, { resultId: "leg-wound" });
    const later = await record(f, { resultId: "leg-wound" });
    const blocked = await call("DELETE", `/rosters/${f.roster.id}/injuries/${wound.body.injuryId}`);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /M was changed/);
    assert.equal((await call("DELETE", `/rosters/${f.roster.id}/injuries/${later.body.injuryId}`)).status, 200);
    assert.equal((await call("DELETE", `/rosters/${f.roster.id}/injuries/${wound.body.injuryId}`)).status, 200);
    assert.deepEqual((await db("warriors").where({ id: f.member.id }).first()).stats, original);
  });
  test("Correction returns pit XP and gold, restores the previous XP floor, and blocks dependent advances", async () => {
    const f = await fixture();
    const before = await db("warriors").where({ id: f.member.id }).first();
    const treasury = (await db("rosters").where({ id: f.roster.id }).first()).treasury;
    const pit = await record(f, { resultId: "sold-to-the-pits", pitOutcome: "won" });
    const path = `/rosters/${f.roster.id}/injuries/${pit.body.injuryId}`;
    const [advance] = await db("warrior_advances").insert({ warrior_id: f.member.id, advance_table: "Hero",
      experience_threshold: 2, mode: "manual", result: "new_skill" }).returning("*");
    assert.equal((await call("DELETE", path)).status, 409);
    await db("warrior_advances").where({ id: advance.id }).delete();
    await db("rosters").where({ id: f.roster.id }).update({ treasury: 49 });
    assert.equal((await call("DELETE", path)).status, 409);
    await db("rosters").where({ id: f.roster.id }).update({ treasury: treasury + 50 });
    const result = await call("DELETE", path);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const after = await db("warriors").where({ id: f.member.id }).first();
    assert.equal(after.experience, before.experience);
    assert.equal(after.injury_experience_floor, before.injury_experience_floor);
    assert.equal((await db("rosters").where({ id: f.roster.id }).first()).treasury, treasury);
  });
  test("Correction restores lost gear and pending pit resolution, blocking replacement gear first", async () => {
    const f = await fixture();
    await db("warrior_inventory").insert({ warrior_id: f.member.id, shop_item_id: "sword", quantity: 1, model_index: 0, unit_cost_paid: 10 });
    const gear = await db("warrior_inventory").where({ warrior_id: f.member.id }).orderBy("id");
    await record(f, { resultId: "sold-to-the-pits" });
    const pending = (await call("GET", f.path)).body.history.find((entry) => entry.pending);
    const loss = await record(f, { resultId: "sold-to-the-pits", pitOutcome: "lost",
      pitInjury: { resultId: "hand-injury" } }, { resolvesId: pending.id });
    const losses = await db("warrior_injuries").whereIn("id", loss.body.injuryIds);
    const equipmentLoss = losses.find((entry) => entry.result.effects.some((effect) => effect.type === "lose-equipment"));
    const wound = losses.find((entry) => entry.result.effects.some((effect) => effect.type === "stat-modifier"));
    const [replacement] = await db("warrior_inventory").insert({ warrior_id: f.member.id, shop_item_id: "sword",
      quantity: 1, model_index: 0, unit_cost_paid: 10 }).returning("*");
    const path = `/rosters/${f.roster.id}/injuries/${equipmentLoss.id}`;
    const blocked = await call("DELETE", path);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /equipment was changed or replaced/);
    await db("warrior_inventory").where({ id: replacement.id }).delete();
    assert.equal((await call("DELETE", path)).status, 200);
    assert.deepEqual(await db("warrior_inventory").where({ warrior_id: f.member.id }).orderBy("id"), gear);
    assert.ok((await call("GET", f.path)).body.history.some((entry) => entry.id === pending.id && entry.pending));
    assert.equal((await call("DELETE", `/rosters/${f.roster.id}/injuries/${wound.id}`)).status, 200);
  });
  test("Accidental death correction restores the Hero and earlier injury records, subject to capacity", async () => {
    const f = await fixture();
    await record(f, { resultId: "leg-wound" });
    const original = await db("warriors").where({ id: f.member.id }).first();
    const death = await record(f, { resultId: "dead" });
    const path = `/rosters/${f.roster.id}/injuries/${death.body.injuryId}`;
    const activeRoster = (await call("GET", `/rosters/${f.roster.id}`)).body;
    assert.ok(activeRoster.injuryHistory.find((entry) => entry.id === death.body.injuryId).canRemove);
    const fillers = Array.from({ length: 6 }, () => randomUUID());
    await db("warriors").insert(fillers.map((id, index) => ({ ...original, id, warrior_type_id: null,
      injury_conditions: JSON.stringify(original.injury_conditions), position: index + 1 })));
    assert.equal((await call("DELETE", path)).status, 409);
    assert.equal((await db("hero_graveyard").where({ roster_id: f.roster.id })).length, 1);
    await db("warriors").whereIn("id", fillers).delete();
    const restored = await call("DELETE", path);
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.deepEqual((await db("warriors").where({ id: f.member.id }).first()).stats, original.stats);
    assert.equal((await db("hero_graveyard").where({ roster_id: f.roster.id })).length, 0);
    const history = (await call("GET", f.path)).body.history;
    assert.equal(history.length, 1);
    assert.equal(history[0].result.id, "leg-wound");
  });
  test("Henchman model and whole-group casualty correction restores equipment and counts", async () => {
    const f = await fixture("Henchman");
    const before = await db("warriors").where({ id: f.member.id }).first();
    const gear = await db("warrior_inventory").where({ warrior_id: f.member.id }).orderBy("id");
    const casualty = await record(f, { resultId: "removed-from-warband" }, { modelIndex: 1 });
    const result = await call("DELETE", `/rosters/${f.roster.id}/injuries/${casualty.body.injuryId}`);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal((await db("warriors").where({ id: f.member.id }).first()).group_size, before.group_size);
    assert.deepEqual(await db("warrior_inventory").where({ warrior_id: f.member.id }).orderBy("id"), gear);
    await db("warriors").where({ id: f.member.id }).update({ group_size: 1 });
    await db("warrior_inventory").where({ warrior_id: f.member.id }).where("model_index", ">", 0).delete();
    await db("warrior_starting_gear_grants").where({ warrior_id: f.member.id }).where("model_index", ">", 0).delete();
    const last = await record(f, { resultId: "removed-from-warband" });
    assert.equal((await call("DELETE", `/rosters/${f.roster.id}/injuries/${last.body.injuryId}`)).status, 200);
    assert.equal((await db("warriors").where({ id: f.member.id }).first()).group_size, 1);
  });
  test("Retirement correction restores the first eye injury; campaign correction does not require a hiring stage", async () => {
    const f = await fixture();
    const first = await record(f, { resultId: "blinded-in-one-eye", eye: "left" });
    const retired = await record(f, { resultId: "blinded-in-one-eye", eye: "right" });
    const firstPath = `/rosters/${f.roster.id}/injuries/${first.body.injuryId}`;
    assert.equal((await call("DELETE", firstPath)).status, 409);
    const campaign = (await call("POST", "/campaigns", { name: "Injury correction stage" })).body;
    await db("rosters").where({ id: f.roster.id }).update({ campaign_id: campaign.id, campaign_phase: "battle", campaign_step: 1 });
    assert.equal((await call("DELETE", `/rosters/${f.roster.id}/injuries/${retired.body.injuryId}`)).status, 200);
    assert.equal((await call("GET", f.path)).body.conditions.filter((effect) => effect.type === "eye-loss").length, 1);
    assert.equal((await call("DELETE", firstPath)).status, 200);
    assert.deepEqual((await call("GET", f.path)).body.conditions, []);
  });
  test("Multiple Injuries corrections reverse individual outcomes rather than the entire roll", async () => {
    const f = await fixture();
    const stats = (await db("warriors").where({ id: f.member.id }).first()).stats;
    const multiple = await record(f, { resultId: "multiple-injuries", secondaryRoll: 2,
      injuries: [{ resultId: "leg-wound" }, { resultId: "hand-injury" }] });
    const leg = (await db("warrior_injuries").whereIn("id", multiple.body.injuryIds)).find((entry) => entry.result.id === "leg-wound");
    assert.equal((await call("DELETE", `/rosters/${f.roster.id}/injuries/${leg.id}`)).status, 200);
    const after = await db("warriors").where({ id: f.member.id }).first();
    assert.equal(after.stats.M, stats.M);
    assert.equal(Number(after.stats.WS), Number(stats.WS) - 1);
    assert.equal((await call("GET", f.path)).body.history.length, 1);
  });
  test("Hired Sword death correction preserves its hire type without adding to the warband model limit", async () => {
    const f = await fixture("Hired Sword");
    const casualty = await record(f, { resultId: "removed-from-warband" });
    const result = await call("DELETE", `/rosters/${f.roster.id}/injuries/${casualty.body.injuryId}`);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal((await db("warriors").where({ id: f.member.id }).first()).role, "Hired Sword");
  });
  test("Correction requires the exact counter, owner authorization and saved metadata, and is atomic under concurrent requests", async () => {
    const f = await fixture();
    const injury = await record(f, { resultId: "leg-wound" });
    const path = `/rosters/${f.roster.id}/injuries/${injury.body.injuryId}`;
    await db("rosters").where({ id: f.roster.id }).update({ battles_fought: 2 });
    assert.equal((await call("DELETE", path)).status, 409);
    assert.equal((await call("GET", f.path)).body.history[0].canRemove, false);
    await db("rosters").where({ id: f.roster.id }).update({ battles_fought: 1 });
    const stranger = await call("POST", "/auth/register", { username: `correction_${randomUUID().slice(0, 12)}`, password: "Correction-tests-123!" });
    try {
      assert.equal((await call("DELETE", path, undefined, stranger.body.token)).status, 403);
      await call("POST", `/rosters/${f.roster.id}/share`, {});
      const shared = (await call("GET", `/rosters/${f.roster.id}`)).body;
      await call("POST", "/shared-rosters/join", { code: shared.shareCode }, stranger.body.token);
      assert.equal((await call("DELETE", path, undefined, stranger.body.token)).status, 403);
    } finally { await db("users").where({ id: stranger.body.user.id }).delete(); }
    const results = await Promise.all([call("DELETE", path), call("DELETE", path)]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 404]);
    const legacy = await record(f, { resultId: "leg-wound" });
    await db("warrior_injuries").where({ id: legacy.body.injuryId }).update({ correction: null });
    assert.equal((await call("DELETE", `/rosters/${f.roster.id}/injuries/${legacy.body.injuryId}`)).status, 409);
  });
  test("Campaign Bitter Enmity options use only opposing teams from the latest played battle", async () => {
    const f = await fixture();
    const oldEnemy = await fixture();
    const enemy = await fixture();
    const ally = await fixture();
    const campaign = (await call("POST", "/campaigns", { name: "Enmity options" })).body;
    await db("rosters").whereIn("id", [f.roster.id, oldEnemy.roster.id, enemy.roster.id, ally.roster.id])
      .update({ campaign_id: campaign.id, campaign_phase: "post_battle", campaign_step: 1 });
    assert.deepEqual((await call("GET", f.path)).body.hatredOpponents, []);
    await db("rosters").where({ id: enemy.roster.id }).update({ name: "Opposing band" });
    await db("warriors").where({ id: enemy.member.id }).update({ name: "Opposing Hero" });
    const [oldBattle] = await db("battles").insert({ campaign_id: campaign.id, format: "1v1", status: "finished",
      created_at: new Date("2020-01-01") }).returning("*");
    const [latest] = await db("battles").insert({ campaign_id: campaign.id, format: "2v2", status: "finished",
      created_at: new Date("2020-01-02") }).returning("*");
    const [forming] = await db("battles").insert({ campaign_id: campaign.id, format: "1v1", status: "forming" }).returning("*");
    await db("battle_rosters").insert([
      { battle_id: oldBattle.id, roster_id: f.roster.id, team: "A" }, { battle_id: oldBattle.id, roster_id: oldEnemy.roster.id, team: "B" },
      { battle_id: latest.id, roster_id: f.roster.id, team: "A" }, { battle_id: latest.id, roster_id: enemy.roster.id, team: "B" },
      { battle_id: latest.id, roster_id: ally.roster.id, team: "A" },
      { battle_id: forming.id, roster_id: f.roster.id, team: "A" }, { battle_id: forming.id, roster_id: oldEnemy.roster.id, team: "B" },
    ]);
    const options = (await call("GET", f.path)).body.hatredOpponents;
    assert.equal(options.length, 1);
    assert.equal(options[0].name, "Opposing band");
    assert.equal(options[0].warband, band.name);
    assert.equal(options[0].leader.name, "Opposing Hero");
    assert.deepEqual(options[0].heroes, [{ id: enemy.member.id, name: "Opposing Hero" }]);
  });
  test("full recovery saves no record and does not clear earlier injuries or change stats", async () => {
    const f = await fixture();
    assert.equal((await record(f, { resultId: "leg-wound" })).status, 200);
    const before = await db("warriors").where({ id: f.member.id }).first();
    const recovered = await record(f, { resultId: "full-recovery" });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.injuryId, null);
    const after = await db("warriors").where({ id: f.member.id }).first();
    assert.deepEqual(after.stats, before.stats);
    assert.deepEqual(after.injury_conditions, before.injury_conditions);
    assert.equal((await call("GET", f.path)).body.history.length, 1);
    const multiple = await record(f, { resultId: "multiple-injuries", secondaryRoll: 2,
      injuries: [{ resultId: "full-recovery" }, { resultId: "full-recovery" }] });
    assert.equal(multiple.body.injuryId, null);
    assert.equal((await db("warrior_injuries").where({ warrior_id: f.member.id })).length, 1);
    assert.equal((await db("injury_previews").where({ warrior_id: f.member.id })).length, 0);
  });
  test("multiple injuries record only affected outcomes and stat increases also retain their cause", async () => {
    const f = await fixture();
    assert.equal((await record(f, { resultId: "multiple-injuries", secondaryRoll: 2,
      injuries: [{ resultId: "full-recovery" }, { resultId: "leg-wound" }] })).status, 200);
    const history = (await call("GET", f.path)).body.history;
    assert.equal(history.length, 1);
    assert.equal(history[0].result.id, "leg-wound");
    assert.deepEqual(history[0].result.children, []);
    const before = await db("warriors").where({ id: f.member.id }).first();
    const preview = await call("POST", `${f.path}/preview`, { mode: "manual", selection: { resultId: "leg-wound" } });
    // Exercise a positive modifier without inventing an entry in the core injury chart.
    await db("injury_previews").where({ id: preview.body.id }).update({ result: {
      ...preview.body.result, effects: [{ type: "stat-modifier", stat: "M", value: 1, duration: "permanent" }],
    } });
    assert.equal((await call("POST", `${f.path}/${preview.body.id}/apply`, {})).status, 200);
    const after = await db("warriors").where({ id: f.member.id }).first();
    assert.equal(Number(after.stats.M), Number(before.stats.M) + 1);
    const effect = (await call("GET", f.path)).body.history[0].result.effects[0];
    assert.equal(effect.value, 1);
    assert.equal(effect.previousValue, Number(before.stats.M));
    assert.equal(effect.currentValue, Number(after.stats.M));
  });
  test("Madness retains one selected rule with gameplay references and leaves base stats unchanged", async () => {
    for (const secondaryRoll of [1, 4]) {
      const f = await fixture();
      const before = await db("warriors").where({ id: f.member.id }).first();
      assert.equal((await record(f, { resultId: "madness", secondaryRoll })).status, 200);
      const after = await db("warriors").where({ id: f.member.id }).first();
      assert.deepEqual(after.stats, before.stats);
      assert.equal(after.injury_conditions.length, 1);
      const condition = after.injury_conditions[0];
      assert.equal(condition.rule, secondaryRoll === 1 ? "stupidity" : "frenzy");
      assert.match(condition.gameplayRules, secondaryRoll === 1 ? /2D6/ : /double the Attacks/);
      assert.match(condition.name, secondaryRoll === 1 ? /Stupidity/ : /Frenzy/);
      const roster = (await call("GET", `/rosters/${f.roster.id}`)).body;
      assert.equal(roster.members[0].injuryConditions[0].gameplayRules, condition.gameplayRules);
      assert.equal(roster.injuryHistory[0].result.effects[0].gameplayRules, condition.gameplayRules);
      assert.equal((await record(f, { resultId: "madness", secondaryRoll })).body.injuryId, null);
      assert.equal((await call("GET", f.path)).body.history.length, 1);
      assert.equal((await db("warriors").where({ id: f.member.id }).first()).injury_conditions.length, 1);
    }
  });
  test("existing injury data is upgraded without reapplying stats or retaining recoveries", async () => {
    const f = await fixture();
    const before = await db("warriors").where({ id: f.member.id }).first();
    const common = { roster_id: f.roster.id, warrior_id: f.member.id, warrior_name: f.member.name,
      role: "Hero", model_index: 0, battle_number: 1, mode: "manual" };
    const { heroes, resolveInjury } = require("../src/services/injury-rules.service");
    const recovery = resolveInjury(heroes, { resultId: "full-recovery" }, "manual");
    await db("warrior_injuries").insert({ ...common, result: recovery });
    const [multiple] = await db("warrior_injuries").insert({ ...common, result:
      resolveInjury(heroes, { resultId: "multiple-injuries", secondaryRoll: 2,
        injuries: [{ resultId: "full-recovery" }, { resultId: "leg-wound" }] }, "manual"),
    }).returning("*");
    await db("warriors").where({ id: f.member.id }).update({ injury_conditions: JSON.stringify([
      { type: "psychology", rule: "frenzy", name: "MADNESS" },
    ]) });
    await require("../migrations/20261101090000_retain_injury_effects").up(db);
    const injuries = await db("warrior_injuries").where({ warrior_id: f.member.id });
    assert.equal(injuries.length, 1);
    assert.equal(injuries[0].id, multiple.id);
    assert.deepEqual(injuries[0].result.children.map((child) => child.id), ["leg-wound"]);
    const after = await db("warriors").where({ id: f.member.id }).first();
    assert.deepEqual(after.stats, before.stats);
    assert.match(after.injury_conditions[0].gameplayRules, /double the Attacks/);
  });
  test("stale and unauthorized injury previews cannot alter a member", async () => {
    const f = await fixture();
    const preview = await call("POST", `${f.path}/preview`, { mode: "manual", selection: { resultId: "leg-wound" } });
    await db("warriors").where({ id: f.member.id }).increment("experience", 1);
    assert.equal((await call("POST", `${f.path}/${preview.body.id}/apply`, {})).status, 409);
    assert.equal((await call("POST", `${f.path}/preview`, { mode: "manual", selection: { resultId: "leg-wound" } }, "")).status, 401);
    const stranger = await call("POST", "/auth/register", { username: `injury_other_${randomUUID().slice(0, 12)}`, password: "Injury-tests-12345!" });
    try {
      assert.equal((await call("GET", f.path, undefined, stranger.body.token)).status, 403);
      assert.equal((await call("POST", `${f.path}/preview`, { mode: "manual", selection: { resultId: "dead" } }, stranger.body.token)).status, 403);
    } finally { await db("users").where({ id: stranger.body.user.id }).delete(); }
  });
  test("multiple and secondary results apply stat and missed-game effects", async () => {
    const f = await fixture();
    const initial = await db("warriors").where({ id: f.member.id }).first();
    assert.equal((await record(f, { resultId: "multiple-injuries", secondaryRoll: 2, injuries: [
      { resultId: "hand-injury" }, { resultId: "deep-wound", secondaryRoll: 2 },
    ] })).status, 200);
    const member = await db("warriors").where({ id: f.member.id }).first();
    assert.equal(Number(member.stats.WS), Number(initial.stats.WS) - 1);
    const entries = (await call("GET", f.path)).body.history;
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((entry) => entry.result.id).sort(), ["deep-wound", "hand-injury"]);
    assert.ok(entries.every((entry) => entry.result.children.length === 0));
    assert.ok(member.injury_conditions.every((condition) => entries.some((entry) =>
      entry.id === condition.injuryId && entry.result.name === condition.name)));
    assert.equal((await call("GET", f.path)).body.availability.available, false);
    await db("rosters").where({ id: f.roster.id }).update({ battles_fought: 3 });
    assert.equal((await call("GET", f.path)).body.availability.available, true);
    assert.ok((await call("GET", f.path)).body.conditions.every((condition) => condition.type !== "miss-games"));
    const roster = (await call("GET", `/rosters/${f.roster.id}`)).body;
    assert.ok(roster.members[0].injuryConditions.every((condition) => condition.type !== "miss-games"));
  });
  test("loss of the second eye retires a Hero and retains injury history", async () => {
    const f = await fixture();
    assert.equal((await record(f, { resultId: "blinded-in-one-eye", eye: "left" })).status, 200);
    const second = await record(f, { resultId: "blinded-in-one-eye", eye: "right" });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(await db("warriors").where({ id: f.member.id }).first(), undefined);
    const roster = (await call("GET", `/rosters/${f.roster.id}`)).body;
    assert.equal(roster.injuryHistory.length, 2);
    assert.ok(roster.injuryHistory.every((entry) => entry.warrior_id === null));
    assert.equal(roster.injuryHistory[0].result.effects[0].type, "remove-warrior");
    assert.equal(roster.graveyard.length, 1);
    assert.equal(roster.graveyard[0].reason, "retirement");
    assert.equal(roster.graveyard[0].snapshot.member.injury_conditions.filter((condition) => condition.type === "eye-loss").length, 1);
  });
  test("death preserves the full Hero snapshot before cascading deletion, without refund or active membership", async () => {
    const f = await fixture();
    const [option, skill, spell] = await Promise.all([
      db("equipment_options").where({ warband_id: band.id, name: "Sword" }).first(),
      db("skills").where({ name: "Mighty Blow" }).first(),
      db("spells").first(),
    ]);
    assert.ok(option && skill && spell);
    await db("warrior_inventory").insert({ warrior_id: f.member.id, equipment_option_id: option.id, model_index: 0,
      quantity: 1, unit_cost_paid: option.unit_cost });
    await db("warrior_inventory").insert({ warrior_id: f.member.id, shop_item_id: "sword", model_index: 0,
      quantity: 2, unit_cost_paid: 10 });
    await db("warrior_skills").insert({ warrior_id: f.member.id, skill_id: skill.id, notes: "Learned before removal" });
    await db("warrior_spells").insert({ warrior_id: f.member.id, spell_id: spell.id, casting_difficulty_modifier: -1 });
    await db("warrior_spells").insert({ warrior_id: f.member.id, custom_name: "Archived custom spell",
      custom_casting_difficulty: 7, custom_effect_summary: "Custom gameplay effect", custom_source_reference: "Test", notes: "Spell note" });
    await db("warriors").where({ id: f.member.id }).update({ experience: 8, notes: "Remember this Hero", equipment: "Equipment note", skills: "Skill note" });
    assert.equal((await record(f, { resultId: "leg-wound" })).status, 200);
    const before = await db("warriors").where({ id: f.member.id }).first();
    const inventoryBefore = await db("warrior_inventory").where({ warrior_id: f.member.id });
    const treasury = (await db("rosters").where({ id: f.roster.id }).first()).treasury;
    const preview = await call("POST", `${f.path}/preview`, { mode: "manual", selection: { resultId: "dead" } });
    assert.equal((await db("hero_graveyard").where({ roster_id: f.roster.id })).length, 0);
    assert.equal((await call("POST", `${f.path}/${preview.body.id}/apply`, {})).status, 200);
    assert.equal((await call("POST", `${f.path}/${preview.body.id}/apply`, {})).status, 404);
    const roster = (await call("GET", `/rosters/${f.roster.id}`)).body;
    assert.equal(roster.members.length, 0);
    assert.equal(roster.capacity.currentMembers, 0);
    assert.equal(roster.rating, "0");
    assert.equal(Number(roster.treasury), treasury);
    assert.equal(roster.graveyard.length, 1);
    const archive = roster.graveyard[0];
    assert.equal(archive.original_warrior_id, f.member.id);
    assert.equal(archive.reason, "death");
    assert.equal(archive.battle_number, 1);
    assert.equal(archive.cause.id, "dead");
    assert.equal(archive.snapshot_complete, true);
    assert.equal(archive.snapshot.member.typeName, "Youngblood");
    assert.deepEqual(archive.snapshot.member.stats, before.stats);
    assert.equal(archive.snapshot.member.experience, 8);
    assert.equal(archive.snapshot.member.notes, before.notes);
    assert.equal(archive.snapshot.equipment.length, inventoryBefore.length);
    assert.ok(archive.snapshot.equipment.some((item) => item.shop_item_id === "sword" && item.name === "Sword" && item.quantity === 2));
    assert.ok(archive.snapshot.skills.some((entry) => entry.name === skill.name && entry.description === skill.description));
    assert.ok(archive.snapshot.skills.some((entry) => entry.name === "Leader"));
    assert.ok(archive.snapshot.spells.some((entry) => entry.name === spell.name &&
      entry.casting_difficulty === (spell.casting_difficulty === null ? null : spell.casting_difficulty - 1)));
    assert.ok(archive.snapshot.spells.some((entry) => entry.name === "Archived custom spell" &&
      entry.effect_summary === "Custom gameplay effect" && entry.casting_difficulty === 7));
    assert.equal(archive.snapshot.injuries.length, 1);
    assert.equal(archive.snapshot.injuries[0].result.id, "leg-wound");
    for (const table of ["warriors", "warrior_inventory", "warrior_skills", "warrior_spells"]) {
      assert.equal((await db(table).where({ [table === "warriors" ? "id" : "warrior_id"]: f.member.id })).length, 0);
    }
    const stranger = await call("POST", "/auth/register", { username: `grave_view_${randomUUID().slice(0, 10)}`, password: "Graveyard-test-123!" });
    try {
      assert.equal((await call("GET", `/rosters/${f.roster.id}`, undefined, stranger.body.token)).status, 403);
      const shared = await call("POST", `/rosters/${f.roster.id}/share`, {});
      const viewed = await call("POST", "/shared-rosters/join", { code: shared.body.shareCode }, stranger.body.token);
      assert.equal(viewed.status, 200);
      assert.deepEqual(viewed.body.graveyard, roster.graveyard);
    } finally { await db("users").where({ id: stranger.body.user.id }).delete(); }
  });
  test("manual dismissals and captive removals preserve Heroes with distinct reasons", async () => {
    const dismissed = await fixture();
    const treasury = Number((await db("rosters").where({ id: dismissed.roster.id }).first()).treasury);
    assert.equal((await call("DELETE", `/members/${dismissed.member.id}`)).status, 204);
    const roster = (await call("GET", `/rosters/${dismissed.roster.id}`)).body;
    assert.equal(roster.graveyard[0].reason, "dismissed");
    assert.equal(roster.graveyard[0].snapshot.member.name, dismissed.member.name);
    assert.equal(Number(roster.treasury), treasury);
    const captive = await fixture();
    assert.equal((await record(captive, { resultId: "captured", captureOutcome: "removed" })).status, 200);
    assert.equal((await call("GET", `/rosters/${captive.roster.id}`)).body.graveyard[0].reason, "captivity");
  });
  test("legacy Graveyard backfill marks missing snapshots honestly and excludes non-Hero removals", async () => {
    const f = await fixture();
    await db.transaction(async (trx) => {
      await trx.raw("create temporary table warrior_injuries on commit drop as select * from public.warrior_injuries where false");
      await trx.raw("create temporary table hero_graveyard (like public.hero_graveyard including defaults) on commit drop");
      const { heroes, resolveInjury } = require("../src/services/injury-rules.service");
      const common = { roster_id: f.roster.id, warrior_name: "Legacy Hero", model_index: 0,
        battle_number: 2, mode: "manual", pending: false, created_at: new Date(),
        result: resolveInjury(heroes, { resultId: "dead" }, "manual") };
      await trx("warrior_injuries").insert([
        { ...common, id: randomUUID(), role: "Hero", warrior_id: null },
        { ...common, id: randomUUID(), role: "Henchman", warrior_id: null },
        { ...common, id: randomUUID(), role: "Hero", warrior_id: f.member.id },
      ]);
      await require("../migrations/20261101180000_create_hero_graveyard").backfillLegacy(trx);
      const entries = await trx("hero_graveyard");
      assert.equal(entries.length, 1);
      assert.equal(entries[0].name, "Legacy Hero");
      assert.equal(entries[0].reason, "death");
      assert.equal(entries[0].snapshot_complete, false);
      assert.equal(entries[0].snapshot.member.stats, undefined);
      assert.equal(entries[0].snapshot.member.experience, undefined);
      assert.equal(entries[0].snapshot.injuries.length, 1);
    });
  });
    test("Undo restores a dismissed Hero's full records exactly once without changing treasury", async () => {
      const f = await fixture();
      const skill = await db("skills").where({ name: "Mighty Blow" }).first();
      const [learned] = await db("warrior_skills").insert({ warrior_id: f.member.id, skill_id: skill.id }).returning("*");
      const [spell] = await db("warrior_spells").insert({ warrior_id: f.member.id, custom_name: "Undo spell",
        custom_casting_difficulty: 7, custom_effect_summary: "Restored spell effect" }).returning("*");
      await db("warrior_advances").insert({ warrior_id: f.member.id, advance_table: "Hero", experience_threshold: 2,
        mode: "manual", result: "new_skill", learned_skill_id: learned.id });
      await db("warrior_inventory").insert({ warrior_id: f.member.id, shop_item_id: "sword", model_index: 0, quantity: 2, unit_cost_paid: 10 });
      await db("warrior_mutations").insert({ warrior_id: f.member.id, mutation_id: "tentacle", position: 0, unit_cost_paid: 35 });
      await db("trading_hero_status").insert({ roster_id: f.roster.id, hero_id: f.member.id, battle_number: 1, out_of_action: true });
      await db("trading_searches").insert({ roster_id: f.roster.id, hero_id: f.member.id, hero_name: f.member.name,
        battle_number: 1, item_id: "sword", dice: "[3,4]", modifier: 0, total: 7, success: true });
      assert.equal((await record(f, { resultId: "sold-to-the-pits", pitOutcome: "won" })).status, 200);
      const before = await db("warriors").where({ id: f.member.id }).first();
      const tables = ["warrior_inventory", "warrior_skills", "warrior_spells", "warrior_advances",
        "warrior_injuries", "warrior_starting_gear_grants", "warrior_mutations"];
      const records = await Promise.all(tables.map((table) => db(table).where({ warrior_id: f.member.id })));
      const treasury = (await db("rosters").where({ id: f.roster.id }).first()).treasury;
      assert.equal((await call("DELETE", `/members/${f.member.id}`)).status, 204);
      const entry = (await call("GET", `/rosters/${f.roster.id}`)).body.graveyard[0];
      assert.equal(entry.canRestore, true);
      await db("trading_searches").where({ roster_id: f.roster.id }).update({ purchased: true });
      const path = `/rosters/${f.roster.id}/graveyard/${entry.id}/restore`;
      const result = await call("POST", path, {});
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.graveyard.length, 0);
      assert.equal(result.body.members[0].id, f.member.id);
      assert.equal(Number(result.body.treasury), treasury);
      const restored = await db("warriors").where({ id: f.member.id }).first();
      assert.deepEqual({ ...restored, position: before.position }, before);
      for (let index = 0; index < tables.length; index++) {
        const actual = await db(tables[index]).where({ warrior_id: f.member.id });
        assert.deepEqual(actual.sort((a, b) => String(a.id).localeCompare(String(b.id))),
          records[index].sort((a, b) => String(a.id).localeCompare(String(b.id))), tables[index]);
      }
      assert.equal((await db("warrior_spells").where({ id: spell.id }).first()).custom_casting_difficulty, 7);
      assert.equal((await db("trading_hero_status").where({ hero_id: f.member.id })).length, 1);
      assert.equal((await db("trading_searches").where({ hero_id: f.member.id })).length, 1);
      assert.equal((await db("trading_searches").where({ hero_id: f.member.id }).first()).purchased, true);
      assert.equal((await call("POST", path, {})).status, 404);
      assert.equal((await call("PATCH", `/members/${f.member.id}`, { experience: 1 })).status, 409);
    });
    test("Undo respects battle counters, death, recruitment stages and ownership", async () => {
      const f = await fixture();
      assert.equal((await call("DELETE", `/members/${f.member.id}`)).status, 204);
      const entry = (await call("GET", `/rosters/${f.roster.id}`)).body.graveyard[0];
      const path = `/rosters/${f.roster.id}/graveyard/${entry.id}/restore`;
      await db("rosters").where({ id: f.roster.id }).update({ battles_fought: 2 });
      assert.equal((await call("GET", `/rosters/${f.roster.id}`)).body.graveyard[0].canRestore, false);
      assert.equal((await call("POST", path, {})).status, 409);
      await db("rosters").where({ id: f.roster.id }).update({ battles_fought: 1 });
      const campaign = (await call("POST", "/campaigns", { name: "Undo stage tests" })).body;
      await db("rosters").where({ id: f.roster.id }).update({ campaign_id: campaign.id, campaign_phase: "battle" });
      assert.equal((await call("POST", path, {})).status, 409);
      const stranger = await call("POST", "/auth/register", { username: `undo_other_${randomUUID().slice(0, 12)}`, password: "Undo-tests-123!" });
      try { assert.equal((await call("POST", path, {}, stranger.body.token)).status, 403); }
      finally { await db("users").where({ id: stranger.body.user.id }).delete(); }
      await db("rosters").where({ id: f.roster.id }).update({ campaign_phase: "post_battle", campaign_step: 8 });
      assert.equal((await call("POST", path, {})).status, 200);
      const dead = await fixture();
      assert.equal((await record(dead, { resultId: "dead" })).status, 200);
      const grave = (await call("GET", `/rosters/${dead.roster.id}`)).body.graveyard[0];
      assert.equal(grave.canRestore, false);
      assert.equal((await call("POST", `/rosters/${dead.roster.id}/graveyard/${grave.id}/restore`, {})).status, 409);
    });
    test("Undo rejects Hero, model and type limits atomically and succeeds after space is freed", async () => {
      const f = await fixture();
      const original = await db("warriors").where({ id: f.member.id }).first();
      assert.equal((await call("DELETE", `/members/${f.member.id}`)).status, 204);
      const entry = (await call("GET", `/rosters/${f.roster.id}`)).body.graveyard[0];
      const path = `/rosters/${f.roster.id}/graveyard/${entry.id}/restore`;
      async function add(count, role, groupSize, typeId = null) {
        const ids = Array.from({ length: count }, () => randomUUID());
        await db("warriors").insert(ids.map((id, index) => ({ ...original, id, role, group_size: groupSize,
          warrior_type_id: typeId, position: index + 1 })));
        return ids;
      }
      const heroes = await add(6, "Hero", 1);
      const maxHeroes = await call("POST", path, {});
      assert.equal(maxHeroes.status, 409);
      assert.match(maxHeroes.body.error, /maximum of 6 Heroes/);
      await db("warriors").whereIn("id", heroes).delete();
      const groups = await add(3, "Henchman", 5);
      const capacity = await call("POST", path, {});
      assert.equal(capacity.status, 409);
      assert.match(capacity.body.error, /no room/);
      await db("warriors").whereIn("id", groups).delete();
      const duplicates = await add(2, "Hero", 1, original.warrior_type_id);
      const type = await call("POST", path, {});
      assert.equal(type.status, 409);
      assert.match(type.body.error, /maximum of 2 Youngblood/);
      assert.equal(await db("warriors").where({ id: original.id }).first(), undefined);
      assert.equal((await db("hero_graveyard").where({ id: entry.id })).length, 1);
      await db("warriors").whereIn("id", duplicates).delete();
      const results = await Promise.all([call("POST", path, {}), call("POST", path, {})]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 404]);
      assert.equal((await db("warriors").where({ id: original.id })).length, 1);
    });
    test("Undo retirement and captive removal restore pre-removal injuries and delete only the removal outcome", async () => {
      const f = await fixture();
      assert.equal((await record(f, { resultId: "blinded-in-one-eye", eye: "left" })).status, 200);
      const before = await db("warriors").where({ id: f.member.id }).first();
      assert.equal((await record(f, { resultId: "blinded-in-one-eye", eye: "right" })).status, 200);
      const grave = (await call("GET", `/rosters/${f.roster.id}`)).body.graveyard[0];
      const result = await call("POST", `/rosters/${f.roster.id}/graveyard/${grave.id}/restore`, {});
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.deepEqual(result.body.members[0].stats, before.stats);
      assert.equal(result.body.injuryHistory.length, 1);
      assert.equal(result.body.members[0].injuryConditions.filter((effect) => effect.type === "eye-loss").length, 1);
      assert.equal((await record(f, { resultId: "captured" })).status, 200);
      const pending = (await call("GET", f.path)).body.history.find((entry) => entry.pending);
      assert.equal((await record(f, { resultId: "captured", captureOutcome: "removed" }, { resolvesId: pending.id })).status, 200);
      const captive = (await call("GET", `/rosters/${f.roster.id}`)).body.graveyard[0];
      const restored = await call("POST", `/rosters/${f.roster.id}/graveyard/${captive.id}/restore`, {});
      assert.equal(restored.status, 200, JSON.stringify(restored.body));
      assert.ok(restored.body.injuryHistory.some((entry) => entry.id === pending.id && entry.pending));
      assert.equal((await call("GET", f.path)).body.availability.available, false);
      assert.equal(restored.body.injuryHistory.length, 2);
    });
    test("Roster creation dismissals refund hire fees without Graveyard entries", async () => {
      const f = await fixture("Hero", { battlesFought: 0 });
      const before = Number((await db("rosters").where({ id: f.roster.id }).first()).treasury);
      assert.equal((await call("DELETE", `/members/${f.member.id}`)).status, 204);
      const result = (await call("GET", `/rosters/${f.roster.id}`)).body;
      assert.deepEqual(result.graveyard, []);
      assert.equal(Number(result.treasury), before + types.find((type) => type.name === "Youngblood").hireCost);
      assert.equal((await db("hero_graveyard").where({ roster_id: f.roster.id })).length, 0);
    });
  test("Henchman losses remove only the selected model and equipment without refunds", async () => {
    const f = await fixture("Henchman");
    const inventory = await db("warrior_inventory").where({ warrior_id: f.member.id });
    const treasury = (await db("rosters").where({ id: f.roster.id }).first()).treasury;
    assert.equal((await record(f, { resultId: "removed-from-warband" }, { modelIndex: 1 })).status, 200);
    const member = await db("warriors").where({ id: f.member.id }).first();
    assert.equal(member.group_size, 2);
    const carried = await db("warrior_inventory").where({ warrior_id: f.member.id });
    assert.equal(carried.length, inventory.filter((entry) => entry.model_index !== 1).length);
    assert.ok(carried.every((entry) => entry.model_index < 2));
    assert.equal((await db("rosters").where({ id: f.roster.id }).first()).treasury, treasury);
    assert.equal((await db("hero_graveyard").where({ roster_id: f.roster.id })).length, 0);
  });
  test("Undo reverses gold awarded in the same removal batch and refuses if it has been spent", async () => {
    const f = await fixture();
    assert.equal((await record(f, { resultId: "blinded-in-one-eye", eye: "left" })).status, 200);
    const before = await db("rosters").where({ id: f.roster.id }).first();
    const result = await record(f, { resultId: "multiple-injuries", secondaryRoll: 2,
      injuries: [{ resultId: "sold-to-the-pits", pitOutcome: "won" }, { resultId: "blinded-in-one-eye", eye: "right" }] });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const grave = (await call("GET", `/rosters/${f.roster.id}`)).body.graveyard[0];
    const path = `/rosters/${f.roster.id}/graveyard/${grave.id}/restore`;
    assert.equal(grave.snapshot.treasuryDelta, 50);
    await db("rosters").where({ id: f.roster.id }).update({ treasury: 49 });
    assert.equal((await call("POST", path, {})).status, 409);
    await db("rosters").where({ id: f.roster.id }).update({ treasury: Number(before.treasury) + 50 });
    const undone = await call("POST", path, {});
    assert.equal(undone.status, 200, JSON.stringify(undone.body));
    assert.equal(Number(undone.body.treasury), Number(before.treasury));
    assert.equal(undone.body.injuryHistory.length, 1);
    assert.equal(Number(undone.body.members[0].experience), grave.snapshot.member.experience);
  });
  test("Hired Swords receive Henchman outcomes, not Hero injuries", async () => {
    const f = await fixture("Hired Sword");
    assert.equal((await call("GET", f.path)).body.table.roll.type, "D6");
    assert.equal((await call("POST", `${f.path}/preview`, { mode: "manual", selection: { resultId: "leg-wound" } })).status, 400);
    assert.equal((await record(f, { resultId: "full-recovery" })).status, 200);
    assert.equal((await db("warrior_injuries").where({ warrior_id: f.member.id })).length, 0);
    assert.equal((await record(f, { resultId: "removed-from-warband" })).status, 200);
    assert.equal(await db("warriors").where({ id: f.member.id }).first(), undefined);
    assert.equal((await db("hero_graveyard").where({ roster_id: f.roster.id })).length, 0);
  });
  test("pending pit outcomes apply victory awards once or require defeat injury rolls", async () => {
    const f = await fixture();
    const initial = await db("warriors").where({ id: f.member.id }).first();
    assert.equal((await record(f, { resultId: "sold-to-the-pits" })).status, 200);
    const data = (await call("GET", f.path)).body;
    assert.equal(data.history[0].pending, true);
    assert.equal(data.availability.available, false);
    const input = { resultId: "sold-to-the-pits", pitOutcome: "won" };
    const resolved = await record(f, input, { resolvesId: data.history[0].id });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    assert.equal((await db("warriors").where({ id: f.member.id }).first()).experience, initial.experience + 2);
    assert.equal((await db("rosters").where({ id: f.roster.id }).first()).treasury, Number(f.roster.treasury) - types.find((type) => type.name === "Youngblood").hireCost + 50);
    assert.equal((await call("GET", f.path)).body.availability.available, true);
    assert.equal((await call("GET", f.path)).body.history.length, 1);
    assert.equal((await call("GET", f.path)).body.history[0].result.pending, undefined);
    assert.equal((await call("POST", `${f.path}/preview`, { mode: "manual", resolvesId: data.history[0].id, selection: input })).status, 404);
    assert.equal((await record(f, { resultId: "sold-to-the-pits", pitOutcome: "lost", pitInjury: { resultId: "nervous-condition" } })).status, 200);
    const after = await db("warriors").where({ id: f.member.id }).first();
    assert.equal(Number(after.stats.I), Number(initial.stats.I) - 1);
    assert.equal((await db("warrior_inventory").where({ warrior_id: f.member.id })).length, 0);
  });
  test("capture release and pre-battle old wound checks persist availability", async () => {
    const f = await fixture();
    assert.equal((await record(f, { resultId: "captured" })).status, 200);
    const pending = (await call("GET", f.path)).body.history[0];
    assert.equal((await record(f, { resultId: "captured", captureOutcome: "exchanged" }, { resolvesId: pending.id })).status, 200);
    assert.equal((await call("GET", f.path)).body.history.length, 0);
    assert.equal((await record(f, { resultId: "old-battle-wound" })).status, 200);
    assert.equal((await call("POST", `${f.path}/old-wound`, { mode: "manual", roll: 1 })).status, 200);
    assert.equal((await call("GET", f.path)).body.availability.available, false);
    assert.equal((await call("POST", `${f.path}/old-wound`, { mode: "manual", roll: 6 })).status, 409);
    await db("rosters").where({ id: f.roster.id }).increment("battles_fought", 1);
    assert.equal((await call("GET", f.path)).body.availability.needsOldWoundRoll, true);
  });
  test("pit victory XP is protected independently of advances, while later gains can be edited", async () => {
    const f = await fixture();
    assert.equal((await call("PATCH", `/members/${f.member.id}`, { experience: 7 })).status, 200);
    assert.equal((await record(f, { resultId: "sold-to-the-pits", pitOutcome: "won" })).status, 200);
    const member = await db("warriors").where({ id: f.member.id }).first();
    assert.equal(member.experience, 9);
    assert.equal(member.injury_experience_floor, 9);
    const data = (await call("GET", `/members/${f.member.id}/advances`)).body;
    assert.equal(data.injuryExperienceFloor, 9);
    assert.equal(data.minimumExperience, 9);
    const roster = (await call("GET", `/rosters/${f.roster.id}`)).body;
    assert.equal(roster.members[0].minimumExperience, 9);
    const award = roster.injuryHistory[0].result.effects.find((effect) => effect.type === "experience");
    assert.equal(award.previousValue, 7);
    assert.equal(award.currentValue, 9);
    const lower = await call("PATCH", `/members/${f.member.id}`, { experience: 8 });
    assert.equal(lower.status, 409);
    assert.match(lower.body.error, /XP awarded by injuries is protected/);
    assert.equal((await call("PATCH", `/members/${f.member.id}`, { experience: 12 })).status, 200);
    assert.equal((await call("PATCH", `/members/${f.member.id}`, { experience: 9 })).status, 200);
    // Repository enforcement is transactional, so a concurrent award cannot be bypassed by a stale controller read.
    const { createRosterRepository } = require("../src/repositories/roster.repository");
    await assert.rejects(createRosterRepository(db).updateWarrior(f.member.id, { experience: 8 }),
      /XP awarded by injuries is protected/);
    assert.equal((await record(f, { resultId: "sold-to-the-pits", pitOutcome: "won" })).status, 200);
    assert.equal((await db("warriors").where({ id: f.member.id }).first()).injury_experience_floor, 11);
    assert.equal((await call("PATCH", `/members/${f.member.id}`, { experience: 9 })).status, 409);
  });
  test("pending pit victory also protects its awarded experience", async () => {
    const f = await fixture();
    assert.equal((await record(f, { resultId: "sold-to-the-pits" })).status, 200);
    const pending = (await call("GET", f.path)).body.history[0];
    assert.equal((await record(f, { resultId: "sold-to-the-pits", pitOutcome: "won" },
      { resolvesId: pending.id })).status, 200);
    assert.equal((await db("warriors").where({ id: f.member.id }).first()).injury_experience_floor, 2);
    assert.equal((await call("PATCH", `/members/${f.member.id}`, { experience: 1 })).status, 409);
    const advance = await call("POST", `/members/${f.member.id}/advances`,
      { mode: "manual", result: "stat_increase", stat: "WS" });
    assert.equal(advance.status, 201, JSON.stringify(advance.body));
    const data = (await call("GET", `/members/${f.member.id}/advances`)).body;
    assert.equal((await call("DELETE", `/members/${f.member.id}/advances/${data.history[0].id}`)).status, 200);
    assert.equal((await call("PATCH", `/members/${f.member.id}`, { experience: 1 })).status, 409);
    assert.equal((await db("warriors").where({ id: f.member.id }).first()).experience, 2);
  });
  test("repeated wounds get separate effect links and multiple-injury failures roll back the whole batch", async () => {
    const f = await fixture();
    const initial = await db("warriors").where({ id: f.member.id }).first();
    assert.equal((await record(f, { resultId: "multiple-injuries", secondaryRoll: 2,
      injuries: [{ resultId: "leg-wound" }, { resultId: "leg-wound" }] })).status, 200);
    const after = await db("warriors").where({ id: f.member.id }).first();
    assert.equal(Number(after.stats.M), Number(initial.stats.M) - 2);
    assert.equal(new Set(after.injury_conditions.map((condition) => condition.injuryId)).size, 2);
    const entries = (await call("GET", f.path)).body.history;
    assert.equal(entries.length, 2);
    assert.ok(entries.every((entry) => entry.result.id === "leg-wound" && entry.result.children.length === 0));
    await db("warriors").where({ id: f.member.id }).update({ stats: { ...after.stats, T: "0" } });
    const beforeFailure = await db("warriors").where({ id: f.member.id }).first();
    assert.equal((await record(f, { resultId: "multiple-injuries", secondaryRoll: 2,
      injuries: [{ resultId: "hand-injury" }, { resultId: "chest-wound" }] })).status, 409);
    assert.deepEqual(await db("warriors").where({ id: f.member.id }).first(), beforeFailure);
    assert.equal((await db("warrior_injuries").where({ warrior_id: f.member.id })).length, 2);
  });
  test("pending injuries rolled within Multiple Injuries resolve their own record without removing others", async () => {
    const f = await fixture();
    const applied = await record(f, { resultId: "multiple-injuries", secondaryRoll: 2,
      injuries: [{ resultId: "leg-wound" }, { resultId: "sold-to-the-pits" }] });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.injuryIds.length, 2);
    const entries = (await call("GET", f.path)).body.history;
    const pending = entries.find((entry) => entry.pending);
    const leg = entries.find((entry) => entry.result.id === "leg-wound");
    assert.equal(pending.result.id, "sold-to-the-pits");
    assert.equal((await record(f, { resultId: "sold-to-the-pits", pitOutcome: "won" },
      { resolvesId: pending.id })).status, 200);
    const after = (await call("GET", f.path)).body;
    assert.equal(after.history.length, 2);
    assert.ok(after.history.some((entry) => entry.id === leg.id));
    assert.ok(after.conditions.some((condition) => condition.injuryId === leg.id));
    assert.equal(after.availability.available, true);
  });
  test("migration splits existing groups and protects legacy pit XP without reapplying injury effects", async () => {
    const f = await fixture();
    await db.transaction(async (trx) => {
      await trx.raw("create temporary table warriors on commit drop as select * from public.warriors where id = ?", [f.member.id]);
      await trx.raw("create temporary table warrior_types on commit drop as select * from public.warrior_types");
      await trx.raw("create temporary table warrior_injuries on commit drop as select * from public.warrior_injuries where false");
      await trx.schema.alterTable("warriors", (table) => table.dropColumn("injury_experience_floor"));
      const { heroes, resolveInjury } = require("../src/services/injury-rules.service");
      const groupId = randomUUID();
      const pitId = randomUUID();
      const group = resolveInjury(heroes, { resultId: "multiple-injuries", secondaryRoll: 2,
        injuries: [{ resultId: "leg-wound" }, { resultId: "chest-wound" }] }, "manual");
      const initial = await trx("warriors").first();
      const changedStats = { ...initial.stats, M: String(Number(initial.stats.M) - 1), T: String(Number(initial.stats.T) - 1) };
      await trx("warriors").update({ stats: changedStats, experience: 8, injury_conditions: JSON.stringify([
        { type: "stat-modifier", stat: "M", value: -1, name: "LEG WOUND", injuryId: groupId },
        { type: "stat-modifier", stat: "T", value: -1, name: "CHEST WOUND", injuryId: groupId },
      ]) });
      const common = { roster_id: f.roster.id, warrior_id: f.member.id, warrior_name: f.member.name,
        role: "Hero", model_index: 0, battle_number: 1, mode: "manual", pending: false, created_at: new Date() };
      await trx("warrior_injuries").insert([
        { ...common, id: groupId, result: group },
        { ...common, id: pitId, result: resolveInjury(heroes, { resultId: "sold-to-the-pits", pitOutcome: "won" }, "manual") },
      ]);
      await require("../migrations/20261101170000_individual_injuries_and_protected_xp").up(trx);
      const migrated = await trx("warriors").first();
      assert.deepEqual(migrated.stats, changedStats);
      assert.equal(migrated.experience, 8);
      assert.equal(migrated.injury_experience_floor, 8);
      const history = await trx("warrior_injuries");
      assert.equal(history.length, 3);
      assert.ok(history.every((entry) => entry.result.id !== "multiple-injuries" && entry.result.children.length === 0));
      assert.ok(migrated.injury_conditions.every((condition) => history.some((entry) =>
        entry.id === condition.injuryId && entry.result.name === condition.name)));
      assert.equal(new Set(migrated.injury_conditions.map((condition) => condition.injuryId)).size, 2);
    });
  });
  test("campaign recording is allowed only during injuries and cannot bypass its phase", async () => {
    const campaign = (await call("POST", "/campaigns", { name: "Injury campaign" })).body;
    const f = await fixture("Hero");
    await db("rosters").where({ id: f.roster.id }).update({ campaign_id: campaign.id, campaign_phase: "post_battle", campaign_step: 1 });
    const preview = await call("POST", `${f.path}/preview`, { mode: "manual", selection: { resultId: "leg-wound" } });
    assert.equal(preview.status, 201);
    await db("rosters").where({ id: f.roster.id }).update({ campaign_step: 2 });
    assert.equal((await call("POST", `${f.path}/${preview.body.id}/apply`, {})).status, 409);
    assert.equal((await call("GET", f.path)).body.canAdd, false);
    await db("rosters").where({ id: f.roster.id }).update({ campaign_step: 1 });
    assert.equal((await call("POST", `${f.path}/${preview.body.id}/apply`, {})).status, 200);
  });
  test("pending pit defeat can be simulated, previewed without side effects, and applied", async () => {
    const f = await fixture();
    assert.equal((await record(f, { resultId: "sold-to-the-pits" })).status, 200);
    const pending = (await call("GET", f.path)).body.history[0];
    const preview = await call("POST", `${f.path}/preview`, {
      mode: "simulated", resolvesId: pending.id, selection: { pitOutcome: "lost" },
    });
    assert.equal(preview.status, 201, JSON.stringify(preview.body));
    assert.equal(preview.body.result.pitOutcome, "lost");
    assert.ok(preview.body.result.children[0].roll <= 35);
    assert.equal((await call("GET", f.path)).body.history.length, 1);
    const applied = await call("POST", `${f.path}/${preview.body.id}/apply`, {});
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
  });
  test("negative-stat application fails atomically and all non-stat conditions remain explicit", async () => {
    const f = await fixture();
    await db("warriors").where({ id: f.member.id }).update({ stats: { ...f.member.stats, M: "0" } });
    const failed = await record(f, { resultId: "leg-wound" });
    assert.equal(failed.status, 409);
    assert.equal((await db("warrior_injuries").where({ warrior_id: f.member.id })).length, 0);
    for (const selection of [
      { resultId: "arm-wound", secondaryRoll: 1 },
      { resultId: "madness", secondaryRoll: 4 },
      { resultId: "smashed-leg", secondaryRoll: 1 },
      { resultId: "bitter-enmity", secondaryRoll: 5, hatredTarget: "Enemy warband" },
      { resultId: "hardened" }, { resultId: "horrible-scars" },
    ]) assert.equal((await record(f, selection)).status, 200);
    const member = await db("warriors").where({ id: f.member.id }).first();
    assert.equal(member.injury_conditions.length, 6);
    assert.ok(member.injury_conditions.every((condition) => condition.ruleText));
    assert.equal(member.injury_conditions.find((condition) => condition.type === "hatred").targetDescription, "Enemy warband");
  });
});
