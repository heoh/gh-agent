import { readLockInfo } from '../core/lock.js';
import {
  ensureConfig,
  ensureSessionState,
  ensureWorkspaceStructure,
  getWorkspacePaths,
} from '../core/workspace.js';

function formatValue(label: string, value: string | number | null): string {
  return `${label}: ${value ?? '-'}`;
}

export async function statusCommand(): Promise<void> {
  const paths = getWorkspacePaths();

  await ensureWorkspaceStructure(paths);
  const config = await ensureConfig(paths);
  const state = await ensureSessionState(paths, config.agentId);
  const lock = await readLockInfo(paths.lockFile);

  console.log(formatValue('Workspace', paths.root));
  console.log(formatValue('Agent', config.agentId));
  console.log(formatValue('Mode', state.currentMode));
  console.log(formatValue('Lock', lock === null ? 'unlocked' : `locked (pid ${lock.pid})`));
  console.log(formatValue('Current session', state.currentSessionId));
  console.log(formatValue('Next wake not before', state.nextWakeNotBefore));
}