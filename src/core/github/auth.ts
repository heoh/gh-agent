import { execFile, spawn } from 'node:child_process';

import type { GitHubAuthStatus, GitIdentity } from '../types.js';
import type { WorkspacePaths } from '../workspace.js';
import { GitHubAuthError, GitHubRuntimeError } from './errors.js';
import type { GhAuthClient } from './internal.js';

interface GhExecutionResult {
  stdout: string;
  stderr: string;
}

interface GhViewerProfile {
  id?: number;
  login?: string;
  name?: string | null;
  email?: string | null;
}

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
            /not logged into|authentication failed|failed to log in|invalid token|token .* invalid|run:\s+gh auth login|gh auth login|gh_token/i.test(
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

function runGhInteractiveCommand(
  args: string[],
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, {
      env: createGhEnvironment(paths),
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      reject(new GitHubRuntimeError(error.message));
    });

    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new GitHubRuntimeError(
          signal === null
            ? `gh ${args.join(' ')} exited with code ${code ?? 1}`
            : `gh ${args.join(' ')} exited with signal ${signal}`,
        ),
      );
    });
  });
}

class DefaultGhAuthClient implements GhAuthClient {
  async login(paths: Pick<WorkspacePaths, 'ghConfigDir'>): Promise<void> {
    await runGhInteractiveCommand(
      ['auth', 'login', '--hostname', 'github.com', '--scopes', 'project'],
      paths,
    );
  }

  async refreshProjectScopes(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  ): Promise<void> {
    await runGhInteractiveCommand(
      ['auth', 'refresh', '--hostname', 'github.com', '--scopes', 'project'],
      paths,
    );
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

  async getToken(paths: Pick<WorkspacePaths, 'ghConfigDir'>): Promise<string> {
    const { stdout } = await runGhCommand(
      ['auth', 'token', '--hostname', 'github.com'],
      paths,
    );
    const token = stdout.trim();

    if (token.length === 0) {
      throw new GitHubAuthError(
        'GitHub authentication token is empty. Run gh auth login.',
      );
    }

    return token;
  }

  async getGitIdentity(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  ): Promise<GitIdentity> {
    const { stdout } = await runGhCommand(
      ['api', '--hostname', 'github.com', 'user'],
      paths,
    );
    const profile = JSON.parse(stdout) as GhViewerProfile;
    const login =
      typeof profile.login === 'string' && profile.login.length > 0
        ? profile.login
        : null;

    if (login === null) {
      throw new GitHubRuntimeError(
        'GitHub account login could not be resolved for git identity.',
      );
    }

    const name =
      typeof profile.name === 'string' && profile.name.trim().length > 0
        ? profile.name.trim()
        : login;
    const email =
      typeof profile.email === 'string' && profile.email.trim().length > 0
        ? profile.email.trim()
        : typeof profile.id === 'number'
          ? `${profile.id}+${login}@users.noreply.github.com`
          : `${login}@users.noreply.github.com`;

    return {
      name,
      email,
    };
  }
}

export const defaultGhAuthClient = new DefaultGhAuthClient();
