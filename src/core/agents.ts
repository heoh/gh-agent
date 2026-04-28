export type AgentId =
  | 'claude-code'
  | 'codex'
  | 'copilot'
  | 'gemini'
  | 'cursor'
  | 'cline';

export interface AgentDefinition {
  id: AgentId;
  label: string;
  description: string;
  defaultAgentCommand: string;
}

export const AGENT_DEFINITIONS = [
  {
    id: 'copilot',
    label: 'GitHub Copilot CLI',
    description: 'Run Copilot CLI in autopilot mode without extra prompts.',
    defaultAgentCommand:
      'copilot --prompt "$GH_AGENT_PROMPT" --allow-all --autopilot --no-ask-user',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'Run Claude Code with Read/Edit/Bash tools enabled.',
    defaultAgentCommand:
      'claude -p "$GH_AGENT_PROMPT" --allowedTools "Read,Edit,Bash"',
  },
  {
    id: 'codex',
    label: 'OpenAI Codex CLI',
    description:
      'Run Codex in full-auto mode with workspace-write networking enabled.',
    defaultAgentCommand:
      'codex exec --config sandbox_workspace_write.network_access=true --full-auto "$GH_AGENT_PROMPT"',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    description: 'Run Gemini CLI with yolo mode enabled.',
    defaultAgentCommand: 'gemini --prompt "$GH_AGENT_PROMPT" --yolo',
  },
  {
    id: 'cursor',
    label: 'Cursor CLI',
    description: 'Run Cursor Agent with force mode enabled.',
    defaultAgentCommand: 'cursor-agent -p "$GH_AGENT_PROMPT" --force',
  },
  {
    id: 'cline',
    label: 'Cline CLI',
    description: 'Run Cline in yes-to-all mode.',
    defaultAgentCommand: 'cline -y "$GH_AGENT_PROMPT"',
  },
] as const satisfies readonly AgentDefinition[];

const AGENT_DEFINITION_MAP = new Map(
  AGENT_DEFINITIONS.map((agent: AgentDefinition) => [agent.id, agent]),
);

export const DEFAULT_AGENT_ID: AgentId = 'codex';

export function getSupportedAgentIds(): AgentId[] {
  return Array.from(AGENT_DEFINITION_MAP.keys());
}

export function formatSupportedAgentIds(): string {
  return getSupportedAgentIds().join(', ');
}

export function isAgentId(value: string): value is AgentId {
  return AGENT_DEFINITION_MAP.has(value as AgentId);
}

export function parseAgentIdOption(value: string): AgentId {
  if (!isAgentId(value)) {
    throw new Error(
      `The --agent option must be one of: ${formatSupportedAgentIds()}.`,
    );
  }

  return value;
}

export function getAgentDefinition(agentId: AgentId): AgentDefinition {
  return AGENT_DEFINITION_MAP.get(agentId) as AgentDefinition;
}

export function getDefaultAgentDefinition(): AgentDefinition {
  return getAgentDefinition(DEFAULT_AGENT_ID);
}
