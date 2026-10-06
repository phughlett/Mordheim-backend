const { catalog } = require("./trading-catalog.service");

const normalize = (name) => name.trim().toLowerCase().replace(/[-,]/g, " ").replace(/\s+/g, " ");

function listedItem(option, shop = catalog) {
  let name = normalize(option.name);
  if (name.startsWith("brace of ")) name = `${name.slice(9).replace(/pistols$/, "pistol")} brace`;
  if (["hammer/mace", "mace/hammer"].includes(name)) name = "club mace or hammer";
  const exact = shop.find((item) => normalize(item.name) === name);
  if (exact) return exact;
  const material = name.startsWith("gromril ") ? "Gromril" : name.startsWith("ithilmar ") ? "Ithilmar" : null;
  const weaponName = material ? name.slice(material.length + 1) : name;
  return shop.find((item) => item.category === option.category
    && !item.id.endsWith("-brace") && !item.purchaseAction
    && (material ? item.name.startsWith(`${material} `) : !/^(Gromril|Ithilmar) /.test(item.name))
    && item.weaponNames?.some((alias) => normalize(alias) === weaponName));
}

function equipmentSale(row, option, definition, shop = catalog) {
  if (row.nontransferable) return { unitSaleValue: null, saleRestriction: "Permanently poisoned weapons cannot be sold." };
  if (row.bound_warrior_id) return { unitSaleValue: null, saleRestriction: "Bound items cannot be sold." };
  if (option && Number(row.unit_cost_paid) === 0) {
    return { unitSaleValue: null, saleRestriction: "Free starting equipment cannot be sold." };
  }
  const item = row.shop_item_id ? shop.find((entry) => entry.id === row.shop_item_id) ?? definition : listedItem(option, shop);
  const baseCost = item?.baseCost ?? option?.unit_cost;
  if (!Number.isSafeInteger(Number(baseCost)) || Number(baseCost) < 0) {
    throw new Error(`Missing listed resale price for inventory ${row.id}.`);
  }
  return { unitSaleValue: Math.floor(Number(baseCost) / 2), saleRestriction: null };
}

module.exports = { equipmentSale, listedItem };
