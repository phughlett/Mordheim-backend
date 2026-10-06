const warriorCategories = ["Hero", "Henchman", "Hired Sword"];
const { getMutationAccess } = require("./mutation-rules.service");

function createCatalogService(repository) {
  return {
    async health() {
      try {
        await repository.checkConnection();
        return { status: "ok", database: "connected" };
      } catch {
        return { status: "error", database: "unavailable" };
      }
    },

    async listWarbands() {
      const warbands = await repository.listWarbands();
      return warbands.map((warband) => ({
        id: warband.id,
        name: warband.name,
        displayName: warband.display_name ?? warband.name,
        grade: warband.grade,
        sourceUrl: warband.source_url,
        specialRules: warband.special_rules ?? [],
        sourceReference: warband.source_reference,
        maxHeroes: warband.max_heroes,
        maxMembers: warband.max_members,
        limitsSourceReference: warband.limits_source_reference,
        limitsRule: warband.limits_rule,
      }));
    },

    async listWarriorTypes(warbandId, query) {
      const warband = await repository.findWarband(warbandId);
      if (!warband) {
        return { status: 404, body: { error: "Warband not found." } };
      }
      if (query.category !== undefined && !warriorCategories.includes(query.category)) {
        return { status: 400, body: { error: "Unknown warrior category." } };
      }
      const types = await repository.listWarriorTypes(warbandId, {
        category: query.category,
        includeUnavailable: query.includeUnavailable === "true",
      });
      return { status: 200, body: types.map((type) => {
        const access = getMutationAccess(warband.name, type.name, type.category);
        return { ...type, mutationRequired: access.required, mutationOptions: access.options };
      }) };
    },
  };
}

module.exports = { createCatalogService };
