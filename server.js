require("dotenv").config();

const express = require("express");
const { randomUUID } = require("crypto");
const { appendFileSync, mkdirSync } = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing. Copy .env.example to .env first.");
}

const port = Number(process.env.PORT || 3099);
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });
const app = express();
const logDirectory = path.join(__dirname, ".logs");

mkdirSync(logDirectory, { recursive: true });

app.set("trust proxy", "loopback");

function writeLog(level, event, fields = {}) {
  const koreaTime = new Date(Date.now() + (9 * 60 * 60 * 1000))
    .toISOString()
    .replace("Z", "+09:00");
  const entry = {
    timestamp: koreaTime,
    level,
    event,
    ...fields,
  };
  const message = JSON.stringify(entry, (_, value) =>
    typeof value === "bigint" ? value.toString() : value);

  const logFile = path.join(logDirectory, `${koreaTime.slice(0, 10)}-server.txt`);
  try {
    appendFileSync(logFile, `${message}\n`, "utf8");
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: koreaTime,
      level: "error",
      event: "log_file_write_failed",
      errorMessage: error?.message || String(error),
    }));
  }

  if (level === "error") return console.error(message);
  if (level === "warn") return console.warn(message);
  return console.log(message);
}

function audit(req, action, fields = {}) {
  writeLog("info", "audit", {
    requestId: req.requestId,
    action,
    ...fields,
  });
}

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  let requestLogged = false;
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);

  const logRequest = (aborted = false) => {
    if (requestLogged) return;
    requestLogged = true;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const bodyUserId = Number(req.body?.userId);
    const level = aborted || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    writeLog(level, "http_request", {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      ip: req.ip,
      ...(aborted ? { aborted: true } : {}),
      ...(Number.isInteger(bodyUserId) && bodyUserId > 0 ? { userId: bodyUserId } : {}),
    });
  };

  res.on("finish", () => logRequest(false));
  res.on("close", () => logRequest(!res.writableFinished));

  next();
});

app.use(express.json());

const PLAYER_EXP_ITEM_KEY = 1010003;

function toPlayerExperienceDto(user) {
  return {
    level: user.level,
    exp: Number(user.exp),
  };
}

function toUserDto(user) {
  return {
    id: user.id,
    localId: user.localId,
    firebaseUid: user.firebaseUid,
    nickname: user.nickname,
    ...toPlayerExperienceDto(user),
    items: user.items || [],
    characters: user.characters || [],
    armors: user.armors || [],
    weapons: user.weapons || [],
  };
}

async function grantPlayerExperience(tx, userId, amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("player experience must be a non-negative safe integer");
  }

  const [user, levelRows] = await Promise.all([
    tx.user.findUnique({ where: { id: userId } }),
    tx.$queryRawUnsafe(
      'SELECT "level", "expToNextLevel" FROM "_108_PlayerLevel" ORDER BY "level" ASC'
    ),
  ]);
  if (!user) return null;
  if (levelRows.length === 0) throw new Error("_108_PlayerLevel contains no levels");

  const levels = levelRows.map((row) => ({
    level: Number(row.level),
    expToNextLevel: Number(row.expToNextLevel),
  }));
  const levelMap = new Map(levels.map((row) => [row.level, row]));
  const maxLevel = levels[levels.length - 1].level;
  if (!Number.isSafeInteger(maxLevel) || maxLevel <= 0) {
    throw new Error("invalid max player level in _108_PlayerLevel");
  }
  if (!levelMap.has(user.level)) {
    throw new Error(`player level ${user.level} is missing from _108_PlayerLevel`);
  }

  let level = user.level;
  let exp = BigInt(user.exp);
  let remaining = BigInt(amount);
  let applied = 0n;

  while (remaining > 0n && level < maxLevel) {
    const requiredValue = levelMap.get(level)?.expToNextLevel;
    if (!Number.isSafeInteger(requiredValue) || requiredValue <= 0) {
      throw new Error(`invalid player exp requirement for level ${level}`);
    }
    const required = BigInt(requiredValue);
    if (exp < 0n || exp >= required) {
      throw new Error(`invalid current player exp for level ${level}`);
    }

    const needed = required - exp;
    const consumed = remaining < needed ? remaining : needed;
    exp += consumed;
    remaining -= consumed;
    applied += consumed;
    if (exp >= required) {
      level += 1;
      exp = 0n;
    }
  }

  if (level >= maxLevel) exp = 0n;
  const updated = await tx.user.update({
    where: { id: userId },
    data: {
      level,
      exp,
      progressExp: BigInt(user.progressExp) + applied,
      lifetimeExp: BigInt(user.lifetimeExp) + BigInt(amount),
    },
  });
  return {
    ...toPlayerExperienceDto(updated),
    grantedExp: amount,
    appliedExp: Number(applied),
  };
}

