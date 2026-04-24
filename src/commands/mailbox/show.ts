import {
  createGitHubSignalClient,
  GitHubAuthError,
  GitHubConfigError,
} from '../../core/github.js';
import type {
  GitHubSignalClient,
  MailboxShowResult,
} from '../../core/types.js';
import {
  ensureConfig,
  ensureWorkspaceStructure,
  findWorkspaceRoot,
  getWorkspacePaths,
  WorkspaceNotFoundError,
} from '../../core/workspace.js';

export interface MailboxShowCommandOptions {
  cwd?: string;
}

export async function mailboxShowCommand(
  threadId: string,
  options: MailboxShowCommandOptions = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  const githubClient = dependencies.githubClient ?? createGitHubSignalClient();

  try {
    const workspaceRoot = await findWorkspaceRoot(options.cwd);
    const paths = getWorkspacePaths(workspaceRoot);

    await ensureWorkspaceStructure(paths);
    const config = await ensureConfig(paths);

    const authStatus = await githubClient.getAuthStatus(paths);

    if (authStatus.kind !== 'authenticated') {
      throw new GitHubAuthError(authStatus.detail);
    }

    const detail = await githubClient.getMailboxThreadDetail(paths, threadId);
    const relatedCards = await githubClient.listRelatedMailboxCards(
      paths,
      config,
      detail.subject.url,
    );

    const result: MailboxShowResult = {
      threadId: detail.id,
      repositoryFullName: detail.repositoryFullName,
      title: detail.subject.title,
      reason: detail.reason,
      type: detail.subject.type,
      unread: detail.isUnread,
      updatedAt: detail.updatedAt,
      sourceUrl: detail.subject.url,
      relatedCards,
    };

    console.log(JSON.stringify(result, null, 2));
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
