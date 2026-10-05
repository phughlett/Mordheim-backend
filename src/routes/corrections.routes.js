const express = require("express");
const { createCorrectionService } = require("../services/corrections.service");

function createCorrectionRoutes(db, options) {
  const router = express.Router();
  const service = createCorrectionService(db, options);
  router.get("/corrections/config", (_request, response) => response.json(service.publicConfig()));
  router.post("/corrections", async (request, response) => {
    const result = await service.submit(request.body, request.ip);
    if (result.status === 429) response.set("Retry-After", "3600");
    response.status(result.status).json(result.body);
  });
  return router;
}

module.exports = { createCorrectionRoutes };
