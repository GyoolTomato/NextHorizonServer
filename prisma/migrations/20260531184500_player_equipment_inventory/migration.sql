CREATE TABLE "PlayerItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlayerItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PlayerArmor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "armorId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerArmor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlayerArmor_armorId_fkey" FOREIGN KEY ("armorId") REFERENCES "Armor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PlayerWeapon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "weaponId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerWeapon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlayerWeapon_weaponId_fkey" FOREIGN KEY ("weaponId") REFERENCES "Weapon" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlayerItem_userId_itemId_key" ON "PlayerItem" ("userId", "itemId");
CREATE UNIQUE INDEX "PlayerArmor_userId_armorId_key" ON "PlayerArmor" ("userId", "armorId");
CREATE UNIQUE INDEX "PlayerWeapon_userId_weaponId_key" ON "PlayerWeapon" ("userId", "weaponId");
