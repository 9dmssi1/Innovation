import {backupConfig, isMain, listSnapshots} from './backup.mjs';

export async function checkBackupHealth(config = backupConfig(), now = Date.now()) {
  const [latest] = await listSnapshots(config.backupDir);
  if (!latest) throw new Error('No completed backup found.');
  const age = now - latest.modified;
  if (age < -5 * 60 * 1000 || age > config.intervalMs + 60 * 60 * 1000)
    throw new Error('Latest completed backup is stale or has a future timestamp.');
  return latest.filename;
}

if (isMain(import.meta.url)) {
  try { await checkBackupHealth(); }
  catch (error) { console.error(`Backup unhealthy: ${error.message}`); process.exitCode = 1; }
}
