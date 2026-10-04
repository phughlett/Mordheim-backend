const statKeys = ["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"];

function pickFields(body, allowedFields) {
  return Object.fromEntries(allowedFields.filter((field) => body?.[field] !== undefined).map((field) => [field, body[field]]));
}

async function resolveWarbandSelection(repository, values) {
  if (values.warbandId === undefined) return true;
  const selectedId = values.warbandId;
  delete values.warbandId;
  if (selectedId === null || selectedId === "") {
    values.warband_id = null;
    values.warband = "";
    return true;
  }
  const warband = await repository.findWarband(selectedId, ["id", "name"]);
  if (!warband) {
    return { status: 400, body: { error: "Unknown warband." } };
  }
  values.warband_id = warband.id;
  values.warband = warband.name;
  return true;
}

async function validateWarriorTypeCount(repository, rosterId, warriorType, exceptMemberId, addedGroupSize = 1) {
  const currentCount = await repository.sumTypeModels(rosterId, warriorType.id, exceptMemberId);
  let maximum = warriorType.max_count === null ? null : Number(warriorType.max_count);

  const referenceTypeNames = warriorType.max_count_reference_types || [];
  if (referenceTypeNames.length > 0) {
    const referenceTypeIds = await repository.listWarriorTypeIdsByName(referenceTypeNames);
    const referenceCount = await repository.sumWarriorModels(rosterId, referenceTypeIds, exceptMemberId);
    const dependentMaximum = referenceCount * Number(warriorType.max_count_multiplier || 1);
    maximum = maximum === null ? dependentMaximum : Math.min(maximum, dependentMaximum);
  }

  if (maximum !== null && currentCount + addedGroupSize > maximum) {
    return {
      status: 409,
      body: {
        error: `The roster already has the maximum of ${maximum} ${warriorType.name}.`,
        maxCount: maximum,
        rule: warriorType.rule_text,
      },
    };
  }
  return null;
}

async function validateExclusiveHire(repository, rosterId, warriorTypeName, exceptMemberId) {
  if (warriorTypeName === "Wolf Companion") {
    const priest = await repository.findWarriorByTypeName(rosterId, "Wolf Priest of Ulric");
    if (!priest) {
      return { status: 400, body: { error: "A Wolf Companion requires a Wolf Priest of Ulric in the roster." } };
    }
  }
  const otherType = warriorTypeName === "Highwayman"
    ? "Roadwarden"
    : warriorTypeName === "Roadwarden" ? "Highwayman" : null;
  if (!otherType) return null;
  if (await repository.findWarriorByTypeName(rosterId, otherType, exceptMemberId)) {
    return { status: 400, body: { error: "A Highwayman and Roadwarden cannot serve in the same warband." } };
  }
  return null;
}

function validateNonNegativeIntegers(values, fields) {
  for (const field of fields) {
    if (values[field] === undefined) continue;
    values[field] = Number(values[field]);
    if (!Number.isSafeInteger(values[field]) || values[field] < 0) {
      return `${field} must be a non-negative integer.`;
    }
  }
  return null;
}

function validateExperience(values, role, canGainExperience = true, minimumExperience = 0) {
  if (values.experience === undefined) return null;
  values.experience = Number(values.experience);
  if (!Number.isSafeInteger(values.experience) || values.experience < 0) {
    return "experience must be a non-negative integer.";
  }
  if (values.experience < minimumExperience) {
    return `experience must not be lower than this warrior's starting experience (${minimumExperience}).`;
  }
  if (!canGainExperience && values.experience > 0) {
    return `This ${role} type cannot gain experience.`;
  }
  const maximum = role === "Henchman" ? 14 : 90;
  if (values.experience > maximum) {
    return `experience must not exceed ${maximum} for ${role}.`;
  }
  return null;
}

function normalizeStats(stats) {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
    return { error: "Stats must be an object." };
  }
  const unknownKeys = Object.keys(stats).filter((key) => !statKeys.includes(key));
  if (unknownKeys.length > 0) {
    return { error: `Unknown stat keys: ${unknownKeys.join(", ")}.` };
  }
  return { value: Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, String(value)])) };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

module.exports = {
  isNonEmptyString,
  normalizeStats,
  pickFields,
  resolveWarbandSelection,
  validateExclusiveHire,
  validateExperience,
  validateNonNegativeIntegers,
  validateWarriorTypeCount,
};
