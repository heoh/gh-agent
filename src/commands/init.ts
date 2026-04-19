import {
  ensureConfig,
  ensureSessionState,
  ensureWorkspaceStructure,
  getWorkspacePaths,
  pathExists,
} from '../core/workspace.js';

export async function initCommand(): Promise<void> {
  const paths = getWorkspacePaths();

  await ensureWorkspaceStructure(paths);

  const hadConfig = await pathExists(paths.configFile);
  const config = await ensureConfig(paths);

  const hadState = await pathExists(paths.stateFile);
  await ensureSessionState(paths, config.agentId);

  console.log('Initialized gh-agent workspace');
  console.log(`Workspace: ${paths.root}`);
  console.log(hadConfig ? 'Kept existing config.json' : 'Created config.json');
  console.log(hadState ? 'Kept existing .gh-agent/session_state.json' : 'Created .gh-agent/session_state.json');
  console.log('Ensured work/ and .gh-agent/ directories');
  console.log('Next: gh-agent status');
  console.log('Next: gh-agent run');
}