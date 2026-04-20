import { execFile } from 'node:child_process';

import type {
  GitHubAuthStatus,
  GitHubSignalClient,
  SignalSummary,
} from './types.js';
import type { WorkspacePaths } from './workspace.js';

const ACTIONABLE_STATUS_NAMES = new Set(['Ready', 'Doing']);

interface GhExecutionResult {
  stdout: string;
  stderr: string;
}

interface NotificationThread {
  id?: string;
}

interface ProjectFieldValueNode {
  name?: string | null;
  field?: {
    name?: string | null;
  } | null;
}

interface ViewerProjectsResponse {
  data?: {
    viewer?: {
      projectsV2?: {
        nodes?: Array<{
          items?: {
            nodes?: Array<{
              fieldValues?: {
                nodes?: ProjectFieldValueNode[];
              } | null;
            }>;
          } | null;
        }>;
      } | null;
    } | null;
  };
}

export class GitHubAuthError extends Error {}

export class GitHubRuntimeError extends Error {}

function createGhEnvironment(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GH_CONFIG_DIR: paths.ghConfigDir,
  };
}

function runGhCommand(
  args: string[],
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
): Promise<GhExecutionResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      args,
      {
        env: createGhEnvironment(paths),
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          const stderrText = stderr.toString().trim();
          const message = stderrText.length > 0 ? stderrText : error.message;

          if (
            /not logged into|authentication failed|run:\s+gh auth login|gh auth login|gh_token/i.test(
              message,
            )
          ) {
            reject(new GitHubAuthError(message));
            return;
          }

          reject(new GitHubRuntimeError(message));
          return;
        }

        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
      },
    );
  });
}

function countUnreadNotifications(stdout: string): number {
  const parsed = JSON.parse(stdout) as
    | NotificationThread[]
    | NotificationThread[][];

  if (!Array.isArray(parsed)) {
    return 0;
  }

  if (parsed.every((item) => Array.isArray(item))) {
    return (parsed as NotificationThread[][]).reduce(
      (total, page) => total + page.length,
      0,
    );
  }

  return (parsed as NotificationThread[]).length;
}

function isActionableItem(
  fieldValues: ProjectFieldValueNode[] | undefined,
): boolean {
  return (
    fieldValues?.some(
      (fieldValue) =>
        fieldValue.field?.name === 'Status' &&
        typeof fieldValue.name === 'string' &&
        ACTIONABLE_STATUS_NAMES.has(fieldValue.name),
    ) ?? false
  );
}

function countActionableProjectItems(stdout: string): number {
  const parsed = JSON.parse(stdout) as ViewerProjectsResponse;
  const projects = parsed.data?.viewer?.projectsV2?.nodes ?? [];

  return projects.reduce((total, project) => {
    const items = project.items?.nodes ?? [];

    return (
      total +
      items.filter((item) => isActionableItem(item.fieldValues?.nodes)).length
    );
  }, 0);
}

async function getUnreadCount(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
): Promise<number> {
  const { stdout } = await runGhCommand(
    ['api', 'notifications?per_page=100', '--paginate', '--slurp'],
    paths,
  );

  return countUnreadNotifications(stdout);
}

async function getActionableCount(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
): Promise<number> {
  const query = `
    query ViewerProjects {
      viewer {
        projectsV2(first: 20) {
          nodes {
            items(first: 100) {
              nodes {
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field {
                        ... on ProjectV2SingleSelectField {
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const { stdout } = await runGhCommand(
    ['api', 'graphql', '-f', `query=${query}`],
    paths,
  );

  return countActionableProjectItems(stdout);
}

class DefaultGitHubSignalClient implements GitHubSignalClient {
  async getSignalSummary(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  ): Promise<SignalSummary> {
    const unreadCount = await getUnreadCount(paths);
    const actionableCount = await getActionableCount(paths);

    return {
      unreadCount,
      actionableCount,
    };
  }

  async getAuthStatus(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  ): Promise<GitHubAuthStatus> {
    try {
      await runGhCommand(['auth', 'status', '--hostname', 'github.com'], paths);

      return {
        kind: 'authenticated',
        detail: 'gh auth status succeeded for github.com',
        ghConfigDir: paths.ghConfigDir,
      };
    } catch (error) {
      if (error instanceof GitHubAuthError) {
        return {
          kind: 'unauthenticated',
          detail: error.message,
          ghConfigDir: paths.ghConfigDir,
        };
      }

      return {
        kind: 'unknown',
        detail:
          error instanceof Error
            ? error.message
            : 'unable to determine GitHub auth status',
        ghConfigDir: paths.ghConfigDir,
      };
    }
  }
}

export function createGitHubSignalClient(): GitHubSignalClient {
  return new DefaultGitHubSignalClient();
}
