const { randomUUID } = require("node:crypto");

const interactions = {
  "POST /auth/register": "account.register",
  "POST /auth/login": "account.login",
  "POST /auth/logout": "account.logout",
  "GET /auth/me": "account.session",
  "POST /members/:memberId/skills": "skill.learn",
  "DELETE /members/:memberId/skills/:warriorSkillId": "skill.forget",
  "POST /members/:memberId/spells": "spell.learn",
  "POST /members/:memberId/spells/roll": "spell.roll",
  "DELETE /members/:memberId/spells/:warriorSpellId": "spell.forget",
  "POST /members/:memberId/spells/:warriorSpellId/reduce-difficulty": "spell.reduce_difficulty",
  "POST /members/:memberId/spells/learn-lesser-magic": "tome.consume",
  "DELETE /members/:memberId/spells/tomes/:useId": "tome.cancel",
  "POST /members/:memberId/advances": "advance.record",
  "POST /members/:memberId/advance-purchases": "advance.purchase",
  "DELETE /members/:memberId/advances/:advanceId": "advance.remove",
  "DELETE /members/:memberId/advances/:advanceId/choice": "advance.reset_choice",
  "POST /members/:memberId/equipment": "equipment.purchase",
  "DELETE /members/:memberId/equipment": "equipment.refund_or_sell",
  "DELETE /members/:memberId/equipment/:inventoryItemId": "equipment.refund_or_sell",
  "POST /members/:memberId/promote": "member.promote",
  "POST /members/:memberId/injuries/preview": "injury.preview",
  "POST /members/:memberId/injuries/:previewId/apply": "injury.apply",
  "DELETE /members/:memberId/injuries/:previewId": "injury.cancel_preview",
  "POST /members/:memberId/injuries/old-wound": "injury.check_old_wound",
  "DELETE /rosters/:rosterId/injuries/:injuryId": "injury.remove",
  "POST /rosters/:rosterId/graveyard/:entryId/restore": "graveyard.restore",
  "POST /rosters/:rosterId/members": "member.hire",
  "POST /rosters/:rosterId/casualties": "member.casualty",
  "POST /rosters/:rosterId/campaign/advance": "campaign.advance_stage",
  "POST /rosters/:rosterId/campaign/reopen": "campaign.reopen_stage",
  "POST /shared-rosters/join": "roster.join_share",
  "POST /campaigns/join": "campaign.join",
  "POST /campaigns/:campaignId/battles": "battle.create",
  "POST /battles/:battleId/start": "battle.start",
  "POST /battles/:battleId/advance": "battle.advance",
  "PUT /battles/:battleId/participants": "battle.set_participants",
  "DELETE /battles/:battleId/participants/:rosterId": "battle.remove_participant",
};
for (const action of ["search", "quote", "purchase", "spoils", "map", "transfer", "sell", "upgrade", "cancel-upgrade", "hero-status"]) {
  interactions[`POST /rosters/:rosterId/trading/${action}`] = `trading.${action.replaceAll("-", "_")}`;
}
const createdResources = {
  "/rosters": "rosterId", "/rosters/:rosterId/members": "memberId",
  "/campaigns": "campaignId", "/campaigns/:campaignId/battles": "battleId",
};
const patchFields = {
  "/members/:memberId": ["name", "type", "warriorTypeId", "role", "experience", "stats", "equipment", "skills", "notes", "groupSize"],
  "/rosters/:rosterId": ["name", "warband", "warbandId", "warband_id", "treasury", "battlesFought", "notes"],
  "/campaigns/:campaignId": ["name", "maxGc"],
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const resourceNames = { rosters: "rosterId", members: "memberId", campaigns: "campaignId", battles: "battleId", warbands: "warbandId" };
const safeSegments = new Set([
  ...Object.keys(resourceNames), "api", "auth", "register", "login", "logout", "me", "health",
  "corrections", "config", "shared-rosters", "join", "share", "warrior-types", "shop",
  "skills", "spells", "roll", "discipline", "tomes", "learn-lesser-magic", "reduce-difficulty",
  "advances", "advance-purchases", "choice", "equipment", "mutations", "promote", "injuries",
  "preview", "old-wound", "apply", "graveyard", "restore", "casualties", "campaign", "advance",
  "reopen", "member-order", "capacity-modifiers", "lads-got-talent-options", "skill-category-overrides",
  "trading", "search", "quote", "purchase", "spoils", "map", "transfer", "sell", "upgrade",
  "cancel-upgrade", "hero-status", "start", "finish", "leave", "ready", "participants",
]);

function requestContext(request) {
  const segments = request.originalUrl.split("?")[0].split("/");
  const resources = {};
  segments.forEach((segment, index) => {
    if (uuidPattern.test(segment) && resourceNames[segments[index - 1]]) {
      resources[resourceNames[segments[index - 1]]] = segment;
    }
  });
  return {
    path: segments.map((segment) => !segment || safeSegments.has(segment) ? segment : uuidPattern.test(segment) ? ":id" : ":redacted").join("/"),
    resources,
  };
}

function interactionFor(method, route, path) {
  const candidate = route ?? path.replace(/^\/api/, "");
  const normalized = candidate.replace(/:[^/]+/g, ":id");
  const named = Object.entries(interactions).find(([key]) =>
    key === `${method} ${candidate}` || key.replace(/:[^/]+/g, ":id") === `${method} ${normalized}`);
  if (named) return named[1];
  if (!route && path.includes(":redacted")) return "http.unmatched";
  const verb = { GET: "read", POST: "create", PATCH: "update", PUT: "set", DELETE: "delete", OPTIONS: "preflight" }[method] ?? "request";
  return `${candidate.split("/").filter((part) => part && !part.startsWith(":")).join(".") || "http"}.${verb}`;
}

function createRequestLogger(write = (entry) => {
  const output = entry.level === "error" ? console.error : entry.level === "warn" ? console.warn : console.log;
  output(JSON.stringify(entry));
}) {
  return function logApiRequest(request, response, next) {
    const startedAt = process.hrtime.bigint();
    const requestId = randomUUID();
    const context = requestContext(request);
    let logged = false;
    response.setHeader("X-Request-ID", requestId);
    const json = response.json;
    response.json = function logCreatedResource(body) {
      const resource = request.method === "POST" && response.statusCode === 201 ? createdResources[request.route?.path] : null;
      if (resource && uuidPattern.test(body?.id)) {
        response.locals.logResources = { ...response.locals.logResources, [resource]: body.id };
      }
      return json.call(this, body);
    };
    function complete(aborted) {
      if (logged) return;
      logged = true;
      const status = response.statusCode;
      const route = typeof request.route?.path === "string" ? request.route.path : null;
      const interaction = interactionFor(request.method, route, context.path);
      const changedFields = request.method === "PATCH" && patchFields[route]
        ? patchFields[route].filter((field) => Object.hasOwn(request.body ?? {}, field)) : [];
      write({
        timestamp: new Date().toISOString(),
        level: aborted || status >= 500 ? "error" : status >= 400 ? "warn" : "info",
        event: aborted ? "request.aborted" : "request.completed",
        requestId,
        interaction,
        method: request.method,
        path: context.path,
        route: route ? `/api${route}` : null,
        userId: request.user?.id ?? null,
        ...context.resources,
        ...response.locals.logResources,
        status: aborted ? null : status,
        outcome: aborted ? "aborted" : status >= 500 ? "failed" : status >= 400 ? "rejected" : "succeeded",
        durationMs: Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(1)),
        ...(changedFields.length ? { changedFields } : {}),
        ...response.locals.logError,
      });
    }
    response.on("finish", () => complete(false));
    response.on("close", () => complete(!response.writableFinished));
    next();
  };
}

function logRequestError(error, response) {
  // Database errors can contain SQL parameters, so never serialize the error itself.
  response.locals.logError = {
    errorType: ["Error", "TypeError", "RangeError", "SyntaxError"].includes(error?.name) ? error.name : "Error",
    ...(typeof error?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? { errorCode: error.code } : {}),
  };
}

module.exports = { createRequestLogger, logRequestError };
