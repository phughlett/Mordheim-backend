// Campaign gameplay sequence (3Campaigns.pdf "post battle sequence", Scenarios "pre-battle sequence").
const SCENARIOS = [
  "Defend the Find", "Skirmish", "Wyrdstone Hunt", "Breakthrough", "Street Fight",
  "Chance Encounter", "Hidden Treasure", "Occupy", "Surprise Attack",
];

const PRE_BATTLE_STEPS = [
  { label: "Choose scenario", description: "The player with the lowest warband rating rolls on the Scenario table, or the players agree on a scenario." },
  { label: "Old battle wounds", description: "Roll for warriors with old battle wounds to see whether they can take part." },
  { label: "Set up", description: "Set up the terrain and warbands according to the scenario rules." },
];

const POST_BATTLE_STEPS = [
  { label: "Injuries", description: "Determine the extent of injuries for each warrior who was out of action.", actions: ["remove"] },
  { label: "Allocate experience", description: "Heroes and Henchmen groups gain experience for surviving the battle, then roll advances.", actions: ["experience", "advance"] },
  { label: "Exploration", description: "Roll on the Exploration chart and record the income.", actions: ["treasury", "advance"] },
  { label: "Sell wyrdstone", description: "Sell wyrdstone. This can only be done once per post-battle sequence.", actions: ["treasury", "advance"] },
  { label: "Check veterans", description: "Roll to see how much Experience worth of veterans is available for hire.", actions: ["advance"] },
  { label: "Rare items", description: "Make rarity rolls and buy rare items. They go into the warband's stash.", actions: ["buy", "sell", "treasury", "advance"] },
  { label: "Dramatis Personae", description: "Look for Dramatis Personae and hire any you want.", actions: ["hire", "buy", "sell", "treasury", "advance"] },
  { label: "Recruit & buy", description: "Hire new recruits and buy common items. Newly hired recruits cannot buy rare items.", actions: ["hire", "buy", "sell", "remove", "treasury", "advance"] },
  { label: "Reallocate equipment", description: "Swap equipment between models as desired, provided they are eligible to use it.", actions: ["advance"] },
  { label: "Update rating", description: "Update your warband rating. You are now ready to fight again.", actions: ["advance"] },
];

// Turn sequence from 1Rules.pdf: each of your turns is split into four phases.
const BATTLE_PHASES = [
  { label: "Recovery", description: "Rally fleeing models (2D6 against Leadership), turn stunned models to knocked down, and let knocked down models stand up. Rallied models cannot move or shoot, but may cast spells." },
  { label: "Movement", description: "Move in order: 1. Charge! (declare charges first), 2. Compulsory moves (fleeing, frenzy, etc.), 3. Remaining moves for the rest of your warband." },
  { label: "Shooting", description: "Models with missile weapons or spells may shoot once. Models engaged in hand-to-hand combat cannot shoot." },
  { label: "Hand-to-hand combat", description: "All models in hand-to-hand combat fight, from both sides, regardless of whose turn it is. Strike order: chargers first, then by Initiative." },
];

const ROUT_REMINDER = " At the start of your turn, take a Rout test if a quarter (25%) or more of your warband is out of action.";

const SETUP_ACTIONS = ["hire", "buy", "sell", "remove", "warband", "treasury"];
const FREEBUILD_ACTIONS = [...SETUP_ACTIONS, "experience", "advance"];

const PHASE_LABELS = {
  setup: "Roster creation",
  pre_battle: "Pre-battle",
  battle: "Battle",
  post_battle: "Post-battle",
};

const ACTION_LABELS = {
  hire: "Hiring warriors",
  buy: "Buying equipment",
  sell: "Selling equipment",
  remove: "Removing warriors",
  experience: "Changing experience",
  advance: "Recording advances",
  treasury: "Changing the treasury",
  warband: "Changing the warband",
};

function getStage(roster) {
  const phase = roster.campaign_phase || "setup";
  const step = Number(roster.campaign_step) || 1;
  if (phase === "pre_battle") return { phase, step, ...PRE_BATTLE_STEPS[step - 1], actions: [] };
  if (phase === "post_battle") return { phase, step, ...POST_BATTLE_STEPS[step - 1] };
  if (phase === "battle") {
    const battlePhase = BATTLE_PHASES[step - 1] || BATTLE_PHASES[0];
    const turn = Number(roster.battle_turn) || 1;
    const description = step === 1 ? battlePhase.description + ROUT_REMINDER : battlePhase.description;
    return { phase, step: BATTLE_PHASES[step - 1] ? step : 1, label: battlePhase.label, description, turn, actions: [] };
  }
  return { phase, step: 1, label: "Build your roster", description: "Hire and equip your warriors within the starting gold crowns, then finalize the roster.", actions: SETUP_ACTIONS };
}

