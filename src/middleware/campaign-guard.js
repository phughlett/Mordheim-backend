const { describeBlock, getAllowedActions, toCampaign } = require("../services/campaign.service");

// Blocks a request when the roster's current campaign stage does not permit the action.
function createCampaignGuard(repository) {
  async function check(rosterId, action) {
    if (!rosterId) return null;
    const roster = await repository.findRoster(rosterId);
    if (!roster || getAllowedActions(roster).includes(action)) return null;
    return { error: describeBlock(roster, action), campaign: toCampaign(roster) };
  }

  function guard(action, resolveRosterId) {
    return async (request, response, next) => {
      try {
        const blocked = await check(await resolveRosterId(request), action);
        if (blocked) return response.status(409).json(blocked);
        next();
      } catch (error) {
        next(error);
      }
    };
  }

  const fromRoster = (request) => request.params.rosterId;
  const fromMember = async (request) => (await repository.findWarrior(request.params.memberId, ["roster_id"]))?.roster_id;

  return { check, guard, fromRoster, fromMember };
}

module.exports = { createCampaignGuard };
