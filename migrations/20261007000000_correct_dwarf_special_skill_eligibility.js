// Correction per fact sheet + 3Campaigns.pdf "Lad's Got Talent": any Dwarf Hero in the Dwarf
// Treasure Hunters warband (Engineer, Noble, and Troll Slayers alike) can draw from the
// generic "Dwarf special skills" list, but only the Troll Slayers warrior type may draw from
// the "TROLL SLAYER SKILLS" list. A Lad's Got Talent-promoted Henchman is never a genuine
// Troll Slayer, so that list must never be offered/granted to one; conversely, since every
// real Dwarf Hero type gets "Dwarf special skills" regardless of which type they are, a
// promoted Henchman should inherit it automatically too, without spending one of their 2
// Lad's Got Talent picks on it.
//
// `warrior_type_skill_categories.eligibility_mode` captures this for the Lad's Got Talent
// flow only (real warriors are unaffected - they keep using their own warrior_type's rows
// exactly as before, regardless of mode):
//   - 'choice'    (default) - offered as a Lad's Got Talent option; behaves exactly as before.
//   - 'auto'      - never offered as a choice; automatically granted to every promoted
//                   Henchman in the warband in addition to their 2 chosen lists.
//   - 'exclusive' - never offered as a choice and never auto-granted; only warriors who are
//                   genuinely of that warrior type (not promoted Henchmen) can use it.
exports.up = async function up(knex) {
  await knex.schema.alterTable("warrior_type_skill_categories", (table) => {
    table.string("eligibility_mode", 16).notNullable().defaultTo("choice");
  });
  await knex.raw(`ALTER TABLE warrior_type_skill_categories ADD CONSTRAINT warrior_type_skill_categories_eligibility_mode_check CHECK (eligibility_mode IN ('choice', 'auto', 'exclusive'))`);

  const warband = await knex("warbands").where({ name: "Dwarf Treasure Hunters" }).first("id");
  if (!warband) throw new Error("Dwarf Treasure Hunters warband not found");

  const trollSlayers = await knex("warrior_types").where({ name: "Dwarf Troll Slayers", category: "Hero" }).first("id");
  if (!trollSlayers) throw new Error("Dwarf Troll Slayers warrior type not found");

  // Every Dwarf Hero type (including Troll Slayers) can draw from the generic Dwarf special
  // skills list, and it's inherent to being a Dwarf Hero rather than a chosen Lad's Got
  // Talent list.
  await knex("warrior_type_skill_categories")
    .where({ warband_id: warband.id, category: "Special", special_list_name: "Dwarf special skills" })
    .update({ eligibility_mode: "auto" });
  const [existingTrollSlayerDwarfSkills] = await knex("warrior_type_skill_categories")
    .where({ warband_id: warband.id, warrior_type_id: trollSlayers.id, category: "Special", special_list_name: "Dwarf special skills" });
  if (!existingTrollSlayerDwarfSkills) {
    await knex("warrior_type_skill_categories").insert({
      warband_id: warband.id,
      warrior_type_id: trollSlayers.id,
      category: "Special",
      special_list_name: "Dwarf special skills",
      eligibility_mode: "auto",
    });
  }

  // Only a genuine Troll Slayer may draw from the Troll Slayer-only list.
  await knex("warrior_type_skill_categories")
    .where({ warband_id: warband.id, warrior_type_id: trollSlayers.id, category: "Special", special_list_name: "TROLL SLAYER SKILLS" })
    .update({ eligibility_mode: "exclusive" });

  // The individual "Dwarf special skills" catalog entries were mistakenly transcribed with a
  // per-skill `applies_to_warrior_type_names` restriction to just Engineer/Noble, which would
  // have blocked Troll Slayers from the list even with the category grant above. Since the
  // list is meant for any Dwarf Hero, clear that restriction.
  await knex("skills")
    .where({ warband_id: warband.id, category: "Special", special_list_name: "Dwarf special skills" })
    .update({ applies_to_warrior_type_names: null });
};

exports.down = async function down(knex) {
  const warband = await knex("warbands").where({ name: "Dwarf Treasure Hunters" }).first("id");
  if (warband) {
    await knex("skills")
      .where({ warband_id: warband.id, category: "Special", special_list_name: "Dwarf special skills" })
      .update({ applies_to_warrior_type_names: JSON.stringify(["Dwarf Engineer", "Dwarf Noble"]) });

    const trollSlayers = await knex("warrior_types").where({ name: "Dwarf Troll Slayers", category: "Hero" }).first("id");
    if (trollSlayers) {
      await knex("warrior_type_skill_categories")
        .where({ warband_id: warband.id, warrior_type_id: trollSlayers.id, category: "Special", special_list_name: "Dwarf special skills" })
        .delete();
      await knex("warrior_type_skill_categories")
        .where({ warband_id: warband.id, warrior_type_id: trollSlayers.id, category: "Special", special_list_name: "TROLL SLAYER SKILLS" })
        .update({ eligibility_mode: "choice" });
    }
    await knex("warrior_type_skill_categories")
      .where({ warband_id: warband.id, category: "Special", special_list_name: "Dwarf special skills" })
      .update({ eligibility_mode: "choice" });
  }
  await knex.raw(`ALTER TABLE warrior_type_skill_categories DROP CONSTRAINT IF EXISTS warrior_type_skill_categories_eligibility_mode_check`);
  await knex.schema.alterTable("warrior_type_skill_categories", (table) => {
    table.dropColumn("eligibility_mode");
  });
};
