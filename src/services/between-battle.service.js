async function choiceIsEditable(query, warriorId, choice) {
  const roster = await query("rosters as roster").join("warriors as warrior", "warrior.roster_id", "roster.id")
    .where("warrior.id", warriorId).first("roster.battles_fought");
  return Boolean(roster && choice?.choice_battles_fought === Number(roster.battles_fought));
}

async function skillDependencyError(query, warriorId, skillId) {
  const skill = await query("skills").where({ id: skillId }).first("name");
  const warrior = await query("warriors").where({ id: warriorId }).first("lesser_magic_unlocked");
  return skill?.name === "Arcane Lore" && warrior?.lesser_magic_unlocked
    ? "Cancel the consumed Tome and its magic gains before changing Arcane Lore." : null;
}

module.exports = { choiceIsEditable, lockChoiceRoster, skillDependencyError };
async function lockChoiceRoster(query, warriorId) {
  const warrior = await query("warriors").where({ id: warriorId }).first("roster_id");
  if (warrior) await query("rosters").where({ id: warrior.roster_id }).forUpdate().first("id");
}
