#!/usr/bin/env node

import { Command } from 'commander';

import { initCommand } from './commands/init.js';
import { mailboxIgnoreCommand } from './commands/mailbox/ignore.js';
import { mailboxListCommand } from './commands/mailbox/list.js';
import {
  mailboxPromoteCommand,
  parseMailboxPromotionStatusOption,
  mailboxReadyCommand,
  mailboxWaitCommand,
} from './commands/mailbox/promote.js';
import { mailboxShowCommand } from './commands/mailbox/show.js';
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

  mailbox
    .command('promote')
    .description(
      'Promote unread GitHub notification threads into Project cards.',
    )
    .argument('<threadId...>', 'One or more GitHub notification thread ids.')
    .option(
      '--status <status>',
      'Initial project status for the promoted cards.',
      parseMailboxPromotionStatusOption,
      'ready',
    )
    .action(
      async (threadIds: string[], options: { status: 'ready' | 'waiting' }) =>
        mailboxPromoteCommand(threadIds, options),
    );

  mailbox
    .command('wait')
    .description(
      'Promote unread GitHub notification threads into Waiting cards.',
    )
    .argument('<threadId...>', 'One or more GitHub notification thread ids.')
    .action(async (threadIds: string[]) => mailboxWaitCommand(threadIds));

  mailbox
    .command('ready')
    .description('Promote unread GitHub notification threads into Ready cards.')
    .argument('<threadId...>', 'One or more GitHub notification thread ids.')
    .action(async (threadIds: string[]) => mailboxReadyCommand(threadIds));

  mailbox
    .command('ignore')
    .description(
      'Mark unread GitHub notification threads as read without promoting them.',
    )
    .argument('<threadId...>', 'One or more GitHub notification thread ids.')
    .action(async (threadIds: string[]) => mailboxIgnoreCommand(threadIds));

  mailbox
    .command('show')
    .description(
      'Show detailed mailbox information for a GitHub notification thread.',
    )
    .argument('<threadId>', 'A GitHub notification thread id.')
    .action(async (threadId: string) => mailboxShowCommand(threadId));

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
