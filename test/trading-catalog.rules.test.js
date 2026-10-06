const { test } = require("node:test");
const assert = require("node:assert/strict");
const { catalog, effectiveRarity, effectivePrice, canBuyItem, canEquipItem } = require("../src/services/trading-catalog.service");
const originalCatalog = require("../trading-catalog.json");
const source = require("./fixtures/trading-post-source.json");

function item(id) {
  const found = catalog.find((entry) => entry.id === id);
  assert.ok(found, `Missing catalog item: ${id}`);
  return found;
}

const hero = {
  warbandName: "Mercenaries",
  typeName: "Mercenary Captain",
  role: "Hero",
  skillNames: [],
  permittedNames: [],
};

test("every Core, 1a and 1b source row is represented with its price, rarity, grade and category", () => {
  assert.equal(source.rows.length, 178);
  assert.deepEqual(Object.fromEntries(["close-combat", "missile", "blackpowder", "armour", "miscellaneous", "animals"]
    .map((category) => [category, source.rows.filter((row) => row.category === category).length])),
  { "close-combat": 41, missile: 17, blackpowder: 16, armour: 13, miscellaneous: 80, animals: 11 });
  for (const row of source.rows) {
    const matches = catalog.filter((entry) => entry.sourceName === row.name);
    assert.ok(matches.length, row.name);
    for (const entry of matches) {
      assert.equal(entry.grade, row.grade, row.name);
      assert.equal(entry.shopCategory, row.category, row.name);
    }
    if (/Price/i.test(row.cost)) continue;
    const primary = matches.find((entry) => !entry.id.endsWith("-brace"));
    const main = row.cost.split("(")[0];
    const dice = main.match(/(?:(\d+)\s*)?D6(?:\s*x\s*(\d+))?/i);
    const base = /1st free/.test(main) ? 2 : Number(main.match(/\d+/)?.[0]);
    assert.equal(primary.baseCost - (row.name === "Dark Elf Blade" ? 10 : 0), base, row.name);
    assert.equal(primary.priceDice, dice ? Number(dice[1] ?? 1) : 0, row.name);
    assert.equal(primary.priceMultiplier, dice ? Number(dice[2] ?? 1) : 1, row.name);
    assert.equal(primary.rarity, /Rare\s+(\d+)/i.test(row.availability) ? Number(row.availability.match(/Rare\s+(\d+)/i)[1]) : null, row.name);
    const bracePrice = row.cost.match(/\((\d+)(?:\s*\+\s*(\d+)D6)?\s*gc for a brace\)/i);
    if (bracePrice) {
      const brace = matches.find((entry) => entry.id.endsWith("-brace"));
      assert.ok(brace, row.name);
      assert.equal(brace.baseCost, Number(bracePrice[1]), row.name);
      assert.equal(brace.priceDice, Number(bracePrice[2] ?? 0), row.name);
      assert.equal(brace.rarity, /Rare (\d+) for a brace/.test(row.availability)
        ? Number(row.availability.match(/Rare (\d+) for a brace/)[1]) : primary.rarity, row.name);
    }
  }
});

test("special item data encodes upgrades, summoning, prerequisites and species restrictions", () => {
  assert.deepEqual([item("dark-elf-blade-sword").baseCost, item("dark-elf-blade-dagger").baseCost], [30, 22]);
  assert.equal(item("dark-elf-blade-sword").profileName, item("sword").profileName);
  assert.equal(item("familiar").purchaseAction, "ritual");
  assert.equal(canEquipItem(item("familiar"), { ...hero, spellcaster: true }), true);
  assert.equal(canEquipItem(item("familiar"), { ...hero, typeName: "Warrior Priest" }), false);
  assert.equal(item("poisoned-weapon").purchaseAction, "permanent-upgrade");
  assert.equal(item("standard-of-nagarythe").creationOnly, true);
  assert.equal(item("swivel-gun").maxPerWarband, 1);
  assert.equal(item("peg-leg").maxPerModel, 1);
  assert.equal(item("barding").requiresOwnedItem, "warhorse");
  assert.equal(item("skeleton-chariot").priceDice, 10);
  assert.equal(canEquipItem(item("chaos-steed"), { ...hero, warbandName: "Marauders of Chaos" }), false);
  assert.equal(canEquipItem(item("chaos-steed"), { ...hero, warbandName: "Marauders of Chaos", skillNames: ["Chosen of Chaos"] }), true);
  assert.equal(canEquipItem(item("chaos-steed"), { ...hero, warbandName: "Cult of the Possessed", typeName: "The Possessed" }), false);
  assert.equal(canEquipItem(item("giant-wolf"), { ...hero, warbandName: "Orc", typeName: "Orc Boss" }), false);
  assert.equal(canEquipItem(item("giant-wolf"), { ...hero, warbandName: "Orc", typeName: "Goblin Warriors" }), true);
  assert.equal(canEquipItem(item("reptile-venom"), { ...hero, warbandName: "Lizardmen", typeName: "Skink Braves", role: "Henchman" }), true);
  assert.equal(canEquipItem(item("reptile-venom"), { ...hero, warbandName: "Lizardmen", typeName: "Skink Braves", role: "Hero" }), false);
  assert.equal(canBuyItem(item("tarot-cards"), "Witch Hunters"), false);
  assert.deepEqual([effectivePrice(item("black-lotus"), "Skink Priest").baseCost, effectivePrice(item("black-lotus"), "Skink Priest").priceDice], [10, 0]);
  assert.deepEqual([effectivePrice(item("dark-venom"), "Skink Great Crests").baseCost, effectivePrice(item("dark-venom"), "Skink Great Crests").priceDice], [20, 0]);
  assert.equal(effectivePrice(item("dark-venom"), "Mercenary Captain").priceDice, 2);
});

