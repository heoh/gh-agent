import { readFile, writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { readLockInfo } from '../core/lock.js';
import { GitHubAuthError } from '../core/github.js';
import { getWorkspacePaths } from '../core/workspace.js';
import type { GitHubSignalClient } from '../core/types.js';
import {
  captureConsoleLogs,
  setupWorkspaceTest,
} from '../test/test-helpers.js';
import { initCommand } from './init.js';
import { runCommand } from './run.js';
import { statusCommand } from './status.js';

const { getWorkspaceRoot } = setupWorkspaceTest();

function createGitHubClientStub(
  unreadCount: number,
  actionableCount: number,
): GitHubSignalClient {
  return {
    async getSignalSummary() {
      return {
        unreadCount,
        actionableCount,
      };
    },
    async getAuthStatus(paths) {
      return {
        kind: 'authenticated',
        detail: 'stubbed auth status',
        ghConfigDir: paths.ghConfigDir,
      };
    },
  };
}

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
    expect(logs).toContain('Config: .gh-agent/config.json created');
    expect(logs).toContain('Next steps: gh-agent status, gh-agent run');
  });

  it('statusCommand reads the current state and reports an unlocked workspace', async () => {
    const logs = captureConsoleLogs();

    await initCommand();
    await statusCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    expect(logs).toContain(`Workspace: ${getWorkspaceRoot()}`);
    expect(logs).toContain(
      `Config: ${getWorkspaceRoot()}/.gh-agent/config.json`,
    );
    expect(logs).toContain('Mode: sleeping');
    expect(logs).toContain('Lock: unlocked');
    expect(logs).toContain('Session: -');
    expect(logs.some((line) => line.startsWith('GH config dir: '))).toBe(true);
    expect(logs).toContain('GitHub auth: authenticated');
  });

  it('runCommand wakes, persists state, records a decision, and releases the lock', async () => {
    const logs = captureConsoleLogs();

    await initCommand();
    await runCommand({
      githubClient: createGitHubClientStub(1, 0),
    });

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
    expect(typeof state.lastNotificationPollAt).toBe('string');
    expect(typeof state.lastSessionStartedAt).toBe('string');
    expect(typeof state.lastSessionEndedAt).toBe('string');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].shouldWake).toBe(true);
    expect(typeof decisions[0].createdSessionId).toBe('string');
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

    await runCommand({
      githubClient: createGitHubClientStub(1, 0),
    });

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

  it('runCommand maps GitHub authentication failures to exit code 3', async () => {
    await initCommand();

    await expect(
      runCommand({
        githubClient: {
          async getSignalSummary() {
            throw new GitHubAuthError('gh auth login required');
          },
          async getAuthStatus(paths) {
            return {
              kind: 'unauthenticated',
              detail: 'gh auth login required',
              ghConfigDir: paths.ghConfigDir,
            };
          },
        },
      }),
    ).rejects.toMatchObject({
      message: 'GitHub authentication error: gh auth login required',
      exitCode: 3,
    });
  });
});
