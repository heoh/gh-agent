import type { Config, WorkspacePaths } from './types.js';

export const AGENT_PROMPT_PLACEHOLDER = '$GH_AGENT_PROMPT';
export const LEGACY_AGENT_PROMPT_PLACEHOLDER = '$prompt';

export type BuiltInAgentPresetId =
  | 'claude'
  | 'codex'
  | 'copilot'
  | 'gemini'
  | 'cursor'
  | 'cline';

export type AgentPresetId = BuiltInAgentPresetId | 'custom';

export interface AgentPresetDefinition {
  id: AgentPresetId;
  label: string;
  commandTemplate: string | null;
  windowsCommandTemplate?: string | null;
  configEnv: string | null;
  supportsIsolatedConfig: boolean;
  caveats: string[];
  docsUrl: string | null;
  isBeta?: boolean;
}

interface BuiltInAgentPresetDefinition extends AgentPresetDefinition {
  id: BuiltInAgentPresetId;
  commandTemplate: string;
}

export interface ResolvedAgentPresetSelection {
  presetId: AgentPresetId;
  command: string;
}

const BUILT_IN_AGENT_PRESETS: BuiltInAgentPresetDefinition[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    commandTemplate: 'claude -p "$GH_AGENT_PROMPT"',
    configEnv: null,
    supportsIsolatedConfig: false,
    caveats: [
      'Workspace-local config isolation is not wired by gh-agent for this preset.',
      'The CLI must already be installed and authenticated.',
    ],
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/cli-usage',
  },
  {
    id: 'codex',
    label: 'OpenAI Codex CLI',
    commandTemplate:
      'codex exec --config sandbox_workspace_write.network_access=true --full-auto "$GH_AGENT_PROMPT"',
    configEnv: 'CODEX_HOME',
    supportsIsolatedConfig: true,
    caveats: [
      'This preset intentionally enables workspace-write with network access for GitHub work.',
      'The CLI must already be installed and authenticated.',
    ],
    docsUrl: 'https://github.com/openai/codex/blob/main/codex-rs/README.md',
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot CLI',
    commandTemplate: 'copilot -p "$GH_AGENT_PROMPT"',
    configEnv: 'COPILOT_HOME',
    supportsIsolatedConfig: true,
    caveats: ['The CLI must already be installed and authenticated.'],
    docsUrl:
      'https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    commandTemplate: 'gemini -p "$GH_AGENT_PROMPT"',
    configEnv: 'GEMINI_CLI_HOME',
    supportsIsolatedConfig: true,
    caveats: ['The CLI must already be installed and authenticated.'],
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
  },
  {
    id: 'cursor',
    label: 'Cursor CLI',
    commandTemplate: 'cursor-agent -p "$GH_AGENT_PROMPT"',
    configEnv: 'CURSOR_CONFIG_DIR',
    supportsIsolatedConfig: true,
    caveats: [
      'Cursor CLI support is still beta upstream, so command behavior may shift.',
      'The CLI must already be installed and authenticated.',
    ],
    docsUrl: 'https://docs.cursor.com/en/cli/overview',
    isBeta: true,
  },
  {
    id: 'cline',
    label: 'Cline CLI',
    commandTemplate: 'cline "$GH_AGENT_PROMPT"',
    configEnv: 'CLINE_DIR',
    supportsIsolatedConfig: true,
    caveats: [
      'This preset avoids auto-approval flags by default; adjust with Custom command if needed.',
      'The CLI must already be installed and authenticated.',
    ],
    docsUrl: 'https://docs.cline.bot/cline-cli/getting-started',
  },
];

export const CUSTOM_AGENT_PRESET: AgentPresetDefinition = {
  id: 'custom',
  label: 'Custom command',
  commandTemplate: null,
  configEnv: null,
  supportsIsolatedConfig: false,
  caveats: [
    'You are responsible for prompt placeholder compatibility and any extra env or auth needs.',
  ],
  docsUrl: null,
};

export const AGENT_PRESETS: AgentPresetDefinition[] = [
  ...BUILT_IN_AGENT_PRESETS,
  CUSTOM_AGENT_PRESET,
];

export const DEFAULT_AGENT_PRESET_ID: BuiltInAgentPresetId = 'copilot';

export function isAgentPresetId(value: unknown): value is AgentPresetId {
  return AGENT_PRESETS.some((preset) => preset.id === value);
}

export function getAgentPresetDefinition(
  presetId: AgentPresetId,
): AgentPresetDefinition {
  const preset = AGENT_PRESETS.find((candidate) => candidate.id === presetId);

  if (preset === undefined) {
    throw new Error(`Unsupported agent preset: ${presetId}`);
  }

  return preset;
}

export function resolveAgentPresetCommandTemplate(
  presetId: Exclude<AgentPresetId, 'custom'>,
  platform = process.platform,
): string {
  const preset = getAgentPresetDefinition(presetId);

  if (
    platform === 'win32' &&
    typeof preset.windowsCommandTemplate === 'string'
  ) {
    return preset.windowsCommandTemplate;
  }

  if (typeof preset.commandTemplate !== 'string') {
    throw new Error(`Preset ${presetId} does not define a command template.`);
  }

  return preset.commandTemplate;
}

function doesCommandMatchPreset(
  command: string,
  presetId: Exclude<AgentPresetId, 'custom'>,
): boolean {
  const preset = getAgentPresetDefinition(presetId);
  const candidates = [
    preset.commandTemplate,
    preset.windowsCommandTemplate ?? null,
  ].filter((value): value is string => typeof value === 'string');

  return candidates.includes(command);
}

export function inferAgentPresetIdFromCommand(command: string): AgentPresetId {
  for (const preset of BUILT_IN_AGENT_PRESETS) {
    if (doesCommandMatchPreset(command, preset.id)) {
      return preset.id;
    }
  }

  return 'custom';
}

export function commandHasAgentPromptPlaceholder(command: string): boolean {
  return (
    command.includes(AGENT_PROMPT_PLACEHOLDER) ||
    command.includes(LEGACY_AGENT_PROMPT_PLACEHOLDER)
  );
}

export function getAgentPresetConfigDir(
  paths: Pick<WorkspacePaths, 'root'>,
): string {
  return paths.root;
}

export function resolveAgentRuntimeEnvironment(input: {
  config: Config;
  paths: Pick<WorkspacePaths, 'root'>;
  executedAgentClass: 'default' | 'heavy';
}): Record<string, string> {
  if (input.executedAgentClass !== 'default') {
    return {};
  }

  const preset = getAgentPresetDefinition(
    inferAgentPresetIdFromCommand(input.config.defaultAgentCommand),
  );
  if (!preset.supportsIsolatedConfig || preset.configEnv === null) {
    return {};
  }

  return {
    [preset.configEnv]: getAgentPresetConfigDir(input.paths),
  };
}

export function resolveAgentPresetSelection(input: {
  presetId: AgentPresetId;
  customCommand?: string | null;
  platform?: NodeJS.Platform;
}): ResolvedAgentPresetSelection {
  if (input.presetId === 'custom') {
    const command = input.customCommand?.trim() ?? '';

    if (command.length === 0) {
      throw new Error(
        'A custom command is required when --agent-preset custom is selected.',
      );
    }

    return {
      presetId: 'custom',
      command,
    };
  }

  return {
    presetId: input.presetId,
    command: resolveAgentPresetCommandTemplate(input.presetId, input.platform),
  };
}