test("trading catalog satisfies the documented data contract with stable unique slugs", () => {
  assert.equal(catalog.length, 203);
  assert.equal(new Set(catalog.map((entry) => entry.id)).size, catalog.length);
  const allowedKeys = new Set([
    "id", "name", "category", "baseCost", "priceDice", "priceMultiplier", "rarity",
    "description", "sourceReference", "weaponNames", "allowedWarbands", "excludedWarbands",
    "allowedTypeNames", "excludedTypeNames", "heroOnly", "requiredSkill", "rarityOverrides",
    "profileName", "materialName", "ranged",
    "grade", "shopCategory", "sourceName", "purchaseAction", "creationOnly", "maxPerWarband",
    "maxPerModel", "requiresOwnedItem", "skillByWarband", "spellcasterOnly", "priceOverrides",
    "excludesOwnedItems", "allowedRoles", "typeGrantsAccess",
  ]);
  for (const entry of catalog) {
    assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(["weapon", "armour", "shield", "misc"].includes(entry.category), entry.id);
    assert.ok(Number.isInteger(entry.baseCost) && entry.baseCost >= 0, entry.id);
    assert.ok(Number.isInteger(entry.priceDice) && entry.priceDice >= 0 && entry.priceDice <= 10, entry.id);
    assert.ok(Number.isInteger(entry.priceMultiplier) && entry.priceMultiplier >= 1 && entry.priceMultiplier <= 25, entry.id);
    assert.ok(entry.rarity === null || Number.isInteger(entry.rarity), entry.id);
    for (const key of ["name", "description", "sourceReference"]) assert.ok(entry[key].trim(), `${entry.id}.${key}`);
    for (const key of Object.keys(entry)) assert.ok(allowedKeys.has(key), `${entry.id}.${key}`);
    for (const key of ["weaponNames", "allowedWarbands", "excludedWarbands", "allowedTypeNames", "excludedTypeNames"]) {
      if (entry[key]) assert.ok(entry[key].length > 0 && entry[key].every((name) => typeof name === "string" && name.trim()), `${entry.id}.${key}`);
    }
    if (entry.category === "weapon") {
      assert.equal(typeof entry.ranged, "boolean", entry.id);
      assert.ok(entry.weaponNames.length > 0, entry.id);
      assert.ok(entry.profileName, entry.id);
    }
    assert.ok(["core", "1a", "1b"].includes(entry.grade), entry.id);
    assert.ok(["close-combat", "missile", "blackpowder", "armour", "miscellaneous", "animals"].includes(entry.shopCategory), entry.id);
    for (const override of entry.rarityOverrides || []) {
      assert.ok(override.rarity === null || Number.isInteger(override.rarity), entry.id);
    }
  }
});