async function getPlayerData(userId) {
  const [items, characters, armors, weapons] = await Promise.all([
    prisma.playerItem.findMany({
      where: { userId },
      select: { userId: true, itemKey: true, quantity: true },
      orderBy: { itemKey: "asc" },
    }),
    prisma.playerCharacter.findMany({
      where: { userId },
      select: {
        userId: true, characterKey: true, stack: true, exp: true, level: true,
        grade: true, activeLv: true, charm: true, passiveLv0: true, passiveLv1: true, passiveLv2: true,
      },
      orderBy: { characterKey: "asc" },
    }),
    prisma.playerArmor.findMany({
      where: { userId },
      select: { id: true, userId: true, armorKey: true, level: true, exp: true, equipedCharacter: true },
      orderBy: { armorKey: "asc" },
    }),
    prisma.playerWeapon.findMany({
      where: { userId },
      select: { id: true, userId: true, weaponKey: true, level: true, exp: true, equipedCharacter: true },
      orderBy: { weaponKey: "asc" },
    }),
  ]);
  return {
    items,
    characters: characters.map((character) => ({
      ...character,
      exp: Number(character.exp),
    })),
    armors,
    weapons,
  };
}

function parseUserRequest(req) {
  return {
    localId: String(req.body?.localId || "").trim(),
    firebaseUid: String(req.body?.firebaseUid || "").trim() || null,
  };
}

function validateNickname(value) {
  const nickname = String(value || "").trim();
  if (nickname.length < 2 || nickname.length > 16) {
    return { error: "nickname must be between 2 and 16 characters" };
  }
  return { nickname };
}

function parseItemRequest(req) {
  return {
    userId: Number(req.body?.userId),
    itemKey: Number(req.body?.itemKey),
    quantity: Number(req.body?.quantity),
  };
}

function validateItemRequest(request, allowNegativeQuantity = false) {
  if (!Number.isInteger(request.userId) || request.userId <= 0) {
    return "valid userId required";
  }
  if (!Number.isInteger(request.itemKey) || request.itemKey <= 0) return "valid itemKey required";
  if (!Number.isInteger(request.quantity) ||
      (!allowNegativeQuantity && request.quantity < 0)) {
    return allowNegativeQuantity
      ? "quantity must be an integer"
      : "quantity must be a non-negative integer";
  }
  return null;
}

function parseCharacterRequest(req) {
  return {
    userId: Number(req.body?.userId),
    characterKey: Number(req.body?.characterKey),
    stack: Number(req.body?.stack),
  };
}

function validateCharacterRequest(request, allowNegativeStack = false) {
  if (!Number.isInteger(request.userId) || request.userId <= 0) {
    return "valid userId required";
  }
  if (!Number.isInteger(request.characterKey) || request.characterKey <= 0) return "valid characterKey required";
  if (!Number.isInteger(request.stack) ||
      (!allowNegativeStack && request.stack < 0)) {
    return allowNegativeStack
      ? "stack must be an integer"
      : "stack must be a non-negative integer";
  }
  return null;
}

