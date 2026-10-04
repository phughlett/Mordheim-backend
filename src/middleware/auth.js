const crypto = require("crypto");

const SESSION_DAYS = 30;
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

async function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await db("sessions").insert({ token_hash: hashToken(token), user_id: userId, expires_at: new Date(Date.now() + SESSION_DAYS * 86400000) });
  return token;
}

function createAuth(db) {
  async function requireAuth(request, response, next) {
    try {
      const header = request.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!token) return response.status(401).json({ error: "Sign in to continue." });
      const user = await db("sessions")
        .join("users", "users.id", "sessions.user_id")
        .where({ "sessions.token_hash": hashToken(token) })
        .where("sessions.expires_at", ">", new Date())
        .first("users.id", "users.username");
      if (!user) return response.status(401).json({ error: "Your session has expired. Sign in again." });
      request.user = user;
      request.tokenHash = hashToken(token);
      next();
    } catch (error) {
      next(error);
    }
  }

  const isMember = async (campaignId, userId) => Boolean(await db("campaign_members").where({ campaign_id: campaignId, user_id: userId }).first());

  // Warbands and their members are readable by campaign mates but editable only by their owner.
  async function checkRoster(rosterId, request, response, next) {
    try {
      const roster = await db("rosters").where({ id: rosterId }).first("id", "user_id", "campaign_id");
      if (!roster) return next();
      if (roster.user_id === request.user.id) return next();
      if (request.method === "GET") {
        if (roster.campaign_id && await isMember(roster.campaign_id, request.user.id)) return next();
        if (await db("roster_shares").where({ roster_id: roster.id, user_id: request.user.id }).first()) return next();
      }
      response.status(403).json({ error: "This warband belongs to another player." });
    } catch (error) {
      next(error);
    }
  }

  const authorizeRoster = (request, response, next) => checkRoster(request.params.rosterId, request, response, next);

  async function authorizeMember(request, response, next) {
    try {
      const warrior = await db("warriors").where({ id: request.params.memberId }).first("roster_id");
      if (!warrior) return next();
      return checkRoster(warrior.roster_id, request, response, next);
    } catch (error) {
      next(error);
    }
  }

  return { requireAuth, authorizeRoster, authorizeMember, isMember };
}

module.exports = { createAuth, createSession, hashPassword, hashToken, verifyPassword };