test("base chart fixed-price weapons and armour use trading rather than recruitment prices", () => {
  const expected = {
    axe: [5, null], "club-mace-hammer": [3, null], dagger: [2, null],
    "double-handed-weapon": [15, null], flail: [15, null], halberd: [10, null],
    lance: [40, 8], "morning-star": [15, null], spear: [10, null], sword: [10, null],
    bow: [10, null], blunderbuss: [30, 9], crossbow: [25, null],
    "crossbow-pistol": [35, 9], "duelling-pistol": [30, 10],
    "duelling-pistol-brace": [60, 10], handgun: [35, 8], "hunting-rifle": [200, 11],
    "long-bow": [15, null], pistol: [15, 8], "pistol-brace": [30, 8],
    "repeater-crossbow": [40, 8], sling: [2, null], "short-bow": [5, null],
    "throwing-knives-stars": [15, 5], barding: [80, 8], buckler: [5, null],
    "gromril-armour": [150, 11], "heavy-armour": [50, null], helmet: [10, null],
    "ithilmar-armour": [90, 11], "light-armour": [20, null], shield: [5, null],
  };
  for (const [id, [cost, rarity]] of Object.entries(expected)) {
    const entry = item(id);
    assert.deepEqual([entry.baseCost, entry.priceDice, entry.priceMultiplier, entry.rarity], [cost, 0, 1, rarity], id);
    assert.match(entry.sourceReference, /3Campaigns\.pdf p\.104|3Campaigns\.pdf pp\.104/);
  }
  assert.match(item("dagger").description, /first dagger is free/);
});

test("all miscellaneous chart items and variable-price premiums are represented exactly", () => {
  const expected = {
    "black-lotus": [10, 1, 1, 9], "blessed-water": [10, 3, 1, 6],
    "bugmans-ale": [50, 3, 1, 9], "cathayan-silk-clothes": [50, 2, 1, 9],
    "crimson-shade": [35, 1, 1, 8], "dark-venom": [30, 2, 1, 8],
    "elven-cloak": [100, 1, 10, 12], garlic: [1, 0, 1, null],
    "halfling-cookbook": [30, 3, 1, 7], "healing-herbs": [20, 2, 1, 8],
    "holy-unholy-relic": [15, 3, 1, 8], "holy-tome": [100, 1, 10, 8],
    horse: [40, 0, 1, 8], "hunting-arrows": [25, 1, 1, 8], lantern: [10, 0, 1, null],
    "lucky-charm": [10, 0, 1, 6], "mad-cap-mushrooms": [30, 3, 1, 9],
    "mandrake-root": [25, 1, 1, 8], "mordheim-map": [20, 4, 1, 9],
    net: [5, 0, 1, null], "rope-hook": [5, 0, 1, null],
    "superior-blackpowder": [30, 0, 1, 11], "tears-of-shallaya": [10, 2, 1, 7],
    "tome-of-magic": [200, 1, 25, 12], warhorse: [80, 0, 1, 11],
    wardog: [25, 2, 1, 10], "elf-bow": [35, 3, 1, 12],
  };
  for (const old of originalCatalog) assert.ok(catalog.some((entry) => entry.id === old.id), `Preserve ${old.id}`);
  for (const [id, tuple] of Object.entries(expected)) {
    const entry = item(id);
    assert.deepEqual([entry.baseCost, entry.priceDice, entry.priceMultiplier, entry.rarity], tuple, id);
  }
});

test("every chart close-combat profile has explicit Gromril and Ithilmar variants", () => {
  const bases = originalCatalog.filter((entry) => entry.category === "weapon" && !entry.ranged && !entry.materialName);
  assert.equal(bases.length, 10);
  for (const base of bases) {
    for (const [material, multiplier, rarity] of [["gromril", 4, 11], ["ithilmar", 3, 9]]) {
      const variant = item(`${material}-${base.id}`);
      assert.equal(variant.baseCost, base.baseCost * multiplier);
      assert.equal(variant.rarity, rarity);
      assert.equal(variant.priceDice, 0);
      assert.equal(variant.profileName, base.profileName);
      assert.equal(variant.materialName.toLowerCase(), material);
      assert.deepEqual(variant.weaponNames, base.weaponNames);
      assert.equal(variant.ranged, false);
      assert.match(variant.description, material === "gromril" ? /extra -1 armour-save modifier/ : /\+1 Initiative in close combat/);
      assert.equal(canEquipItem(variant, { ...hero, permittedNames: [base.weaponNames[0]] }), true);
      assert.equal(canEquipItem(variant, { ...hero, permittedNames: ["Bow"] }), false);
    }
  }
  assert.equal(catalog.filter((entry) => entry.materialName && entry.category === "weapon").length, 20);
  assert.equal(catalog.some((entry) => entry.materialName && entry.ranged), false);
});

