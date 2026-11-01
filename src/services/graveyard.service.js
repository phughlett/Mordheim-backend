const { fail } = require("./trading-rules.service");
const { getRosterLeader, leaderAbility } = require("./warband-leader.service");
const { getAllowedActions } = require("./campaign.service");

async function heroSnapshot(trx, warriorId) {
  const member = await trx("warriors as warrior")
    .leftJoin("warrior_types as type", "type.id", "warrior.warrior_type_id")
    .where("warrior.id", warriorId)
    .select("warrior.*", "type.name as typeName", "type.special_rules as specialRules").first();
  if (!member) fail("Hero not found.", 404);
  if (member.role !== "Hero") return null;
  const [equipment, skills, spells, advances, injuries, startingGear, leader, mutations, heroStatus, searches] = await Promise.all([
    trx("warrior_inventory as inventory")
      .leftJoin("equipment_options as option", "option.id", "inventory.equipment_option_id")
      .leftJoin("shop_items as shop", "shop.id", "inventory.shop_item_id")
      .where("inventory.warrior_id", warriorId)
      .select("inventory.*", trx.raw("coalesce(option.name, shop.definition->>'name') as name"),
        trx.raw("to_jsonb(option) as equipment_definition"), "shop.definition as shop_definition"),
    trx("warrior_skills as learned").join("skills as skill", "skill.id", "learned.skill_id")
      .where("learned.warrior_id", warriorId)
      .select("learned.*", "skill.name", "skill.description", "skill.category", "skill.source_reference"),
    trx("warrior_spells as learned").leftJoin("spells as spell", "spell.id", "learned.spell_id")
      .leftJoin("spell_disciplines as discipline", "discipline.id", "spell.spell_discipline_id")
      .where("learned.warrior_id", warriorId)
      .select("learned.*", trx.raw("coalesce(spell.name, learned.custom_name) as name"),
        trx.raw("coalesce(spell.effect_summary, learned.custom_effect_summary) as effect_summary"),
        trx.raw("coalesce(spell.casting_difficulty, learned.custom_casting_difficulty) + learned.casting_difficulty_modifier as casting_difficulty"),
        trx.raw("coalesce(spell.difficulty_note, learned.custom_difficulty_note) as difficulty_note"),
        "discipline.name as discipline", "discipline.source_reference"),
    trx("warrior_advances").where({ warrior_id: warriorId }).orderBy("created_at"),
    trx("warrior_injuries").where({ warrior_id: warriorId }).orderBy("created_at"),
    trx("warrior_starting_gear_grants").where({ warrior_id: warriorId }),
    getRosterLeader(trx, member.roster_id),
    trx("warrior_mutations").where({ warrior_id: warriorId }),
    trx("trading_hero_status").where({ hero_id: warriorId }),
    trx("trading_searches").where({ hero_id: warriorId }),
  ]);
  if (leader?.id === warriorId) {
    const ability = leaderAbility(leader.warband_name, leader.warrior_type_name);
    skills.unshift({ id: ability.id, name: ability.name, category: ability.category,
      description: ability.description, source_reference: ability.sourceReference, notes: ability.notes });
  }
  return { member, equipment, skills, spells, advances, injuries, startingGear, mutations, heroStatus, searches };
}

async function archiveHero(trx, warriorId, { reason, battleNumber, cause = null, snapshot, treasuryDelta = 0 }) {
  const preserved = snapshot ?? await heroSnapshot(trx, warriorId);
  if (!preserved) return;
  const roster = await trx("rosters").where({ id: preserved.member.roster_id }).first();
  if (Number(roster.battles_fought) === 0) return;
  await trx("hero_graveyard").insert({
    roster_id: preserved.member.roster_id, original_warrior_id: warriorId,
    name: preserved.member.name, reason, battle_number: battleNumber,
    cause, snapshot: { ...preserved, treasuryDelta }, snapshot_complete: true, removed_battles_fought: Number(roster.battles_fought),
    removal_injury_ids: JSON.stringify((await trx("warrior_injuries").where({ warrior_id: warriorId }).pluck("id"))
      .filter((id) => !preserved.injuries.some((injury) => injury.id === id))),
  });
}

function graveyardUndoBlock(entry, roster) {
  if (entry.reason === "death") return "Dead Heroes cannot be restored.";
  if (!entry.snapshot_complete || !entry.original_warrior_id || entry.removed_battles_fought === null) return "This legacy record cannot be restored safely.";
  if (Number(roster.battles_fought) === 0) return "The Graveyard is not used during roster creation.";
  if (Number(roster.battles_fought) !== entry.removed_battles_fought) return "The battle counter has changed since this Hero was removed.";
  if (!getAllowedActions(roster).includes("hire")) return "Heroes can only be restored during a hiring stage.";
  return null;
}

module.exports = { heroSnapshot, archiveHero, graveyardUndoBlock };
