const { createRosterRepository } = require("./roster.repository");
const { createRosterService } = require("../services/roster.service");
const { validateWarriorTypeCount, validateExclusiveHire } = require("../services/roster-validation.service");
const { graveyardUndoBlock } = require("../services/graveyard.service");
const { fail } = require("../services/trading-rules.service");

function createGraveyardRepository(db) {
  async function restore(rosterId, entryId) {
    return db.transaction(async (trx) => {
      const roster = await trx("rosters").where({ id: rosterId }).forUpdate().first();
      if (!roster) fail("Roster not found.", 404);
      const entry = await trx("hero_graveyard").where({ id: entryId, roster_id: rosterId }).forUpdate().first();
      if (!entry) fail("Graveyard entry not found or already restored.", 404);
      const blocked = graveyardUndoBlock(entry, roster);
      if (blocked) fail(blocked);
      const repository = createRosterRepository(trx);
      const service = createRosterService(repository);
      const member = entry.snapshot.member;
      if (await trx("warriors").where({ id: entry.original_warrior_id }).first()) fail("This Hero is already on a roster.");
      const type = member.warrior_type_id ? await repository.findSelectableWarriorType(roster.warband_id, member.warrior_type_id) : null;
      if (member.warrior_type_id && !type) fail("This Hero's type is not allowed in the current warband.");
      if (type) {
        const countError = await validateWarriorTypeCount(repository, rosterId, type, null, 1);
        if (countError) fail(countError.body.error, countError.status);
        const exclusiveError = await validateExclusiveHire(repository, rosterId, type.name);
        if (exclusiveError) fail(exclusiveError.body.error, exclusiveError.status);
      }
      const capacity = await service.getRosterCapacity(roster);
      if (capacity.currentHeroes >= capacity.maxHeroes) fail(`The roster already has its maximum of ${capacity.maxHeroes} Heroes.`);
      if (capacity.currentMembers + 1 > capacity.maxMembers + Number(type?.member_limit_bonus ?? 0)) fail("There is no room for this Hero on the roster.");
      const treasury = Number(roster.treasury) - Number(entry.snapshot.treasuryDelta ?? 0);
      if (treasury < 0) fail("There is not enough gold to undo the award from this injury.");

      async function restoreRows(table, rows, conflictKey = null) {
        if (!rows?.length) return;
        const columns = await trx(table).columnInfo();
        const values = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key in columns)
          .map(([key, value]) => [key, columns[key].type === "jsonb" && value !== null ? JSON.stringify(value) : value])));
        const query = trx(table).insert(values);
        if (conflictKey) await query.onConflict(conflictKey).merge(table === "trading_searches" ? ["hero_id"] : undefined);
        else await query;
      }
      await restoreRows("warriors", [{ ...member, id: entry.original_warrior_id, roster_id: rosterId,
        position: Number((await trx("warriors").where({ roster_id: rosterId }).max("position as maximum").first()).maximum ?? -1) + 1 }]);
      await restoreRows("warrior_inventory", entry.snapshot.equipment);
      await restoreRows("warrior_skills", entry.snapshot.skills.filter((skill) => skill.skill_id));
      await restoreRows("warrior_spells", entry.snapshot.spells);
      await restoreRows("warrior_mutations", entry.snapshot.mutations);
      await restoreRows("warrior_starting_gear_grants", entry.snapshot.startingGear);
      await restoreRows("warrior_advances", entry.snapshot.advances);
      await restoreRows("warrior_injuries", entry.snapshot.injuries, "id");
      await restoreRows("trading_hero_status", entry.snapshot.heroStatus, ["hero_id", "battle_number"]);
      await restoreRows("trading_searches", entry.snapshot.searches, "id");
      if (entry.removal_injury_ids.length) await trx("warrior_injuries").where({ roster_id: rosterId })
        .whereIn("id", entry.removal_injury_ids).delete();
      await trx("hero_graveyard").where({ id: entryId }).delete();
      await trx("rosters").where({ id: rosterId }).update({ treasury, updated_at: new Date() });
      return service.toRosterResponse(await repository.findRoster(rosterId), await service.fetchRosterMembers(rosterId));
    });
  }
  return { restore };
}

module.exports = { createGraveyardRepository };
