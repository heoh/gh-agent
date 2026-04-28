import { createInterface } from 'node:readline/promises';
import process from 'node:process';

import {
  ensureAgentsGuide,
  saveConfig,
  ensureConfig,
  ensureSessionState,
  saveWorkspaceGitIdentity,
  ensureWorkspaceStructure,
  getWorkspacePaths,
  pathExists,
} from '../core/workspace.js';
import {
  AGENT_DEFINITIONS,
  type AgentId,
  getAgentDefinition,
} from '../core/agents.js';
import {
  createGitHubSignalClient,
  GitHubAuthError,
  GitHubBootstrapError,
  GitHubConfigError,
} from '../core/github.js';
import type { GitHubSignalClient } from '../core/types.js';

export interface InitCommandOptions {
  agent?: AgentId;
  agentCommand?: string;
}

export interface InitCommandSelection {
  label: string;
  command: string;
}

export interface AgentPromptReadline {
  question(query: string): Promise<string>;
  close(): void;
}

interface InitCommandDependencies {
  githubClient?: GitHubSignalClient;
  isInteractive?: boolean;
  promptForSelection?: () => Promise<InitCommandSelection>;
}

function isInitCommandDependencies(
  value: InitCommandOptions | InitCommandDependencies,
): value is InitCommandDependencies {
  return (
    'githubClient' in value ||
    'isInteractive' in value ||
    'promptForSelection' in value
  );
}

function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

function mapAgentPromptError(error: unknown): never {
  if (
    error instanceof Error &&
    (error.name === 'ExitPromptError' || error.name === 'AbortError')
  ) {
    throw Object.assign(new Error('Agent selection was cancelled.'), {
      exitCode: 1,
    });
  }

  throw error;
}

function createPresetSelection(agentId: AgentId): InitCommandSelection {
  const agentDefinition = getAgentDefinition(agentId);

  return {
    label: `${agentDefinition.label} (${agentDefinition.id})`,
    command: agentDefinition.defaultAgentCommand,
  };
}

function createCustomCommandSelection(command: string): InitCommandSelection {
  return {
    label: `Custom command (${formatCommandPreview(command)})`,
    command,
  };
}

function formatCommandPreview(command: string): string {
  const normalized = command.trim().replace(/\s+/g, ' ');

  if (normalized.length <= 48) {
    return normalized;
  }

  return `${normalized.slice(0, 45)}...`;
}

export async function promptForCustomCommand(
  readline: AgentPromptReadline,
): Promise<InitCommandSelection> {
  console.log('Enter a one-line custom agent command.');

  while (true) {
    const command = (await readline.question('Command: ')).trim();

    if (command.length > 0) {
      return createCustomCommandSelection(command);
    }

    console.log('Please enter a non-empty command.');
  }
}

export async function selectAgentPrompt(): Promise<InitCommandSelection> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('Select the agent CLI for this workspace:');
    for (const [index, agent] of AGENT_DEFINITIONS.entries()) {
      console.log(`  ${index + 1}. ${agent.label} (${agent.id})`);
    }
    const customCommandIndex = AGENT_DEFINITIONS.length + 1;
    console.log(`  ${customCommandIndex}. Custom command`);

    while (true) {
      const answer = (await readline.question('Enter a number: ')).trim();

      if (answer.length === 0) {
        console.log('Please enter a number from the list.');
        continue;
      }

      const selectedIndex = Number.parseInt(answer, 10);

      if (
        Number.isFinite(selectedIndex) &&
        String(selectedIndex) === answer &&
        selectedIndex >= 1 &&
        selectedIndex <= AGENT_DEFINITIONS.length
      ) {
        return createPresetSelection(AGENT_DEFINITIONS[selectedIndex - 1].id);
      }

      if (
        Number.isFinite(selectedIndex) &&
        String(selectedIndex) === answer &&
        selectedIndex === customCommandIndex
      ) {
        return await promptForCustomCommand(readline);
      }

      console.log(`Please enter a number between 1 and ${customCommandIndex}.`);
    }
  } catch (error) {
    mapAgentPromptError(error);
  } finally {
    readline.close();
  }
}

function isMissingProjectScopeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return /required scopes|read:project|scope.*project|project.*scope/i.test(
    message,
  );
}

export async function initCommand(
  optionsOrDependencies: InitCommandOptions | InitCommandDependencies = {},
  dependenciesArg: InitCommandDependencies = {},
): Promise<void> {
  const options = isInitCommandDependencies(optionsOrDependencies)
    ? {}
    : optionsOrDependencies;
  const dependencies = isInitCommandDependencies(optionsOrDependencies)
    ? optionsOrDependencies
    : dependenciesArg;
  const paths = getWorkspacePaths();
  const githubClient = dependencies.githubClient ?? createGitHubSignalClient();
  await ensureWorkspaceStructure(paths);
  const hadConfig = await pathExists(paths.configFile);
  const config = await ensureConfig(paths);
  const isInteractive = dependencies.isInteractive ?? isInteractiveTerminal();
  const customAgentCommand =
    typeof options.agentCommand === 'string' ? options.agentCommand.trim() : '';
  const requestedSelection =
    customAgentCommand.length > 0
      ? createCustomCommandSelection(customAgentCommand)
      : options.agent !== undefined
        ? createPresetSelection(options.agent)
        : null;
  let selection: InitCommandSelection;

  if (requestedSelection !== null) {
    selection = requestedSelection;
  } else if (hadConfig) {
    selection = createCustomCommandSelection(config.defaultAgentCommand);
  } else if (isInteractive) {
    try {
      selection = await (
        dependencies.promptForSelection ?? selectAgentPrompt
      )();
    } catch (error) {
      mapAgentPromptError(error);
    }
  } else {
    throw Object.assign(
      new Error(
        'Non-interactive mode requires --agent or --agent-command. Re-run with gh-agent init --agent <name> or --agent-command "<command>".',
      ),
      { exitCode: 2 },
    );
  }

  const configWithSelectedAgent = {
    ...config,
    defaultAgentCommand: selection.command,
  };

  const hadState = await pathExists(paths.stateFile);
  await ensureSessionState(paths, configWithSelectedAgent.agentId);
  const agentsGuide = await ensureAgentsGuide(paths);

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
    const gitIdentity = await githubClient.getGitIdentity(paths);
    await saveWorkspaceGitIdentity(paths, gitIdentity);

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
      ...configWithSelectedAgent,
      projectId: project.projectId,
      projectTitle: project.projectTitle,
      projectUrl: project.projectUrl,
      projectFieldIds: project.projectFieldIds,
      projectStatusOptionIds: project.projectStatusOptionIds,
      projectExecutionClassOptionIds: project.projectExecutionClassOptionIds,
    };

    await saveConfig(paths, updatedConfig);

    console.log('Initialized gh-agent workspace');
    console.log(`Workspace: ${paths.root}`);
    console.log(
      `Config: ${hadConfig ? 'existing .gh-agent/config.json updated' : '.gh-agent/config.json created'}`,
    );
    console.log(`Agent: ${selection.label}`);
    console.log(
      `Session state: ${hadState ? 'existing .gh-agent/session_state.json kept' : '.gh-agent/session_state.json created'}`,
    );
    console.log(
      'Directories: work/, .gh-agent/, and .gh-agent/gh-config/ ensured',
    );
    console.log(
      `AGENTS.md: ${agentsGuide.created ? 'created' : 'existing file kept'}`,
    );
    console.log(`GitHub CLI config dir: ${paths.ghConfigDir}`);
    console.log(`Git identity: ${gitIdentity.name} <${gitIdentity.email}>`);
    console.log(
      `GitHub Project: ${project.wasCreated ? 'created' : 'reused'} ${project.projectTitle}`,
    );
    console.log(`GitHub Project URL: ${project.projectUrl}`);
    console.log(
      'Project schema: Status and Execution Class are single-select; Priority, Type, Source Link, Next Action, and Short Note are text fields',
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
