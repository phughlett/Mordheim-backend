const { randomInt } = require("node:crypto");
const {
  getAdvanceTable,
  getAdvanceThresholds,
  getAdvancesEarned,
  getAvailableStatIncreases,
  getStatMaximumProfile,
  racialMaximums,
  rollHeroAdvance,
  rollHenchmanAdvance,
} = require("../services/advancement-rules.service");

const tomeIneligibleWarbands = new Set(["Witch Hunters", "Sisters of Sigmar", "Undead", "Carnival of Chaos"]);
const { getMutationAccess, priceMutations, mutationOptions } = require("../services/mutation-rules.service");
const { createAdvancePurchaseRepository } = require("./advance-purchase.repository");

// Builds a compact `stats` object for an equipment row (from a query joined against
// weapon_profiles / armour_profiles / weapon_material_modifiers / weapon_poisons), or
// null if the equipment item has no mapped Phase 2 stat profile.
function buildEquipmentStats(row) {
  const weapon = row.weaponProfileName
    ? {
      name: row.weaponProfileName,
      weaponType: row.weaponType,
      rangeText: row.weaponRangeText,
      strengthModifier: row.weaponStrengthModifier,
      specialRules: row.weaponSpecialRules || [],
      notes: row.weaponNotes,
      sourceReference: row.weaponSourceReference,
    }
    : null;
  const armour = row.armourProfileName
    ? {
      name: row.armourProfileName,
      itemType: row.armourItemType,
      saveText: row.armourSaveText,
      movementPenalty: row.armourMovementPenalty,
      specialRules: row.armourSpecialRules || [],
      notes: row.armourNotes,
      sourceReference: row.armourSourceReference,
    }
    : null;
  const materialModifier = row.materialModifierName
    ? {
      name: row.materialModifierName,
      effectText: row.materialModifierEffectText,
      costMultiplier: row.materialModifierCostMultiplier,
      sourceReference: row.materialModifierSourceReference,
    }
    : null;
  const poison = row.weaponPoisonName
    ? {
      name: row.weaponPoisonName,
      effectText: row.weaponPoisonEffectText,
      sourceReference: row.weaponPoisonSourceReference,
    }
    : null;
  if (!weapon && !armour && !materialModifier && !poison) return null;
  return { weapon, armour, materialModifier, poison };
}

