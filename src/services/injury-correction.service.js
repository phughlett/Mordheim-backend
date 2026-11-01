const { isDeepStrictEqual } = require("node:util");
const { fail } = require("./trading-rules.service");
const { createRosterRepository } = require("../repositories/roster.repository");
const { createRosterService } = require("./roster.service");
const { validateWarriorTypeCount, validateExclusiveHire } = require("./roster-validation.service");

const tables = {
  warrior_inventory: ["id"], warrior_skills: ["id"], warrior_spells: ["id"],
  warrior_mutations: ["id"], warrior_advances: ["id"],
  warrior_starting_gear_grants: ["warrior_id", "equipment_option_id", "model_index"],
  trading_hero_status: ["hero_id", "battle_number"], trading_searches: ["id"],
  consumed_item_uses: ["id"], warrior_advance_revisions: ["warrior_id", "advance_table", "experience_threshold"],
};
const keyOf = (row, keys) => JSON.stringify(keys.map((key) => row[key]));
const jsonRow = (row, columns) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
  [key, columns[key]?.type === "jsonb" && value !== null ? JSON.stringify(value) : value]));
const equal = (a, b) => isDeepStrictEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)));

async function correctionSnapshot(trx, warriorId) {
  const state = { member: await trx("warriors").where({ id: warriorId }).first() ?? null };
  await Promise.all(Object.keys(tables).map(async (table) => {
    state[table] = await trx(table).where({ [table.startsWith("trading_") ? "hero_id" : "warrior_id"]: warriorId }).orderBy(tables[table]);
  }));
  return state;
}

async function validateRestoredMember(trx, roster, member, current) {
  const repository = createRosterRepository(trx);
  const type = member.warrior_type_id ? await repository.findSelectableWarriorType(roster.warband_id, member.warrior_type_id) : null;
  if (member.warrior_type_id && !type) fail("This warrior's type is not allowed in the current warband.");
  if (type) {
    const error = await validateWarriorTypeCount(repository, roster.id, type, member.id, member.group_size);
    if (error) fail(error.body.error, error.status);
    const exclusive = await validateExclusiveHire(repository, roster.id, type.name, member.id);
    if (exclusive) fail(exclusive.body.error, exclusive.status);
  }
  const capacity = await createRosterService(repository).getRosterCapacity(roster);
  if (!current && member.role === "Hero" && capacity.currentHeroes >= capacity.maxHeroes) fail("There is no Hero slot available to correct this injury.");
  const added = member.role === "Hired Sword" ? 0 : member.group_size - Number(current?.group_size ?? 0);
  if (capacity.currentMembers + added > capacity.maxMembers + (current ? 0 : Number(type?.member_limit_bonus ?? 0))) {
    fail("There is no room on the roster to restore the injured warrior or model.");
  }
}

