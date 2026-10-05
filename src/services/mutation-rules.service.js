const sourceReference = "2Warbands.pdf — Cult of the Possessed: Mutations (page 14)";
const mutationOptions = [
  { id: "daemon-soul", name: "Daemon soul", unitCost: 20, effectText: "A 4+ save against spells and prayers." },
  { id: "great-claw", name: "Great claw", unitCost: 50, effectText: "One arm cannot hold a weapon. Grants an additional close-combat attack at +1 Strength." },
  { id: "cloven-hoofs", name: "Cloven hoofs", unitCost: 40, effectText: "+1 Movement." },
  { id: "tentacle", name: "Tentacle", unitCost: 35, effectText: "Reduce a grappled close-combat opponent's Attacks by 1, to a minimum of 1; choose which attack is lost." },
  { id: "blackblood", name: "Blackblood", unitCost: 30, effectText: "Losing a wound in close combat inflicts a Strength 3 hit on each model in base contact. These hits cannot cause critical hits." },
  { id: "spines", name: "Spines", unitCost: 35, effectText: "At the start of each close-combat phase, each model in base contact takes a Strength 1 hit that cannot cause critical hits." },
  { id: "scorpion-tail", name: "Scorpion tail", unitCost: 40, effectText: "An additional Strength 5 tail attack each close-combat phase; use Strength 2 against poison-immune targets." },
  { id: "extra-arm", name: "Extra arm", unitCost: 40, effectText: "An extra arm can hold a one-handed weapon for an additional close-combat attack, or a shield or buckler. A Possessed gains an extra attack but still cannot use weapons." },
  { id: "hideous", name: "Hideous", unitCost: 40, effectText: "Causes fear." },
].map((option) => ({ ...option, sourceReference }));

function getMutationAccess(warbandName, warriorTypeName, role) {
  const eligible = warbandName === "Cult of the Possessed" && role === "Hero"
    && ["Mutants", "The Possessed"].includes(warriorTypeName);
  return { eligible, required: eligible && warriorTypeName === "Mutants", options: eligible ? mutationOptions : [] };
}

function priceMutations(mutationIds, access, requireMutation = access.required) {
  if (!Array.isArray(mutationIds) || mutationIds.some((id) => typeof id !== "string")) {
    return { error: "mutationIds must be an ordered array of mutation IDs." };
  }
  if (mutationIds.length && !access.eligible) {
    return { error: "Only Cult of the Possessed Mutants and Possessed can buy these mutations." };
  }
  if (requireMutation && mutationIds.length === 0) {
    return { error: "A Mutant must be recruited with at least one mutation." };
  }
  const entries = [];
  for (const [position, mutationId] of mutationIds.entries()) {
    const option = access.options.find((item) => item.id === mutationId);
    if (!option) return { error: "Unknown or unavailable mutation." };
    entries.push({ mutation_id: mutationId, position, unit_cost_paid: option.unitCost * (position === 0 ? 1 : 2) });
  }
  return { entries, totalCost: entries.reduce((total, entry) => total + entry.unit_cost_paid, 0) };
}

module.exports = { getMutationAccess, priceMutations, mutationOptions };
