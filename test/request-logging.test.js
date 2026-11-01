const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const express = require("express");
const { createRequestLogger, logRequestError } = require("../src/middleware/request-logging");
const records = [];
const memberId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const userId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let server, base;
before(() => {
  const app = express();
  app.use("/api", createRequestLogger((record) => records.push(record)));
  app.use(express.json());
  const router = express.Router();
  app.use("/api", router);
  router.patch("/members/:memberId", (req, res) => {
    req.user = { id: userId, username: "private-username" };
    res.locals.logResources = { rosterId: "cccccccc-cccc-cccc-cccc-cccccccccccc" };
    res.json({ updated: true });
  });
  router.post("/auth/login", (_req, res) => res.status(401).json({ error: "Wrong username or password." }));
  router.delete("/members/:memberId/skills/:warriorSkillId", (_req, res) => res.status(409).json({ error: "Choice locked." }));
  router.get("/health", (_req, res) => res.json({ status: "ok" }));
  router.get("/failure", (_req, _res, next) => next(Object.assign(new Error("SQL and secret parameters"), { code: "23505" })));
  app.use((error, _req, res, _next) => { logRequestError(error, res); res.status(500).json({ error: "Internal server error." }); });
  server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });

test("completed interactions include correlation, actor, resources and changed field names only", async () => {
  const response = await fetch(`${base}/api/members/${memberId}?token=query-secret`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Authorization: "Bearer header-secret", "X-Request-ID": "untrusted" },
    body: JSON.stringify({ name: "private-name", stats: { WS: "4" }, notes: "private-notes", password: "private-password" }),
  });
  assert.equal(response.status, 200);
  const record = records.at(-1);
  assert.equal(record.interaction, "members.update");
  assert.equal(record.event, "request.completed");
  assert.equal(record.outcome, "succeeded");
  assert.equal(record.level, "info");
  assert.equal(record.route, "/api/members/:memberId");
  assert.equal(record.path, "/api/members/:id");
  assert.equal(record.userId, userId);
  assert.equal(record.memberId, memberId);
  assert.ok(record.rosterId);
  assert.deepEqual(record.changedFields, ["name", "stats", "notes"]);
  assert.match(record.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers.get("x-request-id"), record.requestId);
  assert.ok(record.durationMs >= 0);
  assert.doesNotMatch(JSON.stringify(record), /secret|private-|untrusted|password|username|Authorization/);
});
test("rejected login and locked skill interactions remain distinguishable without exposing credentials", async () => {
  await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "private-login", password: "private-password" }) });
  const login = records.at(-1);
  assert.equal(login.interaction, "account.login");
  assert.equal(login.status, 401);
  assert.equal(login.level, "warn");
  assert.equal(login.userId, null);
  await fetch(`${base}/api/members/${memberId}/skills/${userId}`, { method: "DELETE" });
  const skill = records.at(-1);
  assert.equal(skill.interaction, "skill.forget");
  assert.equal(skill.status, 409);
  assert.equal(skill.outcome, "rejected");
  assert.notEqual(skill.requestId, login.requestId);
});
test("unhandled errors are correlated and sanitized instead of dumping SQL or secrets", async () => {
  const response = await fetch(`${base}/api/failure`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Internal server error." });
  const record = records.at(-1);
  assert.equal(record.level, "error");
  assert.equal(record.errorType, "Error");
  assert.equal(record.errorCode, "23505");
  assert.equal(record.outcome, "failed");
  assert.doesNotMatch(JSON.stringify(record), /SQL|secret parameters|stack/);
});
test("successful GET and HEAD health checks are silent but retain request IDs", async () => {
  const count = records.length;
  for (const method of ["GET", "HEAD"]) {
    const response = await fetch(`${base}/api/health`, { method });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
  }
  assert.equal(records.length, count);
});
test("unsuccessful and aborted health checks are logged exactly once", () => {
  for (const status of [301, 400, 503]) {
    const entries = [];
    const request = { originalUrl: "/api/health", method: "GET", route: { path: "/health" } };
    const response = Object.assign(new EventEmitter(), { locals: {}, statusCode: status, writableFinished: true, setHeader() {} });
    createRequestLogger((record) => entries.push(record))(request, response, () => {});
    response.emit("finish"); response.emit("close");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].interaction, "health.read");
    assert.equal(entries[0].status, status);
    assert.equal(entries[0].level, status >= 500 ? "error" : status >= 400 ? "warn" : "info");
  }
  const entries = [];
  const request = { originalUrl: "/api/health", method: "GET", route: { path: "/health" } };
  const response = Object.assign(new EventEmitter(), { locals: {}, statusCode: 200, writableFinished: false, setHeader() {} });
  createRequestLogger((record) => entries.push(record))(request, response, () => {});
  response.emit("close"); response.emit("finish");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].interaction, "health.read");
  assert.equal(entries[0].event, "request.aborted");
  assert.equal(entries[0].level, "error");
});
test("unknown paths and query strings are redacted", async () => {
  await fetch(`${base}/api/private-secret?password=query-secret`);
  assert.equal(records.at(-1).interaction, "http.unmatched");
  assert.equal(records.at(-1).path, "/api/:redacted");
  assert.doesNotMatch(JSON.stringify(records.at(-1)), /private-secret|query-secret/);
});
test("aborted requests log once, and access denied before route matching still identifies the interaction", () => {
  const records = [];
  const request = { originalUrl: `/api/members/${memberId}/skills/${userId}`, method: "DELETE" };
  const response = Object.assign(new EventEmitter(), { locals: {}, statusCode: 403, writableFinished: false, setHeader() {} });
  createRequestLogger((record) => records.push(record))(request, response, () => {});
  response.emit("close");
  response.emit("finish");
  assert.equal(records.length, 1);
  assert.equal(records[0].event, "request.aborted");
  assert.equal(records[0].interaction, "skill.forget");
  assert.equal(records[0].status, null);
  assert.equal(records[0].level, "error");
  const denied = Object.assign(new EventEmitter(), { locals: {}, statusCode: 403, writableFinished: true, setHeader() {} });
  createRequestLogger((record) => records.push(record))(request, denied, () => {});
  denied.emit("finish"); denied.emit("close");
  assert.equal(records.length, 2);
  assert.equal(records[1].interaction, "skill.forget");
  assert.equal(records[1].status, 403);
});
