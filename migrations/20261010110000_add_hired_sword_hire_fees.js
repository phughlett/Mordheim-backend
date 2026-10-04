// Hire (sign-on) fees printed in each Hired Sword's entry. Upkeep is not tracked here.
const fees = [
  ["Pit Fighter", 30, "3Campaigns.pdf — Hired Swords: Pit Fighter"],
  ["Ogre Bodyguard", 80, "3Campaigns.pdf — Hired Swords: Ogre Bodyguard"],
  ["Halfling Scout (HS)", 15, "3Campaigns.pdf — Hired Swords: Halfling Scout"],
  ["Warlock (HS)", 30, "3Campaigns.pdf — Hired Swords: Warlock"],
  ["Freelancer", 50, "3Campaigns.pdf — Hired Swords: Freelancer"],
  ["Elf Ranger", 40, "3Campaigns.pdf — Hired Swords: Elf Ranger"],
  ["Dwarf Troll Slayer (HS)", 25, "3Campaigns.pdf — Hired Swords: Dwarf Troll Slayer"],
  ["Clan Eshin Assassin", 80, "3Campaigns.pdf — Hired Swords: Clan Eshin Assassin"],
  ["Chameleon Skink", 70, "Lustria3.pdf — Hired Swords: Chameleon Skink"],
  ["Chameleon Skink Pathfinder", 60, "Lustria3.pdf — Hired Swords: Pathfinder"],
  ["Norse Shaman", 45, "Lustria3.pdf — Hired Swords: Norse Shaman"],
  ["Dark Elf Assassin", 70, "Lustria3.pdf — Hired Swords: Dark Elf Assassin"],
  ["Shadow Warrior (Hired Sword)", 35, "Lustria4.pdf — Hired Swords: Shadow Warrior"],
  ["Big Game Hunter", 40, "Lustria4.pdf — Hired Swords: Big Game Hunter"],
  ["Drenok", 70, "Lustria6.pdf — Drenok Johansen"],
  ["Beast Hunter", 35, "MordEMP2.pdf — Hired Swords: Beast Hunter"],
  ["Highwayman", 35, "MordEMP2.pdf — Hired Swords: Highwayman"],
  ["Roadwarden", 40, "MordEMP2.pdf — Hired Swords: Roadwarden"],
  ["Imperial Assassin", 40, "Showmethemoney.pdf — Imperial Assassin"],
  ["Tilean Marksman", 30, "Showmethemoney.pdf — Tilean Marksman"],
  ["Wolf Priest of Ulric", 60, "Wolf Priest of Ulric.docx — 60 gc to hire"],
];

exports.up = async function up(knex) {
  for (const [name, hireCost, source] of fees) {
    await knex("warrior_types").where({ name, category: "Hired Sword" }).update({ hire_cost: hireCost, hire_cost_source: source });
  }
};

exports.down = async function down(knex) {
  for (const [name] of fees) {
    await knex("warrior_types").where({ name, category: "Hired Sword" }).update({ hire_cost: null, hire_cost_source: null });
  }
};
