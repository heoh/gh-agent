import type { GitHubAuthStatus } from '../types.js';
import type { WorkspacePaths } from '../workspace.js';

export const ACTIONABLE_STATUS_NAMES = new Set(['Ready', 'Doing']);
export const DEFAULT_PROJECT_TITLE = 'gh-agent';
export const TASK_PRIORITY_VALUES = new Set(['P1', 'P2', 'P3']);
export const TASK_TYPE_VALUES = new Set(['interaction', 'execution']);
export const TASK_EXECUTION_CLASS_VALUES = new Set(['light', 'heavy']);

export interface GhAuthClient {
  login(paths: Pick<WorkspacePaths, 'ghConfigDir'>): Promise<void>;
  refreshProjectScopes(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  ): Promise<void>;
  getAuthStatus(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  ): Promise<GitHubAuthStatus>;
  getToken(paths: Pick<WorkspacePaths, 'ghConfigDir'>): Promise<string>;
}

export interface GitHubApiClient {
  listUnreadNotifications(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  ): Promise<NotificationThread[]>;
  getNotificationThread(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    threadId: string,
  ): Promise<NotificationThread>;
  getResourceByUrl(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    url: string,
  ): Promise<NotificationSubjectResource>;
  markMailboxThreadAsRead(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    threadId: string,
  ): Promise<void>;
  graphql<T>(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    query: string,
    variables?: Record<string, string>,
  ): Promise<T>;
}

export interface NotificationThread {
  id?: string;
  reason?: string;
  unread?: boolean;
  updated_at?: string;
  repository?: {
    full_name?: string;
    name?: string;
    owner?: {
      login?: string;
    };
  } | null;
  subject?: {
    title?: string;
    type?: string;
    url?: string;
  } | null;
}

export interface NotificationSubjectResource {
  html_url?: string;
  node_id?: string;
  title?: string;
}

export interface ViewerProjectsResponse {
  data?: {
    viewer?: {
      id?: string;
      projectsV2?: {
        nodes?: ProjectNode[];
      } | null;
    } | null;
  };
}

export interface ProjectNode {
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

export interface ProjectItemNode {
  id?: string;
  content?: {
    __typename?: string | null;
    title?: string | null;
  } | null;
  fieldValues?: {
    nodes?: ProjectFieldValueNode[];
  } | null;
}

export interface ProjectFieldValueNode {
  name?: string | null;
  text?: string | null;
  field?: {
    id?: string | null;
    name?: string | null;
  } | null;
}

export interface ProjectFieldNode {
  id?: string;
  name?: string;
  dataType?: string;
  options?: Array<{
    id?: string;
    name?: string;
  }> | null;
}

export interface ProjectNodeResponse {
  data?: {
    node?: ProjectNode | null;
  };
}

export interface CreateProjectResponse {
  data?: {
    createProjectV2?: {
      projectV2?: ProjectNode | null;
    } | null;
  };
}

export interface CreateFieldResponse {
  data?: {
    createProjectV2Field?: {
      projectV2Field?: ProjectFieldNode | null;
    } | null;
  };
}

export interface UpdateFieldResponse {
  data?: {
    updateProjectV2Field?: {
      projectV2Field?: ProjectFieldNode | null;
    } | null;
  };
}

export interface AddDraftProjectItemResponse {
  data?: {
    addProjectV2DraftIssue?: {
      projectItem?: {
        id?: string;
      } | null;
    } | null;
  };
}
