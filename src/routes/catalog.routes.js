const express = require("express");
const { createCatalogController } = require("../controllers/catalog.controller");
const { createCatalogRepository } = require("../repositories/catalog.repository");
const { createCatalogService } = require("../services/catalog.service");

function createCatalogRoutes(db) {
  const router = express.Router();
  const repository = createCatalogRepository(db);
  const service = createCatalogService(repository);
  const controller = createCatalogController(service);

  router.get("/health", controller.health);
  router.get("/warbands", controller.listWarbands);
  router.get("/warbands/:warbandId/warrior-types", controller.listWarriorTypes);

  return router;
}

module.exports = { createCatalogRoutes };
