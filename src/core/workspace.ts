import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Config, SessionState } from './types.js';

export interface WorkspacePaths {
  root: string;
  configFile: string;
  stateDir: string;
  stateFile: string;
  lockFile: string;
  wakeDecisionsFile: string;
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
    workDir: path.join(root, 'work'),
  };
}

export function createInitialSessionState(agentId: string, now = new Date()): SessionState {
  void now;

  return {
    agentId,
    currentMode: 'sleeping',
    currentSessionId: null,
    nextWakeNotBefore: null,
  };
}

function normalizeSessionState(raw: unknown, agentId: string): SessionState {
  const record = raw as Partial<SessionState> & {
    wakeDebounceUntil?: string | null;
  };

  return {
    agentId: typeof record.agentId === 'string' ? record.agentId : agentId,
    currentMode: record.currentMode === 'active' ? 'active' : 'sleeping',
    currentSessionId: typeof record.currentSessionId === 'string' ? record.currentSessionId : null,
    nextWakeNotBefore:
      typeof record.nextWakeNotBefore === 'string'
        ? record.nextWakeNotBefore
        : typeof record.wakeDebounceUntil === 'string'
          ? record.wakeDebounceUntil
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

export async function ensureWorkspaceStructure(paths: WorkspacePaths): Promise<void> {
  await mkdir(paths.workDir, { recursive: true });
  await mkdir(paths.stateDir, { recursive: true });
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
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

  return readJsonFile<Config>(paths.configFile);
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

  const state = normalizeSessionState(await readJsonFile<unknown>(paths.stateFile), agentId);
  await writeJsonAtomic(paths.stateFile, state);
  return state;
}

export async function saveSessionState(
  paths: WorkspacePaths,
  state: SessionState,
): Promise<void> {
  await writeJsonAtomic(paths.stateFile, state);
}

export async function appendWakeDecision(paths: WorkspacePaths, decision: unknown): Promise<void> {
  const existing = (await pathExists(paths.wakeDecisionsFile))
    ? await readFile(paths.wakeDecisionsFile, 'utf8')
    : '';
  const next = `${existing}${JSON.stringify(decision)}\n`;
  await writeFile(paths.wakeDecisionsFile, next, 'utf8');
}

export async function removeFileIfExists(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}