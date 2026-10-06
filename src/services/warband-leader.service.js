const standardLeaders = {
  Amazons: "Priestess",
  "Averlander Mercenaries": "Captain (Averlander)",
  "Beastmen Raiders": "Beastmen Chieftain",
  Bretonnian: "Questing Knight",
  "Carnival of Chaos": "Carnival Master",
  "Cult of the Possessed": "Magister",
  "Dark Elves": "High Born",
  "Dwarf Treasure Hunters": "Dwarf Noble",
  Kislevite: "Druzhina Captain",
  Lizardmen: "Skink Priest",
  Mercenaries: "Mercenary Captain",
  "Night Goblins": "Big Boss",
  Norse: "Jarl",
  Orc: "Orc Boss",
  Ostlanders: "Elder",
  Pirate: "Pirate Captain",
  "Pit Fighter": "Pit King",
  "Shadow Warrior": "Shadow Master",
  "Sisters of Sigmar": "Sigmarite Matriarch",
  Skaven: "Assassin Adept",
  Undead: "Vampire",
  "Witch Hunters": "Witch Hunter Captain",
  "Marauders of Chaos": "Marauder Chieftain",
  "Battle Monks of Cathay": "Emissary",
};

function selectLeader(warbandName, warriors) {
  const heroes = warriors.filter((warrior) => warrior.role === "Hero");
  const standard = heroes.filter((warrior) => warrior.warrior_type_name === standardLeaders[warbandName]);
  return [...(standard.length ? standard : heroes)].sort((first, second) =>
    Number(second.stats?.Ld ?? 0) - Number(first.stats?.Ld ?? 0)
    || new Date(first.created_at).getTime() - new Date(second.created_at).getTime()
    || first.id.localeCompare(second.id))[0] ?? null;
}

async function getRosterLeader(query, rosterId) {
  const warriors = await query("warriors as warrior")
    .join("rosters as roster", "roster.id", "warrior.roster_id")
    .leftJoin("warbands as warband", "warband.id", "roster.warband_id")
    .leftJoin("warrior_types as type", "type.id", "warrior.warrior_type_id")
    .where({ "warrior.roster_id": rosterId, "warrior.role": "Hero" })
    .select("warrior.*", "type.name as warrior_type_name", "warband.name as warband_name");
  return selectLeader(warriors[0]?.warband_name, warriors);
}

function leaderAbility() {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    warriorSkillId: "00000000-0000-4000-8000-000000000001",
    name: "Leader",
    category: "Special",
    description: 'Warband members within 6" of this warrior may use this warrior\'s Leadership for Leadership tests.',
    sourceReference: "2Warbands.pdf — Leaders: Special Rules",
    warbandId: null, warriorTypeId: null, specialListName: null, appliesToWarriorTypeNames: null,
    acquiredAt: null, notes: "Granted only while this warrior leads the warband.",
    purchaseCost: null, isStarting: false, isLearnable: false, isLeaderAbility: true,
  };
}

module.exports = { standardLeaders, selectLeader, getRosterLeader, leaderAbility };
