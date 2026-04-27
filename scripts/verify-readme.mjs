import { readFileSync } from 'node:fs';
import path from 'node:path';

const readmePath = path.resolve('README.md');
const raw = readFileSync(readmePath, 'utf8');
const content = raw.trim();

if (content.length === 0) {
  console.error('README.md must not be empty.');
  process.exit(1);
}

const requiredSections = [
  '## Requirements',
  '## Install',
  '## Quick Start',
  '## Authentication',
  '## Core Commands',
  '## Troubleshooting',
  '## Documentation',
];

const missingSections = requiredSections.filter(
  (section) => !content.includes(section),
);

if (missingSections.length > 0) {
  console.error(
    `README.md is missing required sections: ${missingSections.join(', ')}`,
  );
  process.exit(1);
}

console.log('README.md verification passed.');
