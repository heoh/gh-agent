import { execFile, spawn } from 'node:child_process';

import type {
  Config,
  EnsuredGitHubProject,
  GitHubAuthStatus,
  GitHubProjectConfig,
  GitHubSignalClient,
  SignalSummary,
} from './types.js';
import type { WorkspacePaths } from './workspace.js';

const ACTIONABLE_STATUS_NAMES = new Set(['Ready', 'Doing']);
const REQUIRED_STATUS_OPTIONS = ['Ready', 'Doing', 'Waiting', 'Done'] as const;
const DEFAULT_PROJECT_TITLE = 'gh-agent';

interface GhExecutionResult {
  stdout: string;
  stderr: string;
}

interface NotificationThread {
  id?: string;
}

interface ViewerProjectsResponse {
  data?: {
    viewer?: {
      id?: string;
      projectsV2?: {
        nodes?: ProjectNode[];
      } | null;
    } | null;
  };
}

interface ProjectNode {
  id?: string;
  title?: string;
  url?: string;
  fields?: {
    nodes?: ProjectFieldNode[];
  } | null;
  items?: {
    nodes?: ProjectItemNode[];
  } | null;
}

interface ProjectItemNode {
  fieldValues?: {
    nodes?: ProjectFieldValueNode[];
  } | null;
}

interface ProjectFieldValueNode {
  name?: string | null;
  field?: {
    id?: string | null;
    name?: string | null;
  } | null;
}

interface ProjectFieldNode {
  id?: string;
  name?: string;
  dataType?: string;
  options?: Array<{
    id?: string;
    name?: string;
  }> | null;
}

interface ProjectNodeResponse {
  data?: {
    node?: ProjectNode | null;
  };
}

interface CreateProjectResponse {
  data?: {
    createProjectV2?: {
      projectV2?: ProjectNode | null;
    } | null;
  };
}

interface CreateFieldResponse {
  data?: {
    createProjectV2Field?: {
      projectV2Field?: ProjectFieldNode | null;
    } | null;
  };
}

interface UpdateFieldResponse {
  data?: {
    updateProjectV2Field?: {
      projectV2Field?: ProjectFieldNode | null;
    } | null;
  };
}

export class GitHubAuthError extends Error {}

export class GitHubRuntimeError extends Error {}

export class GitHubConfigError extends Error {}

export class GitHubBootstrapError extends Error {
  constructor(
    message: string,
    readonly stage: 'create_project' | 'load_project' | 'bootstrap_fields',
  ) {
    super(message);
  }
}

function createGhEnvironment(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GH_CONFIG_DIR: paths.ghConfigDir,
  };
}

function runGhCommand(
  args: string[],
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
): Promise<GhExecutionResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      args,
      {
        env: createGhEnvironment(paths),
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          const stderrText = stderr.toString().trim();
          const message = stderrText.length > 0 ? stderrText : error.message;

          if (
            /not logged into|authentication failed|run:\s+gh auth login|gh auth login|gh_token/i.test(
              message,
            )
          ) {
            reject(new GitHubAuthError(message));
            return;
          }

          reject(new GitHubRuntimeError(message));
          return;
        }

        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
      },
    );
  });
}

function runGhInteractiveCommand(
  args: string[],
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, {
      env: createGhEnvironment(paths),
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      reject(new GitHubRuntimeError(error.message));
    });

    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new GitHubRuntimeError(
          signal === null
            ? `gh ${args.join(' ')} exited with code ${code ?? 1}`
            : `gh ${args.join(' ')} exited with signal ${signal}`,
        ),
      );
    });
  });
}

