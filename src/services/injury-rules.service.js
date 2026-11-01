const { randomInt } = require("node:crypto");
const heroes = require("../../hero-injuries.json");
const henchmen = require("../../henchman-injuries.json");
const { fail, integer } = require("./trading-rules.service");

const psychologyRules = {
  frenzy: {
    gameplayName: "Frenzy",
    gameplayRules: "Must charge an enemy within charge range; check after declaring charges. In hand-to-hand combat, double the Attacks characteristic, then add the normal +1 Attack for a second hand weapon (do not double that bonus). While within charge range, ignore other psychology tests. Being knocked down or stunned ends Frenzy for the rest of that battle; the permanent injury still applies in future battles.",
  },
  stupidity: {
    gameplayName: "Stupidity",
    gameplayRules: "At the start of each of this warrior's turns, test Leadership on 2D6: a total at or below Leadership passes and permits normal actions. On failure, the warrior cannot cast spells or attack in hand-to-hand combat; enemies still roll to hit normally. If not in combat, roll D6: 1-3 move straight ahead at half Movement, without charging or shooting; stop 1 inch from enemies or at obstacles (a sheer drop can cause a fall). On 4-6, take no actions. The result lasts until the next turn's test.",
  },
  "immune-to-fear": {
    gameplayName: "Immune to fear",
    gameplayRules: "This warrior does not take Fear tests when charging or being charged by fear-causing enemies.",
  },
  "causes-fear": {
    gameplayName: "Causes fear",
    gameplayRules: "This warrior ignores Fear tests. An enemy charged by this warrior tests Leadership on 2D6 when the charge is declared and in range; failure means it needs 6s to hit in that round of combat. An enemy attempting to charge this warrior must pass a Leadership test or remain stationary for that turn as a failed charge. Fear-causing enemies ignore these tests.",
  },
};

function withInjuryGameplayRules(effect) {
  const rules = effect.type === "psychology" ? psychologyRules[effect.rule]
    : effect.type === "hatred" ? {
      gameplayName: "Hatred",
      gameplayRules: "Against the hated target, re-roll missed hand-to-hand attacks in the first turn of each combat only. Fight normally in later turns of that combat.",
    } : null;
  return rules ? { ...effect, ...rules, sourceReference: "1Rules.pdf - Leadership & psychology, p. 23" } : effect;
}

function retainedInjuryResult(result) {
  const children = (result.children ?? []).map(retainedInjuryResult).filter(Boolean);
  const effects = (result.effects ?? []).filter((effect) => effect.type !== "resolve-combat").map(withInjuryGameplayRules);
  if (!result.pending && effects.length === 0 && children.length === 0) return null;
  return { ...result, effects, children };
}

function individualInjuryResults(result) {
  const children = (result.children ?? []).flatMap(individualInjuryResults);
  const own = retainedInjuryResult({ ...result, children: [] });
  return own ? [...children, own] : children;
}

function activeInjuryConditions(conditions, roster) {
  return (conditions ?? []).filter((condition) =>
    (condition.type !== "miss-games" || condition.untilBattle > Number(roster.battles_fought))
    && (condition.type !== "old-battle-check" || condition.battle === Number(roster.battles_fought) + 1))
    .map(withInjuryGameplayRules);
}

const hiredSwordRule = "If a Hired Sword goes out of action during the game, roll for his injuries as you would roll for a Henchman after a battle (i.e, 1-2 = Lost; 3-6 = Survives).";
const lantern = {
  ...henchmen, id: "goblin-lantern-bearer-injuries", name: "Goblin Lantern Bearer injuries",
  ruleText: "1 – Lost\n2-6 – Survives.",
  source: { title: "Fanatic Online 89", file: "https://broheim.net/downloads/fo/89RunnersUp.pdf",
    pages: [2], section: "Goblin Lantern Bearer", grade: "2a" },
  applicationNote: "Source-specific post-battle exception: lost on 1; survives on 2-6.",
  results: henchmen.results.map((result, index) => ({ ...result, ruleText: index === 0 ? "1 – Lost" : "2-6 – Survives.", rolls: index === 0 ? [1] : [2, 3, 4, 5, 6] })),
};

function tableFor(member) {
  if (member.role === "Hero") return heroes;
  if (member.role !== "Hired Sword") return henchmen;
  if (/^Goblin Lantern Bearer$/i.test(member.typeName ?? member.type ?? "")) return lantern;
  return { ...henchmen, name: "Hired Sword injuries", ruleText: hiredSwordRule,
    source: { ...henchmen.source, pages: [105], section: "Hired Swords - Injuries" } };
}

function canAddInjury(roster) {
  return roster.campaign_id
    ? roster.campaign_phase === "post_battle" && roster.campaign_step === 1
    : Number(roster.battles_fought) >= 1;
}

function battleNumber(roster) {
  return Number(roster.battles_fought) + (roster.campaign_id ? 1 : 0);
}

