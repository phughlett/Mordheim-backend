exports.up = async function up(knex) {
  await knex.schema.createTable("warrior_mutations", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("warrior_id").notNullable().references("id").inTable("warriors").onDelete("CASCADE");
    table.string("mutation_id").notNullable();
    table.integer("position").notNullable();
    table.integer("unit_cost_paid").notNullable();
    table.unique(["warrior_id", "position"]);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable("warrior_mutations");
};
