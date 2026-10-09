const { randomInt } = require("crypto");

const EQUIPMENT_SUB_STATS = Object.freeze([
  "Avoid",
  "Focus",
  "AtkSpd",
  "Speed",
  "Crirate",
  "Cridmg",
]);

function randomSubStat() {
  return EQUIPMENT_SUB_STATS[randomInt(EQUIPMENT_SUB_STATS.length)];
}

function validateGrantParams({ userId, equipmentKey, level, exp, equipCharacter }) {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("userId must be a positive safe integer");
  }
  if (!Number.isSafeInteger(equipmentKey) || equipmentKey <= 0) {
    throw new Error("equipment key must be a positive safe integer");
  }
  if (!Number.isSafeInteger(level) || level <= 0) {
    throw new Error("level must be a positive safe integer");
  }
  if (!Number.isSafeInteger(exp) || exp < 0) {
    throw new Error("exp must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(equipCharacter) || equipCharacter < 0) {
    throw new Error("equipCharacter must be a non-negative safe integer");
  }
}

async function validateReferences(db, userId, tableName, equipmentKey) {
  const [user, equipmentRows] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { id: true } }),
    db.$queryRawUnsafe(`SELECT "key" FROM "${tableName}" WHERE "key" = ? LIMIT 1`, equipmentKey),
  ]);
  if (!user) throw new Error(`user not found: ${userId}`);
  if (equipmentRows.length === 0) throw new Error(`equipment key not found: ${equipmentKey}`);
}

async function addPlayerArmor(db, { userId, armorKey, level, exp, equipCharacter = 0 }) {
  validateGrantParams({ userId, equipmentKey: armorKey, level, exp, equipCharacter });
  await validateReferences(db, userId, "_105_Armors", armorKey);

  return db.playerArmor.create({
    data: {
      userId,
      armorKey,
      level,
      exp,
      equipedCharacter: equipCharacter,
      subStat0: randomSubStat(),
      subStat1: randomSubStat(),
    },
  });
}

async function addPlayerWeapon(db, { userId, weaponKey, level, exp, equipCharacter = 0 }) {
  validateGrantParams({ userId, equipmentKey: weaponKey, level, exp, equipCharacter });
  await validateReferences(db, userId, "_106_Weapons", weaponKey);

  return db.playerWeapon.create({
    data: {
      userId,
      weaponKey,
      level,
      exp,
      equipedCharacter: equipCharacter,
      subStat0: randomSubStat(),
      subStat1: randomSubStat(),
    },
  });
}

async function grantInitialEquipment(db, userId) {
  const armors = [];
  for (let armorKey = 1050001; armorKey <= 1050004; armorKey += 1) {
    armors.push(await addPlayerArmor(db, {
      userId, armorKey, level: 1, exp: 0,
    }));
  }

  const weapons = [];
  for (let weaponKey = 1060001; weaponKey <= 1060002; weaponKey += 1) {
    weapons.push(await addPlayerWeapon(db, {
      userId, weaponKey, level: 1, exp: 0,
    }));
  }
  return { armors, weapons };
}

module.exports = {
  EQUIPMENT_SUB_STATS,
  addPlayerArmor,
  addPlayerWeapon,
  grantInitialEquipment,
};
