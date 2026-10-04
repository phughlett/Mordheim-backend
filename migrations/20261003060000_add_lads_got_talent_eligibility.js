const promotableTypes = new Set(require("../promotion-eligible.json"));

exports.up = async function up(knex) {
  await knex.schema.alterTable("warrior_types", (table) => {
    table.string("promotion_eligibility").notNullable().defaultTo("not_applicable");
    table.text("promotion_rule").nullable();
  });
  await knex.raw("ALTER TABLE warrior_types ADD CONSTRAINT warrior_types_promotion_eligibility_check CHECK (promotion_eligibility IN ('eligible', 'ineligible', 'unverified', 'not_applicable'))");

  await knex("warrior_types").where({ category: "Henchman" }).update({
    promotion_eligibility: "ineligible",
    promotion_rule: "Not listed among the promotion-eligible Henchman types in the workbook Hero dropdown.",
  });

  for (const name of promotableTypes) {
    await knex("warrior_types").where({ name, category: "Henchman" }).update({
      promotion_eligibility: "eligible",
      promotion_rule: "Listed in the workbook Hero dropdown as a Henchman type eligible for Lad's Got Talent.",
    });
  }

  await knex("warrior_types")
    .where({ category: "Henchman" })
    .whereNot("source_reference", "like", "Mordheim_Sheetv2.3.xlsx:Starting_Values%")
    .update({
      promotion_eligibility: "unverified",
      promotion_rule: "This supplemental Henchman type is not covered by the workbook promotion list.",
    });

  await knex("warrior_types").where({ name: "Ungor", category: "Henchman" }).update({
    promotion_eligibility: "ineligible",
    promotion_rule: "An Ungor that rolls Lad's Got Talent must re-roll the result. (MordEMP2.pdf)",
  });
  await knex("warrior_types").where({ name: "Minotaur", category: "Henchman" }).update({
    promotion_eligibility: "ineligible",
    promotion_rule: "A Minotaur may gain experience but may never become a Hero. (MordEMP2.pdf)",
  });
  await knex("warrior_types").where({ name: "Wolf Companion", category: "Henchman" }).update({
    promotion_eligibility: "ineligible",
    promotion_rule: "Wolf Companions are animals and do not gain experience. (Wolf Priest of Ulric.docx)",
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warrior_types", (table) => {
    table.dropColumn("promotion_eligibility");
    table.dropColumn("promotion_rule");
  });
};