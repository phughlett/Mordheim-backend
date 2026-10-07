const { diceFor, fail } = require("./trading-rules.service");

const mapTypes = [
  { id: "fake", name: "Fake", rolls: [1], effect: "Worthless map: your opponent chooses your next scenario." },
  { id: "vague", name: "Vague", rolls: [2, 3], effect: "You may reroll one die in your next exploration phase. Keep the new result." },
  { id: "catacomb", name: "Catacomb map", rolls: [4], effect: "You choose the scenario for your next battle." },
  { id: "accurate", name: "Accurate", rolls: [5], effect: "You may reroll up to three dice in your next exploration phase. Keep the new results." },
  { id: "master", name: "Master map", rolls: [6], effect: "In every exploration phase, you may reroll one die if the Hero carrying this map was not taken out of action in that battle." },
];

function resolveMaps(selection, quantity) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) fail("Choose a Mordheim map type or a map D6 roll mode.", 400);
  if (selection.mode === "choose") {
    if (!mapTypes.some((type) => type.id === selection.type)) fail("Choose one of the five Mordheim map types.", 400);
    return Array.from({ length: quantity }, () => ({ type: selection.type, mode: "choose", roll: null }));
  }
  return diceFor(selection.mode, selection.dice, quantity).map((roll) => ({
    type: mapTypes.find((type) => type.rolls.includes(roll)).id, mode: selection.mode, roll,
  }));
}

function describeMap(result) {
  if (!result) return {};
  const type = mapTypes.find((entry) => entry.id === result.type);
  if (!type) throw new Error("Invalid persisted Mordheim map type.");
  return { mapResult: result, name: `Mordheim Map (${type.name})`, description: `${type.effect} Resolve these effects at the tabletop; they are not applied automatically.` };
}

module.exports = { mapTypes, resolveMaps, describeMap };
