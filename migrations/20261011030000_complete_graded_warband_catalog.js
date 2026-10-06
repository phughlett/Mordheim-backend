const { index, additions, definitions, validateDefinitions } = require("../src/services/warband-source.service");

const json = (value) => JSON.stringify(value);
const rules = (entries) => (entries ?? []).map(({ name, summary }) => ({ name, summary }));
const copiedRow = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
  [key, value !== null && typeof value === "object"
    && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype) ? json(value) : value]));

async function upsert(query, table, match, values) {
  const existing = await query(table).where(match).first("id");
  if (existing) {
    await query(table).where(match).update(values);
    return existing.id;
  }
  const [row] = await query(table).insert({ ...match, ...values }).returning("id");
  return row.id;
}

async function syncProfiles(query, band) {
  const profiles = new Map();
  for (const profile of band.weaponProfiles ?? []) {
    const id = await upsert(query, "weapon_profiles", { name: `${band.name}: ${profile.name}` }, {
      weapon_type: profile.weaponType, range_text: profile.rangeText,
      strength_modifier: profile.strengthModifier,
      special_rules: json((profile.specialRules ?? []).map((rule) => ({ name: rule.name, description: rule.summary }))),
      notes: profile.notes ?? null, source_reference: band.sourceUrl,
    });
    profiles.set(profile.name, { weapon_profile_id: id });
  }
  for (const profile of band.armourProfiles ?? []) {
    const id = await upsert(query, "armour_profiles", { name: `${band.name}: ${profile.name}` }, {
      item_type: profile.itemType,
      save_text: profile.saveText,
      special_rules: json((profile.specialRules ?? []).map((rule) => ({ name: rule.name, description: rule.summary }))),
      notes: profile.notes ?? null, source_reference: band.sourceUrl,
    });
    profiles.set(profile.name, { armour_profile_id: id });
  }
  return profiles;
}

async function equipmentProfile(query, item, profiles) {
  if (profiles.has(item.profileName ?? item.name)) return profiles.get(item.profileName ?? item.name);
  if (item.profileName) {
    const weapon = await query("weapon_profiles").where({ name: item.profileName }).first("id");
    if (weapon) return { weapon_profile_id: weapon.id };
    const armour = await query("armour_profiles").where({ name: item.profileName }).first("id");
    if (armour) return { armour_profile_id: armour.id };
    throw new Error(`Unknown equipment profile: ${item.profileName}`);
  }
  const exactArmour = await query("armour_profiles").where({ name: item.name }).first("id");
  if (exactArmour) return { armour_profile_id: exactArmour.id };
  const baseName = item.name.replace(/^(Gromril|Ithilmar) /, "");
  const options = await query("equipment_options").where({ name: baseName })
    .select("weapon_profile_id", "armour_profile_id");
  const unique = new Map(options.filter((row) => row.weapon_profile_id || row.armour_profile_id)
    .map((row) => [json(row), row]));
  if (unique.size === 1) return [...unique.values()][0];
  if (unique.size > 1) throw new Error(`Ambiguous equipment profile; specify profileName for ${item.name}.`);
  const weapon = await query("weapon_profiles").where({ name: baseName }).first("id");
  if (weapon) return { weapon_profile_id: weapon.id };
  const armour = await query("armour_profiles").where({ name: baseName }).first("id");
  return armour ? { armour_profile_id: armour.id } : {};
}

async function syncEquipment(query, band, warbandId) {
  const profiles = await syncProfiles(query, band);
  for (const list of band.equipmentLists ?? []) {
    await query("equipment_lists").insert({
      warband_id: warbandId, list_key: list.key, name: list.name, source_reference: band.sourceUrl,
    }).onConflict(["warband_id", "list_key"]).merge(["name", "source_reference"]);
    for (const item of list.items) {
      const profile = await equipmentProfile(query, item, profiles);
      const weapon = profile.weapon_profile_id
        ? await query("weapon_profiles").where({ id: profile.weapon_profile_id }).first("weapon_type") : null;
      const prefix = weapon?.weapon_type === "close_combat" ? item.name.match(/^(Gromril|Ithilmar) /)?.[1] : null;
      const materialName = item.materialName ?? (prefix ? `${prefix} weapon` : null);
      const material = materialName ? await query("weapon_material_modifiers").where({ name: materialName }).first("id") : null;
      if (materialName && !material) throw new Error(`Unknown weapon material: ${materialName}`);
      await upsert(query, "equipment_options", { warband_id: warbandId, list_key: list.key, name: item.name }, {
        category: item.category, unit_cost: item.unitCost, first_free: Boolean(item.firstFree),
        source_reference: band.sourceUrl, rule_text: item.ruleText ?? null,
        allowed_warrior_type_names: item.allowedWarriorTypeNames ? json(item.allowedWarriorTypeNames) : null,
        ...profile, ...(material ? { material_modifier_id: material.id } : {}),
      });
    }
    // Preserve IDs and carried gear when a source list removes an old option.
    const removed = await query("equipment_options").where({ warband_id: warbandId, list_key: list.key })
      .whereNotIn("name", list.items.map((item) => item.name)).select("id");
    if (removed.length) await query("equipment_options").whereIn("id", removed.map((row) => row.id))
      .update({ allowed_warrior_type_names: json([]) });
  }
}

