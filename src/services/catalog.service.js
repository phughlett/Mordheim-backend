const warriorCategories = ["Hero", "Henchman", "Hired Sword"];

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
        sourceReference: warband.source_reference,
        maxHeroes: warband.max_heroes,
        maxMembers: warband.max_members,
        limitsSourceReference: warband.limits_source_reference,
        limitsRule: warband.limits_rule,
      }));
    },

    async listWarriorTypes(warbandId, query) {
      if (!await repository.findWarband(warbandId)) {
        return { status: 404, body: { error: "Warband not found." } };
      }
      if (query.category !== undefined && !warriorCategories.includes(query.category)) {
        return { status: 400, body: { error: "Unknown warrior category." } };
      }
      const types = await repository.listWarriorTypes(warbandId, {
        category: query.category,
        includeUnavailable: query.includeUnavailable === "true",
      });
      return { status: 200, body: types };
    },
  };
}

module.exports = { createCatalogService };
