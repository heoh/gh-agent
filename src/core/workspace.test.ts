import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { setupWorkspaceTest } from '../test/test-helpers.js';
import {
  createInitialSessionState,
  ensureConfig,
  ensureAgentsGuide,
  ensureSessionNoteTemplate,
  ensureSessionState,
  ensureWorkspaceStructure,
  findWorkspaceRoot,
  getWorkspacePaths,
  listRecentSessionNotes,
  WorkspaceNotFoundError,
} from './workspace.js';

const { getWorkspaceRoot } = setupWorkspaceTest();

describe('workspace normalization', () => {
  it('creates default config and initial session state when files are missing', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);

    const config = await ensureConfig(paths);
    const state = await ensureSessionState(paths, config.agentId);
    const stateGitignore = await readFile(paths.stateGitignoreFile, 'utf8');

    expect(paths.configFile).toBe(
      `${getWorkspaceRoot()}/.gh-agent/config.json`,
    );
    expect(stateGitignore).toBe('*\n!config.json\n');
    expect(config).toEqual({
      agentId: 'gh-agent',
      defaultAgentCommand:
        'codex exec --dangerously-bypass-approvals-and-sandbox "$prompt"',
      heavyAgentCommand: null,
      pollIntervalMs: 30_000,
      debounceMs: 60_000,
      promptMailboxSampleLimit: 20,
      promptTaskSampleLimit: 20,
      promptRecentTaskCardLimit: 5,
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

  it('normalizes partial config values and clamps fractional sample limits to at least one', async () => {
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
        promptMailboxSampleLimit: 0.5,
        promptTaskSampleLimit: 'invalid',
        promptRecentTaskCardLimit: 0.9,
      }),
      'utf8',
    );

    const config = await ensureConfig(paths);

    expect(config).toEqual({
      agentId: 'custom-agent',
      defaultAgentCommand:
        'codex exec --dangerously-bypass-approvals-and-sandbox "$prompt"',
      heavyAgentCommand: null,
      pollIntervalMs: 30_000,
      debounceMs: 60_000,
      promptMailboxSampleLimit: 1,
      promptTaskSampleLimit: 20,
      promptRecentTaskCardLimit: 1,
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
      defaultAgentCommand:
        'codex exec --dangerously-bypass-approvals-and-sandbox "$prompt"',
      heavyAgentCommand: null,
      pollIntervalMs: 30_000,
      debounceMs: 60_000,
      promptMailboxSampleLimit: 20,
      promptTaskSampleLimit: 20,
      promptRecentTaskCardLimit: 5,
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

  it('returns only the most recent three session notes by default', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);

    for (const sessionId of [
      'sess_1000',
      'sess_1001',
      'sess_1002',
      'sess_1003',
      'sess_1004',
    ]) {
      const notePath = await ensureSessionNoteTemplate(paths, sessionId);
      await writeFile(
        notePath,
        `# Session ${sessionId}\n\n## What changed\n- ${sessionId}\n`,
        'utf8',
      );
    }

    const notes = await listRecentSessionNotes(paths);

    expect(notes).toHaveLength(3);
    expect(notes.map((note) => note.sessionId)).toEqual([
      'sess_1004',
      'sess_1003',
      'sess_1002',
    ]);
  });

  it('creates AGENTS.md once and keeps existing content afterwards', async () => {
    const paths = getWorkspacePaths(getWorkspaceRoot());
    await ensureWorkspaceStructure(paths);

    const first = await ensureAgentsGuide(paths);
    const firstContent = await readFile(paths.agentsFile, 'utf8');
    expect(first.created).toBe(true);
    expect(firstContent).toContain('# AGENTS.md');
    expect(firstContent).toContain('## 기본 역할');

    await writeFile(paths.agentsFile, 'custom-agents', 'utf8');
    const second = await ensureAgentsGuide(paths);
    const secondContent = await readFile(paths.agentsFile, 'utf8');
    expect(second.created).toBe(false);
    expect(secondContent).toBe('custom-agents');
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
