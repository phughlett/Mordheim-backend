const { getAdvanceThresholds, getAdvancesEarned, getStatMaximumProfile, racialMaximums } = require("../services/advancement-rules.service");
const { canPurchaseAdvances, defaultPurchaseRules } = require("../services/advance-purchase-rules.service");

function createAdvancePurchaseRepository(db, { getSkillEligibilityContext, loadAvailableSkills, isSkillEligible }) {
  function warriorQuery(query, warriorId) {
    return query("warriors as warrior")
      .join("rosters as roster", "roster.id", "warrior.roster_id")
      .leftJoin("campaigns as campaign", "campaign.id", "roster.campaign_id")
      .leftJoin("warrior_types as type", "type.id", "warrior.warrior_type_id")
      .leftJoin("warbands as warband", "warband.id", "roster.warband_id")
      .where("warrior.id", warriorId)
      .select({
        id: "warrior.id", role: "warrior.role", stats: "warrior.stats", experience: "warrior.experience",
        baseline: "warrior.advance_baseline", initialStats: "type.stats", typeName: "type.name",
        canGainExperience: "type.can_gain_experience", warbandName: "warband.name",
        campaignId: "roster.campaign_id", phase: "roster.campaign_phase", battlesFought: "roster.battles_fought",
        rosterId: "roster.id", treasury: "roster.treasury", rules: "campaign.advance_purchase_rules",
      });
  }

  async function state(query, warrior) {
    const rules = warrior.rules || defaultPurchaseRules;
    const history = await query("warrior_advances").where({ warrior_id: warrior.id, advance_table: "Hero" }).whereNull("consumed_at");
    const paid = history.filter((advance) => advance.purchase_cost !== null);
    const statPurchases = paid.filter((advance) => advance.result === "stat_increase");
    const skillsPurchased = paid.filter((advance) => advance.result === "new_skill").length;
    const nextExperience = getAdvanceThresholds("Hero").find((threshold) => threshold > Number(warrior.experience)) ?? null;
    const pending = getAdvancesEarned("Hero", warrior.experience) > Number(warrior.baseline) + history.length;
    const enabled = canPurchaseAdvances(warrior, rules);
    const canPurchase = enabled && !pending && nextExperience !== null;
    const maximumStats = racialMaximums[getStatMaximumProfile(warrior.warbandName, warrior.typeName)] || null;
    const stats = Object.keys(defaultPurchaseRules.stats).map((stat) => {
      const rule = rules.stats[stat];
      const count = statPurchases.filter((advance) => advance.stat === stat).length;
      const current = Number(warrior.stats?.[stat]);
      return {
        stat, cost: count === 0 ? rule.firstCost : rule.additionalCost, purchasedCount: count,
        maxIncreases: rule.maxIncreases, racialMaximum: maximumStats?.[stat] ?? null,
        available: canPurchase && Number.isFinite(current) && current >= 0
          && (maximumStats?.[stat] === undefined || current < maximumStats[stat])
          && (rule.maxIncreases === null || count < rule.maxIncreases),
      };
    });
    let skills = [];
    if (canPurchase && statPurchases.length > skillsPurchased) {
      const context = await getSkillEligibilityContext(query, warrior.id);
      const known = new Set(await query("warrior_skills").where({ warrior_id: warrior.id }).pluck("skill_id"));
      skills = (await loadAvailableSkills(query, context)).filter((skill) => !known.has(skill.id));
    }
    return {
      enabled, canPurchase, pendingAdvances: pending, nextExperience, stats,
      skillCost: rules.skillCost, skillAllowance: statPurchases.length - skillsPurchased, availableSkills: skills,
    };
  }

  return {
    async getAdvancePurchaseOptions(warriorId) {
      const warrior = await warriorQuery(db, warriorId).first();
      return warrior ? state(db, warrior) : null;
    },

    async purchaseWarriorAdvance(warriorId, { stat, skillId }) {
      return db.transaction(async (transaction) => {
        const warrior = await warriorQuery(transaction, warriorId).forUpdate("warrior", "roster").first();
        if (!warrior) return { missingWarrior: true };
        const options = await state(transaction, warrior);
        if (!options.enabled) return { error: "Paid advancements are enabled only for eligible Heroes during initial campaign roster creation." };
        if (options.pendingAdvances) return { error: "Resolve pending experience advances before purchasing an advancement." };
        if (!options.canPurchase) return { error: "This Hero has reached the experience-track maximum." };
        let cost;
        let learnedSkillId = null;
        if (stat !== undefined) {
          const choice = options.stats.find((item) => item.stat === stat && item.available);
          if (!choice) return { error: "This characteristic is at its purchase cap, racial maximum, or is unavailable." };
          cost = choice.cost;
        } else {
          if (options.skillAllowance < 1) return { error: "Each purchased characteristic increase allows one purchased skill." };
          const context = await getSkillEligibilityContext(transaction, warriorId);
          const skill = await transaction("skills").where({ id: skillId }).first();
          if (!skill || !isSkillEligible(context, skill) || !options.availableSkills.some((item) => item.id === skillId)) {
            return { error: "Choose an unknown skill normally available to this Hero." };
          }
          cost = options.skillCost;
        }
        if (cost > Number(warrior.treasury)) return { error: `This purchase costs ${cost} GC, but the roster has ${warrior.treasury} GC.` };
        const stats = { ...warrior.stats };
        if (stat !== undefined) stats[stat] = String(Number(stats[stat]) + 1);
        else {
          const [skill] = await transaction("warrior_skills").insert({ warrior_id: warriorId, skill_id: skillId }).returning("id");
          learnedSkillId = skill.id;
        }
        await transaction("warrior_advances").insert({
          warrior_id: warriorId, advance_table: "Hero", experience_threshold: options.nextExperience,
          mode: "manual", result: stat !== undefined ? "stat_increase" : "new_skill", stat: stat ?? null,
          learned_skill_id: learnedSkillId, purchase_cost: cost, experience_before_purchase: Number(warrior.experience),
        });
        await transaction("warriors").where({ id: warriorId }).update({ stats, experience: options.nextExperience, updated_at: new Date() });
        await transaction("rosters").where({ id: warrior.rosterId }).update({ treasury: Number(warrior.treasury) - cost, updated_at: new Date() });
        return { purchased: true };
      });
    },

    async refundPurchasedAdvance(warriorId, advanceId) {
      return db.transaction(async (transaction) => {
        const warrior = await warriorQuery(transaction, warriorId).forUpdate("warrior", "roster").first();
        if (!warrior) return { missingWarrior: true };
        const advance = await transaction("warrior_advances").where({ id: advanceId, warrior_id: warriorId }).first();
        if (!advance) return { missingAdvance: true };
        if (advance.purchase_cost === null) return { notPurchased: true };
        if (!canPurchaseAdvances(warrior, warrior.rules || defaultPurchaseRules)) {
          return { purchaseError: "Purchased advances can only be refunded during initial roster creation." };
        }
        const latest = await transaction("warrior_advances").where({ warrior_id: warriorId, advance_table: "Hero" })
          .orderBy("experience_threshold", "desc").orderBy("created_at", "desc").first("id");
        if (latest?.id !== advance.id || Number(warrior.experience) !== advance.experience_threshold || advance.consumed_at) {
          return { purchaseError: "Undo later advances first; purchased experience cannot be reversed after subsequent experience gains." };
        }
        const stats = { ...warrior.stats };
        if (advance.stat) {
          const current = Number(stats[advance.stat]);
          if (!Number.isFinite(current) || current <= Number(warrior.initialStats?.[advance.stat])) {
            return { purchaseError: "This purchased characteristic cannot be safely reversed." };
          }
          stats[advance.stat] = String(current - 1);
        }
        await transaction("warrior_advances").where({ id: advanceId }).delete();
        if (advance.learned_skill_id) await transaction("warrior_skills").where({ id: advance.learned_skill_id, warrior_id: warriorId }).delete();
        await transaction("warriors").where({ id: warriorId }).update({
          stats, experience: advance.experience_before_purchase, updated_at: new Date(),
        });
        await transaction("rosters").where({ id: warrior.rosterId }).update({
          treasury: Number(warrior.treasury) + advance.purchase_cost, updated_at: new Date(),
        });
        return { deleted: true, refunded: advance.purchase_cost };
      });
    },
  };
}

module.exports = { createAdvancePurchaseRepository };