async function scopedType(query, band, warbandId, type) {
  const relation = await query("warband_warrior_types as access")
    .join("warrior_types as type", "type.id", "access.warrior_type_id")
    .where({ "access.warband_id": warbandId, "type.name": type.name, "type.category": type.role })
    .first("type.*");
  if (!relation) {
    const required = ["stats", "startingExperience", "hireCost", "canGainExperience", "large", "promotionEligibility"];
    if (required.some((field) => type[field] === undefined)) {
      throw new Error(`Cannot create missing warrior ${band.name}/${type.name} from a partial source correction.`);
    }
    return upsert(query, "warrior_types", { catalog_key: `mordheimer/${band.name}/${type.role}/${type.name}` }, {
      name: type.name, category: type.role, stats: json(type.stats),
      starting_experience: type.startingExperience, hire_cost: type.hireCost,
      hire_cost_source: band.sourceUrl, source_reference: band.sourceUrl,
      can_gain_experience: type.canGainExperience, large: type.large,
      promotion_eligibility: type.promotionEligibility,
      special_rules: json(rules(type.specialRules)),
    });
  }
  const shared = await query("warband_warrior_types").where({ warrior_type_id: relation.id })
    .whereNot({ warband_id: warbandId }).whereIn("availability", ["allowed", "conditional"]).first();
  if (!shared) return relation.id;
  const { id, catalog_key, created_at, updated_at, ...values } = relation;
  const newId = await upsert(query, "warrior_types", { catalog_key: `mordheimer/${band.name}/${type.role}/${type.name}` }, copiedRow(values));
  const access = await query("warband_warrior_types").where({ warband_id: warbandId, warrior_type_id: id }).first();
  await query("warband_warrior_types").insert({ ...copiedRow(access), warrior_type_id: newId });
  for (const table of ["warrior_equipment_lists", "warrior_type_skill_categories", "warrior_type_spell_disciplines"]) {
    const rows = await query(table).where({ warband_id: warbandId, warrior_type_id: id });
    for (const { id: rowId, ...row } of rows) await query(table).insert({ ...copiedRow(row), warrior_type_id: newId });
    await query(table).where({ warband_id: warbandId, warrior_type_id: id }).delete();
  }
  return { id: newId, oldId: id };
}

