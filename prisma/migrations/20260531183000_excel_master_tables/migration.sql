-- Create master data tables imported from the _1*.xlsx sheets.
CREATE TABLE "Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "nameKey" INTEGER NOT NULL,
    "icon" TEXT NOT NULL
);

CREATE TABLE "Armor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tier" INTEGER NOT NULL,
    "nameKey" INTEGER NOT NULL,
    "icon" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL
);

CREATE TABLE "Weapon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tier" INTEGER NOT NULL,
    "nameKey" INTEGER NOT NULL,
    "icon" TEXT NOT NULL,
    "value" INTEGER NOT NULL
);

CREATE TABLE "Mission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "titleKey" INTEGER NOT NULL,
    "reward0" TEXT,
    "reward1" TEXT,
    "reward2" TEXT
);

ALTER TABLE "Character" ADD COLUMN "nameKey" INTEGER;
ALTER TABLE "Character" ADD COLUMN "model" TEXT;
ALTER TABLE "Character" ADD COLUMN "hp" INTEGER;
ALTER TABLE "Character" ADD COLUMN "hpLevel" INTEGER;
ALTER TABLE "Character" ADD COLUMN "atk" INTEGER;
ALTER TABLE "Character" ADD COLUMN "atkLevel" INTEGER;
ALTER TABLE "Character" ADD COLUMN "def" INTEGER;
ALTER TABLE "Character" ADD COLUMN "defLevel" INTEGER;
ALTER TABLE "Character" ADD COLUMN "avoid" REAL;
ALTER TABLE "Character" ADD COLUMN "avoidLevel" REAL;
ALTER TABLE "Character" ADD COLUMN "focus" REAL;
ALTER TABLE "Character" ADD COLUMN "focusLevel" REAL;
ALTER TABLE "Character" ADD COLUMN "atkspd" INTEGER;
ALTER TABLE "Character" ADD COLUMN "atkspdLevel" INTEGER;
ALTER TABLE "Character" ADD COLUMN "crirate" REAL;
ALTER TABLE "Character" ADD COLUMN "crirateLevel" REAL;
ALTER TABLE "Character" ADD COLUMN "cridmg" REAL;
ALTER TABLE "Character" ADD COLUMN "cridmgLevel" REAL;
ALTER TABLE "Character" ADD COLUMN "speed" REAL;
ALTER TABLE "Character" ADD COLUMN "activeSkill" INTEGER;
ALTER TABLE "Character" ADD COLUMN "passiveSkill0" INTEGER;
ALTER TABLE "Character" ADD COLUMN "passiveSkill1" INTEGER;

DROP TABLE "Currency";
