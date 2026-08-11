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

    return res.json({ isNew: !user, user: user ? toUserDto(user) : null });
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
      data: { localId, firebaseUid, nickname: nicknameResult.nickname },
    });
    return res.status(201).json(toUserDto(user));
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
