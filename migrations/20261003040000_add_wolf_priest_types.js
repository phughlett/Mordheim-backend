const sourceReference = "Wolf Priest of Ulric.docx — May be Hired";

exports.up = async function up(knex) {
  const mercenaries = await knex("warbands").where({ name: "Mercenaries" }).first("id");
  if (!mercenaries) throw new Error("Mercenaries warband is missing from the catalog.");

  const types = [
    {
      catalog_key: "Wolf Priest of Ulric.docx::Hired Sword::Wolf Priest of Ulric",
      name: "Wolf Priest of Ulric",
      category: "Hired Sword",
      stats: { M: "4", WS: "3", BS: "2", S: "3", T: "3", W: "1", I: "3", A: "1", Ld: "8" },
      starting_experience: null,
      large: false,
      source_reference: sourceReference,
    },
    {
      catalog_key: "Wolf Priest of Ulric.docx::Henchman::Wolf Companion",
      name: "Wolf Companion",
      category: "Henchman",
      stats: { M: "6", WS: "4", BS: "0", S: "4", T: "4", W: "1", I: "4", A: "2", Ld: "5" },
      starting_experience: 0,
      large: false,
      source_reference: "Wolf Priest of Ulric.docx — Wolf Companion",
    },
  ];
  const inserted = await knex("warrior_types").insert(types).returning(["id", "name"]);
  const ids = new Map(inserted.map((type) => [type.name, type.id]));

  await knex("warband_warrior_types").insert([
    {
      warband_id: mercenaries.id,
      warrior_type_id: ids.get("Wolf Priest of Ulric"),
      availability: "conditional",
      source_reference: sourceReference,
      rule_text: "May only join a Middenheim Mercenary warband and replaces one Champion.",
      condition_text: "Middenheim Mercenary subtype only; occupies a Champion slot.",
    },
    {
      warband_id: mercenaries.id,
      warrior_type_id: ids.get("Wolf Companion"),
      availability: "conditional",
      source_reference: "Wolf Priest of Ulric.docx — Wolf Companion",
      rule_text: "May only be purchased by a warband that has a Wolf Priest of Ulric.",
      condition_text: "Requires a Wolf Priest of Ulric in the roster.",
    },
  ]);
};

exports.down = async function down(knex) {
  await knex("warband_warrior_types").whereIn("warrior_type_id", knex("warrior_types").select("id").whereIn("catalog_key", [
    "Wolf Priest of Ulric.docx::Hired Sword::Wolf Priest of Ulric",
    "Wolf Priest of Ulric.docx::Henchman::Wolf Companion",
  ])).delete();
  await knex("warrior_types").whereIn("catalog_key", [
    "Wolf Priest of Ulric.docx::Hired Sword::Wolf Priest of Ulric",
    "Wolf Priest of Ulric.docx::Henchman::Wolf Companion",
  ]).delete();
};