app.get("/health", async (req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// New API: checks whether a local account exists without creating NewUser.
app.post("/api/user/login", async (req, res, next) => {
  try {
    const { localId, firebaseUid } = parseUserRequest(req);
    if (!localId) {
      return res.status(400).json({ error: "localId required" });
    }

    const user = await prisma.$transaction(async (tx) => {
      const localUser = await tx.user.findUnique({ where: { localId } });
      if (localUser) {
        return firebaseUid
          ? tx.user.update({ where: { id: localUser.id }, data: { firebaseUid } })
          : localUser;
      }

      if (!firebaseUid) return null;

      const firebaseUser = await tx.user.findUnique({ where: { firebaseUid } });
      return firebaseUser
        ? tx.user.update({ where: { id: firebaseUser.id }, data: { localId } })
        : null;
    });

    if (!user) {
      audit(req, "LOGIN_NEW_USER_REQUIRED");
      return res.json({ isNew: true, user: null });
    }

    const playerData = await getPlayerData(user.id);
    audit(req, "LOGIN_SUCCEEDED", { userId: user.id });
    return res.json({
      isNew: false,
      user: toUserDto({ ...user, ...playerData }),
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/user", async (req, res, next) => {
  try {
    const { localId, firebaseUid } = parseUserRequest(req);
    if (!localId) {
      return res.status(400).json({ error: "localId required" });
    }

    const nicknameResult = validateNickname(req.body?.nickname);
    if (nicknameResult.error) {
      return res.status(400).json({ error: nicknameResult.error });
    }

    const existingUser = await prisma.user.findUnique({ where: { localId } });
    if (existingUser) {
      return res.status(409).json({ error: "localId already exists" });
    }

    const user = await prisma.$transaction(async (tx) => {
      const itemRows = await tx.$queryRawUnsafe(
        'SELECT "key" FROM "_101_Items" ORDER BY "key" ASC'
      );
      const itemKeys = itemRows
        .map((item) => Number(item.key))
        .filter((itemKey) => itemKey !== PLAYER_EXP_ITEM_KEY);
      if (itemKeys.length === 0 || itemKeys.some((itemKey) => !Number.isSafeInteger(itemKey))) {
        throw new Error("_101_Items contains no valid item keys");
      }

      const createdUser = await tx.user.create({
        data: {
          localId,
          firebaseUid,
          nickname: nicknameResult.nickname,
          characters: {
            create: [
              { characterKey: 1020001, stack: 1 },
              { characterKey: 1020002, stack: 1 },
              { characterKey: 1020003, stack: 1 },
            ],
          },
          items: {
            create: itemKeys.map((itemKey) => ({ itemKey, quantity: 100 })),
          },
        },
        include: { characters: true, items: true },
      });
      await grantPlayerExperience(tx, createdUser.id, 100);
      return tx.user.findUnique({
        where: { id: createdUser.id },
        include: { characters: true, items: true },
      });
    });
    const playerData = await getPlayerData(user.id);
    audit(req, "USER_CREATED", { userId: user.id, initialItemCount: user.items.length });
    return res.status(201).json(toUserDto({ ...user, ...playerData }));
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/user/nickname", async (req, res, next) => {
  try {
    const localId = String(req.body?.localId || "").trim();
    if (!localId) {
      return res.status(400).json({ error: "localId required" });
    }

    const nicknameResult = validateNickname(req.body?.nickname);
    if (nicknameResult.error) {
      return res.status(400).json({ error: nicknameResult.error });
    }

    const existingUser = await prisma.user.findUnique({ where: { localId } });
    if (!existingUser) {
      return res.status(404).json({ error: "user not found" });
    }

    const user = await prisma.user.update({
      where: { id: existingUser.id },
      data: { nickname: nicknameResult.nickname },
    });
    audit(req, "NICKNAME_CHANGED", { userId: user.id });
    return res.json(toUserDto(user));
  } catch (error) {
    return next(error);
  }
});

app.post("/api/item/acquire", async (req, res, next) => {
  try {
    const request = parseItemRequest(req);
    const validationError = validateItemRequest(request);
    if (validationError) return res.status(400).json({ error: validationError });

    const result = await prisma.$transaction(async (tx) => {
      if (request.itemKey === PLAYER_EXP_ITEM_KEY) {
        const playerExperience = await grantPlayerExperience(
          tx,
          request.userId,
          request.quantity
        );
        return playerExperience
          ? { type: "playerExp", playerExperience }
          : { error: "user not found", status: 404 };
      }

      const user = await tx.user.findUnique({ where: { id: request.userId } });
      if (!user) return { error: "user not found", status: 404 };
      const item = await tx.playerItem.findUnique({
        where: { userId_itemKey: { userId: request.userId, itemKey: request.itemKey } },
      });

      if (item) {
        await tx.playerItem.update({
          where: { id: item.id },
          data: { quantity: { increment: request.quantity } },
        });
      } else {
        await tx.playerItem.create({
          data: {
            userId: request.userId,
            itemKey: request.itemKey,
            quantity: request.quantity,
          },
        });
      }
      return { type: "item" };
    });

    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    if (result.type === "playerExp") {
      audit(req, "PLAYER_EXP_ACQUIRED", {
        ...request,
        playerLevel: result.playerExperience.level,
        playerExp: result.playerExperience.exp,
        grantedExp: result.playerExperience.grantedExp,
        appliedExp: result.playerExperience.appliedExp,
      });
      return res.json({ success: true, playerExperience: result.playerExperience });
    }
    audit(req, "ITEM_ACQUIRED", request);
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/item/list", async (req, res, next) => {
  try {
    const userId = Number(req.body?.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "valid userId required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "user not found" });

    const items = await prisma.playerItem.findMany({
      where: { userId },
      select: { userId: true, itemKey: true, quantity: true },
      orderBy: { itemKey: "asc" },
    });
    return res.json(items);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/armor/list", async (req, res, next) => {
  try {
    const userId = Number(req.body?.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "valid userId required" });
    }
    if (!await prisma.user.findUnique({ where: { id: userId } })) {
      return res.status(404).json({ error: "user not found" });
    }
    const armors = await prisma.playerArmor.findMany({
      where: { userId },
      select: { id: true, userId: true, armorKey: true, level: true, exp: true, equipedCharacter: true },
      orderBy: { id: "asc" },
    });
    return res.json(armors);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/armor/equip", async (req, res, next) => {
  try {
    const userId = Number(req.body?.userId);
    const characterKey = Number(req.body?.characterKey);
    const playerArmorId = Number(req.body?.id);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "valid userId required" });
    if (!Number.isInteger(characterKey) || characterKey <= 0) return res.status(400).json({ error: "valid characterKey required" });
    if (!Number.isInteger(playerArmorId) || playerArmorId <= 0) return res.status(400).json({ error: "valid armor id required" });

    const result = await prisma.$transaction(async (tx) => {
      const character = await tx.playerCharacter.findUnique({
        where: { userId_characterKey: { userId, characterKey } },
      });
      if (!character) return { error: "character not found" };

      const playerArmor = await tx.playerArmor.findFirst({
        where: { id: playerArmorId, userId },
      });
      if (!playerArmor) return { error: "armor not found" };

      const armorData = await tx.armor.findUnique({ where: { key: playerArmor.armorKey } });
      if (!armorData) return { error: "armor data not found" };

      const ownedArmors = await tx.playerArmor.findMany({ where: { userId } });
      const sameTypeIds = [];
      for (const ownedArmor of ownedArmors) {
        const ownedArmorData = await tx.armor.findUnique({ where: { key: ownedArmor.armorKey } });
        if (ownedArmorData?.type === armorData.type) sameTypeIds.push(ownedArmor.id);
      }
      await tx.playerArmor.updateMany({
        where: { id: { in: sameTypeIds } },
        data: { equipedCharacter: 0 },
      });

      const equipped = await tx.playerArmor.update({
        where: { id: playerArmorId },
        data: { equipedCharacter: characterKey },
        select: { id: true, userId: true, armorKey: true, level: true, exp: true, equipedCharacter: true },
      });
      return { value: equipped };
    });

    if (result.error) return res.status(400).json({ error: result.error });
    audit(req, "ARMOR_EQUIPPED", { userId, playerArmorId, characterKey, armorKey: result.value.armorKey });
    return res.json(result.value);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/armor/release", async (req, res, next) => {
  try {
    const userId = Number(req.body?.userId);
    const playerArmorId = Number(req.body?.id);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "valid userId required" });
    if (!Number.isInteger(playerArmorId) || playerArmorId <= 0) return res.status(400).json({ error: "valid armor id required" });
    const armor = await prisma.playerArmor.findFirst({ where: { id: playerArmorId, userId } });
    if (!armor) return res.status(400).json({ error: "armor not found" });
    const released = await prisma.playerArmor.update({
      where: { id: playerArmorId }, data: { equipedCharacter: 0 },
      select: { id: true, userId: true, armorKey: true, level: true, exp: true, equipedCharacter: true },
    });
    audit(req, "ARMOR_RELEASED", { userId, playerArmorId, armorKey: released.armorKey });
    return res.json(released);
  } catch (error) { return next(error); }
});

app.post("/api/weapon/list", async (req, res, next) => {
  try {
    const userId = Number(req.body?.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "valid userId required" });
    }
    if (!await prisma.user.findUnique({ where: { id: userId } })) {
      return res.status(404).json({ error: "user not found" });
    }
    const weapons = await prisma.playerWeapon.findMany({
      where: { userId },
      select: { id: true, userId: true, weaponKey: true, level: true, exp: true, equipedCharacter: true },
      orderBy: { id: "asc" },
    });
    return res.json(weapons);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/weapon/equip", async (req, res, next) => {
  try {
    const userId = Number(req.body?.userId);
    const characterKey = Number(req.body?.characterKey);
    const playerWeaponId = Number(req.body?.id);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "valid userId required" });
    if (!Number.isInteger(characterKey) || characterKey <= 0) return res.status(400).json({ error: "valid characterKey required" });
    if (!Number.isInteger(playerWeaponId) || playerWeaponId <= 0) return res.status(400).json({ error: "valid weapon id required" });

    const result = await prisma.$transaction(async (tx) => {
      const character = await tx.playerCharacter.findUnique({
        where: { userId_characterKey: { userId, characterKey } },
      });
      if (!character) return { error: "character not found" };

      const playerWeapon = await tx.playerWeapon.findFirst({ where: { id: playerWeaponId, userId } });
      if (!playerWeapon) return { error: "weapon not found" };

      await tx.playerWeapon.updateMany({ where: { userId }, data: { equipedCharacter: 0 } });
      const equipped = await tx.playerWeapon.update({
        where: { id: playerWeaponId },
        data: { equipedCharacter: characterKey },
        select: { id: true, userId: true, weaponKey: true, level: true, exp: true, equipedCharacter: true },
      });
      return { value: equipped };
    });

    if (result.error) return res.status(400).json({ error: result.error });
    audit(req, "WEAPON_EQUIPPED", { userId, playerWeaponId, characterKey, weaponKey: result.value.weaponKey });
    return res.json(result.value);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/weapon/release", async (req, res, next) => {
  try {
    const userId = Number(req.body?.userId);
    const playerWeaponId = Number(req.body?.id);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "valid userId required" });
    if (!Number.isInteger(playerWeaponId) || playerWeaponId <= 0) return res.status(400).json({ error: "valid weapon id required" });
    const weapon = await prisma.playerWeapon.findFirst({ where: { id: playerWeaponId, userId } });
    if (!weapon) return res.status(400).json({ error: "weapon not found" });
    const released = await prisma.playerWeapon.update({
      where: { id: playerWeaponId }, data: { equipedCharacter: 0 },
      select: { id: true, userId: true, weaponKey: true, level: true, exp: true, equipedCharacter: true },
    });
    audit(req, "WEAPON_RELEASED", { userId, playerWeaponId, weaponKey: released.weaponKey });
    return res.json(released);
  } catch (error) { return next(error); }
});

app.post("/api/item/consume", async (req, res, next) => {
  try {
    const request = parseItemRequest(req);
    const validationError = validateItemRequest(request);
    if (validationError) return res.status(400).json({ error: validationError });
    if (request.itemKey === PLAYER_EXP_ITEM_KEY) {
      return res.status(400).json({ error: "PlayerExp is not an inventory item" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.playerItem.findUnique({
        where: { userId_itemKey: { userId: request.userId, itemKey: request.itemKey } },
      });
      if (!item || item.quantity < request.quantity) return false;

      await tx.playerItem.update({
        where: { id: item.id },
        data: { quantity: { decrement: request.quantity } },
      });
      return true;
    });

    if (!result) {
      return res.status(400).json({ error: "item not found or insufficient quantity" });
    }
    audit(req, "ITEM_CONSUMED", request);
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/item/update", async (req, res, next) => {
  try {
    const request = parseItemRequest(req);
    const validationError = validateItemRequest(request, true);
    if (validationError) return res.status(400).json({ error: validationError });
    if (request.itemKey === PLAYER_EXP_ITEM_KEY) {
      return res.status(400).json({ error: "PlayerExp is not an inventory item" });
    }

    const item = await prisma.playerItem.findUnique({
      where: { userId_itemKey: { userId: request.userId, itemKey: request.itemKey } },
    });
    if (!item) return res.status(404).json({ error: "item not found" });

    await prisma.playerItem.update({
      where: { id: item.id },
      data: { quantity: request.quantity },
    });
    audit(req, "ITEM_QUANTITY_UPDATED", request);
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/character/acquire", async (req, res, next) => {
  try {
    const request = parseCharacterRequest(req);
    const validationError = validateCharacterRequest(request);
    if (validationError) return res.status(400).json({ error: validationError });

    const result = await prisma.$transaction(async (tx) => {
      if (!await tx.user.findUnique({ where: { id: request.userId } })) return false;

      const character = await tx.playerCharacter.findUnique({
        where: {
          userId_characterKey: {
            userId: request.userId,
            characterKey: request.characterKey,
          },
        },
      });

      if (character) {
        await tx.playerCharacter.update({
          where: { id: character.id },
          data: { stack: { increment: request.stack } },
        });
      } else {
        await tx.playerCharacter.create({
          data: {
            userId: request.userId,
            characterKey: request.characterKey,
            stack: request.stack,
          },
        });
      }
      return true;
    });

    if (!result) return res.status(404).json({ error: "user not found" });
    audit(req, "CHARACTER_ACQUIRED", request);
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/character/list", async (req, res, next) => {
  try {
    const userId = Number(req.body?.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "valid userId required" });
    }
    if (!await prisma.user.findUnique({ where: { id: userId } })) {
      return res.status(404).json({ error: "user not found" });
    }

    const characters = await prisma.playerCharacter.findMany({
      where: { userId },
      select: {
        userId: true, characterKey: true, stack: true, exp: true, level: true,
        grade: true, activeLv: true, charm: true, passiveLv0: true, passiveLv1: true, passiveLv2: true,
      },
      orderBy: { characterKey: "asc" },
    });
    return res.json(characters.map((character) => ({
      ...character,
      exp: Number(character.exp),
    })));
  } catch (error) {
    return next(error);
  }
});

app.post("/api/character/upgrade", async (req, res, next) => {
  try {
    const userId = Number(req.body?.userId);
    const characterKey = Number(req.body?.characterKey);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "valid userId required" });
    }
    if (!Number.isInteger(characterKey) || characterKey <= 0) return res.status(400).json({ error: "valid characterKey required" });

    const character = await prisma.$transaction(async (tx) => {
      const current = await tx.playerCharacter.findUnique({
        where: { userId_characterKey: { userId, characterKey } },
      });
      if (!current || current.stack <= 0) return null;

      return tx.playerCharacter.update({
        where: { id: current.id },
        data: { stack: { decrement: 1 } },
      select: {
        userId: true, characterKey: true, stack: true, exp: true, level: true,
        grade: true, activeLv: true, charm: true, passiveLv0: true, passiveLv1: true, passiveLv2: true,
      },
      });
    });

    if (!character) {
      return res.status(400).json({ error: "character not found or stack is zero" });
    }
    audit(req, "CHARACTER_UPGRADED", {
      userId,
      characterKey,
      remainingStack: character.stack,
    });
    return res.json({
      ...character,
      exp: Number(character.exp),
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/character/update", async (req, res, next) => {
  try {
    const request = parseCharacterRequest(req);
    const validationError = validateCharacterRequest(request, true);
    if (validationError) return res.status(400).json({ error: validationError });

    const character = await prisma.playerCharacter.findUnique({
      where: {
        userId_characterKey: {
          userId: request.userId,
          characterKey: request.characterKey,
        },
      },
    });
    if (!character) return res.status(404).json({ error: "character not found" });

    await prisma.playerCharacter.update({
      where: { id: character.id },
        data: { stack: request.stack },
    });
    audit(req, "CHARACTER_STACK_UPDATED", request);
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/character/level-up", async (req, res, next) => {
  try {
    const userId = Number(req.body?.userId);
    const characterKey = Number(req.body?.characterKey);
    const eItemTypes = req.body?.eItemTypes;
    const counts = req.body?.counts;
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "valid userId required" });
    }
    if (!Number.isInteger(characterKey) || characterKey <= 0) {
      return res.status(400).json({ error: "valid characterKey required" });
    }
    if (!Array.isArray(eItemTypes) || !Array.isArray(counts) || eItemTypes.length === 0) {
      return res.status(400).json({ error: "eItemTypes and counts arrays required" });
    }
    if (eItemTypes.length !== counts.length) {
      return res.status(400).json({ error: "eItemTypes and counts length mismatch" });
    }

    const requestedItems = new Map();
    for (let index = 0; index < eItemTypes.length; index += 1) {
      const eItemType = Number(eItemTypes[index]);
      const count = Number(counts[index]);
      if (!Number.isSafeInteger(eItemType) || eItemType <= 0) {
        return res.status(400).json({ error: `invalid eItemTypes[${index}]` });
      }
      if (!Number.isSafeInteger(count) || count <= 0) {
        return res.status(400).json({ error: `invalid counts[${index}]` });
      }
      const totalCount = (requestedItems.get(eItemType) || 0) + count;
      if (!Number.isSafeInteger(totalCount) || totalCount > 2147483647) {
        return res.status(400).json({ error: `counts[${index}] is too large` });
      }
      requestedItems.set(eItemType, totalCount);
    }

    const result = await prisma.$transaction(async (tx) => {
      const [commonValues, levelRows, enumRows, itemRows] = await Promise.all([
        tx.$queryRawUnsafe(
          'SELECT "key", "value" FROM "_100_CommonValues" WHERE "key" IN (1000001, 1000002)'
        ),
        tx.$queryRawUnsafe(
          'SELECT "level", "expToNextLevel", "totalExpRequired" FROM "_107_CharacterLevel" ORDER BY "level" ASC'
        ),
        tx.$queryRawUnsafe(
          'SELECT rowid AS "eItemType", "ItemType" AS "type" FROM "_000_Global_Enum" WHERE "ItemType" IS NOT NULL'
        ),
        tx.$queryRawUnsafe(
          'SELECT "key", "type" FROM "_101_Items"'
        ),
      ]);

      const commonValueMap = new Map(commonValues.map((row) => [Number(row.key), Number(row.value)]));
      const maxLevel = commonValueMap.get(1000001);
      const expPerCard = commonValueMap.get(1000002);
      if (!Number.isSafeInteger(maxLevel) || maxLevel <= 0) {
        throw new Error("invalid max character level table value");
      }
      if (!Number.isSafeInteger(expPerCard) || expPerCard <= 0) {
        throw new Error("invalid ExpCard experience table value");
      }

      const levels = levelRows.map((row) => ({
        level: Number(row.level),
        expToNextLevel: Number(row.expToNextLevel),
        totalExpRequired: Number(row.totalExpRequired),
      }));
      const levelMap = new Map(levels.map((row) => [row.level, row]));
      const maxLevelRow = levelMap.get(maxLevel);
      if (!maxLevelRow) throw new Error("max character level is missing from _107_CharacterLevel");

      const character = await tx.playerCharacter.findUnique({
        where: { userId_characterKey: { userId, characterKey } },
      });
      if (!character) return { error: "character not found" };
      if (character.level >= maxLevel) return { error: "character is already max level" };

      const currentLevelRow = levelMap.get(character.level);
      if (!currentLevelRow) throw new Error("character level is missing from _107_CharacterLevel");

      const enumTypeMap = new Map(enumRows.map((row) => [Number(row.eItemType), String(row.type)]));
      const itemTypeMap = new Map(itemRows.map((row) => [String(row.type), Number(row.key)]));
      const consumptions = [];
      let addedExp = 0n;

      for (const [eItemType, count] of requestedItems) {
        const itemType = enumTypeMap.get(eItemType);
        if (!itemType) return { error: `unknown EItemType: ${eItemType}` };
        if (itemType !== "ExpCard") return { error: `item type cannot grant character exp: ${itemType}` };

        const itemKey = itemTypeMap.get(itemType);
        if (!Number.isSafeInteger(itemKey)) throw new Error(`item table row missing for type: ${itemType}`);
        const inventoryItem = await tx.playerItem.findUnique({
          where: { userId_itemKey: { userId, itemKey } },
        });
        if (!inventoryItem || inventoryItem.quantity < count) {
          return { error: `not enough item: ${itemType}` };
        }

        consumptions.push({ eItemType, itemKey, count, inventoryItem });
        addedExp += BigInt(expPerCard) * BigInt(count);
      }

      const currentExp = BigInt(character.exp);
      const totalExp = BigInt(currentLevelRow.totalExpRequired) + currentExp + addedExp;
      if (totalExp > BigInt(maxLevelRow.totalExpRequired)) {
        return { error: "exp exceeds max level" };
      }

      let targetLevelRow = currentLevelRow;
      for (const levelRow of levels) {
        if (levelRow.level > maxLevel) break;
        if (BigInt(levelRow.totalExpRequired) > totalExp) break;
        targetLevelRow = levelRow;
      }
      const remainingExp = totalExp - BigInt(targetLevelRow.totalExpRequired);

      const updated = await tx.playerCharacter.update({
        where: { id: character.id },
        data: { level: targetLevelRow.level, exp: remainingExp },
        select: { characterKey: true, level: true, exp: true },
      });

      const updatedItems = [];
      for (const consumption of consumptions) {
        const updatedItem = await tx.playerItem.update({
          where: { id: consumption.inventoryItem.id },
          data: { quantity: { decrement: consumption.count } },
          select: { userId: true, itemKey: true, quantity: true },
        });
        updatedItems.push(updatedItem);
      }

      return {
        value: {
          ...updated,
          exp: Number(updated.exp),
          items: updatedItems,
        },
        addedExp,
        consumptions: consumptions.map(({ eItemType, itemKey, count }) => ({
          eItemType,
          itemKey,
          count,
        })),
      };
    });

    if (result.error) return res.status(400).json({ error: result.error });
    audit(req, "CHARACTER_LEVEL_UP", {
      userId,
      characterKey,
      addedExp: result.addedExp,
      consumptions: result.consumptions,
      characterLevel: result.value.level,
      remainingExp: result.value.exp,
    });
    return res.json(result.value);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/version", async (req, res, next) => {
  try {
    const latestVersion = await prisma.version.findFirst({
      orderBy: { id: "desc" },
      select: {
        nowVersion: true,
        downloadUrl: true,
        createdAt: true,
      },
    });

    if (!latestVersion) {
      return res.status(404).json({ error: "version not found" });
    }

    return res.json(latestVersion);
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "not found" });
});

app.use((error, req, res, next) => {
  writeLog("error", "unhandled_error", {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    errorName: error?.name || "Error",
    errorMessage: error?.message || String(error),
    stack: error?.stack,
  });
  res.status(500).json({ error: "internal server error" });
});

const existingUserInitialItemsMigration = "20260903_existing_users_add_all_items_100";
const playerExperienceSchemaMigration = "20260903_player_experience_fields";
const playerExpInventoryCleanupMigration = "20260903_player_exp_inventory_cleanup";
const missingInitialPlayerExpRepairMigration = "20260903_missing_initial_player_exp_repair_v2";
const playerMissionsSchemaMigration = "20260903_player_missions_schema";

async function applyPlayerMissionsSchemaMigration() {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "__ServerMigration" (' +
      '"key" TEXT PRIMARY KEY, "appliedAt" TEXT NOT NULL)'
    );
    const appliedRows = await tx.$queryRawUnsafe(
      'SELECT "key" FROM "__ServerMigration" WHERE "key" = ?',
      playerMissionsSchemaMigration
    );
    if (appliedRows.length > 0) return { applied: false };

    await tx.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "PlayerMissions" (' +
      '"id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, ' +
      '"userId" INTEGER NOT NULL, ' +
      '"missionKey" INTEGER NOT NULL, ' +
      '"progress" INTEGER NOT NULL DEFAULT 0, ' +
      '"isClaimed" BOOLEAN NOT NULL DEFAULT false, ' +
      '"cycleStartedAt" DATETIME NOT NULL, ' +
      'CONSTRAINT "PlayerMissions_userId_fkey" FOREIGN KEY ("userId") ' +
      'REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE)'
    );
    await tx.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "PlayerMissions_userId_missionKey_key" ' +
      'ON "PlayerMissions"("userId", "missionKey")'
    );
    await tx.$executeRawUnsafe('DROP TABLE IF EXISTS "Mission"');
    await tx.$executeRawUnsafe(
      'INSERT INTO "__ServerMigration" ("key", "appliedAt") VALUES (?, CURRENT_TIMESTAMP)',
      playerMissionsSchemaMigration
    );
    return { applied: true };
  });
}

