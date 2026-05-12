import { describe, expect, it } from 'vitest';

import {
  createCommandGitHubClientStub,
  createCommandTestWorkspace,
} from '../test/command-fixtures.js';
import {
  captureConsoleLogs,
  setupWorkspaceTest,
} from '../test/test-helpers.js';
import { statusCommand } from './status.js';

const { getWorkspaceRoot } = setupWorkspaceTest();

describe('status command', () => {
  describe('usage examples', () => {
    it('shows the current workspace, project, lock, auth, and signal counts', async () => {
      const logs = captureConsoleLogs();
      await createCommandTestWorkspace(getWorkspaceRoot());

      await statusCommand(
        {},
        {
          githubClient: createCommandGitHubClientStub(),
        },
      );

      expect(logs).toContain(`Workspace: ${getWorkspaceRoot()}`);
      expect(logs).toContain(
        `Config: ${getWorkspaceRoot()}/.gh-agent/config.json`,
      );
      expect(logs).toContain('Agent: gh-agent');
      expect(logs).toContain('Project: gh-agent');
      expect(logs).toContain(
        'Project URL: https://github.com/users/test/projects/1',
      );
      expect(logs).toContain('Mode: sleeping');
      expect(logs).toContain('Lock: unlocked');
      expect(logs).toContain('Unread notifications: 2');
      expect(logs).toContain('Actionable cards: 1');
      expect(logs).toContain('Actionable rule: Status in {Ready, Doing}');
      expect(logs).toContain('GitHub auth: authenticated');
      expect(logs).toContain('GitHub auth detail: stubbed auth status');
    });
  });

  describe('behavior checks', () => {
    it('omits signal counts when GitHub auth is unavailable', async () => {
      const logs = captureConsoleLogs();
      await createCommandTestWorkspace(getWorkspaceRoot());

      await statusCommand(
        {},
        {
          githubClient: createCommandGitHubClientStub({
            async getAuthStatus(paths) {
              return {
                kind: 'unauthenticated',
                detail: 'not logged in',
                ghConfigDir: paths.ghConfigDir,
              };
            },
          }),
        },
      );

      expect(logs).toContain('Unread notifications: -');
      expect(logs).toContain('Actionable cards: -');
      expect(logs).toContain('GitHub auth: unauthenticated');
      expect(logs).toContain('GitHub auth detail: not logged in');
    });
  });
});
