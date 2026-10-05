const { before, after, afterEach, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const knex = require("knex");
const knexConfig = require("../knexfile");
const { createApp } = require("../src/app");
const { createCorrectionService, validateCorrection, issueBody } = require("../src/services/corrections.service");

const db = knex(knexConfig[process.env.NODE_ENV || "development"] || knexConfig.development);
const ids = [];
const rateKeys = new Set();
const servers = [];
function payload(overrides = {}) {
  const id = crypto.randomUUID();
  ids.push(id);
  return {
    id, title: "Lizardmen model maximum", explanation: "The Lizardmen maximum should be 20 models, not 15.",
    referenceUrl: "https://example.com/lizardmen.pdf", consent: true, website: "",
    ...overrides,
  };
}

function fixture(overrides = {}) {
  const config = {
    githubToken: "test-github-secret", owner: "phughlett", repo: "Mordheim-compose",
    projectOwner: "phughlett", projectNumber: 5,
    rateLimitSecret: crypto.randomUUID(), ...overrides,
  };
  const calls = [];
  const control = { preflightFailure: false, createFailure: false, ambiguousCreation: false, projectFailure: false };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetchImpl = async (url, init) => {
    const data = JSON.parse(init.body);
    calls.push({ url, data });
    assert.equal(url, "https://api.github.com/graphql");
    if (data.query.includes("CorrectionTarget")) {
      return control.preflightFailure ? reply({ errors: [{ message: "Denied" }] }) : reply({ data: { repository: { id: "REPO" }, user: { projectV2: { id: "PROJECT" } } } });
    }
    if (data.query.includes("CreateCorrection")) {
      if (control.ambiguousCreation) throw new Error("Timed out after remote write");
      if (control.createFailure) return reply({ message: "Denied" }, 403);
      return reply({ data: { createIssue: { issue: { id: "ISSUE", url: "https://github.com/phughlett/Mordheim-compose/issues/123" } } } });
    }
    if (data.query.includes("LinkCorrection")) {
      return control.projectFailure ? reply({ errors: [{ message: "Project write failed" }] }) : reply({ data: { addProjectV2ItemById: { item: { id: "ITEM" } } } });
    }
    throw new Error("Unexpected external request");
  };
  const trackIp = (ip) => {
    for (const value of [ip, "global"]) rateKeys.add(crypto.createHmac("sha256", config.rateLimitSecret).update(value).digest("hex"));
  };
  trackIp("127.0.0.1");
  return { config, fetchImpl, calls, control, trackIp, service: createCorrectionService(db, { config, fetchImpl }) };
}

async function start(options) {
  const server = createApp(db, { corrections: options }).listen(0);
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
}

describe("website correction submissions", () => {
  before(async () => { await db.migrate.latest(); });
  afterEach(async () => {
    for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
    await db("correction_submissions").whereIn("id", ids.splice(0)).delete();
    await db("correction_rate_limits").whereIn("key", [...rateKeys]).delete();
    rateKeys.clear();
  });
  after(async () => { await db.destroy(); });

  test("requires a real explanation, optional safe URL, consent and empty spam trap", () => {
    const good = payload({ referenceUrl: "" });
    assert.ok(validateCorrection(good).value);
    for (const changes of [
      { explanation: " " }, { explanation: "Too short" }, { explanation: "a".repeat(10001) },
      { title: "bad\nsummary" }, { title: "x".repeat(121) }, { id: "not-a-uuid" },
      { referenceUrl: "javascript:alert(1)" }, { referenceUrl: "https://user:password@example.com/rules" },
      { referenceUrl: 42 }, { consent: false }, { website: "spam" },
    ]) assert.ok(validateCorrection({ ...good, ...changes }).error, JSON.stringify(changes));
    assert.ok(validateCorrection({ ...good, referenceUrl: "http://example.com/rules#page=1" }).value);
    const body = issueBody({ ...good, explanation: "@someone\n# user text" });
    assert.match(body, /    @someone\n    # user text/);
    assert.match(body, /Submission ID:/);
  });

  test("allows anonymous submissions, creates a repository issue and links the chosen Project", async () => {
    const f = fixture();
    const call = await start(f);
    const publicConfig = (await call("/corrections/config")).body;
    assert.equal(publicConfig.enabled, true);
    assert.ok(!JSON.stringify(publicConfig).includes(f.config.githubToken));
    assert.ok(!JSON.stringify(publicConfig).includes(f.config.rateLimitSecret));
    const input = payload({ owner: "attacker", repo: "wrong", projectNumber: 999 });
    const result = await call("/corrections", input);
    assert.equal(result.status, 201);
    assert.equal(result.body.status, "submitted");
    assert.equal(result.body.issueUrl, "https://github.com/phughlett/Mordheim-compose/issues/123");
    assert.equal(result.body.projectUrl, "https://github.com/users/phughlett/projects/5");
    const target = f.calls.find((item) => item.data.query?.includes("CorrectionTarget"));
    assert.deepEqual(target.data.variables, { owner: "phughlett", repo: "Mordheim-compose", projectOwner: "phughlett", number: 5 });
    const created = f.calls.find((item) => item.data.query?.includes("CreateCorrection"));
    assert.equal(created.data.variables.input.repositoryId, "REPO");
    assert.equal(created.data.variables.input.title, `[Correction] ${input.title}`);
    assert.match(created.data.variables.input.body, /https:\/\/example.com\/lizardmen.pdf/);
    const linked = f.calls.find((item) => item.data.query?.includes("LinkCorrection"));
    assert.deepEqual(linked.data.variables.input, { projectId: "PROJECT", contentId: "ISSUE" });
    const repeated = await call("/corrections", input);
    assert.equal(repeated.status, 200);
    assert.equal(f.calls.filter((item) => item.data.query?.includes("CreateCorrection")).length, 1);
    assert.equal((await call("/corrections", { ...input, explanation: "Changed correction details with the same ID." })).status, 409);
  });

  test("disabled configuration and invalid payloads never reach external services", async () => {
    const f = fixture({ githubToken: "" });
    const call = await start(f);
    assert.equal((await call("/corrections/config")).body.enabled, false);
    assert.equal((await call("/corrections", payload())).status, 503);
    assert.equal((await call("/corrections", payload({ explanation: "" }))).status, 503);
    assert.equal(f.calls.length, 0);
  });

  test("rejects invalid submissions and spam-trap entries before GitHub writes", async () => {
    const f = fixture();
    for (const changes of [
      { explanation: "" }, { website: "spam" }, { referenceUrl: "javascript:alert(1)" },
    ]) {
      assert.equal((await f.service.submit(payload(changes), "127.0.0.1")).status, 400);
    }
    assert.equal(f.calls.length, 0);
  });

  test("Project failure returns an explicit partial receipt and retries only the existing issue", async () => {
    const f = fixture();
    const input = payload({ referenceUrl: "" });
    f.control.projectFailure = true;
    const partial = await f.service.submit(input, "127.0.0.1");
    assert.equal(partial.status, 202);
    assert.equal(partial.body.status, "project_pending");
    assert.ok(partial.body.issueUrl);
    assert.match(partial.body.error, /link the existing issue/);
    f.control.projectFailure = false;
    // A fresh service simulates a backend restart.
    const restarted = createCorrectionService(db, f);
    assert.equal((await restarted.submit(input, "127.0.0.1")).body.status, "submitted");
    assert.equal(f.calls.filter((item) => item.data.query?.includes("CreateCorrection")).length, 1);
    assert.equal(f.calls.filter((item) => item.data.query?.includes("LinkCorrection")).length, 2);
  });

  test("uncertain issue creation cannot create duplicates on retry", async () => {
    const f = fixture();
    f.control.ambiguousCreation = true;
    const input = payload();
    const result = await f.service.submit(input, "127.0.0.1");
    assert.equal(result.status, 409);
    assert.equal(result.body.status, "uncertain");
    assert.match(result.body.error, new RegExp(input.id));
    f.control.ambiguousCreation = false;
    assert.equal((await f.service.submit(input, "127.0.0.1")).body.status, "uncertain");
    assert.equal(f.calls.filter((item) => item.data.query?.includes("CreateCorrection")).length, 1);
  });

  test("definite preflight and issue rejection errors are safely retryable", async () => {
    const f = fixture();
    const input = payload();
    f.control.preflightFailure = true;
    assert.equal((await f.service.submit(input, "127.0.0.1")).status, 503);
    assert.equal(f.calls.filter((item) => item.data.query?.includes("CreateCorrection")).length, 0);
    f.control.preflightFailure = false;
    f.control.createFailure = true;
    assert.equal((await f.service.submit(input, "127.0.0.1")).status, 503);
    assert.equal((await db("correction_submissions").where({ id: input.id }).first()).status, "ready");
    f.control.createFailure = false;
    assert.equal((await f.service.submit(input, "127.0.0.1")).status, 201);
  });

  test("concurrent repeats produce one issue", async () => {
    const f = fixture();
    const input = payload();
    const results = await Promise.all([f.service.submit(input, "127.0.0.1"), f.service.submit(input, "127.0.0.1")]);
    assert.ok(results.some((item) => item.status === 201));
    assert.equal(f.calls.filter((item) => item.data.query?.includes("CreateCorrection")).length, 1);
    assert.equal((await db("correction_submissions").where({ id: input.id }).first()).status, "submitted");
  });

  test("rate limits are persistent, cannot be bypassed by forwarded headers, and expire", async () => {
    const f = fixture();
    const call = await start(f);
    const input = payload();
    for (let index = 0; index < 5; index++) {
      const result = await call("/corrections", input, { "X-Forwarded-For": `192.0.2.${index}` });
      assert.ok([200, 201].includes(result.status));
    }
    const blocked = await call("/corrections", input);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "3600");
    await db("correction_rate_limits").whereIn("key", [...rateKeys]).update({ window_started: new Date(Date.now() - 3600001) });
    assert.equal((await call("/corrections", input)).status, 200);
  });

  test("IPv6 addresses within one /64 share a quota, with a global cap across addresses", async () => {
    const f = fixture();
    f.trackIp("2001:db8:1234:0");
    const input = payload();
    for (let index = 0; index < 5; index++) {
      assert.ok([200, 201].includes((await f.service.submit(input, `2001:db8:1234::${index + 1}`)).status));
    }
    assert.equal((await f.service.submit(input, "2001:0db8:1234:0000:aaaa:bbbb:cccc:dddd")).status, 429);
    const globalKey = crypto.createHmac("sha256", f.config.rateLimitSecret).update("global").digest("hex");
    await db("correction_rate_limits").where({ key: globalKey }).update({ count: 100 });
    f.trackIp("192.0.2.1");
    assert.equal((await f.service.submit(input, "192.0.2.1")).status, 429);
  });
});
