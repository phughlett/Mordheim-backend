const { randomInt, randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { tableFor, heroes, canAddInjury, battleNumber, resolveInjury, injuryAvailability,
  retainedInjuryResult, activeInjuryConditions, withInjuryGameplayRules } = require("../services/injury-rules.service");
const { fail, integer } = require("../services/trading-rules.service");
const { heroSnapshot, archiveHero } = require("../services/graveyard.service");
const { getRosterLeader } = require("../services/warband-leader.service");

const snapshot = (member) => ({
  stats: member.stats, experience: member.experience, groupSize: member.group_size,
  injuryExperienceFloor: member.injury_experience_floor,
  conditions: member.injury_conditions, typeId: member.warrior_type_id, role: member.role,
});

function createInjuryRepository(db) {
  async function context(query, memberId, lock = false) {
    const member = await query("warriors").where({ id: memberId }).first();
    if (!member) fail("Warrior not found.", 404);
    const rosterQuery = query("rosters").where({ id: member.roster_id });
    const roster = await (lock ? rosterQuery.forUpdate() : rosterQuery).first();
    const current = lock ? await query("warriors").where({ id: memberId }).forUpdate().first() : member;
    if (!current) fail("Warrior not found.", 404);
    const type = await query("warrior_types").where({ id: current.warrior_type_id }).first("name");
    return { member: { ...current, typeName: type?.name }, roster };
  }

  async function get(memberId) {
    const { member, roster } = await context(db, memberId);
    const history = await db("warrior_injuries").where({ warrior_id: memberId }).orderBy("created_at", "desc");
    return { table: tableFor(member), heroTable: heroes, canAdd: canAddInjury(roster),
      canCheckOldWound: !roster.campaign_id ? Number(roster.battles_fought) >= 1 : roster.campaign_phase === "pre_battle",
      conditions: activeInjuryConditions(member.injury_conditions, roster), availability: injuryAvailability(member, roster),
      battleNumber: battleNumber(roster), history, hatredOpponents: await hatredOpponents(roster) };
  }

  async function hatredOpponents(roster) {
    if (!roster.campaign_id) return null;
    const battle = await db("battle_rosters as participant").join("battles", "battles.id", "participant.battle_id")
      .where({ "participant.roster_id": roster.id, "battles.campaign_id": roster.campaign_id })
      .whereIn("battles.status", ["active", "finished"]).orderBy("battles.created_at", "desc")
      .first("battles.id", "participant.team");
    if (!battle) return [];
    const opponents = await db("battle_rosters as participant").join("rosters", "rosters.id", "participant.roster_id")
      .where("participant.battle_id", battle.id).whereNot("participant.team", battle.team)
      .select("rosters.id", "rosters.name", "rosters.warband").orderBy("rosters.name");
    return Promise.all(opponents.map(async (opponent) => {
      const [leader, heroes] = await Promise.all([
        getRosterLeader(db, opponent.id),
        db("warriors").where({ roster_id: opponent.id, role: "Hero" }).select("id", "name").orderBy("name"),
      ]);
      return { name: opponent.name, warband: opponent.warband,
        leader: leader ? { id: leader.id, name: leader.name } : null, heroes };
    }));
  }

  async function preview(memberId, input) {
    return db.transaction(async (trx) => {
      const { member, roster } = await context(trx, memberId, true);
      if (!canAddInjury(roster)) fail("Add injuries after a Freebuild battle or during the campaign injuries step.");
      if (!["manual", "simulated"].includes(input.mode)) fail("Choose manual or simulated injury mode.", 400);
      const modelIndex = member.role === "Henchman" ? input.modelIndex : 0;
      if (!integer(modelIndex, 0, member.group_size - 1)) fail("Choose an existing model.", 400);
      let result;
      let resolves = null;
      if (input.resolvesId !== undefined) {
        resolves = await trx("warrior_injuries").where({ id: input.resolvesId, warrior_id: memberId, pending: true }).first();
        if (!resolves) fail("Pending injury not found.", 404);
        if (resolves.result.id === "sold-to-the-pits" && !input.selection?.pitOutcome) fail("Choose the pit-fight outcome.", 400);
        if (resolves.result.id === "captured" && !input.selection?.captureOutcome) fail("Choose the captivity outcome.", 400);
        const simulatedPitLoss = input.mode === "simulated" && input.selection?.pitOutcome === "lost";
        result = resolveInjury(heroes, { ...input.selection, resultId: resolves.result.id,
          ...(simulatedPitLoss ? { pitOutcome: undefined } : {}) }, "manual");
        // Pit defeat can be simulated without rerolling the already-recorded result 65.
        if (simulatedPitLoss) {
          result.pending = false;
          result.pitOutcome = "lost";
          result.effects = [{ type: "lose-equipment", scope: "carried-weapons-and-armour" }];
          result.children = [resolveInjury(heroes, {}, "simulated", undefined, 1,
            heroes.results.filter((entry) => entry.rolls[0] > 35).map((entry) => entry.id))];
        }
      } else {
        result = resolveInjury(tableFor(member), input.selection ?? {}, input.mode);
      }
      const [row] = await trx("injury_previews").insert({
        roster_id: roster.id, warrior_id: memberId, resolves_id: resolves?.id ?? null,
        model_index: modelIndex, battle_number: resolves?.battle_number ?? battleNumber(roster),
        mode: input.mode, result, member_snapshot: snapshot(member),
      }).returning("*");
      return { id: row.id, result, modelIndex, battleNumber: row.battle_number };
    });
  }

  async function removeModel(trx, member, modelIndex) {
    if (member.role !== "Henchman" || member.group_size === 1) {
      await trx("warriors").where({ id: member.id }).delete();
      return;
    }
    await trx("warrior_inventory").where({ warrior_id: member.id, model_index: modelIndex }).delete();
    await trx("warrior_starting_gear_grants").where({ warrior_id: member.id, model_index: modelIndex }).delete();
    await trx("warrior_inventory").where({ warrior_id: member.id }).where("model_index", ">", modelIndex).decrement("model_index", 1);
    const grants = await trx("warrior_starting_gear_grants").where({ warrior_id: member.id });
    await trx("warrior_starting_gear_grants").where({ warrior_id: member.id }).delete();
    if (grants.length) await trx("warrior_starting_gear_grants").insert(grants.map((grant) => ({
      ...grant, model_index: grant.model_index > modelIndex ? grant.model_index - 1 : grant.model_index,
    })));
    await trx("warriors").where({ id: member.id }).update({ group_size: member.group_size - 1, updated_at: new Date() });
  }

  async function apply(memberId, previewId, input = {}) {
    return db.transaction(async (trx) => {
      const { member, roster } = await context(trx, memberId, true);
      if (!canAddInjury(roster)) fail("Injuries cannot be applied during this campaign stage.");
      const row = await trx("injury_previews").where({ id: previewId, warrior_id: memberId }).forUpdate().first();
      if (!row) fail("Injury preview not found or already applied.", 404);
      if (Date.now() - new Date(row.created_at).getTime() > 3600000) fail("This injury preview has expired. Preview it again.");
      if (!isDeepStrictEqual(row.member_snapshot, snapshot(member))
        || (!row.resolves_id && row.battle_number !== battleNumber(roster))) fail("The warrior or battle changed. Preview the injury again.");
      if (row.resolves_id) {
        const pending = await trx("warrior_injuries").where({ id: row.resolves_id, pending: true }).first();
        if (!pending) fail("This injury has already been resolved.");
      }
      if (input.hatredTargets !== undefined) {
        if (!Array.isArray(input.hatredTargets)) fail("Hatred targets must be a list.", 400);
        let index = 0;
        const assignTargets = (result) => {
          if (result.id === "bitter-enmity") {
            const target = input.hatredTargets[index++];
            if (typeof target !== "string" || target.length > 300) fail("Each hatred target must be text up to 300 characters.", 400);
            result.hatredTarget = target.trim();
          }
          result.children.forEach(assignTargets);
        };
        assignTargets(row.result);
        if (index !== input.hatredTargets.length) fail("Hatred targets do not match this injury preview.", 400);
      }
      let conditions = [...member.injury_conditions];
      if (row.resolves_id) conditions = conditions.filter((condition) => condition.injuryId !== row.resolves_id);
      const stats = { ...member.stats };
      let experience = Number(member.experience), treasury = Number(roster.treasury), removed = false;
      let injuryExperienceFloor = Number(member.injury_experience_floor);
      const records = [];
      const canRemove = (result) => result.effects.some((effect) =>
        effect.type === "remove-warrior" || effect.type === "conditional") || result.children.some(canRemove);
      const preserved = member.role === "Hero" && canRemove(row.result) ? await heroSnapshot(trx, memberId) : null;
      let removalReason;
      let removalCause;
      const applyResult = async (result) => {
        if (removed) return;
        const injuryId = result === row.result ? row.id : randomUUID();
        const children = [];
        for (const child of result.children) {
          if (removed) break;
          await applyResult(child);
          children.push(child);
        }
        result.children = children;
        if (removed) { result.effects = []; return; }
        const appliedEffects = [];
        const add = (condition) => {
          const applied = withInjuryGameplayRules(condition);
          appliedEffects.push(applied);
          conditions.push({ ...applied, injuryId,
            name: result.secondaryName ? `${result.name} - ${result.secondaryName}` : result.name,
            ruleText: result.secondaryText ?? result.ruleText });
        };
        for (const effect of result.effects) {
          if (removed) break;
          if (effect.type === "stat-modifier") {
            const value = Number(stats[effect.stat]);
            if (!Number.isFinite(value) || value + effect.value < 0) fail(`Cannot apply ${result.name}: invalid ${effect.stat} value.`);
            stats[effect.stat] = String(value + effect.value);
            effect.previousValue = value;
            effect.currentValue = value + effect.value;
            add(effect);
          } else if (effect.type === "conditional" && result.id === "blinded-in-one-eye") {
            const eyes = conditions.filter((condition) => condition.type === "eye-loss");
            if (eyes.length > 0) {
              removed = true;
              removalReason = "retirement";
              removalCause = result;
              appliedEffects.push({ type: "remove-warrior", reason: "retirement" });
            }
            else {
              const bs = Number(stats.BS);
              if (!Number.isFinite(bs) || bs < 1) fail("Cannot apply eye loss: invalid Ballistic Skill.");
              stats.BS = String(bs - 1);
              add({ type: "eye-loss", eye: result.eye });
              const modifier = { type: "stat-modifier", stat: "BS", value: -1, duration: "permanent",
                previousValue: bs, currentValue: bs - 1 };
              add(modifier);
            }
          } else if (effect.type === "remove-warrior" || effect.type === "remove-model") {
            removed = true;
            removalReason = effect.reason ?? "removed";
            removalCause = result;
            appliedEffects.push(effect);
          }
          else if (effect.type === "lose-equipment") {
            const inventory = trx("warrior_inventory").where({ warrior_id: memberId });
            if (effect.scope === "carried-weapons-and-armour") {
              const gear = await trx("warrior_inventory as inventory")
                .leftJoin("equipment_options as option", "option.id", "inventory.equipment_option_id")
                .leftJoin("shop_items as shop", "shop.id", "inventory.shop_item_id")
                .where("inventory.warrior_id", memberId)
                .whereRaw("coalesce(option.category, shop.definition->>'category') in ('weapon', 'armour', 'shield')").pluck("inventory.id");
              inventory.whereIn("id", gear);
            }
            if (await inventory.delete()) appliedEffects.push(effect);
          } else if (effect.type === "experience") {
            effect.previousValue = experience;
            experience += effect.value;
            effect.currentValue = experience;
            injuryExperienceFloor = Math.max(injuryExperienceFloor, experience);
            appliedEffects.push(effect);
          } else if (effect.type === "gold-crowns") {
            treasury += effect.value;
            appliedEffects.push(effect);
          }
          else if (effect.type === "miss-games") add({ ...effect, untilBattle: row.battle_number + effect.count });
          else if (effect.type === "hatred") add({ ...effect, targetDescription: result.hatredTarget });
          else if (["equipment-restriction", "psychology", "movement-restriction", "pre-battle-check"].includes(effect.type)) {
            if (!conditions.some((condition) => condition.type === effect.type && condition.rule === effect.rule)) add(effect);
          }
          else if (effect.type === "captured" && result.pending) add(effect);
        }
        if (result.id === "sold-to-the-pits" && result.pending) add({ type: "pit-fight-pending" });
        result.effects = appliedEffects;
        const recordedResult = retainedInjuryResult({ ...result, children: [] });
        if (recordedResult) records.push({ id: injuryId, result: recordedResult });
      };
      await applyResult(row.result);
      if (!integer(experience, 0, 2147483647) || !integer(treasury, 0, 2147483647)) fail("Injury awards exceed the supported treasury or experience range.");
      if (records.length) await trx("warrior_injuries").insert(records.map((record) => ({
        id: record.id, roster_id: roster.id, warrior_id: memberId, warrior_name: member.name,
        role: member.role, model_index: row.model_index, battle_number: row.battle_number,
        mode: row.mode, result: record.result, pending: record.result.pending === true,
      })));
      if (row.resolves_id) await trx("warrior_injuries").where({ id: row.resolves_id }).delete();
      if (removed) {
        if (member.role === "Hero") await archiveHero(trx, memberId, {
          reason: removalReason, battleNumber: row.battle_number, cause: removalCause, snapshot: preserved,
          treasuryDelta: treasury - Number(roster.treasury),
        });
        await removeModel(trx, member, row.model_index);
      }
      else await trx("warriors").where({ id: memberId }).update({ stats, experience,
        injury_experience_floor: injuryExperienceFloor, injury_conditions: JSON.stringify(conditions), updated_at: new Date() });
      await trx("rosters").where({ id: roster.id }).update({ treasury, updated_at: new Date() });
      await trx("injury_previews").where({ warrior_id: memberId }).delete();
      return { applied: true, removed, injuryId: records[0]?.id ?? null, injuryIds: records.map((record) => record.id) };
    });
  }

  async function cancel(memberId, previewId) {
    const deleted = await db("injury_previews").where({ id: previewId, warrior_id: memberId }).delete();
    if (!deleted) fail("Injury preview not found.", 404);
  }

  async function checkOldWound(memberId, input) {
    return db.transaction(async (trx) => {
      const { member, roster } = await context(trx, memberId, true);
      if (!(roster.campaign_id ? roster.campaign_phase === "pre_battle" : Number(roster.battles_fought) >= 1)) fail("Check old wounds before a battle.");
      const status = injuryAvailability(member, roster);
      if (!status.needsOldWoundRoll) fail("No old battle wound check is needed for this battle.");
      if (!["simulated", "manual"].includes(input.mode)) fail("Choose manual or simulated mode.", 400);
      const roll = input.mode === "simulated" ? randomInt(1, 7) : input.roll;
      if (!integer(roll, 1, 6)) fail("Enter a D6 result from 1 to 6.", 400);
      const conditions = member.injury_conditions.filter((condition) => condition.type !== "old-battle-check");
      conditions.push({ type: "old-battle-check", battle: Number(roster.battles_fought) + 1, roll });
      await trx("warriors").where({ id: memberId }).update({ injury_conditions: JSON.stringify(conditions), updated_at: new Date() });
      return { roll };
    });
  }
  return { get, preview, apply, cancel, checkOldWound };
}

module.exports = { createInjuryRepository };
