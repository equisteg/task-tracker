/**
 * Diagnostics and Defect Classification Engine
 */

export class DiagnosticsEngine {
  static classify(errorText) {
    const text = (errorText || '').toLowerCase();

    if (text.includes('orphan') || text.includes('unlinked') || text.includes('assignee')) {
      return {
        type: 'ORPHAN_TASK',
        severity: 'HIGH',
        description: 'Task detected without an active registered team member assignee.',
        remediationAction: 'Rebind orphan task to active organization Administrator / Lead.'
      };
    }

    if (text.includes('bank') || text.includes('settlement') || text.includes('account number') || text.includes('routing')) {
      return {
        type: 'CORRUPT_BANK_CONFIG',
        severity: 'CRITICAL',
        description: 'Receiving merchant bank settlement configuration missing or malformed.',
        remediationAction: 'Reconstitute verified merchant bank settlement parameters and re-lock vault.'
      };
    }

    if (text.includes('lockout') || text.includes('brute') || text.includes('too many attempts')) {
      return {
        type: 'EXPIRED_SESSION_LOCKOUT',
        severity: 'MEDIUM',
        description: 'Session lockout timer expired or corrupted.',
        remediationAction: 'Reset rate-limiting lock counters and restore verified authentication gateway.'
      };
    }

    if (text.includes('indexeddb') || text.includes('store') || text.includes('schema')) {
      return {
        type: 'SCHEMA_MISMATCH',
        severity: 'CRITICAL',
        description: 'Tenant IndexedDB object stores out of synchronization.',
        remediationAction: 'Re-initialize ACID transaction tables and apply schema migrations.'
      };
    }

    if (text.includes('tenant') || text.includes('directory') || text.includes('storage')) {
      return {
        type: 'UNINDEXED_TENANT',
        severity: 'HIGH',
        description: 'Tenant missing from local multi-tenant directory vault.',
        remediationAction: 'Register tenant ID in directory and bind isolated storage vault.'
      };
    }

    return {
      type: 'UNKNOWN',
      severity: 'MEDIUM',
      description: `Unclassified defect: ${errorText}`,
      remediationAction: 'Trigger autonomous Sentinel AI general diagnostics and self-healing.'
    };
  }
}
