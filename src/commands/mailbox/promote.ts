import {
  createGitHubSignalClient,
  GitHubAuthError,
  GitHubConfigError,
} from '../../core/github.js';
import type {
  GitHubSignalClient,
  MailboxPromotionErrorResult,
  MailboxPromotionResult,
  MailboxPromotionStatus,
  MailboxPromotionTarget,
} from '../../core/types.js';
import {
  ensureConfig,
  ensureWorkspaceStructure,
  findWorkspaceRoot,
  getWorkspacePaths,
  WorkspaceNotFoundError,
} from '../../core/workspace.js';

export interface MailboxPromoteCommandOptions {
  status?: MailboxPromotionStatus;
  cwd?: string;
}

export function parseMailboxPromotionStatusOption(
  value: string,
): MailboxPromotionStatus {
  if (value !== 'ready' && value !== 'waiting') {
    throw new Error('The --status option must be either "ready" or "waiting".');
  }

  return value;
}

function formatPromotionResultsJson(results: MailboxPromotionResult[]): string {
  if (results.length === 0) {
    return '[]';
  }

  return `[\n  ${results.map((result) => JSON.stringify(result)).join(',\n  ')}\n]`;
}

function createFailureResult(
  threadId: string,
  status: MailboxPromotionStatus,
  error: unknown,
): MailboxPromotionErrorResult {
  if (error instanceof GitHubAuthError) {
    return {
      threadId,
      status,
      ok: false,
      error: error.message,
      errorCategory: 'auth',
    };
  }

  if (error instanceof GitHubConfigError) {
    return {
      threadId,
      status,
      ok: false,
      error: error.message,
      errorCategory: 'config',
    };
  }

  return {
    threadId,
    status,
    ok: false,
    error:
      error instanceof Error
        ? error.message
        : 'Unknown mailbox promotion error',
    errorCategory: 'runtime',
  };
}

async function promoteMailboxThreads(
  threadIds: string[],
  options: MailboxPromoteCommandOptions,
  dependencies: {
    githubClient: GitHubSignalClient;
  },
): Promise<MailboxPromotionResult[]> {
  const status = options.status ?? 'ready';
  const workspaceRoot = await findWorkspaceRoot(options.cwd);
  const paths = getWorkspacePaths(workspaceRoot);
  const githubClient = dependencies.githubClient;

  await ensureWorkspaceStructure(paths);
  const config = await ensureConfig(paths);
  const authStatus = await githubClient.getAuthStatus(paths);

  if (authStatus.kind !== 'authenticated') {
    throw new GitHubAuthError(authStatus.detail);
  }

  const results: MailboxPromotionResult[] = [];

  for (const threadId of threadIds) {
    try {
      const detail = await githubClient.getMailboxThreadDetail(paths, threadId);
      const target: MailboxPromotionTarget = {
        threadId,
        title: detail.subject.title,
        repositoryFullName: detail.repositoryFullName,
        sourceUrl: detail.subject.url,
      };
      const card = await githubClient.promoteMailboxThread(
        paths,
        config,
        target,
        status,
      );

      await githubClient.markMailboxThreadAsRead(paths, threadId);
      results.push({
        threadId,
        status,
        ok: true,
        card,
      });
    } catch (error) {
      results.push(createFailureResult(threadId, status, error));
    }
  }

  return results;
}

async function runMailboxPromotionCommand(
  threadIds: string[],
  options: MailboxPromoteCommandOptions,
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  const githubClient = dependencies.githubClient ?? createGitHubSignalClient();

  try {
    const results = await promoteMailboxThreads(threadIds, options, {
      githubClient,
    });

    console.log(formatPromotionResultsJson(results));

    if (results.some((result) => !result.ok)) {
      throw Object.assign(
        new Error('One or more mailbox thread promotions failed.'),
        { exitCode: 1 },
      );
    }
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      throw Object.assign(
        new Error(
          'No gh-agent workspace found in the current directory or its parent directories.',
        ),
        { exitCode: 2 },
      );
    }

    if (error instanceof GitHubAuthError) {
      throw Object.assign(
        new Error(`GitHub authentication error: ${error.message}`),
        { exitCode: 3 },
      );
    }

    if (error instanceof GitHubConfigError) {
      throw Object.assign(new Error(error.message), { exitCode: 2 });
    }

    throw error;
  }
}

export async function mailboxPromoteCommand(
  threadIds: string[],
  options: MailboxPromoteCommandOptions = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  await runMailboxPromotionCommand(threadIds, options, dependencies);
}

export async function mailboxWaitCommand(
  threadIds: string[],
  options: Omit<MailboxPromoteCommandOptions, 'status'> = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  await runMailboxPromotionCommand(
    threadIds,
    {
      ...options,
      status: 'waiting',
    },
    dependencies,
  );
}

export async function mailboxReadyCommand(
  threadIds: string[],
  options: Omit<MailboxPromoteCommandOptions, 'status'> = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  await runMailboxPromotionCommand(
    threadIds,
    {
      ...options,
      status: 'ready',
    },
    dependencies,
  );
}
