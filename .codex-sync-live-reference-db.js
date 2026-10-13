const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const root = __dirname;
const sourcePath = path.join(root, "dev.db");
const targetPath = path.join(root, ".live", "dev.db");

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function listTables(db) {
  return db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
}

function countUserRows(db) {
  const result = {};
  for (const { name } of listTables(db)) {
    if (/^_\d{3}/.test(name) || name === "__version" || name.startsWith("sqlite_")) continue;
    result[name] = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get().count;
  }
  return result;
}

function copyTable(source, target, name, createSql) {
  target.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(name)}`);
  target.exec(createSql);

  const rows = source.prepare(`SELECT * FROM ${quoteIdentifier(name)}`).all();
  if (rows.length === 0) return 0;

  const columns = Object.keys(rows[0]);
  const insert = target.prepare(
    `INSERT INTO ${quoteIdentifier(name)} (${columns.map(quoteIdentifier).join(", ")}) ` +
    `VALUES (${columns.map(() => "?").join(", ")})`,
  );
  for (const row of rows) insert.run(columns.map((column) => row[column]));
  return rows.length;
}

const source = new Database(sourcePath, { readonly: true });
const target = new Database(targetPath);
const beforeUsers = countUserRows(target);

const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const backupPath = `${targetPath}.backup-${timestamp}`;
target.close();
fs.copyFileSync(targetPath, backupPath);

const writableTarget = new Database(targetPath);
const sourceTables = listTables(source);
const sourceReferenceTables = sourceTables.filter(({ name }) => {
  const match = /^_(\d{3})/.exec(name);
  return match && Number(match[1]) < 900;
});
const sourceVersion = sourceTables.find(({ name }) => name === "__version");

const synced = [];
const removed = [];
const sync = writableTarget.transaction(() => {
  writableTarget.pragma("foreign_keys = OFF");

  for (const { name } of listTables(writableTarget)) {
    const match = /^_(\d{3})/.exec(name);
    if (match && Number(match[1]) >= 900) {
      writableTarget.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(name)}`);
      removed.push(name);
    }
  }

  for (const { name, sql } of sourceReferenceTables) {
    synced.push({ name, rows: copyTable(source, writableTarget, name, sql) });
  }
  if (sourceVersion) {
    synced.push({
      name: sourceVersion.name,
      rows: copyTable(source, writableTarget, sourceVersion.name, sourceVersion.sql),
    });
  }
});

try {
  sync();
} finally {
  writableTarget.close();
  source.close();
}

const verify = new Database(targetPath, { readonly: true });
const afterUsers = countUserRows(verify);
const item = verify.prepare('SELECT * FROM "_101_Items" WHERE key = 1010005').get();
const missingSourceTables = sourceReferenceTables
  .map(({ name }) => name)
  .filter((name) => !listTables(verify).some((table) => table.name === name));
verify.close();

if (JSON.stringify(beforeUsers) !== JSON.stringify(afterUsers)) {
  throw new Error(`User table counts changed: before=${JSON.stringify(beforeUsers)}, after=${JSON.stringify(afterUsers)}`);
}
if (!item) throw new Error("1010005 is still missing after synchronization");
if (missingSourceTables.length > 0) throw new Error(`Missing synchronized tables: ${missingSourceTables.join(", ")}`);

console.log(JSON.stringify({ backupPath, beforeUsers, afterUsers, synced, removed, item }, null, 2));
