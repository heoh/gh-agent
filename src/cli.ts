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
import { taskCreateCommand } from './commands/task/create.js';
import {
  parseTaskExecutionClassOption,
  parseTaskPriorityOption,
  parseTaskStatusFilterOption,
  parseTaskStatusOption,
  parseTaskTypeOption,
} from './commands/task/common.js';
import { taskListCommand } from './commands/task/list.js';
import { taskShowCommand } from './commands/task/show.js';
import {
  taskDoingCommand,
  taskDoneCommand,
  taskReadyCommand,
  taskWaitCommand,
} from './commands/task/status.js';
import { taskUpdateCommand } from './commands/task/update.js';

function createProgram(): Command {
  const program = new Command();

  program
    .name('gh-agent')
    .description('CLI for running the gh-agent workspace workflow.')
    .version('0.1.0');

  program
    .command('init')
    .description('Initialize a gh-agent workspace.')
    .option(
      '--agent-preset <preset>',
      'Preset for the default agent command: claude, codex, copilot, gemini, cursor, cline, custom.',
    )
    .option(
      '--custom-command <command>',
      'Custom default agent command template. Must include "$GH_AGENT_PROMPT".',
    )
    .action(async (options: { agentPreset?: string; customCommand?: string }) =>
      initCommand(options),
    );

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

  const task = program
    .command('task')
    .description('Inspect and manage GitHub Project task cards.');

  task
    .command('list')
    .description('List task cards from the configured GitHub Project.')
    .option(
      '--status <status>',
      'Filter by one or more statuses. Repeat or use comma-separated values.',
      parseTaskStatusFilterOption,
      [],
    )
    .option(
      '--priority <priority>',
      'Filter by priority.',
      parseTaskPriorityOption,
    )
    .option('--type <type>', 'Filter by task type.', parseTaskTypeOption)
    .option(
      '--execution-class <executionClass>',
      'Filter by execution class.',
      parseTaskExecutionClassOption,
    )
    .action(
      async (options: {
        status: Array<'ready' | 'doing' | 'waiting' | 'done'>;
        priority?: 'P1' | 'P2' | 'P3';
        type?: 'interaction' | 'execution';
        executionClass?: 'light' | 'heavy';
      }) =>
        taskListCommand({
          statuses: options.status,
          priority: options.priority,
          type: options.type,
          executionClass: options.executionClass,
        }),
    );

  task
    .command('show')
    .description('Show a full task card by GitHub Project item id.')
    .argument('<taskId>', 'A GitHub Project item id.')
    .action(async (taskId: string) => taskShowCommand(taskId));

  task
    .command('create')
    .description('Create a draft task card in the configured GitHub Project.')
    .requiredOption('--title <title>', 'Task title.')
    .requiredOption('--status <status>', 'Task status.', parseTaskStatusOption)
    .option('--priority <priority>', 'Task priority.', parseTaskPriorityOption)
    .option('--type <type>', 'Task type.', parseTaskTypeOption)
    .option(
      '--execution-class <executionClass>',
      'Task execution class.',
      parseTaskExecutionClassOption,
    )
    .option('--source-link <url>', 'Canonical source link for the task.')
    .option('--next-action <text>', 'Next action for the task.')
    .option('--short-note <text>', 'Short note for the task.')
    .action(
      async (options: {
        title: string;
        status: 'ready' | 'doing' | 'waiting' | 'done';
        priority?: 'P1' | 'P2' | 'P3';
        type?: 'interaction' | 'execution';
        executionClass?: 'light' | 'heavy';
        sourceLink?: string;
        nextAction?: string;
        shortNote?: string;
      }) => taskCreateCommand(options),
    );

  task
    .command('update')
    .description('Update fields on a task card by GitHub Project item id.')
    .argument('<taskId>', 'A GitHub Project item id.')
    .option('--title <title>', 'Task title.')
    .option('--status <status>', 'Task status.', parseTaskStatusOption)
    .option('--priority <priority>', 'Task priority.', parseTaskPriorityOption)
    .option('--type <type>', 'Task type.', parseTaskTypeOption)
    .option(
      '--execution-class <executionClass>',
      'Task execution class.',
      parseTaskExecutionClassOption,
    )
    .option('--source-link <url>', 'Canonical source link for the task.')
    .option('--next-action <text>', 'Next action for the task.')
    .option('--short-note <text>', 'Short note for the task.')
    .action(
      async (
        taskId: string,
        options: {
          title?: string;
          status?: 'ready' | 'doing' | 'waiting' | 'done';
          priority?: 'P1' | 'P2' | 'P3';
          type?: 'interaction' | 'execution';
          executionClass?: 'light' | 'heavy';
          sourceLink?: string;
          nextAction?: string;
          shortNote?: string;
        },
      ) => taskUpdateCommand(taskId, options),
    );

  task
    .command('ready')
    .description('Force-set task cards to Ready.')
    .argument('<taskId...>', 'One or more GitHub Project item ids.')
    .action(async (taskIds: string[]) => taskReadyCommand(taskIds));

  task
    .command('wait')
    .description('Force-set task cards to Waiting.')
    .argument('<taskId...>', 'One or more GitHub Project item ids.')
    .action(async (taskIds: string[]) => taskWaitCommand(taskIds));

  task
    .command('doing')
    .description('Force-set task cards to Doing.')
    .argument('<taskId...>', 'One or more GitHub Project item ids.')
    .action(async (taskIds: string[]) => taskDoingCommand(taskIds));

  task
    .command('done')
    .description('Force-set task cards to Done.')
    .argument('<taskId...>', 'One or more GitHub Project item ids.')
    .action(async (taskIds: string[]) => taskDoneCommand(taskIds));

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
