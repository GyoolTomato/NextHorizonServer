require("dotenv").config();

const Database = require("better-sqlite3");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !databaseUrl.startsWith("file:")) {
  throw new Error("DATABASE_URL must be a file: SQLite URL");
}

const databasePath = databaseUrl.slice("file:".length);
const db = new Database(databasePath);

const userColumns = db.prepare('PRAGMA table_info("User")').all();
if (userColumns.some((column) => column.name === "localId")) {
  console.log("user ID migration already applied");
  db.close();
  process.exit(0);
}

const dependentTables = [
  {
    name: "PlayerCharacter",
    sql: `CREATE TABLE "PlayerCharacter" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" INTEGER NOT NULL,
      "characterId" TEXT NOT NULL,
      "quantity" INTEGER NOT NULL DEFAULT 1,
      "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "PlayerCharacter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "PlayerCharacter_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )`,
    unique: 'CREATE UNIQUE INDEX "PlayerCharacter_userId_characterId_key" ON "PlayerCharacter"("userId", "characterId")',
  },
  {
    name: "PlayerItem",
    sql: `CREATE TABLE "PlayerItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" INTEGER NOT NULL,
      "itemId" TEXT NOT NULL,
      "quantity" INTEGER NOT NULL DEFAULT 0,
      "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "PlayerItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "PlayerItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )`,
    unique: 'CREATE UNIQUE INDEX "PlayerItem_userId_itemId_key" ON "PlayerItem"("userId", "itemId")',
  },
  {
    name: "PlayerArmor",
    sql: `CREATE TABLE "PlayerArmor" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" INTEGER NOT NULL,
      "armorId" TEXT NOT NULL,
      "quantity" INTEGER NOT NULL DEFAULT 0,
      "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "PlayerArmor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "PlayerArmor_armorId_fkey" FOREIGN KEY ("armorId") REFERENCES "Armor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )`,
    unique: 'CREATE UNIQUE INDEX "PlayerArmor_userId_armorId_key" ON "PlayerArmor"("userId", "armorId")',
  },
  {
    name: "PlayerWeapon",
    sql: `CREATE TABLE "PlayerWeapon" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" INTEGER NOT NULL,
      "weaponId" TEXT NOT NULL,
      "quantity" INTEGER NOT NULL DEFAULT 0,
      "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "PlayerWeapon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "PlayerWeapon_weaponId_fkey" FOREIGN KEY ("weaponId") REFERENCES "Weapon" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )`,
    unique: 'CREATE UNIQUE INDEX "PlayerWeapon_userId_weaponId_key" ON "PlayerWeapon"("userId", "weaponId")',
  },
  {
    name: "GachaHistory",
    sql: `CREATE TABLE "GachaHistory" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" INTEGER NOT NULL,
      "bannerId" TEXT NOT NULL,
      "characterId" TEXT NOT NULL,
      "pullCount" INTEGER NOT NULL,
      "costType" TEXT NOT NULL,
      "costAmount" INTEGER NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "GachaHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "GachaHistory_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "GachaBanner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "GachaHistory_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )`,
  },
];

db.pragma("foreign_keys = OFF");
const migrate = db.transaction(() => {
  const legacyUsers = db.prepare('SELECT * FROM "User" ORDER BY "createdAt", "id"').all();

  db.exec('ALTER TABLE "User" RENAME TO "User_legacy"');
  for (const table of dependentTables) {
    db.exec(`ALTER TABLE "${table.name}" RENAME TO "${table.name}_legacy"`);
    if (table.unique) {
      db.exec(`DROP INDEX "${table.name}_userId_${table.name === "PlayerCharacter" ? "characterId" : table.name === "PlayerItem" ? "itemId" : table.name === "PlayerArmor" ? "armorId" : "weaponId"}_key"`);
    }
  }

  db.exec(`CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "localId" TEXT NOT NULL,
    "firebaseUid" TEXT,
    "nickname" TEXT NOT NULL DEFAULT 'NewUser',
    "level" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`);
  db.exec('CREATE UNIQUE INDEX "User_localId_key" ON "User"("localId")');
  db.exec('CREATE UNIQUE INDEX "User_firebaseUid_key" ON "User"("firebaseUid")');

  const insertUser = db.prepare(`INSERT INTO "User"
    ("localId", "firebaseUid", "nickname", "level", "createdAt", "updatedAt")
    VALUES (?, ?, ?, ?, ?, ?)`);
  const idMap = new Map();
  for (const user of legacyUsers) {
    const result = insertUser.run(
      user.guestId,
      user.guestId,
      user.nickname,
      user.level,
      user.createdAt,
      user.updatedAt,
    );
    idMap.set(user.id, Number(result.lastInsertRowid));
  }

  for (const table of dependentTables) {
    db.exec(table.sql);
    if (table.unique) db.exec(table.unique);

    const rows = db.prepare(`SELECT * FROM "${table.name}_legacy"`).all();
    for (const row of rows) {
      row.userId = idMap.get(row.userId);
      if (!row.userId) throw new Error(`Missing user mapping for ${table.name}`);
      const columns = Object.keys(row);
      const columnSql = columns.map((column) => `"${column}"`).join(", ");
      const valuesSql = columns.map(() => "?").join(", ");
      db.prepare(`INSERT INTO "${table.name}" (${columnSql}) VALUES (${valuesSql})`).run(...columns.map((column) => row[column]));
    }
  }

  for (const table of dependentTables) {
    db.exec(`DROP TABLE "${table.name}_legacy"`);
  }
  db.exec('DROP TABLE "User_legacy"');
});

try {
  migrate();
  db.pragma("foreign_keys = ON");
  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length) throw new Error(`Foreign key violations: ${JSON.stringify(violations)}`);
  console.log("migrated users to integer IDs with localId and firebaseUid");
} finally {
  db.close();
}
