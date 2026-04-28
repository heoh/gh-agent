import { readLockInfo } from '../core/lock.js';
import {
  getAgentPresetDefinition,
  inferAgentPresetIdFromCommand,
} from '../core/agent-presets.js';
import {
  createGitHubSignalClient,
  GitHubAuthError,
  GitHubConfigError,
} from '../core/github.js';
import type { GitHubSignalClient } from '../core/types.js';
import {
  ensureConfig,
  ensureSessionState,
  ensureWorkspaceStructure,
  findWorkspaceRoot,
  getWorkspacePaths,
  WorkspaceNotFoundError,
} from '../core/workspace.js';

function formatValue(label: string, value: string | number | null): string {
  return `${label}: ${value ?? '-'}`;
}

export async function statusCommand(
  options: {
    cwd?: string;
  } = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  try {
    const workspaceRoot = await findWorkspaceRoot(options.cwd);
    const paths = getWorkspacePaths(workspaceRoot);
    const githubClient =
      dependencies.githubClient ?? createGitHubSignalClient();

    await ensureWorkspaceStructure(paths);
    const config = await ensureConfig(paths);
    const state = await ensureSessionState(paths, config.agentId);
    const lock = await readLockInfo(paths.lockFile);
    const authStatus = await githubClient.getAuthStatus(paths);
    const signals =
      authStatus.kind === 'authenticated'
        ? await githubClient.getSignalSummary(paths, config)
        : null;
    const inferredPreset = inferAgentPresetIdFromCommand(
      config.defaultAgentCommand,
    );

    console.log(formatValue('Workspace', paths.root));
    console.log(formatValue('Config', paths.configFile));
    console.log(formatValue('Agent', config.agentId));
    console.log(
      formatValue(
        'Default agent preset',
        `${inferredPreset} (${getAgentPresetDefinition(inferredPreset).label})`,
      ),
    );
    console.log(
      formatValue('Default agent command', config.defaultAgentCommand),
    );
    console.log(formatValue('Project', config.projectTitle));
    console.log(formatValue('Project URL', config.projectUrl));
    console.log(formatValue('Mode', state.currentMode));
    console.log(
      formatValue(
        'Lock',
        lock === null ? 'unlocked' : `locked (pid ${lock.pid})`,
      ),
    );
    console.log(formatValue('Session', state.currentSessionId));
    console.log(formatValue('Next wake', state.nextWakeNotBefore));
    console.log(formatValue('Last poll', state.lastNotificationPollAt));
    console.log(
      formatValue('Last session started', state.lastSessionStartedAt),
    );
    console.log(formatValue('Last session ended', state.lastSessionEndedAt));
    console.log(
      formatValue('Unread notifications', signals?.unreadCount ?? null),
    );
    console.log(
      formatValue('Actionable cards', signals?.actionableCount ?? null),
    );
    console.log(formatValue('Actionable rule', 'Status in {Ready, Doing}'));
    console.log(formatValue('GH config dir', authStatus.ghConfigDir));
    console.log(formatValue('GitHub auth', authStatus.kind));
    console.log(formatValue('GitHub auth detail', authStatus.detail));
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
