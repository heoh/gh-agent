import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type { Config, SessionState } from './types.js';

export interface WorkspacePaths {
  root: string;
  configFile: string;
  stateDir: string;
  stateFile: string;
  lockFile: string;
  wakeDecisionsFile: string;
  ghConfigDir: string;
  workDir: string;
}

export const DEFAULT_CONFIG: Config = {
  agentId: 'gh-agent',
  pollIntervalMs: 30_000,
  debounceMs: 60_000,
};

export function getWorkspacePaths(root = process.cwd()): WorkspacePaths {
  const stateDir = path.join(root, '.gh-agent');

  return {
    root,
    configFile: path.join(root, 'config.json'),
    stateDir,
    stateFile: path.join(stateDir, 'session_state.json'),
    lockFile: path.join(stateDir, 'lock'),
    wakeDecisionsFile: path.join(stateDir, 'wake_decisions.jsonl'),
    ghConfigDir: path.join(stateDir, 'gh-config'),
    workDir: path.join(root, 'work'),
  };
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

function normalizeConfig(raw: unknown): Config {
  const record = raw as Partial<Config>;

  return {
    agentId:
      typeof record.agentId === 'string' && record.agentId.length > 0
        ? record.agentId
        : DEFAULT_CONFIG.agentId,
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
  await mkdir(paths.ghConfigDir, { recursive: true });
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

export async function removeFileIfExists(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}
