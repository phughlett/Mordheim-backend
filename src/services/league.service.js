const { randomBytes } = require("node:crypto");
const { fail, integer, uuid } = require("./trading-rules.service");
const { SCENARIOS, POST_BATTLE_STEPS, advanceCampaign } = require("./campaign.service");
const { createRosterService, calculateWarbandRating } = require("./roster.service");
const { createRosterRepository } = require("../repositories/roster.repository");
const { getGroupEquipment, groupEquipmentError } = require("./group-equipment.service");
const { injuryAvailability } = require("./injury-rules.service");
const examples = require("../../league-2026.json");

const coreScenarios = SCENARIOS.map((name, index) => ({
  id: `core-${index + 1}`, name, format: "1v1", minPlayers: 2, maxPlayers: 2,
  narrative: "", terrain: "", deployment: "",
  rules: "Use the published setup and special rules for this core scenario.",
  victory: "Resolve victory using this scenario's published ending conditions.",
  experience: "Apply the published survival, leader, combat and objective XP awards manually.",
  rewards: "Apply the published scenario rewards manually, then complete the normal post-battle sequence.",
  aftermath: "", source: `Mordheim core rulebook, Scenarios: ${name}`,
}));
const scenarioFields = ["narrative", "terrain", "deployment", "rules", "victory", "experience", "rewards", "aftermath"];
function text(value, label, max, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(`${label} must be ${required ? "non-empty " : ""}text of at most ${max} characters.`, 400);
  return value.trim();
}
function validateScenario(input) {
  if (!input || !["1v1", "2v2", "teams", "individual"].includes(input.format)) fail("Choose 1v1, 2v2, flexible teams or individual results.", 400);
  const minPlayers = input.format === "1v1" ? 2 : input.format === "2v2" ? 4 : input.minPlayers;
  const maxPlayers = input.format === "1v1" ? 2 : input.format === "2v2" ? 4 : input.maxPlayers;
  if (!integer(minPlayers, 2, 8) || !integer(maxPlayers, minPlayers, 8)) fail("Scenario tables must allow between 2 and 8 players.", 400);
  return {
    name: text(input.name, "Scenario name", 120, true), format: input.format, minPlayers, maxPlayers,
    ...Object.fromEntries(scenarioFields.map((key) => [key, text(input[key] ?? "", key, 40000, ["rules", "victory", "experience", "rewards"].includes(key))])),
    source: text(input.source ?? "", "Source reference", 500),
    ...(input.documentUrl && examples.scenarios.some((s) => s.documentUrl === input.documentUrl) ? { documentUrl: input.documentUrl } : {}),
  };
}
function validateWindow(input) {
  const date = (value) => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  if (!date(input.startsAt) || !date(input.endsAt) || Date.parse(input.endsAt) <= Date.parse(input.startsAt)) fail("Supply a start and later end date with a timezone offset.", 400);
  if (typeof input.timezone !== "string" || input.timezone.length > 80) fail("Choose an IANA timezone.", 400);
  try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }); }
  catch (error) { if (error instanceof RangeError) fail("Choose a valid IANA timezone.", 400); throw error; }
  return { starts_at: new Date(input.startsAt), ends_at: new Date(input.endsAt), timezone: input.timezone, location: text(input.location ?? "", "Location", 240) };
}
function validateTables(tables, absences, playerIds, scenario) {
  if (!Array.isArray(tables) || !Array.isArray(absences) || !tables.length) fail("Assign at least one table and explicitly mark absent players.", 400);
  const used = [...absences];
  for (const table of tables) {
    if (!Array.isArray(table) || table.length < scenario.minPlayers || table.length > scenario.maxPlayers) fail(`Each table needs ${scenario.minPlayers}–${scenario.maxPlayers} players.`, 400);
    used.push(...table);
  }
  if (used.some((id) => !uuid(id) || !playerIds.includes(id)) || new Set(used).size !== used.length || used.length !== playerIds.length) fail("Account for every enrolled player exactly once at a table or as absent.", 400);
  return { tables, absences };
}
function suggestTables(players, history, size, strategy, minPlayers = 2) {
  const repeats = new Map();
  for (const table of history) for (const a of table) for (const b of table) if (a !== b) {
    const key = [a, b].sort().join(":"); repeats.set(key, (repeats.get(key) ?? 0) + 1);
  }
  const pool = [...players].sort((a, b) => Number(a.rating) - Number(b.rating) || a.id.localeCompare(b.id));
  const tables = [];
  while (pool.length) {
    const table = [pool.shift()];
    while (table.length < size && pool.length) {
      const score = (p) => {
        const repeat = table.reduce((sum, member) => sum + (repeats.get([member.id, p.id].sort().join(":")) ?? 0), 0);
        const gap = Math.abs(table.reduce((sum, member) => sum + Number(member.rating), 0) / table.length - Number(p.rating));
        return strategy === "rating" ? gap * 1000 + repeat : repeat * 1000000 + gap;
      };
      pool.sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id));
      table.push(pool.shift());
    }
    tables.push(table.map((p) => p.id));
  }
  const last = tables.at(-1), previous = tables.at(-2);
  while (last && last.length < minPlayers && previous && previous.length > minPlayers) last.unshift(previous.pop());
  const absences = last && last.length < minPlayers ? tables.pop() : [];
  return { tables, absences };
}
const calendarText = (value) => value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const calendarDate = (date) => new Date(date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function calendar(campaign, rounds) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mordheim Roster Ledger//Campaign Calendar//EN", "CALSCALE:GREGORIAN"];
  for (const round of rounds) lines.push(
    "BEGIN:VEVENT", `UID:${round.id}@mordheim.hughlett.org`, `DTSTAMP:${calendarDate(round.updated_at)}`,
    `DTSTART:${calendarDate(round.starts_at)}`, `DTEND:${calendarDate(round.ends_at)}`,
    `SUMMARY:${calendarText(`${campaign.name}: ${round.scenario.name}`)}`, `LOCATION:${calendarText(round.location)}`,
    `DESCRIPTION:${calendarText(`Scenario ${round.number}. Play window (${round.timezone}). ${round.scenario.source}`)}`, "END:VEVENT",
  );
  lines.push("END:VCALENDAR");
  return lines.flatMap((line) => {
    const folded = []; let part = "";
    for (const character of line) {
      if (Buffer.byteLength(part + character) > 75) { folded.push(part); part = " "; }
      part += character;
    }
    return [...folded, part];
  }).join("\r\n") + "\r\n";
}
function createLeagueService(db) {
  async function campaign(query, campaignId, userId, ownerOnly = false) {
    if (!uuid(campaignId)) fail("Invalid campaign ID.", 400);
    const row = await query("campaigns").where({ id: campaignId }).forUpdate().first();
    if (!row) fail("Campaign not found.", 404);
    if (!await query("campaign_members").where({ campaign_id: campaignId, user_id: userId }).first()) fail("You have not joined this campaign.", 403);
    if (ownerOnly && row.owner_id !== userId) fail("Only the commissioner can do that.", 403);
    return row;
  }
  async function round(query, campaignId, id) {
    if (!uuid(id)) fail("Invalid scenario round ID.", 400);
    const row = await query("campaign_rounds").where({ id, campaign_id: campaignId }).forUpdate().first();
    if (!row) fail("Scenario round not found.", 404);
    return row;
  }
  async function scenarios(userId) {
    const own = await db("league_scenarios").where({ owner_id: userId }).orderBy("created_at");
    return [...coreScenarios, ...examples.scenarios, ...own.map((row) => ({ ...row.definition, id: row.id, shareCode: row.share_code }))];
  }
  async function saveScenario(userId, input) {
    const definition = validateScenario(input);
    const [row] = await db("league_scenarios").insert({ owner_id: userId, share_code: randomBytes(10).toString("hex"), definition: JSON.stringify(definition) }).returning("*");
    return { ...definition, id: row.id, shareCode: row.share_code };
  }
  async function importScenario(userId, code) {
    if (typeof code !== "string" || !/^[a-f0-9]{20}$/.test(code.trim())) fail("Enter a valid scenario share code.", 400);
    const source = await db("league_scenarios").where({ share_code: code.trim() }).first();
    if (!source) fail("Scenario share code not found.", 404);
    return saveScenario(userId, source.definition);
  }
  async function enrolled(query, campaignId) {
    const rosters = await query("rosters").where({ campaign_id: campaignId, league_retired: false }).select("*");
    const seen = new Set();
    for (const roster of rosters) {
      if (seen.has(roster.user_id)) fail("League play requires one active warband per player. Retire extra warbands before scheduling.");
      seen.add(roster.user_id);
    }
    return rosters;
  }
  async function get(campaignId, userId) {
    return db.transaction(async (trx) => {
      const current = await campaign(trx, campaignId, userId);
      const rounds = await trx("campaign_rounds").where({ campaign_id: campaignId }).orderBy("number");
      const games = await trx("league_games").whereIn("round_id", rounds.map((r) => r.id)).orderBy("table_number");
      const rosters = await trx("rosters").where({ campaign_id: campaignId }).select("id", "name", "warband", "campaign_phase", "campaign_step", "battles_fought", "user_id", "league_retired");
      const rosterService = createRosterService(createRosterRepository(trx));
      for (const roster of rosters) roster.rating = calculateWarbandRating(await rosterService.fetchRosterMembers(roster.id));
      const members = await trx("campaign_members").join("users", "users.id", "campaign_members.user_id")
        .where({ campaign_id: campaignId }).select("users.id", "users.username");
      const standings = members.map((member) => {
        const results = games.flatMap((game) => game.results ?? []).filter((entry) => entry.playerId === member.id);
        return { ...member, wins: results.filter((r) => r.outcome === "win").length, losses: results.filter((r) => r.outcome === "loss").length,
          draws: results.filter((r) => r.outcome === "draw").length, score: results.reduce((sum, r) => sum + (r.score ?? 0), 0) };
      }).sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.username.localeCompare(b.username));
      return {
        enabled: current.league_enabled, scenarioLimit: current.scenario_limit, houseRules: current.house_rules,
        allowedWarbandIds: current.allowed_warband_ids, maxWarbandsPerPlayer: current.max_warbands_per_player,
        isCommissioner: current.owner_id === userId, commissionerId: current.owner_id, userId,
        finished: current.scenario_limit !== null && rounds.filter((r) => r.status === "completed").length >= current.scenario_limit,
        rosters, members, standings,
        rounds: rounds.map((r) => ({
          id: r.id, number: r.number, status: r.status, scenario: r.scenario, startsAt: r.starts_at,
          endsAt: r.ends_at, timezone: r.timezone, location: r.location, tables: r.tables, absences: r.absences,
          absenceNotes: r.absence_notes,
          games: games.filter((game) => game.round_id === r.id).map((game) => ({
            id: game.id, tableNumber: game.table_number, status: game.status, seats: game.seats, results: game.results, notes: game.notes,
          })),
        })),
      };
    });
  }
  async function schedule(campaignId, userId, input, roundId = null) {
    const definition = (await scenarios(userId)).find((s) => s.id === input.scenarioId);
    if (!definition) fail("Choose a scenario from your catalog.", 400);
    const window = validateWindow(input);
    return db.transaction(async (trx) => {
      const current = await campaign(trx, campaignId, userId, true);
      const existing = await trx("campaign_rounds").where({ campaign_id: campaignId }).orderBy("number");
      const editing = roundId ? await round(trx, campaignId, roundId) : null;
      if (editing && editing.status !== "scheduled") fail("Only future scheduled scenarios can be edited.");
      if (!editing && current.scenario_limit !== null && existing.length >= current.scenario_limit) fail("The campaign's scenario limit has been reached.");
      const rosters = await enrolled(trx, campaignId);
      const assignments = validateTables(input.tables, input.absences ?? [], rosters.map((r) => r.user_id), definition);
      if (!current.league_enabled) {
        if (await trx("battles").where({ campaign_id: campaignId }).whereNot({ status: "finished" }).first()) fail("Finish or remove existing battles before enabling scheduled scenarios.");
        await trx("campaigns").where({ id: campaignId }).update({ league_enabled: true });
      }
      const previous = editing ? existing.find((r) => r.number === editing.number - 1) : existing.at(-1);
      const next = editing ? existing.find((r) => r.number === editing.number + 1) : null;
      if (previous && new Date(previous.ends_at) > window.starts_at) fail("Scenario windows must be ordered and must not overlap.");
      if (next && new Date(next.starts_at) < window.ends_at) fail("The window must end before the following scenario starts.");
      const values = { ...window, scenario: JSON.stringify(definition), tables: JSON.stringify(assignments.tables), absences: JSON.stringify(assignments.absences) };
      if (editing) {
        await trx("campaign_rounds").where({ id: editing.id }).update({ ...values, updated_at: new Date() });
        return { id: editing.id };
      }
      const [created] = await trx("campaign_rounds").insert({ campaign_id: campaignId, number: (previous?.number ?? 0) + 1, ...values }).returning("*");
      return { id: created.id };
    });
  }
  async function start(campaignId, roundId, userId) {
    return db.transaction(async (trx) => {
      await campaign(trx, campaignId, userId, true);
      const chosen = await round(trx, campaignId, roundId);
      if (chosen.status !== "scheduled") fail("Only a scheduled scenario can start.");
      if (await trx("campaign_rounds").where({ campaign_id: campaignId }).where("number", "<", chosen.number).whereNot({ status: "completed" }).first()) fail("Complete the earlier scenarios first.");
      const rosters = await enrolled(trx, campaignId);
      validateTables(chosen.tables, chosen.absences, rosters.map((r) => r.user_id), chosen.scenario);
      if (rosters.some((r) => !["setup", "pre_battle"].includes(r.campaign_phase)
        || (r.campaign_phase === "pre_battle" && r.campaign_step !== 1))) fail("Finish each warband's post-battle sequence before starting the next scenario.");
      if (await trx("battles").where({ campaign_id: campaignId }).whereNot({ status: "finished" }).first()) fail("Finish or remove outstanding battles first.");
      for (const [index, players] of chosen.tables.entries()) {
        const seats = players.map((playerId) => {
          const roster = rosters.find((r) => r.user_id === playerId);
          return { playerId, rosterId: roster.id, rosterName: roster.name, team: null, startingBattlesFought: roster.battles_fought };
        });
        await trx("league_games").insert({ round_id: chosen.id, table_number: index + 1, seats: JSON.stringify(seats) });
      }
      const absenceNotes = { ...chosen.absence_notes };
      for (const playerId of chosen.absences) {
        const roster = rosters.find((r) => r.user_id === playerId);
        absenceNotes[playerId] = { ...absenceNotes[playerId], rosterId: roster.id, rosterName: roster.name };
      }
      await trx("campaign_rounds").where({ id: chosen.id }).update({ status: "active", absence_notes: JSON.stringify(absenceNotes), updated_at: new Date() });
      return { started: true };
    });
  }
  async function complete(campaignId, roundId, userId) {
    return db.transaction(async (trx) => {
      await campaign(trx, campaignId, userId, true);
      const chosen = await round(trx, campaignId, roundId);
      if (chosen.status !== "active") fail("Only the active scenario can be completed.");
      const games = await trx("league_games").where({ round_id: chosen.id });
      if (!games.length || games.some((g) => g.status !== "finished" || !g.results)) fail("Every assigned table needs recorded results before the campaign can advance.");
      await trx("campaign_rounds").where({ id: chosen.id }).update({ status: "completed", updated_at: new Date() });
      return { completed: true };
    });
  }
  async function gameAction(campaignId, gameId, userId, action, input) {
    return db.transaction(async (trx) => {
      const current = await campaign(trx, campaignId, userId);
      if (!uuid(gameId)) fail("Invalid table ID.", 400);
      const game = await trx("league_games").where({ id: gameId }).forUpdate().first();
      if (!game) fail("Table not found.", 404);
      const chosen = await round(trx, campaignId, game.round_id);
      if (chosen.status !== "active") fail("This scenario is not active.");
      if (current.owner_id !== userId && !game.seats.some((s) => s.playerId === userId)) fail("Only the commissioner or a player at this table can manage it.", 403);
      if (game.status === "finished") fail("This table's results have already been recorded.");
      const rosters = await trx("rosters").whereIn("id", game.seats.map((s) => s.rosterId)).orderBy("id").forUpdate();
      if (rosters.length !== game.seats.length) fail("An assigned warband is missing.");
      if (action === "teams") {
        if (game.status !== "preparing" || chosen.scenario.format === "individual") fail("Teams can only be set before a team scenario starts.");
        const teams = input.teams;
        if (!Array.isArray(teams) || teams.length !== game.seats.length || new Set(teams.map((s) => s?.playerId)).size !== teams.length
          || teams.some((s) => !s || !game.seats.some((seat) => seat.playerId === s.playerId) || !["A", "B"].includes(s.team))
          || !["A", "B"].every((team) => teams.some((s) => s.team === team))) fail("Assign each player to team A or B, with both teams represented.", 400);
        if (chosen.scenario.format === "1v1" && teams.some((s) => teams.filter((entry) => entry.team === s.team).length !== 1)
          || chosen.scenario.format === "2v2" && teams.some((s) => teams.filter((entry) => entry.team === s.team).length !== 2)) fail("Teams must match the scenario's fixed format.", 400);
        await trx("league_games").where({ id: game.id }).update({ seats: JSON.stringify(game.seats.map((s) => ({ ...s, team: teams.find((t) => t.playerId === s.playerId).team }))), updated_at: new Date() });
      } else if (action === "start") {
        if (game.status !== "preparing") fail("This table has already started.");
        if (chosen.scenario.format !== "individual" && game.seats.some((s) => !s.team)) fail("Set or roll teams before starting.");
        for (const roster of rosters) {
          if (roster.campaign_phase !== "pre_battle" || roster.campaign_step !== 3) fail(`${roster.name} must finish pre-battle preparation.`);
          const gearError = groupEquipmentError(await getGroupEquipment(trx, roster.id));
          if (gearError) fail(gearError);
          const warriors = await trx("warriors").where({ roster_id: roster.id });
          if (warriors.some((w) => injuryAvailability(w, roster).needsOldWoundRoll)) fail(`Resolve old wound checks for ${roster.name}.`);
        }
        await trx("rosters").whereIn("id", rosters.map((r) => r.id)).update({ campaign_phase: "battle", campaign_step: 1, updated_at: new Date() });
        await trx("league_games").where({ id: game.id }).update({ status: "active", updated_at: new Date() });
      } else if (action === "results") {
        if (game.status !== "active") fail("Start the table before recording results.");
        const entries = input.results;
        if (!Array.isArray(entries) || entries.length !== game.seats.length || new Set(entries.map((r) => r?.playerId)).size !== entries.length
          || entries.some((r) => !r || !game.seats.some((s) => s.playerId === r.playerId) || !["win", "loss", "draw"].includes(r.outcome)
            || (r.score != null && !integer(r.score, -1000000, 1000000)))) fail("Record a win, loss or draw and optional numeric score for every player.", 400);
        if (chosen.scenario.format !== "individual") {
          const outcome = (team) => entries.filter((entry) => game.seats.find((s) => s.playerId === entry.playerId).team === team).map((r) => r.outcome);
          const a = outcome("A"), b = outcome("B");
          if (new Set(a).size !== 1 || new Set(b).size !== 1 || !((a[0] === "win" && b[0] === "loss") || (a[0] === "loss" && b[0] === "win") || (a[0] === "draw" && b[0] === "draw"))) fail("Team results must agree: one team wins and the other loses, or both draw.", 400);
        }
        const notes = text(input.notes ?? "", "Result and reward notes", 10000);
        const results = entries.map((r) => ({ playerId: r.playerId, outcome: r.outcome, score: r.score ?? null, recordedBy: userId, recordedAt: new Date().toISOString() }));
        await trx("league_games").where({ id: game.id }).update({ status: "finished", results: JSON.stringify(results), notes, updated_at: new Date() });
        await trx("rosters").whereIn("id", rosters.map((r) => r.id)).update({ campaign_phase: "post_battle", campaign_step: 1, battle_turn: 1, updated_at: new Date() });
      } else fail("Unknown table action.", 400);
      return { updated: true };
    });
  }
  async function retire(campaignId, rosterId, userId) {
    return db.transaction(async (trx) => {
      await campaign(trx, campaignId, userId, true);
      if (!uuid(rosterId)) fail("Invalid warband ID.", 400);
      const roster = await trx("rosters").where({ id: rosterId, campaign_id: campaignId }).forUpdate().first();
      if (!roster || roster.league_retired) fail("Active warband not found.", 404);
      const activeRound = await trx("campaign_rounds").where({ campaign_id: campaignId, status: "active" }).first();
      if (activeRound || !["setup", "pre_battle"].includes(roster.campaign_phase)) fail("Complete the active scenario and post-battle work before replacing a warband.");
      await trx("rosters").where({ id: roster.id }).update({ league_retired: true, updated_at: new Date() });
      return { retired: true };
    });
  }
  async function absenceNote(campaignId, roundId, userId, input) {
    return db.transaction(async (trx) => {
      await campaign(trx, campaignId, userId, true);
      const chosen = await round(trx, campaignId, roundId);
      if (!chosen.absences.includes(input.playerId)) fail("This player is not marked absent for this scenario.", 400);
      const notes = text(input.notes, "Catch-up award record", 10000, true);
      await trx("campaign_rounds").where({ id: chosen.id }).update({
        absence_notes: JSON.stringify({ ...chosen.absence_notes, [input.playerId]: { ...chosen.absence_notes[input.playerId], notes, recordedBy: userId, recordedAt: new Date().toISOString() } }),
        updated_at: new Date(),
      });
      return { recorded: true };
    });
  }
  async function attendance(campaignId, roundId, userId, input) {
    return db.transaction(async (trx) => {
      await campaign(trx, campaignId, userId, true);
      const chosen = await round(trx, campaignId, roundId);
      if (chosen.status !== "active") fail("Update the schedule to change attendance before opening a scenario.");
      const games = await trx("league_games").where({ round_id: chosen.id });
      if (games.some((g) => g.status !== "preparing")) fail("Attendance is locked once any table has started. Record missing-player rulings in result notes.");
      const rosters = await enrolled(trx, campaignId);
      const assignments = validateTables(input.tables, input.absences ?? [], rosters.map((r) => r.user_id), chosen.scenario);
      await trx("league_games").where({ round_id: chosen.id }).delete();
      for (const [index, players] of assignments.tables.entries()) {
        await trx("league_games").insert({ round_id: chosen.id, table_number: index + 1, seats: JSON.stringify(players.map((playerId) => {
          const roster = rosters.find((r) => r.user_id === playerId);
          return { playerId, rosterId: roster.id, rosterName: roster.name, team: null, startingBattlesFought: roster.battles_fought };
        })) });
      }
      await trx("rosters").where({ campaign_id: campaignId, campaign_phase: "pre_battle", league_retired: false })
        .whereIn("user_id", assignments.absences).update({ campaign_step: 1, scenario: null, updated_at: new Date() });
      const absenceNotes = { ...chosen.absence_notes };
      for (const playerId of assignments.absences) {
        const roster = rosters.find((r) => r.user_id === playerId);
        absenceNotes[playerId] = { ...absenceNotes[playerId], rosterId: roster.id, rosterName: roster.name };
      }
      await trx("campaign_rounds").where({ id: chosen.id }).update({
        tables: JSON.stringify(assignments.tables), absences: JSON.stringify(assignments.absences),
        absence_notes: JSON.stringify(absenceNotes), updated_at: new Date(),
      });
      return { updated: true };
    });
  }
  async function catchUp(campaignId, roundId, userId, input) {
    if (!integer(input.gold, 0, 1000000) || !integer(input.experience, 0, 10) || input.gold + input.experience === 0) fail("Choose a positive catch-up award: 0–1000000 gold and 0–10 participation XP.", 400);
    return db.transaction(async (trx) => {
      await campaign(trx, campaignId, userId, true);
      const chosen = await round(trx, campaignId, roundId);
      if (chosen.status !== "completed" || !chosen.absences.includes(input.playerId)) fail("Catch-up awards require a completed scenario and a player marked absent.");
      const record = chosen.absence_notes[input.playerId];
      if (record?.award) fail("This player's catch-up award has already been applied.");
      if (!record?.rosterId) fail("No original absent warband is recorded for this player.");
      const roster = await trx("rosters").where({ id: record.rosterId, campaign_id: campaignId, league_retired: false }).forUpdate().first();
      if (!roster || !["setup", "pre_battle"].includes(roster.campaign_phase) || (roster.campaign_phase === "pre_battle" && roster.campaign_step !== 1)) fail("Apply catch-up awards to the original warband before it retires or begins preparing another game.");
      if (Number(roster.treasury) + input.gold > 2147483647) fail("This award would exceed the treasury limit.", 400);
      const members = await trx("warriors").leftJoin("warrior_types", "warrior_types.id", "warriors.warrior_type_id")
        .where({ roster_id: roster.id }).select("warriors.id", "warriors.name", "warriors.role", "warriors.experience", "warrior_types.can_gain_experience");
      const experienceAwards = [];
      for (const member of members) {
        if (member.can_gain_experience === false || !input.experience) continue;
        const cap = member.role === "Henchman" ? 14 : 90;
        const gain = Math.min(input.experience, Math.max(0, cap - Number(member.experience)));
        if (gain) await trx("warriors").where({ id: member.id }).increment("experience", gain);
        experienceAwards.push({ memberId: member.id, name: member.name, experience: gain });
      }
      await trx("rosters").where({ id: roster.id }).update({ treasury: Number(roster.treasury) + input.gold, updated_at: new Date() });
      const award = { gold: input.gold, requestedExperience: input.experience, experienceAwards, recordedBy: userId, recordedAt: new Date().toISOString() };
      await trx("campaign_rounds").where({ id: chosen.id }).update({
        absence_notes: JSON.stringify({ ...chosen.absence_notes, [input.playerId]: { ...record, award } }), updated_at: new Date(),
      });
      return { applied: true, award };
    });
  }
  async function postBattle(campaignId, rosterId, userId) {
    return db.transaction(async (trx) => {
      await campaign(trx, campaignId, userId, true);
      if (!uuid(rosterId)) fail("Invalid roster ID.", 400);
      const roster = await trx("rosters").where({ id: rosterId, campaign_id: campaignId }).forUpdate().first();
      if (!roster) fail("Warband not found.", 404);
      if (roster.campaign_phase !== "post_battle") fail("This warband is not in its post-battle sequence.");
      const result = advanceCampaign(roster);
      if (result.error) fail(result.error);
      await trx("rosters").where({ id: rosterId }).update({ ...result.updates, updated_at: new Date() });
      return { advanced: true, label: POST_BATTLE_STEPS[roster.campaign_step - 1].label };
    });
  }
  return { get, schedule, start, complete, postBattle, scenarios, saveScenario, importScenario, campaign, gameAction, retire, absenceNote, attendance, catchUp };
}
module.exports = { createLeagueService, coreScenarios, validateScenario, validateWindow, validateTables, suggestTables, calendar, text, examples };
