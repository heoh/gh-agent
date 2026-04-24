import type {
  Config,
  GitHubProjectConfig,
  MailboxPromotionStatus,
  TaskStatus,
} from '../types.js';
import type { WorkspacePaths } from '../workspace.js';
import { defaultGitHubApiClient } from './api.js';
import {
  GitHubBootstrapError,
  GitHubConfigError,
  GitHubRuntimeError,
} from './errors.js';
import type {
  AddDraftProjectItemResponse,
  AddProjectItemResponse,
  CreateFieldResponse,
  CreateProjectResponse,
  ProjectFieldNode,
  ProjectNode,
  ProjectNodeResponse,
  UpdateFieldResponse,
  ViewerProjectsResponse,
} from './internal.js';

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runGitHubGraphql<T>(
  query: string,
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  fields: Record<string, string> = {},
): Promise<T> {
  return defaultGitHubApiClient.graphql<T>(paths, query, fields);
}

export function assertConfiguredProject(config: Config): void {
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

export function buildProjectConfig(project: ProjectNode): GitHubProjectConfig {
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

export function getStatusOptionId(
  config: Config,
  status: TaskStatus | MailboxPromotionStatus,
): string {
  assertConfiguredProject(config);

  const optionId = (() => {
    switch (status) {
      case 'ready':
        return config.projectStatusOptionIds.ready;
      case 'doing':
        return config.projectStatusOptionIds.doing;
      case 'waiting':
        return config.projectStatusOptionIds.waiting;
      case 'done':
        return config.projectStatusOptionIds.done;
    }
  })();

  if (optionId === null) {
    throw new GitHubConfigError(
      `GitHub Project Status option "${status}" is not configured. Run gh-agent init.`,
    );
  }

  return optionId;
}

export function getRequiredProjectFieldId(
  fieldId: string | null,
  fieldName: string,
): string {
  if (fieldId === null) {
    throw new GitHubConfigError(
      `GitHub Project field "${fieldName}" is not configured. Run gh-agent init.`,
    );
  }

  return fieldId;
}

export async function addProjectItemFromContent(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  projectId: string,
  contentNodeId: string,
): Promise<string> {
  const query = `
    mutation AddProjectItem($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item {
          id
        }
      }
    }
  `;

  const response = await runGitHubGraphql<AddProjectItemResponse>(
    query,
    paths,
    {
      projectId,
      contentId: contentNodeId,
    },
  );
  const itemId = response.data?.addProjectV2ItemById?.item?.id;

  if (typeof itemId !== 'string' || itemId.length === 0) {
    throw new GitHubRuntimeError(
      'Failed to add the GitHub item to the Project.',
    );
  }

  return itemId;
}

export async function addProjectDraftItem(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  projectId: string,
  title: string,
): Promise<string> {
  const query = `
    mutation AddDraftProjectItem($projectId: ID!, $title: String!) {
      addProjectV2DraftIssue(input: { projectId: $projectId, title: $title }) {
        projectItem {
          id
        }
      }
    }
  `;

  const response = await runGitHubGraphql<AddDraftProjectItemResponse>(
    query,
    paths,
    {
      projectId,
      title,
    },
  );
  const itemId = response.data?.addProjectV2DraftIssue?.projectItem?.id;

  if (typeof itemId !== 'string' || itemId.length === 0) {
    throw new GitHubRuntimeError(
      'Failed to create a draft GitHub Project item from the notification.',
    );
  }

  return itemId;
}

export async function setProjectItemStatus(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  projectId: string,
  itemId: string,
  fieldId: string,
  optionId: string,
): Promise<void> {
  const query = `
    mutation SetProjectItemStatus(
      $projectId: ID!
      $itemId: ID!
      $fieldId: ID!
      $optionId: String!
    ) {
      updateProjectV2ItemFieldValue(
        input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { singleSelectOptionId: $optionId }
        }
      ) {
        projectV2Item {
          id
        }
      }
    }
  `;

  await runGitHubGraphql(query, paths, {
    projectId,
    itemId,
    fieldId,
    optionId,
  });
}

export async function setProjectItemTextField(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  projectId: string,
  itemId: string,
  fieldId: string,
  value: string,
): Promise<void> {
  const query = `
    mutation SetProjectItemTextField(
      $projectId: ID!
      $itemId: ID!
      $fieldId: ID!
      $value: String!
    ) {
      updateProjectV2ItemFieldValue(
        input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { text: $value }
        }
      ) {
        projectV2Item {
          id
        }
      }
    }
  `;

  await runGitHubGraphql(query, paths, {
    projectId,
    itemId,
    fieldId,
    value,
  });
}

export async function clearProjectItemFieldValue(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  projectId: string,
  itemId: string,
  fieldId: string,
): Promise<void> {
  const query = `
    mutation ClearProjectItemFieldValue(
      $projectId: ID!
      $itemId: ID!
      $fieldId: ID!
    ) {
      clearProjectV2ItemFieldValue(
        input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
        }
      ) {
        projectV2Item {
          id
        }
      }
    }
  `;

  await runGitHubGraphql(query, paths, {
    projectId,
    itemId,
    fieldId,
  });
}

export async function updateProjectDraftItemTitle(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  itemId: string,
  title: string,
): Promise<void> {
  const query = `
    mutation UpdateProjectDraftItemTitle($itemId: ID!, $title: String!) {
      updateProjectV2DraftIssue(input: { draftIssueId: $itemId, title: $title }) {
        draftIssue {
          id
        }
      }
    }
  `;

  await runGitHubGraphql(query, paths, {
    itemId,
    title,
  });
}

export async function fetchViewerProjects(
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

  return runGitHubGraphql<ViewerProjectsResponse>(query, paths);
}

export async function fetchProjectById(
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
              id
              content {
                ... on DraftIssue {
                  __typename
                  title
                }
                ... on Issue {
                  __typename
                  title
                }
                ... on PullRequest {
                  __typename
                  title
                }
              }
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
                  ... on ProjectV2ItemFieldTextValue {
                    text
                    field {
                      ... on ProjectV2FieldCommon {
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

  const response = await runGitHubGraphql<ProjectNodeResponse>(query, paths, {
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

export async function loadConfiguredProject(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  config: Config,
): Promise<ProjectNode> {
  assertConfiguredProject(config);

  return fetchProjectById(paths, config.projectId as string);
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

  const response = await runGitHubGraphql<CreateProjectResponse>(query, paths, {
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

  const response = await runGitHubGraphql<CreateFieldResponse>(query, paths, {
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

  const response = await runGitHubGraphql<CreateFieldResponse>(query, paths, {
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

  const response = await runGitHubGraphql<UpdateFieldResponse>(query, paths, {
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

export async function ensureProject(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  projectTitle: string,
): Promise<{ wasCreated: boolean; config: GitHubProjectConfig }> {
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
    config: buildProjectConfig(hydratedProject),
  };
}
