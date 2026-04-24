import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { setupWorkspaceTest } from '../test/test-helpers.js';
import {
  createInitialSessionState,
  ensureConfig,
  ensureSessionState,
  ensureWorkspaceStructure,
  findWorkspaceRoot,
  getWorkspacePaths,
  WorkspaceNotFoundError,
} from './workspace.js';

const { getWorkspaceRoot } = setupWorkspaceTest();

describe('workspace normalization', () => {
  it('creates default config and initial session state when files are missing', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);

    const config = await ensureConfig(paths);
    const state = await ensureSessionState(paths, config.agentId);

    expect(paths.configFile).toBe(
      `${getWorkspaceRoot()}/.gh-agent/config.json`,
    );
    expect(config).toEqual({
      agentId: 'gh-agent',
      defaultAgentCommand: 'codex exec --full-auto "$prompt"',
      heavyAgentCommand: null,
      pollIntervalMs: 30_000,
      debounceMs: 60_000,
      projectId: null,
      projectTitle: null,
      projectUrl: null,
      projectFieldIds: {
        status: null,
        priority: null,
        type: null,
        executionClass: null,
        sourceLink: null,
        nextAction: null,
        shortNote: null,
      },
      projectStatusOptionIds: {
        ready: null,
        doing: null,
        waiting: null,
        done: null,
      },
      projectExecutionClassOptionIds: {
        light: null,
        heavy: null,
      },
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
        defaultAgentCommand: '',
        heavyAgentCommand: 123,
        pollIntervalMs: -1,
        debounceMs: 'invalid',
      }),
      'utf8',
    );

    const config = await ensureConfig(paths);

    expect(config).toEqual({
      agentId: 'custom-agent',
      defaultAgentCommand: 'codex exec --full-auto "$prompt"',
      heavyAgentCommand: null,
      pollIntervalMs: 30_000,
      debounceMs: 60_000,
      projectId: null,
      projectTitle: null,
      projectUrl: null,
      projectFieldIds: {
        status: null,
        priority: null,
        type: null,
        executionClass: null,
        sourceLink: null,
        nextAction: null,
        shortNote: null,
      },
      projectStatusOptionIds: {
        ready: null,
        doing: null,
        waiting: null,
        done: null,
      },
      projectExecutionClassOptionIds: {
        light: null,
        heavy: null,
      },
    });
  });

  it('recovers from malformed config JSON by rewriting defaults', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);
    await writeFile(paths.configFile, '{not valid json', 'utf8');

    const config = await ensureConfig(paths);

    expect(config).toEqual({
      agentId: 'gh-agent',
      defaultAgentCommand: 'codex exec --full-auto "$prompt"',
      heavyAgentCommand: null,
      pollIntervalMs: 30_000,
      debounceMs: 60_000,
      projectId: null,
      projectTitle: null,
      projectUrl: null,
      projectFieldIds: {
        status: null,
        priority: null,
        type: null,
        executionClass: null,
        sourceLink: null,
        nextAction: null,
        shortNote: null,
      },
      projectStatusOptionIds: {
        ready: null,
        doing: null,
        waiting: null,
        done: null,
      },
      projectExecutionClassOptionIds: {
        light: null,
        heavy: null,
      },
    });
  });

  it('preserves configured agent commands and clears an empty heavy command', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);
    await writeFile(
      paths.configFile,
      JSON.stringify({
        defaultAgentCommand: 'codex --profile default',
        heavyAgentCommand: '',
      }),
      'utf8',
    );

    const config = await ensureConfig(paths);

    expect(config.defaultAgentCommand).toBe('codex --profile default');
    expect(config.heavyAgentCommand).toBeNull();
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

  it('finds the workspace root from the workspace root itself', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);
    await ensureConfig(paths);

    await expect(findWorkspaceRoot(getWorkspaceRoot())).resolves.toBe(
      getWorkspaceRoot(),
    );
  });

  it('finds the nearest workspace root from a nested directory', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);
    await ensureConfig(paths);

    const nestedDir = path.join(getWorkspaceRoot(), 'work', 'triage', 'today');
    await mkdir(nestedDir, { recursive: true });

    await expect(findWorkspaceRoot(nestedDir)).resolves.toBe(
      getWorkspaceRoot(),
    );
  });

  it('fails when no workspace exists in current or parent directories', async () => {
    await expect(
      findWorkspaceRoot(path.join(getWorkspaceRoot(), 'outside')),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });
});
