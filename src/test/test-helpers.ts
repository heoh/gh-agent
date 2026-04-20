import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, vi } from 'vitest';

export interface WorkspaceTestContext {
  getWorkspaceRoot(): string;
}

export function setupWorkspaceTest(): WorkspaceTestContext {
  let originalCwd = '';
  let workspaceRoot = '';

  beforeEach(async () => {
    originalCwd = process.cwd();
    workspaceRoot = await mkdtemp(path.join(tmpdir(), 'gh-agent-'));
    process.chdir(workspaceRoot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);

    if (workspaceRoot.length > 0) {
      void rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  return {
    getWorkspaceRoot: () => workspaceRoot,
  };
}

export function captureConsoleLogs(): string[] {
  const logs: string[] = [];

  vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
    logs.push(String(message));
  });

  return logs;
}
