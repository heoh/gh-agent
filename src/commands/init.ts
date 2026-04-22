import {
  saveConfig,
  ensureConfig,
  ensureSessionState,
  ensureWorkspaceStructure,
  getWorkspacePaths,
  pathExists,
} from '../core/workspace.js';
import {
  createGitHubSignalClient,
  GitHubAuthError,
  GitHubBootstrapError,
  GitHubConfigError,
} from '../core/github.js';
import type { GitHubSignalClient } from '../core/types.js';

function isMissingProjectScopeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return /required scopes|read:project|scope.*project|project.*scope/i.test(
    message,
  );
}

export async function initCommand(
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  const paths = getWorkspacePaths();
  const githubClient = dependencies.githubClient ?? createGitHubSignalClient();

  await ensureWorkspaceStructure(paths);

  const hadConfig = await pathExists(paths.configFile);
  const config = await ensureConfig(paths);

  const hadState = await pathExists(paths.stateFile);
  await ensureSessionState(paths, config.agentId);

  try {
    let authStatus = await githubClient.getAuthStatus(paths);

    if (authStatus.kind === 'unauthenticated') {
      console.log('GitHub CLI login required for this workspace');
      console.log(`GitHub CLI config dir: ${paths.ghConfigDir}`);
      console.log('Starting gh auth login...');
      await githubClient.login(paths);
      authStatus = await githubClient.getAuthStatus(paths);
    }

    if (authStatus.kind !== 'authenticated') {
      throw new GitHubAuthError(authStatus.detail);
    }

    let project;

    console.log('Ensuring GitHub Project...');

    try {
      project = await githubClient.ensureProject(paths, 'gh-agent');
    } catch (error) {
      if (!isMissingProjectScopeError(error)) {
        throw error;
      }

      console.log('GitHub Project scope is required for this workspace');
      console.log('Refreshing gh auth scopes with project access...');
      await githubClient.refreshProjectScopes(paths);
      project = await githubClient.ensureProject(paths, 'gh-agent');
    }

    const updatedConfig = {
      ...config,
      projectId: project.projectId,
      projectTitle: project.projectTitle,
      projectUrl: project.projectUrl,
      projectFieldIds: project.projectFieldIds,
      projectStatusOptionIds: project.projectStatusOptionIds,
    };

    await saveConfig(paths, updatedConfig);

    console.log('Initialized gh-agent workspace');
    console.log(`Workspace: ${paths.root}`);
    console.log(
      `Config: ${hadConfig ? 'existing .gh-agent/config.json updated' : '.gh-agent/config.json created'}`,
    );
    console.log(
      `Session state: ${hadState ? 'existing .gh-agent/session_state.json kept' : '.gh-agent/session_state.json created'}`,
    );
    console.log(
      'Directories: work/, .gh-agent/, and .gh-agent/gh-config/ ensured',
    );
    console.log(`GitHub CLI config dir: ${paths.ghConfigDir}`);
    console.log(
      `GitHub Project: ${project.wasCreated ? 'created' : 'reused'} ${project.projectTitle}`,
    );
    console.log(`GitHub Project URL: ${project.projectUrl}`);
    console.log(
      'Project schema: Status is single-select; Priority, Type, Source Link, Next Action, and Short Note are text fields',
    );
    console.log('Next steps: gh-agent status, gh-agent run');
  } catch (error) {
    if (error instanceof GitHubAuthError) {
      throw Object.assign(
        new Error(`GitHub authentication error: ${error.message}`),
        { exitCode: 3 },
      );
    }

    if (error instanceof GitHubConfigError) {
      throw Object.assign(new Error(error.message), { exitCode: 2 });
    }

    if (error instanceof GitHubBootstrapError) {
      throw Object.assign(
        new Error(
          `GitHub Project bootstrap failed during ${error.stage}: ${error.message}`,
        ),
        { exitCode: 2 },
      );
    }

    throw error;
  }
}