async function applyPlayerExperienceSchemaMigration() {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "__ServerMigration" (' +
      '"key" TEXT PRIMARY KEY, "appliedAt" TEXT NOT NULL)'
    );
    const appliedRows = await tx.$queryRawUnsafe(
      'SELECT "key" FROM "__ServerMigration" WHERE "key" = ?',
      playerExperienceSchemaMigration
    );
    if (appliedRows.length > 0) return { applied: false };

    const columns = await tx.$queryRawUnsafe('PRAGMA table_info("User")');
    const columnNames = new Set(columns.map((column) => String(column.name)));
    let schemaChanged = false;
    for (const columnName of ["exp", "progressExp", "lifetimeExp"]) {
      if (!columnNames.has(columnName)) {
        await tx.$executeRawUnsafe(
          `ALTER TABLE "User" ADD COLUMN "${columnName}" BIGINT NOT NULL DEFAULT 0`
        );
        schemaChanged = true;
      }
    }

    if (schemaChanged) {
      await tx.$executeRawUnsafe(
        'UPDATE "User" SET ' +
        '"progressExp" = COALESCE((' +
        'SELECT "totalExpRequired" FROM "_108_PlayerLevel" WHERE "level" = "User"."level"' +
        '), 0) + "exp", ' +
        '"lifetimeExp" = COALESCE((' +
        'SELECT "totalExpRequired" FROM "_108_PlayerLevel" WHERE "level" = "User"."level"' +
        '), 0) + "exp"'
      );
    }

    await tx.$executeRawUnsafe(
      'INSERT INTO "__ServerMigration" ("key", "appliedAt") VALUES (?, CURRENT_TIMESTAMP)',
      playerExperienceSchemaMigration
    );
    return { applied: true, schemaChanged };
  });
}

