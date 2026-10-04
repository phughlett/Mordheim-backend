const startingExperienceByHero = {
  "Mercenary Captain": 20,
  "Champions (Mercenaries & Amazons)": 8,
  Priestess: 20,
  "Totem Warriors": 8,
  "Captain (Averlander)": 20,
  Bergjaeger: 4,
  Emissary: 20,
  Officer: 12,
  "Dragon Monks": 15,
  "Beastmen Chieftain": 20,
  "Beastmen Shaman": 11,
  Bestigors: 8,
  Centigors: 8,
  "Questing Knight": 20,
  "Knight Errant": 8,
  "Magister": 20,
  "The Possessed": 8,
  "High Born": 20,
  Fellblades: 12,
  "Dark Elf Sorceress (Dark Elves)": 12,
  "Beast Master (Dark Elves)": 8,
  "Druzhina Captain": 20,
  "Bear Tamer": 10,
  Esaul: 8,
  "Skink Priest": 20,
  "Saurus Totem Warrior": 11,
  "Skink Great Crests": 8,
  "Marauder Chieftain": 20,
  Seer: 8,
  Champion: 8,
  Condemned: 8,
  "Big Boss": 17,
  "Shaman (Night Goblins)": 10,
  "Bosses (Night Goblins)": 6,
  Jarl: 20,
  Berserkers: 11,
  Wulfin: 11,
  "Orc Boss": 20,
  "Orc Shaman": 10,
  "Orc Big 'Uns": 15,
  Elder: 20,
  "Blood Brothers": 12,
  "Priest of Taal": 12,
  "Pirate Captain": 20,
  "Ship's Mates": 8,
  "Pit King": 20,
  "Pit Veterans": 8,
  "Dwarf Troll Slayer (Pit Fighter)": 8,
  "Shadow Master": 20,
  "Shadow Walker": 12,
  "Shadow Weaver": 12,
  "Sigmarite Matriarch": 20,
  "Sister Superior": 8,
  "Assassin Adept": 20,
  "Eshin Sorcerer": 8,
  "Black Skaven": 8,
  Vampire: 20,
  "Necromancer (Lahmia & Undead))": 8,
  "Witch Hunter Captain": 20,
  "Witch Hunters": 8,
  "Warrior Priest": 12,
  "Carnival Master": 20,
  "Brutes (Carnival of Chaos)": 8,
};

exports.up = async function up(knex) {
  for (const [name, startingExperience] of Object.entries(startingExperienceByHero)) {
    const updated = await knex("warrior_types")
      .where({ name, category: "Hero" })
      .update({ starting_experience: startingExperience });
    if (!updated) throw new Error(`Starting experience references unknown Hero type: ${name}`);
  }
};

exports.down = async function down(knex) {
  for (const name of Object.keys(startingExperienceByHero)) {
    await knex("warrior_types").where({ name, category: "Hero" }).update({ starting_experience: 0 });
  }
};