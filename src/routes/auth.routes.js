const express = require("express");
const { createAuth, createSession, hashPassword, verifyPassword } = require("../middleware/auth");

function createAuthRoutes(db) {
  const router = express.Router();
  const { requireAuth } = createAuth(db);

  function readCredentials(body) {
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    return { username, password };
  }

  router.post("/auth/register", async (request, response) => {
    const { username, password } = readCredentials(request.body);
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return response.status(400).json({ error: "Username must be 3-32 letters, numbers, dots, dashes or underscores." });
    if (password.length < 8) return response.status(400).json({ error: "Password must be at least 8 characters." });
    if (await db("users").whereRaw("lower(username) = ?", [username.toLowerCase()]).first()) return response.status(409).json({ error: "That username is taken." });
    const [user] = await db("users").insert({ username, password_hash: hashPassword(password) }).returning(["id", "username"]);
    response.status(201).json({ token: await createSession(db, user.id), user });
  });

  router.post("/auth/login", async (request, response) => {
    const { username, password } = readCredentials(request.body);
    const user = await db("users").whereRaw("lower(username) = ?", [username.toLowerCase()]).first();
    if (!user || !verifyPassword(password, user.password_hash)) return response.status(401).json({ error: "Wrong username or password." });
    response.json({ token: await createSession(db, user.id), user: { id: user.id, username: user.username } });
  });

  router.get("/auth/me", requireAuth, (request, response) => response.json({ user: request.user }));

  router.post("/auth/logout", requireAuth, async (request, response) => {
    await db("sessions").where({ token_hash: request.tokenHash }).delete();
    response.status(204).end();
  });

  return router;
}

module.exports = { createAuthRoutes };
