const catalog = require("../catalog.json");

const sheetOrderOverrides = {
  Amazons: {
    Hero: ["Priestess", "Champions (Mercenaries & Amazons)", "Totem Warriors"],
    Henchman: ["Amazon Warriors", "Scouts"],
  },
  "Dwarf Treasure Hunters": {
    Hero: ["Dwarf Noble", "Dwarf Troll Slayers", "Dwarf Engineer"],
    Henchman: ["Dwarf Clansmen", "Beardlings", "Dwarf Thunderers"],
  },
  Lizardmen: {
    Hero: ["Skink Priest", "Saurus Totem Warrior", "Skink Great Crests"],
    Henchman: ["Skink Braves", "Saurus Braves", "Kroxigor"],
  },
  Ostlanders: {
    Hero: ["Elder", "Blood Brothers", "Priest of Taal"],
    Henchman: ["Kin", "Ruffians", "Jaeger", "Ogre"],
  },
  "Pit Fighter": {
    Hero: ["Pit King", "Dwarf Troll Slayer (Pit Fighter)", "Pit Veterans"],
    Henchman: ["Ogre Pit Fighter", "Pursuers", "Pit Fighters (Pit Fighter)"],
  },
};

function associationKey(association) {
  return `${association.sourceReference}::${association.category}::${association.warriorName}`;
}

exports.up = async function up(knex) {
  await knex.schema.alterTable("warband_warrior_types", (table) => {
    table.integer("sheet_order");
  });
  await knex.schema.alterTable("rosters", (table) => {
    table.boolean("member_order_customized").notNullable().defaultTo(false);
  });

  const [warbands, warriorTypes] = await Promise.all([
    knex("warbands").select("id", "name"),
    knex("warrior_types").select("id", "catalog_key"),
  ]);
  const warbandIds = new Map(warbands.map((warband) => [warband.name, warband.id]));
  const warriorTypeIds = new Map(warriorTypes.map((type) => [type.catalog_key, type.id]));
  const nextOrderByClass = new Map();
  const associationsByWarbandClass = new Map();

  for (const association of catalog.associations) {
    const warbandId = warbandIds.get(association.warbandName);
    const warriorTypeId = warriorTypeIds.get(associationKey(association));
    if (!warbandId || !warriorTypeId) continue;

    const classKey = `${association.warbandName}:${association.category}`;
    const sheetOrder = nextOrderByClass.get(classKey) || 0;
    nextOrderByClass.set(classKey, sheetOrder + 1);
    const entry = { warbandId, warriorTypeId, warriorName: association.warriorName, sheetOrder };
    const classAssociations = associationsByWarbandClass.get(classKey) || [];
    classAssociations.push(entry);
    associationsByWarbandClass.set(classKey, classAssociations);
  }

  await knex.transaction(async (transaction) => {
    for (const entries of associationsByWarbandClass.values()) {
      for (const entry of entries) {
        await transaction("warband_warrior_types")
          .where({ warband_id: entry.warbandId, warrior_type_id: entry.warriorTypeId })
          .update({ sheet_order: entry.sheetOrder });
      }
    }

    for (const [warbandName, categories] of Object.entries(sheetOrderOverrides)) {
      for (const [category, orderedNames] of Object.entries(categories)) {
        const classKey = `${warbandName}:${category}`;
        const entries = associationsByWarbandClass.get(classKey) || [];
        const orderedEntries = orderedNames
          .map((name) => entries.find((entry) => entry.warriorName === name))
          .filter(Boolean);
        const orderedIds = new Set(orderedEntries.map((entry) => entry.warriorTypeId));
        const remainingEntries = entries.filter((entry) => !orderedIds.has(entry.warriorTypeId));
        for (const [sheetOrder, entry] of [...orderedEntries, ...remainingEntries].entries()) {
          await transaction("warband_warrior_types")
            .where({ warband_id: entry.warbandId, warrior_type_id: entry.warriorTypeId })
            .update({ sheet_order: sheetOrder });
        }
      }
    }
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("rosters", (table) => {
    table.dropColumn("member_order_customized");
  });
  await knex.schema.alterTable("warband_warrior_types", (table) => {
    table.dropColumn("sheet_order");
  });
};
