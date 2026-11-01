const { test } = require("node:test");
const assert = require("node:assert/strict");
const { heroes, tableFor, canAddInjury, resolveInjury, injuryAvailability,
  retainedInjuryResult, individualInjuryResults, activeInjuryConditions } = require("../src/services/injury-rules.service");

test("injury tables cover every legal roll and Hired Swords use their source-backed table", () => {
  assert.equal(heroes.results.flatMap((result) => result.rolls).length, 36);
  for (const name of ["Pit Fighter", "Dwarf Troll Slayer (HS)", "Ogre Bodyguard", "Warlock (HS)"]) {
    const table = tableFor({ role: "Hired Sword", typeName: name });
    assert.equal(table.roll.type, "D6");
    assert.deepEqual(table.results[0].rolls, [1, 2]);
    assert.deepEqual(table.source.pages, [105]);
  }
  const goblin = tableFor({ role: "Hired Sword", typeName: "Goblin Lantern Bearer" });
  assert.deepEqual(goblin.results[0].rolls, [1]);
  assert.deepEqual(goblin.results[1].rolls, [2, 3, 4, 5, 6]);
});

test("manual injury resolution requires valid secondary rolls and complete multiple injuries", () => {
  assert.throws(() => resolveInjury(heroes, { resultId: "arm-wound" }, "manual"), /secondary/);
  assert.throws(() => resolveInjury(heroes, { resultId: "deep-wound", secondaryRoll: 4 }, "manual"), /secondary/);
  assert.throws(() => resolveInjury(heroes, { resultId: "multiple-injuries", secondaryRoll: 2, injuries: [] }, "manual"), /each/);
  const result = resolveInjury(heroes, { resultId: "multiple-injuries", secondaryRoll: 2,
    injuries: [{ resultId: "leg-wound" }, { resultId: "chest-wound" }] }, "manual");
  assert.deepEqual(result.children.map((child) => child.effects[0].stat), ["M", "T"]);
  assert.throws(() => resolveInjury(heroes, { resultId: "multiple-injuries", secondaryRoll: 1,
    injuries: [{ resultId: "dead" }] }, "manual"), /valid injury/);
});

test("simulated D66 and secondary dice resolve without client-generated dice", () => {
  const rolls = [1, 6, 2, 1, 1, 6, 1, 2, 2, 2, 6];
  const result = resolveInjury(heroes, {}, "simulated", () => rolls.shift());
  assert.equal(result.id, "multiple-injuries");
  assert.equal(result.roll, 16);
  assert.deepEqual(result.children.map((child) => child.id), ["leg-wound", "chest-wound"]);
});

test("only effect-bearing outcomes are retained, including nested multiple injuries", () => {
  const recovery = { resultId: "full-recovery" };
  assert.equal(retainedInjuryResult(resolveInjury(heroes, recovery, "manual")), null);
  const selection = { resultId: "multiple-injuries", secondaryRoll: 2,
    injuries: [recovery, { resultId: "leg-wound" }] };
  const retained = retainedInjuryResult(resolveInjury(heroes, selection, "manual"));
  assert.deepEqual(retained.children.map((child) => child.id), ["leg-wound"]);
  selection.injuries[1] = recovery;
  assert.equal(retainedInjuryResult(resolveInjury(heroes, selection, "manual")), null);
  assert.ok(retainedInjuryResult(resolveInjury(heroes, { resultId: "captured" }, "manual")).pending);
  assert.equal(retainedInjuryResult(resolveInjury(heroes, { resultId: "captured", captureOutcome: "ransomed" }, "manual")), null);
});

