require("dotenv").config();

const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing. Copy .env.example to .env first.");
}

const port = Number(process.env.PORT || 3000);
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });
const app = express();

app.use(express.json());

function toUserDto(user) {
  return {
    id: user.id,
    localId: user.localId,
    firebaseUid: user.firebaseUid,
    nickname: user.nickname,
    level: user.level,
    items: user.items || [],
    characters: user.characters || [],
    armors: user.armors || [],
    weapons: user.weapons || [],
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

function getCharacterExpToNextLevel(level) {
  if (level >= 100) return 0;
  if (level <= 19) return 100;
  if (level <= 39) return 150;
  if (level <= 59) return 200;
  if (level <= 79) return 250;
  return 300;
}

function getCharacterTotalExpRequired(level) {
  if (level <= 1) return 0;
  let total = 0;
  for (let currentLevel = 1; currentLevel < level; currentLevel++) {
    total += getCharacterExpToNextLevel(currentLevel);
  }
  return total;
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

    if (!user) return res.json({ isNew: true, user: null });

    const playerData = await getPlayerData(user.id);
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

    const user = await prisma.user.create({
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
      },
      include: { characters: true, items: true },
    });
    const playerData = await getPlayerData(user.id);
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
      const user = await tx.user.findUnique({ where: { id: request.userId } });
      if (!user) return false;

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
      return true;
    });

    if (!result) return res.status(404).json({ error: "user not found" });
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
    return res.json(released);
  } catch (error) { return next(error); }
});

app.post("/api/item/consume", async (req, res, next) => {
  try {
    const request = parseItemRequest(req);
    const validationError = validateItemRequest(request);
    if (validationError) return res.status(400).json({ error: validationError });

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

    const item = await prisma.playerItem.findUnique({
      where: { userId_itemKey: { userId: request.userId, itemKey: request.itemKey } },
    });
    if (!item) return res.status(404).json({ error: "item not found" });

    await prisma.playerItem.update({
      where: { id: item.id },
      data: { quantity: request.quantity },
    });
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
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/character/level-up", async (req, res, next) => {
  try {
    const userId = Number(req.body?.userId);
    const characterKey = Number(req.body?.characterKey);
    const expValue = req.body?.exp;
    let exp;
    try {
      exp = BigInt(String(expValue));
    } catch {
      return res.status(400).json({ error: "exp must be a positive integer" });
    }
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "valid userId required" });
    }
    if (!Number.isInteger(characterKey) || characterKey <= 0) {
      return res.status(400).json({ error: "valid characterKey required" });
    }
    if (exp <= 0n) {
      return res.status(400).json({ error: "exp must be a positive integer" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const character = await tx.playerCharacter.findUnique({
        where: { userId_characterKey: { userId, characterKey } },
      });
      if (!character) return { error: "character not found" };
      if (character.level >= 100) return { error: "character is already max level" };

      const currentExp = BigInt(character.exp);
      const addedExp = exp;
      const totalExp = BigInt(getCharacterTotalExpRequired(character.level)) + currentExp + addedExp;
      if (totalExp > 19900n) return { error: "exp exceeds max level" };

      let level = character.level;
      let remainingExp = currentExp + addedExp;
      while (level < 100) {
        const requiredExp = BigInt(getCharacterExpToNextLevel(level));
        if (remainingExp < requiredExp) break;
        remainingExp -= requiredExp;
        level += 1;
      }

      const updated = await tx.playerCharacter.update({
        where: { id: character.id },
        data: { level, exp: remainingExp },
        select: { characterKey: true, level: true, exp: true },
      });
      return { value: { ...updated, exp: Number(updated.exp) } };
    });

    if (result.error) return res.status(400).json({ error: result.error });
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
  console.error(error);
  res.status(500).json({ error: "internal server error" });
});

async function start() {
  const userCount = await prisma.user.count();

  console.log(`database ready: ${userCount} users`);
  app.listen(port, "0.0.0.0", () => {
    console.log(`server running on port ${port}`);
  });
}

async function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch(async (error) => {
  console.error("failed to start server");
  console.error(`DATABASE_URL=${databaseUrl}`);
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
