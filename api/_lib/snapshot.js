'use strict';

const { query } = require('./db');
const { companyDTO, tenantList } = require('./company');

// Full workspace state for the signed-in user's company.
async function buildSnapshot(company, userId) {
  const schema = company.schema_name;
  const db = { query };
  const [teams, users, tasks, dailyUpdates, auditLogs, settings, accounts] = await Promise.all([
    tenantList(db, schema, 'teams'),
    tenantList(db, schema, 'users'),
    tenantList(db, schema, 'tasks'),
    tenantList(db, schema, 'daily_updates'),
    tenantList(db, schema, 'audit_logs', { limit: 1000 }),
    tenantList(db, schema, 'settings'),
    query(
      'SELECT user_id, email, role, must_change_password, last_login_at FROM platform.accounts WHERE company_id = $1',
      [company.id]
    ),
  ]);

  const byUser = new Map(accounts.rows.map((a) => [a.user_id, a]));
  const mergedUsers = users.map((u) => {
    const a = byUser.get(u.id);
    return a
      ? { ...u, email: a.email, role: a.role, inviteStatus: a.must_change_password ? 'pending' : 'active', lastLoginAt: a.last_login_at }
      : { ...u, inviteStatus: 'no-login' };
  });

  // Audit ids are numeric strings on the server; the client store keys them as numbers.
  const audit = auditLogs
    .map((l) => ({ ...l, id: Number(l.id) }))
    .sort((a, b) => a.id - b.id);

  return {
    company: companyDTO(company),
    me: userId,
    teams,
    users: mergedUsers,
    tasks,
    daily_updates: dailyUpdates,
    audit_logs: audit,
    settings,
  };
}

module.exports = { buildSnapshot };
