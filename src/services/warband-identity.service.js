const mercenarySects = ["Reikland Mercenaries", "Middenheim Mercenaries", "Marienburg Mercenaries"];
const warbandTitles = { Orc: "Orc Mob", Ostlanders: "Osterlander Mercenaries", Amazons: "Amazons (Mordheim)" };

function warbandTitle(name) {
  return warbandTitles[name] ?? name;
}

function tradingWarbandNames(name) {
  const aliases = {
    "Reikland Mercenaries": ["Reiklanders", "Mercenaries"],
    "Middenheim Mercenaries": ["Middenheimers", "Mercenaries"],
    "Marienburg Mercenaries": ["Marienburgers", "Mercenaries"],
  };
  return [name, ...(aliases[name] ?? [])];
}

module.exports = { mercenarySects, warbandTitles, warbandTitle, tradingWarbandNames };
