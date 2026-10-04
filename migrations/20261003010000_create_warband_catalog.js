const catalog = require("../catalog.json");

const supplementalHiredSwords = [
  ["Imperial Assassin", "Showmethemoney.pdf — Imperial Assassin"],
  ["Tilean Marksman", "Showmethemoney.pdf — Tilean Marksman"],
  ["Chameleon Skink", "Lustria3.pdf — Hired Swords"],
  ["Chameleon Skink Pathfinder", "Lustria3.pdf — Hired Swords"],
  ["Dark Elf Assassin", "Lustria3.pdf — Hired Swords"],
  ["Norse Shaman", "Lustria3.pdf — Hired Swords"],
  ["Shadow Warrior (Hired Sword)", "Lustria4.pdf — Hired Swords"],
  ["Big Game Hunter", "Lustria4.pdf — Hired Swords"],
  ["Drenok", "Lustria6.pdf — Hired Swords"],
].map(([name, sourceReference]) => ({
  name,
  category: "Hired Sword",
  stats: {},
  startingExperience: null,
  large: false,
  sourceReference,
}));

const sourceRules = [
  {
    type: "Pit Fighter",
    kind: "anyExcept",
    exclude: ["Skaven", "Undead"],
    source: "3Campaigns.pdf p.105 — Hired Swords: Pit Fighter",
    rule: "Any warband except Skaven and Undead may hire this warrior.",
  },
  {
    type: "Ogre Bodyguard",
    kind: "anyExcept",
    exclude: ["Skaven"],
    source: "3Campaigns.pdf p.106 — Hired Swords: Ogre Bodyguard",
    rule: "Any warband except Skaven may hire this warrior.",
  },
  {
    type: "Halfling Scout (HS)",
    kind: "anyExcept",
    exclude: ["Skaven", "Undead", "Possessed"],
    source: "3Campaigns.pdf p.106 — Hired Swords: Halfling Scout",
    rule: "Skaven, Undead, and Possessed warbands are excluded.",
  },
  {
    type: "Warlock (HS)",
    kind: "anyExcept",
    exclude: ["Witch Hunters", "Sisters of Sigmar"],
    source: "3Campaigns.pdf p.107 — Hired Swords: Warlock",
    rule: "Witch Hunters and Sisters of Sigmar are excluded.",
  },
  {
    type: "Freelancer",
    kind: "only",
    allow: ["Mercenaries", "Witch Hunters"],
    source: "3Campaigns.pdf p.108 — Hired Swords: Freelancer",
    rule: "Only Mercenary and Witch Hunter warbands may hire this warrior.",
  },
  {
    type: "Elf Ranger",
    kind: "only",
    allow: ["Mercenaries", "Witch Hunters"],
    source: "3Campaigns.pdf p.108 — Hired Swords: Elf Ranger",
    rule: "Mercenary and Witch Hunter warbands may hire this warrior; the source also mentions warbands containing Dwarfs with increased upkeep.",
  },
  {
    type: "Dwarf Troll Slayer (HS)",
    kind: "only",
    allow: ["Mercenaries", "Witch Hunters"],
    source: "3Campaigns.pdf p.109 — Hired Swords: Dwarf Troll Slayer",
    rule: "Mercenary and Witch Hunter warbands may hire this warrior; Elf warbands may hire him for increased upkeep.",
    conditional: ["High Elves", "Dark Elves", "Druchii", "Shadow Warrior", "Wood Elves"],
    condition: "Elf warband: pay 20 gc after each battle instead of 10 gc.",
  },
  {
    type: "Beast Hunter",
    kind: "anyExcept",
    exclude: ["Skaven", "Beastmen", "Undead", "Orcs & Goblins", "Possessed"],
    source: "MordEMP2.pdf — Hired Swords: Beast Hunter",
    rule: "Skaven, Beastmen, Undead, Orc and Goblin, Possessed, and Carnival of Chaos warbands are excluded.",
  },
  {
    type: "Highwayman",
    kind: "anyExcept",
    exclude: ["Sisters of Sigmar", "Witch Hunters", "Good Elves"],
    source: "MordEMP2.pdf — Hired Swords: Highwayman",
    rule: "Sisters of Sigmar, Witch Hunters, and good-aligned Elf warbands are excluded; cannot serve alongside a Roadwarden.",
    condition: "Cannot join a roster that includes a Roadwarden.",
  },
  {
    type: "Roadwarden",
    kind: "named",
    allow: ["Witch Hunters", "Sisters of Sigmar", "Dwarf Treasure Hunters", "Dwarf Guildsmen", "Mercenaries", "Averlander Mercenaries"],
    source: "MordEMP2.pdf — Hired Swords: Roadwarden",
    rule: "The source names good-aligned warbands, including Witch Hunters, Sisters of Sigmar, Dwarfs, and Human Mercenaries; cannot serve alongside a Highwayman.",
    condition: "Cannot join a roster that includes a Highwayman.",
  },
  {
    type: "Imperial Assassin",
    kind: "anyExcept",
    exclude: ["Witch Hunters", "Sisters of Sigmar", "Orcs & Goblins", "Skaven"],
    source: "Showmethemoney.pdf — Imperial Assassin",
    rule: "Witch Hunters, Sisters of Sigmar, Orc and Goblin, and Skaven warbands are excluded.",
  },
  {
    type: "Tilean Marksman",
    kind: "anyExcept",
    exclude: ["Skaven", "Orcs & Goblins", "Undead"],
    source: "Showmethemoney.pdf — Tilean Marksman",
    rule: "Skaven, Orc and Goblin, and Undead warbands are excluded.",
  },
  {
    type: "Chameleon Skink",
    kind: "only",
    allow: ["Lizardmen"],
    source: "Lustria3.pdf — Hired Swords: Chameleon Skink",
    rule: "Only Lizardmen warbands may hire this warrior.",
    condition: "Lustria campaign source.",
  },
  {
    type: "Chameleon Skink Pathfinder",
    kind: "all",
    source: "Lustria3.pdf — Hired Swords: Chameleon Skink Pathfinder",
    rule: "The source allows any warband to hire this warrior.",
    condition: "Lustria campaign source.",
  },
  {
    type: "Dark Elf Assassin",
    kind: "named",
    allow: ["Dark Elves", "Druchii"],
    source: "Lustria3.pdf — Hired Swords: Dark Elf Assassin",
    rule: "The source allows evil warbands; only the explicit Dark Elf warband names are resolved here.",
    condition: "Lustria campaign source.",
  },
  {
    type: "Norse Shaman",
    kind: "named",
    allow: ["Norse"],
    source: "Lustria3.pdf — Hired Swords: Norse Shaman",
    rule: "Norse warbands may hire this warrior; the source also allows human warbands in Lustria.",
    condition: "Lustria campaign; other human-warband matches require review.",
  },
  {
    type: "Shadow Warrior (Hired Sword)",
    kind: "named",
    allow: ["High Elves", "Mercenaries", "Averlander Mercenaries", "Witch Hunters", "Sisters of Sigmar", "Kislevite", "Bretonnian", "Ostlanders", "Pirate", "Thieves"],
    source: "Lustria4.pdf — Hired Swords: Shadow Warrior",
    rule: "High Elf and Human warbands may hire this warrior unless the warband is evil.",
    condition: "Lustria campaign; only explicitly resolved non-evil Human warbands are listed.",
  },
  {
    type: "Big Game Hunter",
    kind: "named",
    allow: ["Adventurers", "Albion Barbarian", "Amazons", "Averlander Mercenaries", "Bretonnian", "Kislevite", "Mercenaries", "Mordheim Fanatics", "Norse", "Ostlanders", "Outlaws of Stirwood Forest", "Pirate", "Thieves", "Witch Hunters", "Sisters of Sigmar"],
    source: "Lustria4.pdf — Hired Swords: Big Game Hunter",
    rule: "Human warbands may hire this warrior.",
    condition: "Lustria campaign; only resolved Human warbands are listed.",
  },
  {
    type: "Drenok",
    kind: "named",
    allow: ["Norse", "Adventurers", "Albion Barbarian", "Amazons", "Averlander Mercenaries", "Bretonnian", "Kislevite", "Mercenaries", "Mordheim Fanatics", "Ostlanders", "Outlaws of Stirwood Forest", "Pirate", "Thieves", "Witch Hunters", "Sisters of Sigmar"],
    source: "Lustria6.pdf — Hired Swords: Drenok",
    rule: "Norse and Human warbands may hire this warrior.",
    condition: "Lustria campaign; only resolved Human warbands are listed.",
  },
];

