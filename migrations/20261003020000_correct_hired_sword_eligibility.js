const policies = [
  ["Pit Fighter", "anyExcept", ["Skaven", "Undead"], [], "3Campaigns.pdf p.105 — Hired Swords: Pit Fighter", "Skaven and Undead warbands are excluded."],
  ["Ogre Bodyguard", "anyExcept", ["Skaven"], [], "3Campaigns.pdf p.106 — Hired Swords: Ogre Bodyguard", "Skaven warbands are excluded."],
  ["Halfling Scout (HS)", "anyExcept", ["Skaven", "Undead", "Possessed"], [], "3Campaigns.pdf p.106 — Hired Swords: Halfling Scout", "Skaven, Undead, and Possessed warbands are excluded."],
  ["Warlock (HS)", "anyExcept", ["Witch Hunters", "Sisters of Sigmar"], [], "3Campaigns.pdf p.107 — Hired Swords: Warlock", "Witch Hunters and Sisters of Sigmar are excluded."],
  ["Freelancer", "only", [], ["Mercenaries", "Witch Hunters"], "3Campaigns.pdf p.108 — Hired Swords: Freelancer", "Mercenary and Witch Hunter warbands may hire this warrior."],
  ["Elf Ranger", "only", [], ["Mercenaries", "Witch Hunters"], "3Campaigns.pdf p.108 — Hired Swords: Elf Ranger", "Mercenary and Witch Hunter warbands may hire this warrior."],
  ["Dwarf Troll Slayer (HS)", "only", [], ["Mercenaries", "Witch Hunters"], "3Campaigns.pdf p.109 — Hired Swords: Dwarf Troll Slayer", "Mercenary and Witch Hunter warbands may hire this warrior."],
  ["Beast Hunter", "anyExcept", ["Skaven", "Beastmen", "Undead", "Orcs & Goblins", "Possessed"], [], "MordEMP2.pdf — Hired Swords: Beast Hunter", "Skaven, Beastmen, Undead, Orc and Goblin, Possessed, and Carnival of Chaos warbands are excluded."],
  ["Highwayman", "anyExcept", ["Sisters of Sigmar", "Witch Hunters", "Good Elves"], [], "MordEMP2.pdf — Hired Swords: Highwayman", "Sisters of Sigmar, Witch Hunters, and good-aligned Elf warbands are excluded.", "Cannot join a roster that includes a Roadwarden."],
  ["Roadwarden", "named", [], ["Witch Hunters", "Sisters of Sigmar", "Dwarf Treasure Hunters", "Dwarf Guildsmen", "Mercenaries", "Averlander Mercenaries"], "MordEMP2.pdf — Hired Swords: Roadwarden", "The source names good-aligned warbands, including Witch Hunters, Sisters of Sigmar, Dwarfs, and Human Mercenaries.", "Cannot join a roster that includes a Highwayman."],
  ["Imperial Assassin", "anyExcept", ["Witch Hunters", "Sisters of Sigmar", "Orcs & Goblins", "Skaven"], [], "Showmethemoney.pdf — Imperial Assassin", "Witch Hunters, Sisters of Sigmar, Orc and Goblin, and Skaven warbands are excluded."],
  ["Tilean Marksman", "anyExcept", ["Skaven", "Orcs & Goblins", "Undead"], [], "Showmethemoney.pdf — Tilean Marksman", "Skaven, Orc and Goblin, and Undead warbands are excluded."],
  ["Chameleon Skink", "only", [], ["Lizardmen"], "Lustria3.pdf — Hired Swords: Chameleon Skink", "Only Lizardmen warbands may hire this warrior.", "Lustria campaign source."],
  ["Chameleon Skink Pathfinder", "all", [], [], "Lustria3.pdf — Hired Swords: Chameleon Skink Pathfinder", "The source allows any warband to hire this warrior.", "Lustria campaign source."],
  ["Dark Elf Assassin", "named", [], ["Dark Elves", "Druchii"], "Lustria3.pdf — Hired Swords: Dark Elf Assassin", "The source allows evil warbands; only the explicit Dark Elf warband names are resolved here.", "Lustria campaign source."],
  ["Norse Shaman", "named", [], ["Norse"], "Lustria3.pdf — Hired Swords: Norse Shaman", "Norse warbands may hire this warrior; human-warband matches are campaign-dependent.", "Lustria campaign source."],
  ["Shadow Warrior (Hired Sword)", "named", [], ["High Elves", "Mercenaries", "Averlander Mercenaries", "Witch Hunters", "Sisters of Sigmar", "Kislevite", "Bretonnian", "Ostlanders", "Pirate", "Thieves"], "Lustria4.pdf — Hired Swords: Shadow Warrior", "High Elf and non-evil Human warbands may hire this warrior.", "Lustria campaign source; only resolved warbands are listed."],
  ["Big Game Hunter", "named", [], ["Adventurers", "Albion Barbarian", "Amazons", "Averlander Mercenaries", "Bretonnian", "Kislevite", "Mercenaries", "Mordheim Fanatics", "Norse", "Ostlanders", "Outlaws of Stirwood Forest", "Pirate", "Thieves", "Witch Hunters", "Sisters of Sigmar"], "Lustria4.pdf — Hired Swords: Big Game Hunter", "Human warbands may hire this warrior.", "Lustria campaign source; only resolved Human warbands are listed."],
  ["Drenok", "named", [], ["Norse", "Adventurers", "Albion Barbarian", "Amazons", "Averlander Mercenaries", "Bretonnian", "Kislevite", "Mercenaries", "Mordheim Fanatics", "Ostlanders", "Outlaws of Stirwood Forest", "Pirate", "Thieves", "Witch Hunters", "Sisters of Sigmar"], "Lustria6.pdf — Hired Swords: Drenok", "Norse and Human warbands may hire this warrior.", "Lustria campaign source; only resolved Human warbands are listed."],
];

