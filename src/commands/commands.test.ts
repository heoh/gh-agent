import { readFile, writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { readLockInfo } from '../core/lock.js';
import {
  GitHubAuthError,
  GitHubBootstrapError,
  GitHubConfigError,
} from '../core/github.js';
import { getWorkspacePaths } from '../core/workspace.js';
import type {
  EnsuredGitHubProject,
  GitHubSignalClient,
} from '../core/types.js';
import {
  captureConsoleLogs,
  setupWorkspaceTest,
} from '../test/test-helpers.js';
import { initCommand } from './init.js';
import { mailboxListCommand } from './mailbox/list.js';
import { runCommand } from './run.js';
import { statusCommand } from './status.js';

const { getWorkspaceRoot } = setupWorkspaceTest();

function createGitHubClientStub(
  unreadCount: number,
  actionableCount: number,
): GitHubSignalClient {
  return {
    async login() {
      return;
    },
    async refreshProjectScopes() {
      return;
    },
    async ensureProject() {
      return createEnsuredProjectStub();
    },
    async getSignalSummary(_paths, config) {
      expect(config.projectId).toBe('proj_123');
      return {
        unreadCount,
        actionableCount,
      };
    },
    async listMailboxNotifications(_paths, options) {
      const notifications = [
        {
          id: 'thread_1',
          repositoryFullName: 'acme/widgets',
          title: 'Add mailbox list command',
          reason: 'review_requested',
          type: 'PullRequest',
          updatedAt: '2026-04-20T10:00:00.000Z',
        },
        {
          id: 'thread_2',
          repositoryFullName: 'acme/docs',
          title: 'Triage docs cleanup',
          reason: 'mention',
          type: 'Issue',
          updatedAt: '2026-04-21T10:00:00.000Z',
        },
      ];

      return notifications.slice(0, options?.limit ?? notifications.length);
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

function createEnsuredProjectStub(
  overrides: Partial<EnsuredGitHubProject> = {},
): EnsuredGitHubProject {
  return {
    wasCreated: true,
    projectId: 'proj_123',
    projectTitle: 'gh-agent',
    projectUrl: 'https://github.com/users/test/projects/1',
    projectFieldIds: {
      status: 'field_status',
      priority: 'field_priority',
      type: 'field_type',
      sourceLink: 'field_source_link',
      nextAction: 'field_next_action',
      shortNote: 'field_short_note',
    },
    projectStatusOptionIds: {
      ready: 'status_ready',
      doing: 'status_doing',
      waiting: 'status_waiting',
      done: 'status_done',
    },
    ...overrides,
  };
}

describe('commands', () => {
  it('initCommand creates the workspace files, bootstraps the project, and prints the next steps', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    const paths = getWorkspacePaths(getWorkspaceRoot());
    const config = JSON.parse(
      await readFile(paths.configFile, 'utf8'),
    ) as Record<string, unknown>;
    const state = JSON.parse(await readFile(paths.stateFile, 'utf8')) as Record<
      string,
      unknown
    >;

    expect(config.agentId).toBe('gh-agent');
    expect(config.projectId).toBe('proj_123');
    expect(config.projectTitle).toBe('gh-agent');
    expect(state.currentMode).toBe('sleeping');
    expect(logs).toContain('Ensuring GitHub Project...');
    expect(logs).toContain('Initialized gh-agent workspace');
    expect(logs).toContain('Config: .gh-agent/config.json created');
    expect(logs).toContain('GitHub Project: created gh-agent');
    expect(logs).toContain(
      'Project schema: Status is single-select; Priority, Type, Source Link, Next Action, and Short Note are text fields',
    );
    expect(logs).toContain('Next steps: gh-agent status, gh-agent run');
  });

  it('statusCommand reads the current state and reports an unlocked workspace', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await statusCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    expect(logs).toContain(`Workspace: ${getWorkspaceRoot()}`);
    expect(logs).toContain(
      `Config: ${getWorkspaceRoot()}/.gh-agent/config.json`,
    );
    expect(logs).toContain('Mode: sleeping');
    expect(logs).toContain('Project: gh-agent');
    expect(logs).toContain(
      'Project URL: https://github.com/users/test/projects/1',
    );
    expect(logs).toContain('Unread notifications: 0');
    expect(logs).toContain('Actionable cards: 0');
    expect(logs).toContain('Actionable rule: Status in {Ready, Doing}');
    expect(logs).toContain('Lock: unlocked');
    expect(logs).toContain('Session: -');
    expect(logs.some((line) => line.startsWith('GH config dir: '))).toBe(true);
    expect(logs).toContain('GitHub auth: authenticated');
  });

  it('runCommand wakes, persists state, records a decision, and releases the lock', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
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

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
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

  it('mailboxListCommand prints JSON with one object per line by default', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await mailboxListCommand(
      {},
      {
        githubClient: createGitHubClientStub(0, 0),
      },
    );

    expect(logs).toContain(`[
  {"id":"thread_1","repositoryFullName":"acme/widgets","title":"Add mailbox list command","reason":"review_requested","type":"PullRequest","updatedAt":"2026-04-20T10:00:00.000Z"},
  {"id":"thread_2","repositoryFullName":"acme/docs","title":"Triage docs cleanup","reason":"mention","type":"Issue","updatedAt":"2026-04-21T10:00:00.000Z"}
]`);
  });

  it('mailboxListCommand respects the limit option', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await mailboxListCommand(
      { limit: 1 },
      {
        githubClient: createGitHubClientStub(0, 0),
      },
    );

    expect(logs).toContain(
      `[
  {"id":"thread_1","repositoryFullName":"acme/widgets","title":"Add mailbox list command","reason":"review_requested","type":"PullRequest","updatedAt":"2026-04-20T10:00:00.000Z"}
]`,
    );
  });

  it('mailboxListCommand prints an empty JSON array when no unread notifications exist', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await mailboxListCommand(
      {},
      {
        githubClient: {
          ...createGitHubClientStub(0, 0),
          async listMailboxNotifications() {
            return [];
          },
        },
      },
    );

    expect(logs).toContain('[]');
  });

  it('initCommand reuses an existing gh-agent project without duplicating it', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: {
        ...createGitHubClientStub(0, 0),
        async ensureProject() {
          return createEnsuredProjectStub({ wasCreated: false });
        },
      },
    });

    expect(logs).toContain('GitHub Project: reused gh-agent');
  });

  it('initCommand starts gh auth login when the workspace is unauthenticated', async () => {
    const logs = captureConsoleLogs();
    let authChecks = 0;
    let loginCalled = false;

    await initCommand({
      githubClient: {
        ...createGitHubClientStub(0, 0),
        async login() {
          loginCalled = true;
        },
        async refreshProjectScopes() {
          return;
        },
        async getAuthStatus(paths) {
          authChecks += 1;

          return authChecks === 1
            ? {
                kind: 'unauthenticated' as const,
                detail: 'gh auth login required',
                ghConfigDir: paths.ghConfigDir,
              }
            : {
                kind: 'authenticated' as const,
                detail: 'stubbed auth status',
                ghConfigDir: paths.ghConfigDir,
              };
        },
      },
    });

    expect(loginCalled).toBe(true);
    expect(logs).toContain('GitHub CLI login required for this workspace');
    expect(logs).toContain('Starting gh auth login...');
  });

  it('initCommand maps GitHub authentication failures to exit code 3 when login does not authenticate the workspace', async () => {
    await expect(
      initCommand({
        githubClient: {
          ...createGitHubClientStub(0, 0),
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

  it('initCommand refreshes gh auth scopes when project access is missing', async () => {
    const logs = captureConsoleLogs();
    let refreshCalled = false;
    let ensureCalls = 0;

    await initCommand({
      githubClient: {
        ...createGitHubClientStub(0, 0),
        async refreshProjectScopes() {
          refreshCalled = true;
        },
        async ensureProject() {
          ensureCalls += 1;

          if (ensureCalls === 1) {
            throw new Error(
              "Your token has not been granted the required scopes to execute this query. The 'name' field requires one of the following scopes: ['read:project']",
            );
          }

          return createEnsuredProjectStub();
        },
      },
    });

    expect(refreshCalled).toBe(true);
    expect(ensureCalls).toBe(2);
    expect(logs).toContain(
      'GitHub Project scope is required for this workspace',
    );
    expect(logs).toContain('Refreshing gh auth scopes with project access...');
  });

  it('initCommand includes the failing bootstrap stage in the error message', async () => {
    await expect(
      initCommand({
        githubClient: {
          ...createGitHubClientStub(0, 0),
          async ensureProject() {
            throw new GitHubBootstrapError(
              'GitHub Project was created but could not be loaded yet: not found',
              'load_project',
            );
          },
        },
      }),
    ).rejects.toMatchObject({
      message:
        'GitHub Project bootstrap failed during load_project: GitHub Project was created but could not be loaded yet: not found',
      exitCode: 2,
    });
  });

  it('initCommand fails with exit code 2 when the existing Status field schema conflicts', async () => {
    await expect(
      initCommand({
        githubClient: {
          ...createGitHubClientStub(0, 0),
          async ensureProject() {
            throw new GitHubConfigError('Status field must be single-select');
          },
        },
      }),
    ).rejects.toMatchObject({
      message: 'Status field must be single-select',
      exitCode: 2,
    });
  });

  it('runCommand maps GitHub authentication failures to exit code 3', async () => {
    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    await expect(
      runCommand({
        githubClient: {
          async login() {
            return;
          },
          async refreshProjectScopes() {
            return;
          },
          async ensureProject() {
            return createEnsuredProjectStub();
          },
          async getSignalSummary() {
            throw new GitHubAuthError('gh auth login required');
          },
          async listMailboxNotifications() {
            return [];
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

  it('mailboxListCommand maps GitHub authentication failures to exit code 3', async () => {
    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    await expect(
      mailboxListCommand(
        {},
        {
          githubClient: {
            ...createGitHubClientStub(0, 0),
            async getAuthStatus(paths) {
              return {
                kind: 'unauthenticated',
                detail: 'gh auth login required',
                ghConfigDir: paths.ghConfigDir,
              };
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      message: 'GitHub authentication error: gh auth login required',
      exitCode: 3,
    });
  });
});