test("both Madness branches carry their selected gameplay rule, not permanent stat modifiers", () => {
  for (let roll = 1; roll <= 6; roll++) {
    const result = resolveInjury(heroes, { resultId: "madness", secondaryRoll: roll }, "manual");
    const effect = result.effects[0];
    assert.equal(effect.rule, roll <= 3 ? "stupidity" : "frenzy");
    assert.equal(result.secondaryName, roll <= 3 ? "Stupidity" : "Frenzy");
    assert.equal(result.effects.length, 1);
    assert.equal(effect.type, "psychology");
    assert.match(effect.sourceReference, /p\. 23/);
    if (roll <= 3) {
      assert.match(effect.gameplayRules, /2D6/);
      assert.match(effect.gameplayRules, /cannot cast spells or attack/);
      assert.match(effect.gameplayRules, /1-3.*half Movement/);
      assert.match(effect.gameplayRules, /4-6.*no actions/);
      assert.match(effect.gameplayRules, /next turn's test/);
    } else {
      assert.match(effect.gameplayRules, /Must charge/);
      assert.match(effect.gameplayRules, /double the Attacks characteristic/);
      assert.match(effect.gameplayRules, /do not double that bonus/);
      assert.match(effect.gameplayRules, /within charge range, ignore other psychology/);
      assert.match(effect.gameplayRules, /knocked down or stunned.*rest of that battle/);
    }
  }
});

test("individual tracker results omit Multiple Injuries wrappers, including inside pit defeat", () => {
  const multiple = { resultId: "multiple-injuries", secondaryRoll: 3, injuries: [
    { resultId: "full-recovery" }, { resultId: "leg-wound" }, { resultId: "madness", secondaryRoll: 4 },
  ] };
  const entries = individualInjuryResults(resolveInjury(heroes, multiple, "manual"));
  assert.deepEqual(entries.map((result) => result.id), ["leg-wound", "madness"]);
  assert.ok(entries.every((result) => result.children.length === 0));
  const pit = individualInjuryResults(resolveInjury(heroes, { resultId: "sold-to-the-pits",
    pitOutcome: "lost", pitInjury: multiple }, "manual"));
  assert.deepEqual(pit.map((result) => result.id), ["leg-wound", "madness", "sold-to-the-pits"]);
  assert.ok(pit.every((result) => result.children.length === 0));
});

test("current effects omit expired absences and old checks without discarding permanent rules", () => {
  const conditions = [
    { type: "miss-games", untilBattle: 3 },
    { type: "old-battle-check", battle: 3, roll: 1 },
    { type: "psychology", rule: "frenzy" },
  ];
  assert.equal(activeInjuryConditions(conditions, { battles_fought: 2 }).length, 3);
  const current = activeInjuryConditions(conditions, { battles_fought: 3 });
  assert.equal(current.length, 1);
  assert.equal(current[0].gameplayName, "Frenzy");
  assert.equal(conditions.length, 3);
});

test("pit victory awards and defeat rolls are structured; unresolved capture stays pending", () => {
  const won = resolveInjury(heroes, { resultId: "sold-to-the-pits", pitOutcome: "won" }, "manual");
  assert.deepEqual(won.effects.map((effect) => effect.value), [50, 2]);
  const lost = resolveInjury(heroes, { resultId: "sold-to-the-pits", pitOutcome: "lost", pitInjury: { resultId: "hand-injury" } }, "manual");
  assert.equal(lost.children[0].effects[0].stat, "WS");
  assert.equal(lost.effects[0].scope, "carried-weapons-and-armour");
  assert.throws(() => resolveInjury(heroes, { resultId: "sold-to-the-pits", pitOutcome: "lost", pitInjury: { resultId: "full-recovery" } }, "manual"), /valid injury/);
  assert.equal(resolveInjury(heroes, { resultId: "captured" }, "manual").pending, true);
});

test("missed battles expire on the correct battle, and old wound checks reset for the next battle", () => {
  const member = { injury_conditions: [{ type: "miss-games", untilBattle: 3 }] };
  assert.equal(injuryAvailability(member, { battles_fought: 2 }).available, false);
  assert.equal(injuryAvailability(member, { battles_fought: 3 }).available, true);
  member.injury_conditions = [{ type: "pre-battle-check" }, { type: "old-battle-check", battle: 4, roll: 1 }];
  assert.deepEqual(injuryAvailability(member, { battles_fought: 3 }), {
    available: false, reasons: [member.injury_conditions[1]], needsOldWoundRoll: false,
  });
  assert.equal(injuryAvailability(member, { battles_fought: 4 }).needsOldWoundRoll, true);
  assert.equal(canAddInjury({ battles_fought: 0 }), false);
  assert.equal(canAddInjury({ battles_fought: 1 }), true);
  assert.equal(canAddInjury({ campaign_id: "campaign", campaign_phase: "post_battle", campaign_step: 1 }), true);
  assert.equal(canAddInjury({ campaign_id: "campaign", campaign_phase: "post_battle", campaign_step: 2 }), false);
});
