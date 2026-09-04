const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const Database = require("better-sqlite3");
const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
const missions = require("./missions");
const { gamePeriod } = require("./game-time");

async function main() {
  assert.equal(gamePeriod("Daily", new Date("2026-09-06T18:59:59Z")).cycleStartedAt.toISOString(), "2026-09-05T19:00:00.000Z");
  assert.equal(gamePeriod("Daily", new Date("2026-09-06T19:00:00Z")).cycleStartedAt.toISOString(), "2026-09-06T19:00:00.000Z");
  assert.equal(gamePeriod("Weekly", new Date("2026-09-06T18:59:59Z")).cycleStartedAt.toISOString(), "2026-08-30T19:00:00.000Z");
  assert.equal(gamePeriod("Weekly", new Date("2026-09-06T19:00:00Z")).cycleStartedAt.toISOString(), "2026-09-06T19:00:00.000Z");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nh-mission-test-"));
  const dbPath = path.join(dir, "dev.db");
  fs.copyFileSync(path.join(__dirname, "dev.db"), dbPath);
  const db = new Database(dbPath);
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    cwd: dir, env: { ...process.env, DATABASE_URL: `file:${dbPath}`, PORT: "3198" }, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", b => { output += b; });
  child.stderr.on("data", b => { output += b; });
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }) });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(output);
      if (output.includes('"event":"server_started"')) { ready = true; break; }
      await new Promise(r => setTimeout(r, 100));
    }
    assert(ready, output);
    async function post(route, body, expected = 200) {
      const res = await fetch(`http://127.0.0.1:3198${route}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();
      assert.equal(res.status, expected, JSON.stringify(json));
      return json;
    }
    const localId = `mission-test-${Date.now()}`;
    const user = await post("/api/user", { localId, nickname: "MissionTest" }, 201);
    const userId = user.id;
    const levelUp = await post("/api/character/level-up", {
      userId, characterKey: user.characters[0].characterKey, eItemTypes: [4], counts: [1],
    });
    assert.equal(levelUp.characterKey, user.characters[0].characterKey);
    const get = async () => (await post("/api/mission/list", { userId })).missions;
    let list = await get();
    for (const mission of list) {
      assert.deepEqual(Object.keys(mission).sort(), ["isClaimed", "missionKey", "progress"]);
    }
    assert.equal(list.find(m => m.missionKey === 1040001).progress, 1);
    assert.equal(list.find(m => m.missionKey === 1040002).progress, 1);
    assert.equal(list.find(m => m.missionKey === 1040005).progress, 100);
    assert.deepEqual(user.missions, list);
    const login = await post("/api/user/login", { localId });
    assert.deepEqual(login.user.missions, list);
    await post("/api/user/login", { localId });
    assert.equal((await get()).find(m => m.missionKey === 1040002).progress, 1);
    const claimed = await post("/api/mission/claim", { userId, missionKey: 1040001 });
    for (const mission of claimed.missions) {
      assert.deepEqual(Object.keys(mission).sort(), ["isClaimed", "missionKey", "progress"]);
    }
    assert.equal(claimed.playerExperience.grantedExp, 100);
    assert(!("progressExp" in claimed.playerExperience));
    assert(!("lifetimeExp" in claimed.playerExperience));
    assert.equal(claimed.missions.find(m => m.missionKey === 1040006).progress, 1);
    await post("/api/mission/claim", { userId, missionKey: 1040001 }, 409);
    await post("/api/mission/claim", { userId, missionKey: 1040003 }, 400);
    await post("/api/mission/claim", { userId, missionKey: 1040005 });
    assert.equal((await get()).find(m => m.missionKey === 1040006).progress, 2);

    // Deterministic reset and daily login deduplication, including weekly rollover.
    const clockUser = await prisma.user.create({ data: { localId: localId + "-clock" } });
    const sunday = new Date("2026-09-06T10:00:00Z"), monday = new Date("2026-09-06T19:00:00Z");
    await prisma.$transaction(tx => missions.recordLogin(tx, clockUser.id, sunday));
    await prisma.$transaction(tx => missions.recordLogin(tx, clockUser.id, sunday));
    let timed = await prisma.$transaction(tx => missions.list(tx, clockUser.id, sunday));
    assert.equal(timed.missions.find(m => m.missionKey === 1040002).progress, 1);
    await prisma.$transaction(tx => missions.recordLogin(tx, clockUser.id, monday));
    timed = await prisma.$transaction(tx => missions.list(tx, clockUser.id, monday));
    assert.equal(timed.missions.find(m => m.missionKey === 1040002).progress, 1);
    await prisma.$transaction(tx => missions.recordLogin(tx, clockUser.id, new Date("2026-09-07T19:00:00Z")));
    timed = await prisma.$transaction(tx => missions.list(tx, clockUser.id, new Date("2026-09-07T19:00:00Z")));
    assert.equal(timed.missions.find(m => m.missionKey === 1040002).progress, 2);
    await prisma.$transaction(tx => missions.recordItemAcquired(tx, clockUser.id, 1010004, 3, monday));
    timed = await prisma.$transaction(tx => missions.list(tx, clockUser.id, monday));
    assert.equal(timed.missions.find(m => m.missionKey === 1040005).progress, 3);

    // Duplicate rewards remain separate; PlayerExp bypasses inventory.
    db.prepare('UPDATE "_104_Missions" SET rewardKeys_0=1010001, rewardCounts_0=100, rewardKeys_1=1010001, rewardCounts_1=100, rewardKeys_2=1010003, rewardCounts_2=50 WHERE key=1040003').run();
    await prisma.$transaction(tx => missions.advance(tx, userId, "Kill", 10000));
    const beforeGold = await prisma.playerItem.findUnique({ where: { userId_itemKey: { userId, itemKey: 1010001 } } });
    const duplicate = await post("/api/mission/claim", { userId, missionKey: 1040003 });
    assert.equal(duplicate.rewards.filter(r => r.itemKey === 1010001).length, 2);
    assert.equal(duplicate.items.find(i => i.itemKey === 1010001).quantity, beforeGold.quantity + 200);
    assert.equal(duplicate.playerExperience.grantedExp, duplicate.exp + 50);
    assert.equal(await prisma.playerItem.count({ where: { userId, itemKey: 1010003 } }), 0);

    // A late grant failure must roll back the claim and all earlier grants.
    await prisma.$transaction(tx => missions.advance(tx, clockUser.id, "Kill", 10000, monday));
    await assert.rejects(prisma.$transaction(tx => missions.claim(tx, clockUser.id, 1040003,
      async () => { throw new Error("simulated grant failure"); }, monday)), /simulated grant failure/);
    const rolledBack = await prisma.$transaction(tx => missions.list(tx, clockUser.id, monday));
    assert.equal(rolledBack.missions.find(m => m.missionKey === 1040003).isClaimed, false);
    assert.equal(await prisma.playerItem.count({ where: { userId: clockUser.id } }), 0);

    // Invalid reward causes no grants/claim; mismatched arrays are table errors.
    db.prepare('UPDATE "_104_Missions" SET rewardKeys_0=9991234 WHERE key=1040002').run();
    await post("/api/mission/list", { userId }, 500);
    db.prepare('UPDATE "_104_Missions" SET rewardKeys_0=1010001 WHERE key=1040002').run();
    db.exec('ALTER TABLE "_104_Missions" ADD COLUMN rewardKeys_3 INTEGER DEFAULT 0');
    await post("/api/mission/list", { userId }, 500);
    console.log("PASS: time boundaries, API list/claim, login once/day, rewards, WorkCount, resets, invalid tables");
  } finally {
    await prisma.$disconnect();
    const exited = new Promise(resolve => child.once("exit", resolve));
    if (child.exitCode === null) { child.kill(); await exited; }
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
