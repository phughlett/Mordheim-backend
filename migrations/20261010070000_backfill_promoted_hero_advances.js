exports.up = async function up(knex) {
  await knex.raw(`
    insert into warrior_advances (warrior_id, advance_table, experience_threshold, mode, roll, secondary_roll, result, stat, created_at, consumed_at)
    select hero.id, adv.advance_table, adv.experience_threshold, adv.mode, adv.roll, adv.secondary_roll, adv.result, adv.stat, adv.created_at,
           coalesce(adv.consumed_at, now())
    from warriors hero
    join warrior_types t on t.id = hero.warrior_type_id and t.category = 'Henchman'
    join warriors src on src.roster_id = hero.roster_id and src.warrior_type_id = hero.warrior_type_id and src.role = 'Henchman'
    join warrior_advances adv on adv.warrior_id = src.id and adv.advance_table = 'Henchman'
    where hero.role = 'Hero'
      and hero.promotion_experience > 0
      and adv.experience_threshold <= hero.promotion_experience
      and not exists (select 1 from warrior_advances x where x.warrior_id = hero.id and x.advance_table = 'Henchman')
      and (select count(*) from warriors s2 where s2.roster_id = hero.roster_id and s2.warrior_type_id = hero.warrior_type_id and s2.role = 'Henchman') = 1
  `);
};

exports.down = async function down() {};
