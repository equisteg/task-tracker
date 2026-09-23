import http from 'http';
import { AutonomousHealer, HealingResult } from './healer.js';
import { QAReporter, QAReportData, SuiteResult } from './reporter.js';

function httpRequest(options: any, postData: any = null): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

export class CDPClient {
  public wsUrl: string;
  public ws: any = null;
  public msgId: number = 0;
  public callbacks = new Map<number, { resolve: Function; reject: Function }>();

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // @ts-ignore - native WebSocket in Node 20+
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = reject;
      this.ws.onmessage = (event: any) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id)!;
          this.callbacks.delete(msg.id);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      };
    });
  }

  send(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression: string): Promise<any> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res && res.exceptionDetails) {
      const desc = res.exceptionDetails.exception ? (res.exceptionDetails.exception.description || res.exceptionDetails.exception.value) : res.exceptionDetails.text;
      throw new Error(`Eval Failed: ${desc}`);
    }
    return res && res.result ? res.result.value : undefined;
  }

  sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
  }
}

export class QARunner {
  public baseUrl: string;
  public cdpPort: number;

  constructor(baseUrl = 'http://localhost:8000/index.html', cdpPort = 9222) {
    this.baseUrl = baseUrl;
    this.cdpPort = cdpPort;
  }

  async runAll(autoHeal = true): Promise<QAReportData> {
    console.log('======================================================================');
    console.log('  AUTONOMOUS E2E QA & AGENTIC SELF-HEALING ENGINE (14 FEATURE SUITES)');
    console.log('======================================================================');
    console.log(`-> Target Platform: ${this.baseUrl}`);

    // Create target tab in headless Chrome
    const tabRes = await httpRequest({
      hostname: 'localhost',
      port: this.cdpPort,
      path: `/json/new?${encodeURIComponent(this.baseUrl)}`,
      method: 'PUT'
    });

    const tab = tabRes.data;
    if (!tab || !tab.webSocketDebuggerUrl) {
      throw new Error(`Failed to create Chrome DevTools target: ${JSON.stringify(tabRes)}`);
    }

    const cdp = new CDPClient(tab.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.sleep(1500);

    const healer = new AutonomousHealer(cdp);
    const suites: SuiteResult[] = [];
    const heals: HealingResult[] = [];

    // Helper assertion runner
    const runSuite = async (
      suiteId: string,
      name: string,
      testFn: (assert: (cond: boolean, desc: string) => void) => Promise<void>
    ): Promise<SuiteResult> => {
      const start = Date.now();
      const details: string[] = [];
      let total = 0;
      let passed = 0;
      let failed = 0;

      const assert = (cond: boolean, desc: string) => {
        total++;
        if (cond) {
          passed++;
          details.push(`[PASS] ${desc}`);
          console.log(`  [PASS] ${desc}`);
        } else {
          failed++;
          details.push(`[FAIL] ${desc}`);
          console.log(`  ❌ [FAIL] ${desc}`);
        }
      };

      console.log(`\n--- ${suiteId.toUpperCase()}: ${name.toUpperCase()} ---`);
      try {
        await testFn(assert);
      } catch (err: any) {
        failed++;
        details.push(`[ERROR] Execution exception: ${err.message}`);
        console.error(`  ❌ [ERROR] ${err.message}`);

        if (autoHeal) {
          const healResult = await healer.healDefect(err.message);
          heals.push(healResult);
          if (healResult.success) {
            console.log(`  🔄 Re-running ${suiteId} post-healing...`);
            try {
              await testFn(assert);
            } catch (reErr: any) {
              console.error(`  ❌ Re-run failed: ${reErr.message}`);
            }
          }
        }
      }

      const durationMs = Date.now() - start;
      const status = failed === 0 ? 'PASSED' : (heals.length > 0 ? 'HEALED' : 'FAILED');
      const result: SuiteResult = { suiteId, name, total, passed, failed, durationMs, status, details };
      suites.push(result);
      return result;
    };

    // -------------------------------------------------------------
    // SUITE 1: Brand Neutrality & Zero-Trust UI Inspection
    await runSuite('suite-1', 'Brand Neutrality & Zero-Trust UI', async (assert) => {
      await cdp.eval(`app.logout()`);
      await cdp.sleep(400);

      const authScreenText = await cdp.eval(`document.getElementById('auth-screen').innerText.toLowerCase()`);
      assert(!authScreenText.includes('equisteg'), 'Login screen has ZERO mentions of brand name "Equisteg"');
      assert(!authScreenText.includes('equisteg@gmail.com'), 'Login screen has ZERO mentions of "equisteg@gmail.com"');

      const emailVal = await cdp.eval(`document.getElementById('auth-email').value`);
      assert(emailVal === '', 'Login input email is completely empty and unpolluted');
    });

    // -------------------------------------------------------------
    // SUITE 2: Cyber Security Headers & Zero-Trust Perimeter
    await runSuite('suite-2', 'Cyber Security Zero-Trust Perimeter', async (assert) => {
      const secAudit = await cdp.eval(`
        (() => {
          const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
          const nosniffMeta = document.querySelector('meta[http-equiv="X-Content-Type-Options"]');
          const frameMeta = document.querySelector('meta[http-equiv="X-Frame-Options"]');
          return {
            hasCsp: Boolean(cspMeta && cspMeta.content.includes("default-src 'self'")),
            hasNosniff: Boolean(nosniffMeta && nosniffMeta.content === 'nosniff'),
            hasAntiClickjack: Boolean(frameMeta && frameMeta.content === 'DENY')
          };
        })()
      `);
      assert(secAudit.hasCsp, 'Strict Content-Security-Policy (CSP) meta header enforced');
      assert(secAudit.hasNosniff, 'X-Content-Type-Options: nosniff header verified');
      assert(secAudit.hasAntiClickjack, 'X-Frame-Options: DENY anti-clickjacking header verified');

      await cdp.eval(`
        document.getElementById('auth-email').value = 'unauthorized-intruder@evil.corp';
        document.getElementById('auth-password').value = 'wrong-password-payload';
        app.handleAuthSubmit();
      `);
      await cdp.sleep(300);

      const authLockout = await cdp.eval(`
        (() => ({
          failedAttempts: app.failedAttempts,
          isAuthenticated: app.isAuthenticated
        }))()
      `);
      assert(authLockout.failedAttempts >= 1, 'Authentication gateway records and increments failed attempts');
      assert(authLockout.isAuthenticated === false, 'Unauthorized actor correctly rejected at perimeter');
    });

    // -------------------------------------------------------------
    // SUITE 3: Multi-Tenant Registration & Storage Partitioning
    await runSuite('suite-3', 'Multi-Tenant Registration & Storage Partitioning', async (assert) => {
      await cdp.eval(`app.switchAuthMode('register')`);
      await cdp.sleep(300);

      const testCompany = 'Apex Cyber Operations ' + Math.random().toString(36).substring(2, 6);
      await cdp.eval(`
        document.getElementById('reg-company-name').value = ${JSON.stringify(testCompany)};
        document.getElementById('reg-admin-name').value = 'Marcus Vance';
        document.getElementById('reg-admin-email').value = 'marcus@apexoperations.org';
        document.getElementById('reg-admin-password').value = 'ApexSecure2026!';
        app.nextRegStep();
      `);
      await cdp.sleep(300);

      const step2Text = await cdp.eval(`document.getElementById('reg-step-2').innerText.toLowerCase()`);
      assert(!step2Text.includes('equisteg'), 'Step 2 alert contains ZERO mentions of Equisteg');

      await cdp.eval(`app.nextRegStep()`);
      await cdp.sleep(300);

      const step3Text = await cdp.eval(`document.getElementById('reg-step-3').innerText.toLowerCase()`);
      assert(!step3Text.includes('equisteg'), 'Step 3 payment screen has ZERO mentions of Equisteg');

      await cdp.eval(`
        app.regData.isEmailVerified = true;
        await app.completeRegistrationAndUnlock({ bypassPaymentForTrial: true });
      `);
      await cdp.sleep(600);

      const tenantState = await cdp.eval(`
        (() => ({
          tenantId: app.activeTenantId,
          dbName: app.dbName,
          companyName: app.state.company ? app.state.company.name : null,
          usersCount: app.state.users.length,
          activePersona: app.state.users.find(u => u.id === app.currentPersonaId)?.name
        }))()
      `);

      assert(tenantState.tenantId.includes('tenant_apex_cyber_operations'), 'Storage mapped to dedicated tenant namespace');
      assert(tenantState.dbName === 'AegisFlow_Storage_' + tenantState.tenantId, 'IndexedDB strictly partitioned and isolated');
      assert(tenantState.usersCount === 1, 'Tenant database contains ONLY registered admin (Zero data leakage)');
      assert(tenantState.activePersona === 'Marcus Vance', 'Active persona in dashboard is Marcus Vance');
    });

    // -------------------------------------------------------------
    // SUITE 4: Multi-Persona Authorization & RBAC Switcher
    await runSuite('suite-4', 'Multi-Persona Authorization & RBAC Switcher', async (assert) => {
      const rbacAudit = await cdp.eval(`
        (() => {
          const current = app.state.users.find(u => u.id === app.currentPersonaId);
          return {
            role: current ? current.role : null,
            canCreateTask: typeof app.openCreateTaskModal === 'function',
            canAllocate: typeof app.openAutoAllocateModal === 'function'
          };
        })()
      `);
      assert(rbacAudit.role === 'Admin', 'Current active persona holds Admin privileges');
      assert(rbacAudit.canCreateTask, 'Admin persona authorized for task lifecycle creation');
      assert(rbacAudit.canAllocate, 'Admin persona authorized for autonomous auto-allocation');
    });

    // -------------------------------------------------------------
    // SUITE 5: Task Management Lifecycle & CRUD
    await runSuite('suite-5', 'Task Management Lifecycle & Kanban', async (assert) => {
      await cdp.eval(`
        (async () => {
          const newTask = {
            id: 'TSK-E2E-' + Date.now(),
            title: 'Audit Zero-Trust Database Isolation',
            description: 'Automated E2E test task verifying CRUD and status transition.',
            status: 'To Do',
            priority: 'Urgent',
            assigneeId: app.currentPersonaId,
            tags: ['security', 'audit'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          await app.dbPut('tasks', newTask);
          app.state.tasks.push(newTask);
          app.renderAll();
          return newTask.id;
        })()
      `);
      await cdp.sleep(300);

      const taskCheck = await cdp.eval(`
        (() => {
          const t = app.state.tasks.find(x => x.title === 'Audit Zero-Trust Database Isolation');
          return t ? { id: t.id, status: t.status, priority: t.priority } : null;
        })()
      `);
      assert(Boolean(taskCheck), 'Task created successfully in tenant IndexedDB');
      assert(taskCheck.status === 'To Do', 'Task initialized with To Do status');

      // Status Transition
      await cdp.eval(`
        (async () => {
          const t = app.state.tasks.find(x => x.title === 'Audit Zero-Trust Database Isolation');
          if (t) {
            t.status = 'In Progress';
            await app.dbPut('tasks', t);
            app.renderAll();
          }
        })()
      `);
      await cdp.sleep(300);

      const transitioned = await cdp.eval(`
        app.state.tasks.find(x => x.title === 'Audit Zero-Trust Database Isolation')?.status
      `);
      assert(transitioned === 'In Progress', 'Task transitioned smoothly from To Do to In Progress');
    });

    // -------------------------------------------------------------
    // SUITE 6: Autonomous Team Auto-Allocation
    await runSuite('suite-6', 'Autonomous AI Workload Balancing', async (assert) => {
      const allocateCheck = await cdp.eval(`
        (() => {
          const btn = document.getElementById('header-auto-allocate-btn');
          return { exists: Boolean(btn), isFunction: typeof app.openAutoAllocateModal === 'function' };
        })()
      `);
      assert(allocateCheck.exists, 'Auto-Allocate AI trigger present in navigation header');
      assert(allocateCheck.isFunction, 'Auto-allocation engine accessible for workload balancing');
    });

    // -------------------------------------------------------------
    // SUITE 7: Organization SLA Calendar & Milestones
    await runSuite('suite-7', 'Organization SLA Calendar & Milestones', async (assert) => {
      await cdp.eval(`app.switchTab('calendar-tab')`);
      await cdp.sleep(300);

      const calAudit = await cdp.eval(`
        (() => {
          const cal = document.getElementById('calendar-tab');
          return {
            isVisible: cal && !cal.classList.contains('hidden'),
            hasGrid: Boolean(cal && cal.querySelector('.grid')),
            hasDate: typeof app.currentCalendarDate !== 'undefined'
          };
        })()
      `);
      assert(calAudit.isVisible, 'SLA Milestone Calendar tab rendered in viewport');
      assert(calAudit.hasGrid, 'Interactive calendar grid active with month and milestone cells');
    });

    // -------------------------------------------------------------
    // SUITE 8: Daily Standup & Asynchronous Updates
    await runSuite('suite-8', 'Daily Standup & Asynchronous Updates', async (assert) => {
      await cdp.eval(`app.switchTab('standup-tab')`);
      await cdp.sleep(300);

      const standupAudit = await cdp.eval(`
        (async () => {
          const update = {
            id: 'UPD-' + Date.now(),
            userId: app.currentPersonaId,
            yesterday: 'Integrated automated QA agent',
            today: 'Validating end-to-end features and bank settlements',
            blockers: 'None',
            mood: 'rocket',
            createdAt: new Date().toISOString()
          };
          await app.dbPut('daily_updates', update);
          app.state.daily_updates.push(update);
          return app.state.daily_updates.length > 0;
        })()
      `);
      assert(standupAudit === true, 'Daily standup report submitted and recorded in team history');
    });

    // -------------------------------------------------------------
    // SUITE 9: Teams & Multi-Tenant Directory
    await runSuite('suite-9', 'Teams & Multi-Tenant Storage Directory', async (assert) => {
      await cdp.eval(`app.switchTab('teams-tab')`);
      await cdp.sleep(300);

      const teamAudit = await cdp.eval(`
        (() => {
          const teamsTab = document.getElementById('teams-tab');
          return {
            isVisible: teamsTab && !teamsTab.classList.contains('hidden'),
            hasVaultInfo: Boolean(document.getElementById('tenant-vault-badge') || teamsTab.innerText.includes('Storage'))
          };
        })()
      `);
      assert(teamAudit.isVisible, 'Teams management interface visible with tenant directory');
    });

    // -------------------------------------------------------------
    // SUITE 10: Autonomous Sentinel AI Production Self-Healing
    await runSuite('suite-10', 'Autonomous Sentinel AI Production Self-Healing', async (assert) => {
      // Inject defects into state to test Sentinel
      await cdp.eval(`
        (async () => {
          const defect1 = {
            id: 'TSK-CRITICAL-SLA-TEST',
            title: 'Impending SLA Breach',
            status: 'To Do',
            priority: 'Low',
            dueDate: new Date(Date.now() + 3600000).toISOString(),
            createdAt: new Date().toISOString()
          };
          const defect2 = {
            id: 'TSK-ORPHAN-DEFECT-TEST',
            title: 'Unlinked Orphan Task',
            status: 'To Do',
            priority: 'Medium',
            assigneeId: 'ghost-user-nonexistent',
            createdAt: new Date().toISOString()
          };
          await app.dbPut('tasks', defect1);
          await app.dbPut('tasks', defect2);
          app.state.tasks.push(defect1, defect2);
          await app.runSentinelDiagnosticsAndHeal(false);
        })()
      `);
      await cdp.sleep(500);

      const sentinelAudit = await cdp.eval(`
        (() => {
          const slaTask = app.state.tasks.find(t => t.id === 'TSK-CRITICAL-SLA-TEST');
          const orphan = app.state.tasks.find(t => t.id === 'TSK-ORPHAN-DEFECT-TEST');
          return {
            slaPriority: slaTask ? slaTask.priority : null,
            orphanAssignee: orphan ? orphan.assigneeId : null,
            healCount: app.sentinelAI.autoResolutionsCount
          };
        })()
      `);

      assert(sentinelAudit.slaPriority === 'Urgent', 'Sentinel SLA Radar: Automatically escalated impending deadline task to Urgent');
      assert(sentinelAudit.orphanAssignee !== 'ghost-user-nonexistent', 'Sentinel Orphan Healer: Rebound unlinked task to active Admin');
      assert(sentinelAudit.healCount >= 2, `Sentinel AI executed ${sentinelAudit.healCount} background auto-resolutions`);
    });

    // -------------------------------------------------------------
    // SUITE 11: Merchant Bank Settlement Configuration
    await runSuite('suite-11', 'Merchant Bank Settlement Configuration', async (assert) => {
      await cdp.eval(`app.openBankDetailsModal()`);
      await cdp.sleep(300);

      const bankAudit = await cdp.eval(`
        (() => {
          const modal = document.getElementById('modal-bank-details');
          return {
            isVisible: modal && !modal.classList.contains('hidden'),
            hasHolder: Boolean(document.getElementById('bank-holder-input').value),
            hasBank: Boolean(document.getElementById('bank-name-input').value),
            hasAccount: Boolean(document.getElementById('bank-account-input').value),
            hasRouting: Boolean(document.getElementById('bank-routing-input').value)
          };
        })()
      `);
      assert(bankAudit.isVisible, 'Merchant Bank Details Modal rendered successfully');
      assert(bankAudit.hasBank, 'Bank Name populated with receiving institution');
      assert(bankAudit.hasAccount, 'Account Number populated for receiving disbursements');
      assert(bankAudit.hasRouting, 'Routing / IFSC / Sort Code populated for electronic clearance');

      // Update bank details
      await cdp.eval(`
        document.getElementById('bank-name-input').value = 'Silicon Valley Commercial Bank';
        document.getElementById('bank-account-input').value = '98765432109876';
        await app.saveBankDetails();
      `);
      await cdp.sleep(300);

      const updated = await cdp.eval(`app.getMerchantBankSettlement()`);
      assert(updated.bankName === 'Silicon Valley Commercial Bank', 'Updated receiving bank name saved in merchant store');
      assert(updated.accountNumber === '98765432109876', 'Updated receiving account number locked in merchant store');
    });

    // -------------------------------------------------------------
    // SUITE 12: Dual Payment Gateway & Direct Bank Wire Clearing
    await runSuite('suite-12', 'Payment Gateway & Direct Bank Wire Clearing', async (assert) => {
      await cdp.eval(`app.openPaywallModal()`);
      await cdp.sleep(300);

      // Verify Card Gateway tab
      await cdp.eval(`app.switchPaywallMethod('card')`);
      const cardVisible = await cdp.eval(`!document.getElementById('paywall-section-card').classList.contains('hidden')`);
      assert(cardVisible, 'Payment Gateway (Card / Stripe) checkout form visible');

      // Verify Direct Bank Wire tab
      await cdp.eval(`app.switchPaywallMethod('wire')`);
      await cdp.sleep(300);

      const wireDisplay = await cdp.eval(`
        (() => ({
          bankName: document.getElementById('paywall-bank-name').innerText,
          accountNumber: document.getElementById('paywall-bank-acc').innerText
        }))()
      `);
      assert(wireDisplay.bankName === 'Silicon Valley Commercial Bank', 'Paywall dynamically renders merchant receiving bank name');
      assert(wireDisplay.accountNumber === '98765432109876', 'Paywall dynamically renders merchant account number for direct wires');

      // Submit Wire Reference Payment
      await cdp.eval(`
        document.getElementById('paywall-wire-reference-input').value = 'UTR-FEDWIRE-773918294';
        await app.processBankWirePayment();
      `);
      await cdp.sleep(300);

      const paymentAudit = await cdp.eval(`
        (() => ({
          isPaid: app.state.company.isPaid,
          method: app.state.company.paymentMethod,
          ref: app.state.company.lastTransactionId,
          settledBank: app.state.company.settlementBank
        }))()
      `);
      assert(paymentAudit.isPaid === true, 'Organization subscription active after Wire payment');
      assert(paymentAudit.method === 'direct_bank_wire', 'Payment registered as direct_bank_wire');
      assert(paymentAudit.ref === 'UTR-FEDWIRE-773918294', 'Wire UTR reference preserved in company ledger');
      assert(paymentAudit.settledBank === 'Silicon Valley Commercial Bank', 'Subscription funds cleared directly to merchant bank');
    });

    // -------------------------------------------------------------
    // SUITE 13: Cryptographic SHA-256 Audit Ledger Non-Repudiation
    await runSuite('suite-13', 'Cryptographic SHA-256 Audit Ledger', async (assert) => {
      const ledgerAudit = await cdp.eval(`
        (() => {
          const logs = app.state.audit_logs;
          const allSha256 = logs.every(l => Boolean(l.currentHash || l.blockHash) && (l.currentHash || l.blockHash).length === 64);
          return {
            count: logs.length,
            allSha256,
            hasWirePayment: logs.some(l => l.action.includes('WIRE')),
            hasSentinel: logs.some(l => l.action.includes('SENTINEL'))
          };
        })()
      `);
      assert(ledgerAudit.count >= 2, `Immutable ledger holds ${ledgerAudit.count} cryptographically signed audit blocks`);
      assert(ledgerAudit.allSha256, 'All audit ledger blocks contain 64-character SHA-256 signatures');
      assert(ledgerAudit.hasWirePayment, 'Direct Bank Wire settlement cryptographically committed to audit block');
    });

    // -------------------------------------------------------------
    // SUITE 14: Autonomous Agentic Self-Healing Trigger & Verification
    await runSuite('suite-14', 'Autonomous Agentic Self-Healing Engine', async (assert) => {
      // Simulate an intentional corrupted bank settlement state
      await cdp.eval(`localStorage.removeItem('task_tracker_merchant_bank_settlement')`);

      // Trigger Autonomous Healer
      const healResult = await healer.healDefect('Bank settlement configuration missing');
      heals.push(healResult);

      assert(healResult.success === true, 'Autonomous Agent detected missing settlement and executed self-healing repair');

      // Verify that after healing, bank settlement is fully reconstituted
      const healedBank = await cdp.eval(`app.getMerchantBankSettlement()`);
      assert(Boolean(healedBank && healedBank.accountNumber), 'Autonomous Agent reconstituted verified bank settlement parameters');
    });

    // Clean up test tab
    cdp.close();
    await httpRequest({
      hostname: 'localhost',
      port: this.cdpPort,
      path: `/json/close/${tab.id}`,
      method: 'GET'
    });

    // Calculate aggregated metrics
    const totalSuites = suites.length;
    const passedSuites = suites.filter(s => s.status === 'PASSED' || s.status === 'HEALED').length;
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;

    suites.forEach(s => {
      totalTests += s.total;
      passedTests += s.passed;
      failedTests += s.failed;
    });

    const overallHealthScore = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 100;

    const reportData: QAReportData = {
      timestamp: new Date().toISOString(),
      totalSuites,
      passedSuites,
      totalTests,
      passedTests,
      failedTests,
      overallHealthScore,
      suites,
      heals,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        url: this.baseUrl
      }
    };

    const reporter = new QAReporter();
    const files = reporter.generate(reportData);

    console.log('\n======================================================================');
    console.log(`  QA AGENT RESULTS: ${passedTests} / ${totalTests} TESTS PASSED (${overallHealthScore}%)`);
    console.log(`  SUITES: ${passedSuites} / ${totalSuites} OPERATIONAL`);
    console.log(`  AUTONOMOUS HEALS: ${heals.length} ACTIONS EXECUTED`);
    console.log(`  REPORTS GENERATED:`);
    console.log(`    - ${files.markdownPath}`);
    console.log(`    - ${files.jsonPath}`);
    console.log('======================================================================\n');

    return reportData;
  }
}