async function syncWarriors(query, band, warbandId) {
  for (const [position, type] of (band.warriors ?? []).entries()) {
    const result = await scopedType(query, band, warbandId, type);
    const typeId = typeof result === "string" ? result : result.id;
    const values = {};
    for (const [field, column] of Object.entries({
      stats: "stats", hireCost: "hire_cost", startingExperience: "starting_experience",
      large: "large", canGainExperience: "can_gain_experience", promotionEligibility: "promotion_eligibility",
      specialRules: "special_rules",
    })) {
      if (type[field] !== undefined) values[column] = ["stats", "specialRules"].includes(field) ? json(type[field]) : type[field];
    }
    if (type.hireCost !== undefined) values.hire_cost_source = band.sourceUrl;
    if (type.canGainExperience === false) values.experience_rule = "This warrior cannot gain experience.";
    if (type.canGainExperience === true) values.experience_rule = null;
    if (type.promotionEligibility !== undefined) values.promotion_rule = type.promotionEligibility === "eligible"
      ? "May become a Hero through Lad's Got Talent." : "This profile cannot be promoted through Lad's Got Talent.";
    if (Object.keys(values).length) await query("warrior_types").where({ id: typeId }).update(values);
    const match = { warband_id: warbandId, warrior_type_id: typeId };
    const accessValues = {
      availability: type.conditionText ? "conditional" : "allowed", source_reference: band.sourceUrl,
      ...(type.conditionText !== undefined ? { condition_text: type.conditionText } : {}),
      ...(type.maxCount !== undefined ? { max_count: type.maxCount } : {}),
      ...(type.referenceTypes !== undefined ? { max_count_reference_types: json(type.referenceTypes) } : {}),
      ...(type.maxCountMultiplier !== undefined ? { max_count_multiplier: type.maxCountMultiplier } : {}),
      rule_text: `Use the ${band.name} source profile.${type.maxCount != null ? ` Maximum ${type.maxCount} ${type.name}.` : ""}`,
      ...(additions.includes(band) ? { sheet_order: position } : {}),
    };
    await query("warband_warrior_types").insert({ ...match, ...accessValues })
      .onConflict(["warband_id", "warrior_type_id"]).merge(accessValues);
    if (typeof result !== "string") {
      await query("warriors").where({ warrior_type_id: result.oldId })
        .whereIn("roster_id", query("rosters").where({ warband_id: warbandId }).select("id"))
        .update({ warrior_type_id: typeId });
      await query("warband_warrior_types").where({ warband_id: warbandId, warrior_type_id: result.oldId }).delete();
    }
    if (type.equipmentListKeys) {
      await query("warrior_equipment_lists").where(match).delete();
      for (const listKey of type.equipmentListKeys) await query("warrior_equipment_lists").insert({
        ...match, list_key: listKey, allowed_categories: json(type.allowedCategories ?? ["weapon", "armour", "shield", "set", "misc"]),
        allow_individual_group_gear: Boolean(type.allowIndividualGroupGear),
        source_reference: band.sourceUrl, rule_text: `Use the ${listKey} equipment list.`,
      });
    }
    if (type.skillCategories) {
      await query("warrior_type_skill_categories").where(match).delete();
      for (const category of type.skillCategories) await query("warrior_type_skill_categories").insert({
        ...match, category, special_list_name: category === "Special" ? type.specialListName ?? `${band.name} Special Skills` : null,
      });
    }
  }
}

async function syncSkillsAndSpells(query, band, warbandId) {
  for (const skill of band.skills ?? []) {
    await upsert(query, "skills", {
      warband_id: warbandId, special_list_name: skill.listName, name: skill.name,
    }, {
      category: "Special", description: skill.summary,
      applies_to_warrior_type_names: skill.appliesTo ? json(skill.appliesTo) : null,
      source_reference: band.sourceUrl,
    });
  }
  for (const discipline of band.spellDisciplines ?? []) {
    const disciplineId = await upsert(query, "spell_disciplines", { name: discipline.name }, {
      kind: discipline.kind, source_reference: band.sourceUrl, casting_rule_summary: discipline.castingRuleSummary,
    });
    for (const spell of discipline.spells) {
      const spellName = (name) => name.replace(/[’‘]/g, "'").toLowerCase();
      const existing = (await query("spells").where({ spell_discipline_id: disciplineId }).select("id", "name", "d6_result"))
        .find((row) => spellName(row.name) === spellName(spell.name));
      const match = existing ? { id: existing.id } : { spell_discipline_id: disciplineId, name: spell.name };
      await upsert(query, "spells", match, {
        d6_result: spell.roll, casting_difficulty: spell.difficulty, difficulty_note: spell.difficultyNote ?? null,
        effect_summary: spell.effectSummary,
      });
    }
  }
  for (const access of band.spellAccess ?? []) {
    const type = await query("warband_warrior_types as access").join("warrior_types as type", "type.id", "access.warrior_type_id")
      .where({ "access.warband_id": warbandId, "type.name": access.warriorType }).first("type.id");
    const discipline = await query("spell_disciplines").where({ name: access.discipline }).first("id");
    if (!type || !discipline) throw new Error(`Unknown spell access: ${band.name}/${access.warriorType}/${access.discipline}`);
    await upsert(query, "warrior_type_spell_disciplines", {
      warband_id: warbandId, warrior_type_id: type.id, spell_discipline_id: discipline.id,
    }, {
      starting_spell_count: access.startingSpellCount, is_wizard: access.isWizard,
      choice_group: access.choiceGroup ?? null, selection_rule: access.selectionRule, source_reference: band.sourceUrl,
    });
  }
}

