import { Octokit } from 'octokit';

import type { WorkspacePaths } from '../workspace.js';
import { GitHubAuthError, GitHubRuntimeError } from './errors.js';
import type {
  GhAuthClient,
  GitHubApiClient,
  NotificationSubjectResource,
  NotificationThread,
} from './internal.js';
import { defaultGhAuthClient } from './auth.js';

function extractGitHubErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }

  return 'Unknown GitHub error';
}

function isGitHubAuthFailure(error: unknown): boolean {
  if (error instanceof GitHubAuthError) {
    return true;
  }

  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;

    if (status === 401 || status === 403) {
      return true;
    }
  }

  return /not logged into|authentication failed|run:\s+gh auth login|gh auth login|gh_token|bad credentials|requires authentication/i.test(
    extractGitHubErrorMessage(error),
  );
}

function toGitHubApiError(
  error: unknown,
): GitHubAuthError | GitHubRuntimeError {
  if (error instanceof GitHubAuthError || error instanceof GitHubRuntimeError) {
    return error;
  }

  const message = extractGitHubErrorMessage(error);

  if (isGitHubAuthFailure(error)) {
    return new GitHubAuthError(message);
  }

  return new GitHubRuntimeError(message);
}

function getApiPathFromUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

class OctokitGitHubApiClient implements GitHubApiClient {
  private readonly octokitByConfigDir = new Map<string, Octokit>();

  constructor(private readonly authClient: GhAuthClient) {}

  private async getOctokit(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  ): Promise<Octokit> {
    const cached = this.octokitByConfigDir.get(paths.ghConfigDir);

    if (cached !== undefined) {
      return cached;
    }

    const token = await this.authClient.getToken(paths);
    const octokit = new Octokit({ auth: token });
    this.octokitByConfigDir.set(paths.ghConfigDir, octokit);

    return octokit;
  }

  private handleError(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    error: unknown,
  ): never {
    if (isGitHubAuthFailure(error)) {
      this.octokitByConfigDir.delete(paths.ghConfigDir);
    }

    throw toGitHubApiError(error);
  }

  async listUnreadNotifications(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  ): Promise<NotificationThread[]> {
    try {
      const octokit = await this.getOctokit(paths);

      return (await octokit.paginate('GET /notifications', {
        per_page: 100,
      })) as NotificationThread[];
    } catch (error) {
      this.handleError(paths, error);
    }
  }

  async getNotificationThread(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    threadId: string,
  ): Promise<NotificationThread> {
    try {
      const octokit = await this.getOctokit(paths);
      const response = await octokit.request(
        `GET /notifications/threads/${threadId}`,
      );

      return response.data as NotificationThread;
    } catch (error) {
      this.handleError(paths, error);
    }
  }

  async getResourceByUrl(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    url: string,
  ): Promise<NotificationSubjectResource> {
    try {
      const octokit = await this.getOctokit(paths);
      const response = await octokit.request(`GET ${getApiPathFromUrl(url)}`);

      return response.data as NotificationSubjectResource;
    } catch (error) {
      this.handleError(paths, error);
    }
  }

  async markMailboxThreadAsRead(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    threadId: string,
  ): Promise<void> {
    try {
      const octokit = await this.getOctokit(paths);

      await octokit.request(`PATCH /notifications/threads/${threadId}`);
    } catch (error) {
      this.handleError(paths, error);
    }
  }

  async graphql<T>(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    query: string,
    variables: Record<string, string> = {},
  ): Promise<T> {
    try {
      const octokit = await this.getOctokit(paths);
      const response = await octokit.graphql<unknown>(query, variables);

      if (
        typeof response === 'object' &&
        response !== null &&
        'data' in response
      ) {
        return response as T;
      }

      return {
        data: response,
      } as T;
    } catch (error) {
      this.handleError(paths, error);
    }
  }
}

export const defaultGitHubApiClient = new OctokitGitHubApiClient(
  defaultGhAuthClient,
);
