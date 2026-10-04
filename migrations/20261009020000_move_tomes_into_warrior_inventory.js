const magicItemsListKey = "magic-items";
const tomeName = "Tome of Magic";
const tomeSourceReference = "1Rules.pdf — Tome of Magic (Rare 12)";

exports.up = async function up(knex) {
  const warbands = await knex("warbands").select("id");
  await knex("equipment_lists").insert(warbands.map((warband) => ({
    warband_id: warband.id,
    list_key: magicItemsListKey,
    name: "Rare Magic Items",
    source_reference: tomeSourceReference,
  })));

  const tomeOptions = await knex("equipment_options").insert(warbands.map((warband) => ({
    warband_id: warband.id,
    list_key: magicItemsListKey,
    name: tomeName,
    category: "set",
    unit_cost: 200,
    first_free: false,
    source_reference: tomeSourceReference,
    rule_text: "Rare 12; costs 200+D6x25 gc. Record an acquired item in inventory; this list price is not a fixed purchase price.",
  }))).returning(["id", "warband_id"]);
  const tomeOptionByWarband = new Map(tomeOptions.map((option) => [option.warband_id, option.id]));

  const legacyTomes = await knex("warrior_magic_tomes as tome")
    .join("warriors", "warriors.id", "tome.warrior_id")
    .join("rosters", "rosters.id", "warriors.roster_id")
    .select("tome.warrior_id as warriorId", "tome.unit_cost_paid as unitCostPaid", "rosters.warband_id as warbandId");
  if (legacyTomes.length) {
    await knex("warrior_inventory").insert(legacyTomes.map((tome) => {
      const equipmentOptionId = tomeOptionByWarband.get(tome.warbandId);
      if (!equipmentOptionId) throw new Error(`No Tome of Magic inventory option exists for warband ${tome.warbandId}.`);
      return {
        warrior_id: tome.warriorId,
        equipment_option_id: equipmentOptionId,
        model_index: -1,
        quantity: 1,
        unit_cost_paid: tome.unitCostPaid ?? 0,
      };
    }));
  }

  await knex.schema.dropTable("warrior_magic_tomes");
};

exports.down = async function down(knex) {
  await knex.schema.createTable("warrior_magic_tomes", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("warrior_id").notNullable().references("id").inTable("warriors").onDelete("CASCADE");
    table.integer("unit_cost_paid");
    table.timestamp("acquired_at").notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
    table.check("unit_cost_paid IS NULL OR unit_cost_paid >= 0");
    table.index(["warrior_id", "acquired_at"]);
  });

  const tomeInventory = await knex("warrior_inventory as inventory")
    .join("equipment_options as option", "option.id", "inventory.equipment_option_id")
    .where({ "option.list_key": magicItemsListKey, "option.name": tomeName })
    .select("inventory.id", "inventory.warrior_id as warriorId", "inventory.unit_cost_paid as unitCostPaid", "inventory.created_at as acquiredAt");
  if (tomeInventory.length) {
    await knex("warrior_magic_tomes").insert(tomeInventory.map((tome) => ({
      warrior_id: tome.warriorId,
      unit_cost_paid: tome.unitCostPaid,
      acquired_at: tome.acquiredAt,
    })));
    await knex("warrior_inventory").whereIn("id", tomeInventory.map((tome) => tome.id)).delete();
  }

  await knex("equipment_lists").where({ list_key: magicItemsListKey }).delete();
};
