const crypto = require("crypto");
const net = require("net");

function correctionConfig(env = process.env) {
  return {
    githubToken: env.CORRECTIONS_GITHUB_TOKEN || "",
    owner: env.CORRECTIONS_GITHUB_OWNER || "phughlett",
    repo: env.CORRECTIONS_GITHUB_REPO || "Mordheim-compose",
    projectOwner: env.CORRECTIONS_PROJECT_OWNER || "phughlett",
    projectNumber: Number(env.CORRECTIONS_PROJECT_NUMBER || 5),
    rateLimitSecret: env.CORRECTIONS_RATE_LIMIT_SECRET || "",
  };
}

function configurationReady(config) {
  return Boolean(config.githubToken && config.rateLimitSecret?.length >= 32
    && /^[A-Za-z0-9_.-]+$/.test(config.owner) && /^[A-Za-z0-9_.-]+$/.test(config.repo)
    && /^[A-Za-z0-9-]+$/.test(config.projectOwner) && Number.isSafeInteger(config.projectNumber) && config.projectNumber > 0);
}

function validateCorrection(body) {
  if (!body || typeof body !== "object") return { error: "Correction details are required." };
  if (typeof body.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)) {
    return { error: "A valid submission ID is required." };
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const explanation = typeof body.explanation === "string" ? body.explanation.trim() : "";
  if (title.length < 5 || title.length > 120 || /[\x00-\x1f\x7f]/.test(title)) return { error: "Summary must be 5–120 characters on one line." };
  if (explanation.length < 20 || explanation.length > 10000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(explanation)) {
    return { error: "Explain what is incorrect in 20–10,000 characters." };
  }
  if (body.referenceUrl !== undefined && typeof body.referenceUrl !== "string") return { error: "Reference URL must be text." };
  const referenceUrl = (body.referenceUrl || "").trim();
  if (referenceUrl) {
    try {
      const url = new URL(referenceUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
        || referenceUrl.length > 2000 || /\s/.test(referenceUrl)) throw new Error("Invalid URL");
    } catch {
      return { error: "Reference must be a valid HTTP or HTTPS URL without credentials." };
    }
  }
  if (body.consent !== true) return { error: "Confirm that your correction can be published on GitHub." };
  if (body.website !== undefined && body.website !== "") return { error: "Submission failed spam validation." };
  return { value: { id: body.id.toLowerCase(), title, explanation, referenceUrl } };
}

function issueBody(input) {
  const plain = (text) => text.split(/\r?\n/).map((line) => `    ${line}`).join("\n");
  return `Submitted through the Mordheim website. This is user-reported information, not a verified rule.\n\n## What is incorrect\n\n${plain(input.explanation)}\n\n## Rule reference (optional)\n\n${input.referenceUrl ? plain(input.referenceUrl) : "No reference provided."}\n\nSubmission ID: \`${input.id}\``;
}

class ExternalServiceError extends Error {
  constructor(service, code, uncertain = false) {
    super(`${service} request failed`);
    this.service = service;
    this.code = code;
    this.uncertain = uncertain;
  }
}

