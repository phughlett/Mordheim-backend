const defaultPurchaseRules = {
  enabled: false,
  skillsEnabled: true,
  skillCost: 40,
  stats: Object.fromEntries(Object.entries({
    M: [15, 15], WS: [15, 15], BS: [15, 15], S: [25, 35], T: [30, 45],
    W: [20, 30], I: [10, 10], A: [25, 35], Ld: [15, 15],
  }).map(([stat, [firstCost, additionalCost]]) => [stat, { firstCost, additionalCost, maxIncreases: null }])),
};

function validatePurchaseRules(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.enabled !== "boolean") {
    return { error: "Stat purchase rules require an enabled boolean." };
  }
  const validPrice = (number) => Number.isSafeInteger(number) && number >= 0 && number <= 100000;
  if (value.skillsEnabled !== undefined && typeof value.skillsEnabled !== "boolean") {
    return { error: "Skill purchase rules require a skillsEnabled boolean." };
  }
  if (!validPrice(value.skillCost)) return { error: "Purchased skill cost must be a whole number from 0 to 100000." };
  if (!value.stats || typeof value.stats !== "object" || Array.isArray(value.stats)
    || Object.keys(value.stats).length !== Object.keys(defaultPurchaseRules.stats).length) {
    return { error: "Purchase rules must specify all nine characteristics." };
  }
  const stats = {};
  for (const stat of Object.keys(defaultPurchaseRules.stats)) {
    const rule = value.stats[stat];
    if (!rule || !validPrice(rule.firstCost) || !validPrice(rule.additionalCost)
      || (rule.maxIncreases !== null && (!Number.isSafeInteger(rule.maxIncreases) || rule.maxIncreases < 0 || rule.maxIncreases > 21))) {
      return { error: `${stat}: prices must be whole numbers from 0 to 100000; maximum increases must be null or a whole number from 0 to 21.` };
    }
    stats[stat] = { firstCost: rule.firstCost, additionalCost: rule.additionalCost, maxIncreases: rule.maxIncreases };
  }
  return { rules: { enabled: value.enabled, skillsEnabled: value.skillsEnabled ?? true, skillCost: value.skillCost, stats } };
}

function canPurchaseAdvances(warrior, rules) {
  return Boolean(warrior.campaignId && rules.enabled && warrior.role === "Hero"
    && warrior.canGainExperience !== false && warrior.phase === "setup" && Number(warrior.battlesFought) === 0);
}

module.exports = { defaultPurchaseRules, validatePurchaseRules, canPurchaseAdvances };
