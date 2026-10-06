const { PRE_BATTLE_STEPS, advanceCampaign, reopenCampaign } = require("../services/campaign.service");
const {
  isNonEmptyString,
  normalizeStats,
  pickFields,
  resolveWarbandSelection,
  validateExclusiveHire,
  validateExperience,
  validateNonNegativeIntegers,
  validateWarriorTypeCount,
} = require("../services/roster-validation.service");
const { getAdvanceTable, getAdvancesEarned } = require("../services/advancement-rules.service");
const { getMutationAccess, priceMutations } = require("../services/mutation-rules.service");

const rosterFields = ["name", "warband", "warbandId", "treasury", "wyrdstone", "battlesFought"];
const memberFields = ["name", "type", "warriorTypeId", "equipmentChoiceId", "groupSize", "role", "experience", "equipment", "skills", "notes"];
const warriorCategories = ["Hero", "Henchman", "Hired Sword"];

function validateBattles(values, campaign) {
  if (values.battlesFought === undefined) return null;
  if (campaign) return { status: 409, error: "Campaign battle counts are managed by the battle sequence." };
  const count = values.battlesFought;
  if ((typeof count !== "number" && !(typeof count === "string" && /^\d+$/.test(count)))
    || !Number.isSafeInteger(Number(count)) || Number(count) < 0 || Number(count) > 2147483647) {
    return { status: 400, error: "battlesFought must be a whole number from 0 to 2147483647." };
  }
  values.battles_fought = Number(count);
  delete values.battlesFought;
  return null;
}

