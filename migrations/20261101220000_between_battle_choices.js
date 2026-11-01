exports.up = async (knex) => {
  for (const table of ["warrior_skills", "warrior_spells", "warrior_advances"]) {
    await knex.schema.alterTable(table, (columns) => columns.integer("choice_battles_fought"));
    await knex(table).update({ choice_battles_fought: -1 });
  }
  await knex.raw(`
    CREATE FUNCTION stamp_warrior_choice() RETURNS trigger AS $$
    BEGIN
      IF NEW.choice_battles_fought IS NULL THEN
        SELECT r.battles_fought INTO NEW.choice_battles_fought
        FROM rosters r JOIN warriors w ON w.roster_id = r.id WHERE w.id = NEW.warrior_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  for (const table of ["warrior_skills", "warrior_spells", "warrior_advances"]) {
    await knex.raw(`CREATE TRIGGER stamp_choice BEFORE INSERT ON ?? FOR EACH ROW EXECUTE FUNCTION stamp_warrior_choice()`, [table]);
  }
  await knex.schema.createTable("consumed_item_uses", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("roster_id").notNullable().references("id").inTable("rosters").onDelete("CASCADE");
    table.uuid("warrior_id").notNullable();
    table.integer("battles_fought").notNullable();
    table.jsonb("state").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable("warrior_advance_revisions", (table) => {
    table.uuid("warrior_id").notNullable().references("id").inTable("warriors").onDelete("CASCADE");
    table.string("advance_table").notNullable();
    table.integer("experience_threshold").notNullable();
    table.integer("battles_fought").notNullable();
    table.primary(["warrior_id", "advance_table", "experience_threshold"]);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTable("consumed_item_uses");
  await knex.schema.dropTable("warrior_advance_revisions");
  for (const table of ["warrior_skills", "warrior_spells", "warrior_advances"]) {
    await knex.raw("DROP TRIGGER stamp_choice ON ??", [table]);
    await knex.schema.alterTable(table, (columns) => columns.dropColumn("choice_battles_fought"));
  }
  await knex.raw("DROP FUNCTION stamp_warrior_choice()");
};
