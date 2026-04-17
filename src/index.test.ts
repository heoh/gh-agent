import { describe, expect, it } from 'vitest';

import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { statusCommand } from './commands/status.js';

describe('command stubs', () => {
  it('exposes init, run, and status command handlers', () => {
    expect(initCommand).toBeTypeOf('function');
    expect(runCommand).toBeTypeOf('function');
    expect(statusCommand).toBeTypeOf('function');
  });
});