function createRosterController(repository, rosterService) {
  return {
    async list(request, response) {
      const rosters = await repository.listRosters(request.user.id);
      response.json(await Promise.all(rosters.map(async (roster) =>
        rosterService.toRosterResponse(roster, await rosterService.fetchRosterMembers(roster.id)),
      )));
    },

    async campaignRosters(request, response) {
      if (!(await repository.isCampaignMember(request.params.campaignId, request.user.id))) return response.status(403).json({ error: "You have not joined this campaign." });
      const rosters = await repository.campaignRosters(request.params.campaignId);
      response.json(await Promise.all(rosters.map(async (roster) =>
        rosterService.toRosterResponse(roster, await rosterService.fetchRosterMembers(roster.id)),
      )));
    },

    async listShared(request, response) {
      const rosters = await repository.listSharedRosters(request.user.id);
      response.json(await Promise.all(rosters.map(async (roster) =>
        rosterService.toRosterResponse(roster, await rosterService.fetchRosterMembers(roster.id)),
      )));
    },

    async redeemShare(request, response) {
      const code = String(request.body?.code || "").trim().toLowerCase();
      const roster = code ? await repository.redeemShareCode(code, request.user.id) : null;
      if (!roster) return response.status(404).json({ error: "That share code is not valid." });
      response.json(await rosterService.toRosterResponse(roster, await rosterService.fetchRosterMembers(roster.id)));
    },

    async share(request, response) {
      const roster = await repository.findRoster(request.params.rosterId);
      if (!roster) return response.status(404).json({ error: "Roster not found." });
      if (roster.user_id !== request.user.id) return response.status(403).json({ error: "Only the owner can share a warband." });
      const code = request.method === "DELETE" ? null : roster.share_code || require("crypto").randomBytes(6).toString("hex");
      await repository.setShareCode(roster.id, code);
      response.json(await rosterService.toRosterResponse(await repository.findRoster(roster.id), await rosterService.fetchRosterMembers(roster.id)));
    },

    async create(request, response) {
      const values = pickFields(request.body, rosterFields);
      const battleError = validateBattles(values, Boolean(request.body?.campaignId));
      if (battleError) return response.status(battleError.status).json({ error: battleError.error });
      values.user_id = request.user.id;
      if (request.body?.campaignId) {
        const campaign = await repository.findCampaign(request.body.campaignId);
        if (!campaign) return response.status(400).json({ error: "Campaign not found." });
        if (!(await repository.isCampaignMember(campaign.id, request.user.id))) return response.status(403).json({ error: "Join this campaign before creating a warband in it." });
        values.campaign_id = campaign.id;
        values.treasury = campaign.max_gc;
        if (values.wyrdstone !== undefined && Number(values.wyrdstone) !== 0) {
          return response.status(409).json({ error: "Campaign warbands start with no Wyrdstone." });
        }
        values.wyrdstone = 0;
      } else {
        // Freebuild: no campaign, so the player chooses the starting gold.
        values.campaign_id = null;
        const gold = request.body?.treasury === undefined ? 500 : Number(request.body.treasury);
        if (!Number.isSafeInteger(gold) || gold < 0) return response.status(400).json({ error: "Starting gold must be a non-negative whole number." });
        values.treasury = gold;
      }
      if (values.name !== undefined && !isNonEmptyString(values.name)) {
        return response.status(400).json({ error: "Roster name must not be empty." });
      }
      const warbandError = await resolveWarbandSelection(repository, values);
      if (warbandError !== true) return response.status(warbandError.status).json(warbandError.body);
      const integerError = validateNonNegativeIntegers(values, ["treasury", "wyrdstone"]);
      if (integerError) return response.status(400).json({ error: integerError });
      if (values.wyrdstone > 2147483647) return response.status(400).json({ error: "wyrdstone must not exceed 2147483647." });

      const [roster] = await repository.createRoster(values);
      response.status(201).json(await rosterService.toRosterResponse(roster, []));
    },

    async get(request, response) {
      const roster = await repository.findRoster(request.params.rosterId);
      if (!roster) return response.status(404).json({ error: "Roster not found." });
      response.json(await rosterService.toRosterResponse(roster, await rosterService.fetchRosterMembers(roster.id)));
    },

    async reorderMembers(request, response) {
      const roster = await repository.findRoster(request.params.rosterId);
      if (!roster) return response.status(404).json({ error: "Roster not found." });
      const memberIds = request.body?.memberIds;
      if (!Array.isArray(memberIds) || memberIds.some((id) => typeof id !== "string")) {
        return response.status(400).json({ error: "memberIds must be an array of member IDs." });
      }
      const currentMembers = await repository.listMembers(roster.id);
      const currentIds = new Set(currentMembers.map((member) => member.id));
      const requestedIds = new Set(memberIds);
      if (requestedIds.size !== memberIds.length || requestedIds.size !== currentIds.size || memberIds.some((id) => !currentIds.has(id))) {
        return response.status(400).json({ error: "memberIds must contain every roster member exactly once." });
      }

      await repository.saveMemberOrder(roster.id, memberIds);
      const updatedRoster = await repository.findRoster(roster.id);
      response.json(await rosterService.toRosterResponse(updatedRoster, await rosterService.fetchRosterMembers(roster.id)));
    },

    async advanceCampaign(request, response) {
      const roster = await repository.findRoster(request.params.rosterId);
      if (!roster) return response.status(404).json({ error: "Roster not found." });
      if (!roster.campaign_id) return response.status(409).json({ error: "Freebuild warbands are not part of a campaign sequence." });
      if (roster.campaign_id && roster.campaign_phase === "battle") return response.status(409).json({ error: "This warband is in a battle. Advance the battle from the Battle panel." });
      if (roster.campaign_id && roster.campaign_phase === "pre_battle" && roster.campaign_step === PRE_BATTLE_STEPS.length) {
        return response.status(409).json({ error: "Set up the battle (teams) and start it from the Battle panel." });
      }
      const [{ count }] = await repository.countHeroes(roster.id);
      const result = advanceCampaign(roster, { scenario: request.body?.scenario, heroCount: Number(count), endBattle: request.body?.endBattle === true });
      if (result.error) return response.status(409).json({ error: result.error });
      const [updated] = await repository.updateRoster(roster.id, result.updates);
      response.json(await rosterService.toRosterResponse(updated, await rosterService.fetchRosterMembers(updated.id)));
    },

    async reopenCampaign(request, response) {
      const roster = await repository.findRoster(request.params.rosterId);
      if (!roster) return response.status(404).json({ error: "Roster not found." });
      if (!roster.campaign_id) return response.status(409).json({ error: "Freebuild warbands are not part of a campaign sequence." });
      const result = reopenCampaign(roster);
      if (result.error) return response.status(409).json({ error: result.error });
      const [updated] = await repository.updateRoster(roster.id, result.updates);
      response.json(await rosterService.toRosterResponse(updated, await rosterService.fetchRosterMembers(updated.id)));
    },

    async update(request, response) {
      const values = pickFields(request.body, rosterFields);
      const rosterExists = await repository.findRoster(request.params.rosterId);
      if (!rosterExists) return response.status(404).json({ error: "Roster not found." });
      const battleError = validateBattles(values, Boolean(rosterExists.campaign_id));
      if (battleError) return response.status(battleError.status).json({ error: battleError.error });
      if (rosterExists.campaign_id && (values.treasury !== undefined || values.wyrdstone !== undefined)) {
        return response.status(409).json({ error: "Gold Crowns and Wyrdstone cannot be edited directly in Campaign mode." });
      }
      if (values.name !== undefined && !isNonEmptyString(values.name)) {
        return response.status(400).json({ error: "Roster name must not be empty." });
      }
      const warbandError = await resolveWarbandSelection(repository, values);
      if (warbandError !== true) return response.status(warbandError.status).json(warbandError.body);
      if (values.warband_id !== undefined) {
        const assignedTypeIds = await repository.listAssignedWarriorTypeIds(rosterExists.id);
        if (assignedTypeIds.length > 0) {
          const eligibleTypeIds = values.warband_id
            ? new Set(await repository.listEligibleWarriorTypeIds(values.warband_id))
            : new Set();
          if (assignedTypeIds.some((typeId) => !eligibleTypeIds.has(typeId))) {
            return response.status(409).json({ error: "Cannot change warband while assigned warriors are unavailable to the new warband." });
          }
        }
      }
      if (values.warband_id !== undefined) {
        const targetWarband = values.warband_id ? await repository.findWarband(values.warband_id) : null;
        const currentCapacity = await rosterService.getRosterCapacity(rosterExists);
        const targetCapacity = await rosterService.getRosterCapacity({ ...rosterExists, warband_id: values.warband_id });
        const targetMax = (targetWarband?.max_members ?? 15)
          + currentCapacity.memberTypeBonus
          + targetCapacity.itemBonus;
        if (currentCapacity.currentMembers > targetMax) {
          return response.status(409).json({ error: "The roster exceeds the new warband's maximum size." });
        }
      }
      const integerError = validateNonNegativeIntegers(values, ["treasury", "wyrdstone"]);
      if (integerError) return response.status(400).json({ error: integerError });
      if (values.wyrdstone > 2147483647) return response.status(400).json({ error: "wyrdstone must not exceed 2147483647." });
      if (Object.keys(values).length === 0) return response.status(400).json({ error: "No valid roster fields supplied." });

      const updates = { ...values };
      if (values.warband_id !== undefined && values.warband_id !== rosterExists.warband_id) {
        updates.member_order_customized = false;
      }
      const [roster] = await repository.updateRoster(request.params.rosterId, updates);
      if (!roster) return response.status(404).json({ error: "Roster not found." });
      response.json(await rosterService.toRosterResponse(roster, await rosterService.fetchRosterMembers(roster.id)));
    },

    async setCapacityModifiers(request, response) {
      const roster = await repository.findRoster(request.params.rosterId);
      if (!roster) return response.status(404).json({ error: "Roster not found." });
      return response.status(409).json({ error: "Capacity item bonuses are automatic. The warband leader must carry the Halfling Cookbook in their inventory." });
    },

    async delete(request, response) {
      const deleted = await repository.deleteRoster(request.params.rosterId);
      if (!deleted) return response.status(404).json({ error: "Roster not found." });
      response.status(204).end();
    },

    async addMember(request, response) {
      if (Object.hasOwn(request.body || {}, "stats")) {
        return response.status(400).json({ error: "Stats are set by the warrior profile and earned through advances." });
      }
      const rosterExists = await repository.findRoster(request.params.rosterId);
      if (!rosterExists) return response.status(404).json({ error: "Roster not found." });
      if (!rosterExists.warband_id) return response.status(400).json({ error: "Select a warband before adding warriors." });
      const capacity = await rosterService.getRosterCapacity(rosterExists);

      const values = pickFields(request.body, memberFields);
      if (!isNonEmptyString(values.name)) return response.status(400).json({ error: "Warrior name is required." });
      if (!warriorCategories.includes(values.role)) return response.status(400).json({ error: "Role must be Hero, Henchman, or Hired Sword." });
      if (["Hero", "Henchman"].includes(values.role) && !values.warriorTypeId) {
        return response.status(400).json({ error: `Select a ${values.role} type with a verified hire cost.` });
      }
      const groupSize = values.groupSize === undefined ? 1 : Number(values.groupSize);
      delete values.groupSize;
      if (!Number.isSafeInteger(groupSize) || groupSize < 1 || groupSize > 5) {
        return response.status(400).json({ error: "Group size must be between 1 and 5." });
      }
      if (values.role !== "Henchman" && groupSize !== 1) {
        return response.status(400).json({ error: "Only Henchmen can be added as a group." });
      }
      const warriorTypeId = values.warriorTypeId;
      delete values.warriorTypeId;
      const equipmentChoiceId = values.equipmentChoiceId;
      delete values.equipmentChoiceId;
      let selectedWarriorType = null;
      if (warriorTypeId) {
        selectedWarriorType = await rosterService.findSelectableWarriorType(rosterExists.warband_id, warriorTypeId);
        if (!selectedWarriorType) return response.status(400).json({ error: "That warrior type is not available to this warband." });
        if (selectedWarriorType.category !== values.role) return response.status(400).json({ error: "Warrior type does not match its category." });
        const hireError = await validateExclusiveHire(repository, request.params.rosterId, selectedWarriorType.name, null);
        if (hireError) return response.status(hireError.status).json(hireError.body);
        const typeCountError = await validateWarriorTypeCount(repository, request.params.rosterId, selectedWarriorType, null, groupSize);
        if (typeCountError) return response.status(typeCountError.status).json(typeCountError.body);
        values.warrior_type_id = selectedWarriorType.id;
        values.type = selectedWarriorType.name;
      } else {
        values.warrior_type_id = null;
      }
      if (values.role === "Hired Sword" && selectedWarriorType) {
        const equipmentChoices = selectedWarriorType.equipment_choices ?? [];
        if (equipmentChoices.length) {
          const selectedEquipment = equipmentChoices.find((choice) => choice.id === equipmentChoiceId);
          if (!selectedEquipment) return response.status(400).json({ error: "Choose the Hired Sword's starting equipment." });
          // The matching hired_sword_starting_gear rows are granted via addFreeStartingEquipment once the
          // warrior is created; starting gear now lives in the structured inventory, not this free-text field.
          values.equipment_choice_id = selectedEquipment.id;
        } else if (equipmentChoiceId !== undefined) {
          return response.status(400).json({ error: "This Hired Sword has no equipment choices." });
        }
      } else if (equipmentChoiceId !== undefined) {
        return response.status(400).json({ error: "Equipment choices are only used when hiring a Hired Sword." });
      }
      const warband = await repository.findWarband(rosterExists.warband_id);
      const mutationAccess = getMutationAccess(warband.name, selectedWarriorType?.name, values.role);
      const mutationPurchase = priceMutations(
        request.body?.mutationIds === undefined ? [] : request.body.mutationIds,
        mutationAccess,
        Boolean(rosterExists.campaign_id) && mutationAccess.required,
      );
      if (mutationPurchase.error) return response.status(400).json({ error: mutationPurchase.error });
      if (values.role === "Hero" && capacity.currentHeroes >= capacity.maxHeroes) {
        return response.status(409).json({ error: `This warband already has its maximum of ${capacity.maxHeroes} Heroes.` });
      }
      const countedGroupSize = values.role === "Hired Sword" ? 0 : groupSize;
      if (capacity.currentMembers + countedGroupSize > capacity.maxMembers + (selectedWarriorType?.member_limit_bonus || 0)) {
        return response.status(409).json({ error: `This warband is at its maximum size of ${capacity.maxMembers} members.` });
      }
      values.experience = values.experience === undefined ? (selectedWarriorType?.starting_experience ?? 0) : Number(values.experience);
      const experienceError = validateExperience(
        values,
        values.role,
        selectedWarriorType?.can_gain_experience !== false,
        selectedWarriorType?.starting_experience ?? 0,
        !rosterExists.campaign_id,
      );
      if (experienceError) return response.status(400).json({ error: experienceError });
      const statsResult = normalizeStats(selectedWarriorType?.stats ?? {});
      if (statsResult.error) return response.status(400).json({ error: statsResult.error });
      values.stats = statsResult.value;
      values.advance_baseline = getAdvancesEarned(getAdvanceTable(values.role), selectedWarriorType?.starting_experience ?? 0, values.role);
      for (const field of ["type", "equipment", "skills", "notes"]) values[field] = typeof values[field] === "string" ? values[field] : "";
      const warriorValues = {
        ...values,
        roster_id: request.params.rosterId,
        group_size: groupSize,
      };
      let warrior;
      if (values.role === "Hero" || values.role === "Henchman") {
        if (selectedWarriorType.hire_cost === null || selectedWarriorType.hire_cost === undefined) {
          return response.status(400).json({ error: `This ${values.role} type has no verified hire cost and cannot be hired.` });
        }
        const totalHireCost = Number(selectedWarriorType.hire_cost) * (values.role === "Henchman" ? groupSize : 1) + mutationPurchase.totalCost;
        const hire = await repository.hireWarrior(warriorValues, totalHireCost, mutationPurchase.entries);
        if (hire.insufficientFunds) {
          return response.status(409).json({ error: `This hire costs ${totalHireCost} GC, but the roster does not have enough gold.` });
        }
        warrior = hire.warrior;
      } else if (selectedWarriorType?.hire_cost != null) {
        const hireCost = Number(selectedWarriorType.hire_cost);
        const hire = await repository.hireWarrior(warriorValues, hireCost);
        if (hire.insufficientFunds) {
          return response.status(409).json({ error: `This hire costs ${hireCost} GC, but the roster does not have enough gold.` });
        }
        warrior = hire.warrior;
      } else {
        const [{ count }] = await repository.countRosterWarriors(request.params.rosterId);
        [warrior] = await repository.createWarrior({ ...warriorValues, position: Number(count) });
      }
      response.status(201).json(rosterService.toMember({ ...warrior, member_limit_bonus: selectedWarriorType?.member_limit_bonus || 0 }));
    },
  };
}

module.exports = { createRosterController };