const groups = {
  Skaven: ["Skaven", "Clan Pestilence", "Skaven Clan Mors", "Skaven Clan Skryre"],
  Undead: ["Undead", "Strigoi Undead", "Blooddragon", "Host of the Dead", "Lahmia", "Nehekhara Tomb Guards", "Tomb Guardians", "Necromancer"],
  Possessed: ["Cult of the Possessed", "Carnival of Chaos"],
  "Orcs & Goblins": ["Orc", "Night Goblins", "Forest Goblins", "Savage Orcs", "Hobgoblins"],
  Beastmen: ["Beastmen Raiders"],
  "Good Elves": ["High Elves", "Wood Elves", "Shadow Warrior"],
};

const warbandOverrides = {
  "Orc": {
    allowed: ["Pit Fighter", "Ogre Bodyguard", "Warlock (HS)"],
    source: "damobrules.pdf — Distasteful Company",
    rule: "Orc warbands may hire only Pit Fighters, Ogre Bodyguards, and Warlocks.",
  },
  "Marauders of Chaos": {
    allowed: ["Pit Fighter", "Ogre Bodyguard", "Warlock (HS)", "Imperial Assassin"],
    source: "10%20Marauders%20of%20Chaos.pdf — Hired Swords",
    rule: "Marauders may hire only Pit Fighters, Ogre Bodyguards, Warlocks, and Imperial Assassins.",
  },
  "Battle Monks of Cathay": {
    allowed: [],
    source: "14%20Battle%20Monks.pdf — Outsiders",
    rule: "Battle Monks may not hire Hired Swords unless a profile explicitly says otherwise.",
  },
};

const dwarfWarbands = ["Dwarf Treasure Hunters", "Dwarf Guildsmen"];
const elfHiredSwords = ["Elf Ranger", "Elf Mage", "Dark Elf Assassin", "Shadow Warrior (Hired Sword)"];

function excludedBy(name, exclusions) {
  return exclusions.some((exclusion) => (groups[exclusion] || [exclusion]).includes(name));
}

