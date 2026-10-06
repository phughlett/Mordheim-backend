const {
  pickFields,
  validateExclusiveHire,
  validateExperience,
  validateNonNegativeIntegers,
  validateWarriorTypeCount,
} = require("../services/roster-validation.service");
const { getAdvanceTable, getAdvancesEarned } = require("../services/advancement-rules.service");

const memberFields = ["name", "type", "warriorTypeId", "groupSize", "role", "experience", "equipment", "skills", "notes"];
const warriorCategories = ["Hero", "Henchman", "Hired Sword"];

function createMemberController(repository, rosterService) {
  return {
    async getAdvancements(request, response) {
      const advancements = await repository.getWarriorAdvancements(request.params.memberId);
      if (!advancements) return response.status(404).json({ error: "Warrior not found." });
      response.json(advancements);
    },

    async recordAdvance(request, response) {
      const { mode, result, stat } = request.body || {};
      if (!["manual", "simulated"].includes(mode)) {
        return response.status(400).json({ error: "mode must be manual or simulated." });
      }
      if (mode === "manual" && !["stat_increase", "new_skill", "lads_got_talent"].includes(result)) {
        return response.status(400).json({ error: "A valid manual advance result is required." });
      }
      if (mode === "manual" && result === "stat_increase" && typeof stat !== "string") {
        return response.status(400).json({ error: "stat is required for a manual characteristic increase." });
      }

      const outcome = await repository.recordWarriorAdvance(request.params.memberId, { mode, result, stat });
      if (outcome.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (outcome.experienceDisabled) return response.status(409).json({ error: "This warrior type does not gain experience." });
      if (outcome.noPendingAdvance) return response.status(409).json({ error: "No unrecorded advance is available at the warrior's current experience." });
      if (outcome.noAvailableAdvance) return response.status(409).json({ error: "No legal advance result is currently available for this warrior." });
      if (outcome.invalidMode) return response.status(400).json({ error: "mode must be manual or simulated." });
      if (outcome.invalidOutcome) {
        return response.status(409).json({
          error: "That advance result is not available for this warrior's current advance table or stat limits.",
          availableStats: outcome.availableStats,
          canPromote: outcome.canPromote,
        });
      }
      response.status(201).json(await repository.getWarriorAdvancements(request.params.memberId));
    },

    async removeAdvance(request, response) {
      const result = await repository.deleteWarriorAdvance(request.params.memberId, request.params.advanceId);
      if (result.purchaseError) return response.status(409).json({ error: result.purchaseError });
      if (result.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (result.missingAdvance) return response.status(404).json({ error: "Advancement not found." });
      if (result.usedForPromotion) return response.status(409).json({ error: "Advancements earned as a Henchman, including the one used for promotion, cannot be removed." });
      if (result.notLatestAdvance) return response.status(409).json({ error: "Remove later advances from this advance table first." });
      if (result.statCannotBeReversed) return response.status(409).json({ error: "This characteristic increase cannot be reversed without going below the warrior's starting profile." });
      if (result.startingSkill) return response.status(409).json({ error: "An advancement linked to a starting skill cannot be removed." });
      response.json(await repository.getWarriorAdvancements(request.params.memberId));
    },

    async purchaseAdvance(request, response) {
      const { stat, skillId } = request.body || {};
      if ((typeof stat === "string") === (typeof skillId === "string")
        || (stat !== undefined && skillId !== undefined)
        || (typeof skillId === "string" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(skillId))) {
        return response.status(400).json({ error: "Supply exactly one characteristic stat or skillId to purchase." });
      }
      const result = await repository.purchaseWarriorAdvance(request.params.memberId, { stat, skillId });
      if (result.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (result.error) return response.status(409).json({ error: result.error });
      response.status(201).json(await repository.getWarriorAdvancements(request.params.memberId));
    },

    async listEquipment(request, response) {
      const equipment = await repository.getWarriorEquipment(request.params.memberId);
      if (!equipment) return response.status(404).json({ error: "Warrior not found." });
      response.json(equipment);
    },

    async setMutations(request, response) {
      const result = await repository.setWarriorMutations(request.params.memberId, request.body?.mutationIds);
      if (result.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (result.recruitmentOnly) return response.status(409).json({ error: "Campaign mutations are permanent and can only be purchased when recruiting a Mutant or Possessed." });
      if (result.error) return response.status(400).json({ error: result.error });
      if (result.insufficientFunds) return response.status(409).json({ error: `These mutations cost an additional ${result.totalCost} GC, but the roster has ${result.treasury} GC.` });
      response.json({ ...await repository.getWarriorEquipment(request.params.memberId), treasury: String(result.treasury) });
    },

    async purchaseEquipment(request, response) {
      const equipmentOptionId = request.body?.equipmentOptionId;
      const quantity = request.body?.quantity === undefined ? 1 : Number(request.body.quantity);
      const modelIndex = request.body?.modelIndex === undefined ? -1 : Number(request.body.modelIndex);
      if (typeof equipmentOptionId !== "string" || equipmentOptionId.length === 0) {
        return response.status(400).json({ error: "equipmentOptionId is required." });
      }
      if (!Number.isSafeInteger(quantity) || quantity < 1) {
        return response.status(400).json({ error: "quantity must be a positive integer." });
      }
      if (!Number.isSafeInteger(modelIndex) || modelIndex < -1) {
        return response.status(400).json({ error: "modelIndex must be -1 or a non-negative integer." });
      }

      const purchase = await repository.purchaseWarriorEquipment(request.params.memberId, {
        equipmentOptionId,
        modelIndex,
        quantity,
      });
      if (purchase.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (purchase.shopOnly) return response.status(409).json({ error: "After roster creation, buy equipment from the trading shop into your warband stash, then transfer it to an eligible warrior." });
      if (purchase.unavailableOption) return response.status(400).json({ error: "This item is not allowed for this warrior." });
      if (purchase.invalidModelIndex) return response.status(400).json({ error: "This group must use identical equipment or the selected model does not exist." });
      if (purchase.insufficientFunds) {
        return response.status(409).json({ error: `This purchase costs ${purchase.totalCost} GC, but the roster has ${purchase.treasury} GC.` });
      }

      const equipment = await repository.getWarriorEquipment(request.params.memberId);
      response.status(201).json({ ...equipment, purchaseCost: purchase.totalCost, treasury: String(purchase.treasury) });
    },

    async sellEquipment(request, response) {
      const sale = await repository.refundWarriorEquipment(request.params.memberId, request.params.inventoryItemId);
      if (sale.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (sale.missingItem) return response.status(404).json({ error: "Inventory item not found." });
      if (sale.freeItem) return response.status(409).json({ error: "Free equipment cannot be sold." });
      if (sale.shopItem) return response.status(409).json({ error: "Trading-shop equipment cannot use recruitment refunds. Transfer it to the warband stash instead." });

      const equipment = await repository.getWarriorEquipment(request.params.memberId);
      response.json({ ...equipment, refundAmount: sale.refundAmount, treasury: String(sale.treasury) });
    },

    async sellEquipmentItems(request, response) {
      const inventoryItemIds = request.body?.inventoryItemIds;
      if (!Array.isArray(inventoryItemIds) || inventoryItemIds.length === 0
        || inventoryItemIds.some((id) => typeof id !== "string" || id.length === 0)
        || new Set(inventoryItemIds).size !== inventoryItemIds.length) {
        return response.status(400).json({ error: "inventoryItemIds must be a non-empty array of unique item IDs." });
      }

      const sale = await repository.refundWarriorEquipmentItems(request.params.memberId, inventoryItemIds);
      if (sale.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (sale.missingItem) return response.status(404).json({ error: "One or more inventory items were not found." });
      if (sale.freeItem) return response.status(409).json({ error: "Free equipment cannot be sold." });
      if (sale.shopItem) return response.status(409).json({ error: "Trading-shop equipment cannot use recruitment refunds. Transfer it to the warband stash instead." });

      const equipment = await repository.getWarriorEquipment(request.params.memberId);
      response.json({ ...equipment, refundAmount: sale.refundAmount, treasury: String(sale.treasury) });
    },

    async listSkills(request, response) {
      const skills = await repository.getWarriorSkills(request.params.memberId);
      if (!skills) return response.status(404).json({ error: "Warrior not found." });
      response.json(skills);
    },

    async learnSkill(request, response) {
      const { skillId, advanceId } = request.body || {};
      if (typeof skillId !== "string" || skillId.length === 0) {
        return response.status(400).json({ error: "skillId is required." });
      }
      if (typeof advanceId !== "string" || advanceId.length === 0) {
        return response.status(400).json({ error: "advanceId is required to learn a skill." });
      }
      const result = await repository.learnWarriorSkill(request.params.memberId, skillId, advanceId);
      if (result.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (result.missingSkill) return response.status(404).json({ error: "Skill not found." });
      if (result.missingAdvance) return response.status(409).json({ error: "A pending New Skill advance is required to learn a skill." });
      if (result.alreadyLearned) return response.status(409).json({ error: "This warrior has already learned this skill." });
      if (result.ineligibleSkill) return response.status(409).json({ error: "This warrior is not eligible to learn this skill." });

      const skills = await repository.getWarriorSkills(request.params.memberId);
      response.status(201).json(skills);
    },

    async forgetSkill(request, response) {
      const result = await repository.forgetWarriorSkill(request.params.memberId, request.params.warriorSkillId);
      if (result.purchaseError) return response.status(409).json({ error: result.purchaseError });
      if (result.notRemovable) return response.status(409).json({ error: "Starting skills cannot be removed." });
      if (!result.deleted) return response.status(404).json({ error: "Learned skill not found." });

      const skills = await repository.getWarriorSkills(request.params.memberId);
      response.json(skills);
    },

    async listSpells(request, response) {
      const spells = await repository.getWarriorSpells(request.params.memberId);
      if (!spells) return response.status(404).json({ error: "Warrior not found." });
      response.json(spells);
    },

    async rollSpells(request, response) {
      const { disciplineId, count = 1 } = request.body || {};
      if (typeof disciplineId !== "string" || !disciplineId) {
        return response.status(400).json({ error: "disciplineId is required." });
      }
      if (!Number.isSafeInteger(count) || ![1, 2].includes(count)) {
        return response.status(400).json({ error: "count must be 1 or 2." });
      }
      const result = await repository.rollWarriorSpells(request.params.memberId, disciplineId, count);
      if (result.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (result.ineligibleDiscipline) return response.status(409).json({ error: "This warrior cannot use that spell list." });
      if (result.noRollTable) return response.status(409).json({ error: "This spell list has no D6 roll table." });
      response.json(result);
    },

    async learnSpell(request, response) {
      const spellId = request.body?.spellId;
      const rawCustomSpell = request.body?.customSpell;
      const acquisitionMethod = request.body?.acquisitionMethod ?? "manual";
      if ((typeof spellId === "string" && spellId.length > 0) === Boolean(rawCustomSpell)) {
        return response.status(400).json({ error: "Provide exactly one of spellId or customSpell." });
      }
      if (spellId !== undefined && (typeof spellId !== "string" || spellId.length === 0)) {
        return response.status(400).json({ error: "spellId must be a non-empty string." });
      }
      if (!["starting", "advance", "tome", "manual"].includes(acquisitionMethod)) {
        return response.status(400).json({ error: "acquisitionMethod must be starting, advance, tome, or manual." });
      }

      let customSpell;
      if (rawCustomSpell !== undefined) {
        if (!rawCustomSpell || typeof rawCustomSpell !== "object" || Array.isArray(rawCustomSpell)
          || typeof rawCustomSpell.name !== "string" || rawCustomSpell.name.trim().length === 0
          || rawCustomSpell.name.trim().length > 255
          || (rawCustomSpell.castingDifficulty !== undefined && rawCustomSpell.castingDifficulty !== null
            && (!Number.isSafeInteger(rawCustomSpell.castingDifficulty) || rawCustomSpell.castingDifficulty < 2 || rawCustomSpell.castingDifficulty > 12))
          || (rawCustomSpell.difficultyNote !== undefined && (typeof rawCustomSpell.difficultyNote !== "string" || rawCustomSpell.difficultyNote.length > 64))
          || (rawCustomSpell.effectSummary !== undefined && (typeof rawCustomSpell.effectSummary !== "string" || rawCustomSpell.effectSummary.length > 5000))
          || (rawCustomSpell.sourceReference !== undefined && (typeof rawCustomSpell.sourceReference !== "string" || rawCustomSpell.sourceReference.length > 500))) {
          return response.status(400).json({ error: "customSpell must have a name and may include a difficulty from 2 to 12, difficultyNote, effectSummary, and sourceReference." });
        }
        customSpell = {
          name: rawCustomSpell.name.trim(),
          castingDifficulty: rawCustomSpell.castingDifficulty ?? null,
          difficultyNote: rawCustomSpell.difficultyNote?.trim() || null,
          effectSummary: rawCustomSpell.effectSummary?.trim() || null,
          sourceReference: rawCustomSpell.sourceReference?.trim() || null,
        };
      }

      const advanceId = request.body?.advanceId;
      const result = await repository.learnWarriorSpell(request.params.memberId, {
        spellId,
        customSpell,
        acquisitionMethod,
        advanceId: typeof advanceId === "string" ? advanceId : undefined,
      });
      if (result.startingSpellRequired) return response.status(409).json({ error: "This warrior must learn their starting spell first." });
      if (result.manualNotAllowed) return response.status(409).json({ error: "Spells can only be learned as a starting spell or by spending a New Skill advance." });
      if (result.noStartingSpellRemaining) return response.status(409).json({ error: "This warrior has no starting spells left to learn." });
      if (result.advanceNeedsCatalogSpell) return response.status(400).json({ error: "An advance spell must come from a spell list." });
      if (result.missingAdvance) return response.status(409).json({ error: "No unused New Skill advance is available for this spell." });
      if (result.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (result.missingSpell) return response.status(404).json({ error: "Spell not found." });
      if (result.ineligibleSpell) return response.status(409).json({ error: "This warrior cannot use that spell list." });
      if (result.duplicateSpell) return response.status(409).json({ error: "This spell is already known.", warriorSpellId: result.warriorSpellId });
      if (result.invalidCustomSpell) return response.status(400).json({ error: "A custom spell name is required." });
      if (result.notStartingDiscipline) return response.status(409).json({ error: "This spell is not from a starting spell list for this warrior." });
      if (result.startingSpellLimit) return response.status(409).json({ error: "The warrior already has the recorded number of starting spells for this list." });
      if (result.tomeIsNotSpell) return response.status(409).json({ error: "Use a Tome from inventory to unlock Lesser Magic; it is not a spell acquisition method." });
      const spells = await repository.getWarriorSpells(request.params.memberId);
      response.status(201).json(spells);
    },

    async forgetSpell(request, response) {
      const result = await repository.forgetWarriorSpell(request.params.memberId, request.params.warriorSpellId);
      if (result.notRemovable) return response.status(409).json({ error: "Spells gained from an advance can only be removed by removing that advance." });
      if (!result.deleted) return response.status(404).json({ error: "Learned spell not found." });
      const spells = await repository.getWarriorSpells(request.params.memberId);
      response.json(spells);
    },

    async reduceSpellDifficulty(request, response) {
      const advanceId = request.body?.advanceId;
      const result = await repository.reduceWarriorSpellDifficulty(
        request.params.memberId,
        request.params.warriorSpellId,
        typeof advanceId === "string" ? advanceId : undefined,
      );
      if (result.startingSpellRequired) return response.status(409).json({ error: "This warrior must learn their starting spell first." });
      if (result.missingAdvance) return response.status(409).json({ error: "No unused New Skill advance is available." });
      if (result.missingSpell) return response.status(404).json({ error: "Known spell not found." });
      if (result.noCastingDifficulty) return response.status(409).json({ error: "A spell without a numeric casting difficulty cannot be reduced." });
      const spells = await repository.getWarriorSpells(request.params.memberId);
      response.json(spells);
    },

    async setSpellDiscipline(request, response) {
      const disciplineId = request.body?.disciplineId;
      if (typeof disciplineId !== "string" || disciplineId.length === 0) {
        return response.status(400).json({ error: "disciplineId is required." });
      }
      const result = await repository.setWarriorSpellDiscipline(request.params.memberId, disciplineId);
      if (result.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (result.unavailableDiscipline) return response.status(409).json({ error: "This warrior cannot choose that spell list." });
      const spells = await repository.getWarriorSpells(request.params.memberId);
      response.json(spells);
    },

    async addMagicTome(request, response) {
      const unitCostPaid = request.body?.unitCostPaid;
      if (unitCostPaid !== undefined && unitCostPaid !== null
        && (!Number.isSafeInteger(unitCostPaid) || unitCostPaid < 0 || unitCostPaid > 1000000)) {
        return response.status(400).json({ error: "unitCostPaid must be a non-negative whole number no greater than 1000000." });
      }
      const result = await repository.addWarriorMagicTome(request.params.memberId, unitCostPaid ?? null);
      if (result.shopOnly) return response.status(409).json({ error: "In campaigns, buy a Tome of Magic from the trading shop and transfer it from the stash." });
      if (result.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (result.tomeNotAllowed) return response.status(409).json({ error: "The Tome of Magic is not available to this warband." });
      if (result.academicSkillRequired) return response.status(409).json({ error: "Academic skill access is required to record a Tome of Magic for spell learning." });
      const spells = await repository.getWarriorSpells(request.params.memberId);
      response.status(201).json(spells);
    },

    async consumeMagicTome(request, response) {
      const result = await repository.consumeWarriorMagicTome(request.params.memberId);
      if (result.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (result.academicSkillRequired) return response.status(409).json({ error: "Academic skill access is required to learn Lesser Magic." });
      if (result.arcaneLoreRequired) return response.status(409).json({ error: "Learn Arcane Lore before using a Tome of Magic to learn Lesser Magic." });
      if (result.tomeNotAllowed) return response.status(409).json({ error: "The Tome of Magic is not available to this warband." });
      if (result.alreadyUnlocked) return response.status(409).json({ error: "Lesser Magic has already been learned." });
      if (result.missingTome) return response.status(409).json({ error: "A Tome of Magic in the warrior's inventory is required." });
      const spells = await repository.getWarriorSpells(request.params.memberId);
      response.json(spells);
    },

    async getLadsGotTalentOptions(request, response) {
      const result = await repository.getLadsGotTalentOptions(request.params.memberId);
      if (!result) return response.status(404).json({ error: "Warrior not found." });
      if (result.notPromotedHenchman) return response.status(400).json({ error: "Lad's Got Talent skill-list choices only apply to a promoted Henchman." });
      response.json(result);
    },

    async setLadsGotTalentChoices(request, response) {
      const overrides = request.body?.choices;
      if (!Array.isArray(overrides) || overrides.length !== 2
        || overrides.some((choice) => !choice || typeof choice.category !== "string")) {
        return response.status(400).json({ error: "choices must be an array of exactly 2 { category, specialListName? } entries." });
      }
      const result = await repository.setLadsGotTalentChoices(request.params.memberId, overrides);
      if (result.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (result.notPromotedHenchman) return response.status(400).json({ error: "Lad's Got Talent skill-list choices only apply to a promoted Henchman." });
      if (result.skillsAlreadyLearned) return response.status(409).json({ error: "Skill lists cannot be changed after a skill has been learned." });
      if (result.invalidChoiceCount) return response.status(400).json({ error: "Exactly 2 skill-list choices are required." });
      if (result.duplicateChoice) return response.status(400).json({ error: "The 2 skill-list choices must be different." });
      if (result.invalidChoice) return response.status(400).json({ error: "One or more choices are not available to this warband's Heroes." });

      const skills = await repository.getWarriorSkills(request.params.memberId);
      response.json(skills);
    },

    async promote(request, response) {
      const warrior = await repository.findWarrior(request.params.memberId);
      if (!warrior) return response.status(404).json({ error: "Warrior not found." });
      if (warrior.role !== "Henchman" || !warrior.warrior_type_id) {
        return response.status(400).json({ error: "Only a typed Henchman can be promoted." });
      }

      const type = await repository.findWarriorType(warrior.warrior_type_id);
      if (type?.category !== "Henchman") {
        return response.status(400).json({ error: "The selected type is not a Henchman type." });
      }
      if (type.promotion_eligibility !== "eligible") {
        return response.status(409).json({
          error: "This Henchman type is not verified as eligible for Lad's Got Talent.",
          promotionEligibility: type.promotion_eligibility,
          promotionRule: type.promotion_rule,
        });
      }
      const roster = await repository.findRoster(warrior.roster_id);
      const limits = await rosterService.getRosterCapacity(roster);
      if (limits.currentHeroes >= limits.maxHeroes) {
        return response.status(409).json({ error: `This warband already has its maximum of ${limits.maxHeroes} Heroes.` });
      }
      const groupSize = warrior.group_size || 1;
      const promoted = await repository.promoteWarrior(warrior, groupSize);
      if (promoted.missingTalentAdvance) {
        return response.status(409).json({ error: "Record a successful Lad's Got Talent advance before promoting this Henchman." });
      }
      response.json(rosterService.toMember({ ...promoted, member_limit_bonus: type.member_limit_bonus || 0, large: type.large }));
    },

    async update(request, response) {
      if (Object.hasOwn(request.body || {}, "stats")) {
        return response.status(400).json({ error: "Stats are set by the warrior profile and earned through advances." });
      }
      const values = pickFields(request.body, memberFields);
      if (values.name !== undefined && (typeof values.name !== "string" || values.name.trim().length === 0)) {
        return response.status(400).json({ error: "Warrior name must not be empty." });
      }
      if (values.role !== undefined && !warriorCategories.includes(values.role)) {
        return response.status(400).json({ error: "Role must be Hero, Henchman, or Hired Sword." });
      }
      const warrior = await repository.findWarrior(request.params.memberId);
      if (!warrior) return response.status(404).json({ error: "Warrior not found." });
      if (warrior.role === "Hero" && values.warriorTypeId !== undefined && values.warriorTypeId !== warrior.warrior_type_id) {
        return response.status(409).json({ error: "A Hero's type is fixed when hired. Remove and re-hire the Hero to change it." });
      }
      if (warrior.role === "Henchman" && warrior.warrior_type_id && values.warriorTypeId !== undefined && values.warriorTypeId !== warrior.warrior_type_id) {
        return response.status(409).json({ error: "A Henchman group's type is fixed when hired. Remove and re-hire the group to change it." });
      }
      if (warrior.role === "Hired Sword" && warrior.warrior_type_id
        && ((values.warriorTypeId !== undefined && values.warriorTypeId !== warrior.warrior_type_id)
          || (values.type !== undefined && values.type !== warrior.type))) {
        return response.status(409).json({ error: "A Hired Sword's type is fixed when hired. Remove and re-hire the Hired Sword to change it." });
      }
      const groupSizeProvided = values.groupSize !== undefined;
      const groupSize = groupSizeProvided ? Number(values.groupSize) : (warrior.group_size || 1);
      delete values.groupSize;
      if (!Number.isSafeInteger(groupSize) || groupSize < 1 || groupSize > 5) {
        return response.status(400).json({ error: "Group size must be between 1 and 5." });
      }
      const requestedRole = values.role || warrior.role;
      if (requestedRole !== "Henchman" && groupSize !== 1) {
        return response.status(400).json({ error: "Only Henchmen can be groups." });
      }
      if (values.role !== undefined && values.role !== warrior.role) {
        return response.status(400).json({ error: "Use the promotion action to promote an eligible Henchman." });
      }
      const rosterRecord = await repository.findRoster(warrior.roster_id);
      const currentType = warrior.warrior_type_id
        ? await repository.findWarriorType(warrior.warrior_type_id, ["name", "member_limit_bonus", "hire_cost", "starting_experience", "can_gain_experience", "experience_rule"])
        : null;
      let targetType = warrior.warrior_type_id
        ? await rosterService.findSelectableWarriorType(rosterRecord?.warband_id, warrior.warrior_type_id)
        : null;
      let nextMemberLimitBonus = currentType?.member_limit_bonus || 0;
      const warriorTypeId = values.warriorTypeId;
      delete values.warriorTypeId;
      if (warriorTypeId !== undefined) {
        if (warriorTypeId === null || warriorTypeId === "") {
          values.warrior_type_id = null;
          if (values.type === undefined) values.type = "";
          nextMemberLimitBonus = 0;
          targetType = null;
        } else {
          const warriorType = await rosterService.findSelectableWarriorType(rosterRecord?.warband_id, warriorTypeId);
          if (!warriorType) return response.status(400).json({ error: "That warrior type is not available to this warband." });
          if (warriorType.category !== requestedRole) return response.status(400).json({ error: "Warrior type does not match its category." });
          if (requestedRole === "Henchman" && warriorType.hire_cost == null) {
            return response.status(400).json({ error: "This Henchman type has no verified hire cost and cannot be hired." });
          }
          const hireError = await validateExclusiveHire(repository, warrior.roster_id, warriorType.name, warrior.id);
          if (hireError) return response.status(hireError.status).json(hireError.body);
          targetType = warriorType;
          nextMemberLimitBonus = warriorType.member_limit_bonus;
          values.warrior_type_id = warriorType.id;
          values.type = warriorType.name;
          if (!warrior.warrior_type_id) {
            values.stats = warriorType.stats || {};
            values.experience = warriorType.starting_experience ?? 0;
            values.advance_baseline = getAdvancesEarned(getAdvanceTable(requestedRole), values.experience, requestedRole);
          }
        }
      } else if (values.role && warrior.warrior_type_id) {
        const existingType = await repository.findWarriorType(warrior.warrior_type_id, ["category"]);
        if (existingType && existingType.category !== values.role) {
          return response.status(400).json({ error: "Clear or replace the warrior type before changing its category." });
        }
      }
      let additionalHireCost = 0;
      const previousGroupSize = warrior.group_size || 1;
      const assigningHenchmanType = warrior.role === "Henchman"
        && !warrior.warrior_type_id
        && targetType
        && warriorTypeId !== undefined
        && warriorTypeId !== null
        && warriorTypeId !== "";
      if (assigningHenchmanType) {
        additionalHireCost = groupSize * Number(targetType.hire_cost);
      } else if (warrior.role === "Henchman" && groupSize > previousGroupSize) {
        if (targetType?.hire_cost == null) {
          return response.status(400).json({ error: "Additional Henchman models require a verified hire cost." });
        }
        additionalHireCost = (groupSize - previousGroupSize) * Number(targetType.hire_cost);
      }
      if (groupSizeProvided || warriorTypeId !== undefined) {
        if (targetType) {
          const typeCountError = await validateWarriorTypeCount(repository, warrior.roster_id, targetType, warrior.id, groupSize);
          if (typeCountError) return response.status(typeCountError.status).json(typeCountError.body);
        }
        const capacity = await rosterService.getRosterCapacity(rosterRecord);
        const projectedMax = capacity.maxMembers - (currentType?.member_limit_bonus || 0) + nextMemberLimitBonus;
        const previousCountedSize = warrior.role === "Hired Sword" ? 0 : warrior.group_size || 1;
        const nextCountedSize = warrior.role === "Hired Sword" ? 0 : groupSize;
        const projectedMembers = capacity.currentMembers - previousCountedSize + nextCountedSize;
        if (projectedMembers > projectedMax) {
          return response.status(409).json({ error: "This group size or type would put the roster over its maximum size." });
        }
        if (groupSizeProvided) values.group_size = groupSize;
      }
      if (values.experience !== undefined) values.experience = Number(values.experience);
      if (currentType?.name === "Wolf Priest of Ulric" && values.warrior_type_id !== undefined && values.warrior_type_id !== warrior.warrior_type_id) {
        const companion = await repository.findWarriorByTypeName(warrior.roster_id, "Wolf Companion", warrior.id);
        if (companion) return response.status(409).json({ error: "Remove the Wolf Companion before changing the Wolf Priest type." });
      }
      const experienceType = warriorTypeId !== undefined ? targetType : currentType;
      const experienceError = validateExperience(values, requestedRole, experienceType?.can_gain_experience !== false, experienceType?.starting_experience ?? 0, !rosterRecord.campaign_id);
      if (experienceError) return response.status(400).json({ error: experienceError });
      if (Object.keys(values).length === 0) return response.status(400).json({ error: "No valid warrior fields supplied." });
      if (values.experience !== undefined && values.experience < Number(warrior.experience)) {
        const lockedExperience = await repository.getLockedExperience(warrior.id);
        if (values.experience < lockedExperience) {
          const promotionFloor = Number(warrior.promotion_experience || 0);
          return response.status(409).json({ error: lockedExperience === promotionFloor && promotionFloor > 0
            ? `Experience cannot go below ${promotionFloor}, the experience this Hero had when promoted from Henchman.`
            : `Experience cannot go below ${lockedExperience} while an advancement earned at that level is recorded. Remove the advancement award first.` });
        }
      }

      let updatedWarrior;
      if (additionalHireCost > 0 || (warrior.role === "Henchman" && groupSizeProvided)) {
        const update = await repository.updateHenchmanAndAdjustTreasury(warrior.id, values, additionalHireCost);
        if (update.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
        if (update.insufficientFunds) return response.status(409).json({ error: `Adding Henchman models costs ${additionalHireCost} GC, but the roster does not have enough gold.` });
        updatedWarrior = update.warrior;
      } else {
        [updatedWarrior] = await repository.updateWarrior(request.params.memberId, values);
      }
      response.json(rosterService.toMember(updatedWarrior));
    },

    async delete(request, response) {
      const warrior = await repository.findWarrior(request.params.memberId, ["id", "roster_id", "warrior_type_id"]);
      if (!warrior) return response.status(404).json({ error: "Warrior not found." });
      const type = warrior.warrior_type_id ? await repository.findWarriorType(warrior.warrior_type_id, ["name"]) : null;
      if (type?.name === "Wolf Priest of Ulric") {
        const companion = await repository.findWarriorByTypeName(warrior.roster_id, "Wolf Companion", warrior.id);
        if (companion) return response.status(409).json({ error: "Remove the Wolf Companion before removing the Wolf Priest." });
      }
      const deletion = await repository.deleteWarriorAndRefund(request.params.memberId);
      if (deletion.missingWarrior) return response.status(404).json({ error: "Warrior not found." });
      if (deletion.missingRoster) return response.status(404).json({ error: "Roster not found." });
      response.status(204).end();
    },
  };
}

module.exports = { createMemberController };
