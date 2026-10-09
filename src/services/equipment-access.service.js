function canUseEquipment(item, { warbandName, typeName, stats = {}, mutationIds = [] } = {}) {
  const ranged = item.ranged ?? (item.weaponType ? item.weaponType !== "close_combat" : undefined);
  if (warbandName === "Marauders of Chaos" && typeName === "Condemned"
    && ["WS", "S", "T", "A"].some((stat) => !/^[1-9]\d*$/.test(String(stats[stat] ?? "")))) return false;

  if (warbandName === "Cult of the Possessed" && ["The Possessed", "Possessed"].includes(typeName)) {
    if (item.category === "weapon" || item.category === "armour" || item.category === "set") return false;
    if (item.category === "shield") return mutationIds.includes("extra-arm");
  }
  if (warbandName === "Dark Elves" && typeName === "Fellblades"
    && item.category === "weapon" && ranged !== false) return false;
  if (["Ostlanders", "Horned Hunters"].includes(warbandName) && typeName === "Priest of Taal"
    && item.category === "armour" && /\bheavy armou?r\b/i.test(item.name)) return false;
  if (warbandName === "Orc" && typeName === "Orc Shaman"
    && ["armour", "shield", "set"].includes(item.category)) return false;
  return true;
}

module.exports = { canUseEquipment };
