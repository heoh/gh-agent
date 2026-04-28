import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type {
  Config,
  GitIdentity,
  ProjectExecutionClassOptionIds,
  ProjectFieldIds,
  ProjectStatusOptionIds,
  SessionState,
  WorkspacePaths,
} from './types.js';
import {
  DEFAULT_AGENT_PRESET_ID,
  resolveAgentPresetCommandTemplate,
  resolveDefaultAgentPresetId,
} from './agent-presets.js';

export class WorkspaceNotFoundError extends Error {}
export type { WorkspacePaths } from './types.js';
const DEFAULT_AGENTS_TEMPLATE_URL = new URL(
  './default-agents.md',
  import.meta.url,
);
let cachedDefaultAgentsTemplate: string | null = null;

function createEmptyProjectFieldIds(): ProjectFieldIds {
  return {
    status: null,
    priority: null,
    type: null,
    executionClass: null,
    sourceLink: null,
    nextAction: null,
    shortNote: null,
  };
}

function createEmptyProjectStatusOptionIds(): ProjectStatusOptionIds {
  return {
    ready: null,
    doing: null,
    waiting: null,
    done: null,
  };
}

function createEmptyProjectExecutionClassOptionIds(): ProjectExecutionClassOptionIds {
  return {
    light: null,
    heavy: null,
  };
}

export const DEFAULT_CONFIG: Config = {
  agentId: 'gh-agent',
  defaultAgentPreset: DEFAULT_AGENT_PRESET_ID,
  defaultAgentCommand: resolveAgentPresetCommandTemplate(
    DEFAULT_AGENT_PRESET_ID,
  ),
  heavyAgentCommand: null,
  pollIntervalMs: 30_000,
  debounceMs: 60_000,
  promptMailboxSampleLimit: 20,
  promptTaskSampleLimit: 20,
  promptRecentTaskCardLimit: 5,
  projectId: null,
  projectTitle: null,
  projectUrl: null,
  projectFieldIds: createEmptyProjectFieldIds(),
  projectStatusOptionIds: createEmptyProjectStatusOptionIds(),
  projectExecutionClassOptionIds: createEmptyProjectExecutionClassOptionIds(),
};

export function getWorkspacePaths(root = process.cwd()): WorkspacePaths {
  const stateDir = path.join(root, '.gh-agent');

  return {
    root,
    agentsFile: path.join(root, 'AGENTS.md'),
    configFile: path.join(stateDir, 'config.json'),
    stateGitignoreFile: path.join(stateDir, '.gitignore'),
    stateDir,
    stateFile: path.join(stateDir, 'session_state.json'),
    sessionNotesDir: path.join(stateDir, 'session_notes'),
    lockFile: path.join(stateDir, 'lock'),
    wakeDecisionsFile: path.join(stateDir, 'wake_decisions.jsonl'),
    ghConfigDir: path.join(stateDir, 'gh-config'),
    gitConfigGlobalFile: path.join(stateDir, '.gitconfig'),
    workDir: path.join(root, 'work'),
  };
}

export async function findWorkspaceRoot(
  start = process.cwd(),
): Promise<string> {
  let current = path.resolve(start);

  while (true) {
    const configFile = path.join(current, '.gh-agent', 'config.json');

    if (await pathExists(configFile)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }

    current = parent;
  }

  throw new WorkspaceNotFoundError(
    `No gh-agent workspace found from ${start} or its parent directories.`,
  );
}