const factionGroups = {
  Skaven: ["Skaven", "Clan Pestilence", "Skaven Clan Mors", "Skaven Clan Skryre"],
  Undead: ["Undead", "Strigoi Undead", "Blooddragon", "Host of the Dead", "Lahmia", "Nehekhara Tomb Guards", "Tomb Guardians", "Necromancer"],
  Possessed: ["Cult of the Possessed", "Carnival of Chaos"],
  "Orcs & Goblins": ["Orc", "Night Goblins", "Forest Goblins", "Savage Orcs", "Hobgoblins"],
  Beastmen: ["Beastmen Raiders"],
  "Good Elves": ["High Elves", "Wood Elves", "Shadow Warrior"],
};

const supplementalProhibitions = {
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
const elfTypeNames = ["Elf Ranger", "Elf Mage", "Shadow Warrior (Hired Sword)"];
const knownHumanWarbands = ["Adventurers", "Albion Barbarian", "Amazons", "Averlander Mercenaries", "Bretonnian", "Kislevite", "Mercenaries", "Mordheim Fanatics", "Norse", "Ostlanders", "Outlaws of Stirwood Forest", "Pirate", "Thieves", "Witch Hunters", "Sisters of Sigmar"];

function typeKey(type) {
  return `${type.sourceReference}::${type.category}::${type.name}`;
}

function isExcludedBand(name, exclusions) {
  return exclusions.some((exclusion) => (factionGroups[exclusion] || [exclusion]).includes(name));
}

async function insertChunks(knex, table, rows, size = 150) {
  for (let index = 0; index < rows.length; index += size) {
    await knex(table).insert(rows.slice(index, index + size));
  }
}

async function seedCatalog(knex) {
  const types = [...catalog.warriorTypes, ...supplementalHiredSwords];
  const insertedWarbands = await knex("warbands").insert(catalog.warbands.map((warband) => ({
    name: warband.name,
    source_reference: warband.sourceReference,
  }))).returning(["id", "name"]);
  const warbandId = new Map(insertedWarbands.map((warband) => [warband.name, warband.id]));
  const typeRows = types.map((type) => ({
    catalog_key: typeKey(type),
    name: type.name,
    category: type.category,
    stats: type.stats || {},
    starting_experience: type.startingExperience,
    large: Boolean(type.large),
    source_reference: type.sourceReference,
  }));
  const typeId = new Map();
  for (let index = 0; index < typeRows.length; index += 100) {
    const inserted = await knex("warrior_types").insert(typeRows.slice(index, index + 100)).returning(["id", "catalog_key"]);
    for (const row of inserted) typeId.set(row.catalog_key, row.id);
  }

  const relationMap = new Map();
  function setRelation(typeName, bandName, availability, sourceReference, ruleText, conditionText = null) {
    const bandId = warbandId.get(bandName);
    const matchingTypes = types.filter((type) => type.category === "Hired Sword" && type.name === typeName);
    if (!bandId || matchingTypes.length === 0) return;
    for (const type of matchingTypes) {
      const id = typeId.get(typeKey(type));
      relationMap.set(`${bandId}:${id}`, {
        warband_id: bandId,
        warrior_type_id: id,
        availability,
        source_reference: sourceReference,
        rule_text: ruleText,
        condition_text: conditionText,
      });
    }
  }

  for (const association of catalog.associations) {
    const id = typeId.get(`${association.sourceReference}::${association.category}::${association.warriorName}`);
    const bandId = warbandId.get(association.warbandName);
    if (id && bandId) {
      relationMap.set(`${bandId}:${id}`, {
        warband_id: bandId,
        warrior_type_id: id,
        availability: "allowed",
        source_reference: association.sourceReference,
        rule_text: "The roster catalog associates this warrior type with this warband.",
        condition_text: null,
      });
    }
  }

  const hiredSwords = types.filter((type) => type.category === "Hired Sword");
  for (const type of hiredSwords) {
    const id = typeId.get(typeKey(type));
    for (const warband of catalog.warbands) {
      const bandId = warbandId.get(warband.name);
      relationMap.set(`${bandId}:${id}`, {
        warband_id: bandId,
        warrior_type_id: id,
        availability: "unverified",
        source_reference: null,
        rule_text: null,
        condition_text: null,
      });
    }
  }

  for (const policy of sourceRules) {
    const names = policy.kind === "all" ? catalog.warbands.map((warband) => warband.name) : policy.allow || [];
    if (policy.kind === "allExcept") {
      for (const warband of catalog.warbands) {
        setRelation(policy.type, warband.name, isExcludedBand(warband.name, policy.exclude) ? "prohibited" : policy.condition ? "conditional" : "allowed", policy.source, policy.rule, policy.condition || null);
      }
    } else {
      for (const warband of catalog.warbands) {
        if (policy.kind === "only" && !names.includes(warband.name)) {
          setRelation(policy.type, warband.name, "prohibited", policy.source, policy.rule);
        } else if (names.includes(warband.name)) {
          setRelation(policy.type, warband.name, policy.condition ? "conditional" : "allowed", policy.source, policy.rule, policy.condition || null);
        }
      }
    }
    for (const warbandName of policy.conditional || []) {
      setRelation(policy.type, warbandName, "conditional", policy.source, policy.rule, policy.condition);
    }
  }

  for (const type of hiredSwords) {
    const mercenaries = relationMap.get(`${warbandId.get("Mercenaries")}:${typeId.get(typeKey(type))}`);
    if (mercenaries && mercenaries.availability !== "unverified" && warbandId.has("Kislevite")) {
      setRelation(type.name, "Kislevite", mercenaries.availability, "Kislevwarband.pdf — May Hire", "Kislevites use the same Hired Sword selection as Human Mercenary warbands.", mercenaries.condition_text);
    }
  }

  for (const [bandName, rule] of Object.entries(supplementalProhibitions)) {
    for (const type of hiredSwords) {
      const allowed = rule.allowed.includes(type.name);
      const condition = bandName === "Marauders of Chaos" && type.name === "Warlock (HS)"
        ? "Not available if the warband includes a member with the Mark of Arkhar."
        : null;
      setRelation(type.name, bandName, allowed ? (condition ? "conditional" : "allowed") : "prohibited", rule.source, rule.rule, condition);
    }
  }

  for (const bandName of dwarfWarbands) {
    for (const type of hiredSwords) {
      if (elfTypeNames.includes(type.name)) {
        setRelation(type.name, bandName, "prohibited", "DwarfTreasurehunters.pdf — Grudgebearers", "Dwarf warbands may not include Elven Hired Swords.");
      }
    }
  }

  const pitFighterId = warbandId.get("Pit Fighter");
  for (const type of hiredSwords) {
    const key = `${pitFighterId}:${typeId.get(typeKey(type))}`;
    const current = relationMap.get(key);
    if (current?.availability === "unverified" && type.name !== "Elf Ranger") {
      setRelation(type.name, "Pit Fighter", "allowed", "PitFighter.pdf — Hired Swords", "Pit Fighters may hire available Hired Swords other than the Elf Ranger.");
    }
  }

  for (const type of hiredSwords) {
    const key = `${warbandId.get("Shadow Warrior")}:${typeId.get(typeKey(type))}`;
    const current = relationMap.get(key);
    if (current && current.availability === "allowed" && /assassin|chaos|skaven|undead|wraith|beastmen|dark elf/i.test(type.name)) {
      setRelation(type.name, "Shadow Warrior", "prohibited", "ShadowWarriors.pdf — Hired Swords", "Shadow Warriors exclude evil or chaotic Hired Swords and poison specialists.");
    }
  }

  await insertChunks(knex, "warband_warrior_types", [...relationMap.values()]);
  await knex.raw("UPDATE rosters SET warband_id = warbands.id FROM warbands WHERE lower(trim(rosters.warband)) = lower(warbands.name)");
  await knex.raw("UPDATE warriors AS warrior SET warrior_type_id = warrior_types.id FROM warrior_types, warband_warrior_types, rosters WHERE rosters.id = warrior.roster_id AND rosters.warband_id = warband_warrior_types.warband_id AND warband_warrior_types.warrior_type_id = warrior_types.id AND warrior_types.name = warrior.type AND warrior_types.category = warrior.role AND warband_warrior_types.availability IN ('allowed', 'conditional')");
};

exports.up = async function up(knex) {
  await knex.schema.createTable("warbands", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name").notNullable().unique();
    table.text("source_reference").notNullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable("warrior_types", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("catalog_key").notNullable().unique();
    table.string("name").notNullable();
    table.string("category").notNullable();
    table.jsonb("stats").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.integer("starting_experience").nullable();
    table.boolean("large").notNullable().defaultTo(false);
    table.text("source_reference").notNullable();
    table.timestamps(true, true);
    table.index(["name", "category"]);
    table.check("category IN ('Hero', 'Henchman', 'Hired Sword')");
  });

  await knex.schema.createTable("warband_warrior_types", (table) => {
    table.uuid("warband_id").notNullable().references("id").inTable("warbands").onDelete("CASCADE");
    table.uuid("warrior_type_id").notNullable().references("id").inTable("warrior_types").onDelete("CASCADE");
    table.string("availability").notNullable();
    table.text("source_reference").nullable();
    table.text("rule_text").nullable();
    table.text("condition_text").nullable();
    table.primary(["warband_id", "warrior_type_id"]);
    table.index(["warband_id", "availability"]);
    table.check("availability IN ('allowed', 'conditional', 'prohibited', 'unverified')");
  });

  await knex.schema.alterTable("rosters", (table) => {
    table.uuid("warband_id").nullable().references("id").inTable("warbands").onDelete("SET NULL");
  });
  await knex.schema.alterTable("warriors", (table) => {
    table.uuid("warrior_type_id").nullable().references("id").inTable("warrior_types").onDelete("SET NULL");
  });
  await knex.raw("ALTER TABLE warriors DROP CONSTRAINT IF EXISTS warriors_role_check");
  await knex.raw("ALTER TABLE warriors ADD CONSTRAINT warriors_role_check CHECK (role IN ('Hero', 'Henchman', 'Hired Sword'))");

  await seedCatalog(knex);
};

exports.down = async function down(knex) {
  await knex.raw("ALTER TABLE warriors DROP CONSTRAINT IF EXISTS warriors_role_check");
  await knex.raw("ALTER TABLE warriors ADD CONSTRAINT warriors_role_check CHECK (role IN ('Hero', 'Henchman'))");
  await knex.schema.alterTable("warriors", (table) => table.dropColumn("warrior_type_id"));
  await knex.schema.alterTable("rosters", (table) => table.dropColumn("warband_id"));
  await knex.schema.dropTableIfExists("warband_warrior_types");
  await knex.schema.dropTableIfExists("warrior_types");
  await knex.schema.dropTableIfExists("warbands");
};