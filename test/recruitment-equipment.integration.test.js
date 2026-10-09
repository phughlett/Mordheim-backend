const { before, after, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const knex = require("knex");
const { createApp } = require("../src/app");
const { up: correctEquipment } = require("../migrations/20261011080000_correct_recruitment_equipment_access");
const source = require("./fixtures/recruitment-equipment-source.json");

const db = knex(require("../knexfile")[process.env.NODE_ENV || "development"]);
let server, base, token, userId, warbands;

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function hire(warbandName, name, role = "Hero", extra = {}) {
  const band = warbands.find((row) => row.name === warbandName);
  assert.ok(band, warbandName);
  const roster = await call("POST", "/rosters", { warbandId: band.id, treasury: 5000, name: "Equipment audit" });
  assert.equal(roster.status, 201, JSON.stringify(roster.body));
  const types = (await call("GET", `/warbands/${band.id}/warrior-types`)).body;
  const type = types.find((row) => row.name === name && row.category === role);
  assert.ok(type, `${warbandName}/${name}`);
  const hired = await call("POST", `/rosters/${roster.body.id}/members`,
    { name, role, warriorTypeId: type.id, ...extra });
  assert.equal(hired.status, 201, JSON.stringify(hired.body));
  const equipment = await call("GET", `/members/${hired.body.id}/equipment`);
  assert.equal(equipment.status, 200);
  return { band, roster: roster.body, member: hired.body, equipment: equipment.body };
}

async function rejectOption(fixture, name, listKey) {
  const query = db("equipment_options").where({ warband_id: fixture.band.id, name });
  if (listKey) query.where({ list_key: listKey });
  const option = await query.first();
  assert.ok(option, name);
  const before = await db("rosters").where({ id: fixture.roster.id }).first("treasury");
  const purchase = await call("POST", `/members/${fixture.member.id}/equipment`,
    { equipmentOptionId: option.id, quantity: 1, modelIndex: -1 });
  assert.equal(purchase.status, 400, JSON.stringify(purchase.body));
  assert.deepEqual(await db("rosters").where({ id: fixture.roster.id }).first("treasury"), before);
}

describe("source-backed recruitment equipment access", () => {
  before(async () => {
    await db.migrate.latest();
    server = createApp(db).listen(0);
    base = `http://127.0.0.1:${server.address().port}/api`;
    const auth = await call("POST", "/auth/register", {
      username: `gear_${randomUUID().slice(0, 20)}`, password: "Equipment-audit-tests-123!",
    });
    assert.equal(auth.status, 201);
    token = auth.body.token;
    userId = auth.body.user.id;
    warbands = (await call("GET", "/warbands")).body;
  });
  after(async () => {
    if (userId) {
      await db("rosters").where({ user_id: userId }).delete();
      await db("users").where({ id: userId }).delete();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.destroy();
  });

  test("all 275 Hero/Henchman associations match the independently mapped source lists", async () => {
    const rows = await db("warband_warrior_types as access")
      .join("warbands as band", "band.id", "access.warband_id")
      .join("warrior_types as type", "type.id", "access.warrior_type_id")
      .whereIn("access.availability", ["allowed", "conditional"])
      .whereIn("type.category", ["Hero", "Henchman"])
      .select("band.name as warband", "type.name as type", "type.category as role",
        "band.id as warbandId", "type.id as typeId").orderBy(["band.name", "type.name"]);
    const permissions = await db("warrior_equipment_lists");
    assert.equal(source.rows.length, 275);
    assert.equal(new Set(source.rows.map((row) => row.warband)).size, 42);
    assert.deepEqual(rows.map(({ warband, type, role }) => ({ warband, type, role })),
      source.rows.map(({ warband, type, role }) => ({ warband, type, role })));
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const lists = permissions.filter((entry) => entry.warband_id === row.warbandId && entry.warrior_type_id === row.typeId)
        .map((entry) => entry.list_key).sort();
      assert.deepEqual(lists, source.rows[index].lists, `${row.warband}/${row.type}`);
    }
  });

  test("Night Runners get only Henchmen gear; other Skaven Heroes keep Hero gear", async () => {
    const runner = await hire("Skaven", "Night Runners");
    assert.deepEqual([...new Set(runner.equipment.availableOptions.map((row) => row.listKey))], ["skaven-henchman"]);
    assert.ok(runner.equipment.availableOptions.some((row) => row.name === "Shield"));
    assert.ok(runner.equipment.availableOptions.some((row) => row.name === "Club"));
    assert.equal(runner.equipment.inventory.filter((row) => row.name === "Dagger").length, 1);
    for (const name of ["Weeping blades", "Fighting claws", "Warplock pistol"]) {
      assert.equal(runner.equipment.availableOptions.some((row) => row.name === name), false);
      await rejectOption(runner, name, "skaven-hero");
    }
    const hero = await hire("Skaven", "Black Skaven");
    assert.ok(hero.equipment.availableOptions.some((row) => row.name === "Weeping blades"));
    assert.equal(hero.equipment.availableOptions.some((row) => row.name === "Shield"), false);
    const verminkin = await hire("Skaven", "Verminkin", "Henchman", { groupSize: 2 });
    assert.deepEqual([...new Set(verminkin.equipment.availableOptions.map((row) => row.listKey))], ["skaven-henchman"]);
    assert.equal(verminkin.equipment.inventory.filter((row) => row.name === "Dagger").length, 2);
  });

  test("Norse Jarl may wear armour; Berserkers may not; Hunter and Marauder lists are not swapped", async () => {
    const jarl = await hire("Norse", "Jarl");
    assert.ok(jarl.equipment.availableOptions.some((row) => row.name === "Light armour"));
    assert.ok(jarl.equipment.availableOptions.some((row) => row.name === "Shield"));
    const berserker = await hire("Norse", "Berserkers");
    assert.ok(berserker.equipment.availableOptions.every((row) => row.category === "weapon"));
    await rejectOption(berserker, "Light armour", "norse-hero");
    const hunter = await hire("Norse", "Hunters (Norse)", "Henchman");
    assert.ok(hunter.equipment.availableOptions.some((row) => row.name === "Bow"));
    assert.ok(hunter.equipment.availableOptions.some((row) => row.name === "Javelins"));
    assert.equal(hunter.equipment.availableOptions.some((row) => row.name === "Throwing axes"), false);
    const marauder = await hire("Norse", "Marauders", "Henchman");
    assert.ok(marauder.equipment.availableOptions.some((row) => row.name === "Throwing axes"));
    assert.ok(marauder.equipment.availableOptions.some((row) => row.name === "Light armour"));
    assert.equal(marauder.equipment.availableOptions.some((row) => row.name === "Bow"), false);
  });

  test("Possessed receive no free dagger or weapons and need an Extra Arm to buy a shield", async () => {
    const possessed = await hire("Cult of the Possessed", "The Possessed");
    assert.deepEqual(possessed.equipment.availableOptions, []);
    assert.deepEqual(possessed.equipment.inventory, []);
    await rejectOption(possessed, "Sword", "possessed");
    await rejectOption(possessed, "Shield", "possessed");
    const mutation = await call("PUT", `/members/${possessed.member.id}/mutations`, { mutationIds: ["extra-arm"] });
    assert.equal(mutation.status, 200, JSON.stringify(mutation.body));
    const options = (await call("GET", `/members/${possessed.member.id}/equipment`)).body.availableOptions;
    assert.ok(options.some((row) => row.name === "Shield"));
    assert.ok(options.every((row) => row.category === "shield"));
    const option = options.find((row) => row.name === "Shield");
    assert.equal((await call("POST", `/members/${possessed.member.id}/equipment`,
      { equipmentOptionId: option.id, quantity: 1, modelIndex: -1 })).status, 201);
    await rejectOption(possessed, "Sword", "possessed");
  });

  test("Orc Shamans and Kislevite Esaul/Youths receive only their permitted weapons", async () => {
    for (const [band, name, listKey] of [
      ["Orc", "Orc Shaman", "orc"], ["Kislevite", "Esaul", "kislev-warrior"], ["Kislevite", "Youths", "kislev-warrior"],
    ]) {
      const fixture = await hire(band, name);
      assert.ok(fixture.equipment.availableOptions.length);
      assert.ok(fixture.equipment.availableOptions.every((row) => row.category === "weapon"));
      await rejectOption(fixture, "Light armour", listKey);
      await rejectOption(fixture, "Shield", listKey);
    }
  });

  test("Fellblades cannot buy missiles and Ostlander Priests of Taal cannot buy heavy armour", async () => {
    const fellblade = await hire("Dark Elves", "Fellblades");
    assert.ok(fellblade.equipment.availableOptions.some((row) => row.name === "Sword"));
    assert.equal(fellblade.equipment.availableOptions.some((row) => row.name === "Repeater crossbow"), false);
    await rejectOption(fellblade, "Repeater crossbow", "dark-elf");
    await rejectOption(fellblade, "Crossbow pistol", "dark-elf");
    const priest = await hire("Ostlanders", "Priest of Taal");
    assert.ok(priest.equipment.availableOptions.some((row) => row.name === "Light armour"));
    assert.equal(priest.equipment.availableOptions.some((row) => row.name === "Heavy armour"), false);
    await rejectOption(priest, "Heavy armour", "ostlander");
  });

  test("Condemned have no starting equipment and regain access only with fixed characteristics", async () => {
    const condemned = await hire("Marauders of Chaos", "Condemned");
    assert.deepEqual(condemned.equipment.availableOptions, []);
    assert.deepEqual(condemned.equipment.inventory, []);
    await rejectOption(condemned, "Sword", "marauder-hero");
    const original = await db("warriors").where({ id: condemned.member.id }).first("stats");
    await db("warriors").where({ id: condemned.member.id }).update({
      stats: JSON.stringify({ ...original.stats, WS: "4", S: "4", T: "4", A: "2" }),
    });
    const options = (await call("GET", `/members/${condemned.member.id}/equipment`)).body.availableOptions;
    assert.ok(options.some((row) => row.name === "Sword"));
    assert.ok(options.some((row) => row.name === "Heavy armour"));
  });

  test("trading recipient suggestions and direct transfers enforce the same conditional bans", async () => {
    for (const [band, type, item, listKey] of [
      ["Skaven", "Night Runners", "Weeping blades", "skaven-hero"],
      ["Dark Elves", "Fellblades", "Repeater crossbow", "dark-elf"],
      ["Ostlanders", "Priest of Taal", "Heavy armour", "ostlander"],
      ["Orc", "Orc Shaman", "Shield", "orc"],
      ["Cult of the Possessed", "The Possessed", "Shield", "possessed"],
      ["Marauders of Chaos", "Condemned", "Sword", "marauder-hero"],
    ]) {
      const fixture = await hire(band, type);
      const option = await db("equipment_options").where({ warband_id: fixture.band.id, name: item, list_key: listKey }).first();
      assert.ok(option, item);
      const [stash] = await db("warband_stash").insert({
        roster_id: fixture.roster.id, equipment_option_id: option.id, quantity: 1, unit_cost_paid: option.unit_cost,
      }).returning("*");
      const state = await call("GET", `/rosters/${fixture.roster.id}/trading`);
      assert.equal(state.status, 200, JSON.stringify(state.body));
      assert.deepEqual(state.body.stash.find((row) => row.id === stash.id).eligibleRecipients, [], `${band}/${type}`);
      const transfer = await call("POST", `/rosters/${fixture.roster.id}/trading/transfer`,
        { direction: "to_member", inventoryId: stash.id, memberId: fixture.member.id, quantity: 1, modelIndex: -1 });
      assert.equal(transfer.status, 409, JSON.stringify(transfer.body));
      assert.match(transfer.body.error, /cannot use this item/);
      assert.deepEqual(await db("warband_stash").where({ id: stash.id }).first(), stash);
    }
    const possessed = await hire("Cult of the Possessed", "The Possessed");
    assert.equal((await call("PUT", `/members/${possessed.member.id}/mutations`, { mutationIds: ["extra-arm"] })).status, 200);
    const [stash] = await db("warband_stash").insert({
      roster_id: possessed.roster.id, shop_item_id: "buckler", quantity: 1, unit_cost_paid: 5,
    }).returning("*");
    assert.equal((await call("POST", `/rosters/${possessed.roster.id}/trading/transfer`, {
      direction: "to_member", inventoryId: stash.id, memberId: possessed.member.id, quantity: 1, modelIndex: -1,
    })).status, 200);
  });

  test("upgrading legacy assignments moves Norse options without replacing purchased inventory", async () => {
    const fixture = await hire("Norse", "Hunters (Norse)", "Henchman");
    const runner = await hire("Skaven", "Night Runners");
    const trx = await db.transaction();
    try {
      const beforeOptions = await trx("equipment_options").select("id", "warband_id", "list_key", "name", "unit_cost").orderBy("id");
      for (const [from, to, names] of [
        ["norse-hunter", "norse-henchman", ["Bow", "Javelins"]],
        ["norse-henchman", "norse-hunter", ["Throwing axes", "Light armour"]],
      ]) {
        await trx("equipment_options").where({ warband_id: fixture.band.id, list_key: from }).whereIn("name", names)
          .update({ list_key: to });
      }
      const member = await trx("warriors").where({ id: runner.member.id }).first();
      await trx("warrior_equipment_lists").where({ warband_id: runner.band.id, warrior_type_id: member.warrior_type_id })
        .update({ list_key: "skaven-hero" });
      const bow = await trx("equipment_options").where({ warband_id: fixture.band.id, name: "Bow" }).first();
      const [carried] = await trx("warrior_inventory").insert({
        warrior_id: fixture.member.id, equipment_option_id: bow.id, quantity: 1, model_index: 0, unit_cost_paid: 10,
      }).returning("*");
      const roster = await trx("rosters").where({ id: fixture.roster.id }).first();
      await correctEquipment(trx);
      assert.deepEqual(await trx("equipment_options").select("id", "warband_id", "list_key", "name", "unit_cost").orderBy("id"),
        beforeOptions);
      assert.deepEqual(await trx("warrior_inventory").where({ id: carried.id }).first(), carried);
      assert.deepEqual(await trx("rosters").where({ id: fixture.roster.id }).first(), roster);
      assert.deepEqual((await trx("warrior_equipment_lists")
        .where({ warband_id: runner.band.id, warrior_type_id: member.warrior_type_id })).map((row) => row.list_key),
      ["skaven-henchman"]);
    } finally {
      await trx.rollback();
    }
  });

  test("the correction migration is repeatable without changing existing gear IDs, warriors or treasury", async () => {
    const roster = await db("rosters").where({ user_id: userId }).first();
    const before = {
      roster: await db("rosters").where({ id: roster.id }).first(),
      warriors: await db("warriors").where({ roster_id: roster.id }).orderBy("id"),
      inventory: await db("warrior_inventory").whereIn("warrior_id",
        db("warriors").where({ roster_id: roster.id }).select("id")).orderBy("id"),
      options: await db("equipment_options").select("id", "warband_id", "list_key", "name").orderBy("id"),
    };
    await db.transaction(async (trx) => { await correctEquipment(trx); await correctEquipment(trx); });
    assert.deepEqual(await db("rosters").where({ id: roster.id }).first(), before.roster);
    assert.deepEqual(await db("warriors").where({ roster_id: roster.id }).orderBy("id"), before.warriors);
    assert.deepEqual(await db("warrior_inventory").whereIn("warrior_id",
      db("warriors").where({ roster_id: roster.id }).select("id")).orderBy("id"), before.inventory);
    assert.deepEqual(await db("equipment_options").select("id", "warband_id", "list_key", "name").orderBy("id"), before.options);
  });
});
