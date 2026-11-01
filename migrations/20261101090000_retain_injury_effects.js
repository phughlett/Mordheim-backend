const { retainedInjuryResult, withInjuryGameplayRules } = require("../src/services/injury-rules.service");

exports.up = async (knex) => {
  await knex("warrior_injuries").whereNotNull("resolved_at").delete();
  const injuries = await knex("warrior_injuries").select("id", "result");
  for (const injury of injuries) {
    const result = retainedInjuryResult(injury.result);
    if (result) await knex("warrior_injuries").where({ id: injury.id }).update({ result });
    else await knex("warrior_injuries").where({ id: injury.id }).delete();
  }
  const warriors = await knex("warriors").select("id", "injury_conditions");
  for (const warrior of warriors) {
    if (!warrior.injury_conditions.length) continue;
    await knex("warriors").where({ id: warrior.id }).update({
      injury_conditions: JSON.stringify(warrior.injury_conditions.map(withInjuryGameplayRules)),
    });
  }
};

exports.down = async () => {
  // Discarded no-effect outcomes cannot be reconstructed.
};
