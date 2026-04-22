#!/usr/bin/env node

import { Command } from 'commander';

import { initCommand } from './commands/init.js';
import { mailboxListCommand } from './commands/mailbox/list.js';
import { runCommand } from './commands/run.js';
import { statusCommand } from './commands/status.js';

function createProgram(): Command {
  const program = new Command();

  program
    .name('gh-agent')
    .description('CLI for running the gh-agent workspace workflow.')
    .version('0.1.0');

  program
    .command('init')
    .description('Initialize a gh-agent workspace.')
    .action(initCommand);

  program
    .command('run')
    .description('Run the gh-agent foreground loop.')
    .action(runCommand);

  program
    .command('status')
    .description('Show the current gh-agent workspace status.')
    .action(statusCommand);

  const mailbox = program
    .command('mailbox')
    .description('Inspect and manage unread GitHub notifications.');

  mailbox
    .command('list')
    .description('List unread GitHub notifications for the current workspace.')
    .option(
      '--limit <n>',
      'Maximum unread notifications to print.',
      (value: string) => {
        const parsed = Number.parseInt(value, 10);

        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error('The --limit option must be a non-negative integer.');
        }

        return parsed;
      },
      20,
    )
    .action(async (options: { limit: number }) => mailboxListCommand(options));

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(argv);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown runtime error';
    console.error(message);
    process.exitCode =
      typeof (error as { exitCode?: unknown }).exitCode === 'number'
        ? ((error as { exitCode: number }).exitCode ?? 1)
        : 1;
  }
}

void main();
