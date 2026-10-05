function createCatalogRepository(db) {
  return {
    checkConnection() {
      return db.raw("select 1");
    },

    listWarbands() {
      return db("warbands")
        .where({ is_available: true })
        .select("id", "name", "source_reference", "max_heroes", "max_members", "limits_source_reference", "limits_rule")
        .orderBy("name", "asc");
    },

    findWarband(id) {
      return db("warbands").where({ id, is_available: true }).first("id", "name");
    },

    listWarriorTypes(warbandId, { category, includeUnavailable }) {
      const query = db("warband_warrior_types as eligibility")
        .join("warrior_types", "warrior_types.id", "eligibility.warrior_type_id")
        .where("eligibility.warband_id", warbandId);

      if (!includeUnavailable) {
        query.whereIn("eligibility.availability", ["allowed", "conditional"]);
      }
      if (category) query.where("warrior_types.category", category);

      return query.select({
        id: "warrior_types.id",
        name: "warrior_types.name",
        category: "warrior_types.category",
        stats: "warrior_types.stats",
        startingExperience: "warrior_types.starting_experience",
        startingEquipment: "warrior_types.starting_equipment",
        equipmentChoices: "warrior_types.equipment_choices",
        canGainExperience: "warrior_types.can_gain_experience",
        experienceRule: "warrior_types.experience_rule",
        large: "warrior_types.large",
        memberLimitBonus: "warrior_types.member_limit_bonus",
        hireCost: "warrior_types.hire_cost",
        hireCostSource: "warrior_types.hire_cost_source",
        maxCount: "eligibility.max_count",
        maxCountReferenceTypes: "eligibility.max_count_reference_types",
        maxCountMultiplier: "eligibility.max_count_multiplier",
        maxCountRule: "eligibility.rule_text",
        promotionEligibility: "warrior_types.promotion_eligibility",
        promotionRule: "warrior_types.promotion_rule",
        availability: "eligibility.availability",
        sourceReference: "eligibility.source_reference",
        ruleText: "eligibility.rule_text",
        conditionText: "eligibility.condition_text",
        sheetOrder: "eligibility.sheet_order",
      }).orderBy("warrior_types.category").orderBy("eligibility.sheet_order").orderBy("warrior_types.name");
    },
  };
}

module.exports = { createCatalogRepository };
