function createCatalogController(service) {
  return {
    async health(_request, response) {
      const result = await service.health();
      response.status(result.status === "ok" ? 200 : 503).json(result);
    },

    async listWarbands(_request, response, next) {
      try {
        response.json(await service.listWarbands());
      } catch (error) {
        next(error);
      }
    },

    async listWarriorTypes(request, response, next) {
      try {
        const result = await service.listWarriorTypes(request.params.warbandId, request.query);
        response.status(result.status).json(result.body);
      } catch (error) {
        next(error);
      }
    },
  };
}

module.exports = { createCatalogController };
