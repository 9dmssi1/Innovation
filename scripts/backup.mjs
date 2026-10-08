import * as sqlite from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {chmod, link, lstat, mkdir, mkdtemp, open, readdir, rmdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Only names reserved by this utility are eligible for automatic retention.
export const BACKUP_NAME = /^graph-classroom-\d{8}T\d{9}Z-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.sqlite$/;

function integer(env, key, fallback, max) {
  const raw = env[key] ?? String(fallback);
  if (!/^\d+$/.test(String(raw)) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > max)
    throw new Error(`${key}: expected an integer from 1 to ${max}.`);
  return Number(raw);
}

export function backupConfig(env = process.env) {
  const dbFile = env.GRAPH_DB || '/data/classroom.sqlite';
  const backupDir = env.BACKUP_DIR || '/backups';
  if (![dbFile, backupDir].every(value => path.isAbsolute(value)))
    throw new Error('GRAPH_DB and BACKUP_DIR must be absolute paths.');
  return Object.freeze({dbFile: path.resolve(dbFile), backupDir: path.resolve(backupDir),
    keep: integer(env, 'BACKUP_KEEP', 14, 365),
    intervalMs: integer(env, 'BACKUP_INTERVAL_HOURS', 24, 168) * 60 * 60 * 1000});
}

export function requireBackupRuntime() {
  if (Number(process.versions.node.split('.')[0]) < 24 || typeof sqlite.backup !== 'function')
    throw new Error('Backup and restore utilities require Node.js 24 or newer. The local app can still use Node.js 22.13+.');
}

export async function assertAbsent(file) {
  try { await lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Refusing to overwrite an existing file: ${file}`);
}

async function existingDatabase(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0)
    throw new Error('Source must be an existing, non-empty, regular SQLite database file.');
}

function checkDatabase(db) {
  const checks = db.prepare('PRAGMA quick_check').all();
  if (checks.length !== 1 || checks[0].quick_check !== 'ok')
    throw new Error('SQLite quick_check failed; the previous backups have been preserved.');
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get())
    throw new Error('Refusing an empty database with no application tables.');
}

// Online SQLite backup includes committed WAL data. Copying the .sqlite file alone does not.
// The caller supplies a new path inside its own private staging directory.
export async function stageSnapshot(source, destination) {
  requireBackupRuntime();
  await existingDatabase(source);
  const reserved = await open(destination, 'wx', 0o600);
  await reserved.close();
  let db;
  try {
    // readOnly also prevents accidental creation if the source disappears after lstat.
    db = new sqlite.DatabaseSync(source, {readOnly: true, timeout: 5000});
    await sqlite.backup(db, destination);
  } finally { db?.close(); }
  const snapshot = new sqlite.DatabaseSync(destination);
  try {
    // Produce a self-contained file; do not ship destination -wal/-shm companions.
    snapshot.exec('PRAGMA journal_mode = DELETE');
    checkDatabase(snapshot);
  } finally { snapshot.close(); }
  await chmod(destination, 0o600);
  const file = await open(destination, 'r+');
  try { await file.sync(); } finally { await file.close(); }
}

// No recursive deletion: remove only these files in the directory created by this call.
export async function removeStaging(directory, filename) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { await unlink(path.join(directory, filename + suffix)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await rmdir(directory);
}

export async function listSnapshots(backupDir) {
  const entries = await readdir(backupDir, {withFileTypes: true});
  const snapshots = [];
  for (const entry of entries) {
    if (!entry.isFile() || !BACKUP_NAME.test(entry.name)) continue;
    const filename = path.join(backupDir, entry.name);
    let info;
    try { info = await lstat(filename); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (info.isFile() && !info.isSymbolicLink()) snapshots.push({filename, modified: info.mtimeMs});
  }
  return snapshots.sort((a, b) => b.modified - a.modified || b.filename.localeCompare(a.filename));
}

export async function createBackup(config = backupConfig()) {
  requireBackupRuntime();
  // Validate even a supplied config before opening files or doing retention.
  if (![config.dbFile, config.backupDir].every(value => typeof value === 'string' && path.isAbsolute(value)))
    throw new Error('GRAPH_DB and BACKUP_DIR must be absolute paths.');
  if (!Number.isInteger(config.keep) || config.keep < 1 || config.keep > 365)
    throw new Error('BACKUP_KEEP: expected an integer from 1 to 365.');
  await existingDatabase(config.dbFile);
  await mkdir(config.backupDir, {recursive: true, mode: 0o700});
  const staging = await mkdtemp(path.join(config.backupDir, '.graph-backup-'));
  const temporary = path.join(staging, 'snapshot.sqlite');
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const destination = path.join(config.backupDir, `graph-classroom-${stamp}-${randomUUID()}.sqlite`);
  try {
    await stageSnapshot(config.dbFile, temporary);
    // link is atomic and never replaces an existing destination (unlike rename).
    await link(temporary, destination);
  } finally { await removeStaging(staging, 'snapshot.sqlite'); }

  // Retention runs only after a complete, checked snapshot was published. Always
  // preserve this snapshot, even if the system clock moved backwards, and the source.
  const candidates = await listSnapshots(config.backupDir);
  const pathKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const preserved = new Set(candidates.slice(0, config.keep).map(item => pathKey(item.filename)));
  preserved.add(pathKey(destination));
  preserved.add(pathKey(config.dbFile));
  for (const item of candidates) {
    if (preserved.has(pathKey(item.filename))) continue;
    try { await unlink(item.filename); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return destination;
}

export function isMain(metaUrl) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(metaUrl);
}

if (isMain(import.meta.url)) {
  try { console.log(await createBackup()); }
  catch (error) { console.error(`Backup failed: ${error.message}`); process.exitCode = 1; }
}
