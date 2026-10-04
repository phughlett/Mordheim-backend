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
  assert.ok(getAllowedActions({ campaign_id: "campaign", campaign_phase: "post_battle", campaign_step: 2 }).includes("experience"));
});

test("Freebuild allows XP above printed tracks, without accepting invalid stored values", () => {
  for (const role of ["Hero", "Henchman", "Hired Sword"]) {
    assert.equal(validateExperience({ experience: 1000 }, role, true, 0, true), null);
    assert.notEqual(validateExperience({ experience: 1000 }, role), null);
    assert.equal(validateExperience({ experience: 2147483647 }, role, true, 0, true), null);
    for (const experience of [-1, 0.5, "invalid", 2147483648]) {
      assert.notEqual(validateExperience({ experience }, role, true, 0, true), null);
    }
  }
  assert.notEqual(validateExperience({ experience: 5 }, "Hero", true, 20, true), null);
  assert.notEqual(validateExperience({ experience: 5 }, "Henchman", false, 0, true), null);
});
