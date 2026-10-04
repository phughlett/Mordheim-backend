const heroThresholds = [2, 4, 6, 8, 11, 14, 17, 20, 24, 28, 32, 36, 41, 46, 51, 57, 63, 69, 76, 83, 90];
const henchmanThresholds = [2, 5, 9, 14];

function earnedCount(thresholds) {
  return [...thresholds].reverse().map((threshold, index) => `WHEN experience >= ${threshold} THEN ${thresholds.length - index}`).join(" ");
}

exports.up = async function up(knex) {
  await knex.schema.alterTable("warriors", (table) => {
    table.integer("advance_baseline").notNullable().defaultTo(0);
  });

  await knex("warriors").update({
    advance_baseline: knex.raw(`CASE WHEN role = 'Hero' THEN CASE ${earnedCount(heroThresholds)} ELSE 0 END ELSE CASE ${earnedCount(henchmanThresholds)} ELSE 0 END END`),
  });

  await knex.schema.createTable("warrior_advances", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("warrior_id").notNullable().references("id").inTable("warriors").onDelete("CASCADE");
    table.string("advance_table").notNullable();
    table.integer("experience_threshold").notNullable();
    table.string("mode").notNullable();
    table.integer("roll");
    table.integer("secondary_roll");
    table.string("result").notNullable();
    table.string("stat");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("consumed_at");
    table.index(["warrior_id", "advance_table", "experience_threshold"]);
    table.check("advance_table IN ('Hero', 'Henchman')");
    table.check("mode IN ('manual', 'simulated')");
    table.check("result IN ('stat_increase', 'new_skill', 'lads_got_talent')");
    table.check("stat IS NULL OR stat IN ('M', 'WS', 'BS', 'S', 'T', 'W', 'I', 'A', 'Ld')");
    table.check("roll IS NULL OR roll BETWEEN 2 AND 12");
    table.check("secondary_roll IS NULL OR secondary_roll BETWEEN 1 AND 6");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("warrior_advances");
  await knex.schema.alterTable("warriors", (table) => {
    table.dropColumn("advance_baseline");
  });
};
