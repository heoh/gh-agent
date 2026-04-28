import { mkdir, readFile, writeFile } from 'node:fs/promises';

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
import { mailboxIgnoreCommand } from './mailbox/ignore.js';
import { mailboxListCommand } from './mailbox/list.js';
import {
  mailboxPromoteCommand,
  mailboxReadyCommand,
  parseMailboxPromotionStatusOption,
  mailboxWaitCommand,
} from './mailbox/promote.js';
import { mailboxShowCommand } from './mailbox/show.js';
import { runCommand } from './run.js';
import { statusCommand } from './status.js';
import { taskCreateCommand } from './task/create.js';
import {
  parseTaskExecutionClassOption,
  parseTaskPriorityOption,
  parseTaskStatusFilterOption,
  parseTaskStatusOption,
  parseTaskTypeOption,
} from './task/common.js';
import { taskListCommand } from './task/list.js';
import { taskShowCommand } from './task/show.js';
import {
  taskDoingCommand,
  taskDoneCommand,
  taskReadyCommand,
  taskWaitCommand,
} from './task/status.js';
import { taskUpdateCommand } from './task/update.js';

const { getWorkspaceRoot } = setupWorkspaceTest();

function parseUntrustedContextJson(prompt: string): Record<string, unknown> {
  const match = prompt.match(
    /\[Untrusted Context\(JSON\)\][\s\S]*?```json\n([\s\S]*?)\n```/,
  );

  if (!match) {
    throw new Error('Untrusted context JSON block not found');
  }

  return JSON.parse(match[1]) as Record<string, unknown>;
}

function createTaskFixture(taskId: string) {
  return {
    id: taskId,
    projectId: 'proj_123',
    title:
      taskId === 'item_2' ? 'Triage docs cleanup' : 'Add mailbox list command',
    updatedAt:
      taskId === 'item_2'
        ? '2026-04-21T10:00:00.000Z'
        : '2026-04-20T10:00:00.000Z',
    status: taskId === 'item_2' ? ('waiting' as const) : ('ready' as const),
    priority: taskId === 'item_2' ? ('P3' as const) : ('P1' as const),
    type:
      taskId === 'item_2' ? ('interaction' as const) : ('execution' as const),
    executionClass:
      taskId === 'item_2' ? ('heavy' as const) : ('light' as const),
    sourceLink:
      taskId === 'item_2'
        ? 'https://github.com/acme/docs/issues/2'
        : 'https://github.com/acme/widgets/pull/1',
    nextAction:
      taskId === 'item_2'
        ? 'Reply after docs review'
        : 'Implement the task command set',
    shortNote:
      taskId === 'item_2'
        ? 'Waiting on reviewer feedback'
        : 'High-priority execution task',
  };
}

