const { before, after, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const knex = require("knex");
const { createApp } = require("../src/app");
const { index, additions } = require("../src/services/warband-source.service");
const { syncWarbandCatalog } = require("../migrations/20261011030000_complete_graded_warband_catalog");
const { mercenarySects } = require("../src/services/warband-identity.service");
const sectSource = require("../warband-source/mercenary-sects.json");
const { catalog: shop, canBuyItem, canEquipItem } = require("../src/services/trading-catalog.service");

const db = knex(require("../knexfile")[process.env.NODE_ENV || "development"]);
let server, base, token, userId, warbands;
async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

describe("source-backed graded warband catalog", () => {
  before(async () => {
    await db.migrate.latest();
    server = createApp(db).listen(0);
    base = `http://127.0.0.1:${server.address().port}/api`;
    const registered = await call("POST", "/auth/register", { username: `source_${randomUUID().slice(0, 20)}`, password: "Warband-source-test-123!" });
    assert.equal(registered.status, 201);
    token = registered.body.token;
    userId = registered.body.user.id;
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

  test("all indexed warbands expose grades and source links without removing earlier warbands", () => {
    assert.deepEqual(warbands.map((band) => band.name).sort(), [...index.warbands.filter((band) => band.name !== "Mercenaries").map((band) => band.name), ...mercenarySects].sort());
    for (const entry of index.warbands.filter((band) => band.name !== "Mercenaries")) {
      const band = warbands.find((row) => row.name === entry.name);
      assert.equal(band.grade, entry.grade);
      assert.equal(band.sourceUrl, `${index.source}/${entry.path}`);
    }
    assert.equal(warbands.find((band) => band.name === "Amazons").displayName, "Amazons (Mordheim)");
  });

  test("Mercenary sects have distinct skill tables, profiles, leaders and special equipment", async () => {
    for (const sect of sectSource.sects) {
      const band = warbands.find((row) => row.name === sect.name);
      assert.ok(band);
      assert.equal(band.grade, "core");
      const types = (await call("GET", `/warbands/${band.id}/warrior-types`)).body;
      assert.equal(types.some((row) => row.name === "Wolf Companion"), sect.name === "Middenheim Mercenaries");
      const hiredSwords = (await call("GET", `/warbands/${band.id}/warrior-types?category=Hired%20Sword`)).body;
      assert.equal(hiredSwords.some((row) => row.name === "Wolf Priest of Ulric"), sect.name === "Middenheim Mercenaries");
      const roster = await call("POST", "/rosters", { name: sect.name, warbandId: band.id, treasury: 1000 });
      assert.equal(roster.status, 201, JSON.stringify(roster.body));
      const skillTables = {
        "Mercenary Captain": sectSource.captainSkills,
        "Champions (Mercenaries & Amazons)": sect.championSkills,
        Youngblood: sect.youngbloodSkills,
      };
      for (const [name, expected] of Object.entries(skillTables)) {
        const type = types.find((row) => row.name === name);
        assert.ok(type, name);
        const hired = await call("POST", `/rosters/${roster.body.id}/members`, { role: "Hero", name, warriorTypeId: type.id });
        assert.equal(hired.status, 201, JSON.stringify(hired.body));
        const skills = (await call("GET", `/members/${hired.body.id}/skills`)).body;
        assert.deepEqual(skills.eligibility.map((row) => row.category).sort(), [...expected].sort(), `${sect.name}: ${name}`);
        if (name === "Mercenary Captain") {
          assert.match(skills.learnedSkills.find((row) => row.isLeaderAbility).description, sect.name === "Reikland Mercenaries" ? /12"/ : /6"/);
        }
        if (["Mercenary Captain", "Champions (Mercenaries & Amazons)"].includes(name)) {
          assert.equal(Number(hired.body.stats.S), sect.name === "Middenheim Mercenaries" ? 4 : 3);
        }
        const equipment = (await call("GET", `/members/${hired.body.id}/equipment`)).body;
        assert.equal(equipment.availableOptions.some((row) => row.name === "Wolfcloak"), sect.name === "Middenheim Mercenaries");
      }
      const marksmen = types.find((row) => row.name === "Marksmen (All Others)");
      assert.equal(Number(marksmen.stats.BS), sect.name === "Reikland Mercenaries" ? 4 : 3);
      assert.equal(canBuyItem(shop.find((row) => row.id === "rapier"), sect.name), sect.name !== "Middenheim Mercenaries");
      assert.equal(canEquipItem(shop.find((row) => row.id === "cathayan-silk-clothes"), {
        warbandName: sect.name, typeName: "Mercenary Captain", role: "Hero",
      }), true);
      assert.equal(canEquipItem(shop.find((row) => row.id === "wolfcloak"), {
        warbandName: sect.name, typeName: "Mercenary Captain", role: "Hero",
      }), sect.name === "Middenheim Mercenaries");
      assert.equal(canEquipItem(shop.find((row) => row.id === "wolfcloak"), {
        warbandName: sect.name, typeName: "Warriors (Mercenaries)", role: "Henchman",
      }), false);
    }
  });

  test("legacy Mercenary rosters remain editable, recruitable and equipped but cannot be newly selected", async () => {
    const band = await db("warbands").where({ name: "Mercenaries" }).first();
    assert.equal(warbands.some((row) => row.name === "Mercenaries"), false);
    assert.equal((await call("POST", "/rosters", { warbandId: band.id })).status, 400);
    const [legacy] = await db("rosters").insert({
      user_id: userId, name: "Legacy", warband: band.name, warband_id: band.id, treasury: 500,
    }).returning("*");
    assert.equal((await call("GET", `/rosters/${legacy.id}`)).body.warband, "Mercenaries");
    const edit = await call("PATCH", `/rosters/${legacy.id}`, { name: "Legacy edited", warbandId: band.id });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal(Number(edit.body.treasury), 500);
    const types = (await call("GET", `/warbands/${band.id}/warrior-types`)).body;
    const captain = types.find((row) => row.name === "Mercenary Captain");
    const hired = await call("POST", `/rosters/${legacy.id}/members`, { role: "Hero", warriorTypeId: captain.id, name: "Old Captain" });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    assert.ok((await call("GET", `/members/${hired.body.id}/equipment`)).body.availableOptions.some((row) => row.name === "Sword"));
  });

  test("requested Orc and Osterlander display titles preserve canonical database names", async () => {
    for (const [name, title] of [["Orc", "Orc Mob"], ["Ostlanders", "Osterlander Mercenaries"]]) {
      const band = warbands.find((row) => row.name === name);
      assert.equal(band.displayName, title);
      const created = await call("POST", "/rosters", { name: title, warbandId: band.id });
      assert.equal(created.status, 201);
      assert.equal(created.body.warband, title);
      assert.equal((await db("rosters").where({ id: created.body.id }).first()).warband, name);
    }
  });

  for (const definition of additions) test(`${definition.name}: playable profiles, hiring, gear, skills and spells`, async () => {
    const band = warbands.find((entry) => entry.name === definition.name);
    const types = (await call("GET", `/warbands/${band.id}/warrior-types`)).body;
    for (const sourceType of definition.warriors) {
      const type = types.find((row) => row.name === sourceType.name && row.category === sourceType.role);
      assert.ok(type, sourceType.name);
      assert.deepEqual(type.stats, sourceType.stats);
      assert.equal(type.hireCost, sourceType.hireCost);
      assert.equal(type.startingExperience, sourceType.startingExperience);
      assert.equal(type.canGainExperience, sourceType.canGainExperience);
      assert.equal(type.maxCount, sourceType.maxCount);
      assert.equal(type.promotionEligibility, sourceType.promotionEligibility);
      const permissions = await db("warrior_equipment_lists").where({ warband_id: band.id, warrior_type_id: type.id }).pluck("list_key");
      assert.deepEqual(permissions.sort(), [...sourceType.equipmentListKeys].sort());
      const skills = await db("warrior_type_skill_categories").where({ warband_id: band.id, warrior_type_id: type.id }).pluck("category");
      assert.deepEqual(skills.sort(), [...sourceType.skillCategories].sort());
    }
    const created = await call("POST", "/rosters", { warbandId: band.id, treasury: 10000 });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.capacity.baseMaxMembers, definition.maxMembers);
    assert.deepEqual(created.body.capacity.specialRules, definition.specialRules);
    const leader = types.find((row) => row.name === definition.leaderType);
    const hired = await call("POST", `/rosters/${created.body.id}/members`, { name: "Source validation", role: "Hero", warriorTypeId: leader.id });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    assert.deepEqual(hired.body.stats, leader.stats);
    const saved = (await call("GET", `/rosters/${created.body.id}`)).body;
    assert.equal(saved.capacity.leader.id, hired.body.id);
    const equipment = (await call("GET", `/members/${hired.body.id}/equipment`)).body;
    if (definition.name === "Imperial Outriders") {
      const horse = equipment.availableOptions.find((option) => option.name === "Riding Horse");
      assert.ok(horse);
      assert.equal(equipment.inventory.filter((item) => item.name === "Riding Horse").length, 1);
      const duplicateMount = await call("POST", `/members/${hired.body.id}/equipment`, { equipmentOptionId: horse.id });
      assert.equal(duplicateMount.status, 400);
    }
    const sourceLeader = definition.warriors.find((type) => type.name === definition.leaderType);
    const expectedLists = definition.equipmentLists.filter((list) => sourceLeader.equipmentListKeys.includes(list.key));
    for (const list of expectedLists) {
      for (const item of list.items.filter((item) =>
        (!sourceLeader.allowedCategories || sourceLeader.allowedCategories.includes(item.category))
        && (!item.allowedWarriorTypeNames || item.allowedWarriorTypeNames.includes(leader.name)))) {
        assert.ok(equipment.availableOptions.some((option) => option.name === item.name && option.unitCost === item.unitCost), item.name);
      }
    }
    const affordable = equipment.availableOptions.find((item) => !item.firstFree && item.category === "weapon");
    if (affordable) {
      const purchase = await call("POST", `/members/${hired.body.id}/equipment`, { equipmentOptionId: affordable.id });
      assert.equal(purchase.status, 201, JSON.stringify(purchase.body));
      assert.ok(purchase.body.inventory.some((item) => item.equipmentOptionId === affordable.id));
    }
    const skills = await call("GET", `/members/${hired.body.id}/skills`);
    assert.equal(skills.status, 200);
    const spells = await call("GET", `/members/${hired.body.id}/spells`);
    assert.equal(spells.status, 200);
    const expectedSpellAccess = definition.spellAccess?.filter((access) => access.warriorType === leader.name) ?? [];
    if (expectedSpellAccess.length) assert.equal(spells.body.hasSpellcastingProfile, true);
  });

  test("catalog sync is idempotent and does not reset recruited warriors, treasury or equipment IDs", async () => {
    const roster = await db("rosters").where({ user_id: userId }).first();
    const beforeRoster = await db("rosters").where({ id: roster.id }).first();
    const beforeWarriors = await db("warriors").where({ roster_id: roster.id }).orderBy("id");
    const beforeIds = await db("equipment_options").select("id", "warband_id", "list_key", "name").orderBy("id");
    const transaction = await db.transaction();
    try {
      await syncWarbandCatalog(transaction);
      assert.deepEqual(await transaction("rosters").where({ id: roster.id }).first(), beforeRoster);
      assert.deepEqual(await transaction("warriors").where({ roster_id: roster.id }).orderBy("id"), beforeWarriors);
      assert.deepEqual(await transaction("equipment_options").select("id", "warband_id", "list_key", "name").orderBy("id"), beforeIds);
    } finally {
      await transaction.rollback();
    }
  });

  test("source material variants and shared spell aliases retain the correct profiles", async () => {
    const rangers = warbands.find((band) => band.name === "Dwarf Rangers");
    const options = await db("equipment_options as option")
      .leftJoin("weapon_material_modifiers as material", "material.id", "option.material_modifier_id")
      .leftJoin("armour_profiles as armour", "armour.id", "option.armour_profile_id")
      .where({ "option.warband_id": rangers.id })
      .select("option.name", "material.name as material_name", "armour.name as armour_name");
    assert.equal(options.find((option) => option.name === "Gromril sword").material_name, "Gromril weapon");
    assert.equal(options.find((option) => option.name === "Gromril pistol").material_name, null);
    assert.equal(options.find((option) => option.name === "Gromril crossbow").material_name, null);
    assert.equal(options.find((option) => option.name === "Gromril armour").armour_name, "Gromril armour");
    for (const name of ["Amazon Rituals", "Magic of the Horned Rat"]) {
      const discipline = await db("spell_disciplines").where({ name }).first();
      const spells = await db("spells").where({ spell_discipline_id: discipline.id });
      assert.equal(spells.length, 6, name);
      assert.equal(new Set(spells.map((spell) => spell.d6_result)).size, 6);
    }
  });

  test("existing warbands gain their missing source warriors without altering other factions", async () => {
    const averlanders = warbands.find((band) => band.name === "Averlander Mercenaries");
    const heroes = (await call("GET", `/warbands/${averlanders.id}/warrior-types?category=Hero`)).body;
    const sergeant = heroes.find((type) => type.name === "Sergeant");
    assert.ok(sergeant);
    assert.equal(sergeant.hireCost, 35);
    assert.equal(sergeant.startingExperience, 8);
    assert.equal(sergeant.maxCount, 1);
    const orcs = warbands.find((band) => band.name === "Orc");
    const henchmen = (await call("GET", `/warbands/${orcs.id}/warrior-types?category=Henchman`)).body;
    const troll = henchmen.find((type) => type.name === "Troll");
    assert.ok(troll);
    assert.equal(troll.hireCost, 200);
    assert.equal(troll.canGainExperience, false);
    assert.equal(troll.maxCount, 1);
  });
});
