const spellsCatalog = require("../spells-catalog.json");
const spellProfileAccess = require("../spell-profile-access.json");

exports.up = async function up(knex) {
  await knex.schema.createTable("spell_disciplines", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name", 255).notNullable().unique();
    table.string("kind", 32).notNullable();
    table.text("source_reference").notNullable();
    table.text("casting_rule_summary").notNullable();
    table.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE spell_disciplines ADD CONSTRAINT spell_disciplines_kind_check CHECK (kind IN ('Magic', 'Prayer', 'Ritual', 'Rune'))`);

  await knex.schema.createTable("spells", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("spell_discipline_id").notNullable().references("id").inTable("spell_disciplines").onDelete("CASCADE");
    table.integer("d6_result");
    table.string("name", 255).notNullable();
    table.integer("casting_difficulty");
    table.string("difficulty_note", 64);
    table.text("effect_summary").notNullable();
    table.timestamps(true, true);
    table.unique(["spell_discipline_id", "name"]);
    table.check("d6_result IS NULL OR d6_result BETWEEN 1 AND 6");
    table.check("casting_difficulty IS NULL OR casting_difficulty BETWEEN 2 AND 12");
  });
  await knex.raw(`CREATE UNIQUE INDEX spells_discipline_d6_result_unique ON spells (spell_discipline_id, d6_result) WHERE d6_result IS NOT NULL`);

  await knex.schema.createTable("warrior_type_spell_disciplines", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("warband_id").references("id").inTable("warbands").onDelete("CASCADE");
    table.uuid("warrior_type_id").notNullable().references("id").inTable("warrior_types").onDelete("CASCADE");
    table.uuid("spell_discipline_id").notNullable().references("id").inTable("spell_disciplines").onDelete("CASCADE");
    table.string("choice_group", 128);
    table.integer("starting_spell_count");
    table.boolean("is_wizard").notNullable().defaultTo(false);
    table.text("selection_rule");
    table.text("source_reference").notNullable();
    table.timestamps(true, true);
    table.check("starting_spell_count IS NULL OR starting_spell_count >= 0");
  });
  await knex.raw(`CREATE UNIQUE INDEX warrior_type_spell_disciplines_unique ON warrior_type_spell_disciplines (COALESCE(warband_id, '00000000-0000-0000-0000-000000000000'::uuid), warrior_type_id, spell_discipline_id)`);

  await knex.schema.alterTable("warriors", (table) => {
    table.boolean("has_magic_tome").notNullable().defaultTo(false);
    table.uuid("selected_spell_discipline_id").references("id").inTable("spell_disciplines").onDelete("SET NULL");
  });

  await knex.schema.createTable("warrior_spells", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("warrior_id").notNullable().references("id").inTable("warriors").onDelete("CASCADE");
    table.uuid("spell_id").references("id").inTable("spells").onDelete("RESTRICT");
    table.string("custom_name", 255);
    table.integer("custom_casting_difficulty");
    table.string("custom_difficulty_note", 64);
    table.text("custom_effect_summary");
    table.text("custom_source_reference");
    table.boolean("is_starting").notNullable().defaultTo(false);
    table.string("acquisition_method", 24).notNullable().defaultTo("manual");
    table.integer("casting_difficulty_modifier").notNullable().defaultTo(0);
    table.text("notes");
    table.timestamp("acquired_at").notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
    table.check("(spell_id IS NOT NULL AND custom_name IS NULL) OR (spell_id IS NULL AND custom_name IS NOT NULL)");
    table.check("custom_casting_difficulty IS NULL OR custom_casting_difficulty BETWEEN 2 AND 12");
    table.check("acquisition_method IN ('starting', 'advance', 'tome', 'manual')");
    table.index("warrior_id");
  });
  await knex.raw(`CREATE UNIQUE INDEX warrior_spells_known_spell_unique ON warrior_spells (warrior_id, spell_id) WHERE spell_id IS NOT NULL`);

  const disciplineRows = await knex("spell_disciplines").insert(spellsCatalog.map((discipline) => ({
    name: discipline.name,
    kind: discipline.kind,
    source_reference: discipline.sourceReference,
    casting_rule_summary: discipline.castingRuleSummary,
  }))).returning(["id", "name"]);
  const disciplineIdByName = new Map(disciplineRows.map((row) => [row.name, row.id]));
  const spellRows = spellsCatalog.flatMap((discipline) => discipline.spells.map((spell) => ({
    spell_discipline_id: disciplineIdByName.get(discipline.name),
    d6_result: spell.roll,
    name: spell.name,
    casting_difficulty: spell.difficulty,
    difficulty_note: spell.difficultyNote || null,
    effect_summary: spell.effectSummary,
  })));
  await knex("spells").insert(spellRows);

  const warbandIdByName = new Map((await knex("warbands").select("id", "name")).map((row) => [row.name, row.id]));
  const warriorTypes = await knex("warrior_types").select("id", "name", "category");
  const accessRows = [];
  for (const access of spellProfileAccess) {
    const spellDisciplineId = disciplineIdByName.get(access.discipline);
    if (!spellDisciplineId) throw new Error(`Unknown spell discipline "${access.discipline}"`);
    let warriorTypeId;
    let warbandId = null;
    if (access.warband) {
      warbandId = warbandIdByName.get(access.warband);
      if (!warbandId) throw new Error(`Unknown warband "${access.warband}" in spell access`);
      const profile = await knex("warband_warrior_types as assignment")
        .join("warrior_types as warrior_type", "warrior_type.id", "assignment.warrior_type_id")
        .where("assignment.warband_id", warbandId)
        .where("warrior_type.name", access.warriorType)
        .where("warrior_type.category", access.category)
        .first("warrior_type.id");
      warriorTypeId = profile?.id;
    } else {
      const matches = warriorTypes.filter((profile) => profile.name === access.warriorType && profile.category === access.category);
      warriorTypeId = matches.length === 1 ? matches[0].id : null;
    }
    if (!warriorTypeId) {
      throw new Error(`No unique warrior type found for spell access: ${access.warband || "global"} / ${access.category} / ${access.warriorType}`);
    }
    accessRows.push({
      warband_id: warbandId,
      warrior_type_id: warriorTypeId,
      spell_discipline_id: spellDisciplineId,
      choice_group: access.choiceGroup || null,
      starting_spell_count: access.startingSpellCount,
      is_wizard: access.isWizard,
      selection_rule: access.selectionRule,
      source_reference: access.sourceReference,
    });
  }
  await knex("warrior_type_spell_disciplines").insert(accessRows);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("warrior_spells");
  await knex.schema.alterTable("warriors", (table) => {
    table.dropColumn("selected_spell_discipline_id");
    table.dropColumn("has_magic_tome");
  });
  await knex.schema.dropTableIfExists("warrior_type_spell_disciplines");
  await knex.schema.dropTableIfExists("spells");
  await knex.schema.dropTableIfExists("spell_disciplines");
};