test("pistol braces retain the single pistol's profile, permission aliases and rarity", () => {
  for (const id of ["pistol", "duelling-pistol", "warplock-pistol"]) {
    const single = item(id);
    const brace = item(`${id}-brace`);
    const context = { ...hero, warbandName: id === "warplock-pistol" ? "Skaven" : hero.warbandName };
    assert.equal(brace.baseCost, single.baseCost * 2);
    assert.equal(brace.rarity, single.rarity);
    assert.equal(brace.profileName, single.profileName);
    assert.equal(brace.ranged, true);
    assert.equal(canEquipItem(brace, { ...context, permittedNames: [single.name] }), true);
    assert.equal(canEquipItem(brace, { ...context, permittedNames: [] }), false);
    assert.equal(canEquipItem(brace, { ...context, skillNames: ["Weapons Training"] }), false);
    assert.equal(canEquipItem(brace, { ...context, skillNames: ["Weapons Expert"] }), true);
  }
  assert.equal(item("warplock-pistol").baseCost, 35);
  assert.equal(item("warplock-pistol").rarity, 11);
  assert.match(item("warplock-pistol").sourceReference, /2Warbands\.pdf p\.29/);
});

test("rarity overrides preserve explicit common/null and do not confuse warriors with warbands", () => {
  assert.equal(effectiveRarity(item("black-lotus"), "Skaven", "Assassin Adept"), 7);
  assert.equal(effectiveRarity(item("black-lotus"), "Mercenaries", "Skaven"), 9);
  assert.equal(effectiveRarity(item("blessed-water"), "Sisters of Sigmar", "Augur"), null);
  assert.equal(effectiveRarity(item("blessed-water"), "Witch Hunters", "Warrior Priest"), null);
  assert.equal(effectiveRarity(item("blessed-water"), "Witch Hunters", "Witch Hunter Captain"), 6);
  assert.equal(effectiveRarity(item("holy-unholy-relic"), "Witch Hunters", "Warrior Priest"), 6);
  assert.equal(effectiveRarity(item("holy-unholy-relic"), "Sisters of Sigmar", "Sister Superior"), 6);
  assert.equal(effectiveRarity(item("holy-unholy-relic"), "Mercenaries", "Mercenary Captain"), 8);
  assert.equal(effectiveRarity(item("sword")), null);
});

test("override dimensions are conjunctive, first matching override wins, and lookups are pure", () => {
  const custom = {
    rarity: 12,
    rarityOverrides: [
      { warbands: ["Mercenaries"], typeNames: ["Mercenary Captain"], rarity: null },
      { warbands: ["Mercenaries"], rarity: 9 },
      { typeNames: ["Mercenary Captain"], rarity: 7 },
    ],
  };
  const before = JSON.stringify(custom);
  assert.equal(effectiveRarity(custom, "Mercenaries", "Mercenary Captain"), null);
  assert.equal(effectiveRarity(custom, "Mercenaries", "Youngblood"), 9);
  assert.equal(effectiveRarity(custom, "Other", "Mercenary Captain"), 7);
  assert.equal(effectiveRarity(custom, "Other", "Other"), 12);
  assert.equal(JSON.stringify(custom), before);
});

test("poison warband bans and Warrior-Priest type bans are separate checks", () => {
  for (const id of ["black-lotus", "dark-venom"]) {
    const poison = item(id);
    for (const warbandName of ["Witch Hunters", "Sisters of Sigmar"]) {
      assert.equal(canBuyItem(poison, warbandName), false);
      assert.equal(canEquipItem(poison, { ...hero, warbandName }), false);
    }
    assert.equal(canBuyItem(poison, "Mercenaries"), true);
    assert.equal(canEquipItem(poison, { ...hero, typeName: "Warrior Priest" }), false);
    assert.equal(canEquipItem(poison, hero), true);
    assert.match(poison.description, /non-blackpowder/);
  }
});

test("only Heroes may carry miscellaneous items, independent of recruitment aliases or skills", () => {
  for (const entry of catalog.filter((entry) => entry.category === "misc" && entry.heroOnly)) {
    for (const role of ["Henchman", "Hired Sword", undefined]) {
      assert.equal(canEquipItem(entry, {
        ...hero, role, warbandName: "Mercenaries",
        typeName: entry.allowedTypeNames?.[0] || hero.typeName,
        permittedNames: [entry.name], skillNames: ["Weapons Training", "Weapons Expert", "Arcane Lore"],
      }), false, `${entry.id}: ${role}`);
    }
  }
  assert.equal(canEquipItem(item("rope-hook"), hero), true);
  assert.equal(canEquipItem(item("rope-hook"), { ...hero, role: "hero" }), true);
  assert.equal(canEquipItem(item("sword"), { ...hero, role: "Henchman", permittedNames: ["Sword"] }), true);
});

