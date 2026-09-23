export interface SentinelDaemonStatus {
  name: string;
  role: string;
  status: 'active' | 'scanning' | 'idle' | 'warning';
  lastRun: string;
  resolutionsCount: number;
}

export interface SentinelLogEntry {
  time: string;
  type: 'SYS' | 'HEAL' | 'ALERT' | 'SECURITY';
  message: string;
  details?: any;
}

export interface SentinelHealthMatrix {
  healthScore: number;
  activeDaemons: number;
  autoResolutionsCount: number;
  tenantIsolationEnforced: boolean;
  statusText: string;
}
