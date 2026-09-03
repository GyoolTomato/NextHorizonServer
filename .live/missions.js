const { gamePeriod } = require("./game-time");
const PLAYER_EXP = 1010003;
const INT_MAX = 2147483647;

function requestError(message, status = 400) {
  return Object.assign(new Error(message), { missionStatus: status });
}

function integer(value, name, minimum = 0) {
  const n = Number(value);
  if (value == null || !Number.isSafeInteger(n) || n < minimum) {
    throw new Error(`invalid mission table ${name}`);
  }
  return n;
}

async function definitions(tx) {
  const rows = await tx.$queryRawUnsafe('SELECT * FROM "_104_Missions" ORDER BY "key"');
  const columns = await tx.$queryRawUnsafe('PRAGMA table_info("_104_Missions")');
  function arrayColumns(prefix) {
    const names = columns.map(c => String(c.name)).filter(n => n.startsWith(prefix + "_"));
    names.sort((a, b) => Number(a.slice(prefix.length + 1)) - Number(b.slice(prefix.length + 1)));
    if (names.some((n, i) => n !== `${prefix}_${i}`)) throw new Error(`invalid ${prefix} array columns`);
    return names;
  }
  const keys = arrayColumns("rewardKeys");
  const counts = arrayColumns("rewardCounts");
  if (keys.length !== counts.length) throw new Error("mission reward array length mismatch");
  const items = await tx.$queryRawUnsafe('SELECT "key" FROM "_101_Items"');
  const itemKeys = new Set(items.map(i => Number(i.key)));
  return rows.map(row => {
    const key = integer(row.key, "key", 1);
    const count = integer(row.count, `${key}.count`, 1);
    if (count > INT_MAX) throw new Error(`mission ${key} count exceeds progress capacity`);
    if (!["Daily", "Weekly"].includes(row.cycleType)) throw new Error(`unknown mission cycle: ${row.cycleType}`);
    const rewardKeys = keys.map(k => integer(row[k], `${key}.${k}`));
    const rewardCounts = counts.map(k => integer(row[k], `${key}.${k}`));
    rewardKeys.forEach((rewardKey, i) => {
      if (rewardKey === 0 || rewardCounts[i] === 0) return;
      if (!itemKeys.has(rewardKey)) throw new Error(`mission ${key}: unknown reward item ${rewardKey}`);
    });
    return { key, title: Number(row.title), type: String(row.type), cycleType: row.cycleType,
      count, exp: integer(row.exp, `${key}.exp`), rewardKeys, rewardCounts };
  });
}

async function sync(tx, userId, defs, now) {
  for (const mission of defs) {
    const { cycleStartedAt } = gamePeriod(mission.cycleType, now);
    const where = { userId_missionKey: { userId, missionKey: mission.key } };
    const state = await tx.playerMission.findUnique({ where });
    if (!state) {
      await tx.playerMission.create({ data: { userId, missionKey: mission.key, cycleStartedAt } });
    } else if (state.cycleStartedAt.getTime() !== cycleStartedAt.getTime()) {
      await tx.playerMission.update({ where, data: { progress: 0, isClaimed: false, cycleStartedAt } });
    }
  }
}

async function advance(tx, userId, type, amount, now = new Date()) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("invalid mission progress amount");
  const defs = await definitions(tx);
  await sync(tx, userId, defs, now);
  for (const mission of defs.filter(m => m.type === type)) {
    const where = { userId_missionKey: { userId, missionKey: mission.key } };
    const state = await tx.playerMission.findUnique({ where });
    const progress = state.progress + amount;
    if (!Number.isSafeInteger(progress) || progress > INT_MAX) throw new Error("mission progress overflow");
    await tx.playerMission.update({ where, data: { progress } });
  }
}

async function recordLogin(tx, userId, now = new Date()) {
  const day = gamePeriod("Daily", now).cycleStartedAt.toISOString();
  const rows = await tx.$queryRawUnsafe('SELECT "day" FROM "PlayerMissionLogin" WHERE "userId" = ?', userId);
  if (rows.length && rows[0].day === day) return;
  await advance(tx, userId, "LogIn", 1, now);
  await tx.$executeRawUnsafe(
    'INSERT INTO "PlayerMissionLogin" ("userId", "day") VALUES (?, ?) ' +
    'ON CONFLICT("userId") DO UPDATE SET "day" = excluded."day"', userId, day);
}

