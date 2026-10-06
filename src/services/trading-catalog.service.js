const catalog = require("../../trading-post-catalog.json");

// 2Warbands.pdf: Possessed, Undead and animal entries; damobrules.pdf: Trolls.
const noWeaponsOrArmour = [
  "The Possessed", "Possessed", "Rat Ogre", "Rat Ogres", "Giant Rats",
  "Warhounds", "Dire Wolves", "Ghouls", "Zombies", "Cave Squigs", "Troll", "Trolls",
];
// DwarfTreasurehunters.pdf: Troll Slayers may never use missiles or any armour.
const slayerTypes = ["Dwarf Troll Slayers", "Troll Slayer", "Dwarf Troll Slayer (HS)", "Dwarf Troll Slayer (Pit Fighter)"];

function normalize(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

function includesName(names, name) {
  const normalized = normalize(name);
  return Boolean(normalized) && Array.isArray(names) && names.some((entry) => normalize(entry) === normalized);
}

function passesRestrictions(item, allowedKey, excludedKey, name) {
  return (!Array.isArray(item[allowedKey]) || includesName(item[allowedKey], name)) &&
    !includesName(item[excludedKey], name);
}

function effectiveRarity(item, warbandName, typeName) {
  for (const override of item.rarityOverrides || []) {
    if ((!Array.isArray(override.warbands) || includesName(override.warbands, warbandName)) &&
        (!Array.isArray(override.typeNames) || includesName(override.typeNames, typeName))) {
      return override.rarity;
    }
  }
  return item.rarity;
}

function canBuyItem(item, warbandName) {
  return Boolean(item) && passesRestrictions(item, "allowedWarbands", "excludedWarbands", warbandName);
}

function canEquipItem(item, context = {}) {
  const { warbandName, typeName, role, skillNames = [], permittedNames = [], spellcaster = false } = context;
  if (!canBuyItem(item, warbandName) ||
      !passesRestrictions(item, "allowedTypeNames", "excludedTypeNames", typeName) ||
      (item.heroOnly && normalize(role) !== "hero") ||
      (item.allowedRoles && !includesName(item.allowedRoles, role)) ||
      (item.requiredSkill && !includesName(skillNames, item.requiredSkill)) ||
      (item.spellcasterOnly && !spellcaster) ||
      (item.skillByWarband?.[warbandName] && !includesName(skillNames, item.skillByWarband[warbandName]))) {
    return false;
  }
  // 3Campaigns.pdf p.84: Arcane Lore also permits learning magic from a tome.
  if (!item.custom && item.id === "tome-of-magic" &&
      !includesName(["Magister", "Necromancer (Lahmia & Undead))", "Necromancer", "Eshin Sorcerer"], typeName) &&
      !includesName(skillNames, "Arcane Lore")) return false;
  if (item.category === "misc") return true;
  if (!["weapon", "armour", "shield"].includes(item.category)) return false;
  if (includesName(noWeaponsOrArmour, typeName)) {
    // Possessed can carry a shield or buckler with the Extra Arm mutation.
    if (!(normalize(typeName) === "the possessed" || normalize(typeName) === "possessed") ||
        item.category !== "shield") return false;
  }
  if (includesName(slayerTypes, typeName) &&
      (item.category !== "weapon" || item.ranged !== false)) return false;
  if (item.category === "weapon" && item.ranged === true &&
      includesName(["Flagellants", "Flagellant"], typeName)) return false;
  if (item.category === "armour" &&
      includesName(["Augur", "Orc Shaman"], typeName)) return false;
  if (item.requiresOwnedItem) return includesName(context.ownedItemIds, item.requiresOwnedItem);
  if (item.typeGrantsAccess && item.category === "weapon") return true;
  if (item.custom === true) return true;

  const aliases = item.weaponNames || [item.name];
  if (aliases.some((name) => includesName(permittedNames, name))) return true;
  if (item.category !== "weapon") return false;

  // Missing classification must not accidentally grant access via either weapon skill.
  const skill = item.ranged === true ? "Weapons Expert" :
    item.ranged === false ? "Weapons Training" : null;
  return Boolean(skill) && includesName(skillNames, skill);
}

function effectivePrice(item, typeName) {
  const override = item.priceOverrides?.find((entry) => includesName(entry.typeNames, typeName));
  return override ? { ...item, ...override } : item;
}

module.exports = { catalog, effectiveRarity, effectivePrice, canBuyItem, canEquipItem };
