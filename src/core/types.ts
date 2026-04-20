export type AgentMode = 'sleeping' | 'active';

export interface Config {
  agentId: string;
  pollIntervalMs: number;
  debounceMs: number;
}

export interface SessionState {
  agentId: string;
  currentMode: AgentMode;
  currentSessionId: string | null;
  nextWakeNotBefore: string | null;
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