async function applyExistingUserInitialItemsMigration() {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "__ServerMigration" (' +
      '"key" TEXT PRIMARY KEY, "appliedAt" TEXT NOT NULL)'
    );
    const appliedRows = await tx.$queryRawUnsafe(
      'SELECT "key" FROM "__ServerMigration" WHERE "key" = ?',
      existingUserInitialItemsMigration
    );
    if (appliedRows.length > 0) return { applied: false };

    const [users, itemRows] = await Promise.all([
      tx.user.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
      tx.$queryRawUnsafe('SELECT "key" FROM "_101_Items" ORDER BY "key" ASC'),
    ]);
    const itemKeys = itemRows
      .map((item) => Number(item.key))
      .filter((itemKey) => itemKey !== PLAYER_EXP_ITEM_KEY);
    if (itemKeys.length === 0 || itemKeys.some((itemKey) => !Number.isSafeInteger(itemKey))) {
      throw new Error("_101_Items contains no valid item keys");
    }

    for (const user of users) {
      for (const itemKey of itemKeys) {
        await tx.playerItem.upsert({
          where: { userId_itemKey: { userId: user.id, itemKey } },
          update: { quantity: { increment: 100 } },
          create: { userId: user.id, itemKey, quantity: 100 },
        });
      }
    }

    await tx.$executeRawUnsafe(
      'INSERT INTO "__ServerMigration" ("key", "appliedAt") VALUES (?, CURRENT_TIMESTAMP)',
      existingUserInitialItemsMigration
    );
    return {
      applied: true,
      userCount: users.length,
      itemTypeCount: itemKeys.length,
      updatedRowCount: users.length * itemKeys.length,
    };
  });
}

