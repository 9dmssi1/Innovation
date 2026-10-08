import {setTimeout as sleep} from 'node:timers/promises';
import {backupConfig, createBackup, isMain} from './backup.mjs';

// A single awaited operation prevents overlapping backups. Errors reject and make
// the sidecar exit nonzero so the container supervisor can restart it.
export async function runBackupLoop({config = backupConfig(), signal, backup = createBackup,
  wait = (ms, signal) => sleep(ms, undefined, {signal}), log = console.log} = {}) {
  while (!signal?.aborted) {
    const filename = await backup(config);
    log(`Backup complete: ${filename}`);
    if (signal?.aborted) break;
    try { await wait(config.intervalMs, signal); }
    catch (error) { if (signal?.aborted && error.name === 'AbortError') break; throw error; }
  }
}

if (isMain(import.meta.url)) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try { await runBackupLoop({signal: controller.signal}); }
  catch (error) { console.error(`Backup service failed: ${error.message}`); process.exitCode = 1; }
  finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}
