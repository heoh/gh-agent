import { createInterface } from 'node:readline/promises';
import { stdin as processStdin, stdout as processStdout } from 'node:process';

import {
  AGENT_PRESETS,
  AGENT_PROMPT_PLACEHOLDER,
  commandHasAgentPromptPlaceholder,
  CUSTOM_AGENT_PRESET_ID,
  DEFAULT_AGENT_PRESET_ID,
  getAgentPresetDefinition,
  inferAgentPresetIdFromCommand,
  isAgentPresetId,
  resolveAgentPresetCommand,
} from '../core/agent-presets.js';
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
  createGitHubSignalClient,
  GitHubAuthError,
  GitHubBootstrapError,
  GitHubConfigError,
} from '../core/github.js';
import type { AgentPresetId, GitHubSignalClient } from '../core/types.js';

interface InitCommandOptions {
  agentPreset?: string;
  customCommand?: string;
}

interface InitCommandDependencies {
  githubClient?: GitHubSignalClient;
  promptForAgentPreset?: (currentSelection: {
    presetId: AgentPresetId;
    command: string;
  }) => Promise<{
    presetId: AgentPresetId;
    customCommand?: string | null;
  }>;
}

function isDependenciesArgument(
  value: InitCommandOptions | InitCommandDependencies,
): value is InitCommandDependencies {
  return 'githubClient' in value || 'promptForAgentPreset' in value;
}

async function promptForAgentPresetSelection(currentSelection: {
  presetId: AgentPresetId;
  command: string;
}): Promise<{
  presetId: AgentPresetId;
  customCommand?: string | null;
}> {
  const rl = createInterface({ input: processStdin, output: processStdout });

  try {
    console.log('Select the default agent preset for this workspace:');
    for (const [index, preset] of AGENT_PRESETS.entries()) {
      const suffix =
        preset.id === currentSelection.presetId ? ' (default)' : '';
      console.log(`${index + 1}. ${preset.label}${suffix}`);
    }

    const answer = await rl.question(
      `Preset [${AGENT_PRESETS.findIndex((preset) => preset.id === currentSelection.presetId) + 1}]: `,
    );
    const selection = answer.trim();

    const preset =
      AGENT_PRESETS[
        selection.length === 0
          ? AGENT_PRESETS.findIndex(
              (candidate) => candidate.id === currentSelection.presetId,
            )
          : Number.parseInt(selection, 10) - 1
      ] ?? null;

    if (preset === null) {
      throw new Error('Invalid preset selection.');
    }

    if (preset.id !== CUSTOM_AGENT_PRESET_ID) {
      return { presetId: preset.id };
    }

    const customCommand = (
      await rl.question(
        `Custom command (must include "${AGENT_PROMPT_PLACEHOLDER}") [${currentSelection.command}]: `,
      )
    ).trim();

    return {
      presetId: 'custom',
      customCommand:
        customCommand.length > 0 ? customCommand : currentSelection.command,
    };
  } finally {
    rl.close();
  }
}

function validatePromptPlaceholder(command: string): void {
  if (!commandHasAgentPromptPlaceholder(command)) {
    throw new Error(
      `Agent commands must include the "${AGENT_PROMPT_PLACEHOLDER}" placeholder so gh-agent can inject the session brief.`,
    );
  }
}

async function resolveInitialAgentSelection(input: {
  hadConfig: boolean;
  options: InitCommandOptions;
  existingCommand: string;
  promptForAgentPreset?: InitCommandDependencies['promptForAgentPreset'];
}): Promise<{
  presetId: AgentPresetId;
  command: string;
}> {
  const explicitPreset = input.options.agentPreset?.trim();
  const explicitCustomCommand = input.options.customCommand?.trim();

  if (explicitPreset !== undefined && explicitPreset.length > 0) {
    if (!isAgentPresetId(explicitPreset)) {
      throw new Error(
        `Unsupported agent preset "${explicitPreset}". Supported values: ${AGENT_PRESETS.map((preset) => preset.id).join(', ')}`,
      );
    }

    const command = resolveAgentPresetCommand({
      presetId: explicitPreset,
      customCommand: explicitCustomCommand,
    });
    validatePromptPlaceholder(command);
    return {
      presetId: explicitPreset,
      command,
    };
  }

  if (explicitCustomCommand !== undefined && explicitCustomCommand.length > 0) {
    validatePromptPlaceholder(explicitCustomCommand);
    return {
      presetId: 'custom',
      command: explicitCustomCommand,
    };
  }

  if (input.hadConfig) {
    validatePromptPlaceholder(input.existingCommand);
    return {
      presetId: inferAgentPresetIdFromCommand(input.existingCommand),
      command: input.existingCommand,
    };
  }

  const promptForAgentPreset =
    input.promptForAgentPreset ?? promptForAgentPresetSelection;
  const shouldPrompt =
    input.promptForAgentPreset !== undefined || processStdin.isTTY;
  if (shouldPrompt) {
    const promptedSelection = await promptForAgentPreset({
      presetId: DEFAULT_AGENT_PRESET_ID,
      command: input.existingCommand,
    });
    const command = resolveAgentPresetCommand({
      presetId: promptedSelection.presetId,
      customCommand: promptedSelection.customCommand,
    });
    validatePromptPlaceholder(command);
    return {
      presetId: promptedSelection.presetId,
      command,
    };
  }

  return {
    presetId: DEFAULT_AGENT_PRESET_ID,
    command: input.existingCommand,
  };
}

function isMissingProjectScopeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return /required scopes|read:project|scope.*project|project.*scope/i.test(
    message,
  );
}

export async function initCommand(
  optionsOrDependencies: InitCommandOptions | InitCommandDependencies = {},
  maybeDependencies: InitCommandDependencies = {},
): Promise<void> {
  const options = isDependenciesArgument(optionsOrDependencies)
    ? {}
    : optionsOrDependencies;
  const dependencies = isDependenciesArgument(optionsOrDependencies)
    ? optionsOrDependencies
    : maybeDependencies;
  const paths = getWorkspacePaths();
  const githubClient = dependencies.githubClient ?? createGitHubSignalClient();

  await ensureWorkspaceStructure(paths);

  const hadConfig = await pathExists(paths.configFile);
  const config = await ensureConfig(paths);
  const initialAgentSelection = await resolveInitialAgentSelection({
    hadConfig,
    options,
    existingCommand: config.defaultAgentCommand,
    promptForAgentPreset: dependencies.promptForAgentPreset,
  });

  const hadState = await pathExists(paths.stateFile);
  await ensureSessionState(paths, config.agentId);
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
      ...config,
      defaultAgentCommand: initialAgentSelection.command,
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
    console.log(
      `Session state: ${hadState ? 'existing .gh-agent/session_state.json kept' : '.gh-agent/session_state.json created'}`,
    );
    console.log(
      'Directories: work/, .gh-agent/, and .gh-agent/gh-config/ ensured',
    );
    console.log(
      `AGENTS.md: ${agentsGuide.created ? 'created' : 'existing file kept'}`,
    );
    const preset = getAgentPresetDefinition(
      inferAgentPresetIdFromCommand(updatedConfig.defaultAgentCommand),
    );
    console.log(`Default agent preset: ${preset.label}`);
    console.log(`Default agent command: ${updatedConfig.defaultAgentCommand}`);
    if (preset.configEnv !== null) {
      console.log(
        `Preset config isolation: ${preset.configEnv} -> ${paths.root} (via GH_AGENT_HOME)`,
      );
    }
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