function createCorrectionService(db, { config = correctionConfig(), fetchImpl = fetch } = {}) {
  const projectUrl = `https://github.com/users/${config.projectOwner}/projects/${config.projectNumber}`;

  async function requestJson(service, url, init, mutation = false) {
    let response;
    let result;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10000) });
      result = await response.json();
    } catch {
      throw new ExternalServiceError(service, "unreachable", mutation);
    }
    if (!response.ok || result.errors?.length) {
      throw new ExternalServiceError(service, `http_${response.status}`, mutation && (response.status >= 500 || response.ok));
    }
    return result;
  }

  async function graphql(query, variables, mutation = false) {
    const result = await requestJson("github", "https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.githubToken}`, "Content-Type": "application/json", "User-Agent": "Mordheim-corrections" },
      body: JSON.stringify({ query, variables }),
    }, mutation);
    return result.data;
  }

  async function takeRateLimit(ip) {
    let address = ip;
    if (net.isIP(ip) === 6) {
      if (ip.toLowerCase().startsWith("::ffff:") && net.isIP(ip.slice(7)) === 4) address = ip.slice(7);
      else {
        const [left, right = ""] = ip.split("::");
        const start = left ? left.split(":") : [];
        const end = right ? right.split(":") : [];
        const expanded = ip.includes("::") ? [...start, ...Array(8 - start.length - end.length).fill("0"), ...end] : start;
        address = expanded.slice(0, 4).map((part) => parseInt(part, 16).toString(16)).join(":");
      }
    }
    const key = crypto.createHmac("sha256", config.rateLimitSecret).update(address || "unknown").digest("hex");
    const globalKey = crypto.createHmac("sha256", config.rateLimitSecret).update("global").digest("hex");
    return db.transaction(async (trx) => {
      await trx.raw("select pg_advisory_xact_lock(hashtext(?))", ["correction-rate-limits"]);
      const now = new Date();
      const cutoff = new Date(now.getTime() - 3600000);
      await trx("correction_rate_limits").where("window_started", "<=", cutoff).delete();
      const keys = [key, globalKey];
      const rows = await trx("correction_rate_limits").whereIn("key", keys);
      if (rows.some((row) => row.count >= (row.key === globalKey ? 100 : 5))) return false;
      for (const rateKey of keys) {
        await trx("correction_rate_limits").insert({ key: rateKey, window_started: now, count: 1 })
          .onConflict("key").merge({ count: trx.raw("correction_rate_limits.count + 1") });
      }
      return true;
    });
  }

  function reportFailure(error, id) {
    console.error(JSON.stringify({
      event: "correction_submission_failed", submissionId: id,
      service: error.service || "database", code: error.code || "unexpected",
    }));
  }

  const receipt = (row) => ({ id: row.id, status: row.status, issueUrl: row.issue_url, projectUrl });

  return {
    publicConfig() {
      return {
        enabled: configurationReady(config),
        repositoryUrl: `https://github.com/${config.owner}/${config.repo}`,
        projectUrl,
      };
    },

    async submit(body, ip) {
      if (!configurationReady(config)) return { status: 503, body: { error: "Correction submissions are not configured. Please try again later." } };
      if (!await takeRateLimit(ip)) return { status: 429, body: { error: "Too many correction attempts. Please wait one hour before trying again." } };
      const parsed = validateCorrection(body);
      if (parsed.error) return { status: 400, body: { error: parsed.error } };

      const input = parsed.value;
      const hash = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
      await db("correction_submissions").insert({ id: input.id, payload_hash: hash, status: "ready" }).onConflict("id").ignore();
      let row = await db("correction_submissions").where({ id: input.id }).first();
      if (row.payload_hash !== hash) return { status: 409, body: { error: "This submission ID has different details. Restore the original details to retry." } };
      if (row.status === "submitted") return { status: 200, body: receipt(row) };
      if (row.status === "creating" || row.status === "uncertain") {
        return { status: 409, body: { ...receipt(row), status: "uncertain", error: `GitHub issue creation is still pending or could not be confirmed. Do not submit again with a new ID. Ask the maintainer to check submission ${row.id}.` } };
      }
      const stage = row.issue_id ? "linking" : "processing";
      const claimable = row.issue_id ? ["project_pending"] : ["ready"];
      const claimed = await db("correction_submissions").where({ id: input.id })
        .where((query) => query.whereIn("status", claimable).orWhere((stale) => stale
          .where({ status: stage }).where("updated_at", "<", new Date(Date.now() - 60000))))
        .update({ status: stage, updated_at: new Date() }).returning("*");
      if (!claimed.length) return { status: 409, body: { error: "This correction is already being processed. Please wait and retry the same submission." } };
      row = claimed[0];
      if (!row.issue_id) {
        let target;
        try {
          target = await graphql(`query CorrectionTarget($owner: String!, $repo: String!, $projectOwner: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) { id }
            user(login: $projectOwner) { projectV2(number: $number) { id } }
          }`, { owner: config.owner, repo: config.repo, projectOwner: config.projectOwner, number: config.projectNumber });
          if (!target?.repository?.id || !target?.user?.projectV2?.id) throw new ExternalServiceError("github", "missing_target");
        } catch (error) {
          reportFailure(error, row.id);
          await db("correction_submissions").where({ id: row.id }).update({ status: "ready", updated_at: new Date() });
          return { status: 503, body: { error: "GitHub repository or Project is unavailable. Your issue was not created. Please retry later." } };
        }
        await db("correction_submissions").where({ id: row.id }).update({
          status: "creating", project_id: target.user.projectV2.id, updated_at: new Date(),
        });
        try {
          const data = await graphql(`mutation CreateCorrection($input: CreateIssueInput!) {
            createIssue(input: $input) { issue { id url } }
          }`, { input: { repositoryId: target.repository.id, title: `[Correction] ${input.title}`, body: issueBody(input) } }, true);
          const issue = data?.createIssue?.issue;
          if (!issue?.id || typeof issue.url !== "string"
            || !issue.url.startsWith(`https://github.com/${config.owner}/${config.repo}/issues/`)
            || !/\/issues\/[1-9]\d*$/.test(issue.url)) {
            throw new ExternalServiceError("github", "invalid_issue_response", true);
          }
          [row] = await db("correction_submissions").where({ id: row.id }).update({
            issue_id: issue.id, issue_url: issue.url, status: "linking", updated_at: new Date(),
          }).returning("*");
        } catch (error) {
          reportFailure(error, row.id);
          const uncertain = !(error instanceof ExternalServiceError) || error.uncertain;
          await db("correction_submissions").where({ id: row.id }).update({ status: uncertain ? "uncertain" : "ready", updated_at: new Date() });
          return { status: uncertain ? 409 : 503, body: {
            id: row.id, status: uncertain ? "uncertain" : "ready",
            error: uncertain
              ? `GitHub issue creation could not be confirmed. Do not resubmit with a new ID. Ask the maintainer to check submission ${row.id}.`
              : "GitHub rejected issue creation. Please retry later.",
          } };
        }
      }
      try {
        const data = await graphql(`mutation LinkCorrection($input: AddProjectV2ItemByIdInput!) {
          addProjectV2ItemById(input: $input) { item { id } }
        }`, { input: { projectId: row.project_id, contentId: row.issue_id } });
        if (!data?.addProjectV2ItemById?.item?.id) throw new ExternalServiceError("github", "invalid_project_response");
        [row] = await db("correction_submissions").where({ id: row.id }).update({ status: "submitted", updated_at: new Date() }).returning("*");
        return { status: 201, body: receipt(row) };
      } catch (error) {
        reportFailure(error, row.id);
        [row] = await db("correction_submissions").where({ id: row.id }).update({ status: "project_pending", updated_at: new Date() }).returning("*");
        return { status: 202, body: { ...receipt(row), error: "Your GitHub issue was created, but adding it to the Project failed. Retry this submission to link the existing issue." } };
      }
    },
  };
}

module.exports = { createCorrectionService, correctionConfig, validateCorrection, issueBody };
