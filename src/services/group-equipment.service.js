const { catalog } = require("./trading-catalog.service");

const normalize = (name) => (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

function equipmentKey(row) {
  if (row.shop_item_id) return `shop:${row.shop_item_id}`;
  const name = normalize(row.name);
  const item = catalog.find((entry) => [entry.name, entry.sourceName, ...(entry.weaponNames ?? [])]
    .some((alias) => alias && normalize(alias) === name));
  return item ? `shop:${item.id}` : `option:${name}`;
}

function summarizeGroup(member, inventory, allowIndividualGroupGear = false) {
  const items = new Map();
  for (const row of inventory) {
    const key = equipmentKey(row);
    const item = items.get(key) ?? { key, name: row.name, quantities: Array(member.group_size).fill(0) };
    if (row.model_index >= 0 && row.model_index < member.group_size) {
      item.quantities[row.model_index] += Number(row.quantity);
    }
    items.set(key, item);
  }
  const equipment = [...items.values()].map((item) => {
    const perModel = Math.max(...item.quantities);
    return { ...item, perModel, total: item.quantities.reduce((sum, count) => sum + count, 0),
      missing: item.quantities.reduce((sum, count) => sum + perModel - count, 0) };
  });
  return { memberId: member.id, name: member.name, allowIndividualGroupGear,
    valid: allowIndividualGroupGear || equipment.every((item) => item.missing === 0), items: equipment };
}

async function getGroupEquipment(query, rosterId) {
  const members = await query("warriors").where({ roster_id: rosterId, role: "Henchman" });
  if (!members.length) return [];
  const [inventory, permissions] = await Promise.all([
    query("warrior_inventory as inventory")
      .leftJoin("equipment_options as option", "option.id", "inventory.equipment_option_id")
      .leftJoin("shop_items as shop", "shop.id", "inventory.shop_item_id")
      .whereIn("inventory.warrior_id", members.map((member) => member.id))
      .select("inventory.*", query.raw("coalesce(shop.definition->>'name', option.name) as name")),
    query("warrior_equipment_lists as permission")
      .join("rosters as roster", "roster.warband_id", "permission.warband_id")
      .where("roster.id", rosterId).select("permission.*"),
  ]);
  return members.map((member) => summarizeGroup(member,
    inventory.filter((row) => row.warrior_id === member.id),
    permissions.some((row) => row.warrior_type_id === member.warrior_type_id && row.allow_individual_group_gear)));
}

function groupEquipmentError(groups) {
  const invalid = groups.filter((group) => !group.valid);
  return invalid.length
    ? `Incorrectly equipped groups: ${invalid.map((group) => `${group.name || "Unnamed group"} (${group.items.filter((item) => item.missing).map((item) => `${item.name}: missing ${item.missing}`).join(", ")})`).join("; ")}. Equip every model identically before battle.`
    : null;
}

module.exports = { equipmentKey, summarizeGroup, getGroupEquipment, groupEquipmentError };
