const { fail, integer } = require("./trading-rules.service");
const { releaseRefundedPurchaseSearch } = require("../repositories/trading.repository");

async function cancelTomeUse(db, warriorId, useId) {
  return db.transaction(async (trx) => {
    const location = await trx("warriors").where({ id: warriorId }).first("roster_id");
    if (!location) fail("Warrior not found.", 404);
    const roster = await trx("rosters").where({ id: location.roster_id }).forUpdate().first();
    const warrior = await trx("warriors").where({ id: warriorId }).forUpdate().first();
    const use = await trx("consumed_item_uses").where({ id: useId, warrior_id: warriorId, roster_id: roster.id }).forUpdate().first();
    if (!use) fail("Consumed Tome record not found or already cancelled.", 404);
    if (use.battles_fought !== Number(roster.battles_fought)) fail("This Tome use is fixed because the battle counter has changed.");
    const { state } = use;
    const newSpells = await trx("warrior_spells").leftJoin("spells", "spells.id", "warrior_spells.spell_id")
      .where("warrior_id", warriorId).whereNotIn("warrior_spells.id", state.spellIds)
      .where((query) => query.where("spells.spell_discipline_id", state.disciplineId).orWhereNull("warrior_spells.spell_id"))
      .select("warrior_spells.id", "warrior_spells.choice_battles_fought");
    if (newSpells.some((spell) => spell.choice_battles_fought !== Number(roster.battles_fought))) {
      fail("A spell gained from this Tome has become fixed; it cannot be refunded.");
    }
    const ids = newSpells.map((spell) => spell.id);
    await trx("warrior_advances").where({ warrior_id: warriorId }).whereIn("learned_spell_id", ids).update({ learned_spell_id: null });
    await trx("warrior_advances").where({ warrior_id: warriorId }).whereIn("reduced_spell_id", ids).update({ reduced_spell_id: null });
    await trx("warrior_spells").whereIn("id", ids).delete();
    await trx("warriors").where({ id: warriorId }).update({
      lesser_magic_unlocked: state.lesserMagicUnlocked, selected_spell_discipline_id: state.selectedDisciplineId, updated_at: new Date(),
    });
    const refundable = state.item.purchase_battles_fought === Number(roster.battles_fought);
    if (refundable) {
      const treasury = Number(roster.treasury) + Number(state.item.unit_cost_paid);
      if (!integer(treasury, 0, 2147483647)) fail("This refund exceeds the treasury limit.");
      await trx("rosters").where({ id: roster.id }).update({ treasury, updated_at: new Date() });
    } else {
      const existing = await trx("warrior_inventory").where({ id: state.item.id }).first();
      if (existing) await trx("warrior_inventory").where({ id: existing.id }).increment("quantity", 1);
      else {
        const columns = await trx("warrior_inventory").columnInfo();
        const item = Object.fromEntries(Object.entries({ ...state.item, quantity: 1 }).map(([key, value]) =>
          [key, columns[key]?.type === "jsonb" && value !== null ? JSON.stringify(value) : value]));
        await trx("warrior_inventory").insert(item);
      }
    }
    await trx("consumed_item_uses").where({ id: useId }).delete();
    if (refundable && state.item.purchase_id) await releaseRefundedPurchaseSearch(trx, roster.id, state.item.purchase_id);
    await trx("injury_previews").where({ warrior_id: warriorId }).delete();
    return { cancelled: true };
  });
}

module.exports = { cancelTomeUse };
