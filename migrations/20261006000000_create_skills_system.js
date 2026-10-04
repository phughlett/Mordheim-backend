// Phase 3: skills tracking system.
//
// Three new tables plus one column on `warriors`:
//   - skills                        : catalog of all learnable skills — the 34 standard
//                                      skill-list skills (Combat/Shooting/Academic/Strength/
//                                      Speed, from 3Campaigns.pdf) plus every warband-specific
//                                      "Special" skill transcribed from each warband's own
//                                      fact sheet. Standard skills have warband_id/
//                                      special_list_name = null; warband-specific skills
//                                      reference their warband and (for warbands that print
//                                      more than one distinct Special list, e.g. Dwarf
//                                      Treasure Hunters' Troll Slayer list) a special_list_name
//                                      to disambiguate which list the skill belongs to.
//                                      applies_to_warrior_type_names narrows a skill (or an
//                                      entire list) to specific Hero types within the warband
//                                      when the source text restricts access further than the
//                                      category grant alone (e.g. Battle Monks' Emissary may
//                                      only take "warmonger", not the rest of the shared list).
//   - warrior_type_skill_categories  : which of the 6 skill categories (Combat/Shooting/
//                                      Academic/Strength/Speed/Special) each (warband,
//                                      warrior_type) pair can draw skills from. Scoped by
//                                      warband because a handful of warrior_types are shared
//                                      across warbands (eg "Champions (Mercenaries &
//                                      Amazons)") with different category grants per warband.
//                                      When category = 'Special', special_list_name picks out
//                                      which Special list(s) this Hero type can use, for the
//                                      warbands that print more than one.
//   - warrior_skills                 : the ledger of skills an individual warrior has actually
//                                      learned. No uniqueness constraint on (warrior_id,
//                                      skill_id): some Mordheim skills are explicitly
//                                      stackable/re-rollable per RAW (eg Marauders' "mutant").
//
// `warriors.skill_category_overrides` (jsonb, nullable) stores the two skill lists a promoted
// Henchman chooses under "Lad's Got Talent" (3Campaigns.pdf): a promoted Henchman keeps their
// original Henchman warrior_type (which has no category grant of its own in
// warrior_type_skill_categories), so their eligible categories come from this override instead.
// Each entry is `{ "category": "Combat" }` or, for a Special-list choice,
// `{ "category": "Special", "specialListName": "..." }`.

exports.up = async function up(knex) {
  await knex.schema.createTable("skills", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name", 255).notNullable();
    table.string("category", 32).notNullable();
    table.text("description").notNullable();
    table.uuid("warband_id").references("id").inTable("warbands").onDelete("CASCADE");
    table.string("special_list_name", 255);
    table.jsonb("applies_to_warrior_type_names");
    table.text("source_reference").notNullable();
    table.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE skills ADD CONSTRAINT skills_category_check CHECK (category IN ('Combat', 'Shooting', 'Academic', 'Strength', 'Speed', 'Special'))`);
  // A standard skill name is unique on its own; a warband-specific skill is unique within its
  // (warband, special list) scope. Partial indexes express this without a nullable-friendly
  // composite unique constraint.
  await knex.raw(`CREATE UNIQUE INDEX skills_standard_name_unique ON skills (name) WHERE warband_id IS NULL`);
  await knex.raw(`CREATE UNIQUE INDEX skills_warband_name_unique ON skills (warband_id, special_list_name, name) WHERE warband_id IS NOT NULL`);

  await knex.schema.createTable("warrior_type_skill_categories", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("warband_id").notNullable();
    table.uuid("warrior_type_id").notNullable();
    table.string("category", 32).notNullable();
    table.string("special_list_name", 255);
    table.timestamps(true, true);
    table.foreign(["warband_id", "warrior_type_id"]).references(["warband_id", "warrior_type_id"]).inTable("warband_warrior_types").onDelete("CASCADE");
  });
  await knex.raw(`ALTER TABLE warrior_type_skill_categories ADD CONSTRAINT warrior_type_skill_categories_category_check CHECK (category IN ('Combat', 'Shooting', 'Academic', 'Strength', 'Speed', 'Special'))`);
  await knex.raw(`CREATE UNIQUE INDEX warrior_type_skill_categories_unique ON warrior_type_skill_categories (warband_id, warrior_type_id, category, COALESCE(special_list_name, ''))`);

  await knex.schema.createTable("warrior_skills", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("warrior_id").notNullable().references("id").inTable("warriors").onDelete("CASCADE");
    table.uuid("skill_id").notNullable().references("id").inTable("skills").onDelete("RESTRICT");
    table.timestamp("acquired_at").notNullable().defaultTo(knex.fn.now());
    table.text("notes");
    table.timestamps(true, true);
    table.index("warrior_id");
  });

  await knex.schema.alterTable("warriors", (table) => {
    table.jsonb("skill_category_overrides");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warriors", (table) => {
    table.dropColumn("skill_category_overrides");
  });
  await knex.schema.dropTableIfExists("warrior_skills");
  await knex.schema.dropTableIfExists("warrior_type_skill_categories");
  await knex.schema.dropTableIfExists("skills");
};
