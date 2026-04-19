import { open, readFile } from 'node:fs/promises';

import type { LockInfo } from './types.js';
import { pathExists, removeFileIfExists, writeJsonAtomic } from './workspace.js';

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'EPERM') {
      return true;
    }

    return false;
  }
}

export async function readLockInfo(lockFilePath: string): Promise<LockInfo | null> {
  if (!(await pathExists(lockFilePath))) {
    return null;
  }

  const raw = await readFile(lockFilePath, 'utf8');
  return JSON.parse(raw) as LockInfo;
}

export async function acquireLock(lockFilePath: string, workspacePath: string): Promise<LockInfo> {
  const lockInfo: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    workspacePath,
  };

  try {
    const handle = await open(lockFilePath, 'wx');
    await handle.writeFile(`${JSON.stringify(lockInfo, null, 2)}\n`, 'utf8');
    await handle.close();
    return lockInfo;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== 'EEXIST') {
      throw error;
    }
  }

  const existing = await readLockInfo(lockFilePath);

  if (existing !== null && isProcessAlive(existing.pid)) {
    throw new Error(`gh-agent is already running with pid ${existing.pid}.`);
  }

  await removeFileIfExists(lockFilePath);
  await writeJsonAtomic(lockFilePath, lockInfo);

  return lockInfo;
}

export async function releaseLock(lockFilePath: string): Promise<void> {
  await removeFileIfExists(lockFilePath);
}