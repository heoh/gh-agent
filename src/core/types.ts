export type AgentMode = 'sleeping' | 'active';

export interface ProjectFieldIds {
  status: string | null;
  priority: string | null;
  type: string | null;
  sourceLink: string | null;
  nextAction: string | null;
  shortNote: string | null;
}

export interface ProjectStatusOptionIds {
  ready: string | null;
  doing: string | null;
  waiting: string | null;
  done: string | null;
}

export interface Config {
  agentId: string;
  pollIntervalMs: number;
  debounceMs: number;
  projectId: string | null;
  projectTitle: string | null;
  projectUrl: string | null;
  projectFieldIds: ProjectFieldIds;
  projectStatusOptionIds: ProjectStatusOptionIds;
}

export interface SessionState {
  agentId: string;
  currentMode: AgentMode;
  currentSessionId: string | null;
  nextWakeNotBefore: string | null;
  lastSessionStartedAt: string | null;
  lastSessionEndedAt: string | null;
  lastNotificationPollAt: string | null;
  lastSeenNotificationCursor: string | null;
}

export interface LockInfo {
  pid: number;
  startedAt: string;
  workspacePath: string;
}

export interface SignalSummary {
  unreadCount: number;
  actionableCount: number;
}

export interface MailboxNotification {
  id: string;
  repositoryFullName: string;
  title: string;
  reason: string;
  type: string | null;
  updatedAt: string | null;
}

export type MailboxPromotionStatus = 'ready' | 'waiting';

export interface MailboxThreadSubject {
  title: string;
  type: string | null;
  url: string;
}

export interface MailboxThreadDetail {
  id: string;
  repositoryFullName: string;
  reason: string;
  isUnread: boolean;
  updatedAt: string | null;
  subject: MailboxThreadSubject;
  contentNodeId?: string | null;
}

export interface MailboxPromotionTarget {
  threadId: string;
  title: string;
  repositoryFullName: string;
  sourceUrl: string;
  contentNodeId: string | null;
}

export interface MailboxProjectCard {
  id: string;
  projectId: string;
  title: string;
  sourceLink: string;
  status: string;
}

export interface MailboxPromotionSuccessResult {
  threadId: string;
  status: MailboxPromotionStatus;
  ok: true;
  card: MailboxProjectCard;
}

export interface MailboxPromotionErrorResult {
  threadId: string;
  status: MailboxPromotionStatus;
  ok: false;
  error: string;
  errorCategory: 'auth' | 'config' | 'runtime';
}

export type MailboxPromotionResult =
  | MailboxPromotionSuccessResult
  | MailboxPromotionErrorResult;

export interface MailboxIgnoreSuccessResult {
  threadId: string;
  ok: true;
  read: true;
}

export interface MailboxIgnoreErrorResult {
  threadId: string;
  ok: false;
  error: string;
  errorCategory: 'auth' | 'config' | 'runtime';
}

export type MailboxIgnoreResult =
  | MailboxIgnoreSuccessResult
  | MailboxIgnoreErrorResult;

export interface MailboxShowResult {
  threadId: string;
  repositoryFullName: string;
  title: string;
  reason: string;
  type: string | null;
  unread: boolean;
  updatedAt: string | null;
  sourceUrl: string;
  relatedCards: MailboxProjectCard[];
}

export interface WakeDecision {
  shouldWake: boolean;
  blockedByCooldown: boolean;
  reason: string;
  triggerKind: 'unread' | 'actionable' | 'both' | 'none';
}

export interface GitHubAuthStatus {
  kind: 'authenticated' | 'unauthenticated' | 'unknown';
  detail: string;
  ghConfigDir: string;
}

export interface GitHubProjectConfig {
  projectId: string;
  projectTitle: string;
  projectUrl: string;
  projectFieldIds: {
    status: string;
    priority: string;
    type: string;
    sourceLink: string;
    nextAction: string;
    shortNote: string;
  };
  projectStatusOptionIds: {
    ready: string;
    doing: string;
    waiting: string;
    done: string;
  };
}

export interface EnsuredGitHubProject extends GitHubProjectConfig {
  wasCreated: boolean;
}

export interface GitHubSignalClient {
  login(paths: { ghConfigDir: string }): Promise<void>;
  refreshProjectScopes(paths: { ghConfigDir: string }): Promise<void>;
  ensureProject(
    paths: { ghConfigDir: string },
    projectTitle: string,
  ): Promise<EnsuredGitHubProject>;
  getSignalSummary(
    paths: { ghConfigDir: string },
    config: Config,
  ): Promise<SignalSummary>;
  listMailboxNotifications(
    paths: { ghConfigDir: string },
    options?: { limit?: number },
  ): Promise<MailboxNotification[]>;
  getMailboxThreadDetail(
    paths: { ghConfigDir: string },
    threadId: string,
  ): Promise<MailboxThreadDetail>;
  promoteMailboxThread(
    paths: { ghConfigDir: string },
    config: Config,
    target: MailboxPromotionTarget,
    status: MailboxPromotionStatus,
  ): Promise<MailboxProjectCard>;
  markMailboxThreadAsRead(
    paths: { ghConfigDir: string },
    threadId: string,
  ): Promise<void>;
  listRelatedMailboxCards(
    paths: { ghConfigDir: string },
    config: Config,
    sourceUrl: string,
  ): Promise<MailboxProjectCard[]>;
  getAuthStatus(paths: { ghConfigDir: string }): Promise<GitHubAuthStatus>;
}