test("holy tome is for priest and Sister types, not every Witch Hunter or arbitrary Hero", () => {
  assert.equal(canBuyItem(item("holy-tome"), "Mercenaries"), true);
  assert.equal(canEquipItem(item("holy-tome"), { ...hero, warbandName: "Witch Hunters", typeName: "Warrior Priest" }), true);
  for (const typeName of ["Augur", "Sister Superior", "Sigmarite Matriarch"]) {
    assert.equal(canEquipItem(item("holy-tome"), { ...hero, warbandName: "Sisters of Sigmar", typeName }), true);
  }
  for (const typeName of ["Witch Hunter Captain", "Witch Hunters", "Mercenary Captain"]) {
    assert.equal(canEquipItem(item("holy-tome"), { ...hero, typeName }), false);
  }
  assert.equal(canEquipItem(item("holy-tome"), { ...hero, typeName: "Warrior Priest", role: "Henchman" }), false);
  for (const typeName of ["Sigmarite Sister", "Novices"]) {
    assert.equal(canEquipItem(item("holy-tome"), { ...hero, warbandName: "Sisters of Sigmar", typeName, role: "Hero" }), true);
    assert.equal(canEquipItem(item("holy-tome"), { ...hero, warbandName: "Sisters of Sigmar", typeName, role: "Henchman" }), false);
  }
});

test("chart purchase bans apply even to living Heroes of excluded warbands", () => {
  for (const id of ["blessed-water", "garlic", "halfling-cookbook"]) {
    assert.equal(canBuyItem(item(id), "Undead"), false, id);
    assert.equal(canEquipItem(item(id), { ...hero, warbandName: "Undead", typeName: "Dregs" }), false, id);
  }
  assert.equal(canBuyItem(item("tears-of-shallaya"), "Cult of the Possessed"), true);
  assert.equal(canEquipItem(item("tears-of-shallaya"), { ...hero, warbandName: "Undead", typeName: "Dregs" }), true);
  assert.equal(canEquipItem(item("tears-of-shallaya"), { ...hero, warbandName: "Undead", typeName: "Vampire" }), false);
  assert.equal(canBuyItem(item("halfling-cookbook"), "Carnival of Chaos"), false);
  assert.equal(canBuyItem(item("wardog"), "Skaven"), false);
  assert.equal(canEquipItem(item("blessed-water"), { ...hero, warbandName: "Cult of the Possessed", typeName: "Magister" }), true);
  assert.equal(canBuyItem(item("blessed-water"), "Cult of the Possessed"), true);
  assert.equal(canEquipItem(item("blessed-water"), { ...hero, warbandName: "Cult of the Possessed", typeName: "The Possessed" }), false);
});

test("drug lack of effect is documented, not turned into an invented purchase prohibition", () => {
  for (const id of ["mad-cap-mushrooms", "mandrake-root", "crimson-shade"]) {
    assert.equal(canBuyItem(item(id), "Undead"), true);
    assert.equal(canEquipItem(item(id), { ...hero, warbandName: "Undead", typeName: "Vampire" }), true);
    assert.equal(canEquipItem(item(id), { ...hero, warbandName: "Cult of the Possessed", typeName: "The Possessed" }), true);
    assert.match(item(id).description, /no effect on Undead or Possessed/);
  }
});

test("Elves cannot drink Bugman's Ale but may carry other unrestricted miscellaneous items", () => {
  for (const warbandName of ["Dark Elves", "Shadow Warrior"]) assert.equal(canBuyItem(item("bugmans-ale"), warbandName), false);
  assert.equal(canEquipItem(item("bugmans-ale"), { ...hero, typeName: "Elf" }), false);
  assert.equal(canEquipItem(item("bugmans-ale"), { ...hero, typeName: "Elf Mage" }), false);
  assert.equal(canBuyItem(item("bugmans-ale"), "Dwarf Treasure Hunters"), true);
  assert.equal(canEquipItem(item("elven-cloak"), hero), true);
  assert.equal(canEquipItem(item("cathayan-silk-clothes"), { ...hero, warbandName: "Skaven" }), true);
});