function getAllowedActions(roster) {
  if (!roster.campaign_id) return FREEBUILD_ACTIONS;
  return getStage(roster).actions.filter((action) => action !== "treasury");
}

function describeBlock(roster, action) {
  const stage = getStage(roster);
  const where = stage.phase === "post_battle" || stage.phase === "pre_battle"
    ? `${PHASE_LABELS[stage.phase]} step ${stage.step} (${stage.label})`
    : PHASE_LABELS[stage.phase];
  return `${ACTION_LABELS[action] || "This action"} is not available during ${where}.`;
}

function getNextLabel(roster) {
  const { phase, step } = getStage(roster);
  if (phase === "setup") return "Ready for Battle!";
  if (phase === "pre_battle") return step === PRE_BATTLE_STEPS.length ? "Begin battle" : "Next step";
  if (phase === "battle") return step === BATTLE_PHASES.length ? "Next turn" : "Next phase";
  return step === POST_BATTLE_STEPS.length ? "Finish & ready for next battle" : "Next step";
}

function toCampaign(roster) {
  const stage = getStage(roster);
  return {
    phase: stage.phase,
    phaseLabel: PHASE_LABELS[stage.phase],
    step: stage.step,
    stepLabel: stage.label,
    stepDescription: stage.description,
    battlesFought: Number(roster.battles_fought) || 0,
    scenario: roster.scenario || null,
    scenarios: SCENARIOS,
    preBattleSteps: PRE_BATTLE_STEPS.map((entry) => entry.label),
    battleTurn: stage.phase === "battle" ? stage.turn : null,
    battlePhases: BATTLE_PHASES.map((entry) => entry.label),
    postBattleSteps: POST_BATTLE_STEPS.map((entry) => entry.label),
    allowedActions: getAllowedActions(roster),
    nextLabel: getNextLabel(roster),
    canReopen: stage.phase === "pre_battle" && stage.step === 1 && Number(roster.battles_fought || 0) === 0,
  };
}

// Returns { error } or { updates } for moving the roster to the next stage of the sequence.
function advanceCampaign(roster, { scenario, heroCount = 0, endBattle = false } = {}) {
  const { phase, step } = getStage(roster);
  if (phase === "setup") {
    if (!roster.warband_id) return { error: "Choose a warband before finalizing the roster." };
    if (heroCount < 1) return { error: "A roster needs at least one Hero (the leader) before it can be finalized." };
    return { updates: { campaign_phase: "pre_battle", campaign_step: 1, scenario: null } };
  }
  if (phase === "pre_battle") {
    if (step === 1) {
      const chosen = scenario ?? roster.scenario;
      if (!SCENARIOS.includes(chosen)) return { error: "Choose a scenario before continuing." };
      return { updates: { campaign_step: 2, scenario: chosen } };
    }
    if (step < PRE_BATTLE_STEPS.length) return { updates: { campaign_step: step + 1 } };
    return { updates: { campaign_phase: "battle", campaign_step: 1, battle_turn: 1 } };
  }
  if (phase === "battle") {
    if (endBattle) return { updates: { campaign_phase: "post_battle", campaign_step: 1, battle_turn: 1 } };
    if (step < BATTLE_PHASES.length) return { updates: { campaign_step: step + 1 } };
    return { updates: { campaign_step: 1, battle_turn: (Number(roster.battle_turn) || 1) + 1 } };
  }
  if (step < POST_BATTLE_STEPS.length) return { updates: { campaign_step: step + 1 } };
  return {
    updates: {
      campaign_phase: "pre_battle",
      campaign_step: 1,
      scenario: null,
      battles_fought: Number(roster.battles_fought || 0) + 1,
    },
  };
}

function reopenCampaign(roster) {
  if (!toCampaign(roster).canReopen) return { error: "The roster can only be reopened before the first battle begins." };
  return { updates: { campaign_phase: "setup", campaign_step: 1, scenario: null } };
}

module.exports = { PRE_BATTLE_STEPS, SCENARIOS, advanceCampaign, describeBlock, getAllowedActions, reopenCampaign, toCampaign };
