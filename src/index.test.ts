import { describe, expect, it } from 'vitest';

import { getGreeting } from './index.js';

describe('getGreeting', () => {
  it('returns the default CLI greeting', () => {
    expect(getGreeting()).toBe('Hello from gh-agent');
  });
});