exports.up = async function up(knex) {
  const warbands = await knex("warbands").select("id", "name");
  const warriorTypes = await knex("warrior_types").where({ category: "Hired Sword" }).select("id", "name");
  const warbandIds = new Map(warbands.map((warband) => [warband.name, warband.id]));
  const typeIds = new Map(warriorTypes.map((type) => [type.name, type.id]));
  const rows = new Map();

  function set(typeName, warbandName, availability, source, text, condition = null) {
    const warriorTypeId = typeIds.get(typeName);
    const warbandId = warbandIds.get(warbandName);
    if (!warriorTypeId || !warbandId) return;
    rows.set(`${warbandId}:${warriorTypeId}`, {
      warband_id: warbandId,
      warrior_type_id: warriorTypeId,
      availability,
      source_reference: source,
      rule_text: text,
      condition_text: condition,
    });
  }

  for (const type of warriorTypes) {
    for (const warband of warbands) {
      set(type.name, warband.name, "unverified", null, null);
    }
  }

  for (const [typeName, kind, exclusions, allowed, source, text, condition] of policies) {
    for (const warband of warbands) {
      const isAllowed = kind === "all"
        || (kind === "anyExcept" && !excludedBy(warband.name, exclusions))
        || ((kind === "only" || kind === "named") && allowed.includes(warband.name));
      if (kind === "named" && !allowed.includes(warband.name)) continue;
      const isExplicitlyExcluded = kind === "only" && !allowed.includes(warband.name)
        || kind === "anyExcept" && excludedBy(warband.name, exclusions);
      if (isAllowed) {
        const conditional = Boolean(condition);
        set(typeName, warband.name, conditional ? "conditional" : "allowed", source, text, condition || null);
      } else if (isExplicitlyExcluded) {
        set(typeName, warband.name, "prohibited", source, text);
      }
    }
  }

  for (const type of warriorTypes) {
    const mercenary = rows.get(`${warbandIds.get("Mercenaries")}:${type.id}`);
    if (mercenary && mercenary.availability !== "unverified" && warbandIds.has("Kislevite")) {
      set(type.name, "Kislevite", mercenary.availability, "Kislevwarband.pdf — May Hire", "Kislevites use the same Hired Sword selection as Human Mercenary warbands.", mercenary.condition_text);
    }
  }

  for (const [warbandName, rule] of Object.entries(warbandOverrides)) {
    for (const type of warriorTypes) {
      const allowed = rule.allowed.includes(type.name);
      const condition = warbandName === "Marauders of Chaos" && type.name === "Warlock (HS)"
        ? "Not available if the warband includes a member with the Mark of Arkhar."
        : null;
      set(type.name, warbandName, allowed ? (condition ? "conditional" : "allowed") : "prohibited", rule.source, rule.rule, condition);
    }
  }

  for (const warbandName of dwarfWarbands) {
    for (const type of warriorTypes) {
      if (elfHiredSwords.includes(type.name)) {
        set(type.name, warbandName, "prohibited", "DwarfTreasurehunters.pdf — Grudgebearers", "Dwarf warbands may not include Elven Hired Swords.");
      }
    }
  }

  const pitFighterId = warbandIds.get("Pit Fighter");
  for (const type of warriorTypes) {
    const current = rows.get(`${pitFighterId}:${type.id}`);
    if (current?.availability === "unverified" && type.name !== "Elf Ranger") {
      set(type.name, "Pit Fighter", "allowed", "PitFighter.pdf — Hired Swords", "Pit Fighters may hire available Hired Swords other than the Elf Ranger.");
    }
  }

  for (const type of warriorTypes) {
    if (/assassin|chaos|skaven|undead|wraith|beastmen|dark elf/i.test(type.name)) {
      set(type.name, "Shadow Warrior", "prohibited", "ShadowWarriors.pdf — Hired Swords", "Shadow Warriors exclude evil or chaotic Hired Swords and poison specialists.");
    }
  }

  const updates = [...rows.values()];
  for (let index = 0; index < updates.length; index += 150) {
    await knex("warband_warrior_types")
      .insert(updates.slice(index, index + 150))
      .onConflict(["warband_id", "warrior_type_id"])
      .merge(["availability", "source_reference", "rule_text", "condition_text"]);
  }
};

exports.down = async function down() {};