function createRosterRepository(db) {
  async function updateWarriorValues(transaction, id, values) {
    return transaction("warriors").where({ id }).update({ ...values, updated_at: new Date() });
  }

  async function addHiredSwordStartingGear(transaction, warrior) {
    if (!warrior.warrior_type_id) return;
    const query = transaction("hired_sword_starting_gear").where({ warrior_type_id: warrior.warrior_type_id });
    if (warrior.equipment_choice_id) {
      query.andWhere((builder) => builder.whereNull("equipment_choice_id").orWhere("equipment_choice_id", warrior.equipment_choice_id));
    } else {
      query.whereNull("equipment_choice_id");
    }
    const gear = await query.select("equipment_option_id", "quantity");
    if (!gear.length) return;

    const existing = await transaction("warrior_inventory")
      .where({ warrior_id: warrior.id, model_index: -1 })
      .select("equipment_option_id");
    const existingIds = new Set(existing.map((item) => item.equipment_option_id));
    const startingItems = gear
      .filter((item) => !existingIds.has(item.equipment_option_id))
      .map((item) => ({
        warrior_id: warrior.id,
        equipment_option_id: item.equipment_option_id,
        model_index: -1,
        quantity: item.quantity,
        unit_cost_paid: 0,
      }));
    if (startingItems.length) await transaction("warrior_inventory").insert(startingItems);
  }

  async function addWarriorTypeStartingSkills(transaction, warrior) {
    if (!warrior.warrior_type_id) return;
    const startingSkills = await transaction("skills")
      .where({ warrior_type_id: warrior.warrior_type_id, is_starting: true })
      .select("id");
    if (!startingSkills.length) return;

    const existingSkills = await transaction("warrior_skills")
      .where({ warrior_id: warrior.id })
      .whereIn("skill_id", startingSkills.map((skill) => skill.id))
      .pluck("skill_id");
    const existingIds = new Set(existingSkills);
    const newStartingSkills = startingSkills
      .filter((skill) => !existingIds.has(skill.id))
      .map((skill) => ({
        warrior_id: warrior.id,
        skill_id: skill.id,
        is_starting: true,
      }));
    if (newStartingSkills.length) await transaction("warrior_skills").insert(newStartingSkills);
  }

  async function addFreeStartingEquipment(transaction, warrior, warbandId) {
    if (warrior.role === "Hired Sword") return addHiredSwordStartingGear(transaction, warrior);
    if (!warrior.warrior_type_id || !warbandId) return;
    const freeOptions = await transaction("warrior_equipment_lists as permission")
      .join("equipment_options as option", function joinOption() {
        this.on("option.warband_id", "permission.warband_id").andOn("option.list_key", "permission.list_key");
      })
      .join("warrior_types as warrior_type", "warrior_type.id", "permission.warrior_type_id")
      .where({
        "permission.warband_id": warbandId,
        "permission.warrior_type_id": warrior.warrior_type_id,
        "option.first_free": true,
      })
      .whereRaw("permission.allowed_categories @> jsonb_build_array(option.category)")
      .where((query) => query.whereNull("option.allowed_warrior_type_names")
        .orWhereRaw("option.allowed_warrior_type_names @> jsonb_build_array(warrior_type.name::text)"))
      .select("option.id as equipment_option_id");
    if (!freeOptions.length) return;

    const modelCount = warrior.role === "Henchman" ? warrior.group_size || 1 : 1;
    const existing = await transaction("warrior_inventory")
      .where({ warrior_id: warrior.id })
      .select("equipment_option_id", "model_index");
    const existingItems = new Set(existing.map((item) => `${item.equipment_option_id}/${item.model_index}`));
    const startingItems = [];
    for (const option of freeOptions) {
      for (let modelIndex = 0; modelIndex < modelCount; modelIndex += 1) {
        const key = `${option.equipment_option_id}/${modelIndex}`;
        if (existingItems.has(key)) continue;
        existingItems.add(key);
        startingItems.push({
          warrior_id: warrior.id,
          equipment_option_id: option.equipment_option_id,
          model_index: modelIndex,
          quantity: 1,
          unit_cost_paid: 0,
        });
      }
    }
    if (startingItems.length) await transaction("warrior_inventory").insert(startingItems);
  }

  async function trimGroupInventory(transaction, warriorId, groupSize) {
    const removedItems = await transaction("warrior_inventory")
      .where({ warrior_id: warriorId })
      .where("model_index", ">=", groupSize)
      .select("id", "quantity", "unit_cost_paid");
    const refundAmount = removedItems.reduce((total, item) =>
      total + Number(item.unit_cost_paid) * Number(item.quantity), 0);
    if (removedItems.length) {
      await transaction("warrior_inventory")
        .whereIn("id", removedItems.map((item) => item.id))
        .delete();
    }
    return refundAmount;
  }

  // Maps a `skills` row to the camelCase shape returned to the frontend.
  function mapSkillRow(row) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      warbandId: row.warband_id,
      warriorTypeId: row.warrior_type_id,
      specialListName: row.special_list_name,
      appliesToWarriorTypeNames: row.applies_to_warrior_type_names,
      sourceReference: row.source_reference,
      isStarting: Boolean(row.warriorSkillIsStarting ?? row.is_starting),
      isLearnable: Boolean(row.is_learnable),
    };
  }

  // Loads eligibility for a normal warrior, a promoted Henchman, or a Hired Sword.
  // Hired Sword grants are type-scoped; promoted Henchmen combine their two "Lad's Got Talent"
  // choices with any automatically inherited lists.
  async function getSkillEligibilityContext(queryBuilder, warriorId) {
    const warrior = await queryBuilder("warriors as warrior")
      .join("rosters as roster", "roster.id", "warrior.roster_id")
      .leftJoin("warrior_types as warrior_type", "warrior_type.id", "warrior.warrior_type_id")
      .where("warrior.id", warriorId)
      .first({
        id: "warrior.id",
        role: "warrior.role",
        warriorTypeId: "warrior.warrior_type_id",
        warriorTypeName: "warrior_type.name",
        warriorTypeCategory: "warrior_type.category",
        warbandId: "roster.warband_id",
        skillCategoryOverrides: "warrior.skill_category_overrides",
      });
    if (!warrior) return null;

    const isPromotedHenchman = warrior.role === "Hero" && warrior.warriorTypeCategory === "Henchman";
    let categoryRows = [];
    if (warrior.role === "Hired Sword" && warrior.warriorTypeId) {
      categoryRows = await queryBuilder("hired_sword_skill_categories")
        .where({ warrior_type_id: warrior.warriorTypeId })
        .select("category", "special_list_name");
    } else if (isPromotedHenchman) {
      const chosenRows = Array.isArray(warrior.skillCategoryOverrides)
        ? warrior.skillCategoryOverrides.map((override) => ({ category: override.category, special_list_name: override.specialListName ?? null }))
        : [];
      // Lists marked 'auto' (e.g. Dwarf Treasure Hunters' generic Dwarf special skills) are
      // inherent to the warband/race rather than a chosen Lad's Got Talent list, so every
      // promoted Henchman gets them automatically in addition to their 2 picks.
      const autoRows = warrior.warbandId
        ? await queryBuilder("warrior_type_skill_categories")
          .where({ warband_id: warrior.warbandId, eligibility_mode: "auto" })
          .select("category", "special_list_name")
          .distinct()
        : [];
      categoryRows = [...chosenRows, ...autoRows];
    } else if (warrior.warriorTypeId && warrior.warbandId) {
      categoryRows = await queryBuilder("warrior_type_skill_categories")
        .where({ warband_id: warrior.warbandId, warrior_type_id: warrior.warriorTypeId })
        .select("category", "special_list_name");
    }
    return { warrior, isPromotedHenchman, categoryRows };
  }

  // Determines whether a given `skills` catalog row is learnable under the supplied
  // eligibility context. For Lad's Got Talent-derived eligibility, per-skill
  // `applies_to_warrior_type_names` sub-list restrictions are bypassed: a promoted Henchman
  // has no genuine Hero type name to match against those restrictions (e.g. Lizardmen's
  // Skink-only vs Saurus-only split within one shared special list), so the full chosen
  // list is granted instead.
  function isSkillEligible({ warrior, isPromotedHenchman, categoryRows }, skill) {
    if (!skill.is_learnable) return false;
    if (skill.warrior_type_id) {
      if (warrior.role !== "Hired Sword" || skill.warrior_type_id !== warrior.warriorTypeId) return false;
      return categoryRows.some((row) => row.category === skill.category && row.special_list_name === skill.special_list_name);
    }
    if (skill.warband_id === null) return categoryRows.some((row) => row.category === skill.category);
    if (skill.warband_id !== warrior.warbandId || skill.category !== "Special") return false;
    const matchesList = categoryRows.some((row) => row.category === "Special" && row.special_list_name === skill.special_list_name);
    if (!matchesList) return false;
    if (isPromotedHenchman) return true;
    if (!skill.applies_to_warrior_type_names) return true;
    return skill.applies_to_warrior_type_names.includes(warrior.warriorTypeName);
  }

  async function loadAvailableSkills(queryBuilder, context) {
    const { warrior, isPromotedHenchman, categoryRows } = context;
    const standardCategories = [...new Set(categoryRows.filter((row) => row.category !== "Special").map((row) => row.category))];
    const specialListNames = [...new Set(categoryRows.filter((row) => row.category === "Special" && row.special_list_name).map((row) => row.special_list_name))];

    const standardSkillsQuery = standardCategories.length
      ? queryBuilder("skills")
        .whereNull("warband_id")
        .whereNull("warrior_type_id")
        .where("is_learnable", true)
        .whereIn("category", standardCategories)
        .select("*")
      : Promise.resolve([]);

    let specialSkillsQuery = Promise.resolve([]);
    if (specialListNames.length && warrior.warbandId) {
      let builder = queryBuilder("skills")
        .where({ warband_id: warrior.warbandId, category: "Special", is_learnable: true })
        .whereNull("warrior_type_id")
        .whereIn("special_list_name", specialListNames);
      if (!isPromotedHenchman) {
        builder = builder.where((subQuery) => subQuery
          .whereNull("applies_to_warrior_type_names")
          .orWhereRaw("applies_to_warrior_type_names @> jsonb_build_array(?::text)", [warrior.warriorTypeName]));
      }
      specialSkillsQuery = builder.select("*");
    }

    let hiredSwordSkillsQuery = Promise.resolve([]);
    const hiredSwordListNames = [...new Set(categoryRows
      .filter((row) => row.category === "Special" && row.special_list_name)
      .map((row) => row.special_list_name))];
    if (warrior.role === "Hired Sword" && warrior.warriorTypeId && hiredSwordListNames.length) {
      hiredSwordSkillsQuery = queryBuilder("skills")
        .where({
          warrior_type_id: warrior.warriorTypeId,
          category: "Special",
          is_learnable: true,
        })
        .whereIn("special_list_name", hiredSwordListNames)
        .select("*");
    }

    const [standardSkills, specialSkills, hiredSwordSkills] = await Promise.all([standardSkillsQuery, specialSkillsQuery, hiredSwordSkillsQuery]);
    return [...standardSkills, ...specialSkills, ...hiredSwordSkills].map(mapSkillRow);
  }

  async function getWarriorSpellContext(queryBuilder, warriorId) {
    const warrior = await queryBuilder("warriors as warrior")
      .join("rosters as roster", "roster.id", "warrior.roster_id")
      .leftJoin("warrior_types as warrior_type", "warrior_type.id", "warrior.warrior_type_id")
      .leftJoin("warbands as warband", "warband.id", "roster.warband_id")
      .where("warrior.id", warriorId)
      .first({
        id: "warrior.id",
        role: "warrior.role",
        warriorTypeId: "warrior.warrior_type_id",
        warriorTypeName: "warrior_type.name",
        warriorTypeCategory: "warrior_type.category",
        warbandId: "roster.warband_id",
        warbandName: "warband.name",
        lesserMagicUnlocked: "warrior.lesser_magic_unlocked",
        selectedSpellDisciplineId: "warrior.selected_spell_discipline_id",
      });
    if (!warrior) return null;

    const profileRows = warrior.warriorTypeId
      ? await queryBuilder("warrior_type_spell_disciplines as access")
        .join("spell_disciplines as discipline", "discipline.id", "access.spell_discipline_id")
        .where("access.warrior_type_id", warrior.warriorTypeId)
        .andWhere((builder) => builder.whereNull("access.warband_id").orWhere("access.warband_id", warrior.warbandId))
        .select(
          "access.id as profileAccessId",
          "access.spell_discipline_id as disciplineId",
          "access.choice_group as choiceGroup",
          "access.starting_spell_count as startingSpellCount",
          "access.is_wizard as isWizard",
          "access.selection_rule as selectionRule",
          "access.source_reference as sourceReference",
          "discipline.name as name",
          "discipline.kind as kind",
          "discipline.casting_rule_summary as castingRuleSummary",
        )
        .orderBy("discipline.name")
      : [];
    const [hasArcaneLore, hasSorcery] = await Promise.all([
      queryBuilder("warrior_skills as warrior_skill")
        .join("skills as skill", "skill.id", "warrior_skill.skill_id")
        .where("warrior_skill.warrior_id", warriorId)
        .where("skill.name", "Arcane Lore")
        .first("warrior_skill.id"),
      queryBuilder("warrior_skills as warrior_skill")
        .join("skills as skill", "skill.id", "warrior_skill.skill_id")
        .where("warrior_skill.warrior_id", warriorId)
        .where("skill.name", "Sorcery")
        .first("warrior_skill.id"),
    ]);
    const skillEligibility = await getSkillEligibilityContext(queryBuilder, warriorId);
    const hasAcademicSkillAccess = Boolean(skillEligibility?.categoryRows.some((row) => row.category === "Academic"));
    const tomeInventory = await queryBuilder("warrior_inventory as inventory")
      .join("equipment_options as option", "option.id", "inventory.equipment_option_id")
      .where("inventory.warrior_id", warriorId)
      .where("option.warband_id", warrior.warbandId)
      .where("option.list_key", "magic-items")
      .where("option.name", "Tome of Magic")
      .select(
        "inventory.id",
        "inventory.unit_cost_paid as unitCostPaid",
        "inventory.created_at as acquiredAt",
      )
      .orderBy("inventory.created_at");
    const isWizard = profileRows.some((row) => Boolean(row.isWizard));
    const choiceRows = profileRows.filter((row) => row.choiceGroup);
    const fixedRows = profileRows.filter((row) => !row.choiceGroup);
    const selectedChoice = choiceRows.find((row) => row.disciplineId === warrior.selectedSpellDisciplineId);
    const availableRows = [...fixedRows, ...(selectedChoice ? [selectedChoice] : [])];
    const dynamicLesserMagic = Boolean(warrior.lesserMagicUnlocked);
    if (dynamicLesserMagic && !availableRows.some((row) => row.name === "Lesser Magic")) {
      const lesserMagic = await queryBuilder("spell_disciplines").where({ name: "Lesser Magic" }).first(
        "id as disciplineId",
        "name",
        "kind",
        "casting_rule_summary as castingRuleSummary",
      );
      if (lesserMagic) {
        availableRows.push({
          ...lesserMagic,
          startingSpellCount: null,
          isWizard: false,
          selectionRule: "Unlocked by consuming a Tome of Magic after learning Arcane Lore; Academic skill access is required.",
          sourceReference: "1Rules.pdf; 3Campaigns.pdf",
        });
      }
    }
    const uniqueRows = [...new Map(availableRows.map((row) => [row.disciplineId, row])).values()];
    const spellRows = uniqueRows.length
      ? await queryBuilder("spells")
        .whereIn("spell_discipline_id", uniqueRows.map((row) => row.disciplineId))
        .orderBy("spell_discipline_id")
        .orderBy("d6_result")
        .select(
          "id",
          "spell_discipline_id as disciplineId",
          "d6_result as roll",
          "name",
          "casting_difficulty as castingDifficulty",
          "difficulty_note as difficultyNote",
          "effect_summary as effectSummary",
        )
      : [];
    const learnedRows = await queryBuilder("warrior_spells as warrior_spell")
      .leftJoin("spells as spell", "spell.id", "warrior_spell.spell_id")
      .leftJoin("spell_disciplines as discipline", "discipline.id", "spell.spell_discipline_id")
      .where("warrior_spell.warrior_id", warriorId)
      .orderBy("warrior_spell.acquired_at")
      .select(
        "warrior_spell.id as warriorSpellId",
        "warrior_spell.spell_id as spellId",
        "warrior_spell.custom_name as customName",
        "warrior_spell.custom_casting_difficulty as customCastingDifficulty",
        "warrior_spell.custom_difficulty_note as customDifficultyNote",
        "warrior_spell.custom_effect_summary as customEffectSummary",
        "warrior_spell.custom_source_reference as customSourceReference",
        "warrior_spell.is_starting as isStarting",
        "warrior_spell.acquisition_method as acquisitionMethod",
        "warrior_spell.casting_difficulty_modifier as castingDifficultyModifier",
        "warrior_spell.notes as notes",
        "warrior_spell.acquired_at as acquiredAt",
        "spell.spell_discipline_id as disciplineId",
        "discipline.name as disciplineName",
        "spell.d6_result as roll",
        "spell.name as spellName",
        "spell.casting_difficulty as spellCastingDifficulty",
        "spell.difficulty_note as spellDifficultyNote",
        "spell.effect_summary as spellEffectSummary",
        "discipline.source_reference as spellSourceReference",
      );
    const knownSpellIds = new Set(learnedRows.filter((row) => row.spellId).map((row) => row.spellId));
    const availableDisciplines = uniqueRows.map((discipline) => {
      const spells = spellRows
        .filter((spell) => spell.disciplineId === discipline.disciplineId)
        .map((spell) => ({
          ...spell,
          alreadyKnown: knownSpellIds.has(spell.id),
        }));
      return {
        ...discipline,
        startingSpellEligible: profileRows.some((row) => row.disciplineId === discipline.disciplineId),
        spells,
      };
    });
    const selectedFixed = fixedRows.length === 1 ? fixedRows[0].disciplineId : null;
    const selectedSpellDisciplineId = uniqueRows.some((row) => row.disciplineId === warrior.selectedSpellDisciplineId)
      ? warrior.selectedSpellDisciplineId
      : selectedFixed;
    const knownSpells = learnedRows.map((row) => {
      const castingDifficulty = row.spellId ? row.spellCastingDifficulty : row.customCastingDifficulty;
      return {
        warriorSpellId: row.warriorSpellId,
        spellId: row.spellId,
        disciplineId: row.disciplineId,
        disciplineName: row.disciplineName || "Custom",
        roll: row.roll,
        name: row.spellName || row.customName,
        castingDifficulty,
        difficultyNote: row.spellDifficultyNote || row.customDifficultyNote,
        castingDifficultyModifier: Number(row.castingDifficultyModifier),
        effectiveCastingDifficulty: castingDifficulty === null || castingDifficulty === undefined
          ? null
          : Number(castingDifficulty) + Number(row.castingDifficultyModifier) - (isWizard && hasSorcery ? 1 : 0),
        effectSummary: row.spellEffectSummary || row.customEffectSummary,
        sourceReference: row.spellSourceReference || row.customSourceReference || "Manual entry (source not recorded)",
        isStarting: Boolean(row.isStarting),
        acquisitionMethod: row.acquisitionMethod,
        notes: row.notes,
        acquiredAt: row.acquiredAt,
      };
    });
    const selectedProfile = profileRows.find((row) => row.disciplineId === selectedSpellDisciplineId);
    const startingSpellCount = selectedProfile?.startingSpellCount ?? null;
    const startingSpellCountLearned = knownSpells.filter((spell) => spell.isStarting && spell.disciplineId === selectedSpellDisciplineId).length;
    const tomeAllowed = !tomeIneligibleWarbands.has(warrior.warbandName);
    const startingRow = fixedRows[0] || selectedChoice || null;
    let startingSpellsRemaining = 0;
    if (profileRows.length) {
      if (!startingRow) startingSpellsRemaining = 1;
      else {
        const required = Number(startingRow.startingSpellCount ?? 1);
        const learned = knownSpells.filter((spell) => spell.isStarting && spell.disciplineId === startingRow.disciplineId).length;
        startingSpellsRemaining = Math.max(0, required - learned);
      }
    }

    return {
      warrior,
      startingSpellsRemaining,
      profileRows,
      availableDisciplineIds: new Set(uniqueRows.map((row) => row.disciplineId)),
      isWizard,
      hasArcaneLore: Boolean(hasArcaneLore),
      hasAcademicSkillAccess,
      canLearnLesserMagic: Boolean(hasAcademicSkillAccess && hasArcaneLore && tomeInventory.length && tomeAllowed && !warrior.lesserMagicUnlocked),
      lesserMagicUnlocked: Boolean(warrior.lesserMagicUnlocked),
      castingRollBonus: isWizard && hasSorcery ? 1 : 0,
      tomeAllowed,
      tomeInventory,
      selectedSpellDisciplineId,
      disciplineChoices: [...new Map(choiceRows.map((row) => [row.disciplineId, row])).values()],
      availableDisciplines,
      knownSpells,
      startingSpellCount,
      startingSpellCountLearned,
    };
  }

  async function findPendingSpellAdvance(transaction, warriorId, advanceId, role) {
    if (!advanceId) return null;
    return transaction("warrior_advances")
      .where({ id: advanceId, warrior_id: warriorId, advance_table: getAdvanceTable(role), result: "new_skill" })
      .whereNull("learned_skill_id")
      .whereNull("learned_spell_id")
      .whereNull("reduced_spell_id")
      .whereNull("consumed_at")
      .forUpdate()
      .first("id");
  }

  const purchaseRepository = createAdvancePurchaseRepository(db, { getSkillEligibilityContext, loadAvailableSkills, isSkillEligible });

  async function refundWarriorEquipmentItems(warriorId, inventoryItemIds) {
    return db.transaction(async (transaction) => {
      const warrior = await transaction("warriors as warrior")
        .join("rosters as roster", "roster.id", "warrior.roster_id")
        .where("warrior.id", warriorId)
        .forUpdate("warrior", "roster")
        .first({ rosterId: "roster.id", treasury: "roster.treasury" });
      if (!warrior) return { missingWarrior: true };

      const inventoryItems = await transaction("warrior_inventory")
        .where({ warrior_id: warriorId })
        .whereIn("id", inventoryItemIds)
        .forUpdate()
        .select("id", "quantity", "unit_cost_paid");
      if (inventoryItems.length !== inventoryItemIds.length) return { missingItem: true };
      if (inventoryItems.some((item) => Number(item.unit_cost_paid) <= 0)) return { freeItem: true };

      const refundAmount = inventoryItems.reduce((total, item) =>
        total + Number(item.unit_cost_paid) * Number(item.quantity), 0);
      await transaction("rosters").where({ id: warrior.rosterId }).update({
        treasury: Number(warrior.treasury) + refundAmount,
        updated_at: new Date(),
      });
      await transaction("warrior_inventory")
        .where({ warrior_id: warriorId })
        .whereIn("id", inventoryItemIds)
        .delete();
      return { refundAmount, treasury: Number(warrior.treasury) + refundAmount };
    });
  }

  return {
    ...purchaseRepository,
    listRosters(userId) {
      return db("rosters").where({ user_id: userId }).select("*").orderBy("created_at", "asc");
    },

    async findUsername(userId) {
      return (await db("users").where({ id: userId }).first("username"))?.username;
    },

    listSharedRosters(userId) {
      return db("rosters").join("roster_shares", "roster_shares.roster_id", "rosters.id").where({ "roster_shares.user_id": userId }).select("rosters.*").orderBy("rosters.created_at", "asc");
    },

    async campaignRosters(campaignId) {
      return db("rosters").where({ campaign_id: campaignId }).select("*").orderBy("created_at", "asc");
    },

    async setShareCode(rosterId, code) {
      await db("rosters").where({ id: rosterId }).update({ share_code: code });
      if (!code) await db("roster_shares").where({ roster_id: rosterId }).delete();
    },

    async redeemShareCode(code, userId) {
      const roster = await db("rosters").where({ share_code: code }).first();
      if (roster && roster.user_id !== userId) {
        await db("roster_shares").insert({ roster_id: roster.id, user_id: userId }).onConflict(["roster_id", "user_id"]).ignore();
      }
      return roster;
    },

    async isCampaignMember(campaignId, userId) {
      return Boolean(await db("campaign_members").where({ campaign_id: campaignId, user_id: userId }).first());
    },

    findRoster(id) {
      return db("rosters").where({ id }).first();
    },

    findCampaign(id) {
      return db("campaigns").where({ id }).first();
    },

    countHeroes(rosterId) {
      return db("warriors").where({ roster_id: rosterId, role: "Hero" }).count("id as count");
    },

    findWarband(id, columns = "*") {
      return db("warbands").where({ id, is_available: true }).first(columns);
    },

    createRoster(values) {
      return db("rosters").insert(values).returning("*");
    },

    updateRoster(id, values) {
      return db("rosters").where({ id }).update({ ...values, updated_at: new Date() }).returning("*");
    },

    deleteRoster(id) {
      return db("rosters").where({ id }).delete();
    },

    async saveMemberOrder(rosterId, memberIds) {
      await db.transaction(async (transaction) => {
        for (const [position, memberId] of memberIds.entries()) {
          await transaction("warriors")
            .where({ roster_id: rosterId, id: memberId })
            .update({ position, updated_at: new Date() });
        }
        await transaction("rosters")
          .where({ id: rosterId })
          .update({ member_order_customized: true, updated_at: new Date() });
      });
    },

    async getWarriorEquipment(warriorId) {
      const warrior = await db("warriors as warrior")
        .join("rosters as roster", "roster.id", "warrior.roster_id")
        .leftJoin("warrior_types as warrior_type", "warrior_type.id", "warrior.warrior_type_id")
        .where("warrior.id", warriorId)
        .first({
          role: "warrior.role",
          groupSize: "warrior.group_size",
          warriorTypeId: "warrior.warrior_type_id",
          warriorTypeName: "warrior_type.name",
          warbandId: "roster.warband_id",
          campaignId: "roster.campaign_id",
        });
      if (!warrior) return null;

      const warband = await db("warbands").where({ id: warrior.warbandId }).first("name");
      const access = getMutationAccess(warband?.name, warrior.warriorTypeName, warrior.role);
      const mutationRows = await db("warrior_mutations").where({ warrior_id: warriorId }).orderBy("position");
      const mutations = {
        eligible: access.eligible,
        required: access.required,
        canEdit: access.eligible && !warrior.campaignId,
        availableOptions: access.options,
        entries: mutationRows.map((row) => {
          const option = mutationOptions.find((item) => item.id === row.mutation_id);
          if (!option) throw new Error(`Unknown mutation in inventory: ${row.mutation_id}`);
          return { ...option, id: row.id, mutationId: row.mutation_id, unitCostPaid: row.unit_cost_paid };
        }),
        totalCost: mutationRows.reduce((total, row) => total + Number(row.unit_cost_paid), 0),
      };

      const statSelect = {
        weaponProfileName: "wp.name",
        weaponType: "wp.weapon_type",
        weaponRangeText: "wp.range_text",
        weaponStrengthModifier: "wp.strength_modifier",
        weaponSpecialRules: "wp.special_rules",
        weaponNotes: "wp.notes",
        weaponSourceReference: "wp.source_reference",
        armourProfileName: "ap.name",
        armourItemType: "ap.item_type",
        armourSaveText: "ap.save_text",
        armourMovementPenalty: "ap.movement_penalty",
        armourSpecialRules: "ap.special_rules",
        armourNotes: "ap.notes",
        armourSourceReference: "ap.source_reference",
        materialModifierName: "mm.name",
        materialModifierEffectText: "mm.effect_text",
        materialModifierCostMultiplier: "mm.cost_multiplier",
        materialModifierSourceReference: "mm.source_reference",
        weaponPoisonName: "pz.name",
        weaponPoisonEffectText: "pz.effect_text",
        weaponPoisonSourceReference: "pz.source_reference",
      };
      const withStatJoins = (query) => query
        .leftJoin("weapon_profiles as wp", "wp.id", "option.weapon_profile_id")
        .leftJoin("armour_profiles as ap", "ap.id", "option.armour_profile_id")
        .leftJoin("weapon_material_modifiers as mm", "mm.id", "option.material_modifier_id")
        .leftJoin("weapon_poisons as pz", "pz.id", "option.weapon_poison_id");

      const [availableOptionRows, inventoryRows] = await Promise.all([
        warrior.warriorTypeId
          ? withStatJoins(
            db("warrior_equipment_lists as permission")
              .join("equipment_lists as list", function joinList() {
                this.on("list.warband_id", "permission.warband_id").andOn("list.list_key", "permission.list_key");
              })
              .join("equipment_options as option", function joinOption() {
                this.on("option.warband_id", "permission.warband_id").andOn("option.list_key", "permission.list_key");
              }),
          )
            .where({
              "permission.warband_id": warrior.warbandId,
              "permission.warrior_type_id": warrior.warriorTypeId,
            })
            .whereRaw("permission.allowed_categories @> jsonb_build_array(option.category)")
            .where((query) => query.whereNull("option.allowed_warrior_type_names")
              .orWhereRaw("option.allowed_warrior_type_names @> jsonb_build_array(?::text)", [warrior.warriorTypeName]))
            .select({
              id: "option.id",
              name: "option.name",
              category: "option.category",
              unitCost: "option.unit_cost",
              firstFree: "option.first_free",
              listKey: "option.list_key",
              listName: "list.name",
              sourceReference: "option.source_reference",
              ruleText: "option.rule_text",
              equipmentRule: "permission.rule_text",
              allowIndividualGroupGear: "permission.allow_individual_group_gear",
              ...statSelect,
            })
            .orderBy("list.name")
            .orderBy("option.category")
            .orderBy("option.name")
          : [],
        withStatJoins(
          db("warrior_inventory as inventory")
            .join("equipment_options as option", "option.id", "inventory.equipment_option_id")
            .join("equipment_lists as list", function joinList() {
              this.on("list.warband_id", "option.warband_id").andOn("list.list_key", "option.list_key");
            }),
        )
          .where("inventory.warrior_id", warriorId)
          .select({
            id: "inventory.id",
            equipmentOptionId: "option.id",
            name: "option.name",
            category: "option.category",
            listName: "list.name",
            modelIndex: "inventory.model_index",
            quantity: "inventory.quantity",
            unitCostPaid: "inventory.unit_cost_paid",
            sourceReference: "option.source_reference",
            ...statSelect,
          })
          .orderBy("inventory.model_index")
          .orderBy("option.name"),
      ]);

      const statKeys = Object.keys(statSelect);
      const stripStatColumns = (row) => {
        const stats = buildEquipmentStats(row);
        const clean = { ...row };
        for (const key of statKeys) delete clean[key];
        return { ...clean, stats };
      };
      const availableOptions = availableOptionRows.map(stripStatColumns);
      const inventory = inventoryRows.map(stripStatColumns);

      return { role: warrior.role, groupSize: warrior.groupSize || 1, availableOptions, inventory, mutations };
    },

    async setWarriorMutations(warriorId, mutationIds) {
      return db.transaction(async (transaction) => {
        const warrior = await transaction("warriors as warrior")
          .join("rosters as roster", "roster.id", "warrior.roster_id")
          .join("warbands as warband", "warband.id", "roster.warband_id")
          .leftJoin("warrior_types as type", "type.id", "warrior.warrior_type_id")
          .where("warrior.id", warriorId)
          .forUpdate("warrior", "roster")
          .first({
            role: "warrior.role", type: "type.name", warband: "warband.name",
            campaignId: "roster.campaign_id", rosterId: "roster.id", treasury: "roster.treasury",
          });
        if (!warrior) return { missingWarrior: true };
        if (warrior.campaignId) return { recruitmentOnly: true };
        const access = getMutationAccess(warrior.warband, warrior.type, warrior.role);
        if (!access.eligible) return { error: "Only Cult of the Possessed Mutants and Possessed can edit these mutations." };
        const priced = priceMutations(mutationIds, access, false);
        if (priced.error) return priced;
        const existing = await transaction("warrior_mutations").where({ warrior_id: warriorId });
        const previousCost = existing.reduce((total, row) => total + Number(row.unit_cost_paid), 0);
        const cost = priced.totalCost - previousCost;
        if (cost > Number(warrior.treasury)) return { insufficientFunds: true, totalCost: cost, treasury: warrior.treasury };
        await transaction("warrior_mutations").where({ warrior_id: warriorId }).delete();
        if (priced.entries.length) await transaction("warrior_mutations").insert(priced.entries.map((entry) => ({ ...entry, warrior_id: warriorId })));
        await transaction("rosters").where({ id: warrior.rosterId }).update({
          treasury: Number(warrior.treasury) - cost, updated_at: new Date(),
        });
        return { treasury: Number(warrior.treasury) - cost };
      });
    },

    async purchaseWarriorEquipment(warriorId, { equipmentOptionId, modelIndex, quantity }) {
      return db.transaction(async (transaction) => {
        const warrior = await transaction("warriors as warrior")
          .join("rosters as roster", "roster.id", "warrior.roster_id")
          .leftJoin("warrior_types as warrior_type", "warrior_type.id", "warrior.warrior_type_id")
          .where("warrior.id", warriorId)
          .forUpdate("warrior", "roster")
          .first({
            id: "warrior.id",
            role: "warrior.role",
            groupSize: "warrior.group_size",
            warriorTypeId: "warrior.warrior_type_id",
            warriorTypeName: "warrior_type.name",
            rosterId: "roster.id",
            warbandId: "roster.warband_id",
            treasury: "roster.treasury",
          });
        if (!warrior) return { missingWarrior: true };
        if (!warrior.warriorTypeId) return { unavailableOption: true };

        const option = await transaction("equipment_options as option")
          .join("warrior_equipment_lists as permission", function joinPermission() {
            this.on("permission.warband_id", "option.warband_id").andOn("permission.list_key", "option.list_key");
          })
          .where("option.id", equipmentOptionId)
          .where("permission.warband_id", warrior.warbandId)
          .where("permission.warrior_type_id", warrior.warriorTypeId)
          .whereRaw("permission.allowed_categories @> jsonb_build_array(option.category)")
          .where((query) => query.whereNull("option.allowed_warrior_type_names")
            .orWhereRaw("option.allowed_warrior_type_names @> jsonb_build_array(?::text)", [warrior.warriorTypeName]))
          .first({
            unitCost: "option.unit_cost",
            firstFree: "option.first_free",
            allowIndividualGroupGear: "permission.allow_individual_group_gear",
          });
        if (!option) return { unavailableOption: true };

        const groupSize = warrior.groupSize || 1;
        if (warrior.role !== "Henchman" && modelIndex !== -1) return { invalidModelIndex: true };
        if (warrior.role === "Henchman" && modelIndex !== -1) {
          if (!option.allowIndividualGroupGear || modelIndex >= groupSize) return { invalidModelIndex: true };
        }
        const modelIndexes = warrior.role === "Henchman" && modelIndex === -1
          ? Array.from({ length: groupSize }, (_, index) => index)
          : [warrior.role === "Henchman" ? modelIndex : 0];

        const purchases = [];
        let totalCost = 0;
        for (const model of modelIndexes) {
          const existing = await transaction("warrior_inventory")
            .where({ warrior_id: warriorId, equipment_option_id: equipmentOptionId, model_index: model })
            .first("id");
          const freeQuantity = option.firstFree && !existing ? 1 : 0;
          const paidQuantity = quantity - freeQuantity;
          if (freeQuantity) purchases.push({ model, quantity: freeQuantity, unitCost: 0 });
          if (paidQuantity) purchases.push({ model, quantity: paidQuantity, unitCost: Number(option.unitCost) });
          totalCost += paidQuantity * Number(option.unitCost);
        }

        if (Number(warrior.treasury) < totalCost) {
          return { insufficientFunds: true, totalCost, treasury: Number(warrior.treasury) };
        }
        if (purchases.length) {
          await transaction("warrior_inventory").insert(purchases.map((purchase) => ({
            warrior_id: warriorId,
            equipment_option_id: equipmentOptionId,
            model_index: purchase.model,
            quantity: purchase.quantity,
            unit_cost_paid: purchase.unitCost,
          })));
        }
        if (totalCost > 0) {
          await transaction("rosters").where({ id: warrior.rosterId })
            .update({ treasury: Number(warrior.treasury) - totalCost, updated_at: new Date() });
        }
        return { totalCost, treasury: Number(warrior.treasury) - totalCost };
      });
    },

    async refundWarriorEquipment(warriorId, inventoryItemId) {
      return refundWarriorEquipmentItems(warriorId, [inventoryItemId]);
    },

    refundWarriorEquipmentItems(warriorId, inventoryItemIds) {
      return refundWarriorEquipmentItems(warriorId, inventoryItemIds);
    },

    listAssignedWarriorTypeIds(rosterId) {
      return db("warriors").where({ roster_id: rosterId }).whereNotNull("warrior_type_id").pluck("warrior_type_id");
    },

    listEligibleWarriorTypeIds(warbandId) {
      return db("warband_warrior_types")
        .where({ warband_id: warbandId })
        .whereIn("availability", ["allowed", "conditional"])
        .pluck("warrior_type_id");
    },

    listSelectedCapacityModifiers(rosterId) {
      return db("roster_capacity_modifiers as selected")
        .join("capacity_modifiers", "capacity_modifiers.id", "selected.capacity_modifier_id")
        .where("selected.roster_id", rosterId)
        .select("capacity_modifiers.*");
    },

    findCapacityModifiers(ids) {
      return db("capacity_modifiers").whereIn("id", ids).select("*");
    },

    async replaceCapacityModifiers(rosterId, modifiers) {
      await db.transaction(async (transaction) => {
        await transaction("roster_capacity_modifiers").where({ roster_id: rosterId }).delete();
        if (modifiers.length) {
          await transaction("roster_capacity_modifiers").insert(modifiers.map((modifier) => ({
            roster_id: rosterId,
            capacity_modifier_id: modifier.id,
          })));
        }
      });
    },

    countRosterWarriors(rosterId) {
      return db("warriors").where({ roster_id: rosterId }).count("id as count");
    },

    async createWarrior(values) {
      return db.transaction(async (transaction) => {
        const roster = await transaction("rosters").where({ id: values.roster_id }).first("warband_id");
        const [warrior] = await transaction("warriors").insert(values).returning("*");
        await addFreeStartingEquipment(transaction, warrior, roster?.warband_id);
        await addWarriorTypeStartingSkills(transaction, warrior);
        return [warrior];
      });
    },

    async hireWarrior(values, hireCost, mutations = []) {
      return db.transaction(async (transaction) => {
        const roster = await transaction("rosters")
          .where({ id: values.roster_id })
          .forUpdate()
          .first("id", "treasury", "warband_id");
        if (!roster || Number(roster.treasury) < hireCost) return { insufficientFunds: true };
        const [{ count }] = await transaction("warriors").where({ roster_id: roster.id }).count("id as count");
        const [warrior] = await transaction("warriors").insert({
          ...values,
          position: Number(count),
        }).returning("*");
        await addFreeStartingEquipment(transaction, warrior, roster.warband_id);
        await addWarriorTypeStartingSkills(transaction, warrior);
        if (mutations.length) await transaction("warrior_mutations").insert(mutations.map((entry) => ({ ...entry, warrior_id: warrior.id })));
        await transaction("rosters").where({ id: roster.id }).update({
          treasury: Number(roster.treasury) - hireCost,
          updated_at: new Date(),
        });
        return { warrior };
      });
    },

    async getLockedExperience(warriorId) {
      const row = await db("warrior_advances")
        .where({ warrior_id: warriorId })
        .whereNull("consumed_at")
        .max("experience_threshold as locked")
        .first();
      const warrior = await db("warriors").where({ id: warriorId }).first("promotion_experience");
      return Math.max(Number(row?.locked || 0), Number(warrior?.promotion_experience || 0));
    },

    findWarrior(id, columns = "*") {
      return db("warriors").where({ id }).first(columns);
    },

    findWarriorType(id, columns = "*") {
      return db("warrior_types").where({ id }).first(columns);
    },

    async getWarriorAdvancements(warriorId) {
      const warrior = await db("warriors as warrior")
        .leftJoin("warrior_types as warrior_type", "warrior_type.id", "warrior.warrior_type_id")
        .join("rosters as roster", "roster.id", "warrior.roster_id")
        .leftJoin("warbands as warband", "warband.id", "roster.warband_id")
        .where("warrior.id", warriorId)
        .first(
          "warrior.id",
          "warrior.role",
          "warrior.experience",
          "warrior.stats",
          "warrior.advance_baseline",
          "warrior_type.starting_experience as minimumExperience",
          "warrior_type.name as warriorTypeName",
          "warrior_type.category as warriorTypeCategory",
          "warrior_type.stats as initialStats",
          "warrior_type.can_gain_experience as canGainExperience",
          "warrior_type.experience_rule as experienceRule",
          "warrior_type.promotion_eligibility as promotionEligibility",
          "warband.name as warbandName",
          "warband.max_heroes as maxHeroes",
          "roster.id as rosterId",
        );
      if (!warrior) return null;

      const advanceTable = getAdvanceTable(warrior.role);
      const history = await db("warrior_advances")
        .where({ "warrior_advances.warrior_id": warriorId })
        .orderBy("warrior_advances.created_at", "asc")
        .select(
          "warrior_advances.id",
          "warrior_advances.advance_table as advanceTable",
          "warrior_advances.experience_threshold as experienceThreshold",
          "warrior_advances.mode",
          "warrior_advances.roll",
          "warrior_advances.secondary_roll as secondaryRoll",
          "warrior_advances.result",
          "warrior_advances.stat",
          "warrior_advances.purchase_cost as purchaseCost",
          "warrior_advances.experience_before_purchase as experienceBeforePurchase",
          "learned_skill.id as learnedSkillId",
          "skill.name as learnedSkillName",
          "skill.category as learnedSkillCategory",
          "warrior_advances.learned_spell_id as learnedSpellId",
          "warrior_advances.reduced_spell_id as reducedSpellId",
          db.raw("coalesce(learned_spell_catalog.name, learned_spell.custom_name) as \"learnedSpellName\""),
          db.raw("coalesce(reduced_spell_catalog.name, reduced_spell.custom_name) as \"reducedSpellName\""),
          "warrior_advances.created_at as createdAt",
          "warrior_advances.consumed_at as consumedAt",
        )
        .leftJoin("warrior_skills as learned_skill", "learned_skill.id", "warrior_advances.learned_skill_id")
        .leftJoin("skills as skill", "skill.id", "learned_skill.skill_id")
        .leftJoin("warrior_spells as learned_spell", "learned_spell.id", "warrior_advances.learned_spell_id")
        .leftJoin("spells as learned_spell_catalog", "learned_spell_catalog.id", "learned_spell.spell_id")
        .leftJoin("warrior_spells as reduced_spell", "reduced_spell.id", "warrior_advances.reduced_spell_id")
        .leftJoin("spells as reduced_spell_catalog", "reduced_spell_catalog.id", "reduced_spell.spell_id");
      const latestAdvanceByTable = new Map();
      for (const advance of history) {
        const latest = latestAdvanceByTable.get(advance.advanceTable);
        if (!latest
          || Number(advance.experienceThreshold) > Number(latest.experienceThreshold)
          || (Number(advance.experienceThreshold) === Number(latest.experienceThreshold)
            && new Date(advance.createdAt) > new Date(latest.createdAt))) {
          latestAdvanceByTable.set(advance.advanceTable, advance);
        }
      }
      const tableHistory = history.filter((advance) => advance.advanceTable === advanceTable && !advance.consumedAt);
      const thresholds = getAdvanceThresholds(advanceTable, warrior.role);
      const pendingCount = Math.max(0, getAdvancesEarned(advanceTable, warrior.experience, warrior.role)
        - Number(warrior.advance_baseline || 0) - tableHistory.length);
      const lockedExperience = tableHistory.reduce((highest, advance) => Math.max(highest, Number(advance.experienceThreshold)), 0);
      const nextAdvanceThreshold = thresholds[Number(warrior.advance_baseline || 0) + tableHistory.length] ?? null;
      const pendingSkillAdvances = history
        .filter((advance) => advance.advanceTable === advanceTable
          && advance.result === "new_skill"
          && !advance.learnedSkillId
          && !advance.learnedSpellId
          && !advance.reducedSpellId
          && !advance.consumedAt)
        .map((advance) => ({
          id: advance.id,
          experienceThreshold: advance.experienceThreshold,
        }));
      const profileName = getStatMaximumProfile(warrior.warbandName, warrior.warriorTypeName);
      const maximumStats = profileName ? racialMaximums[profileName] : null;
      const availableStats = getAvailableStatIncreases({
        table: advanceTable,
        stats: warrior.stats,
        initialStats: warrior.initialStats,
        maximumStats,
      });
      const [{ count: currentHeroes }] = await db("warriors")
        .where({ roster_id: warrior.rosterId, role: "Hero" })
        .count("id as count");
      const canPromote = warrior.role === "Henchman"
        && warrior.promotionEligibility === "eligible"
        && Number(currentHeroes) < Number(warrior.maxHeroes || 6);
      const purchases = await purchaseRepository.getAdvancePurchaseOptions(warriorId);

      return {
        role: warrior.role,
        experience: Number(warrior.experience),
        lockedExperience,
        pendingCount,
        minimumExperience: Math.max(Number(warrior.minimumExperience || 0), Number(warrior.promotionExperience || 0)),
        advanceTable,
        advanceBaseline: Number(warrior.advance_baseline || 0),
        pending: pendingCount > 0,
        nextAdvanceThreshold,
        canGainExperience: warrior.canGainExperience !== false,
        experienceRule: warrior.experienceRule || null,
        warriorTypeName: warrior.warriorTypeName || null,
        initialStats: warrior.initialStats || {},
        stats: warrior.stats || {},
        maximumProfile: profileName,
        maximumStats,
        availableStats,
        canPromote,
        pendingSkillAdvances,
        history: history.map((advance) => ({
          ...advance,
          canRemove: !advance.consumedAt && !(warrior.role === "Hero" && advance.advanceTable === "Henchman")
            && latestAdvanceByTable.get(advance.advanceTable)?.id === advance.id
            && (advance.purchaseCost === null || (purchases.enabled && Number(warrior.experience) === Number(advance.experienceThreshold))),
        })),
        purchases,
      };
    },

    async recordWarriorAdvance(warriorId, { mode, result: requestedResult, stat: requestedStat }) {
      return db.transaction(async (transaction) => {
        const warrior = await transaction("warriors as warrior")
          .leftJoin("warrior_types as warrior_type", "warrior_type.id", "warrior.warrior_type_id")
          .join("rosters as roster", "roster.id", "warrior.roster_id")
          .leftJoin("warbands as warband", "warband.id", "roster.warband_id")
          .where("warrior.id", warriorId)
          .forUpdate("warrior")
          .first(
            "warrior.id",
            "warrior.role",
            "warrior.experience",
              "warrior.stats",
            "warrior.advance_baseline",
            "warrior.promotion_experience as promotionExperience",
            "warrior_type.starting_experience as minimumExperience",
            "warrior_type.name as warriorTypeName",
            "warrior_type.stats as initialStats",
            "warrior_type.can_gain_experience as canGainExperience",
            "warrior_type.promotion_eligibility as promotionEligibility",
            "warband.name as warbandName",
            "warband.max_heroes as maxHeroes",
            "roster.id as rosterId",
          );
        if (!warrior) return { missingWarrior: true };
        if (warrior.canGainExperience === false) return { experienceDisabled: true };

        const advanceTable = getAdvanceTable(warrior.role);
        const thresholds = getAdvanceThresholds(advanceTable, warrior.role);
        const recordedAdvances = await transaction("warrior_advances")
          .where({ warrior_id: warriorId, advance_table: advanceTable })
          .whereNull("consumed_at")
          .orderBy("experience_threshold", "asc")
          .select("experience_threshold");
        const nextAdvanceThreshold = thresholds[Number(warrior.advance_baseline || 0) + recordedAdvances.length] ?? null;
        if (nextAdvanceThreshold === null || Number(warrior.experience) < nextAdvanceThreshold) {
          return { noPendingAdvance: true };
        }

        const profileName = getStatMaximumProfile(warrior.warbandName, warrior.warriorTypeName);
        const maximumStats = profileName ? racialMaximums[profileName] : null;
        const availableStats = getAvailableStatIncreases({
          table: advanceTable,
          stats: warrior.stats,
          initialStats: warrior.initialStats,
          maximumStats,
        });
        const [{ count: currentHeroes }] = await transaction("warriors")
          .where({ roster_id: warrior.rosterId, role: "Hero" })
          .count("id as count");
        const canPromote = warrior.role === "Henchman"
          && warrior.promotionEligibility === "eligible"
          && Number(currentHeroes) < Number(warrior.maxHeroes || 6);

        let outcome;
        if (mode === "simulated") {
          outcome = advanceTable === "Hero"
            ? rollHeroAdvance(availableStats, randomInt)
            : rollHenchmanAdvance(availableStats, warrior.promotionEligibility === "eligible", canPromote, randomInt);
          if (outcome.noAvailableAdvance) return { noAvailableAdvance: true };
        } else if (mode === "manual") {
          if (requestedResult === "new_skill" && advanceTable === "Hero") {
            outcome = { result: "new_skill", stat: null, roll: null, secondaryRoll: null };
          } else if (requestedResult === "lads_got_talent" && advanceTable === "Henchman" && canPromote) {
            outcome = { result: "lads_got_talent", stat: null, roll: null, secondaryRoll: null };
          } else if (requestedResult === "stat_increase" && availableStats.includes(requestedStat)) {
            outcome = { result: "stat_increase", stat: requestedStat, roll: null, secondaryRoll: null };
          } else {
            return { invalidOutcome: true, availableStats, canPromote };
          }
        } else {
          return { invalidMode: true };
        }

        const nextStats = { ...(warrior.stats || {}) };
        if (outcome.result === "stat_increase") {
          const current = Number(nextStats[outcome.stat]);
          if (!Number.isFinite(current)) return { invalidOutcome: true, availableStats, canPromote };
          nextStats[outcome.stat] = String(current + 1);
        }

        await transaction("warrior_advances").insert({
          warrior_id: warriorId,
          advance_table: advanceTable,
          experience_threshold: nextAdvanceThreshold,
          mode,
          roll: outcome.roll,
          secondary_roll: outcome.secondaryRoll,
          result: outcome.result,
          stat: outcome.stat,
        });
        await transaction("warriors").where({ id: warriorId }).update({
          stats: nextStats,
          updated_at: new Date(),
        });
        return { recorded: true, result: outcome.result };
      });
    },

    async deleteWarriorAdvance(warriorId, advanceId) {
      const paid = await db("warrior_advances").where({ id: advanceId, warrior_id: warriorId }).first("purchase_cost");
      if (paid?.purchase_cost != null) return purchaseRepository.refundPurchasedAdvance(warriorId, advanceId);
      return db.transaction(async (transaction) => {
        const warrior = await transaction("warriors as warrior")
          .leftJoin("warrior_types as warrior_type", "warrior_type.id", "warrior.warrior_type_id")
          .where("warrior.id", warriorId)
          .forUpdate("warrior")
          .first({
            id: "warrior.id",
            role: "warrior.role",
            stats: "warrior.stats",
            initialStats: "warrior_type.stats",
          });
        if (!warrior) return { missingWarrior: true };

        const advance = await transaction("warrior_advances")
          .where({ id: advanceId, warrior_id: warriorId })
          .forUpdate()
          .first("id", "advance_table", "experience_threshold", "result", "stat", "learned_skill_id", "learned_spell_id", "reduced_spell_id", "consumed_at");
        if (!advance) return { missingAdvance: true };
        if (advance.consumed_at) return { usedForPromotion: true };
        if (advance.advance_table === "Henchman" && warrior.role === "Hero") return { usedForPromotion: true };

        const latestAdvance = await transaction("warrior_advances")
          .where({ warrior_id: warriorId, advance_table: advance.advance_table })
          .orderBy("experience_threshold", "desc")
          .orderBy("created_at", "desc")
          .forUpdate()
          .first("id");
        if (latestAdvance.id !== advance.id) return { notLatestAdvance: true };

        const nextStats = { ...(warrior.stats || {}) };
        if (advance.result === "stat_increase") {
          const currentStat = Number(nextStats[advance.stat]);
          const initialStat = Number(warrior.initialStats?.[advance.stat]);
          if (!Number.isFinite(currentStat) || !Number.isFinite(initialStat) || currentStat <= initialStat) {
            return { statCannotBeReversed: true };
          }
          nextStats[advance.stat] = String(currentStat - 1);
        }

        let learnedSkillId = null;
        if (advance.learned_skill_id) {
          const learnedSkill = await transaction("warrior_skills")
            .where({ id: advance.learned_skill_id, warrior_id: warriorId })
            .forUpdate()
            .first("id", "is_starting");
          if (learnedSkill?.is_starting) return { startingSkill: true };
          learnedSkillId = learnedSkill?.id ?? null;
        }

        await transaction("warrior_advances").where({ id: advance.id }).delete();
        if (advance.learned_spell_id) {
          await transaction("warrior_spells").where({ id: advance.learned_spell_id, warrior_id: warriorId }).delete();
        }
        if (advance.reduced_spell_id) {
          await transaction("warrior_spells")
            .where({ id: advance.reduced_spell_id, warrior_id: warriorId })
            .increment("casting_difficulty_modifier", 1);
        }
        if (learnedSkillId) {
          await transaction("warrior_skills").where({ id: learnedSkillId, warrior_id: warriorId }).delete();
        }
        if (advance.result === "stat_increase") {
          await transaction("warriors").where({ id: warriorId }).update({
            stats: nextStats,
            updated_at: new Date(),
          });
        }
        return { deleted: true };
      });
    },

    async updateWarrior(id, values) {
      return db.transaction(async (transaction) => {
        await updateWarriorValues(transaction, id, values);
        if (values.group_size !== undefined) await trimGroupInventory(transaction, id, values.group_size);
        const warrior = await transaction("warriors as warrior")
          .leftJoin("warrior_types as warrior_type", "warrior_type.id", "warrior.warrior_type_id")
          .join("rosters as roster", "roster.id", "warrior.roster_id")
          .where("warrior.id", id)
          .select("warrior.*", "warrior_type.member_limit_bonus", "warrior_type.large", "roster.warband_id")
          .first();
        if (values.warrior_type_id !== undefined || values.group_size !== undefined) {
          await addFreeStartingEquipment(transaction, warrior, warrior.warband_id);
        }
        return [warrior];
      });
    },

    async updateHenchmanAndAdjustTreasury(id, values, additionalHireCost) {
      return db.transaction(async (transaction) => {
        const currentWarrior = await transaction("warriors").where({ id }).first("roster_id");
        if (!currentWarrior) return { missingWarrior: true };
        const roster = await transaction("rosters")
          .where({ id: currentWarrior.roster_id })
          .forUpdate()
          .first("id", "treasury", "warband_id");
        const current = await transaction("warriors as warrior")
          .leftJoin("warrior_types as warrior_type", "warrior_type.id", "warrior.warrior_type_id")
          .where("warrior.id", id)
          .first("warrior.group_size", "warrior.warrior_type_id", "warrior_type.hire_cost");
        if (!current) return { missingWarrior: true };
        const adjustment = current.warrior_type_id && values.group_size !== undefined
          ? (values.group_size - current.group_size) * Number(current.hire_cost || 0)
          : additionalHireCost;
        if (!roster || Number(roster.treasury) < adjustment) return { insufficientFunds: true };

        await updateWarriorValues(transaction, id, values);
        const equipmentRefund = values.group_size !== undefined
          ? await trimGroupInventory(transaction, id, values.group_size)
          : 0;
        const currentValues = await transaction("warriors").where({ id }).first("id", "role", "group_size", "warrior_type_id");
        await addFreeStartingEquipment(transaction, currentValues, roster.warband_id);
        await transaction("rosters").where({ id: roster.id }).update({
          treasury: Number(roster.treasury) - adjustment + equipmentRefund,
          updated_at: new Date(),
        });
        const warrior = await transaction("warriors as warrior")
          .leftJoin("warrior_types as warrior_type", "warrior_type.id", "warrior.warrior_type_id")
          .where("warrior.id", id)
          .select("warrior.*", "warrior_type.member_limit_bonus", "warrior_type.large")
          .first();
        return { warrior };
      });
    },

    async deleteWarriorAndRefund(id) {
      return db.transaction(async (transaction) => {
        const warrior = await transaction("warriors as warrior")
          .leftJoin("warrior_types as warrior_type", "warrior_type.id", "warrior.warrior_type_id")
          .where("warrior.id", id)
          .forUpdate("warrior")
          .first(
            "warrior.id",
            "warrior.roster_id",
            "warrior.role",
            "warrior.group_size",
            "warrior_type.hire_cost",
          );
        if (!warrior) return { missingWarrior: true };

        const roster = await transaction("rosters")
          .where({ id: warrior.roster_id })
          .forUpdate()
          .first("id", "treasury");
        if (!roster) return { missingRoster: true };

        const modelCount = warrior.role === "Henchman" ? warrior.group_size || 1 : 1;
        const refundAmount = ["Hero", "Henchman"].includes(warrior.role)
          ? Number(warrior.hire_cost || 0) * modelCount
          : 0;
        if (refundAmount > 0) {
          await transaction("rosters").where({ id: roster.id }).update({
            treasury: Number(roster.treasury) + refundAmount,
            updated_at: new Date(),
          });
        }
        await transaction("warriors").where({ id }).delete();
        return { refundAmount };
      });
    },

    listWarriorTypeIdsByName(names) {
      return db("warrior_types").whereIn("name", names).pluck("id");
    },

    async sumWarriorModels(rosterId, warriorTypeIds, exceptMemberId) {
      const query = db("warriors").where({ roster_id: rosterId }).whereIn("warrior_type_id", warriorTypeIds);
      if (exceptMemberId) query.whereNot("id", exceptMemberId);
      const [{ count }] = await query.sum("group_size as count");
      return Number(count || 0);
    },

    async sumTypeModels(rosterId, warriorTypeId, exceptMemberId) {
      const query = db("warriors").where({ roster_id: rosterId, warrior_type_id: warriorTypeId });
      if (exceptMemberId) query.whereNot("id", exceptMemberId);
      const [{ count }] = await query.sum("group_size as count");
      return Number(count || 0);
    },

    findWarriorByTypeName(rosterId, typeName, exceptMemberId) {
      const query = db("warriors")
        .join("warrior_types", "warrior_types.id", "warriors.warrior_type_id")
        .where("warriors.roster_id", rosterId)
        .where("warrior_types.name", typeName);
      if (exceptMemberId) query.whereNot("warriors.id", exceptMemberId);
      return query.first("warriors.id");
    },

    async promoteWarrior(warrior, groupSize) {
      return db.transaction(async (transaction) => {
        const talentAdvance = await transaction("warrior_advances")
          .where({
            warrior_id: warrior.id,
            advance_table: "Henchman",
            result: "lads_got_talent",
          })
          .whereNull("consumed_at")
          .orderBy("experience_threshold", "desc")
          .forUpdate()
          .first("id");
        if (!talentAdvance) return { missingTalentAdvance: true };

        await transaction("warrior_advances").where({ id: talentAdvance.id }).update({ consumed_at: new Date() });
        const heroAdvanceBaseline = Math.max(0, getAdvancesEarned("Hero", warrior.experience) - 1);
        if (groupSize > 1) {
          await transaction("warriors").where({ id: warrior.id }).update({ group_size: groupSize - 1, updated_at: new Date() });
          const [{ count }] = await transaction("warriors").where({ roster_id: warrior.roster_id }).count("id as count");
          const [newHero] = await transaction("warriors").insert({
            roster_id: warrior.roster_id,
            name: `${warrior.name} (Promoted)`,
            type: warrior.type,
            warrior_type_id: warrior.warrior_type_id,
            role: "Hero",
            experience: warrior.experience,
            stats: warrior.stats,
            advance_baseline: heroAdvanceBaseline,
            promotion_experience: warrior.experience,
            equipment: warrior.equipment,
            skills: warrior.skills,
            notes: warrior.notes,
            position: Number(count),
            group_size: 1,
          }).returning("*");
          await addWarriorTypeStartingSkills(transaction, newHero);
          const henchmanAdvances = await transaction("warrior_advances")
            .where({ warrior_id: warrior.id, advance_table: "Henchman" })
            .select("advance_table", "experience_threshold", "mode", "roll", "secondary_roll", "result", "stat", "created_at", "consumed_at");
          if (henchmanAdvances.length) {
            await transaction("warrior_advances").insert(henchmanAdvances.map((advance) => ({ ...advance, warrior_id: newHero.id })));
          }
          const promotedInventory = await transaction("warrior_inventory")
            .where({ warrior_id: warrior.id, model_index: 0 })
            .select("equipment_option_id", "quantity", "unit_cost_paid");
          if (promotedInventory.length) {
            await transaction("warrior_inventory").insert(promotedInventory.map((item) => ({
              ...item,
              warrior_id: newHero.id,
              model_index: 0,
            })));
            await transaction("warrior_inventory").where({ warrior_id: warrior.id, model_index: 0 }).delete();
          }
          await transaction("warrior_inventory")
            .where({ warrior_id: warrior.id })
            .where("model_index", ">", 0)
            .update({ model_index: transaction.raw("model_index - 1") });
          return newHero;
        }
        const [promotedMember] = await transaction("warriors")
          .where({ id: warrior.id })
          .update({ role: "Hero", advance_baseline: heroAdvanceBaseline, promotion_experience: warrior.experience, updated_at: new Date() })
          .returning("*");
        return promotedMember;
      });
    },

    listMembers(rosterId) {
      return db("warriors as warrior")
        .leftJoin("warrior_types as warrior_type", "warrior_type.id", "warrior.warrior_type_id")
        .join("rosters as roster", "roster.id", "warrior.roster_id")
        .leftJoin("warbands as warband", "warband.id", "roster.warband_id")
        .where("warrior.roster_id", rosterId)
        .select(
          "warrior.*",
          "warrior_type.stats as initial_stats",
          "warrior_type.name as warrior_type_name",
          "warband.name as warband_name",
          "warrior_type.member_limit_bonus",
          "warrior_type.large",
          "warrior_type.rating_base_override",
          "warrior_type.rating_experience_multiplier",
          "warrior_type.starting_experience",
          db.raw(
            "(select coalesce(max(experience_threshold), 0) from warrior_advances where warrior_advances.warrior_id = warrior.id and warrior_advances.consumed_at is null) as locked_experience",
          ),
        )
        .orderBy("warrior.position", "asc");
    },

    async getCapacityData(roster) {
      const [warband, warriors, modifiers, selectedRows] = await Promise.all([
        roster.warband_id ? db("warbands").where({ id: roster.warband_id }).first() : null,
        db("warriors as warrior")
          .leftJoin("warrior_types as warrior_type", "warrior_type.id", "warrior.warrior_type_id")
          .where("warrior.roster_id", roster.id)
          .select("warrior.role", "warrior.group_size", "warrior_type.member_limit_bonus"),
        db("capacity_modifiers")
          .select("id", "name", "member_limit_bonus", "excluded_warbands", "source_reference", "rule_text")
          .orderBy("name", "asc"),
        db("roster_capacity_modifiers").where({ roster_id: roster.id }).pluck("capacity_modifier_id"),
      ]);
      return { warband, warriors, modifiers, selectedRows };
    },

    findSelectableWarriorType(warbandId, warriorTypeId) {
      if (!warbandId || !warriorTypeId) return null;
      return db("warband_warrior_types as eligibility")
        .join("warrior_types", "warrior_types.id", "eligibility.warrior_type_id")
        .where("eligibility.warband_id", warbandId)
        .where("eligibility.warrior_type_id", warriorTypeId)
        .whereIn("eligibility.availability", ["allowed", "conditional"])
        .first(
          "warrior_types.id",
          "warrior_types.name",
          "warrior_types.category",
          "warrior_types.stats",
          "warrior_types.large",
          "warrior_types.starting_experience",
          "warrior_types.starting_equipment",
          "warrior_types.equipment_choices",
          "warrior_types.can_gain_experience",
          "warrior_types.experience_rule",
          "warrior_types.member_limit_bonus",
          "warrior_types.hire_cost",
          "warrior_types.hire_cost_source",
          "eligibility.availability",
          "eligibility.condition_text",
          "eligibility.max_count",
          "eligibility.max_count_reference_types",
          "eligibility.max_count_multiplier",
          "eligibility.rule_text",
        );
    },

    async getWarriorSkills(warriorId) {
      const context = await getSkillEligibilityContext(db, warriorId);
      if (!context) return null;
      const { warrior, isPromotedHenchman, categoryRows } = context;
      const pendingSkillAdvances = warrior.role === "Henchman"
        ? []
        : await db("warrior_advances")
          .where({
            warrior_id: warriorId,
            advance_table: getAdvanceTable(warrior.role),
            result: "new_skill",
          })
          .whereNull("learned_skill_id")
          .whereNull("consumed_at")
          .orderBy("experience_threshold", "asc")
          .select("id", "experience_threshold as experienceThreshold");

      const knownSkillIds = new Set(await db("warrior_skills").where({ warrior_id: warriorId }).pluck("skill_id"));
      const [loadedSkills, learnedSkills] = await Promise.all([
        pendingSkillAdvances.length ? loadAvailableSkills(db, context) : [],
        db("warrior_skills as warrior_skill")
          .join("skills as skill", "skill.id", "warrior_skill.skill_id")
          .leftJoin("warrior_advances as paid_advance", "paid_advance.learned_skill_id", "warrior_skill.id")
          .where("warrior_skill.warrior_id", warriorId)
          .orderBy("warrior_skill.acquired_at", "asc")
          .select(
            "warrior_skill.id as warriorSkillId",
            "warrior_skill.acquired_at as acquiredAt",
            "warrior_skill.notes as notes",
            "paid_advance.purchase_cost as purchaseCost",
            "skill.id as id",
            "skill.name as name",
            "skill.category as category",
            "skill.description as description",
            "skill.warband_id as warband_id",
            "skill.special_list_name as special_list_name",
            "skill.applies_to_warrior_type_names as applies_to_warrior_type_names",
            "skill.source_reference as source_reference",
            "skill.warrior_type_id as warrior_type_id",
            "skill.is_learnable as is_learnable",
            "warrior_skill.is_starting as warriorSkillIsStarting",
          ),
      ]);

      return {
        role: warrior.role,
        isPromotedHenchman,
        eligibility: categoryRows.map((row) => ({ category: row.category, specialListName: row.special_list_name })),
        pendingSkillAdvances,
        availableSkills: loadedSkills.filter((skill) => !knownSkillIds.has(skill.id)),
        learnedSkills: learnedSkills.map((row) => ({ warriorSkillId: row.warriorSkillId, acquiredAt: row.acquiredAt, notes: row.notes, purchaseCost: row.purchaseCost, ...mapSkillRow(row) })),
      };
    },

    async getWarriorSpells(warriorId) {
      const context = await getWarriorSpellContext(db, warriorId);
      if (!context) return null;
      return {
        role: context.warrior.role,
        warriorTypeName: context.warrior.warriorTypeName,
        hasSpellcastingProfile: context.profileRows.length > 0,
        canShowSpellSection: context.profileRows.length > 0 || context.hasAcademicSkillAccess,
        hasArcaneLore: context.hasArcaneLore,
        hasAcademicSkillAccess: context.hasAcademicSkillAccess,
        canLearnLesserMagic: context.canLearnLesserMagic,
        lesserMagicUnlocked: context.lesserMagicUnlocked,
        isWizard: context.isWizard,
        castingRollBonus: context.castingRollBonus,
        tomeInventory: context.tomeInventory,
        tomeAllowed: context.tomeAllowed,
        selectedSpellDisciplineId: context.selectedSpellDisciplineId,
        disciplineChoices: context.disciplineChoices,
        availableDisciplines: context.availableDisciplines,
        startingSpellCount: context.startingSpellCount,
        startingSpellCountLearned: context.startingSpellCountLearned,
        startingSpellsRemaining: context.startingSpellsRemaining,
        canLearnSpellFromAdvance: context.startingSpellsRemaining === 0 && context.availableDisciplineIds.size > 0,
        knownSpells: context.knownSpells,
      };
    },

    async setWarriorSpellDiscipline(warriorId, disciplineId) {
      return db.transaction(async (transaction) => {
        const warrior = await transaction("warriors")
          .where({ id: warriorId })
          .forUpdate()
          .first("id");
        if (!warrior) return { missingWarrior: true };
        const context = await getWarriorSpellContext(transaction, warriorId);
        if (!context) return { missingWarrior: true };
        const canSelect = context.profileRows.some((row) => row.disciplineId === disciplineId && row.choiceGroup)
          || context.availableDisciplineIds.has(disciplineId);
        if (!canSelect) return { unavailableDiscipline: true };
        await transaction("warriors").where({ id: warriorId }).update({
          selected_spell_discipline_id: disciplineId,
          updated_at: new Date(),
        });
        return { selected: true };
      });
    },

    async addWarriorMagicTome(warriorId, unitCostPaid = null) {
      return db.transaction(async (transaction) => {
        const warrior = await transaction("warriors as warrior")
          .join("rosters as roster", "roster.id", "warrior.roster_id")
          .leftJoin("warbands as warband", "warband.id", "roster.warband_id")
          .where("warrior.id", warriorId)
          .forUpdate("warrior")
          .first({ id: "warrior.id", warbandId: "roster.warband_id", warbandName: "warband.name" });
        if (!warrior) return { missingWarrior: true };
        if (tomeIneligibleWarbands.has(warrior.warbandName)) return { tomeNotAllowed: true };
        const skillContext = await getSkillEligibilityContext(transaction, warriorId);
        if (!skillContext?.categoryRows.some((row) => row.category === "Academic")) return { academicSkillRequired: true };
        const option = await transaction("equipment_options")
          .where({ warband_id: warrior.warbandId, list_key: "magic-items", name: "Tome of Magic" })
          .first("id");
        if (!option) throw new Error(`Tome of Magic inventory option is missing for warband ${warrior.warbandId}.`);
        const [tome] = await transaction("warrior_inventory")
          .insert({
            warrior_id: warriorId,
            equipment_option_id: option.id,
            model_index: -1,
            quantity: 1,
            unit_cost_paid: unitCostPaid ?? 0,
          })
          .returning(["id", "unit_cost_paid as unitCostPaid", "created_at as acquiredAt"]);
        return { tome };
      });
    },

    async consumeWarriorMagicTome(warriorId) {
      return db.transaction(async (transaction) => {
        const warrior = await transaction("warriors")
          .where({ id: warriorId })
          .forUpdate()
          .first("id", "lesser_magic_unlocked");
        if (!warrior) return { missingWarrior: true };
        const context = await getWarriorSpellContext(transaction, warriorId);
        if (!context) return { missingWarrior: true };
        if (!context.hasAcademicSkillAccess) return { academicSkillRequired: true };
        if (!context.hasArcaneLore) return { arcaneLoreRequired: true };
        if (!context.tomeAllowed) return { tomeNotAllowed: true };
        if (context.lesserMagicUnlocked) return { alreadyUnlocked: true };
        const tome = await transaction("warrior_inventory as inventory")
          .join("equipment_options as option", "option.id", "inventory.equipment_option_id")
          .where("inventory.warrior_id", warriorId)
          .where("option.list_key", "magic-items")
          .where("option.name", "Tome of Magic")
          .forUpdate("inventory")
          .orderBy("inventory.created_at")
          .first("inventory.id");
        if (!tome) return { missingTome: true };
        const lesserMagic = await transaction("spell_disciplines").where({ name: "Lesser Magic" }).first("id");
        if (!lesserMagic) throw new Error("Lesser Magic discipline is missing from the spell catalog.");
        await transaction("warrior_inventory").where({ id: tome.id }).delete();
        await transaction("warriors").where({ id: warriorId }).update({
          lesser_magic_unlocked: true,
          selected_spell_discipline_id: lesserMagic.id,
          updated_at: new Date(),
        });
        return { consumed: true, tomeId: tome.id };
      });
    },

    async rollWarriorSpells(warriorId, disciplineId, count) {
      const context = await getWarriorSpellContext(db, warriorId);
      if (!context) return { missingWarrior: true };
      if (!context.availableDisciplineIds.has(disciplineId)) return { ineligibleDiscipline: true };
      const spells = await db("spells")
        .where({ spell_discipline_id: disciplineId })
        .whereNotNull("d6_result")
        .select(
          "id",
          "spell_discipline_id as disciplineId",
          "d6_result as roll",
          "name",
          "casting_difficulty as castingDifficulty",
          "difficulty_note as difficultyNote",
          "effect_summary as effectSummary",
        );
      if (!spells.length) return { noRollTable: true };
      const spellsByRoll = new Map(spells.map((spell) => [Number(spell.roll), spell]));
      const knownBySpellId = new Map(context.knownSpells.filter((spell) => spell.spellId).map((spell) => [spell.spellId, spell]));
      const results = [];
      for (let index = 0; index < count; index += 1) {
        const roll = randomInt(1, 7);
        const spell = spellsByRoll.get(roll);
        if (!spell) throw new Error(`Spell discipline ${disciplineId} has no spell for D6 result ${roll}.`);
        const known = knownBySpellId.get(spell.id);
        results.push({
          ...spell,
          alreadyKnown: Boolean(known),
          knownWarriorSpellId: known?.warriorSpellId ?? null,
          effectiveCastingDifficulty: known?.effectiveCastingDifficulty ?? spell.castingDifficulty,
        });
      }
      return { disciplineId, results };
    },

    async learnWarriorSpell(warriorId, { spellId, customSpell, acquisitionMethod = "manual", advanceId }) {
      return db.transaction(async (transaction) => {
        const lockedWarrior = await transaction("warriors")
          .where({ id: warriorId })
          .forUpdate()
          .first("id");
        if (!lockedWarrior) return { missingWarrior: true };
        const context = await getWarriorSpellContext(transaction, warriorId);
        if (!context) return { missingWarrior: true };

        if (context.startingSpellsRemaining > 0 && acquisitionMethod !== "starting") return { startingSpellRequired: true };
        if (!["starting", "advance"].includes(acquisitionMethod)) return { manualNotAllowed: true };
        if (acquisitionMethod === "starting" && context.startingSpellsRemaining <= 0) return { noStartingSpellRemaining: true };
        let advance = null;
        if (acquisitionMethod === "advance") {
          if (!spellId) return { advanceNeedsCatalogSpell: true };
          advance = await findPendingSpellAdvance(transaction, warriorId, advanceId, context.warrior.role);
          if (!advance) return { missingAdvance: true };
        }

        let spell = null;
        if (spellId) {
          spell = await transaction("spells").where({ id: spellId }).first();
          if (!spell) return { missingSpell: true };
          if (!context.availableDisciplineIds.has(spell.spell_discipline_id)) return { ineligibleSpell: true };
          const existing = await transaction("warrior_spells")
            .where({ warrior_id: warriorId, spell_id: spellId })
            .first("id");
          if (existing) return { duplicateSpell: true, warriorSpellId: existing.id };
        } else if (!customSpell?.name) {
          return { invalidCustomSpell: true };
        } else if (!context.profileRows.length && !context.lesserMagicUnlocked) {
          return { ineligibleSpell: true };
        }

        if (acquisitionMethod === "starting" && spell) {
          const access = context.profileRows.find((row) => row.disciplineId === spell.spell_discipline_id && !row.choiceGroup)
            || context.profileRows.find((row) => row.disciplineId === spell.spell_discipline_id && row.disciplineId === context.warrior.selectedSpellDisciplineId);
          if (!access) return { notStartingDiscipline: true };
          if (access.startingSpellCount !== null && access.startingSpellCount !== undefined) {
            const [{ count }] = await transaction("warrior_spells as warrior_spell")
              .join("spells as existing_spell", "existing_spell.id", "warrior_spell.spell_id")
              .where("warrior_spell.warrior_id", warriorId)
              .where("warrior_spell.is_starting", true)
              .where("existing_spell.spell_discipline_id", spell.spell_discipline_id)
              .count("warrior_spell.id as count");
            if (Number(count) >= Number(access.startingSpellCount)) return { startingSpellLimit: true };
          }
        }
        if (acquisitionMethod === "tome") {
          return { tomeIsNotSpell: true };
        }

        const [created] = await transaction("warrior_spells").insert({
          warrior_id: warriorId,
          spell_id: spell?.id || null,
          custom_name: customSpell?.name || null,
          custom_casting_difficulty: customSpell?.castingDifficulty ?? null,
          custom_difficulty_note: customSpell?.difficultyNote || null,
          custom_effect_summary: customSpell?.effectSummary || null,
          custom_source_reference: customSpell?.sourceReference || "Manual entry (source not recorded)",
          is_starting: acquisitionMethod === "starting",
          acquisition_method: acquisitionMethod,
        }).returning("id");
        if (advance) await transaction("warrior_advances").where({ id: advance.id }).update({ learned_spell_id: created.id });
        return { created: true, warriorSpellId: created.id };
      });
    },

    async reduceWarriorSpellDifficulty(warriorId, warriorSpellId, advanceId) {
      return db.transaction(async (transaction) => {
        const lockedWarrior = await transaction("warriors").where({ id: warriorId }).forUpdate().first("id");
        if (!lockedWarrior) return { missingSpell: true };
        const context = await getWarriorSpellContext(transaction, warriorId);
        if (context.startingSpellsRemaining > 0) return { startingSpellRequired: true };
        const advance = await findPendingSpellAdvance(transaction, warriorId, advanceId, context.warrior.role);
        if (!advance) return { missingAdvance: true };
        const spell = await transaction("warrior_spells as warrior_spell")
          .leftJoin("spells as spell", "spell.id", "warrior_spell.spell_id")
          .where("warrior_spell.id", warriorSpellId)
          .where("warrior_spell.warrior_id", warriorId)
          .forUpdate("warrior_spell")
          .first({
            id: "warrior_spell.id",
            modifier: "warrior_spell.casting_difficulty_modifier",
            castingDifficulty: "spell.casting_difficulty",
            customCastingDifficulty: "warrior_spell.custom_casting_difficulty",
          });
        if (!spell) return { missingSpell: true };
        const baseDifficulty = spell.castingDifficulty ?? spell.customCastingDifficulty;
        if (baseDifficulty === null || baseDifficulty === undefined) return { noCastingDifficulty: true };
        await transaction("warrior_spells").where({ id: warriorSpellId, warrior_id: warriorId }).update({
          casting_difficulty_modifier: Number(spell.modifier) - 1,
          updated_at: new Date(),
        });
        await transaction("warrior_advances").where({ id: advance.id }).update({ reduced_spell_id: spell.id });
        return { updated: true };
      });
    },

    async forgetWarriorSpell(warriorId, warriorSpellId) {
      const spell = await db("warrior_spells")
        .where({ id: warriorSpellId, warrior_id: warriorId })
        .first("is_starting");
      if (!spell) return { deleted: false };
      const linkedAdvance = await db("warrior_advances")
        .where({ learned_spell_id: warriorSpellId })
        .orWhere({ reduced_spell_id: warriorSpellId })
        .first("id");
      if (linkedAdvance) return { notRemovable: true };
      const deletedCount = await db("warrior_spells").where({ id: warriorSpellId, warrior_id: warriorId }).delete();
      return { deleted: deletedCount > 0 };
    },

    async learnWarriorSkill(warriorId, skillId, advanceId) {
      return db.transaction(async (transaction) => {
        const warrior = await transaction("warriors")
          .where({ id: warriorId })
          .forUpdate()
          .first("id", "role");
        if (!warrior) return { missingWarrior: true };
        const context = await getSkillEligibilityContext(transaction, warriorId);
        const skill = await transaction("skills").where({ id: skillId }).first();
        if (!skill) return { missingSkill: true };
        if (!isSkillEligible(context, skill)) return { ineligibleSkill: true };
        const alreadyKnown = await transaction("warrior_skills").where({ warrior_id: warriorId, skill_id: skillId }).first("id");
        if (alreadyKnown) return { alreadyLearned: true };
        const advance = await transaction("warrior_advances")
          .where({
            id: advanceId,
            warrior_id: warriorId,
            advance_table: getAdvanceTable(warrior.role),
            result: "new_skill",
          })
          .whereNull("learned_skill_id")
          .whereNull("consumed_at")
          .forUpdate()
          .first("id");
        if (!advance) return { missingAdvance: true };
        const [warriorSkill] = await transaction("warrior_skills")
          .insert({ warrior_id: warriorId, skill_id: skillId })
          .returning("*");
        await transaction("warrior_advances")
          .where({ id: advance.id })
          .update({ learned_skill_id: warriorSkill.id });
        return { warriorSkill: { warriorSkillId: warriorSkill.id, acquiredAt: warriorSkill.acquired_at, notes: warriorSkill.notes, ...mapSkillRow(skill) } };
      });
    },

    async forgetWarriorSkill(warriorId, warriorSkillId) {
      const paid = await db("warrior_advances").where({ warrior_id: warriorId, learned_skill_id: warriorSkillId }).whereNotNull("purchase_cost").first("id");
      if (paid) return purchaseRepository.refundPurchasedAdvance(warriorId, paid.id);
      const skill = await db("warrior_skills")
        .where({ id: warriorSkillId, warrior_id: warriorId })
        .first("id", "is_starting");
      if (!skill) return { deleted: false };
      if (skill.is_starting) return { notRemovable: true };
      return db.transaction(async (transaction) => {
        // Release the New Skill advance so the skill can be re-selected.
        await transaction("warrior_advances").where({ learned_skill_id: warriorSkillId }).update({ learned_skill_id: null });
        const deletedCount = await transaction("warrior_skills").where({ id: warriorSkillId, warrior_id: warriorId }).delete();
        return { deleted: deletedCount > 0 };
      });
    },

    async getLadsGotTalentOptions(warriorId) {
      const context = await getSkillEligibilityContext(db, warriorId);
      if (!context) return null;
      if (!context.isPromotedHenchman) return { notPromotedHenchman: true };

      const rows = await db("warrior_type_skill_categories as category")
        .join("warrior_types as warrior_type", "warrior_type.id", "category.warrior_type_id")
        .where("category.warband_id", context.warrior.warbandId)
        .where("warrior_type.category", "Hero")
        .where("category.eligibility_mode", "choice")
        .select("category.category", "category.special_list_name")
        .distinct();

      const seen = new Set();
      const options = [];
      for (const row of rows) {
        const key = `${row.category}|${row.special_list_name || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({ category: row.category, specialListName: row.special_list_name });
      }

      const selected = Array.isArray(context.warrior.skillCategoryOverrides) ? context.warrior.skillCategoryOverrides : [];
      return { options, selected };
    },

    async setLadsGotTalentChoices(warriorId, overrides) {
      return db.transaction(async (transaction) => {
        const warrior = await transaction("warriors as warrior")
          .join("rosters as roster", "roster.id", "warrior.roster_id")
          .leftJoin("warrior_types as warrior_type", "warrior_type.id", "warrior.warrior_type_id")
          .where("warrior.id", warriorId)
          .forUpdate("warrior")
          .first({ id: "warrior.id", role: "warrior.role", warriorTypeCategory: "warrior_type.category", warbandId: "roster.warband_id" });
        if (!warrior) return { missingWarrior: true };
        const isPromotedHenchman = warrior.role === "Hero" && warrior.warriorTypeCategory === "Henchman";
        if (!isPromotedHenchman) return { notPromotedHenchman: true };

        const learned = await transaction("warrior_skills").where({ warrior_id: warriorId }).first("id");
        if (learned) return { skillsAlreadyLearned: true };

        if (!Array.isArray(overrides) || overrides.length !== 2) return { invalidChoiceCount: true };
        const rows = await transaction("warrior_type_skill_categories as category")
          .join("warrior_types as warrior_type", "warrior_type.id", "category.warrior_type_id")
          .where("category.warband_id", warrior.warbandId)
          .where("warrior_type.category", "Hero")
          .where("category.eligibility_mode", "choice")
          .select("category.category", "category.special_list_name")
          .distinct();
        const validKeys = new Set(rows.map((row) => `${row.category}|${row.special_list_name || ""}`));
        const chosenKeys = overrides.map((override) => `${override.category}|${override.specialListName || ""}`);
        if (chosenKeys.some((key) => !validKeys.has(key))) return { invalidChoice: true };
        if (new Set(chosenKeys).size !== chosenKeys.length) return { duplicateChoice: true };

        const normalizedOverrides = overrides.map((override) => ({ category: override.category, specialListName: override.specialListName ?? null }));
        await transaction("warriors").where({ id: warriorId }).update({
          skill_category_overrides: JSON.stringify(normalizedOverrides),
          updated_at: new Date(),
        });
        return { skillCategoryOverrides: normalizedOverrides };
      });
    },
  };
}

module.exports = { createRosterRepository };