async function syncHiredSwords(query, band, warbandId) {
  const policy = band.hiredSwordPolicy;
  if (!policy) return;
  if (policy.inheritWarband) {
    const parent = await query("warbands").where({ name: policy.inheritWarband }).first("id");
    if (!parent) throw new Error(`Unknown Hired Sword parent: ${policy.inheritWarband}`);
    const rows = await query("warband_warrior_types as access")
      .join("warrior_types as type", "type.id", "access.warrior_type_id")
      .where({ "access.warband_id": parent.id, "type.category": "Hired Sword" }).select("access.*");
    for (const row of rows) await query("warband_warrior_types").insert({
      ...copiedRow(row), warband_id: warbandId, source_reference: band.sourceUrl,
      rule_text: policy.summary,
    }).onConflict(["warband_id", "warrior_type_id"]).merge(["availability", "source_reference", "rule_text", "condition_text"]);
  }
  if (policy.allowedNames || policy.excludedNames) {
    const types = await query("warrior_types").where({ category: "Hired Sword" }).select("id", "name");
    for (const name of [...(policy.allowedNames ?? []), ...(policy.excludedNames ?? [])]) {
      if (!types.some((type) => type.name === name)) throw new Error(`Unknown Hired Sword: ${band.name}/${name}`);
    }
    for (const type of types) {
      const excluded = policy.excludedNames?.includes(type.name);
      const allowed = policy.allowedNames?.includes(type.name);
      if (!excluded && !allowed && !policy.allowedNames) continue;
      const values = {
        availability: excluded || !allowed ? "prohibited" : policy.conditionalNames?.includes(type.name) ? "conditional" : "allowed",
        source_reference: band.sourceUrl, rule_text: policy.summary,
        condition_text: allowed && policy.conditionalNames?.includes(type.name) ? policy.summary : null,
      };
      await query("warband_warrior_types").insert({ warband_id: warbandId, warrior_type_id: type.id, ...values })
        .onConflict(["warband_id", "warrior_type_id"]).merge(values);
    }
  }
}

async function syncWarbandCatalog(query) {
  validateDefinitions();
  for (const band of definitions) {
    const metadata = index.warbands.find((entry) => entry.name === band.name);
    const values = {
      is_available: true, grade: metadata.grade, display_name: metadata.displayName ?? band.name,
      source_url: band.sourceUrl,
      ...(band.specialRules ? { special_rules: json(rules(band.specialRules)) } : {}),
      ...(band.maxMembers !== undefined ? {
        max_members: band.maxMembers, limits_source_reference: band.sourceUrl,
        limits_rule: `${band.name} warbands have a base maximum of ${band.maxMembers} warriors.`,
      } : {}),
      ...(band.maxHeroes !== undefined ? { max_heroes: band.maxHeroes } : {}),
      ...(band.leaderType ? { leader_type_name: band.leaderType } : {}),
    };
    const warbandId = await upsert(query, "warbands", { name: band.name }, { source_reference: band.sourceUrl, ...values });
    await syncEquipment(query, band, warbandId);
    await syncWarriors(query, band, warbandId);
    await syncSkillsAndSpells(query, band, warbandId);
    await syncHiredSwords(query, band, warbandId);
  }
  for (const entry of index.warbands) {
    await query("warbands").where({ name: entry.name }).update({
      grade: entry.grade, display_name: entry.displayName ?? entry.name, source_url: `${index.source}/${entry.path}`,
    });
  }
}

exports.syncWarbandCatalog = syncWarbandCatalog;
exports.up = async function up(knex) {
  await knex.schema.alterTable("warbands", (table) => {
    table.string("grade", 8);
    table.string("display_name");
    table.text("source_url");
    table.string("leader_type_name");
    table.jsonb("special_rules").notNullable().defaultTo(knex.raw("'[]'::jsonb"));
  });
  await knex.schema.alterTable("warrior_types", (table) => {
    table.jsonb("special_rules").notNullable().defaultTo(knex.raw("'[]'::jsonb"));
  });
  await knex.schema.alterTable("armour_profiles", (table) => {
    table.text("save_text").alter();
  });
  await knex.raw("ALTER TABLE equipment_options DROP CONSTRAINT equipment_options_category_check");
  await knex.raw("ALTER TABLE equipment_options ADD CONSTRAINT equipment_options_category_check CHECK (category IN ('weapon', 'armour', 'shield', 'set', 'misc'))");
  await syncWarbandCatalog(knex);
};

exports.down = async function down() {
  throw new Error("Restore a backup to undo the source audit; existing rosters may reference added catalog entries.");
};
