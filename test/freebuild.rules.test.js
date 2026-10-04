const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getAllowedActions, toCampaign } = require("../src/services/campaign.service");
const { validateExperience } = require("../src/services/roster-validation.service");

test("Freebuild has no campaign phase gates, while campaigns retain them", () => {
  for (const campaign_phase of ["setup", "pre_battle", "battle", "post_battle"]) {
    const roster = { campaign_id: null, campaign_phase, campaign_step: 1 };
    assert.ok(getAllowedActions(roster).includes("experience"));
    assert.ok(toCampaign(roster).allowedActions.includes("advance"));
    assert.equal(getAllowedActions({ ...roster, campaign_id: "campaign" }).includes("experience"), false);
  }
  for (let campaign_step = 1; campaign_step <= 10; campaign_step++) {
    assert.equal(getAllowedActions({ campaign_id: "campaign", campaign_phase: "post_battle", campaign_step }).includes("experience"), campaign_step === 2);
  }
});

test("Hero and Henchman XP caps apply in Freebuild and campaigns", () => {
  for (const [role, maximum] of [["Hero", 90], ["Henchman", 14]]) {
    for (const freebuild of [true, false]) {
      assert.equal(validateExperience({ experience: maximum }, role, true, 0, freebuild), null);
      for (const experience of [maximum + 1, 1000, -1, 0.5, "invalid", 2147483648]) {
        assert.notEqual(validateExperience({ experience }, role, true, 0, freebuild), null);
      }
    }
  }
  assert.equal(validateExperience({ experience: 1000 }, "Hired Sword", true, 0, true), null);
  assert.notEqual(validateExperience({ experience: 5 }, "Hero", true, 20, true), null);
  assert.notEqual(validateExperience({ experience: 5 }, "Henchman", false, 0, true), null);
});
