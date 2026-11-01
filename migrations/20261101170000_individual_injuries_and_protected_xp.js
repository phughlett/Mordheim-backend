const { randomUUID } = require("node:crypto");
const { individualInjuryResults } = require("../src/services/injury-rules.service");

exports.up = async (knex) => {
  await knex.schema.alterTable("warriors", (table) => {
    table.integer("injury_experience_floor").notNullable().defaultTo(0);
  });
  const injuries = await knex("warrior_injuries").orderBy("created_at", "asc");
  const warriors = await knex("warriors as warrior")
    .leftJoin("warrior_types as type", "type.id", "warrior.warrior_type_id")
    .select("warrior.id", "warrior.experience", "warrior.injury_conditions", "type.starting_experience");
  for (const injury of injuries) {
    const results = individualInjuryResults(injury.result);
    const warrior = warriors.find((warrior) => warrior.id === injury.warrior_id);
    const unmatched = new Set(warrior?.injury_conditions.filter((condition) => condition.injuryId === injury.id) ?? []);
    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      const id = index === 0 ? injury.id : randomUUID();
      if (index === 0) await knex("warrior_injuries").where({ id }).update({ result, pending: result.pending === true });
      else await knex("warrior_injuries").insert({ ...injury, id, result, pending: result.pending === true });
      for (const effect of result.effects) {
        const condition = [...unmatched].find((condition) =>
          (condition.name === result.name || condition.name === `${result.name} - ${result.secondaryName}`)
          && condition.type === effect.type && condition.stat === effect.stat && condition.rule === effect.rule);
        if (condition) { condition.injuryId = id; unmatched.delete(condition); }
      }
    }
    if (results.length === 0) await knex("warrior_injuries").where({ id: injury.id }).delete();
  }
  for (const warrior of warriors) {
    const effects = injuries.filter((injury) => injury.warrior_id === warrior.id)
      .flatMap((injury) => individualInjuryResults(injury.result)).flatMap((result) => result.effects)
      .filter((effect) => effect.type === "experience" && effect.value > 0);
    const awardedExperience = effects.reduce((total, effect) => total + effect.value, 0);
    // Legacy awards lack a before/after total; preserve the current total and at least the awarded XP.
    const floor = effects.length ? Math.max(Number(warrior.experience),
      Number(warrior.starting_experience ?? 0) + awardedExperience,
      ...effects.map((effect) => effect.currentValue ?? 0)) : 0;
    await knex("warriors").where({ id: warrior.id }).update({
      experience: Math.max(Number(warrior.experience), floor), injury_experience_floor: floor,
      injury_conditions: JSON.stringify(warrior.injury_conditions),
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.alterTable("warriors", (table) => table.dropColumn("injury_experience_floor"));
};