test("Tome of Magic conservatively allows native base wizards, never speculative mundane access", () => {
  const tome = item("tome-of-magic");
  for (const [warbandName, typeName] of [
    ["Cult of the Possessed", "Magister"],
    ["Undead", "Necromancer (Lahmia & Undead))"],
    ["Skaven", "Eshin Sorcerer"],
  ]) {
    assert.equal(canEquipItem(tome, { ...hero, warbandName, typeName }), true);
    assert.equal(canEquipItem(tome, { ...hero, warbandName, typeName, role: "Henchman" }), false);
  }
  assert.equal(canBuyItem(tome, "Mercenaries"), true);
  assert.equal(canEquipItem(tome, hero), false);
  assert.equal(canEquipItem(tome, { ...hero, skillNames: ["Arcane Lore"] }), true);
  assert.equal(canEquipItem(tome, { ...hero, typeName: "Warrior Priest", skillNames: ["Arcane Lore"] }), false);
  assert.equal(canEquipItem(tome, { ...hero, skillNames: ["Weapons Expert"] }), false);
  assert.equal(canEquipItem(tome, { ...hero, warbandName: "Witch Hunters", typeName: "Magister" }), false);
  assert.equal(canEquipItem(tome, { ...hero, warbandName: "Sisters of Sigmar", typeName: "Magister" }), false);
  assert.equal(tome.requiredSkill, undefined);
  assert.match(tome.description, /separate verification/);
});

test("human mounts allow evidenced living types but not Vampire, Possessed or unknown species", () => {
  for (const id of ["horse", "warhorse"]) {
    const mount = item(id);
    assert.equal(canEquipItem(mount, hero), true);
    assert.equal(canEquipItem(mount, { ...hero, warbandName: "Undead", typeName: "Dregs" }), true);
    assert.equal(canEquipItem(mount, { ...hero, warbandName: "Undead", typeName: "Necromancer (Lahmia & Undead))" }), true);
    assert.equal(canEquipItem(mount, { ...hero, warbandName: "Cult of the Possessed", typeName: "Mutants" }), true);
    for (const typeName of ["Swordsmen", "Zealots", "Sigmarite Sister", "Novices", "Brethren"]) {
      assert.equal(canEquipItem(mount, { ...hero, typeName, role: "Hero" }), true);
      assert.equal(canEquipItem(mount, { ...hero, typeName, role: "Henchman" }), false);
    }
    for (const typeName of ["Vampire", "The Possessed", "Beastmen", "Elf", "Unknown Hero"]) {
      assert.equal(canEquipItem(mount, { ...hero, typeName }), false, `${id}: ${typeName}`);
    }
    assert.equal(canBuyItem(mount, "Skaven"), false);
    assert.equal(canEquipItem(mount, { ...hero, role: "Henchman" }), false);
    assert.match(mount.description, /optional mounted rules/);
  }
  assert.equal(canEquipItem(item("barding"), { ...hero, permittedNames: ["Heavy armour"] }), false);
  assert.equal(canEquipItem(item("barding"), { ...hero, permittedNames: ["Barding"] }), false);
  assert.equal(canEquipItem(item("barding"), { ...hero, ownedItemIds: ["warhorse"] }), true);
  assert.match(item("barding").description, /not a normal horse/);
});

test("recruitment permission is alias-based, exact, case-insensitive and whitespace-normalized", () => {
  for (const name of ["Club", "Mace", "Hammer", "Staff"]) {
    assert.equal(canEquipItem(item("club-mace-hammer"), { ...hero, permittedNames: [name] }), true);
    assert.equal(canEquipItem(item("gromril-club-mace-hammer"), { ...hero, permittedNames: [name] }), true);
  }
  assert.equal(canEquipItem(item("sword"), { ...hero, permittedNames: ["  SWORD  "] }), true);
  assert.equal(canEquipItem(item("long-bow"), { ...hero, permittedNames: [" LONG   BOW "] }), true);
  assert.equal(canEquipItem(item("sword"), { ...hero, permittedNames: ["Sword breaker"] }), false);
  assert.equal(canEquipItem(item("bow"), { ...hero, permittedNames: ["Long bow"] }), false);
  assert.equal(canEquipItem(item("throwing-knives-stars"), { ...hero, permittedNames: ["Throwing stars"] }), true);
  assert.equal(canEquipItem(item("hunting-rifle"), { ...hero, permittedNames: ["Hochland long rifle"] }), true);
  assert.equal(canEquipItem(item("sword"), { ...hero, permittedNames: null }), false);
  assert.equal(canEquipItem(item("sword")), false);
  assert.equal(canEquipItem(null, hero), false);
});

