import path from 'node:path';
import {link, mkdtemp} from 'node:fs/promises';
import {assertAbsent, isMain, removeStaging, stageSnapshot} from './backup.mjs';

async function assertNewTarget(target) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) await assertAbsent(target + suffix);
}

// Restore to a NEW path only. Stop app and backup services before promoting that
// path via GRAPH_DB. This utility never removes or replaces the current database.
export async function restoreBackup(backupFile, targetFile) {
  if (!backupFile || !targetFile) throw new Error('Usage: node scripts/restore.mjs <backup-file> <NEW-target-file>');
  const source = path.resolve(backupFile), target = path.resolve(targetFile);
  await assertNewTarget(target);
  const staging = await mkdtemp(path.join(path.dirname(target), '.graph-restore-'));
  try {
    await stageSnapshot(source, path.join(staging, 'snapshot.sqlite'));
    await assertNewTarget(target);
    await link(path.join(staging, 'snapshot.sqlite'), target);
  } finally { await removeStaging(staging, 'snapshot.sqlite'); }
  return target;
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node scripts/restore.mjs <backup-file> <NEW-target-file>');
    console.log(await restoreBackup(process.argv[2], process.argv[3]));
    console.log('Verified restore created. Stop app and backup services before switching GRAPH_DB to this new file.');
  } catch (error) { console.error(`Restore failed: ${error.message}`); process.exitCode = 1; }
}
