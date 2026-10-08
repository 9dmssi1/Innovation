import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {backupConfig, BACKUP_NAME, createBackup, listSnapshots} from '../scripts/backup.mjs';
import {runBackupLoop} from '../scripts/backup-loop.mjs';
import {restoreBackup} from '../scripts/restore.mjs';
import {checkBackupHealth} from '../scripts/backup-healthcheck.mjs';

const runtimeSupported = Number(process.versions.node.split('.')[0]) >= 24;
const backupTest = (name, fn) => test(name, {skip: !runtimeSupported && 'Hosting backup tools require Node.js 24+'}, fn);

async function fixture(t) {
  const parent = path.resolve(tmpdir());
  const root = await mkdtemp(path.join(parent, 'graph-backup-test-'));
  const connections = [];
  t.after(async () => {
    for (const connection of connections) connection.close();
    // Check the resolved target before any recursive test-directory cleanup.
    const target = path.resolve(root);
    assert.equal(path.dirname(target), parent);
    assert.match(path.basename(target), /^graph-backup-test-[A-Za-z0-9]+$/);
    await rm(target, {recursive: true, force: true});
  });
  const dbFile = path.join(root, 'classroom.sqlite');
  const backupDir = path.join(root, 'backups');
  return {root, dbFile, backupDir, keep: 2, intervalMs: 24 * 3600000, connections};
}

function openSource(t, config) {
  const db = new DatabaseSync(config.dbFile);
  config.connections.push(db);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE work(id INTEGER PRIMARY KEY, answer TEXT);');
  db.prepare('INSERT INTO work(answer) VALUES (?)').run('committed from WAL');
  return db;
}

function answers(file) {
  const db = new DatabaseSync(file, {readOnly: true});
  try { return db.prepare('SELECT answer FROM work ORDER BY id').all().map(row => row.answer); }
  finally { db.close(); }
}

test('backup configuration validates paths, interval, and retention before any timers or file work', () => {
  const config = backupConfig({GRAPH_DB: path.resolve('db.sqlite'), BACKUP_DIR: path.resolve('backups')});
  assert.equal(config.keep, 14);
  assert.equal(config.intervalMs, 86400000);
  assert.equal(backupConfig({BACKUP_INTERVAL_HOURS: '168', BACKUP_KEEP: '365'}).intervalMs, 604800000);
  for (const field of ['BACKUP_INTERVAL_HOURS', 'BACKUP_KEEP']) {
    for (const value of ['0', '-1', '1.5', 'NaN', ' ', '', '1e2', 'Infinity', '99999999999999'])
      assert.throws(() => backupConfig({[field]: value}), new RegExp(field));
  }
  assert.throws(() => backupConfig({BACKUP_INTERVAL_HOURS: '169'}), /BACKUP_INTERVAL_HOURS/);
  assert.throws(() => backupConfig({BACKUP_KEEP: '366'}), /BACKUP_KEEP/);
  assert.throws(() => backupConfig({GRAPH_DB: 'relative.sqlite'}), /absolute/);
  assert.throws(() => backupConfig({BACKUP_DIR: 'relative'}), /absolute/);
});