async function reverseCorrection(trx, roster, injury) {
  const undo = injury.correction;
  if (!undo) fail("This older injury lacks the saved state needed for safe correction.");
  if (Number(roster.battles_fought) !== undo.battlesFought) fail("The battle counter has changed; this injury can no longer be removed.");
  const current = await correctionSnapshot(trx, undo.warriorId);
  const { before, after } = undo;
  const dependent = (detail) => fail(`Cannot remove this injury: ${detail}. Undo the dependent change first.`);
  if (!after.member && current.member) dependent("the removed warrior has already been restored");
  if (after.member && !current.member) dependent("the warrior was removed by a later action");
  if (after.member) {
    for (const field of ["warrior_type_id", "role", "promotion_experience"]) {
      if (!equal(current.member[field], after.member[field])) dependent("the warrior's type or promotion was changed");
    }
  }
  if (!after.member || before.member.group_size !== after.member.group_size) {
    await validateRestoredMember(trx, roster, before.member, current.member);
  }
  const patch = {};
  if (after.member) {
    for (const field of ["stats", "injury_conditions"]) {
      if (field === "stats") {
        const stats = { ...current.member.stats };
        for (const key of Object.keys(before.member.stats)) {
          if (equal(before.member.stats[key], after.member.stats[key])) continue;
          if (!equal(current.member.stats[key], after.member.stats[key])) dependent(`${key} was changed after this injury`);
          stats[key] = before.member.stats[key];
        }
        if (!equal(stats, current.member.stats)) patch.stats = stats;
      } else {
        const removed = before.member.injury_conditions.filter((effect) => !after.member.injury_conditions.some((entry) => equal(entry, effect)));
        const added = after.member.injury_conditions.filter((effect) => !before.member.injury_conditions.some((entry) => equal(entry, effect)));
        if (added.some((effect) => !current.member.injury_conditions.some((entry) => equal(entry, effect)))) dependent("an injury condition was changed");
        patch.injury_conditions = [...current.member.injury_conditions.filter((entry) => !added.some((effect) => equal(entry, effect))), ...removed];
      }
    }
    for (const field of ["experience", "injury_experience_floor", "group_size"]) {
      if (equal(before.member[field], after.member[field])) continue;
      if (!equal(current.member[field], after.member[field])) dependent(`${field.replaceAll("_", " ")} was changed after this injury`);
      patch[field] = before.member[field];
    }
  }
  if (before.member.experience !== after.member?.experience && current.member) {
    if (!equal(current.warrior_advances, after.warrior_advances) || !equal(current.warrior_skills, after.warrior_skills)
      || !equal(current.warrior_spells, after.warrior_spells)) dependent("an advancement, skill or spell was acquired after the XP award");
  }
  const treasury = Number(roster.treasury) - undo.treasuryDelta;
  if (!Number.isSafeInteger(treasury) || treasury < 0 || treasury > 2147483647) dependent("the injury's gold award has been spent");

  if (!after.member) {
    const columns = await trx("warriors").columnInfo();
    const position = Number((await trx("warriors").where({ roster_id: roster.id }).max("position as maximum").first()).maximum ?? -1) + 1;
    await trx("warriors").insert(jsonRow({ ...before.member, position }, columns));
  } else {
    const columns = await trx("warriors").columnInfo();
    await trx("warriors").where({ id: undo.warriorId }).update(jsonRow({ ...patch, updated_at: new Date() }, columns));
  }
  for (const [table, keys] of Object.entries(tables)) {
    const oldRows = new Map((before[table] ?? []).map((row) => [keyOf(row, keys), row]));
    const newRows = new Map((after[table] ?? []).map((row) => [keyOf(row, keys), row]));
    const liveRows = new Map(current[table].map((row) => [keyOf(row, keys), row]));
    if (table === "warrior_inventory" && before[table].length > after[table].length && !equal(
      [...liveRows].sort(), [...newRows].sort())) dependent("equipment was changed or replaced after the loss");
    const columns = await trx(table).columnInfo();
    for (const key of new Set([...oldRows.keys(), ...newRows.keys()])) {
      const old = oldRows.get(key), next = newRows.get(key), live = liveRows.get(key);
      if (equal(old, next)) continue;
      if (!equal(live, next)) dependent(`${table.replaceAll("_", " ")} changed after the injury`);
      const row = old ?? next;
      const where = Object.fromEntries(keys.map((key) => [key, row[key]]));
      if (!old) await trx(table).where(where).delete();
      else if (next) await trx(table).where(where).update(jsonRow(old, columns));
      else if (table === "trading_searches") {
        await trx(table).insert(jsonRow(old, columns)).onConflict("id").merge(["hero_id"]);
      } else await trx(table).insert(jsonRow(columns.choice_battles_fought
        ? { ...old, choice_battles_fought: old.choice_battles_fought ?? -1 } : old, columns));
    }
  }
  if (!after.member) {
    await trx("warrior_injuries").where({ roster_id: roster.id }).whereIn("id", undo.priorInjuryIds).update({ warrior_id: undo.warriorId });
    await trx("hero_graveyard").where({ original_warrior_id: undo.warriorId, roster_id: roster.id }).delete();
  }
  if (undo.pending) {
    await trx("warrior_injuries").insert(jsonRow(undo.pending, await trx("warrior_injuries").columnInfo()));
  }
  await trx("warrior_injuries").where({ id: injury.id }).delete();
  await trx("injury_previews").where({ warrior_id: undo.warriorId }).delete();
  await trx("rosters").where({ id: roster.id }).update({ treasury, updated_at: new Date() });
}

module.exports = { correctionSnapshot, reverseCorrection };
