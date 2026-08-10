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

app.get("/health", async (req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// localId is the stable login identifier. Firebase UID is an optional link
// used by Firebase-backed services and is not the database primary key.
app.get("/user", async (req, res, next) => {
  try {
    const localId = String(req.query.localId || "").trim();
    const firebaseUid = String(req.query.firebaseUid || "").trim() || null;
    if (!localId) {
      return res.status(400).json({ error: "localId required" });
    }

    const user = await prisma.$transaction(async (tx) => {
      const localUser = await tx.user.findUnique({ where: { localId } });
      if (localUser) {
        return tx.user.update({
          where: { id: localUser.id },
          data: firebaseUid ? { firebaseUid } : {},
        });
      }

      // First login after migrating from guestId: retain the existing account
      // and its game data, then make localId the stable login identifier.
      if (firebaseUid) {
        const firebaseUser = await tx.user.findUnique({ where: { firebaseUid } });
        if (firebaseUser) {
          return tx.user.update({
            where: { id: firebaseUser.id },
            data: { localId },
          });
        }
      }

      return tx.user.create({ data: { localId, firebaseUid } });
    });

    return res.json(toUserDto(user));
  } catch (error) {
    return next(error);
  }
});

// Lightweight endpoint for checking that the attached catalog is readable.
app.get("/catalog", async (req, res, next) => {
  try {
    const [items, characters] = await Promise.all([
      prisma.item.findMany({ orderBy: { id: "asc" } }),
      prisma.character.findMany({ orderBy: { id: "asc" } }),
    ]);
    return res.json({ items, characters });
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
  const [itemCount, userCount] = await Promise.all([
    prisma.item.count(),
    prisma.user.count(),
  ]);

  console.log(`database ready: ${itemCount} items, ${userCount} users`);
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