function resolveInjury(table, selection, mode, dice = () => randomInt(1, 7), depth = 0, excluded = []) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) fail("Supply an injury selection.", 400);
  if (depth > 2) fail("Too many nested injury results.", 400);
  const allowed = table.results.filter((result) => !excluded.includes(result.id));
  const possible = allowed.flatMap((result) => result.rolls);
  let roll = null;
  let definition;
  if (mode === "simulated") {
    do { roll = table.roll.type === "D66" ? dice() * 10 + dice() : dice(); } while (!possible.includes(roll));
    definition = allowed.find((result) => result.rolls.includes(roll));
  } else {
    definition = allowed.find((result) => result.id === selection.resultId);
    if (!definition) fail("Choose a valid injury result.", 400);
  }
  const result = { id: definition.id, name: definition.name, ruleText: definition.ruleText, roll,
    effects: [...definition.effects], children: [] };
  const secondary = definition.secondaryRoll;
  if (secondary) {
    const value = mode === "simulated" ? secondary.type === "D3" ? Math.ceil(dice() / 2) : dice() : selection.secondaryRoll;
    if (!integer(value, 1, secondary.type === "D3" ? 3 : 6)) fail(`Choose the ${secondary.type} secondary result.`, 400);
    result.secondaryRoll = value;
    if (secondary.results) {
      const branch = secondary.results.find((branch) => branch.rolls.includes(value));
      result.effects.push(...branch.effects);
      result.secondaryText = branch.ruleText;
      result.secondaryName = branch.name;
    } else if (definition.id === "multiple-injuries") {
      if (mode === "manual" && (!Array.isArray(selection.injuries) || selection.injuries.length !== value)) {
        fail("Select each of the multiple injuries.", 400);
      }
      for (let index = 0; index < value; index++) {
        result.children.push(resolveInjury(heroes, selection.injuries?.[index] ?? {}, mode, dice, depth + 1,
          ["dead", "captured", "multiple-injuries"]));
      }
      result.effects = [];
    } else if (definition.id === "deep-wound") {
      result.effects.push({ type: "miss-games", count: value, cannotPerformActivities: true });
    }
  }
  if (definition.id === "blinded-in-one-eye") {
    if (selection.eye !== undefined && !["left", "right"].includes(selection.eye)) fail("Choose left or right eye.", 400);
    result.eye = selection.eye ?? (dice() <= 3 ? "left" : "right");
  }
  if (definition.id === "bitter-enmity") {
    if (selection.hatredTarget !== undefined && (typeof selection.hatredTarget !== "string" || selection.hatredTarget.length > 300)) fail("Hatred target must be text up to 300 characters.", 400);
    result.hatredTarget = selection.hatredTarget ?? "";
  }
  if (definition.id === "sold-to-the-pits") {
    if (selection.pitOutcome === undefined) result.pending = true;
    else {
      if (!["won", "lost"].includes(selection.pitOutcome)) fail("Choose whether the pit fight was won or lost.", 400);
      result.pitOutcome = selection.pitOutcome;
      result.effects = [];
      if (selection.pitOutcome === "won") {
        result.effects.push({ type: "gold-crowns", recipient: "warrior-warband", value: 50 },
          { type: "experience", recipient: "warrior", value: 2 });
      } else {
        result.children.push(resolveInjury(heroes, selection.pitInjury ?? {}, mode, dice, depth + 1,
          heroes.results.filter((entry) => entry.rolls[0] > 35).map((entry) => entry.id)));
        result.effects.push({ type: "lose-equipment", scope: "carried-weapons-and-armour" });
      }
    }
  }
  if (definition.id === "captured") {
    result.pending = true;
    if (selection.captureOutcome !== undefined) {
      if (!["ransomed", "exchanged", "removed"].includes(selection.captureOutcome)) fail("Choose a valid captive outcome.", 400);
      result.captureOutcome = selection.captureOutcome;
      result.pending = false;
      result.effects = selection.captureOutcome === "removed" ? [{ type: "remove-warrior", reason: "captivity" }] : [];
    }
  }
  result.effects = result.effects.map(withInjuryGameplayRules);
  return result;
}

function injuryAvailability(member, roster) {
  const nextBattle = Number(roster.battles_fought) + 1;
  const conditions = member.injury_conditions ?? [];
  const reasons = conditions.filter((condition) =>
    condition.type === "captured" || condition.type === "pit-fight-pending"
    || (condition.type === "miss-games" && nextBattle <= condition.untilBattle)
    || (condition.type === "old-battle-check" && condition.battle === nextBattle && condition.roll === 1));
  const needsOldWoundRoll = reasons.length === 0 && conditions.some((condition) => condition.type === "pre-battle-check")
    && !conditions.some((condition) => condition.type === "old-battle-check" && condition.battle === nextBattle);
  return { available: reasons.length === 0, reasons, needsOldWoundRoll };
}

module.exports = { heroes, henchmen, tableFor, canAddInjury, battleNumber, resolveInjury, injuryAvailability,
  retainedInjuryResult, individualInjuryResults, activeInjuryConditions, withInjuryGameplayRules };