async function recordItemAcquired(tx, userId, itemKey, quantity, now = new Date()) {
  const rows = await tx.$queryRawUnsafe('SELECT "type" FROM "_101_Items" WHERE "key" = ?', itemKey);
  if (rows[0]?.type === "ExpCard" && quantity > 0) await advance(tx, userId, "GetIt_ExpCard", quantity, now);
}

async function loadMissionDetails(tx, userId, now = new Date()) {
  if (!await tx.user.findUnique({ where: { id: userId }, select: { id: true } })) throw requestError("user not found", 404);
  const defs = await definitions(tx);
  await sync(tx, userId, defs, now);
  const states = await tx.playerMission.findMany({ where: { userId } });
  const byKey = new Map(states.map(s => [s.missionKey, s]));
  return { missions: defs.map(m => {
    const s = byKey.get(m.key);
    return { ...m, missionKey: m.key, progress: s.progress, isCompleted: s.progress >= m.count,
      isClaimed: s.isClaimed, ...gamePeriod(m.cycleType, now) };
  }) };
}

async function list(tx, userId, now = new Date()) {
  const current = await loadMissionDetails(tx, userId, now);
  return { missions: current.missions.map(({ missionKey, progress, isClaimed }) =>
    ({ missionKey, progress, isClaimed })) };
}

async function claim(tx, userId, missionKey, grantExperience, now = new Date()) {
  const current = await loadMissionDetails(tx, userId, now);
  const mission = current.missions.find(m => m.missionKey === missionKey);
  if (!mission) throw requestError("mission not found", 404);
  if (mission.isClaimed) throw requestError("mission reward already claimed", 409);
  if (!mission.isCompleted) throw requestError("mission objective not reached");
  const locked = await tx.playerMission.updateMany({
    where: { userId, missionKey, isClaimed: false, cycleStartedAt: mission.cycleStartedAt },
    data: { isClaimed: true },
  });
  if (locked.count !== 1) throw requestError("mission reward already claimed", 409);
  let experience = mission.exp;
  const rewards = [];
  const itemsByKey = new Map();
  for (let i = 0; i < mission.rewardKeys.length; i++) {
    const itemKey = mission.rewardKeys[i], quantity = mission.rewardCounts[i];
    if (!itemKey || !quantity) continue;
    rewards.push({ itemKey, quantity });
    if (itemKey === PLAYER_EXP) {
      experience += quantity;
      if (!Number.isSafeInteger(experience)) throw new Error("mission experience overflow");
      continue;
    }
    const where = { userId_itemKey: { userId, itemKey } };
    const old = await tx.playerItem.findUnique({ where });
    if (quantity > INT_MAX || (old?.quantity || 0) > INT_MAX - quantity) throw new Error("mission item quantity overflow");
    const item = await tx.playerItem.upsert({ where, create: { userId, itemKey, quantity },
      update: { quantity: { increment: quantity } }, select: { userId: true, itemKey: true, quantity: true } });
    itemsByKey.set(itemKey, item);
    await recordItemAcquired(tx, userId, itemKey, quantity, now);
  }
  const playerExperience = await grantExperience(tx, userId, experience);
  await advance(tx, userId, "WorkCount", 1, now);
  return { success: true, missionKey, exp: mission.exp, rewards, items: [...itemsByKey.values()], playerExperience,
    ...(await list(tx, userId, now)) };
}

async function initialize(prisma) {
  await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "PlayerMissionLogin" (' +
    '"userId" INTEGER NOT NULL PRIMARY KEY, "day" TEXT NOT NULL, ' +
    'FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE)');
}

// Kill is deliberately not exposed as a client-controlled endpoint. Future combat
// results should call advance(tx, userId, "Kill", verifiedKills) within their transaction.
module.exports = { initialize, recordLogin, recordItemAcquired, list, claim, advance };