test("weapon skills bypass only the matching weapon class, never armour or hard restrictions", () => {
  assert.equal(canEquipItem(item("sword"), { ...hero, skillNames: ["Weapons Training"] }), true);
  assert.equal(canEquipItem(item("bow"), { ...hero, skillNames: ["Weapons Expert"] }), true);
  assert.equal(canEquipItem(item("gromril-sword"), { ...hero, skillNames: ["Weapons Training"] }), true);
  assert.equal(canEquipItem(item("sword"), { ...hero, skillNames: ["Weapons Expert"] }), false);
  assert.equal(canEquipItem(item("bow"), { ...hero, skillNames: ["Weapons Training"] }), false);
  assert.equal(canEquipItem(item("sword"), { ...hero, skillNames: ["Expert Swordsman"] }), false);
  for (const id of ["heavy-armour", "gromril-armour", "ithilmar-armour", "helmet", "shield", "buckler"]) {
    assert.equal(canEquipItem(item(id), { ...hero, skillNames: ["Weapons Training", "Weapons Expert"] }), false, id);
  }
  assert.equal(canEquipItem({ name: "Unclassified", category: "weapon" }, { ...hero, skillNames: ["Weapons Training", "Weapons Expert"] }), false);
  assert.equal(canEquipItem(item("warplock-pistol"), { ...hero, skillNames: ["Weapons Expert"], permittedNames: ["Warplock pistol"] }), false);
  assert.equal(canEquipItem(item("warplock-pistol"), { ...hero, warbandName: "Skaven", skillNames: ["Weapons Expert"] }), true);
  assert.equal(canEquipItem(item("bow"), { ...hero, warbandName: "Witch Hunters", typeName: "Flagellants", skillNames: ["Weapons Expert"], permittedNames: ["Bow"] }), false);
  assert.equal(canEquipItem(item("sword"), { ...hero, warbandName: "Cult of the Possessed", typeName: "The Possessed", skillNames: ["Weapons Training"], permittedNames: ["Sword"] }), false);
  assert.equal(canEquipItem(item("heavy-armour"), { ...hero, warbandName: "Sisters of Sigmar", typeName: "Augur", permittedNames: ["Heavy armour"] }), false);
});

test("special armour inherits heavy-armour access, not light armour, and shield permissions remain distinct", () => {
  for (const id of ["gromril-armour", "ithilmar-armour"]) {
    assert.equal(canEquipItem(item(id), { ...hero, permittedNames: ["Heavy armour"] }), true);
    assert.equal(canEquipItem(item(id), { ...hero, permittedNames: ["Light armour"] }), false);
    assert.equal(canEquipItem(item(id), { ...hero, permittedNames: [item(id).name] }), true);
  }
  assert.equal(canEquipItem(item("shield"), { ...hero, permittedNames: ["Buckler"] }), false);
  assert.equal(canEquipItem(item("buckler"), { ...hero, permittedNames: ["Shield"] }), false);
  assert.equal(canEquipItem(item("buckler"), { ...hero, permittedNames: ["Buckler"] }), true);
});

test("required skills and combined allow/exclude restrictions are mandatory before alias or skill bypass", () => {
  const restricted = {
    category: "weapon", name: "Test weapon", ranged: true, weaponNames: ["Bow"],
    allowedWarbands: ["Mercenaries", "Skaven"], excludedWarbands: ["Skaven"],
    allowedTypeNames: ["Mercenary Captain", "Youngblood"], excludedTypeNames: ["Youngblood"],
    requiredSkill: "Test prerequisite",
  };
  const context = { ...hero, skillNames: ["Test prerequisite", "Weapons Expert"] };
  assert.equal(canEquipItem(restricted, context), true);
  assert.equal(canEquipItem(restricted, { ...context, typeName: "Youngblood" }), false);
  assert.equal(canEquipItem(restricted, { ...context, warbandName: "Skaven" }), false);
  assert.equal(canEquipItem(restricted, { ...context, warbandName: "Other" }), false);
  assert.equal(canEquipItem(restricted, { ...context, typeName: undefined }), false);
  assert.equal(canEquipItem(restricted, { ...context, skillNames: ["Weapons Expert"], permittedNames: ["Bow"] }), false);
  assert.equal(canEquipItem(restricted, { ...context, skillNames: null, permittedNames: ["Bow"] }), false);
  assert.equal(canBuyItem(restricted, "Mercenaries"), true);
  assert.equal(canBuyItem(restricted), false);
  assert.equal(canBuyItem(null, "Mercenaries"), false);
});

