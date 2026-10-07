exports.up = async function up(knex) {
  for (const name of ["warband_stash", "warrior_inventory"]) {
    await knex.schema.alterTable(name, (table) => {
      table.jsonb("map_result");
    });
  }
  const description = "Hero-only map. Choose its type or resolve a separate D6: 1 Fake, 2-3 Vague, 4 Catacomb, 5 Accurate, 6 Master. Scenario and exploration effects are not applied automatically; resolve them at the tabletop.";
  await knex("shop_items").where({ id: "mordheim-map" }).update({
    definition: knex.raw("jsonb_set(definition, '{description}', ?::jsonb)", [JSON.stringify(description)]),
  });
};

exports.down = async function down(knex) {
  for (const name of ["warband_stash", "warrior_inventory"]) {
    await knex.schema.alterTable(name, (table) => table.dropColumn("map_result"));
  }
};
