const { getStatMaximumProfile, racialMaximums } = require("./advancement-rules.service");
const { toCampaign } = require("./campaign.service");

const statKeys = ["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"];

function createRosterService(repository) {
  async function fetchRosterMembers(rosterId) {
    return (await repository.listMembers(rosterId)).map(toMember);
  }

  async function getRosterCapacity(roster) {
    const { warband, warriors, modifiers, selectedRows } = await repository.getCapacityData(roster);
    const selectedIds = new Set(selectedRows);
    const selectedModifiers = modifiers.filter((modifier) => selectedIds.has(modifier.id));
    const availableModifiers = warband
      ? modifiers.filter((modifier) => !modifier.excluded_warbands.includes(warband.name))
      : [];
    const memberTypeBonus = warriors.reduce((total, warrior) => total + (warrior.member_limit_bonus || 0), 0);
    const itemBonus = selectedModifiers.reduce((total, modifier) => total + modifier.member_limit_bonus, 0);
    const baseMaxHeroes = warband?.max_heroes ?? 6;
    const baseMaxMembers = warband?.max_members ?? 15;

    return {
      currentMembers: warriors.reduce((total, warrior) => total + (warrior.role === "Hired Sword" ? 0 : warrior.group_size || 1), 0),
      currentHeroes: warriors.filter((warrior) => warrior.role === "Hero").length,
      maxHeroes: baseMaxHeroes,
      baseMaxMembers,
      maxMembers: baseMaxMembers + memberTypeBonus + itemBonus,
      memberTypeBonus,
      itemBonus,
      limitsSourceReference: warband?.limits_source_reference || "3Campaigns.pdf — Campaigns: Heroes and Henchmen",
      limitsRule: warband?.limits_rule || "Maximum 6 Heroes and 15 total warriors unless the warband or an eligible capacity modifier states otherwise.",
      selectedModifiers,
      availableModifiers,
    };
  }

  async function toRosterResponse(roster, members) {
    const campaign = roster.campaign_id ? await repository.findCampaign(roster.campaign_id) : null;
    const capacity = await getRosterCapacity(roster);
    return {
      ...toRoster(roster, members),
      maxHeroes: capacity.maxHeroes,
      maxMembers: capacity.baseMaxMembers,
      ownerId: roster.user_id ?? null,
      player: roster.user_id ? (await repository.findUsername(roster.user_id)) ?? null : null,
      shareCode: roster.share_code ?? null,
      campaignId: campaign?.id ?? null,
      campaignName: campaign?.name ?? null,
      campaignMaxGc: campaign?.max_gc ?? null,
      capacity,
    };
  }

  return {
    fetchRosterMembers,
    findSelectableWarriorType: (warbandId, warriorTypeId) => repository.findSelectableWarriorType(warbandId, warriorTypeId),
    getRosterCapacity,
    toMember,
    toRosterResponse,
  };
}

function toRoster(roster, members) {
  return {
    id: roster.id,
    name: roster.name,
    warband: roster.warband || "",
    warbandId: roster.warband_id || null,
    maxHeroes: roster.max_heroes ?? 6,
    maxMembers: roster.max_members ?? 15,
    treasury: String(roster.treasury),
    wyrdstone: String(roster.wyrdstone),
    rating: String(calculateWarbandRating(members)),
    memberOrderCustomized: Boolean(roster.member_order_customized),
    campaign: toCampaign(roster),
    members,
  };
}

function calculateWarbandRating(members) {
  return members.reduce((rating, member) => {
    const modelCount = member.role === "Henchman" ? member.groupSize : 1;
    const experience = Number(member.experience) || 0;
    const ratingBaseOverride = member.ratingBaseOverride ?? member.rating_base_override;
    const hasHiredSwordRatingModifier = member.role === "Hired Sword" && ratingBaseOverride != null;
    const ratingBase = ratingBaseOverride == null
      ? 5 + (member.large ? 15 : 0)
      : Number(ratingBaseOverride) + (hasHiredSwordRatingModifier ? 5 : 0);
    const experienceMultiplier = ratingBaseOverride == null
      ? 1
      : Number(member.ratingExperienceMultiplier ?? member.rating_experience_multiplier ?? 1);
    return rating + modelCount * (ratingBase + experience * experienceMultiplier);
  }, 0);
}

function toMember(warrior) {
  return {
    id: warrior.id,
    name: warrior.name,
    groupSize: warrior.group_size || 1,
    position: warrior.position,
    type: warrior.type,
    warriorTypeId: warrior.warrior_type_id || null,
    memberLimitBonus: warrior.member_limit_bonus || 0,
    large: Boolean(warrior.large),
    ratingBaseOverride: warrior.rating_base_override ?? null,
    ratingExperienceMultiplier: Number(warrior.rating_experience_multiplier ?? 1),
    role: warrior.role,
    experience: String(warrior.experience),
    minimumExperience: Math.max(Number(warrior.starting_experience || 0), Number(warrior.locked_experience || 0), Number(warrior.promotion_experience || 0)),
    stats: Object.fromEntries(statKeys.map((key) => [key, warrior.stats?.[key] ?? ""])),
    initialStats: Object.fromEntries(statKeys.map((key) => [key, warrior.initial_stats?.[key] ?? ""])),
    maximumStats: racialMaximums[getStatMaximumProfile(warrior.warband_name, warrior.warrior_type_name)] || null,
    equipment: warrior.equipment,
    skills: warrior.skills,
    notes: warrior.notes,
  };
}

module.exports = { createRosterService };