interface SessionExecuteInput {
  command: string;
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

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
    async getMailboxThreadDetail(_paths, threadId) {
      return {
        id: threadId,
        repositoryFullName:
          threadId === 'thread_2' ? 'acme/docs' : 'acme/widgets',
        reason: threadId === 'thread_2' ? 'mention' : 'review_requested',
        isUnread: threadId !== 'thread_read',
        updatedAt:
          threadId === 'thread_2'
            ? '2026-04-21T10:00:00.000Z'
            : '2026-04-20T10:00:00.000Z',
        subject: {
          title:
            threadId === 'thread_2'
              ? 'Triage docs cleanup'
              : 'Add mailbox list command',
          type: threadId === 'thread_2' ? 'Issue' : 'PullRequest',
          url:
            threadId === 'thread_2'
              ? 'https://github.com/acme/docs/issues/2'
              : 'https://github.com/acme/widgets/pull/1',
        },
      };
    },
    async listRelatedMailboxCards(_paths, config, sourceUrl) {
      expect(config.projectId).toBe('proj_123');

      if (sourceUrl === 'https://github.com/acme/docs/issues/2') {
        return [];
      }

      return [
        {
          id: 'item_related_1',
          projectId: config.projectId as string,
          title: 'Add mailbox list command',
          sourceLink: 'https://github.com/acme/widgets/pull/1',
          status: 'ready',
        },
      ];
    },
    async promoteMailboxThread(_paths, config, target, status) {
      expect(config.projectId).toBe('proj_123');

      return {
        id: `item_${target.threadId}`,
        projectId: config.projectId as string,
        title: target.title,
        sourceLink: target.sourceUrl,
        status,
      };
    },
    async markMailboxThreadAsRead() {
      return;
    },
    async listTaskCards(_paths, config, filters) {
      expect(config.projectId).toBe('proj_123');

      const tasks = [createTaskFixture('item_1'), createTaskFixture('item_2')];

      return tasks
        .filter((task) => {
          if (
            Array.isArray(filters?.statuses) &&
            filters.statuses.length > 0 &&
            !filters.statuses.includes(task.status)
          ) {
            return false;
          }

          if (
            filters?.priority !== undefined &&
            task.priority !== filters.priority
          ) {
            return false;
          }

          if (filters?.type !== undefined && task.type !== filters.type) {
            return false;
          }

          if (
            filters?.executionClass !== undefined &&
            task.executionClass !== filters.executionClass
          ) {
            return false;
          }

          return true;
        })
        .map((task) => {
          const { projectId, ...taskWithoutProjectId } = task;
          void projectId;

          return taskWithoutProjectId;
        });
    },
    async getTaskCard(_paths, config, taskId) {
      expect(config.projectId).toBe('proj_123');

      if (taskId === 'missing_item') {
        throw new Error(
          `GitHub Project item "${taskId}" was not found in the configured project.`,
        );
      }

      return createTaskFixture(taskId);
    },
    async createTaskCard(_paths, config, input) {
      expect(config.projectId).toBe('proj_123');

      return {
        id: 'item_created',
        projectId: config.projectId as string,
        title: input.title,
        updatedAt: null,
        status: input.status,
        priority: input.priority ?? null,
        type: input.type ?? null,
        executionClass: input.executionClass ?? null,
        sourceLink: input.sourceLink ?? null,
        nextAction: input.nextAction ?? null,
        shortNote: input.shortNote ?? null,
      };
    },
    async updateTaskCard(_paths, config, taskId, input) {
      expect(config.projectId).toBe('proj_123');

      const definedUpdates = Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
      );

