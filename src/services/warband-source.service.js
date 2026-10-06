const index = require("../../warband-source/index.json");
const existing = require("../../warband-source/existing-audit.json");
const human = require("../../warband-source/human-additions.json");
const nonhuman = require("../../warband-source/nonhuman-additions.json");
const retained = require("../../warband-source/retained-audit.json");

const additions = [...human.warbands, ...nonhuman.warbands];
const corrections = [...existing.warbands, ...retained.warbands];
const definitions = [...corrections, ...additions];
const statKeys = ["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"];
const categories = ["Combat", "Shooting", "Academic", "Strength", "Speed", "Special"];

function validateDefinitions() {
  const errors = [];
  const names = new Set();
  for (const band of definitions) {
    const entry = index.warbands.find((row) => row.name === band.name);
    if (!entry) errors.push(`Unindexed warband: ${band.name}`);
    if (names.has(band.name)) errors.push(`Duplicate warband: ${band.name}`);
    names.add(band.name);
    if (band.sourceUrl !== `${index.source}/${entry?.path}`) errors.push(`Source mismatch: ${band.name}`);
    if (band.grade !== undefined && band.grade !== entry?.grade) errors.push(`Grade mismatch: ${band.name}`);
    const full = additions.includes(band);
    if (full && (!Number.isInteger(band.maxMembers) || band.maxMembers < 3)) errors.push(`Missing capacity: ${band.name}`);
    if (full && !band.warriors?.some((type) => type.role === "Hero" && type.name === band.leaderType)) {
      errors.push(`Missing leader: ${band.name}`);
    }
    const typeNames = new Set();
    for (const type of band.warriors ?? []) {
      const key = `${band.name}/${type.name}`;
      if (typeNames.has(type.name)) errors.push(`Duplicate warrior: ${key}`);
      typeNames.add(type.name);
      if (!["Hero", "Henchman"].includes(type.role)) errors.push(`Invalid role: ${key}`);
      if (full || type.stats) {
        if (!statKeys.every((stat) => typeof type.stats?.[stat] === "string" && type.stats[stat].length)) {
          errors.push(`Incomplete profile: ${key}`);
        }
      }
      for (const field of ["hireCost", "startingExperience"]) {
        if ((full || type[field] !== undefined) && (!Number.isInteger(type[field]) || type[field] < 0)) {
          errors.push(`Invalid ${field}: ${key}`);
        }
      }
      for (const field of ["large", "canGainExperience"]) {
        if ((full || type[field] !== undefined) && typeof type[field] !== "boolean") {
          errors.push(`Invalid ${field}: ${key}`);
        }
      }
      if ((full || type.promotionEligibility !== undefined)
          && !["eligible", "ineligible", "unverified", "not_applicable"].includes(type.promotionEligibility)) {
        errors.push(`Invalid promotion eligibility: ${key}`);
      }
      if (full && !Array.isArray(type.equipmentListKeys)) errors.push(`Missing equipment permissions: ${key}`);
      if (full && !Array.isArray(type.skillCategories)) errors.push(`Missing skill permissions: ${key}`);
      if (full && !Object.hasOwn(type, "maximumProfile")) errors.push(`Missing racial maximum classification: ${key}`);
      if (type.maximumProfile != null
          && !["Human", "Elf", "Dwarf", "Ogre", "Halfling", "Beastman", "Possessed", "Vampire", "Skaven", "Ghoul"].includes(type.maximumProfile)) {
        errors.push(`Unknown racial maximum classification: ${key}`);
      }
      if (type.maxCount != null && (!Number.isInteger(type.maxCount) || type.maxCount < 1)) errors.push(`Invalid cap: ${key}`);
      if (type.maxCountMultiplier !== undefined
          && (!Number.isInteger(type.maxCountMultiplier) || type.maxCountMultiplier < 1)) {
        errors.push(`Invalid dependent cap multiplier: ${key}`);
      }
      if (type.skillCategories?.some((category) => !categories.includes(category))) errors.push(`Invalid skill category: ${key}`);
      for (const listKey of type.equipmentListKeys ?? []) {
        if (full && !band.equipmentLists?.some((list) => list.key === listKey)) errors.push(`Unknown equipment list: ${key}/${listKey}`);
      }
    }
    const listKeys = new Set();
    for (const list of band.equipmentLists ?? []) {
      if (listKeys.has(list.key)) errors.push(`Duplicate equipment list: ${band.name}/${list.key}`);
      listKeys.add(list.key);
      const items = new Set();
      for (const item of list.items) {
        const key = `${band.name}/${list.key}/${item.name}`;
        if (items.has(item.name)) errors.push(`Duplicate equipment: ${key}`);
        items.add(item.name);
        if (!Number.isInteger(item.unitCost) || item.unitCost < 0) errors.push(`Invalid price: ${key}`);
        if (!["weapon", "armour", "shield", "set", "misc"].includes(item.category)) errors.push(`Invalid equipment category: ${key}`);
        if (full && item.allowedWarriorTypeNames?.some((name) => !typeNames.has(name))) {
          errors.push(`Unknown equipment recipient: ${key}`);
        }
        for (const profile of band.weaponProfiles ?? []) {
          if (!["close_combat", "missile", "blackpowder"].includes(profile.weaponType)
              || typeof profile.rangeText !== "string" || typeof profile.strengthModifier !== "string") {
            errors.push(`Invalid weapon profile: ${band.name}/${profile.name}`);
          }
        }
        for (const profile of band.armourProfiles ?? []) {
          if (!["armour", "shield", "buckler", "helmet"].includes(profile.itemType)) {
            errors.push(`Invalid armour profile: ${band.name}/${profile.name}`);
          }
        }
      }
    }
    if (full) {
      for (const type of band.warriors) {
        for (const name of type.referenceTypes ?? []) {
          if (!typeNames.has(name)) errors.push(`Unknown cap reference: ${band.name}/${name}`);
        }
      }
      for (const access of band.spellAccess ?? []) {
        if (!typeNames.has(access.warriorType)) errors.push(`Unknown spellcaster: ${band.name}/${access.warriorType}`);
        if (access.startingSpellCount !== null
            && (!Number.isInteger(access.startingSpellCount) || access.startingSpellCount < 0)) {
          errors.push(`Invalid starting spell count: ${band.name}/${access.warriorType}`);
        }
      }
    }
  }
  const auditedNames = new Set(existing.audits.map((audit) => audit.warbandName));
  for (const entry of index.warbands.filter((row) => row.grade !== "1c")) {
    if (!names.has(entry.name) && !auditedNames.has(entry.name)) errors.push(`Unaudited source entry: ${entry.name}`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

module.exports = { index, additions, corrections, definitions, audits: [...existing.audits, ...retained.audits], validateDefinitions };
