import { describe, expect, it } from 'vitest';

import {
  inferAgentPresetIdFromCommand,
  resolveAgentPresetSelection,
  resolveAgentRuntimeEnvironment,
} from './agent-presets.js';
import type { Config } from './types.js';

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    agentId: 'gh-agent',
    defaultAgentCommand:
      'codex exec --config sandbox_workspace_write.network_access=true --full-auto "$GH_AGENT_PROMPT"',
    heavyAgentCommand: null,
    pollIntervalMs: 30_000,
    debounceMs: 60_000,
    promptMailboxSampleLimit: 20,
    promptTaskSampleLimit: 20,
    promptRecentTaskCardLimit: 5,
    projectId: null,
    projectTitle: null,
    projectUrl: null,
    projectFieldIds: {
      status: null,
      priority: null,
      type: null,
      executionClass: null,
      sourceLink: null,
      nextAction: null,
      shortNote: null,
    },
    projectStatusOptionIds: {
      ready: null,
      doing: null,
      waiting: null,
      done: null,
    },
    projectExecutionClassOptionIds: {
      light: null,
      heavy: null,
    },
    ...overrides,
  };
}

describe('agent presets', () => {
  it('infers codex from the built-in command template', () => {
    expect(
      inferAgentPresetIdFromCommand(
        'codex exec --config sandbox_workspace_write.network_access=true --full-auto "$GH_AGENT_PROMPT"',
      ),
    ).toBe('codex');
  });

  it('marks unknown commands as custom', () => {
    expect(
      inferAgentPresetIdFromCommand('my-agent --task "$GH_AGENT_PROMPT"'),
    ).toBe('custom');
  });

  it('resolves a custom preset only when a command is supplied', () => {
    expect(() =>
      resolveAgentPresetSelection({
        presetId: 'custom',
        customCommand: '',
      }),
    ).toThrow(/custom command is required/i);
  });

  it('injects isolated config env only for default-class presets that support it', () => {
    expect(
      resolveAgentRuntimeEnvironment({
        config: createConfig({
          defaultAgentCommand: 'gemini -p "$GH_AGENT_PROMPT"',
        }),
        paths: {
          root: '/tmp/workspace',
        },
        executedAgentClass: 'default',
      }),
    ).toEqual({
      GEMINI_CLI_HOME: '/tmp/workspace',
    });

    expect(
      resolveAgentRuntimeEnvironment({
        config: createConfig({
          defaultAgentCommand: 'claude -p "$GH_AGENT_PROMPT"',
        }),
        paths: {
          root: '/tmp/workspace',
        },
        executedAgentClass: 'default',
      }),
    ).toEqual({});
  });
});
