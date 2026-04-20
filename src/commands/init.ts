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
  console.log(
    `Config: ${hadConfig ? 'existing config.json kept' : 'config.json created'}`,
  );
  console.log(
    `Session state: ${hadState ? 'existing .gh-agent/session_state.json kept' : '.gh-agent/session_state.json created'}`,
  );
  console.log('Directories: work/ and .gh-agent/ ensured');
  console.log('Next steps: gh-agent status, gh-agent run');
}
