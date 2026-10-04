const { categoryChoices, skills } = require("../hired-sword-skills.json");

exports.up = async function up(knex) {
  await knex.schema.alterTable("skills", (table) => {
    table.uuid("warrior_type_id").nullable().references("id").inTable("warrior_types").onDelete("CASCADE");
    table.boolean("is_starting").notNullable().defaultTo(false);
    table.boolean("is_learnable").notNullable().defaultTo(true);
  });
  await knex.raw("ALTER TABLE skills ADD CONSTRAINT skills_scope_check CHECK (warband_id IS NULL OR warrior_type_id IS NULL)");
  await knex.raw("DROP INDEX skills_standard_name_unique");
  await knex.raw("CREATE UNIQUE INDEX skills_standard_name_unique ON skills (name) WHERE warband_id IS NULL AND warrior_type_id IS NULL");
  await knex.raw("CREATE UNIQUE INDEX skills_hired_sword_name_unique ON skills (warrior_type_id, special_list_name, name) WHERE warrior_type_id IS NOT NULL");

  await knex.schema.createTable("hired_sword_skill_categories", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("warrior_type_id").notNullable().references("id").inTable("warrior_types").onDelete("CASCADE");
    table.string("category", 32).notNullable();
    table.string("special_list_name", 255);
    table.timestamps(true, true);
    table.check("category IN ('Combat', 'Shooting', 'Academic', 'Strength', 'Speed', 'Special')");
    table.check("(category = 'Special' AND special_list_name IS NOT NULL) OR (category <> 'Special' AND special_list_name IS NULL)");
  });
  await knex.raw(`CREATE UNIQUE INDEX hired_sword_skill_categories_unique
    ON hired_sword_skill_categories (warrior_type_id, category, COALESCE(special_list_name, ''))`);

  const hiredSwordIds = new Map(
    (await knex("warrior_types").where({ category: "Hired Sword" }).select("id", "name"))
      .map((type) => [type.name, type.id]),
  );
  const categoryRows = categoryChoices.map((entry) => {
    const warriorTypeId = hiredSwordIds.get(entry.warriorType);
    if (!warriorTypeId) throw new Error(`Unknown Hired Sword type "${entry.warriorType}" in skill eligibility data`);
    return {
      warrior_type_id: warriorTypeId,
      category: entry.category,
      special_list_name: entry.specialListName ?? null,
    };
  });
  await knex("hired_sword_skill_categories").insert(categoryRows);

  const skillRows = skills.map((skill) => {
    const warriorTypeId = hiredSwordIds.get(skill.warriorType);
    if (!warriorTypeId) throw new Error(`Unknown Hired Sword type "${skill.warriorType}" in skill data`);
    return {
      name: skill.name,
      category: skill.category,
      description: skill.description,
      warrior_type_id: warriorTypeId,
      special_list_name: skill.specialListName,
      is_starting: skill.starting,
      is_learnable: skill.learnable,
      source_reference: skill.sourceReference,
    };
  });
  await knex("skills").insert(skillRows);

  await knex.schema.alterTable("warrior_skills", (table) => {
    table.boolean("is_starting").notNullable().defaultTo(false);
  });
  await knex.raw(`
    INSERT INTO warrior_skills (warrior_id, skill_id, is_starting)
    SELECT warrior.id, skill.id, TRUE
    FROM warriors AS warrior
    JOIN skills AS skill
      ON skill.warrior_type_id = warrior.warrior_type_id
     AND skill.is_starting = TRUE
    WHERE warrior.role = 'Hired Sword'
      AND NOT EXISTS (
        SELECT 1 FROM warrior_skills AS existing
        WHERE existing.warrior_id = warrior.id AND existing.skill_id = skill.id
      )
  `);
};

exports.down = async function down(knex) {
  await knex("warrior_skills")
    .whereIn("skill_id", knex("skills").whereNotNull("warrior_type_id").select("id"))
    .delete();
  await knex("hired_sword_skill_categories").del();
  await knex.schema.dropTableIfExists("hired_sword_skill_categories");
  await knex.raw("DROP INDEX IF EXISTS skills_hired_sword_name_unique");
  await knex.raw("DROP INDEX IF EXISTS skills_standard_name_unique");
  await knex.raw("ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_scope_check");
  await knex.raw("CREATE UNIQUE INDEX skills_standard_name_unique ON skills (name) WHERE warband_id IS NULL");
  await knex.schema.alterTable("warrior_skills", (table) => {
    table.dropColumn("is_starting");
  });
  await knex.schema.alterTable("skills", (table) => {
    table.dropColumn("is_learnable");
    table.dropColumn("is_starting");
    table.dropColumn("warrior_type_id");
  });
};