async function applyPlayerExpInventoryCleanupMigration() {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "__ServerMigration" (' +
      '"key" TEXT PRIMARY KEY, "appliedAt" TEXT NOT NULL)'
    );
    const appliedRows = await tx.$queryRawUnsafe(
      'SELECT "key" FROM "__ServerMigration" WHERE "key" = ?',
      playerExpInventoryCleanupMigration
    );
    if (appliedRows.length > 0) return { applied: false };

    const playerExpItems = await tx.playerItem.findMany({
      where: { itemKey: PLAYER_EXP_ITEM_KEY, quantity: { gt: 0 } },
      select: { userId: true, quantity: true },
    });
    for (const item of playerExpItems) {
      await grantPlayerExperience(tx, item.userId, item.quantity);
    }
    const removedCount = await tx.playerItem.deleteMany({ where: { itemKey: PLAYER_EXP_ITEM_KEY } });
    await tx.$executeRawUnsafe(
      'INSERT INTO "__ServerMigration" ("key", "appliedAt") VALUES (?, CURRENT_TIMESTAMP)',
      playerExpInventoryCleanupMigration
    );
    return {
      applied: true,
      convertedCount: playerExpItems.length,
      removedCount: removedCount.count,
    };
  });
}

async function applyMissingInitialPlayerExpRepairMigration() {
  return prisma.$transaction(async (tx) => {
    const appliedRows = await tx.$queryRawUnsafe(
      'SELECT "key" FROM "__ServerMigration" WHERE "key" = ?',
      missingInitialPlayerExpRepairMigration
    );
    if (appliedRows.length > 0) return { applied: false };

    const users = await tx.user.findMany({
      select: {
        id: true,
        level: true,
        exp: true,
        progressExp: true,
        lifetimeExp: true,
      },
    });
    for (const user of users) {
      const levelRows = await tx.$queryRawUnsafe(
        'SELECT "totalExpRequired" FROM "_108_PlayerLevel" WHERE "level" = ?',
        user.level
      );
      if (levelRows.length !== 1) {
        throw new Error(`player level ${user.level} is missing from _108_PlayerLevel`);
      }
      const minimumTotal = BigInt(levelRows[0].totalExpRequired) + BigInt(user.exp);
      if (BigInt(user.progressExp) < minimumTotal || BigInt(user.lifetimeExp) < minimumTotal) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            progressExp: BigInt(user.progressExp) < minimumTotal
              ? minimumTotal
              : user.progressExp,
            lifetimeExp: BigInt(user.lifetimeExp) < minimumTotal
              ? minimumTotal
              : user.lifetimeExp,
          },
        });
      }
      await grantPlayerExperience(tx, user.id, 100);
    }
    await tx.$executeRawUnsafe(
      'INSERT INTO "__ServerMigration" ("key", "appliedAt") VALUES (?, CURRENT_TIMESTAMP)',
      missingInitialPlayerExpRepairMigration
    );
    return { applied: true, repairedUserCount: users.length };
  });
}