      return {
        ...createTaskFixture(taskId),
        ...definedUpdates,
      };
    },
    async setTaskCardStatus(_paths, config, taskId, status) {
      expect(config.projectId).toBe('proj_123');

      return {
        ...createTaskFixture(taskId),
        status,
      };
    },
    async getAuthStatus(paths) {
      return {
        kind: 'authenticated',
        detail: 'stubbed auth status',
        ghConfigDir: paths.ghConfigDir,
      };
    },
    async getGitIdentity() {
      return {
        login: 'test-user',
        name: 'Test User',
        email: '123+test-user@users.noreply.github.com',
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
      executionClass: 'field_execution_class',
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
    projectExecutionClassOptionIds: {
      light: 'execution_class_light',
      heavy: 'execution_class_heavy',
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
    const gitConfig = await readFile(paths.gitConfigGlobalFile, 'utf8');
    const stateGitignore = await readFile(paths.stateGitignoreFile, 'utf8');

    expect(config.agentId).toBe('gh-agent');
    expect(config.defaultAgentCommand).toBe(
      'codex exec --config sandbox_workspace_write.network_access=true --full-auto "$prompt"',
    );
    expect(config.projectId).toBe('proj_123');
    expect(config.projectTitle).toBe('gh-agent');
    expect(config.promptRecentTaskCardLimit).toBe(5);
    expect(state.currentMode).toBe('sleeping');
    expect(gitConfig).toContain('[user]');
    expect(gitConfig).toContain('name = Test User');
    expect(gitConfig).toContain(
      'email = 123+test-user@users.noreply.github.com',
    );
    expect(stateGitignore).toBe('*\n!config.json\n');
    expect(logs).toContain('Ensuring GitHub Project...');
    expect(logs).toContain('Initialized gh-agent workspace');
    expect(logs).toContain('Config: .gh-agent/config.json created');
    expect(logs).toContain('AGENTS.md: created');
    expect(logs).toContain('Default agent preset: OpenAI Codex CLI');
    expect(logs).toContain(
      'Default agent command: codex exec --config sandbox_workspace_write.network_access=true --full-auto "$prompt"',
    );
    expect(logs).toContain('GitHub Project: created gh-agent');
    expect(logs).toContain(
      'Project schema: Status and Execution Class are single-select; Priority, Type, Source Link, Next Action, and Short Note are text fields',
    );
    expect(logs).toContain('Next steps: gh-agent status, gh-agent run');
    const agentsFile = await readFile(paths.agentsFile, 'utf8');
    expect(agentsFile).toContain('# AGENTS.md');
    expect(agentsFile).toContain('## Core Role');
  });

  it('initCommand persists an explicit built-in preset choice for the default agent command', async () => {
    await initCommand(
      {
        agentPreset: 'gemini',
      },
      {
        githubClient: createGitHubClientStub(0, 0),
      },
    );

    const paths = getWorkspacePaths(getWorkspaceRoot());
    const config = JSON.parse(
      await readFile(paths.configFile, 'utf8'),
    ) as Record<string, unknown>;

    expect(config.defaultAgentCommand).toBe('gemini -p "$prompt"');
  });

  it('initCommand accepts a custom default agent command when it includes the prompt placeholder', async () => {
    await initCommand(
      {
        customCommand: 'my-agent --headless "$prompt"',
      },
      {
        githubClient: createGitHubClientStub(0, 0),
      },
    );

    const paths = getWorkspacePaths(getWorkspaceRoot());
    const config = JSON.parse(
      await readFile(paths.configFile, 'utf8'),
    ) as Record<string, unknown>;

    expect(config.defaultAgentCommand).toBe('my-agent --headless "$prompt"');
  });

  it('statusCommand reads the current state and reports an unlocked workspace', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await statusCommand(
      {},
      {
        githubClient: createGitHubClientStub(0, 0),
      },
    );

    expect(logs).toContain(`Workspace: ${getWorkspaceRoot()}`);
    expect(logs).toContain(
      `Config: ${getWorkspaceRoot()}/.gh-agent/config.json`,
    );
    expect(logs).toContain('Default agent preset: codex (OpenAI Codex CLI)');
    expect(logs).toContain(
      'Default agent command: codex exec --config sandbox_workspace_write.network_access=true --full-auto "$prompt"',
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

  it('statusCommand resolves the nearest workspace root from nested directories', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    const nestedCwd = `${getWorkspaceRoot()}/work/acme/widgets`;
    await mkdir(nestedCwd, { recursive: true });

    await statusCommand(
      { cwd: nestedCwd },
      {
        githubClient: createGitHubClientStub(0, 0),
      },
    );

    expect(logs).toContain(`Workspace: ${getWorkspaceRoot()}`);
  });

  it('runCommand wakes, persists state, records a decision, and releases the lock', async () => {
    const logs = captureConsoleLogs();
    let executeInput: SessionExecuteInput = {
      command: '',
      prompt: '',
      cwd: '',
      env: {},
    };
    let didCaptureExecuteInput = false;

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await runCommand(
      {},
      {
        githubClient: createGitHubClientStub(1, 0),
        maxPollCycles: 1,
        async executeAgentSession(input) {
          executeInput = input;
          didCaptureExecuteInput = true;
          return 0;
        },
      },
    );

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
    expect(decisions[0].selectedAgentClass).toBe('default');
    expect(decisions[0].executedAgentClass).toBe('default');
    expect(decisions[0].sessionExitCode).toBe(0);
    expect(didCaptureExecuteInput).toBe(true);
    expect(executeInput.env.CODEX_HOME).toBe(paths.root);
    expect(executeInput.env.GH_AGENT_HOME).toBe(paths.root);
    expect(executeInput.env.GH_CONFIG_DIR).toBe(paths.ghConfigDir);
    expect(executeInput.env.GIT_CONFIG_GLOBAL).toBe(paths.gitConfigGlobalFile);
    expect(await readLockInfo(paths.lockFile)).toBeNull();
    expect(logs.some((line) => line.startsWith('Session started: sess_'))).toBe(
      true,
    );
    expect(logs).toContain('Session ended');
  });

  it('runCommand resolves the nearest workspace root from nested directories', async () => {
    let executeInput: SessionExecuteInput = {
      command: '',
      prompt: '',
      cwd: '',
      env: {},
    };

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    const nestedCwd = `${getWorkspaceRoot()}/work/acme/widgets`;
    await mkdir(nestedCwd, { recursive: true });

    await runCommand(
      { cwd: nestedCwd },
      {
        githubClient: createGitHubClientStub(1, 0),
        maxPollCycles: 1,
        async executeAgentSession(input) {
          executeInput = input;
          return 0;
        },
      },
    );

    const paths = getWorkspacePaths(getWorkspaceRoot());
    expect(executeInput.cwd).toBe(getWorkspaceRoot());
    expect(executeInput.env.GH_AGENT_HOME).toBe(paths.root);
    expect(executeInput.env.GH_CONFIG_DIR).toBe(paths.ghConfigDir);
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

    await runCommand(
      {},
      {
        githubClient: createGitHubClientStub(1, 0),
        maxPollCycles: 1,
        async executeAgentSession() {
          return 0;
        },
      },
    );

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

  it('runCommand records a session failure and still returns to sleeping mode', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await runCommand(
      {},
      {
        githubClient: createGitHubClientStub(1, 0),
        maxPollCycles: 1,
        async executeAgentSession() {
          throw new Error('spawn failed');
        },
      },
    );

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
    expect(decisions.at(-1)?.shouldWake).toBe(true);
    expect(decisions.at(-1)?.sessionExitCode).toBeNull();
    expect(logs.some((line) => line.includes('Session command failed'))).toBe(
      true,
    );
    expect(logs).toContain('Session ended');
  });

  it('runCommand injects recent updated task cards into prompt context', async () => {
    const prompts: string[] = [];

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    const paths = getWorkspacePaths(getWorkspaceRoot());
    await writeFile(
      paths.configFile,
      JSON.stringify({
        ...(JSON.parse(await readFile(paths.configFile, 'utf8')) as Record<
          string,
          unknown
        >),
        debounceMs: 0,
        promptMailboxSampleLimit: 1,
        promptTaskSampleLimit: 1,
        promptRecentTaskCardLimit: 1,
      }),
      'utf8',
    );

    await runCommand(
      {},
      {
        githubClient: createGitHubClientStub(1, 1),
        maxPollCycles: 1,
        async executeAgentSession(input) {
          prompts.push(input.prompt);
          return 0;
        },
      },
    );

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('[Session Mission]');
    expect(prompts[0]).toContain('[Untrusted Context(JSON)]');
    const payload = parseUntrustedContextJson(prompts[0]);
    expect(payload.sampleLimits).toMatchObject({
      mailbox: 1,
      actionableTasks: 1,
      recentUpdatedTaskCards: 1,
    });
    const recentUpdatedTaskCards = payload.recentUpdatedTaskCards as Array<
      Record<string, unknown>
    >;
    expect(recentUpdatedTaskCards[0]?.id).toBe('item_2');
    expect(recentUpdatedTaskCards[0]?.updatedAt).toBe(
      '2026-04-21T10:00:00.000Z',
    );
    expect(prompts[0]).not.toContain('[recent session notes');
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

  it('mailboxPromoteCommand promotes multiple threads and prints JSON results', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await mailboxPromoteCommand(
      ['thread_1', 'thread_2'],
      {},
      {
        githubClient: createGitHubClientStub(0, 0),
      },
    );

    expect(logs).toContain(`[
  {"threadId":"thread_1","status":"ready","ok":true,"card":{"id":"item_thread_1","projectId":"proj_123","title":"Add mailbox list command","sourceLink":"https://github.com/acme/widgets/pull/1","status":"ready"}},
  {"threadId":"thread_2","status":"ready","ok":true,"card":{"id":"item_thread_2","projectId":"proj_123","title":"Triage docs cleanup","sourceLink":"https://github.com/acme/docs/issues/2","status":"ready"}}
]`);
  });

  it('mailboxWaitCommand and mailboxReadyCommand force their status aliases', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await mailboxWaitCommand(
      ['thread_1'],
      {},
      {
        githubClient: createGitHubClientStub(0, 0),
      },
    );
    await mailboxReadyCommand(
      ['thread_2'],
      {},
      {
        githubClient: createGitHubClientStub(0, 0),
      },
    );

    expect(logs).toContain(`[
  {"threadId":"thread_1","status":"waiting","ok":true,"card":{"id":"item_thread_1","projectId":"proj_123","title":"Add mailbox list command","sourceLink":"https://github.com/acme/widgets/pull/1","status":"waiting"}}
]`);
    expect(logs).toContain(`[
  {"threadId":"thread_2","status":"ready","ok":true,"card":{"id":"item_thread_2","projectId":"proj_123","title":"Triage docs cleanup","sourceLink":"https://github.com/acme/docs/issues/2","status":"ready"}}
]`);
  });

  it('mailboxPromoteCommand processes every thread and fails after mixed results', async () => {
    const logs = captureConsoleLogs();
    const markedAsRead: string[] = [];

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    await expect(
      mailboxPromoteCommand(
        ['thread_1', 'thread_2'],
        {},
        {
          githubClient: {
            ...createGitHubClientStub(0, 0),
            async promoteMailboxThread(_paths, config, target, status) {
              if (target.threadId === 'thread_2') {
                throw new Error('promotion failed for thread_2');
              }

              return {
                id: `item_${target.threadId}`,
                projectId: config.projectId as string,
                title: target.title,
                sourceLink: target.sourceUrl,
                status,
              };
            },
            async markMailboxThreadAsRead(_paths, threadId) {
              markedAsRead.push(threadId);
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      message: 'One or more mailbox thread promotions failed.',
      exitCode: 1,
    });

    expect(markedAsRead).toEqual(['thread_1']);
    expect(logs).toContain(`[
  {"threadId":"thread_1","status":"ready","ok":true,"card":{"id":"item_thread_1","projectId":"proj_123","title":"Add mailbox list command","sourceLink":"https://github.com/acme/widgets/pull/1","status":"ready"}},
  {"threadId":"thread_2","status":"ready","ok":false,"error":"promotion failed for thread_2","errorCategory":"runtime"}
]`);
  });

  it('mailboxIgnoreCommand marks multiple threads as read and prints JSON results', async () => {
    const logs = captureConsoleLogs();
    const markedAsRead: string[] = [];

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await mailboxIgnoreCommand(
      ['thread_1', 'thread_2'],
      {},
      {
        githubClient: {
          ...createGitHubClientStub(0, 0),
          async markMailboxThreadAsRead(_paths, threadId) {
            markedAsRead.push(threadId);
          },
        },
      },
    );

    expect(markedAsRead).toEqual(['thread_1', 'thread_2']);
    expect(logs).toContain(`[
  {"threadId":"thread_1","ok":true,"read":true},
  {"threadId":"thread_2","ok":true,"read":true}
]`);
  });

  it('mailboxIgnoreCommand processes every thread and fails after mixed results', async () => {
    const logs = captureConsoleLogs();
    const markedAsRead: string[] = [];

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    await expect(
      mailboxIgnoreCommand(
        ['thread_1', 'thread_2'],
        {},
        {
          githubClient: {
            ...createGitHubClientStub(0, 0),
            async markMailboxThreadAsRead(_paths, threadId) {
              if (threadId === 'thread_2') {
                throw new Error('ignore failed for thread_2');
              }

              markedAsRead.push(threadId);
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      message: 'One or more mailbox thread ignores failed.',
      exitCode: 1,
    });

    expect(markedAsRead).toEqual(['thread_1']);
    expect(logs).toContain(`[
  {"threadId":"thread_1","ok":true,"read":true},
  {"threadId":"thread_2","ok":false,"error":"ignore failed for thread_2","errorCategory":"runtime"}
]`);
  });

  it('mailboxShowCommand prints thread details and related cards as JSON', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await mailboxShowCommand(
      'thread_1',
      {},
      {
        githubClient: createGitHubClientStub(0, 0),
      },
    );

    expect(logs).toContain(`{
  "threadId": "thread_1",
  "repositoryFullName": "acme/widgets",
  "title": "Add mailbox list command",
  "reason": "review_requested",
  "type": "PullRequest",
  "unread": true,
  "updatedAt": "2026-04-20T10:00:00.000Z",
  "sourceUrl": "https://github.com/acme/widgets/pull/1",
  "relatedCards": [
    {
      "id": "item_related_1",
      "projectId": "proj_123",
      "title": "Add mailbox list command",
      "sourceLink": "https://github.com/acme/widgets/pull/1",
      "status": "ready"
    }
  ]
}`);
  });

  it('mailboxShowCommand returns an empty relatedCards array when no exact match exists', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await mailboxShowCommand(
      'thread_2',
      {},
      {
        githubClient: createGitHubClientStub(0, 0),
      },
    );

    expect(logs).toContain(`{
  "threadId": "thread_2",
  "repositoryFullName": "acme/docs",
  "title": "Triage docs cleanup",
  "reason": "mention",
  "type": "Issue",
  "unread": true,
  "updatedAt": "2026-04-21T10:00:00.000Z",
  "sourceUrl": "https://github.com/acme/docs/issues/2",
  "relatedCards": []
}`);
  });

  it('taskListCommand prints compact JSON rows', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await taskListCommand({}, { githubClient: createGitHubClientStub(0, 0) });

    expect(JSON.parse(logs.at(-1) ?? '[]')).toEqual([
      {
        id: 'item_1',
        title: 'Add mailbox list command',
        updatedAt: '2026-04-20T10:00:00.000Z',
        status: 'ready',
        priority: 'P1',
        type: 'execution',
        executionClass: 'light',
        sourceLink: 'https://github.com/acme/widgets/pull/1',
        nextAction: 'Implement the task command set',
        shortNote: 'High-priority execution task',
      },
      {
        id: 'item_2',
        title: 'Triage docs cleanup',
        updatedAt: '2026-04-21T10:00:00.000Z',
        status: 'waiting',
        priority: 'P3',
        type: 'interaction',
        executionClass: 'heavy',
        sourceLink: 'https://github.com/acme/docs/issues/2',
        nextAction: 'Reply after docs review',
        shortNote: 'Waiting on reviewer feedback',
      },
    ]);
  });

  it('taskListCommand honors status, priority, type, and execution class filters', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await taskListCommand(
      {
        statuses: ['waiting'],
        priority: 'P3',
        type: 'interaction',
        executionClass: 'heavy',
      },
      { githubClient: createGitHubClientStub(0, 0) },
    );

    expect(JSON.parse(logs.at(-1) ?? '[]')).toEqual([
      {
        id: 'item_2',
        title: 'Triage docs cleanup',
        updatedAt: '2026-04-21T10:00:00.000Z',
        status: 'waiting',
        priority: 'P3',
        type: 'interaction',
        executionClass: 'heavy',
        sourceLink: 'https://github.com/acme/docs/issues/2',
        nextAction: 'Reply after docs review',
        shortNote: 'Waiting on reviewer feedback',
      },
    ]);
  });

  it('taskShowCommand prints full card JSON', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await taskShowCommand(
      'item_1',
      {},
      {
        githubClient: createGitHubClientStub(0, 0),
      },
    );

    expect(logs).toContain(`{
  "id": "item_1",
  "projectId": "proj_123",
  "title": "Add mailbox list command",
  "updatedAt": "2026-04-20T10:00:00.000Z",
  "status": "ready",
  "priority": "P1",
  "type": "execution",
  "executionClass": "light",
  "sourceLink": "https://github.com/acme/widgets/pull/1",
  "nextAction": "Implement the task command set",
  "shortNote": "High-priority execution task"
}`);
  });

  it('taskCreateCommand requires title and status and prints the created card JSON', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await taskCreateCommand(
      {
        title: 'Ship task commands',
        status: 'doing',
        priority: 'P1',
        type: 'execution',
        executionClass: 'heavy',
        sourceLink: 'https://github.com/acme/widgets/issues/9',
        nextAction: 'Finish the CLI wiring',
        shortNote: 'Created from command test',
      },
      { githubClient: createGitHubClientStub(0, 0) },
    );

    expect(logs).toContain(`{
  "id": "item_created",
  "projectId": "proj_123",
  "title": "Ship task commands",
  "updatedAt": null,
  "status": "doing",
  "priority": "P1",
  "type": "execution",
  "executionClass": "heavy",
  "sourceLink": "https://github.com/acme/widgets/issues/9",
  "nextAction": "Finish the CLI wiring",
  "shortNote": "Created from command test"
}`);
  });

  it('taskUpdateCommand patches only supplied fields', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await taskUpdateCommand(
      'item_1',
      {
        status: 'doing',
        nextAction: 'Write integration tests',
      },
      { githubClient: createGitHubClientStub(0, 0) },
    );

    expect(JSON.parse(logs.at(-1) ?? '{}')).toEqual({
      id: 'item_1',
      projectId: 'proj_123',
      title: 'Add mailbox list command',
      updatedAt: '2026-04-20T10:00:00.000Z',
      status: 'doing',
      priority: 'P1',
      type: 'execution',
      executionClass: 'light',
      sourceLink: 'https://github.com/acme/widgets/pull/1',
      nextAction: 'Write integration tests',
      shortNote: 'High-priority execution task',
    });
  });

  it('taskUpdateCommand errors when no update fields are supplied', async () => {
    await expect(taskUpdateCommand('item_1')).rejects.toMatchObject({
      message: 'At least one task field option must be provided for update.',
      exitCode: 1,
    });
  });

  it('task status commands update multiple ids and fail after mixed results', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    await expect(
      taskDoneCommand(
        ['item_1', 'item_2'],
        {},
        {
          githubClient: {
            ...createGitHubClientStub(0, 0),
            async setTaskCardStatus(_paths, config, taskId, status) {
              expect(config.projectId).toBe('proj_123');

              if (taskId === 'item_2') {
                throw new Error('status update failed for item_2');
              }

              return {
                ...createTaskFixture(taskId),
                status,
              };
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      message: 'One or more task status updates failed.',
      exitCode: 1,
    });

    expect(logs).toContain(`[
  {"taskId":"item_1","status":"done","ok":true,"task":{"id":"item_1","title":"Add mailbox list command","updatedAt":"2026-04-20T10:00:00.000Z","status":"done","priority":"P1","type":"execution","executionClass":"light","sourceLink":"https://github.com/acme/widgets/pull/1","nextAction":"Implement the task command set","shortNote":"High-priority execution task"}},
  {"taskId":"item_2","status":"done","ok":false,"error":"status update failed for item_2","errorCategory":"runtime"}
]`);
  });

  it('task status aliases force the requested statuses', async () => {
    const logs = captureConsoleLogs();

    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });
    await taskReadyCommand(
      ['item_1'],
      {},
      { githubClient: createGitHubClientStub(0, 0) },
    );
    await taskWaitCommand(
      ['item_1'],
      {},
      { githubClient: createGitHubClientStub(0, 0) },
    );
    await taskDoingCommand(
      ['item_1'],
      {},
      { githubClient: createGitHubClientStub(0, 0) },
    );

    const jsonOutputs = logs
      .filter((line) => line.startsWith('['))
      .map((line) => JSON.parse(line));

    expect(jsonOutputs).toEqual([
      [
        {
          taskId: 'item_1',
          status: 'ready',
          ok: true,
          task: {
            id: 'item_1',
            title: 'Add mailbox list command',
            updatedAt: '2026-04-20T10:00:00.000Z',
            status: 'ready',
            priority: 'P1',
            type: 'execution',
            executionClass: 'light',
            sourceLink: 'https://github.com/acme/widgets/pull/1',
            nextAction: 'Implement the task command set',
            shortNote: 'High-priority execution task',
          },
        },
      ],
      [
        {
          taskId: 'item_1',
          status: 'waiting',
          ok: true,
          task: {
            id: 'item_1',
            title: 'Add mailbox list command',
            updatedAt: '2026-04-20T10:00:00.000Z',
            status: 'waiting',
            priority: 'P1',
            type: 'execution',
            executionClass: 'light',
            sourceLink: 'https://github.com/acme/widgets/pull/1',
            nextAction: 'Implement the task command set',
            shortNote: 'High-priority execution task',
          },
        },
      ],
      [
        {
          taskId: 'item_1',
          status: 'doing',
          ok: true,
          task: {
            id: 'item_1',
            title: 'Add mailbox list command',
            updatedAt: '2026-04-20T10:00:00.000Z',
            status: 'doing',
            priority: 'P1',
            type: 'execution',
            executionClass: 'light',
            sourceLink: 'https://github.com/acme/widgets/pull/1',
            nextAction: 'Implement the task command set',
            shortNote: 'High-priority execution task',
          },
        },
      ],
    ]);
  });

  it('task option parsers reject unsupported values', () => {
    expect(() => parseTaskStatusOption('blocked')).toThrow(
      'The status must be one of "ready", "doing", "waiting", or "done".',
    );
    expect(() => parseTaskPriorityOption('P0')).toThrow(
      'The priority must be one of "P1", "P2", or "P3".',
    );
    expect(() => parseTaskTypeOption('analysis')).toThrow(
      'The type must be either "interaction" or "execution".',
    );
    expect(() => parseTaskExecutionClassOption('medium')).toThrow(
      'The execution class must be either "light" or "heavy".',
    );
    expect(parseTaskStatusFilterOption('ready,doing')).toEqual([
      'ready',
      'doing',
    ]);
  });

  it('parseMailboxPromotionStatusOption rejects unsupported statuses', () => {
    expect(() => parseMailboxPromotionStatusOption('done')).toThrow(
      'The --status option must be either "ready" or "waiting".',
    );
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
      runCommand(
        {},
        {
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
            async getMailboxThreadDetail() {
              throw new GitHubAuthError('gh auth login required');
            },
            async promoteMailboxThread() {
              throw new GitHubAuthError('gh auth login required');
            },
            async markMailboxThreadAsRead() {
              throw new GitHubAuthError('gh auth login required');
            },
            async listRelatedMailboxCards() {
              throw new GitHubAuthError('gh auth login required');
            },
            async listTaskCards() {
              throw new GitHubAuthError('gh auth login required');
            },
            async getTaskCard() {
              throw new GitHubAuthError('gh auth login required');
            },
            async createTaskCard() {
              throw new GitHubAuthError('gh auth login required');
            },
            async updateTaskCard() {
              throw new GitHubAuthError('gh auth login required');
            },
            async setTaskCardStatus() {
              throw new GitHubAuthError('gh auth login required');
            },
            async getAuthStatus(paths) {
              return {
                kind: 'unauthenticated',
                detail: 'gh auth login required',
                ghConfigDir: paths.ghConfigDir,
              };
            },
            async getGitIdentity() {
              throw new GitHubAuthError('gh auth login required');
            },
          },
          maxPollCycles: 1,
        },
      ),
    ).rejects.toMatchObject({
      message: 'GitHub authentication error: gh auth login required',
      exitCode: 3,
    });
  });

  it('statusCommand maps missing workspaces to exit code 2', async () => {
    await expect(
      statusCommand({
        cwd: '/tmp/definitely-not-a-gh-agent-workspace',
      }),
    ).rejects.toMatchObject({
      message:
        'No gh-agent workspace found in the current directory or its parent directories.',
      exitCode: 2,
    });
  });

  it('runCommand maps missing workspaces to exit code 2', async () => {
    await expect(
      runCommand({
        cwd: '/tmp/definitely-not-a-gh-agent-workspace',
      }),
    ).rejects.toMatchObject({
      message:
        'No gh-agent workspace found in the current directory or its parent directories.',
      exitCode: 2,
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

  it('mailboxPromoteCommand maps GitHub authentication failures to exit code 3', async () => {
    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    await expect(
      mailboxPromoteCommand(
        ['thread_1'],
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

  it('mailboxPromoteCommand maps missing workspaces to exit code 2', async () => {
    await expect(
      mailboxPromoteCommand(['thread_1'], {
        cwd: '/tmp/definitely-not-a-gh-agent-workspace',
      }),
    ).rejects.toMatchObject({
      message:
        'No gh-agent workspace found in the current directory or its parent directories.',
      exitCode: 2,
    });
  });

  it('mailboxIgnoreCommand maps GitHub authentication failures to exit code 3', async () => {
    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    await expect(
      mailboxIgnoreCommand(
        ['thread_1'],
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

  it('mailboxIgnoreCommand maps missing workspaces to exit code 2', async () => {
    await expect(
      mailboxIgnoreCommand(['thread_1'], {
        cwd: '/tmp/definitely-not-a-gh-agent-workspace',
      }),
    ).rejects.toMatchObject({
      message:
        'No gh-agent workspace found in the current directory or its parent directories.',
      exitCode: 2,
    });
  });

  it('mailboxShowCommand maps GitHub authentication failures to exit code 3', async () => {
    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    await expect(
      mailboxShowCommand(
        'thread_1',
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

  it('mailboxShowCommand maps missing workspaces to exit code 2', async () => {
    await expect(
      mailboxShowCommand('thread_1', {
        cwd: '/tmp/definitely-not-a-gh-agent-workspace',
      }),
    ).rejects.toMatchObject({
      message:
        'No gh-agent workspace found in the current directory or its parent directories.',
      exitCode: 2,
    });
  });

  it('task commands map GitHub authentication failures to exit code 3', async () => {
    await initCommand({
      githubClient: createGitHubClientStub(0, 0),
    });

    const authFailingClient: GitHubSignalClient = {
      ...createGitHubClientStub(0, 0),
      async getAuthStatus(paths) {
        return {
          kind: 'unauthenticated',
          detail: 'gh auth login required',
          ghConfigDir: paths.ghConfigDir,
        };
      },
    };

    await expect(
      taskListCommand({}, { githubClient: authFailingClient }),
    ).rejects.toMatchObject({
      message: 'GitHub authentication error: gh auth login required',
      exitCode: 3,
    });

    await expect(
      taskShowCommand('item_1', {}, { githubClient: authFailingClient }),
    ).rejects.toMatchObject({
      message: 'GitHub authentication error: gh auth login required',
      exitCode: 3,
    });
  });

  it('task commands map missing workspaces to exit code 2', async () => {
    await expect(
      taskListCommand({
        cwd: '/tmp/definitely-not-a-gh-agent-workspace',
      }),
    ).rejects.toMatchObject({
      message:
        'No gh-agent workspace found in the current directory or its parent directories.',
      exitCode: 2,
    });

    await expect(
      taskShowCommand('item_1', {
        cwd: '/tmp/definitely-not-a-gh-agent-workspace',
      }),
    ).rejects.toMatchObject({
      message:
        'No gh-agent workspace found in the current directory or its parent directories.',
      exitCode: 2,
    });
  });
});
