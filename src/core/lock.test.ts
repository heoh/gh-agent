import { writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { setupWorkspaceTest } from '../test/test-helpers.js';
import { acquireLock, readLockInfo, releaseLock } from './lock.js';
import { ensureWorkspaceStructure, getWorkspacePaths } from './workspace.js';

const { getWorkspaceRoot } = setupWorkspaceTest();

describe('lock handling', () => {
  it('acquires and releases a new lock', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);

    const lock = await acquireLock(paths.lockFile, getWorkspaceRoot());
    const savedLock = await readLockInfo(paths.lockFile);

    expect(lock.pid).toBe(process.pid);
    expect(savedLock?.workspacePath).toBe(getWorkspaceRoot());

    await releaseLock(paths.lockFile);

    expect(await readLockInfo(paths.lockFile)).toBeNull();
  });

  it('rejects a live lock from the current process', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);
    await writeFile(
      paths.lockFile,
      JSON.stringify({
        pid: process.pid,
        startedAt: '2026-04-17T17:00:00.000Z',
        workspacePath: getWorkspaceRoot(),
      }),
      'utf8',
    );

    await expect(
      acquireLock(paths.lockFile, getWorkspaceRoot()),
    ).rejects.toThrow(`gh-agent is already running with pid ${process.pid}.`);
  });

  it('replaces a stale or malformed lock file', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);
    await writeFile(paths.lockFile, '{"pid":"broken"}', 'utf8');

    const lock = await acquireLock(paths.lockFile, getWorkspaceRoot());

    expect(lock.pid).toBe(process.pid);
    expect(await readLockInfo(paths.lockFile)).toMatchObject({
      pid: process.pid,
      workspacePath: getWorkspaceRoot(),
    });
  });

  it('treats invalid lock JSON as absent lock info', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);
    await writeFile(paths.lockFile, '{not valid json', 'utf8');

    expect(await readLockInfo(paths.lockFile)).toBeNull();
  });
});