backupTest('online backup captures committed live WAL data and leaves source usable', async t => {
  const config = await fixture(t);
  const db = openSource(t, config);
  assert.ok((await stat(config.dbFile + '-wal')).size > 0);
  const filename = await createBackup(config);
  assert.match(path.basename(filename), BACKUP_NAME);
  assert.deepEqual(answers(filename), ['committed from WAL']);
  assert.deepEqual(await readdir(config.backupDir), [path.basename(filename)]);
  db.prepare('INSERT INTO work(answer) VALUES (?)').run('later answer');
  assert.deepEqual(answers(filename), ['committed from WAL']);
  assert.deepEqual(answers(config.dbFile), ['committed from WAL', 'later answer']);
  const backup = new DatabaseSync(filename, {readOnly: true});
  try {
    assert.equal(backup.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.equal(backup.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
  } finally { backup.close(); }
});

backupTest('missing, zero-byte, corrupt, and schema-empty sources never publish backups or prune existing files', async t => {
  const config = await fixture(t);
  await mkdir(config.backupDir);
  const existing = path.join(config.backupDir, 'graph-classroom-20260101T000000000Z-11111111-1111-1111-1111-111111111111.sqlite');
  await writeFile(existing, 'previous snapshot sentinel');
  await assert.rejects(createBackup({...config, keep: 1}), /ENOENT/);
  await assert.rejects(stat(config.dbFile), /ENOENT/);
  await writeFile(config.dbFile, '');
  await assert.rejects(createBackup({...config, keep: 1}), /non-empty/);
  await writeFile(config.dbFile, 'not a sqlite database');
  await assert.rejects(createBackup({...config, keep: 1}));
  await writeFile(config.dbFile, '');
  const empty = new DatabaseSync(config.dbFile);
  empty.exec('VACUUM');
  empty.close();
  await assert.rejects(createBackup({...config, keep: 1}), /no application tables/);
  assert.equal(await readFile(existing, 'utf8'), 'previous snapshot sentinel');
  assert.deepEqual(await readdir(config.backupDir), [path.basename(existing)]);
});

backupTest('retention keeps newest backups and ignores unrelated files, directories, and partial files', async t => {
  const config = await fixture(t);
  openSource(t, config);
  const oldest = await createBackup(config);
  await utimes(oldest, new Date('2020-01-01'), new Date('2020-01-01'));
  const second = await createBackup(config);
  await utimes(second, new Date('2021-01-01'), new Date('2021-01-01'));
  const unrelated = ['notes.txt', 'manual.sqlite', 'graph-classroom-unrecognized.sqlite', 'unfinished.sqlite.partial'];
  for (const file of unrelated) await writeFile(path.join(config.backupDir, file), 'keep this');
  const matchingDirectory = 'graph-classroom-20000101T000000000Z-22222222-2222-2222-2222-222222222222.sqlite';
  await mkdir(path.join(config.backupDir, matchingDirectory));
  const latest = await createBackup(config);
  const snapshots = await listSnapshots(config.backupDir);
  assert.deepEqual(snapshots.map(item => item.filename), [latest, second]);
  await assert.rejects(stat(oldest), /ENOENT/);
  for (const file of unrelated) assert.equal(await readFile(path.join(config.backupDir, file), 'utf8'), 'keep this');
  assert.ok((await stat(path.join(config.backupDir, matchingDirectory))).isDirectory());
});

backupTest('new snapshot is preserved if a previous snapshot has a future timestamp', async t => {
  const config = {...await fixture(t), keep: 1};
  openSource(t, config);
  const future = await createBackup(config);
  await utimes(future, new Date('2099-01-01'), new Date('2099-01-01'));
  const newest = await createBackup(config);
  assert.deepEqual(answers(newest), ['committed from WAL']);
  assert.equal((await listSnapshots(config.backupDir)).length, 2);
});

backupTest('manual and scheduled backups can overlap without pruning every completed snapshot', async t => {
  const config = {...await fixture(t), keep: 1};
  openSource(t, config);
  await Promise.all([createBackup(config), createBackup(config)]);
  const snapshots = await listSnapshots(config.backupDir);
  assert.ok(snapshots.length >= 1 && snapshots.length <= 2);
  for (const {filename} of snapshots) assert.deepEqual(answers(filename), ['committed from WAL']);
});

backupTest('restore creates a checked independent database at a new path and rejects overwrite or WAL remnants', async t => {
  const config = await fixture(t);
  openSource(t, config);
  const snapshot = await createBackup(config);
  const target = path.join(config.root, 'restored.sqlite');
  assert.equal(await restoreBackup(snapshot, target), target);
  assert.deepEqual(answers(target), ['committed from WAL']);
  const db = new DatabaseSync(target);
  db.prepare('INSERT INTO work(answer) VALUES (?)').run('only in restored');
  db.close();
  assert.deepEqual(answers(snapshot), ['committed from WAL']);
  const before = await readFile(target);
  await assert.rejects(restoreBackup(snapshot, target), /Refusing to overwrite/);
  assert.deepEqual(await readFile(target), before);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const blocked = path.join(config.root, 'blocked' + suffix + '.sqlite');
    await writeFile(blocked + suffix, 'preserve sidecar');
    await assert.rejects(restoreBackup(snapshot, blocked), /Refusing to overwrite/);
    assert.equal(await readFile(blocked + suffix, 'utf8'), 'preserve sidecar');
    await assert.rejects(stat(blocked), /ENOENT/);
  }
});

backupTest('invalid restore leaves target absent and does not leave staged files', async t => {
  const config = await fixture(t);
  await writeFile(config.dbFile, 'broken database');
  const target = path.join(config.root, 'new.sqlite');
  await assert.rejects(restoreBackup(config.dbFile, target));
  await assert.rejects(stat(target), /ENOENT/);
  assert.deepEqual(await readdir(config.root), ['classroom.sqlite']);
});

test('backup loop starts immediately, serializes jobs and shuts down after an in-flight operation without another timer', async () => {
  const controller = new AbortController();
  const events = [];
  let count = 0;
  await runBackupLoop({config: {intervalMs: 123}, signal: controller.signal,
    backup: async () => { events.push('backup'); if (++count === 2) controller.abort(); return 'snapshot.sqlite'; },
    wait: async ms => { assert.equal(ms, 123); events.push('wait'); }, log: () => {}});
  assert.deepEqual(events, ['backup', 'wait', 'backup']);
  await assert.rejects(runBackupLoop({backup: async () => { throw new Error('disk full'); }, log: () => {}}), /disk full/);
});

test('backup loop exits an interrupted wait gracefully', async () => {
  const controller = new AbortController();
  let count = 0;
  await runBackupLoop({signal: controller.signal, backup: async () => { count++; return 'snapshot.sqlite'; },
    wait: async () => { controller.abort(); throw Object.assign(new Error('stopped'), {name: 'AbortError'}); }, log: () => {}});
  assert.equal(count, 1);
});

backupTest('backup health detects absent and stale snapshots and accepts a recent verified snapshot', async t => {
  const config = await fixture(t);
  openSource(t, config);
  await mkdir(config.backupDir);
  await assert.rejects(checkBackupHealth(config), /No completed backup/);
  const snapshot = await createBackup(config);
  assert.equal(await checkBackupHealth(config), snapshot);
  const {mtimeMs} = await stat(snapshot);
  await assert.rejects(checkBackupHealth(config, mtimeMs + config.intervalMs + 3600001), /stale/);
  await assert.rejects(checkBackupHealth(config, mtimeMs - 300001), /future/);
});