export function createInitialSessionState(
  agentId: string,
  now = new Date(),
): SessionState {
  void now;

  return {
    agentId,
    currentMode: 'sleeping',
    currentSessionId: null,
    nextWakeNotBefore: null,
    lastSessionStartedAt: null,
    lastSessionEndedAt: null,
    lastNotificationPollAt: null,
    lastSeenNotificationCursor: null,
  };
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function normalizeConfig(raw: unknown): Config {
  const record = raw as Partial<Config>;
  const projectFieldIds = record.projectFieldIds as
    | Partial<ProjectFieldIds>
    | undefined;
  const projectStatusOptionIds = record.projectStatusOptionIds as
    | Partial<ProjectStatusOptionIds>
    | undefined;
  const projectExecutionClassOptionIds =
    record.projectExecutionClassOptionIds as
      | Partial<ProjectExecutionClassOptionIds>
      | undefined;

  return {
    agentId:
      typeof record.agentId === 'string' && record.agentId.length > 0
        ? record.agentId
        : DEFAULT_CONFIG.agentId,
    defaultAgentPreset: resolveDefaultAgentPresetId({
      presetId: record.defaultAgentPreset,
      defaultAgentCommand:
        typeof record.defaultAgentCommand === 'string' &&
        record.defaultAgentCommand.length > 0
          ? record.defaultAgentCommand
          : DEFAULT_CONFIG.defaultAgentCommand,
    }),
    defaultAgentCommand:
      typeof record.defaultAgentCommand === 'string' &&
      record.defaultAgentCommand.length > 0
        ? record.defaultAgentCommand
        : DEFAULT_CONFIG.defaultAgentCommand,
    heavyAgentCommand:
      typeof record.heavyAgentCommand === 'string' &&
      record.heavyAgentCommand.length > 0
        ? record.heavyAgentCommand
        : null,
    pollIntervalMs:
      typeof record.pollIntervalMs === 'number' &&
      Number.isFinite(record.pollIntervalMs) &&
      record.pollIntervalMs > 0
        ? record.pollIntervalMs
        : DEFAULT_CONFIG.pollIntervalMs,
    debounceMs:
      typeof record.debounceMs === 'number' &&
      Number.isFinite(record.debounceMs) &&
      record.debounceMs >= 0
        ? record.debounceMs
        : DEFAULT_CONFIG.debounceMs,
    promptMailboxSampleLimit: normalizePositiveInteger(
      record.promptMailboxSampleLimit,
      DEFAULT_CONFIG.promptMailboxSampleLimit,
    ),
    promptTaskSampleLimit: normalizePositiveInteger(
      record.promptTaskSampleLimit,
      DEFAULT_CONFIG.promptTaskSampleLimit,
    ),
    promptRecentTaskCardLimit: normalizePositiveInteger(
      record.promptRecentTaskCardLimit,
      DEFAULT_CONFIG.promptRecentTaskCardLimit,
    ),
    projectId: typeof record.projectId === 'string' ? record.projectId : null,
    projectTitle:
      typeof record.projectTitle === 'string' ? record.projectTitle : null,
    projectUrl:
      typeof record.projectUrl === 'string' ? record.projectUrl : null,
    projectFieldIds: {
      status:
        typeof projectFieldIds?.status === 'string'
          ? projectFieldIds.status
          : null,
      priority:
        typeof projectFieldIds?.priority === 'string'
          ? projectFieldIds.priority
          : null,
      type:
        typeof projectFieldIds?.type === 'string' ? projectFieldIds.type : null,
      executionClass:
        typeof projectFieldIds?.executionClass === 'string'
          ? projectFieldIds.executionClass
          : null,
      sourceLink:
        typeof projectFieldIds?.sourceLink === 'string'
          ? projectFieldIds.sourceLink
          : null,
      nextAction:
        typeof projectFieldIds?.nextAction === 'string'
          ? projectFieldIds.nextAction
          : null,
      shortNote:
        typeof projectFieldIds?.shortNote === 'string'
          ? projectFieldIds.shortNote
          : null,
    },
    projectStatusOptionIds: {
      ready:
        typeof projectStatusOptionIds?.ready === 'string'
          ? projectStatusOptionIds.ready
          : null,
      doing:
        typeof projectStatusOptionIds?.doing === 'string'
          ? projectStatusOptionIds.doing
          : null,
      waiting:
        typeof projectStatusOptionIds?.waiting === 'string'
          ? projectStatusOptionIds.waiting
          : null,
      done:
        typeof projectStatusOptionIds?.done === 'string'
          ? projectStatusOptionIds.done
          : null,
    },
    projectExecutionClassOptionIds: {
      light:
        typeof projectExecutionClassOptionIds?.light === 'string'
          ? projectExecutionClassOptionIds.light
          : null,
      heavy:
        typeof projectExecutionClassOptionIds?.heavy === 'string'
          ? projectExecutionClassOptionIds.heavy
          : null,
    },
  };
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function normalizeSessionState(raw: unknown, agentId: string): SessionState {
  const record = raw as Partial<SessionState> & {
    wakeDebounceUntil?: string | null;
    last_session_started_at?: string | null;
    last_session_ended_at?: string | null;
    last_notification_poll_at?: string | null;
    last_seen_notification_cursor?: string | null;
  };

  return {
    agentId: typeof record.agentId === 'string' ? record.agentId : agentId,
    currentMode: record.currentMode === 'active' ? 'active' : 'sleeping',
    currentSessionId:
      typeof record.currentSessionId === 'string'
        ? record.currentSessionId
        : null,
    nextWakeNotBefore:
      normalizeIsoTimestamp(record.nextWakeNotBefore) ??
      normalizeIsoTimestamp(record.wakeDebounceUntil),
    lastSessionStartedAt:
      normalizeIsoTimestamp(record.lastSessionStartedAt) ??
      normalizeIsoTimestamp(record.last_session_started_at),
    lastSessionEndedAt:
      normalizeIsoTimestamp(record.lastSessionEndedAt) ??
      normalizeIsoTimestamp(record.last_session_ended_at),
    lastNotificationPollAt:
      normalizeIsoTimestamp(record.lastNotificationPollAt) ??
      normalizeIsoTimestamp(record.last_notification_poll_at),
    lastSeenNotificationCursor:
      typeof record.lastSeenNotificationCursor === 'string'
        ? record.lastSeenNotificationCursor
        : typeof record.last_seen_notification_cursor === 'string'
          ? record.last_seen_notification_cursor
          : null,
  };
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

export async function ensureWorkspaceStructure(
  paths: WorkspacePaths,
): Promise<void> {
  await mkdir(paths.workDir, { recursive: true });
  await mkdir(paths.stateDir, { recursive: true });
  await mkdir(paths.sessionNotesDir, { recursive: true });
  await mkdir(paths.ghConfigDir, { recursive: true });
  await mkdir(`${paths.stateDir}/agent-config`, { recursive: true });
  await writeFile(paths.gitConfigGlobalFile, '', { flag: 'a' });
  if (!(await pathExists(paths.stateGitignoreFile))) {
    await writeFile(paths.stateGitignoreFile, '*\n!config.json\n', 'utf8');
  }
}

export async function ensureAgentsGuide(
  paths: Pick<WorkspacePaths, 'agentsFile'>,
): Promise<{ created: boolean }> {
  if (await pathExists(paths.agentsFile)) {
    return { created: false };
  }

  const template = await loadDefaultAgentsTemplate();
  await writeFile(paths.agentsFile, template, 'utf8');
  return { created: true };
}

async function loadDefaultAgentsTemplate(): Promise<string> {
  if (cachedDefaultAgentsTemplate !== null) {
    return cachedDefaultAgentsTemplate;
  }

  cachedDefaultAgentsTemplate = await readFile(
    DEFAULT_AGENTS_TEMPLATE_URL,
    'utf8',
  );
  return cachedDefaultAgentsTemplate;
}

export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  const tempFilePath = `${filePath}.tmp`;
  const json = `${JSON.stringify(value, null, 2)}\n`;

  await writeFile(tempFilePath, json, 'utf8');
  await rename(tempFilePath, filePath);
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf8');

  return JSON.parse(content) as T;
}

export async function ensureConfig(paths: WorkspacePaths): Promise<Config> {
  if (!(await pathExists(paths.configFile))) {
    await writeJsonAtomic(paths.configFile, DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  let config: Config;

  try {
    config = normalizeConfig(await readJsonFile<unknown>(paths.configFile));
  } catch {
    config = DEFAULT_CONFIG;
  }

  await writeJsonAtomic(paths.configFile, config);
  return config;
}

export async function saveConfig(
  paths: WorkspacePaths,
  config: Config,
): Promise<void> {
  await writeJsonAtomic(paths.configFile, normalizeConfig(config));
}

function sanitizeGitConfigValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export async function saveWorkspaceGitIdentity(
  paths: WorkspacePaths,
  identity: GitIdentity,
): Promise<void> {
  const name = sanitizeGitConfigValue(identity.name);
  const email = sanitizeGitConfigValue(identity.email);

  const nextContent = `[user]\n  name = ${name}\n  email = ${email}\n`;
  await writeFile(paths.gitConfigGlobalFile, nextContent, 'utf8');
}

export async function ensureSessionState(
  paths: WorkspacePaths,
  agentId: string,
): Promise<SessionState> {
  if (!(await pathExists(paths.stateFile))) {
    const initialState = createInitialSessionState(agentId);
    await writeJsonAtomic(paths.stateFile, initialState);
    return initialState;
  }

  let state: SessionState;

  try {
    state = normalizeSessionState(
      await readJsonFile<unknown>(paths.stateFile),
      agentId,
    );
  } catch {
    state = createInitialSessionState(agentId);
  }

  await writeJsonAtomic(paths.stateFile, state);
  return state;
}

export async function saveSessionState(
  paths: WorkspacePaths,
  state: SessionState,
): Promise<void> {
  await writeJsonAtomic(paths.stateFile, state);
}

export async function appendWakeDecision(
  paths: WorkspacePaths,
  decision: unknown,
): Promise<void> {
  await appendFile(
    paths.wakeDecisionsFile,
    `${JSON.stringify(decision)}\n`,
    'utf8',
  );
}

function parseSessionNoteTimestamp(fileName: string): number | null {
  const match = /^sess_(\d+)\.md$/u.exec(fileName);

  if (match === null) {
    return null;
  }

  const timestamp = Number.parseInt(match[1], 10);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getSessionNoteFilePath(
  paths: Pick<WorkspacePaths, 'sessionNotesDir'>,
  sessionId: string,
): string {
  return path.join(paths.sessionNotesDir, `${sessionId}.md`);
}

export async function ensureSessionNoteTemplate(
  paths: Pick<WorkspacePaths, 'sessionNotesDir'>,
  sessionId: string,
  sessionStartedAt = new Date(),
): Promise<string> {
  const noteFilePath = getSessionNoteFilePath(paths, sessionId);
  const template = [
    `# Session ${sessionId}`,
    '',
    `Started at: ${sessionStartedAt.toISOString()}`,
    '',
    '## What changed',
    '- TODO',
    '',
    '## What is blocked',
    '- TODO',
    '',
    '## Next action',
    '- TODO',
    '',
  ].join('\n');

  await writeFile(noteFilePath, template, 'utf8');
  return noteFilePath;
}

export async function listRecentSessionNotes(
  paths: Pick<WorkspacePaths, 'sessionNotesDir'>,
  limit = 3,
): Promise<Array<{ sessionId: string; content: string }>> {
  const entries = await readdir(paths.sessionNotesDir, {
    withFileTypes: true,
  });
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort((left, right) => {
      const leftTimestamp = parseSessionNoteTimestamp(left);
      const rightTimestamp = parseSessionNoteTimestamp(right);

      if (leftTimestamp !== null && rightTimestamp !== null) {
        return rightTimestamp - leftTimestamp;
      }

      return right.localeCompare(left);
    });

  const normalizedLimit =
    Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 3;
  const selectedFiles = markdownFiles.slice(0, normalizedLimit);
  const notes = await Promise.all(
    selectedFiles.map(async (fileName) => {
      const sessionId = fileName.replace(/\.md$/u, '');
      const content = (
        await readFile(path.join(paths.sessionNotesDir, fileName), 'utf8')
      ).trim();

      return {
        sessionId,
        content,
      };
    }),
  );

  return notes.filter((note) => note.content.length > 0);
}

export async function removeFileIfExists(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}