async function start() {
  const missionsSchema = await applyPlayerMissionsSchemaMigration();
  if (missionsSchema.applied) {
    writeLog("info", "server_migration_applied", {
      migration: playerMissionsSchemaMigration,
    });
  }
  const experienceSchema = await applyPlayerExperienceSchemaMigration();
  if (experienceSchema.applied) {
    writeLog("info", "server_migration_applied", {
      migration: playerExperienceSchemaMigration,
      schemaChanged: experienceSchema.schemaChanged,
    });
  }
  const migration = await applyExistingUserInitialItemsMigration();
  if (migration.applied) {
    writeLog("info", "server_migration_applied", {
      migration: existingUserInitialItemsMigration,
      userCount: migration.userCount,
      itemTypeCount: migration.itemTypeCount,
      updatedRowCount: migration.updatedRowCount,
    });
  }
  const cleanup = await applyPlayerExpInventoryCleanupMigration();
  if (cleanup.applied) {
    writeLog("info", "server_migration_applied", {
      migration: playerExpInventoryCleanupMigration,
      convertedCount: cleanup.convertedCount,
      removedCount: cleanup.removedCount,
    });
  }
  const playerExpRepair = await applyMissingInitialPlayerExpRepairMigration();
  if (playerExpRepair.applied) {
    writeLog("info", "server_migration_applied", {
      migration: missingInitialPlayerExpRepairMigration,
      repairedUserCount: playerExpRepair.repairedUserCount,
    });
  }
  const userCount = await prisma.user.count();

  writeLog("info", "database_ready", { userCount });
  app.listen(port, "0.0.0.0", () => {
    writeLog("info", "server_started", { port });
  });
}

async function shutdown(signal) {
  writeLog("info", "server_shutting_down", { signal });
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch(async (error) => {
  writeLog("error", "server_start_failed", {
    errorName: error?.name || "Error",
    errorMessage: error?.message || String(error),
    stack: error?.stack,
  });
  await prisma.$disconnect();
  process.exit(1);
});