test("custom items bypass recruitment aliases but retain every explicit eligibility restriction", () => {
  for (const category of ["weapon", "armour", "shield", "misc"]) {
    const custom = { custom: true, category, name: "Unlisted custom item" };
    assert.equal(canEquipItem(custom, hero), true, category);
  }
  const custom = {
    custom: true, category: "weapon", name: "Custom weapon", heroOnly: true,
    allowedWarbands: ["Mercenaries"], excludedWarbands: ["Skaven"],
    allowedTypeNames: ["Mercenary Captain"], excludedTypeNames: ["Youngblood"],
    requiredSkill: "Custom prerequisite",
  };
  const context = { ...hero, skillNames: ["Custom prerequisite"] };
  assert.equal(canEquipItem(custom, context), true);
  assert.equal(canEquipItem(custom, { ...context, role: "Henchman" }), false);
  assert.equal(canEquipItem(custom, { ...context, warbandName: "Skaven" }), false);
  assert.equal(canEquipItem(custom, { ...context, typeName: "Youngblood" }), false);
  assert.equal(canEquipItem(custom, { ...context, typeName: "Other" }), false);
  assert.equal(canEquipItem(custom, { ...context, skillNames: ["Weapons Expert"] }), false);
  assert.equal(canEquipItem({ ...custom, category: "unknown" }, context), false);
  assert.equal(canEquipItem({ ...custom, custom: "true" }, context), false);
});

test("forged aliases, weapon skills and custom flags cannot bypass permanent source-backed type bans", () => {
  for (const typeName of ["The Possessed", "Rat Ogre", "Giant Rats", "Warhounds", "Dire Wolves", "Ghouls", "Zombies", "Cave Squigs", "Troll"]) {
    for (const id of ["sword", "pistol", "heavy-armour", "helmet"]) {
      for (const custom of [false, true]) {
        const entry = { ...item(id), custom };
        assert.equal(canEquipItem(entry, {
          ...hero, typeName, permittedNames: entry.weaponNames,
          skillNames: ["Weapons Training", "Weapons Expert"],
        }), false, `${typeName}: ${id}, custom=${custom}`);
      }
    }
  }
  for (const typeName of ["Dwarf Troll Slayers", "Troll Slayer", "Dwarf Troll Slayer (HS)", "Dwarf Troll Slayer (Pit Fighter)"]) {
    const context = { ...hero, typeName, skillNames: ["Weapons Training", "Weapons Expert"] };
    assert.equal(canEquipItem(item("sword"), context), true);
    for (const id of ["pistol", "hunting-rifle", "heavy-armour", "helmet", "shield", "buckler"]) {
      const entry = item(id);
      assert.equal(canEquipItem(entry, { ...context, permittedNames: entry.weaponNames }), false, `${typeName}: ${id}`);
      assert.equal(canEquipItem({ ...entry, custom: true }, context), false, `${typeName}: custom ${id}`);
    }
  }
  for (const typeName of ["Augur", "Orc Shaman"]) {
    assert.equal(canEquipItem({ ...item("helmet"), custom: true }, { ...hero, typeName, permittedNames: ["Helmet"] }), false);
  }
  assert.equal(canEquipItem({ ...item("pistol"), custom: true }, { ...hero, typeName: "Flagellants", skillNames: ["Weapons Expert"] }), false);
});

test("eligibility helpers leave catalog, inventory, skills and context unchanged", () => {
  const before = JSON.stringify(catalog);
  const context = { ...hero, skillNames: ["Weapons Training"], permittedNames: ["Heavy armour"] };
  const contextBefore = JSON.stringify(context);
  for (const entry of catalog) {
    canBuyItem(entry, context.warbandName);
    canEquipItem(entry, context);
    effectiveRarity(entry, context.warbandName, context.typeName);
  }
  assert.equal(JSON.stringify(catalog), before);
  assert.equal(JSON.stringify(context), contextBefore);
  assert.match(item("wardog").description, /not automatic/);
  assert.match(item("mordheim-map").description, /not applied automatically/);
  assert.equal(item("tome-of-magic").requiredSkill, undefined);
  assert.match(item("tome-of-magic").description, /separate verification/);
});
