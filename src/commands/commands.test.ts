import { readFile, writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { readLockInfo } from '../core/lock.js';
import { getWorkspacePaths } from '../core/workspace.js';
import {
  captureConsoleLogs,
  setupWorkspaceTest,
} from '../test/test-helpers.js';
import { initCommand } from './init.js';
import { runCommand } from './run.js';
import { statusCommand } from './status.js';

const { getWorkspaceRoot } = setupWorkspaceTest();

describe('commands', () => {
  it('initCommand creates the workspace files and prints the next steps', async () => {
    const logs = captureConsoleLogs();

    await initCommand();

    const paths = getWorkspacePaths(getWorkspaceRoot());
    const config = JSON.parse(
      await readFile(paths.configFile, 'utf8'),
    ) as Record<string, unknown>;
    const state = JSON.parse(await readFile(paths.stateFile, 'utf8')) as Record<
      string,
      unknown
    >;

    expect(config.agentId).toBe('gh-agent');
    expect(state.currentMode).toBe('sleeping');
    expect(logs).toContain('Initialized gh-agent workspace');
    expect(logs).toContain('Next steps: gh-agent status, gh-agent run');
  });

  it('statusCommand reads the current state and reports an unlocked workspace', async () => {
    const logs = captureConsoleLogs();

    await initCommand();
    await statusCommand();

    expect(logs).toContain(`Workspace: ${getWorkspaceRoot()}`);
    expect(logs).toContain('Mode: sleeping');
    expect(logs).toContain('Lock: unlocked');
    expect(logs).toContain('Session: -');
  });

  it('runCommand wakes, persists state, records a decision, and releases the lock', async () => {
    const logs = captureConsoleLogs();

    await initCommand();
    await runCommand();

    const paths = getWorkspacePaths(getWorkspaceRoot());
    const state = JSON.parse(await readFile(paths.stateFile, 'utf8')) as Record<
      string,
      unknown
    >;
    const decisions = (await readFile(paths.wakeDecisionsFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(state.currentMode).toBe('sleeping');
    expect(state.currentSessionId).toBeNull();
    expect(typeof state.nextWakeNotBefore).toBe('string');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].shouldWake).toBe(true);
    expect(await readLockInfo(paths.lockFile)).toBeNull();
    expect(logs).toContain('Polling started');
    expect(logs.some((line) => line.startsWith('Session started: sess_'))).toBe(
      true,
    );
    expect(logs).toContain('Session ended');
    expect(logs).toContain('Polling complete');
  });

  it('runCommand respects cooldown and still releases the lock', async () => {
    const logs = captureConsoleLogs();

    await initCommand();
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await writeFile(
      paths.stateFile,
      JSON.stringify({
        agentId: 'gh-agent',
        currentMode: 'sleeping',
        currentSessionId: null,
        nextWakeNotBefore: '2999-01-01T00:00:00.000Z',
      }),
      'utf8',
    );

    await runCommand();

    const decisions = (await readFile(paths.wakeDecisionsFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(decisions.at(-1)?.shouldWake).toBe(false);
    expect(decisions.at(-1)?.blockedByCooldown).toBe(true);
    expect(logs.some((line) => line.startsWith('Session started:'))).toBe(
      false,
    );
    expect(await readLockInfo(paths.lockFile)).toBeNull();
  });
});
