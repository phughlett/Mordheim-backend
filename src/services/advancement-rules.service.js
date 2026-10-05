const statKeys = ["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"];
const heroThresholds = [2, 4, 6, 8, 11, 14, 17, 20, 24, 28, 32, 36, 41, 46, 51, 57, 63, 69, 76, 83, 90];
const henchmanThresholds = [2, 5, 9, 14];
const heroStatGroups = [["S", "A"], ["WS", "BS"], ["I", "Ld"], ["W", "T"]];
const henchmanStatChoices = ["I", "S", "BS", "WS", "A", "Ld"];
const racialMaximums = {
  Human: { M: 4, WS: 6, BS: 6, S: 4, T: 4, W: 3, I: 6, A: 4, Ld: 9 },
  Elf: { M: 5, WS: 7, BS: 7, S: 4, T: 4, W: 3, I: 9, A: 4, Ld: 10 },
  Dwarf: { M: 3, WS: 7, BS: 6, S: 4, T: 5, W: 3, I: 5, A: 4, Ld: 10 },
  Ogre: { M: 6, WS: 6, BS: 5, S: 5, T: 5, W: 5, I: 6, A: 5, Ld: 9 },
  Halfling: { M: 4, WS: 5, BS: 7, S: 3, T: 3, W: 3, I: 9, A: 4, Ld: 10 },
  Beastman: { M: 4, WS: 7, BS: 6, S: 4, T: 5, W: 4, I: 6, A: 4, Ld: 9 },
  Possessed: { M: 6, WS: 8, BS: 0, S: 6, T: 6, W: 4, I: 7, A: 5, Ld: 10 },
  Vampire: { M: 6, WS: 8, BS: 6, S: 7, T: 6, W: 4, I: 9, A: 4, Ld: 10 },
  Skaven: { M: 6, WS: 6, BS: 6, S: 4, T: 4, W: 3, I: 7, A: 4, Ld: 7 },
  Ghoul: { M: 5, WS: 5, BS: 2, S: 4, T: 5, W: 3, I: 5, A: 5, Ld: 7 },
};

function getAdvanceTable(role) {
  return role === "Henchman" ? "Henchman" : "Hero";
}

function getAdvanceThresholds(table, role = table) {
  return role === "Hired Sword" || table === "Henchman" ? henchmanThresholds : heroThresholds;
}

function getAdvancesEarned(table, experience, role = table) {
  return getAdvanceThresholds(table, role).filter((threshold) => threshold <= Number(experience || 0)).length;
}

function getStatMaximumProfile(warbandName, warriorTypeName) {
  const source = `${warbandName || ""} ${warriorTypeName || ""}`.toLowerCase();
  const typeName = (warriorTypeName || "").toLowerCase();
  if (/\b(vampire)\b/.test(typeName)) return "Vampire";
  if (/\b(ghoul)\b/.test(typeName)) return "Ghoul";
  if (/\b(possessed)\b/.test(typeName)) return "Possessed";
  if (/\b(skaven|rat ogre|black skaven)\b/.test(source)) return "Skaven";
  if (/\b(ogre)\b/.test(source)) return "Ogre";
  if (/\b(halfling)\b/.test(source)) return "Halfling";
  if (/\b(beastman|beastmen|gor|ungor|bestigor|centigor)\b/.test(source)) return "Beastman";
  if (/\b(dwarf|dwarfs|dwarves)\b/.test(source)) return "Dwarf";
  if (/\b(elf|elves|elven)\b/.test(source)) return "Elf";
  if (/\b(human|mercenary|mercenaries|youngblood|witch hunter|sigmar|sister|flagellant|freelancer|warlock|pit fighter|magister|dreg|darksoul|mutant|mutants|brethren|warrior priest|zealot|undead|carnival of chaos|pirate|middenheim|marienburg|averland|ostland|hochland|reikland|nuln)\b/.test(source)) {
    return "Human";
  }
  return null;
}

function numericStat(stats, label) {
  const value = Number(stats?.[label]);
  return Number.isFinite(value) ? value : null;
}

function getAvailableStatIncreases({ table, stats, initialStats, maximumStats }) {
  const available = (label) => {
    const current = numericStat(stats, label);
    if (current === null) return false;
    const maximum = maximumStats?.[label];
    if (maximum !== undefined && current >= maximum) return false;
    if (table === "Henchman") {
      const initial = numericStat(initialStats, label);
      return initial !== null && current < initial + 1;
    }
    return true;
  };

  const normalChoices = table === "Hero"
    ? heroStatGroups.flat()
    : henchmanStatChoices;
  const choices = [...new Set(normalChoices)].filter(available);
  if (table === "Hero" && choices.length === 0) {
    return statKeys.filter(available);
  }
  return choices;
}

function rollD6(randomInt) {
  return randomInt(1, 7);
}

function roll2D6(randomInt) {
  return rollD6(randomInt) + rollD6(randomInt);
}

function chooseAvailable(candidates, available, randomInt) {
  const choices = candidates.filter((stat) => available.includes(stat));
  return choices.length ? choices[rollD6(randomInt) % choices.length] : null;
}

function rollHeroAdvance(availableStats, randomInt) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const roll = roll2D6(randomInt);
    if (roll <= 5 || roll >= 10) return { roll, result: "new_skill", stat: null, secondaryRoll: null };

    let secondaryRoll = null;
    let candidates;
    if (roll === 6) {
      secondaryRoll = rollD6(randomInt);
      candidates = [secondaryRoll <= 3 ? "S" : "A", secondaryRoll <= 3 ? "A" : "S"];
    } else if (roll === 7) {
      candidates = ["WS", "BS"];
    } else if (roll === 8) {
      secondaryRoll = rollD6(randomInt);
      candidates = [secondaryRoll <= 3 ? "I" : "Ld", secondaryRoll <= 3 ? "Ld" : "I"];
    } else {
      secondaryRoll = rollD6(randomInt);
      candidates = [secondaryRoll <= 3 ? "W" : "T", secondaryRoll <= 3 ? "T" : "W"];
    }

    const stat = roll === 7
      ? chooseAvailable(candidates, availableStats, randomInt)
      : candidates.find((candidate) => availableStats.includes(candidate))
        || chooseAvailable(statKeys, availableStats, randomInt);
    if (stat) return { roll, result: "stat_increase", stat, secondaryRoll };
  }
  return { noAvailableAdvance: true };
}

function rollHenchmanAdvance(availableStats, promotionEligible, canPromote, randomInt) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const roll = roll2D6(randomInt);
    let stat = null;
    if (roll <= 4) stat = "I";
    else if (roll === 5) stat = "S";
    else if (roll <= 7) stat = chooseAvailable(["BS", "WS"], availableStats, randomInt);
    else if (roll === 8) stat = "A";
    else if (roll === 9) stat = "Ld";
    else if (promotionEligible && canPromote) {
      return { roll, result: "lads_got_talent", stat: null, secondaryRoll: null };
    }
    if (stat && availableStats.includes(stat)) {
      return { roll, result: "stat_increase", stat, secondaryRoll: null };
    }
  }
  return { noAvailableAdvance: true };
}

module.exports = {
  getAdvanceTable,
  getAdvanceThresholds,
  getAdvancesEarned,
  getAvailableStatIncreases,
  getStatMaximumProfile,
  racialMaximums,
  rollHeroAdvance,
  rollHenchmanAdvance,
};
