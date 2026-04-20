import { readLockInfo } from '../core/lock.js';
import { createGitHubSignalClient } from '../core/github.js';
import type { GitHubSignalClient } from '../core/types.js';
import {
  ensureConfig,
  ensureSessionState,
  ensureWorkspaceStructure,
  getWorkspacePaths,
} from '../core/workspace.js';

function formatValue(label: string, value: string | number | null): string {
  return `${label}: ${value ?? '-'}`;
}

export async function statusCommand(
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  const paths = getWorkspacePaths();
  const githubClient = dependencies.githubClient ?? createGitHubSignalClient();

  await ensureWorkspaceStructure(paths);
  const config = await ensureConfig(paths);
  const state = await ensureSessionState(paths, config.agentId);
  const lock = await readLockInfo(paths.lockFile);
  const authStatus = await githubClient.getAuthStatus(paths);

  console.log(formatValue('Workspace', paths.root));
  console.log(formatValue('Config', paths.configFile));
  console.log(formatValue('Agent', config.agentId));
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
  console.log(formatValue('Last session started', state.lastSessionStartedAt));
  console.log(formatValue('Last session ended', state.lastSessionEndedAt));
  console.log(formatValue('GH config dir', authStatus.ghConfigDir));
  console.log(formatValue('GitHub auth', authStatus.kind));
  console.log(formatValue('GitHub auth detail', authStatus.detail));
}
