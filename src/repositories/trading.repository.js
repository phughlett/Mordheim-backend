const { randomUUID } = require("node:crypto");
const { catalog, effectiveRarity, effectivePrice, canBuyItem, canEquipItem } = require("../services/trading-catalog.service");
const { defaultTradingRules, diceFor, tradingPermissions, fail, integer } = require("../services/trading-rules.service");
const { equipmentSale } = require("../services/equipment-sale.service");
const { mapTypes, resolveMaps, describeMap } = require("../services/mordheim-map.service");
const { canUseEquipment } = require("../services/equipment-access.service");

async function insertAcquired(trx, rosterId, item, quantity, cost, mapSelection) {
  const base = { roster_id: rosterId, shop_item_id: item.id, unit_cost_paid: cost };
  if (item.id === "mordheim-map") {
    const results = resolveMaps(mapSelection, quantity);
    await trx("warband_stash").insert(results.map((result) => ({ ...base, quantity: 1, map_result: result })));
  } else {
    if (mapSelection !== undefined) fail("Map type selection is only valid for Mordheim maps.", 400);
    await trx("warband_stash").insert({ ...base, quantity });
  }
}

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
      return { ...item, ...override,
        ...(override && Object.hasOwn(override, "rarity") ? { rarityOverrides: [] } : {}),
        ...(override && ["baseCost", "priceDice", "priceMultiplier"].some((key) => Object.hasOwn(override, key)) ? { priceOverrides: [] } : {}) };
    }),
      ...custom.map((row) => row.definition)];
    const heroTypes = await query("warriors as w").join("warrior_types as t", "t.id", "w.warrior_type_id")
      .where({ "w.roster_id": rosterId, "w.role": "Hero" }).pluck("t.name");
    const typeNames = await query("warriors as w").join("warrior_types as t", "t.id", "w.warrior_type_id")
      .where("w.roster_id", rosterId).pluck("t.name");
    return { roster, warbandName: warband?.name ?? "", heroTypes, typeNames, shop, ...tradingPermissions(roster), battle: Number(roster.battles_fought) + 1 };
  }
  function purchaseRarity(ctx, item) {
    if (item.id === "mad-cap-mushrooms" && ctx.typeNames.some((type) => /goblin/i.test(type))) return null;
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
  function canPurchaseItem(ctx, item) {
    if (!ctx.roster.campaign_id && Number(ctx.roster.battles_fought) === 0) return false;
    return item.creationOnly
      ? Number(ctx.roster.battles_fought) === 0 && (!ctx.roster.campaign_id || ctx.roster.campaign_phase === "setup")
      : ctx.canPurchase;
  }
  async function checkStockLimit(query, ctx, item, quantity) {
    if (item.excludesOwnedItems?.length) {
      const stashConflict = await query("warband_stash").where({ roster_id: ctx.roster.id }).whereIn("shop_item_id", item.excludesOwnedItems).first("id");
      const carriedConflict = await query("warrior_inventory").whereIn("shop_item_id", item.excludesOwnedItems)
        .whereIn("warrior_id", query("warriors").where({ roster_id: ctx.roster.id }).select("id")).first("id");
      if (stashConflict || carriedConflict) fail("This animal cannot be acquired while the warband owns an incompatible mount.");
    }
    if (!item.maxPerWarband) return;
    const stash = await query("warband_stash").where({ roster_id: ctx.roster.id, shop_item_id: item.id }).sum("quantity as count").first();
    const carried = await query("warrior_inventory").where({ shop_item_id: item.id })
      .whereIn("warrior_id", query("warriors").where({ roster_id: ctx.roster.id }).select("id")).sum("quantity as count").first();
    const legacy = await query("warrior_inventory as inventory").join("equipment_options as option", "option.id", "inventory.equipment_option_id")
      .whereIn("inventory.warrior_id", query("warriors").where({ roster_id: ctx.roster.id }).select("id"))
      .whereIn("option.name", [item.name, item.sourceName ?? item.name]).sum("inventory.quantity as count").first();
    const legacyStash = await query("warband_stash as stash").join("equipment_options as option", "option.id", "stash.equipment_option_id")
      .where("stash.roster_id", ctx.roster.id).whereIn("option.name", [item.name, item.sourceName ?? item.name]).sum("stash.quantity as count").first();
    if (Number(stash.count) + Number(carried.count) + Number(legacy.count) + Number(legacyStash.count) + quantity > item.maxPerWarband) fail(`This warband may own at most ${item.maxPerWarband} ${item.name}.`);
  }
  async function memberContext(query, ctx, memberId) {
    const member = await query("warriors as w").leftJoin("warrior_types as t", "t.id", "w.warrior_type_id")
      .where({ "w.id": memberId, "w.roster_id": ctx.roster.id })
      .select("w.*", "t.name as typeName").first();
    if (!member) fail("Choose a member of this warband.", 404);
    const permissions = await query("warrior_equipment_lists as p")
      .join("equipment_options as o", function join() { this.on("o.warband_id", "p.warband_id").andOn("o.list_key", "p.list_key"); })
      .leftJoin("weapon_profiles as weapon", "weapon.id", "o.weapon_profile_id")
      .where({ "p.warband_id": ctx.roster.warband_id, "p.warrior_type_id": member.warrior_type_id })
      .whereRaw("p.allowed_categories @> jsonb_build_array(o.category)")
      .where((q) => q.whereNull("o.allowed_warrior_type_names").orWhereRaw("o.allowed_warrior_type_names @> jsonb_build_array(?::text)", [member.typeName]))
      .select("o.id", "o.name", "o.category", "weapon.weapon_type as weaponType", "p.allow_individual_group_gear");
    const skills = await query("warrior_skills as known").join("skills as skill", "skill.id", "known.skill_id")
      .where({ "known.warrior_id": member.id }).pluck("skill.name");
    const spellAccess = await query("warrior_type_spell_disciplines as access")
      .join("spell_disciplines as discipline", "discipline.id", "access.spell_discipline_id")
      .where({ "access.warrior_type_id": member.warrior_type_id })
      .where("access.is_wizard", true)
      .where((q) => q.whereNull("access.warband_id").orWhere("access.warband_id", ctx.roster.warband_id))
      .whereNot("discipline.kind", "Prayer").first("access.warrior_type_id");
    const learnedMagic = await query("warrior_spells as known")
      .join("spells as spell", "spell.id", "known.spell_id")
      .join("spell_disciplines as discipline", "discipline.id", "spell.spell_discipline_id")
      .where({ "known.warrior_id": member.id }).whereNot("discipline.kind", "Prayer").first("known.id");
    const owned = await query("warrior_inventory").where({ warrior_id: member.id }).select("shop_item_id", "model_index", "quantity");
    const mutationIds = await query("warrior_mutations").where({ warrior_id: member.id }).pluck("mutation_id");
    const eligibility = {
      warbandName: ctx.warbandName, typeName: member.typeName, role: member.role,
      skillNames: skills, stats: member.stats, mutationIds,
      spellcaster: Boolean(spellAccess || learnedMagic),
      ownedItemIds: owned.map((row) => row.shop_item_id).filter(Boolean),
    };
    const permitted = permissions.filter((option) => canUseEquipment(option, eligibility));
    return { member, permissions: permitted, owned,
      eligibility: { ...eligibility, permittedNames: permitted.map((option) => option.name) } };
  }
  function canReceive(source, option, shop, ctx, recipient) {
    const { member, permissions, eligibility } = recipient;
    if (source.nontransferable || (source.bound_warrior_id && source.bound_warrior_id !== member.id)) return false;
    if (source.shop_item_id) {
      if (shop?.definition.requiresOwnedItem && !recipient.owned.some((row) => row.shop_item_id === shop.definition.requiresOwnedItem)) return false;
      if (shop?.definition.maxPerModel) {
        const counts = Array.from({ length: member.role === "Henchman" ? member.group_size : 1 }, (_, index) =>
          recipient.owned.filter((row) => row.shop_item_id === shop.id && (member.role !== "Henchman" || row.model_index === index))
            .reduce((sum, row) => sum + row.quantity, 0));
        const individual = permissions.some((entry) => entry.allow_individual_group_gear);
        if (individual ? counts.every((count) => count >= shop.definition.maxPerModel) : counts.some((count) => count >= shop.definition.maxPerModel)) return false;
      }
      return Boolean(shop && (!shop.campaign_id || shop.campaign_id === ctx.roster.campaign_id)
        && canEquipItem(shop.definition, eligibility));
    }
    if (!option) return false;
    if (!canUseEquipment(option, eligibility)) return false;
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
      query("equipment_options as option").leftJoin("weapon_profiles as weapon", "weapon.id", "option.weapon_profile_id")
        .whereIn("option.id", [...new Set(rows.map((row) => row.equipment_option_id).filter(Boolean))])
        .select("option.*", "weapon.weapon_type as weaponType"),
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
        nontransferable: row.nontransferable, boundWarriorId: row.bound_warrior_id,
        ...describeMap(row.map_result),
        ...equipmentSale(row, option, item, ctx.shop),
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
        upgradeQuantity: shared ? recipient.member.group_size : 1, returnModelIndex: shared ? -1 : row.model_index };
    }) };
  }
  async function getTrading(rosterId) {
    const ctx = await context(db, rosterId);
    const searches = await db("trading_searches").where({ roster_id: rosterId, battle_number: ctx.battle }).orderBy("created_at");
    const statuses = await db("trading_hero_status").where({ roster_id: rosterId, battle_number: ctx.battle });
    const heroes = await db("warriors").where({ roster_id: rosterId, role: "Hero" }).select("id", "name");
    return {
      shop: ctx.shop.map((item) => ({ ...item, ...(item.id === "mordheim-map" ? { mapTypes } : {}), canPurchase: canPurchaseItem(ctx, item), disabled: Boolean(item.disabled || !canBuyItem(item, ctx.warbandName)),
        rarity: purchaseRarity(ctx, item) })),
      ...await inventory(db, ctx),
      heroes: await Promise.all(heroes.map(async (hero) => ({
        ...hero, outOfAction: statuses.some((row) => row.hero_id === hero.id && row.out_of_action),
        searched: searches.some((row) => row.hero_id === hero.id),
        spellcaster: (await memberContext(db, ctx, hero.id)).eligibility.spellcaster,
      }))),
      searches: searches.map((row) => ({
        id: row.id, heroId: row.hero_id, heroName: row.hero_name, itemId: row.item_id,
        itemName: ctx.shop.find((item) => item.id === row.item_id)?.name ?? row.item_id,
        dice: row.dice, modifier: row.modifier, total: row.total, success: row.success, purchased: row.purchased,
      })),
      canPurchase: ctx.canPurchase, canSell: ctx.canSell, canSearch: ctx.canSearch, canTransfer: ctx.canTransfer,
      treasury: String(ctx.roster.treasury),
    };
  }
  async function search(rosterId, { heroId, itemId, mode, dice, quoteId }) {
    return db.transaction(async (trx) => {
      const ctx = await context(trx, rosterId, true);
      const item = findItem(ctx, itemId);
      const ritual = item.purchaseAction === "ritual";
      if (ritual && !canPurchaseItem(ctx, item)) fail("Mordheim shop purchases are unavailable before the first battle or outside the purchasing phase.");
      if (!ctx.canSearch && !(ritual && !ctx.roster.campaign_id)) fail("Rare-item searches are only available at post-battle step 6.");
      if (item.creationOnly) fail("This item may only be purchased during warband creation.");
      const hero = await memberContext(trx, ctx, heroId);
      if (hero.member.role !== "Hero") fail("Only Heroes can search for rare items.");
      const rarity = effectiveRarity(item, ctx.warbandName, hero.member.typeName);
      if (rarity === null && !ritual) fail("Common items do not require a rarity search.");
      if (await trx("trading_hero_status").where({ hero_id: heroId, battle_number: ctx.battle, out_of_action: true }).first()) {
        fail("Heroes taken out of action in this battle cannot search.");
      }
      if (ctx.roster.campaign_id && await trx("trading_searches").where({ roster_id: rosterId, hero_id: heroId, battle_number: ctx.battle }).first()) {
        fail("This Hero has already used their search for this battle.");
      }
      let ritualOffer;
      if (ritual) {
        if (!quoteId) fail("Get a ritual price quote for this spellcaster before summoning.");
        if (!hero.eligibility.spellcaster) fail("Only spellcasters, not prayer users, can summon a familiar.");
        ritualOffer = await trx("trading_quotes").where({ id: quoteId, roster_id: rosterId, item_id: item.id, buyer_id: heroId, consumed: false, battle_number: ctx.battle }).first();
        if (!ritualOffer) fail("Get a ritual price quote for this spellcaster before summoning.");
        if (Number(ctx.roster.treasury) < ritualOffer.price) fail("Not enough Gold Crowns for the ritual.");
        await trx("rosters").where({ id: rosterId }).update({ treasury: Number(ctx.roster.treasury) - ritualOffer.price, updated_at: new Date() });
        await trx("trading_quotes").where({ id: ritualOffer.id }).update({ consumed: true });
      }
      const rolled = diceFor(mode, dice, 2);
      const modifier = hero.eligibility.skillNames.includes("Streetwise") ? 2 : 0;
      const total = rolled.reduce((sum, value) => sum + value, ritual ? 0 : modifier);
      const values = {
        roster_id: rosterId, hero_id: heroId, hero_name: hero.member.name || hero.member.type,
        battle_number: ctx.battle, item_id: item.id, dice: JSON.stringify(rolled), modifier: ritual ? 0 : modifier, total, success: rarity === null || total >= rarity,
        purchased: ritual && (rarity === null || total >= rarity),
      };
      const [result] = ctx.roster.campaign_id ? await trx("trading_searches").insert(values).returning("*") : [{ ...values, dice: rolled }];
      if (ritual && result.success) await trx("warband_stash").insert({
        roster_id: rosterId, shop_item_id: item.id, quantity: 1, unit_cost_paid: ritualOffer.price, bound_warrior_id: heroId,
      });
      return result;
    });
  }
  async function quote(rosterId, { itemId, mode, dice, buyerId }) {
    return db.transaction(async (trx) => {
      const ctx = await context(trx, rosterId, true);
      const item = findItem(ctx, itemId);
      if (!canPurchaseItem(ctx, item)) fail("Mordheim shop purchases are unavailable before the first battle or outside the purchasing phase.");
      let priced = item;
      if (buyerId) {
        const buyer = await memberContext(trx, ctx, buyerId);
        if (buyer.member.role !== "Hero" || !canEquipItem(item, buyer.eligibility)) fail("Choose an eligible Hero as buyer.");
        priced = effectivePrice(item, buyer.member.typeName);
      }
      if (item.purchaseAction === "ritual" && !buyerId) fail("Choose the spellcaster performing this ritual.");
      const existing = await trx("trading_quotes").where({
        roster_id: rosterId, item_id: itemId, battle_number: ctx.battle, consumed: false, buyer_id: buyerId ?? null,
      }).orderBy("created_at").first();
      if (existing) return { id: existing.id, itemId, price: existing.price, dice: existing.dice };
      const rolled = diceFor(mode, dice ?? [], priced.priceDice);
      const price = priced.baseCost + rolled.reduce((sum, value) => sum + value, 0) * priced.priceMultiplier;
      const [row] = await trx("trading_quotes").insert({
        roster_id: rosterId, item_id: itemId, battle_number: ctx.battle, price, dice: JSON.stringify(rolled), buyer_id: buyerId ?? null,
      }).returning("id");
      return { id: row.id, itemId, price, dice: rolled };
    });
  }
  async function purchase(rosterId, { quoteId, quantity, searchId, mapSelection }) {
    return db.transaction(async (trx) => {
      const ctx = await context(trx, rosterId, true);
      const offer = await trx("trading_quotes").where({ id: quoteId, roster_id: rosterId, battle_number: ctx.battle }).first();
      if (!offer || offer.consumed) fail("This price quote is missing, expired, or already purchased.");
      const item = findItem(ctx, offer.item_id);
      if (!canPurchaseItem(ctx, item)) fail("Mordheim shop purchases are unavailable before the first battle or outside the purchasing phase.");
      if (item.purchaseAction) fail("Use this item's special purchase action, not a normal purchase.");
      await checkStockLimit(trx, ctx, item, quantity);
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
      if (ctx.roster.campaign_id && rarity !== null && !item.creationOnly) {
        if (!found) fail("A successful Hero search is required to buy this rare item.");
        if (quantity !== 1) fail("Each successful search permits only one rare item.");
      }
      const total = offer.price * quantity;
      if (!integer(total, 0, 2147483647) || total > Number(ctx.roster.treasury)) fail("Not enough Gold Crowns for this purchase.");
      await insertAcquired(trx, rosterId, item, quantity, offer.price, mapSelection);
      await trx("rosters").where({ id: rosterId }).update({ treasury: Number(ctx.roster.treasury) - total, updated_at: new Date() });
      await trx("trading_quotes").where({ id: offer.id }).update({ consumed: true });
      if (found) await trx("trading_searches").where({ id: found.id }).update({ purchased: true });
    });
  }
  async function addSpoils(rosterId, { itemId, quantity, mapSelection }) {
    return db.transaction(async (trx) => {
      const ctx = await context(trx, rosterId, true);
      if (ctx.roster.campaign_id) fail("Manual combat spoils are only available in Freebuild.", 409);
      const item = findItem(ctx, itemId);
      if (item.purchaseAction) fail("This item requires its special purchase action and cannot be added as free spoils.");
      if (!canPurchaseItem(ctx, item)) fail("Combat spoils require at least one Freebuild battle; creation-only items cannot be acquired after creation.");
      await checkStockLimit(trx, ctx, item, quantity);
      await insertAcquired(trx, rosterId, item, quantity, 0, mapSelection);
      await trx("rosters").where({ id: rosterId }).update({ updated_at: new Date() });
    });
  }
  async function sell(rosterId, { source, inventoryIds, quantity, memberId }, transaction) {
    const execute = async (trx) => {
      const ctx = await context(trx, rosterId, true);
      if (!ctx.canSell) fail("Second-hand sales are available after the first battle in Freebuild, or during campaign purchasing steps 6–8.");
      const table = source === "stash" ? "warband_stash" : "warrior_inventory";
      const query = trx(table).whereIn("id", inventoryIds).forUpdate();
      if (source === "stash") query.where({ roster_id: rosterId });
      else query.whereIn("warrior_id", trx("warriors").where({ roster_id: rosterId }).select("id"));
      if (memberId) query.where({ warrior_id: memberId });
      const rows = await query;
      if (rows.length !== inventoryIds.length) fail("Inventory entry not found in this warband.", 404);
      if (source === "stash" && (rows.length !== 1 || !integer(quantity, 1, rows[0].quantity))) fail("Select one stash stack and a valid sale quantity.", 400);
      if (source === "member" && quantity !== undefined) fail("Sell carried stacks together; a partial group sale is not allowed.", 400);
      let total = 0;
      for (const row of rows) {
        const option = row.equipment_option_id ? await trx("equipment_options").where({ id: row.equipment_option_id }).first() : null;
        const definition = row.shop_item_id ? (await trx("shop_items").where({ id: row.shop_item_id }).first())?.definition : null;
        const sale = equipmentSale(row, option, definition, ctx.shop);
        if (sale.saleRestriction) fail(sale.saleRestriction);
        if (source === "member") {
          const recipient = await memberContext(trx, ctx, row.warrior_id);
          if (recipient.member.role === "Henchman" && !recipient.permissions.some((entry) => entry.allow_individual_group_gear)) {
            const matching = await trx("warrior_inventory").where({
              warrior_id: row.warrior_id, equipment_option_id: row.equipment_option_id,
              shop_item_id: row.shop_item_id, unit_cost_paid: row.unit_cost_paid,
            });
            if (matching.some((entry) => !inventoryIds.includes(entry.id))) fail("Sell the matching equipment from every model in this Henchman group.");
            const counts = Array.from({ length: recipient.member.group_size }, (_, index) =>
              matching.filter((entry) => entry.model_index === index).reduce((sum, entry) => sum + entry.quantity, 0));
            if (counts.some((count) => count !== counts[0])) fail("This Henchman group must be equipped identically before selling.");
          }
          const carried = await trx("warrior_inventory as inventory").join("shop_items as item", "item.id", "inventory.shop_item_id")
            .where("inventory.warrior_id", row.warrior_id).select("inventory.id", "item.definition");
          if (carried.some((entry) => entry.definition.requiresOwnedItem === row.shop_item_id && !inventoryIds.includes(entry.id))) {
            fail("Sell or return the mount's barding before selling its mount.");
          }
        }
        total += sale.unitSaleValue * (source === "stash" ? quantity : row.quantity);
      }
      const treasury = Number(ctx.roster.treasury) + total;
      if (!integer(treasury, 0, 2147483647)) fail("This sale would exceed the treasury limit.");
      for (const row of rows) {
        const amount = source === "stash" ? quantity : row.quantity;
        if (amount === row.quantity) await trx(table).where({ id: row.id }).delete();
        else await trx(table).where({ id: row.id }).decrement("quantity", amount);
      }
      await trx("rosters").where({ id: rosterId }).update({ treasury, updated_at: new Date() });
      return { refundAmount: total, treasury };
    };
    return transaction ? execute(transaction) : db.transaction(execute);
  }
  async function transfer(rosterId, { direction, inventoryId, memberId, quantity, modelIndex }) {
    return db.transaction(async (trx) => {
      const ctx = await context(trx, rosterId, true);
      if (!ctx.canTransfer) fail("Equipment can be moved only during setup, pre-battle, or post-battle reallocation (step 9).");
      const recipient = await memberContext(trx, ctx, memberId);
      const { member, permissions } = recipient;
      const table = direction === "to_member" ? "warband_stash" : "warrior_inventory";
      const source = await trx(table).where({ id: inventoryId, ...(direction === "to_member" ? { roster_id: rosterId } : { warrior_id: memberId }) }).first();
      if (!source) fail("Inventory entry not found in this warband.", 404);
      if (source.nontransferable) fail("This permanently upgraded weapon cannot be traded or returned to stash.");
      if (direction === "to_stash" && source.shop_item_id === "warhorse") {
        const barding = await trx("warrior_inventory as inventory").join("shop_items as item", "item.id", "inventory.shop_item_id")
          .where("inventory.warrior_id", memberId).whereRaw("item.definition->>'requiresOwnedItem' = ?", ["warhorse"]).first("inventory.id");
        if (barding) fail("Return the warhorse's barding to stash before returning its mount.");
      }
      const all = member.role === "Henchman" && modelIndex === -1;
      if (direction === "to_member") {
        if (member.role === "Henchman" && !all && !permissions.some((entry) => entry.allow_individual_group_gear)) {
          fail("This Henchman group must be equipped identically; transfer to all models.");
        }
        if (member.role === "Henchman" && !all && modelIndex >= member.group_size) fail("That model does not exist.", 400);
        const option = source.equipment_option_id ? await trx("equipment_options as option")
          .leftJoin("weapon_profiles as weapon", "weapon.id", "option.weapon_profile_id")
          .where("option.id", source.equipment_option_id).first("option.*", "weapon.weapon_type as weaponType") : null;
        const shop = source.shop_item_id ? await trx("shop_items").where({ id: source.shop_item_id }).first() : null;
        if (!canReceive(source, option, shop, ctx, recipient)) {
          fail("This warrior cannot use this item. Check equipment lists, warband restrictions, and required skills.");
        }
        if (shop?.definition.maxPerModel) {
          const already = await trx("warrior_inventory").where({ warrior_id: memberId, shop_item_id: shop.id })
            .whereIn("model_index", all ? Array.from({ length: member.group_size }, (_, index) => index) : [member.role === "Henchman" ? modelIndex : member.role === "Hired Sword" ? -1 : 0])
            .select("model_index", "quantity");
          if (quantity > shop.definition.maxPerModel || already.some((row) => row.quantity + quantity > shop.definition.maxPerModel)) fail("This model already has its maximum copies of this item.");
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
          bound_warrior_id: source.bound_warrior_id, nontransferable: source.nontransferable,
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
      const origin = { equipment_option_id: source.equipment_option_id, shop_item_id: source.shop_item_id, quantity, unit_cost_paid: source.unit_cost_paid, bound_warrior_id: source.bound_warrior_id, nontransferable: source.nontransferable, map_result: source.map_result };
      if (direction === "to_member") await trx("warrior_inventory").insert(indices.map((index) => ({ ...origin, warrior_id: memberId, model_index: index })));
      else await trx("warband_stash").insert({ ...origin, roster_id: rosterId });
    });
  }
  async function upgrade(rosterId, { itemId, inventoryId, quoteId }) {
    return db.transaction(async (trx) => {
      const ctx = await context(trx, rosterId, true);
      const item = findItem(ctx, itemId);
      if (!canPurchaseItem(ctx, item) || item.purchaseAction !== "permanent-upgrade") fail("This weapon upgrade is unavailable.");
      const offer = await trx("trading_quotes").where({ id: quoteId, roster_id: rosterId, item_id: item.id, consumed: false, battle_number: ctx.battle }).first();
      if (!offer) fail("Get a price quote before applying this permanent upgrade.");
      const source = await trx("warrior_inventory").where({ id: inventoryId })
        .whereIn("warrior_id", trx("warriors").where({ roster_id: rosterId }).select("id")).first();
      if (!source || source.nontransferable) fail("Choose an unmodified carried weapon.", 400);
      const recipient = await memberContext(trx, ctx, source.warrior_id);
      if (!canEquipItem(item, recipient.eligibility)) fail("This warrior cannot use this upgrade.");
      const origin = source.shop_item_id ? await trx("shop_items").where({ id: source.shop_item_id }).first()
        : await trx("equipment_options").where({ id: source.equipment_option_id }).first();
      const definition = source.shop_item_id ? origin.definition : {
        name: origin.name, category: origin.category, weaponNames: [origin.name], ranged: Boolean(origin.ranged),
        description: origin.rule_text ?? "", sourceReference: origin.source_reference,
      };
      if (definition.category !== "weapon") fail("Only weapons may receive this upgrade.", 400);
      const shared = recipient.member.role === "Henchman" && !recipient.permissions.some((entry) => entry.allow_individual_group_gear);
      const matches = shared ? await trx("warrior_inventory").where({
        warrior_id: source.warrior_id, equipment_option_id: source.equipment_option_id,
        shop_item_id: source.shop_item_id, unit_cost_paid: source.unit_cost_paid, nontransferable: false,
      }).orderBy("created_at") : [source];
      const targets = shared ? Array.from({ length: recipient.member.group_size }, (_, index) => matches.find((row) => row.model_index === index)) : [source];
      if (targets.some((row) => !row)) fail("Every model in this group needs a matching weapon to upgrade.");
      const total = offer.price * targets.length;
      if (Number(ctx.roster.treasury) < total) fail("Not enough Gold Crowns to upgrade these weapons.");
      const id = `upgrade/${randomUUID()}`;
      await trx("shop_items").insert({
        id, definition: JSON.stringify({ ...definition, id, name: `${definition.name} (Poisoned)`,
          description: `${definition.description} Permanent poison: +1 to injury rolls. Cannot be traded or sold.` }),
        weapon_profile_id: origin.weapon_profile_id, material_modifier_id: origin.material_modifier_id,
      });
      for (const target of targets) {
        if (target.quantity === 1) await trx("warrior_inventory").where({ id: target.id }).update({
          equipment_option_id: null, shop_item_id: id, unit_cost_paid: target.unit_cost_paid + offer.price, nontransferable: true,
        });
        else {
          await trx("warrior_inventory").where({ id: target.id }).decrement("quantity", 1);
          await trx("warrior_inventory").insert({
            warrior_id: target.warrior_id, model_index: target.model_index, equipment_option_id: null,
            shop_item_id: id, quantity: 1, unit_cost_paid: target.unit_cost_paid + offer.price, nontransferable: true,
          });
        }
        await trx("trading_quotes").where({ id: offer.id }).update({ consumed: true });
      }
      await trx("rosters").where({ id: rosterId }).update({ treasury: Number(ctx.roster.treasury) - total, updated_at: new Date() });
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
  async function resolveMap(rosterId, { source, inventoryId, mapSelection }) {
    return db.transaction(async (trx) => {
      const ctx = await context(trx, rosterId, true);
      if (!ctx.canTransfer && !ctx.canPurchase) fail("Resolve maps during purchasing or equipment reallocation.");
      const table = source === "stash" ? "warband_stash" : "warrior_inventory";
      const query = trx(table).where({ id: inventoryId }).forUpdate();
      if (source === "stash") query.where({ roster_id: rosterId });
      else query.whereIn("warrior_id", trx("warriors").where({ roster_id: rosterId }).select("id"));
      const row = await query.first();
      if (!row) fail("Inventory entry not found in this warband.", 404);
      if (row.shop_item_id !== "mordheim-map") fail("This item is not a Mordheim map.", 400);
      if (row.map_result) fail("This map's type has already been recorded.");
      const [result] = resolveMaps(mapSelection, 1);
      if (row.quantity === 1) await trx(table).where({ id: row.id }).update({ map_result: result });
      else {
        await trx(table).where({ id: row.id }).decrement("quantity", 1);
        const { id, created_at, ...copy } = row;
        await trx(table).insert({ ...copy, quantity: 1, map_result: result });
      }
      await trx("rosters").where({ id: rosterId }).update({ updated_at: new Date() });
    });
  }
  return { getTrading, search, quote, purchase, addSpoils, resolveMap, upgrade, transfer, sell, heroStatus, casualty };
}
module.exports = { createTradingRepository };
