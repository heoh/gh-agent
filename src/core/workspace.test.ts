import { readFile, writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { setupWorkspaceTest } from '../test/test-helpers.js';
import {
  createInitialSessionState,
  ensureConfig,
  ensureSessionState,
  ensureWorkspaceStructure,
  getWorkspacePaths,
} from './workspace.js';

const { getWorkspaceRoot } = setupWorkspaceTest();

describe('workspace normalization', () => {
  it('creates default config and initial session state when files are missing', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);

    const config = await ensureConfig(paths);
    const state = await ensureSessionState(paths, config.agentId);

    expect(config).toEqual({
      agentId: 'gh-agent',
      pollIntervalMs: 30_000,
      debounceMs: 60_000,
    });
    expect(state).toEqual({
      agentId: 'gh-agent',
      currentMode: 'sleeping',
      currentSessionId: null,
      nextWakeNotBefore: null,
      lastSessionStartedAt: null,
      lastSessionEndedAt: null,
      lastNotificationPollAt: null,
      lastSeenNotificationCursor: null,
    });
  });

  it('normalizes partial config values back to defaults', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);
    await writeFile(
      paths.configFile,
      JSON.stringify({
        agentId: 'custom-agent',
        pollIntervalMs: -1,
        debounceMs: 'invalid',
      }),
      'utf8',
    );

    const config = await ensureConfig(paths);

    expect(config).toEqual({
      agentId: 'custom-agent',
      pollIntervalMs: 30_000,
      debounceMs: 60_000,
    });
  });

  it('recovers from malformed config JSON by rewriting defaults', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);
    await writeFile(paths.configFile, '{not valid json', 'utf8');

    const config = await ensureConfig(paths);

    expect(config).toEqual({
      agentId: 'gh-agent',
      pollIntervalMs: 30_000,
      debounceMs: 60_000,
    });
  });

  it('rewrites legacy session state into the current schema', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);
    await writeFile(
      paths.stateFile,
      JSON.stringify({
        agentId: 'legacy-agent',
        currentMode: 'active',
        currentSessionId: 'sess_legacy',
        wakeDebounceUntil: '2026-04-17T17:10:00.000Z',
      }),
      'utf8',
    );

    const state = await ensureSessionState(paths, 'gh-agent');
    const saved = JSON.parse(await readFile(paths.stateFile, 'utf8')) as Record<
      string,
      unknown
    >;

    expect(state).toEqual({
      agentId: 'legacy-agent',
      currentMode: 'active',
      currentSessionId: 'sess_legacy',
      nextWakeNotBefore: '2026-04-17T17:10:00.000Z',
      lastSessionStartedAt: null,
      lastSessionEndedAt: null,
      lastNotificationPollAt: null,
      lastSeenNotificationCursor: null,
    });
    expect(saved).not.toHaveProperty('wakeDebounceUntil');
    expect(saved.nextWakeNotBefore).toBe('2026-04-17T17:10:00.000Z');
  });

  it('recovers from malformed session state by recreating defaults', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);
    await writeFile(paths.stateFile, '{not valid json', 'utf8');

    const state = await ensureSessionState(paths, 'gh-agent');

    expect(state).toEqual(createInitialSessionState('gh-agent'));
  });
});
