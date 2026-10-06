const { catalog, effectiveRarity, canBuyItem, canEquipItem } = require("../services/trading-catalog.service");
const { defaultTradingRules, diceFor, tradingPermissions, fail, integer } = require("../services/trading-rules.service");

function createTradingRepository(db) {
  async function context(query, rosterId, lock = false) {
    const rosterQuery = query("rosters").where({ id: rosterId });
    const roster = await (lock ? rosterQuery.forUpdate() : rosterQuery).first();
    if (!roster) fail("Warband not found.", 404);
    const [warband, campaign] = await Promise.all([
      query("warbands").where({ id: roster.warband_id }).first("name"),
      roster.campaign_id ? query("campaigns").where({ id: roster.campaign_id }).first("trading_rules") : null,
    ]);
    const rules = campaign?.trading_rules ?? defaultTradingRules;
    const custom = (await query("shop_items").where({ campaign_id: roster.campaign_id ?? null })).filter((row) => row.campaign_id);
    const shop = [...catalog.map((item) => {
      const override = rules.overrides[item.id];
      return { ...item, ...override, ...(override && Object.hasOwn(override, "rarity") ? { rarityOverrides: [] } : {}) };
    }),
      ...custom.map((row) => row.definition)];
    const heroTypes = await query("warriors as w").join("warrior_types as t", "t.id", "w.warrior_type_id")
      .where({ "w.roster_id": rosterId, "w.role": "Hero" }).pluck("t.name");
    return { roster, warbandName: warband?.name ?? "", heroTypes, shop, ...tradingPermissions(roster), battle: Number(roster.battles_fought) + 1 };
  }
  function purchaseRarity(ctx, item) {
    if (ctx.heroTypes.some((type) => effectiveRarity(item, ctx.warbandName, type) === null)) return null;
    return effectiveRarity(item, ctx.warbandName, "");
  }
  function findItem(ctx, id) {
    const item = ctx.shop.find((entry) => entry.id === id);
    if (!item) fail("Shop item not found in this campaign.", 404);
    if (item.disabled) fail("This item is disabled by the campaign rules.");
    if (!canBuyItem(item, ctx.warbandName)) fail("This item is unavailable to this warband.");
    return item;
  }
  async function memberContext(query, ctx, memberId) {
    const member = await query("warriors as w").leftJoin("warrior_types as t", "t.id", "w.warrior_type_id")
      .where({ "w.id": memberId, "w.roster_id": ctx.roster.id })
      .select("w.*", "t.name as typeName").first();
    if (!member) fail("Choose a member of this warband.", 404);
    const permissions = await query("warrior_equipment_lists as p")
      .join("equipment_options as o", function join() { this.on("o.warband_id", "p.warband_id").andOn("o.list_key", "p.list_key"); })
      .where({ "p.warband_id": ctx.roster.warband_id, "p.warrior_type_id": member.warrior_type_id })
      .whereRaw("p.allowed_categories @> jsonb_build_array(o.category)")
      .where((q) => q.whereNull("o.allowed_warrior_type_names").orWhereRaw("o.allowed_warrior_type_names @> jsonb_build_array(?::text)", [member.typeName]))
      .select("o.id", "o.name", "p.allow_individual_group_gear");
    const skills = await query("warrior_skills as known").join("skills as skill", "skill.id", "known.skill_id")
      .where({ "known.warrior_id": member.id }).pluck("skill.name");
    return { member, permissions, eligibility: {
      warbandName: ctx.warbandName, typeName: member.typeName, role: member.role,
      skillNames: skills, permittedNames: permissions.map((option) => option.name),
    } };
  }
  function canReceive(source, option, shop, ctx, recipient) {
    const { member, permissions, eligibility } = recipient;
    if (source.shop_item_id) {
      return Boolean(shop && (!shop.campaign_id || shop.campaign_id === ctx.roster.campaign_id)
        && canEquipItem(shop.definition, eligibility));
    }
    if (!option) return false;
    if (permissions.some((entry) => entry.id === source.equipment_option_id)) return true;
    const item = catalog.find((entry) => entry.name.toLowerCase() === option.name.toLowerCase());
    return (!option.allowed_warrior_type_names || option.allowed_warrior_type_names.includes(member.typeName))
      && (eligibility.permittedNames.includes(option.name) || Boolean(item && canEquipItem(item, eligibility)));
  }
  async function inventory(query, ctx) {
    const [stash, carried] = await Promise.all([
      query("warband_stash").where({ roster_id: ctx.roster.id }).orderBy("created_at"),
      query("warrior_inventory").whereIn("warrior_id", query("warriors").where({ roster_id: ctx.roster.id }).select("id")).orderBy("created_at"),
    ]);
    const rows = [...stash, ...carried];
    const [options, shopItems] = await Promise.all([
      query("equipment_options").whereIn("id", [...new Set(rows.map((row) => row.equipment_option_id).filter(Boolean))]),
      query("shop_items").whereIn("id", [...new Set(rows.map((row) => row.shop_item_id).filter(Boolean))]),
    ]);
    const byOption = new Map(options.map((row) => [row.id, row]));
    const byShop = new Map(shopItems.map((row) => [row.id, row.definition]));
    const shopRows = new Map(shopItems.map((row) => [row.id, row]));
    const members = await query("warriors").where({ roster_id: ctx.roster.id }).pluck("id");
    const recipients = await Promise.all(members.map((id) => memberContext(query, ctx, id)));
    const describe = (row) => {
      const option = byOption.get(row.equipment_option_id);
      const item = byShop.get(row.shop_item_id);
      return {
        id: row.id, name: item?.name ?? option.name, category: item?.category ?? option.category,
        quantity: row.quantity, unitCostPaid: row.unit_cost_paid,
        shopItemId: row.shop_item_id ?? null, equipmentOptionId: row.equipment_option_id ?? null,
        description: item?.description ?? option.rule_text ?? "", memberId: row.warrior_id,
        modelIndex: row.model_index,
        ...(!row.warrior_id ? { eligibleRecipients: recipients
          .filter((recipient) => canReceive(row, option, shopRows.get(row.shop_item_id), ctx, recipient))
          .map(({ member, permissions }) => ({
            memberId: member.id,
            allowIndividualGroupGear: permissions.some((entry) => entry.allow_individual_group_gear),
          })) } : {}),
      };
    };
    return { stash: stash.map(describe), memberInventory: carried.map((row) => {
      const recipient = recipients.find(({ member }) => member.id === row.warrior_id);
      const shared = recipient.member.role === "Henchman"
        && !recipient.permissions.some((entry) => entry.allow_individual_group_gear);
      const quantities = shared ? Array.from({ length: recipient.member.group_size }, (_, index) =>
        carried.filter((entry) => entry.warrior_id === row.warrior_id && entry.model_index === index
          && entry.equipment_option_id === row.equipment_option_id && entry.shop_item_id === row.shop_item_id
          && entry.unit_cost_paid === row.unit_cost_paid).reduce((sum, entry) => sum + entry.quantity, 0)) : [row.quantity];
      return { ...describe(row), returnQuantity: Math.min(...quantities),
        returnModelIndex: shared ? -1 : row.model_index };
    }) };
  }
  async function getTrading(rosterId) {
    const ctx = await context(db, rosterId);
    const searches = await db("trading_searches").where({ roster_id: rosterId, battle_number: ctx.battle }).orderBy("created_at");
    const statuses = await db("trading_hero_status").where({ roster_id: rosterId, battle_number: ctx.battle });
    const heroes = await db("warriors").where({ roster_id: rosterId, role: "Hero" }).select("id", "name");
    return {
      shop: ctx.shop.map((item) => ({ ...item, disabled: Boolean(item.disabled || !canBuyItem(item, ctx.warbandName)),
        rarity: purchaseRarity(ctx, item) })),
      ...await inventory(db, ctx),
      heroes: heroes.map((hero) => ({
        ...hero, outOfAction: statuses.some((row) => row.hero_id === hero.id && row.out_of_action),
        searched: searches.some((row) => row.hero_id === hero.id),
      })),
      searches: searches.map((row) => ({
        id: row.id, heroId: row.hero_id, heroName: row.hero_name, itemId: row.item_id,
        itemName: ctx.shop.find((item) => item.id === row.item_id)?.name ?? row.item_id,
        dice: row.dice, modifier: row.modifier, total: row.total, success: row.success, purchased: row.purchased,
      })),
      canPurchase: ctx.canPurchase, canSearch: ctx.canSearch, canTransfer: ctx.canTransfer,
      treasury: String(ctx.roster.treasury),
    };
  }
  async function search(rosterId, { heroId, itemId, mode, dice }) {
    return db.transaction(async (trx) => {
      const ctx = await context(trx, rosterId, true);
      if (!ctx.canSearch) fail("Rare-item searches are only available at post-battle step 6.");
      const item = findItem(ctx, itemId);
      const hero = await memberContext(trx, ctx, heroId);
      if (hero.member.role !== "Hero") fail("Only Heroes can search for rare items.");
      const rarity = effectiveRarity(item, ctx.warbandName, hero.member.typeName);
      if (rarity === null) fail("Common items do not require a rarity search.");
      if (await trx("trading_hero_status").where({ hero_id: heroId, battle_number: ctx.battle, out_of_action: true }).first()) {
        fail("Heroes taken out of action in this battle cannot search.");
      }
      if (await trx("trading_searches").where({ roster_id: rosterId, hero_id: heroId, battle_number: ctx.battle }).first()) {
        fail("This Hero has already used their search for this battle.");
      }
      const rolled = diceFor(mode, dice, 2);
      const modifier = hero.eligibility.skillNames.includes("Streetwise") ? 2 : 0;
      const total = rolled.reduce((sum, value) => sum + value, modifier);
      const [result] = await trx("trading_searches").insert({
        roster_id: rosterId, hero_id: heroId, hero_name: hero.member.name || hero.member.type,
        battle_number: ctx.battle, item_id: item.id, dice: JSON.stringify(rolled), modifier, total, success: total >= rarity,
      }).returning("*");
      return result;
    });
  }
  async function quote(rosterId, { itemId, mode, dice }) {
    return db.transaction(async (trx) => {
      const ctx = await context(trx, rosterId, true);
      if (!ctx.canPurchase) fail("Shop purchases are only available during post-battle trading (steps 6-8).");
      const item = findItem(ctx, itemId);
      const existing = await trx("trading_quotes").where({
        roster_id: rosterId, item_id: itemId, battle_number: ctx.battle, consumed: false,
      }).orderBy("created_at").first();
      if (existing) return { id: existing.id, itemId, price: existing.price, dice: existing.dice };
      const rolled = diceFor(mode, dice ?? [], item.priceDice);
      const price = item.baseCost + rolled.reduce((sum, value) => sum + value, 0) * item.priceMultiplier;
      const [row] = await trx("trading_quotes").insert({
        roster_id: rosterId, item_id: itemId, battle_number: ctx.battle, price, dice: JSON.stringify(rolled),
      }).returning("id");
      return { id: row.id, itemId, price, dice: rolled };
    });
  }
  async function purchase(rosterId, { quoteId, quantity, searchId }) {
    return db.transaction(async (trx) => {
      const ctx = await context(trx, rosterId, true);
      if (!ctx.canPurchase) fail("Shop purchases are only available during post-battle trading (steps 6-8).");
      const offer = await trx("trading_quotes").where({ id: quoteId, roster_id: rosterId, battle_number: ctx.battle }).first();
      if (!offer || offer.consumed) fail("This price quote is missing, expired, or already purchased.");
      const item = findItem(ctx, offer.item_id);
      let rarity = purchaseRarity(ctx, item);
      let found;
      if (ctx.roster.campaign_id && searchId) {
        found = await trx("trading_searches").where({
          id: searchId, roster_id: rosterId, item_id: item.id, battle_number: ctx.battle, success: true, purchased: false,
        }).first();
        if (!found || !found.hero_id) fail("Choose an unused successful search for this item.");
        const hero = await memberContext(trx, ctx, found.hero_id);
        rarity = effectiveRarity(item, ctx.warbandName, hero.member.typeName);
      }
      if (ctx.roster.campaign_id && rarity !== null) {
        if (!found) fail("A successful Hero search is required to buy this rare item.");
        if (quantity !== 1) fail("Each successful search permits only one rare item.");
      }
      const total = offer.price * quantity;
      if (!integer(total, 0, 2147483647) || total > Number(ctx.roster.treasury)) fail("Not enough Gold Crowns for this purchase.");
      await trx("warband_stash").insert({
        roster_id: rosterId, shop_item_id: item.id, quantity, unit_cost_paid: offer.price,
      });
      await trx("rosters").where({ id: rosterId }).update({ treasury: Number(ctx.roster.treasury) - total, updated_at: new Date() });
      await trx("trading_quotes").where({ id: offer.id }).update({ consumed: true });
      if (found) await trx("trading_searches").where({ id: found.id }).update({ purchased: true });
    });
  }
  async function transfer(rosterId, { direction, inventoryId, memberId, quantity, modelIndex }) {
    return db.transaction(async (trx) => {
      const ctx = await context(trx, rosterId, true);
      if (!ctx.canTransfer) fail("Equipment can be moved only during setup, pre-battle, or post-battle reallocation (step 9).");
      const { member, permissions, eligibility } = await memberContext(trx, ctx, memberId);
      const table = direction === "to_member" ? "warband_stash" : "warrior_inventory";
      const source = await trx(table).where({ id: inventoryId, ...(direction === "to_member" ? { roster_id: rosterId } : { warrior_id: memberId }) }).first();
      if (!source) fail("Inventory entry not found in this warband.", 404);
      const all = member.role === "Henchman" && modelIndex === -1;
      if (direction === "to_member") {
        if (member.role === "Henchman" && !all && !permissions.some((entry) => entry.allow_individual_group_gear)) {
          fail("This Henchman group must be equipped identically; transfer to all models.");
        }
        if (member.role === "Henchman" && !all && modelIndex >= member.group_size) fail("That model does not exist.", 400);
        const option = source.equipment_option_id ? await trx("equipment_options").where({ id: source.equipment_option_id }).first() : null;
        const shop = source.shop_item_id ? await trx("shop_items").where({ id: source.shop_item_id }).first() : null;
        if (!canReceive(source, option, shop, ctx, { member, permissions, eligibility })) {
          fail("This warrior cannot use this item. Check equipment lists, warband restrictions, and required skills.");
        }
      }
      const sharedGroup = direction === "to_stash" && member.role === "Henchman"
        && !permissions.some((entry) => entry.allow_individual_group_gear);
      if (sharedGroup) {
        const matching = await trx("warrior_inventory").where({
          warrior_id: memberId, equipment_option_id: source.equipment_option_id,
          shop_item_id: source.shop_item_id, unit_cost_paid: source.unit_cost_paid,
        }).orderBy("created_at");
        const removals = [];
        for (let index = 0; index < member.group_size; index++) {
          let remaining = quantity;
          for (const entry of matching.filter((row) => row.model_index === index)) {
            const take = Math.min(remaining, entry.quantity);
            if (take) removals.push({ entry, take });
            remaining -= take;
          }
          if (remaining) fail("This group must remain identically equipped; every model needs enough matching copies.");
        }
        for (const { entry, take } of removals) {
          if (take === entry.quantity) await trx("warrior_inventory").where({ id: entry.id }).delete();
          else await trx("warrior_inventory").where({ id: entry.id }).decrement("quantity", take);
        }
        await trx("warband_stash").insert({
          roster_id: rosterId, equipment_option_id: source.equipment_option_id, shop_item_id: source.shop_item_id,
          quantity: quantity * member.group_size, unit_cost_paid: source.unit_cost_paid,
        });
        return;
      }
      const indices = direction === "to_member"
        ? all ? Array.from({ length: member.group_size }, (_, index) => index) : [member.role === "Henchman" ? modelIndex : member.role === "Hired Sword" ? -1 : 0]
        : [source.model_index];
      const total = quantity * indices.length;
      if (total > source.quantity) fail("Not enough copies in this inventory.");
      if (total === source.quantity) await trx(table).where({ id: source.id }).delete();
      else await trx(table).where({ id: source.id }).update({ quantity: source.quantity - total });
      const origin = { equipment_option_id: source.equipment_option_id, shop_item_id: source.shop_item_id, quantity, unit_cost_paid: source.unit_cost_paid };
      if (direction === "to_member") await trx("warrior_inventory").insert(indices.map((index) => ({ ...origin, warrior_id: memberId, model_index: index })));
      else await trx("warband_stash").insert({ ...origin, roster_id: rosterId });
    });
  }
  async function heroStatus(rosterId, { heroId, outOfAction }) {
    return db.transaction(async (trx) => {
      const ctx = await context(trx, rosterId, true);
      if (!ctx.roster.campaign_id || !(ctx.roster.campaign_phase === "battle"
        || (ctx.roster.campaign_phase === "post_battle" && ctx.roster.campaign_step === 1))) {
        fail("Record out-of-action Heroes during battle or the injuries step.");
      }
      const { member } = await memberContext(trx, ctx, heroId);
      if (member.role !== "Hero") fail("Only Heroes need a rarity-search availability record.");
      await trx("trading_hero_status").insert({
        roster_id: rosterId, hero_id: heroId, battle_number: ctx.battle, out_of_action: outOfAction,
      }).onConflict(["hero_id", "battle_number"]).merge({ out_of_action: outOfAction });
    });
  }
  async function casualty(rosterId, { memberId, modelIndex }) {
    return db.transaction(async (trx) => {
      const ctx = await context(trx, rosterId, true);
      if (!ctx.roster.campaign_id || ctx.roster.campaign_phase !== "post_battle" || ctx.roster.campaign_step !== 1) {
        fail("Record deaths during the post-battle injuries step.");
      }
      const { member } = await memberContext(trx, ctx, memberId);
      if (member.role !== "Henchman" || member.group_size === 1) {
        if (modelIndex !== 0) fail("That model does not exist.", 400);
        await trx("warriors").where({ id: memberId }).delete();
        return;
      }
      if (modelIndex >= member.group_size) fail("That model does not exist.", 400);
      await trx("warrior_inventory").where({ warrior_id: memberId, model_index: modelIndex }).delete();
      await trx("warrior_starting_gear_grants").where({ warrior_id: memberId, model_index: modelIndex }).delete();
      await trx("warrior_inventory").where({ warrior_id: memberId }).where("model_index", ">", modelIndex).decrement("model_index", 1);
      // Update grants descending-safe by removing and rebuilding the remaining indices.
      const grants = await trx("warrior_starting_gear_grants").where({ warrior_id: memberId });
      await trx("warrior_starting_gear_grants").where({ warrior_id: memberId }).delete();
      if (grants.length) await trx("warrior_starting_gear_grants").insert(grants.map((row) => ({
        ...row, model_index: row.model_index > modelIndex ? row.model_index - 1 : row.model_index,
      })));
      await trx("warriors").where({ id: memberId }).update({ group_size: member.group_size - 1, updated_at: new Date() });
    });
  }
  return { getTrading, search, quote, purchase, transfer, heroStatus, casualty };
}
module.exports = { createTradingRepository };
