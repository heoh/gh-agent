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
  ensureProject(
    paths: { ghConfigDir: string },
    projectTitle: string,
  ): Promise<EnsuredGitHubProject>;
  getSignalSummary(
    paths: { ghConfigDir: string },
    config: Config,
  ): Promise<SignalSummary>;
  getAuthStatus(paths: { ghConfigDir: string }): Promise<GitHubAuthStatus>;
}
