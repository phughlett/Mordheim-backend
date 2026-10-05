const { defaultPurchaseRules } = require("../src/services/advance-purchase-rules.service");

exports.up = async function up(knex) {
  await knex.schema.alterTable("campaigns", (table) => {
    table.jsonb("advance_purchase_rules").notNullable().defaultTo(JSON.stringify(defaultPurchaseRules));
  });
  await knex.schema.alterTable("warrior_advances", (table) => {
    table.integer("purchase_cost");
    table.integer("experience_before_purchase");
    table.check("purchase_cost IS NULL OR purchase_cost >= 0", [], "advance_purchase_cost_nonnegative");
    table.check("(purchase_cost IS NULL) = (experience_before_purchase IS NULL)", [], "advance_purchase_experience_pair");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warrior_advances", (table) => {
    table.dropColumn("purchase_cost");
    table.dropColumn("experience_before_purchase");
  });
  await knex.schema.alterTable("campaigns", (table) => table.dropColumn("advance_purchase_rules"));
};