async function runGhGraphql<T>(
  query: string,
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  fields: Record<string, string> = {},
): Promise<T> {
  const args = ['api', 'graphql', '-f', `query=${query}`];

  for (const [key, value] of Object.entries(fields)) {
    args.push('-F', `${key}=${value}`);
  }

  const { stdout } = await runGhCommand(args, paths);
  return JSON.parse(stdout) as T;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function countUnreadNotifications(stdout: string): number {
  const parsed = JSON.parse(stdout) as
    | NotificationThread[]
    | NotificationThread[][];

  if (!Array.isArray(parsed)) {
    return 0;
  }

  if (parsed.every((item) => Array.isArray(item))) {
    return (parsed as NotificationThread[][]).reduce(
      (total, page) => total + page.length,
      0,
    );
  }

  return (parsed as NotificationThread[]).length;
}

function assertProjectNode(
  project: ProjectNode | null | undefined,
  message: string,
): ProjectNode {
  if (
    project === null ||
    project === undefined ||
    typeof project.id !== 'string' ||
    typeof project.title !== 'string' ||
    typeof project.url !== 'string'
  ) {
    throw new GitHubRuntimeError(message);
  }

  return project;
}

function createProjectFieldMap(
  project: ProjectNode,
): Map<string, ProjectFieldNode> {
  const fieldMap = new Map<string, ProjectFieldNode>();

  for (const field of project.fields?.nodes ?? []) {
    if (typeof field.name === 'string') {
      fieldMap.set(field.name, field);
    }
  }

  return fieldMap;
}

function requireFieldId(
  field: ProjectFieldNode | undefined,
  fieldName: string,
): string {
  if (typeof field?.id !== 'string') {
    throw new GitHubRuntimeError(
      `GitHub Project field ${fieldName} is missing an id`,
    );
  }

  return field.id;
}

function requireSingleSelectField(
  field: ProjectFieldNode | undefined,
  fieldName: string,
): ProjectFieldNode {
  if (field === undefined) {
    throw new GitHubRuntimeError(
      `GitHub Project field ${fieldName} was not created`,
    );
  }

  if (field.dataType !== 'SINGLE_SELECT') {
    throw new GitHubConfigError(
      `GitHub Project field "${fieldName}" must be a single-select field. Run gh-agent init after fixing the project schema.`,
    );
  }

  return field;
}

function requireTextField(
  field: ProjectFieldNode | undefined,
  fieldName: string,
): ProjectFieldNode {
  if (field === undefined) {
    throw new GitHubRuntimeError(
      `GitHub Project field ${fieldName} was not created`,
    );
  }

  if (field.dataType !== 'TEXT') {
    throw new GitHubConfigError(
      `GitHub Project field "${fieldName}" must be a text field. Run gh-agent init after fixing the project schema.`,
    );
  }

  return field;
}

function requireStatusOptionIds(
  field: ProjectFieldNode,
): GitHubProjectConfig['projectStatusOptionIds'] {
  const optionMap = new Map<string, string>();

  for (const option of field.options ?? []) {
    if (typeof option?.name === 'string' && typeof option.id === 'string') {
      optionMap.set(option.name, option.id);
    }
  }

  const ready = optionMap.get('Ready');
  const doing = optionMap.get('Doing');
  const waiting = optionMap.get('Waiting');
  const done = optionMap.get('Done');

  if (
    ready === undefined ||
    doing === undefined ||
    waiting === undefined ||
    done === undefined
  ) {
    throw new GitHubConfigError(
      'GitHub Project Status field must contain Ready, Doing, Waiting, and Done options. Run gh-agent init after fixing the project schema.',
    );
  }

  return {
    ready,
    doing,
    waiting,
    done,
  };
}

function hasRequiredStatusOptions(field: ProjectFieldNode): boolean {
  try {
    void requireStatusOptionIds(field);
    return true;
  } catch (error) {
    if (error instanceof GitHubConfigError) {
      return false;
    }

    throw error;
  }
}

function buildProjectConfig(project: ProjectNode): GitHubProjectConfig {
  const fields = createProjectFieldMap(project);
  const statusField = requireSingleSelectField(fields.get('Status'), 'Status');
  const priorityField = requireTextField(fields.get('Priority'), 'Priority');
  const typeField = requireTextField(fields.get('Type'), 'Type');
  const sourceLinkField = requireTextField(
    fields.get('Source Link'),
    'Source Link',
  );
  const nextActionField = requireTextField(
    fields.get('Next Action'),
    'Next Action',
  );
  const shortNoteField = requireTextField(
    fields.get('Short Note'),
    'Short Note',
  );

  return {
    projectId: project.id as string,
    projectTitle: project.title as string,
    projectUrl: project.url as string,
    projectFieldIds: {
      status: requireFieldId(statusField, 'Status'),
      priority: requireFieldId(priorityField, 'Priority'),
      type: requireFieldId(typeField, 'Type'),
      sourceLink: requireFieldId(sourceLinkField, 'Source Link'),
      nextAction: requireFieldId(nextActionField, 'Next Action'),
      shortNote: requireFieldId(shortNoteField, 'Short Note'),
    },
    projectStatusOptionIds: requireStatusOptionIds(statusField),
  };
}

function countActionableProjectItems(project: ProjectNode): number {
  const items = project.items?.nodes ?? [];

  return items.filter((item) =>
    (item.fieldValues?.nodes ?? []).some(
      (fieldValue) =>
        fieldValue.field?.name === 'Status' &&
        typeof fieldValue.name === 'string' &&
        ACTIONABLE_STATUS_NAMES.has(fieldValue.name),
    ),
  ).length;
}

function assertConfiguredProject(config: Config): void {
  if (
    config.projectId === null ||
    config.projectTitle === null ||
    config.projectUrl === null ||
    config.projectFieldIds.status === null ||
    config.projectFieldIds.priority === null ||
    config.projectFieldIds.type === null ||
    config.projectFieldIds.sourceLink === null ||
    config.projectFieldIds.nextAction === null ||
    config.projectFieldIds.shortNote === null ||
    config.projectStatusOptionIds.ready === null ||
    config.projectStatusOptionIds.doing === null ||
    config.projectStatusOptionIds.waiting === null ||
    config.projectStatusOptionIds.done === null
  ) {
    throw new GitHubConfigError(
      'GitHub Project is not configured for this workspace. Run gh-agent init.',
    );
  }
}

async function getUnreadCount(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
): Promise<number> {
  const { stdout } = await runGhCommand(
    ['api', 'notifications?per_page=100', '--paginate', '--slurp'],
    paths,
  );

  return countUnreadNotifications(stdout);
}

async function fetchViewerProjects(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
): Promise<ViewerProjectsResponse> {
  const query = `
    query ViewerProjects {
      viewer {
        id
        projectsV2(first: 20) {
          nodes {
            id
            title
            url
            fields(first: 20) {
              nodes {
                ... on ProjectV2FieldCommon {
                  id
                  name
                  dataType
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  dataType
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  return runGhGraphql<ViewerProjectsResponse>(query, paths);
}

async function fetchProjectById(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  projectId: string,
): Promise<ProjectNode> {
  const query = `
    query ProjectById($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          id
          title
          url
          fields(first: 20) {
            nodes {
              ... on ProjectV2FieldCommon {
                id
                name
                dataType
              }
              ... on ProjectV2SingleSelectField {
                id
                name
                dataType
                options {
                  id
                  name
                }
              }
            }
          }
          items(first: 100) {
            nodes {
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      ... on ProjectV2SingleSelectField {
                        id
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await runGhGraphql<ProjectNodeResponse>(query, paths, {
    projectId,
  });

  return assertProjectNode(
    response.data?.node,
    'Configured GitHub Project was not found. Run gh-agent init.',
  );
}

async function fetchProjectByIdWithRetry(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  projectId: string,
  attempts = 5,
): Promise<ProjectNode> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchProjectById(paths, projectId);
    } catch (error) {
      lastError = error;

      if (attempt === attempts) {
        break;
      }

      await sleep(250 * attempt);
    }
  }

  throw new GitHubBootstrapError(
    `GitHub Project was created but could not be loaded yet: ${
      lastError instanceof Error ? lastError.message : 'Unknown GitHub error'
    }`,
    'load_project',
  );
}

async function createProject(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  ownerId: string,
  title: string,
): Promise<ProjectNode> {
  const query = `
    mutation CreateProject($ownerId: ID!, $title: String!) {
      createProjectV2(input: { ownerId: $ownerId, title: $title }) {
        projectV2 {
          id
          title
          url
          fields(first: 20) {
            nodes {
              ... on ProjectV2FieldCommon {
                id
                name
                dataType
              }
            }
          }
        }
      }
    }
  `;

  const response = await runGhGraphql<CreateProjectResponse>(query, paths, {
    ownerId,
    title,
  });

  return assertProjectNode(
    response.data?.createProjectV2?.projectV2,
    'Failed to create the gh-agent GitHub Project.',
  );
}

async function createTextField(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  projectId: string,
  fieldName: string,
): Promise<ProjectFieldNode> {
  const query = `
    mutation CreateTextField($projectId: ID!, $fieldName: String!) {
      createProjectV2Field(
        input: { projectId: $projectId, name: $fieldName, dataType: TEXT }
      ) {
        projectV2Field {
          ... on ProjectV2FieldCommon {
            id
            name
            dataType
          }
        }
      }
    }
  `;

  const response = await runGhGraphql<CreateFieldResponse>(query, paths, {
    projectId,
    fieldName,
  });
  const field = response.data?.createProjectV2Field?.projectV2Field;

  if (
    field === null ||
    field === undefined ||
    typeof field.id !== 'string' ||
    typeof field.name !== 'string'
  ) {
    throw new GitHubRuntimeError(
      `Failed to create GitHub Project field ${fieldName}.`,
    );
  }

  return field;
}

async function createStatusField(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  projectId: string,
): Promise<ProjectFieldNode> {
  const query = `
    mutation CreateStatusField($projectId: ID!) {
      createProjectV2Field(
        input: {
          projectId: $projectId
          name: "Status"
          dataType: SINGLE_SELECT
          singleSelectOptions: [
            { name: "Ready", color: GREEN, description: "Work ready to start now" }
            { name: "Doing", color: BLUE, description: "Work currently in progress" }
            { name: "Waiting", color: YELLOW, description: "Work blocked on outside input" }
            { name: "Done", color: GRAY, description: "Work completed for now" }
          ]
        }
      ) {
        projectV2Field {
          ... on ProjectV2SingleSelectField {
            id
            name
            dataType
            options {
              id
              name
            }
          }
        }
      }
    }
  `;

  const response = await runGhGraphql<CreateFieldResponse>(query, paths, {
    projectId,
  });
  const field = response.data?.createProjectV2Field?.projectV2Field;

  if (
    field === null ||
    field === undefined ||
    typeof field.id !== 'string' ||
    typeof field.name !== 'string'
  ) {
    throw new GitHubRuntimeError(
      'Failed to create GitHub Project field Status.',
    );
  }

  return field;
}

async function updateStatusFieldOptions(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  fieldId: string,
): Promise<ProjectFieldNode> {
  const query = `
    mutation UpdateStatusField($fieldId: ID!) {
      updateProjectV2Field(
        input: {
          fieldId: $fieldId
          singleSelectOptions: [
            { name: "Ready", color: GREEN, description: "Work ready to start now" }
            { name: "Doing", color: BLUE, description: "Work currently in progress" }
            { name: "Waiting", color: YELLOW, description: "Work blocked on outside input" }
            { name: "Done", color: GRAY, description: "Work completed for now" }
          ]
        }
      ) {
        projectV2Field {
          ... on ProjectV2SingleSelectField {
            id
            name
            dataType
            options {
              id
              name
            }
          }
        }
      }
    }
  `;

  const response = await runGhGraphql<UpdateFieldResponse>(query, paths, {
    fieldId,
  });
  const field = response.data?.updateProjectV2Field?.projectV2Field;

  if (
    field === null ||
    field === undefined ||
    typeof field.id !== 'string' ||
    typeof field.name !== 'string'
  ) {
    throw new GitHubRuntimeError(
      'Failed to update GitHub Project field Status.',
    );
  }

  return field;
}

async function ensureProjectFields(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  project: ProjectNode,
): Promise<ProjectNode> {
  const projectId =
    typeof project.id === 'string'
      ? project.id
      : (() => {
          throw new GitHubRuntimeError('GitHub Project is missing an id.');
        })();
  const hydratedProject = await fetchProjectByIdWithRetry(paths, projectId);
  const fields = createProjectFieldMap(hydratedProject);

  const existingStatus = fields.get('Status');
  if (
    existingStatus !== undefined &&
    existingStatus.dataType !== 'SINGLE_SELECT'
  ) {
    throw new GitHubConfigError(
      'GitHub Project field "Status" must be a single-select field. Run gh-agent init after fixing the project schema.',
    );
  }

  for (const fieldName of [
    'Priority',
    'Type',
    'Source Link',
    'Next Action',
    'Short Note',
  ]) {
    const field = fields.get(fieldName);
    if (field !== undefined && field.dataType !== 'TEXT') {
      throw new GitHubConfigError(
        `GitHub Project field "${fieldName}" must be a text field. Run gh-agent init after fixing the project schema.`,
      );
    }
  }

  if (existingStatus === undefined) {
    await createStatusField(paths, projectId);
  } else if (!hasRequiredStatusOptions(existingStatus)) {
    await updateStatusFieldOptions(
      paths,
      requireFieldId(existingStatus, 'Status'),
    );
  }

  if (!fields.has('Priority')) {
    await createTextField(paths, projectId, 'Priority');
  }
  if (!fields.has('Type')) {
    await createTextField(paths, projectId, 'Type');
  }
  if (!fields.has('Source Link')) {
    await createTextField(paths, projectId, 'Source Link');
  }
  if (!fields.has('Next Action')) {
    await createTextField(paths, projectId, 'Next Action');
  }
  if (!fields.has('Short Note')) {
    await createTextField(paths, projectId, 'Short Note');
  }

  return fetchProjectByIdWithRetry(paths, projectId);
}

class DefaultGitHubSignalClient implements GitHubSignalClient {
  async login(paths: Pick<WorkspacePaths, 'ghConfigDir'>): Promise<void> {
    await runGhInteractiveCommand(
      ['auth', 'login', '--hostname', 'github.com', '--scopes', 'project'],
      paths,
    );
  }

  async refreshProjectScopes(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  ): Promise<void> {
    await runGhInteractiveCommand(
      ['auth', 'refresh', '--hostname', 'github.com', '--scopes', 'project'],
      paths,
    );
  }

  async ensureProject(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    projectTitle = DEFAULT_PROJECT_TITLE,
  ): Promise<EnsuredGitHubProject> {
    const viewerProjects = await fetchViewerProjects(paths);
    const viewer = viewerProjects.data?.viewer;

    if (typeof viewer?.id !== 'string') {
      throw new GitHubRuntimeError('Failed to load the GitHub viewer profile.');
    }

    const existingProject = (viewer.projectsV2?.nodes ?? []).find(
      (project) => project.title === projectTitle,
    );
    let project: ProjectNode;

    if (existingProject === undefined) {
      try {
        project = await createProject(paths, viewer.id, projectTitle);
      } catch (error) {
        throw new GitHubBootstrapError(
          `Failed to create the gh-agent GitHub Project: ${
            error instanceof Error ? error.message : 'Unknown GitHub error'
          }`,
          'create_project',
        );
      }
    } else {
      project = assertProjectNode(
        existingProject,
        'Failed to read the gh-agent GitHub Project.',
      );
    }

    let hydratedProject: ProjectNode;

    try {
      hydratedProject = await ensureProjectFields(paths, project);
    } catch (error) {
      if (error instanceof GitHubBootstrapError) {
        throw error;
      }

      throw new GitHubBootstrapError(
        `Failed while preparing GitHub Project fields: ${
          error instanceof Error ? error.message : 'Unknown GitHub error'
        }`,
        'bootstrap_fields',
      );
    }

    return {
      wasCreated: existingProject === undefined,
      ...buildProjectConfig(hydratedProject),
    };
  }

  async getSignalSummary(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    config: Config,
  ): Promise<SignalSummary> {
    assertConfiguredProject(config);

    const unreadCount = await getUnreadCount(paths);
    const project = await fetchProjectById(paths, config.projectId as string);
    const projectConfig = buildProjectConfig(project);

    if (
      projectConfig.projectFieldIds.status !== config.projectFieldIds.status
    ) {
      throw new GitHubConfigError(
        'Configured GitHub Project Status field changed. Run gh-agent init.',
      );
    }

    return {
      unreadCount,
      actionableCount: countActionableProjectItems(project),
    };
  }

  async getAuthStatus(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  ): Promise<GitHubAuthStatus> {
    try {
      await runGhCommand(['auth', 'status', '--hostname', 'github.com'], paths);

      return {
        kind: 'authenticated',
        detail: 'gh auth status succeeded for github.com',
        ghConfigDir: paths.ghConfigDir,
      };
    } catch (error) {
      if (error instanceof GitHubAuthError) {
        return {
          kind: 'unauthenticated',
          detail: error.message,
          ghConfigDir: paths.ghConfigDir,
        };
      }

      return {
        kind: 'unknown',
        detail:
          error instanceof Error
            ? error.message
            : 'unable to determine GitHub auth status',
        ghConfigDir: paths.ghConfigDir,
      };
    }
  }
}

export function createGitHubSignalClient(): GitHubSignalClient {
  return new DefaultGitHubSignalClient();
}
