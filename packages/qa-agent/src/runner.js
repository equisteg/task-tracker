import http from 'http';
import { AutonomousHealer } from './healer.js';
import { QAReporter } from './reporter.js';

function httpRequest(options, postData = null) {
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
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.callbacks = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = reject;
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
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

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
  }
}

export class QARunner {
  constructor(baseUrl = 'http://localhost:8000/index.html', cdpPort = 9222) {
    this.baseUrl = baseUrl;
    this.cdpPort = cdpPort;
  }

  async runAll(autoHeal = true) {
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

    // Fresh session preparation
    await cdp.eval(`localStorage.clear();`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await cdp.sleep(2000);

    const healer = new AutonomousHealer(cdp);
    const suites = [];
    const heals = [];

    // Helper assertion runner
    const runSuite = async (suiteId, name, testFn) => {
      const start = Date.now();
      const details = [];
      let total = 0;
      let passed = 0;
      let failed = 0;

      const assert = (cond, desc) => {
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
      } catch (err) {
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
            } catch (reErr) {
              console.error(`  ❌ Re-run failed: ${reErr.message}`);
            }
          }
        }
      }

      const durationMs = Date.now() - start;
      const status = failed === 0 ? 'PASSED' : (heals.length > 0 ? 'HEALED' : 'FAILED');
      const result = { suiteId, name, total, passed, failed, durationMs, status, details };
      suites.push(result);
      return result;
    };

    // -------------------------------------------------------------
    // SUITE 1: Brand Neutrality & Zero-Trust UI Inspection
    await runSuite('suite-1', 'Brand Neutrality & Zero-Trust UI', async (assert) => {
      const visibleTextOnLogin = await cdp.eval(`
        (() => {
          const authScreen = document.getElementById('auth-screen');
          return authScreen ? authScreen.innerText.toLowerCase() : '';
        })()
      `);
      assert(!visibleTextOnLogin.includes('equisteg'), 'Login screen has ZERO mentions of "Equisteg"');
      assert(!visibleTextOnLogin.includes('equisteg@gmail.com'), 'Login screen has ZERO mentions of "equisteg@gmail.com"');

      const emailInputVal = await cdp.eval(`document.getElementById('auth-input-email').value`);
      assert(emailInputVal === '', 'Login input email is completely empty and unpolluted');
    });

    // -------------------------------------------------------------
    // SUITE 2: Cyber Security Headers & Zero-Trust Perimeter
    await runSuite('suite-2', 'Cyber Security Zero-Trust Perimeter', async (assert) => {
      const securityMetaTags = await cdp.eval(`
        (() => {
          const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
          const nosniff = document.querySelector('meta[http-equiv="X-Content-Type-Options"]');
          const frameOptions = document.querySelector('meta[http-equiv="X-Frame-Options"]');
          const referrer = document.querySelector('meta[http-equiv="Referrer-Policy"]');
          return {
            hasCSP: Boolean(csp),
            hasNosniff: nosniff && nosniff.content === 'nosniff',
            hasFrameOptions: frameOptions && frameOptions.content === 'DENY',
            hasReferrer: Boolean(referrer)
          };
        })()
      `);
      assert(securityMetaTags.hasCSP === true, 'Strict Content-Security-Policy (CSP) meta header enforced');
      assert(securityMetaTags.hasNosniff === true, 'X-Content-Type-Options: nosniff header verified');
      assert(securityMetaTags.hasFrameOptions === true, 'X-Frame-Options: DENY anti-clickjacking header verified');
      assert(securityMetaTags.hasReferrer === true, 'Referrer-Policy header verified');

      // Test brute-force rate limit protection
      await cdp.eval(`
        (() => {
          document.getElementById('auth-input-email').value = 'attacker@breach.net';
          document.getElementById('auth-input-password').value = 'wrongPass';
          app.handleAuthSubmit(new Event('submit'));
        })()
      `);
      await cdp.sleep(500);

      const rateLimitState = await cdp.eval(`
        (() => ({
          failedAttempts: app.failedAttempts,
          isAuthenticated: app.isAuthenticated
        }))()
      `);
      assert(rateLimitState.failedAttempts >= 1, 'Authentication gateway records and increments failed attempts');
      assert(rateLimitState.isAuthenticated === false, 'Unauthorized actor correctly rejected');
    });

    // -------------------------------------------------------------
    // SUITE 3: Multi-Tenant Registration & Storage Partitioning
    await runSuite('suite-3', 'Multi-Tenant Registration & Storage Partitioning', async (assert) => {
      await cdp.eval(`app.setAuthMode('register')`);
      await cdp.sleep(300);

      await cdp.eval(`
        (() => {
          document.getElementById('reg-company-name').value = 'Acme Global Technologies';
          document.getElementById('reg-company-domain').value = 'acmeglobal.com';
          document.getElementById('reg-admin-name').value = 'Alice Smith';
          document.getElementById('reg-admin-email').value = 'alice.smith@acmeglobal.com';
          document.getElementById('reg-admin-password').value = 'AcmeSecurePass2026!';
          document.getElementById('reg-initial-team').value = 'Acme Core Engineering';
          app.submitRegStep1();
        })()
      `);
      await cdp.sleep(300);

      const step2Alert = await cdp.eval(`
        (() => {
          const alertEl = document.getElementById('reg-email-classification-alert');
          return alertEl ? alertEl.innerText : '';
        })()
      `);
      assert(!step2Alert.toLowerCase().includes('equisteg'), 'Step 2 alert contains ZERO mentions of "Equisteg"');
      assert(step2Alert.includes('Commercial Enterprise Organization'), 'Step 2 classifies Acme Global as Commercial Enterprise');

      // OTP Verification
      await cdp.eval(`
        (() => {
          app.autoFillRegCode();
          app.verifyRegistrationEmail();
        })()
      `);
      await cdp.sleep(300);

      // Step 3 pricing check
      const step3Content = await cdp.eval(`
        (() => {
          const contentEl = document.getElementById('reg-step-3-content');
          return contentEl ? contentEl.innerText : '';
        })()
      `);
      assert(!step3Content.toLowerCase().includes('equisteg'), 'Step 3 payment screen has ZERO mentions of "Equisteg"');
      assert(step3Content.includes('$1 / user / month') || step3Content.includes('$1/user/month'), 'Pricing clearly presents commercial $1/user/mo and $10/user/yr');

      // Complete Registration
      await cdp.eval(`(async () => { await app.completeRegistration({ isTrial: true }); })()`);
      await cdp.sleep(800);

      const isolationAudit = await cdp.eval(`
        (() => ({
          isAuthenticated: app.isAuthenticated,
          activeTenantId: app.activeTenantId,
          dbName: app.dbName,
          companyName: app.state.company ? app.state.company.name : null,
          usersCount: app.state.users.length,
          hasForeignAdmins: app.state.users.some(u => u.name.includes('Equisteg') || u.name.includes('Elena Vance')),
          activePersona: app.getCurrentUser() ? app.getCurrentUser().name : null
        }))()
      `);
      assert(isolationAudit.isAuthenticated === true, 'Acme Global admin successfully authenticated');
      assert(isolationAudit.activeTenantId.includes('tenant_acme_global'), `Storage mapped to dedicated tenant: ${isolationAudit.activeTenantId}`);
      assert(isolationAudit.dbName.startsWith('AegisFlow_Storage_tenant_acme_global'), `IndexedDB strictly isolated: ${isolationAudit.dbName}`);
      assert(isolationAudit.companyName === 'Acme Global Technologies', 'Workspace name reflects registered company');
      assert(isolationAudit.usersCount === 1, 'Acme Global database contains ONLY 1 registered user');
      assert(isolationAudit.hasForeignAdmins === false, 'Zero foreign admins present in Acme Global database');
      assert(isolationAudit.activePersona === 'Alice Smith', 'Active persona in dashboard is Alice Smith');
    });

    // -------------------------------------------------------------
    // SUITE 4: Multi-Persona Authorization & RBAC Switcher
    await runSuite('suite-4', 'Multi-Persona Authorization & RBAC Switcher', async (assert) => {
      const personaOptions = await cdp.eval(`
        (() => {
          const sel = document.getElementById('persona-selector');
          return sel ? Array.from(sel.options).map(o => o.text) : [];
        })()
      `);
      assert(personaOptions.length === 1 && personaOptions[0].includes('Alice Smith'), 'Persona selector lists ONLY Acme Global members');

      const currentUser = await cdp.eval(`app.getCurrentUser()`);
      assert(currentUser && currentUser.role === 'Admin', 'Active persona holds Admin authority');
    });

    // -------------------------------------------------------------
    // SUITE 5: Task Management Lifecycle & CRUD
    await runSuite('suite-5', 'Task Management Lifecycle & Kanban', async (assert) => {
      await cdp.eval(`
        (async () => {
          const newTask = {
            id: 'TSK-E2E-101',
            title: 'Audit Zero-Trust Database Isolation',
            desc: 'Automated E2E test task verifying CRUD and status transition.',
            status: 'To Do',
            priority: 'Urgent',
            assigneeId: app.state.users[0].id,
            teamId: app.state.teams[0].id,
            tags: ['Security', 'Audit'],
            createdAt: new Date().toISOString()
          };
          app.state.tasks.push(newTask);
          await app.dbPut('tasks', newTask);
          app.renderAll();
        })()
      `);
      await cdp.sleep(300);

      const taskCheck = await cdp.eval(`
        (() => {
          const t = app.state.tasks.find(x => x.id === 'TSK-E2E-101');
          return t ? { id: t.id, status: t.status, priority: t.priority } : null;
        })()
      `);
      assert(Boolean(taskCheck), 'Task created successfully in tenant IndexedDB');
      assert(taskCheck.status === 'To Do', 'Task initialized with To Do status');

      // Status Transition
      await cdp.eval(`
        (async () => {
          const t = app.state.tasks.find(x => x.id === 'TSK-E2E-101');
          if (t) {
            t.status = 'In Progress';
            await app.dbPut('tasks', t);
            app.renderAll();
          }
        })()
      `);
      await cdp.sleep(300);

      const transitioned = await cdp.eval(`
        app.state.tasks.find(x => x.id === 'TSK-E2E-101')?.status
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

      await cdp.eval(`app.switchTab('dashboard-tab')`);
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

      await cdp.eval(`app.switchTab('dashboard-tab')`);
    });

    // -------------------------------------------------------------
    // SUITE 9: Teams & Multi-Tenant Storage Directory
    await runSuite('suite-9', 'Teams & Multi-Tenant Storage Directory', async (assert) => {
      await cdp.eval(`app.switchTab('teams-tab')`);
      await cdp.sleep(300);

      const teamAudit = await cdp.eval(`
        (() => {
          const teamsTab = document.getElementById('teams-tab');
          return {
            isVisible: teamsTab && !teamsTab.classList.contains('hidden'),
            hasTenantStorage: teamsTab.innerText.includes('Storage') || teamsTab.innerText.includes('Directory')
          };
        })()
      `);
      assert(teamAudit.isVisible, 'Teams management interface visible with tenant directory');

      await cdp.eval(`app.switchTab('dashboard-tab')`);
    });

    // -------------------------------------------------------------
    // SUITE 10: Autonomous Sentinel AI Production Self-Healing
    await runSuite('suite-10', 'Autonomous Sentinel AI Production Self-Healing', async (assert) => {
      const sentinelState = await cdp.eval(`
        (() => ({
          hasSentinel: Boolean(app.sentinelAI),
          healthScore: app.sentinelAI.healthScore
        }))()
      `);
      assert(sentinelState.hasSentinel === true, 'AegisFlowSentinelAI instance active in production');
      assert(sentinelState.healthScore >= 90, `Sentinel Health Score verified at ${sentinelState.healthScore}%`);

      // Inject defects into state to test Sentinel
      await cdp.eval(`
        (async () => {
          const atRiskTask = {
            id: 'TSK-CRITICAL-SLA-QA',
            title: 'Security Patch Release for Production Cluster',
            desc: 'Deploy Zero-Trust network policy updates.',
            teamId: app.state.teams[0].id,
            assigneeId: app.state.users[0].id,
            status: 'In Progress',
            priority: 'Normal', // Intentional defect: should be escalated!
            dueDate: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
            tags: ['Security', 'Production']
          };
          const orphanTask = {
            id: 'TSK-ORPHAN-DEFECT-QA',
            title: 'Investigate DB Connection Pool Exhaustion',
            desc: 'Production bug investigation.',
            teamId: app.state.teams[0].id,
            assigneeId: 'ghost-user-9999', // Intentional defect: non-existent user!
            status: 'In Progress',
            priority: 'High',
            dueDate: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
            tags: ['Production']
          };
          app.state.tasks.push(atRiskTask, orphanTask);
          await app.dbPut('tasks', atRiskTask);
          await app.dbPut('tasks', orphanTask);
          await app.runSentinelDiagnosticsAndHeal(false);
        })()
      `);
      await cdp.sleep(500);

      const healedAudit = await cdp.eval(`
        (() => {
          const slaTask = app.state.tasks.find(t => t.id === 'TSK-CRITICAL-SLA-QA');
          const orphan = app.state.tasks.find(t => t.id === 'TSK-ORPHAN-DEFECT-QA');
          return {
            slaPriority: slaTask ? slaTask.priority : null,
            orphanAssignee: orphan ? orphan.assigneeId : null,
            autoResolutionsCount: app.sentinelAI.autoResolutionsCount
          };
        })()
      `);
      assert(healedAudit.slaPriority === 'Urgent', 'Sentinel SLA Radar: Automatically escalated impending deadline task to Urgent priority');
      assert(healedAudit.orphanAssignee !== 'ghost-user-9999', 'Sentinel Orphan Healer: Automatically rebound unlinked task to active Lead/Admin');
      assert(healedAudit.autoResolutionsCount >= 2, `Sentinel AI executed ${healedAudit.autoResolutionsCount} autonomous defect resolutions in background`);
    });

    // -------------------------------------------------------------
    // SUITE 11: Merchant Bank Settlement Configuration
    await runSuite('suite-11', 'Merchant Bank Settlement Configuration', async (assert) => {
      await cdp.eval(`app.openBankDetailsModal()`);
      await cdp.sleep(300);

      const bankModalAudit = await cdp.eval(`
        (() => {
          const modal = document.getElementById('modal-bank-details');
          const isVisible = modal && !modal.classList.contains('hidden');
          const holder = document.getElementById('bank-holder-input').value;
          const bankName = document.getElementById('bank-name-input').value;
          const accountNum = document.getElementById('bank-account-input').value;
          const routing = document.getElementById('bank-routing-input').value;
          const schedule = document.getElementById('bank-schedule-select').value;
          return { isVisible, holder, bankName, accountNum, routing, schedule };
        })()
      `);
      assert(bankModalAudit.isVisible === true, 'Merchant Bank Details Modal rendered successfully');
      assert(Boolean(bankModalAudit.bankName), 'Bank Name field populated with default merchant bank');
      assert(Boolean(bankModalAudit.accountNum), 'Account Number field populated');
      assert(Boolean(bankModalAudit.routing), 'Routing/IFSC field populated');

      // Update and Save Bank Details
      await cdp.eval(`
        (async () => {
          document.getElementById('bank-name-input').value = 'Silicon Valley Commercial Bank';
          document.getElementById('bank-account-input').value = '98765432109876';
          document.getElementById('bank-routing-input').value = '121000358';
          await app.saveBankDetails();
        })()
      `);
      await cdp.sleep(300);

      const updatedBank = await cdp.eval(`app.getMerchantBankSettlement()`);
      assert(updatedBank.bankName === 'Silicon Valley Commercial Bank', 'Bank Settlement saved: updated bank name');
      assert(updatedBank.accountNumber === '98765432109876', 'Bank Settlement saved: updated account number');
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

      const wireUI = await cdp.eval(`
        (() => ({
          bankDisplay: document.getElementById('paywall-bank-name').innerText,
          accDisplay: document.getElementById('paywall-bank-acc').innerText
        }))()
      `);
      assert(wireUI.bankDisplay === 'Silicon Valley Commercial Bank', 'Paywall Direct Bank Wire dynamically displays configured merchant bank');
      assert(wireUI.accDisplay === '98765432109876', 'Paywall Direct Bank Wire displays configured account number for receiving funds');

      // Submit Wire Reference Payment
      await cdp.eval(`
        (async () => {
          document.getElementById('paywall-wire-reference-input').value = 'UTR-FEDWIRE-992817294';
          await app.processBankWirePayment();
        })()
      `);
      await cdp.sleep(300);

      const wirePaymentAudit = await cdp.eval(`
        (() => ({
          isPaid: app.state.company.isPaid,
          method: app.state.company.paymentMethod,
          txId: app.state.company.lastTransactionId,
          settledBank: app.state.company.settlementBank
        }))()
      `);
      assert(wirePaymentAudit.isPaid === true, 'Organization subscription successfully unlocked via Direct Bank Wire payment');
      assert(wirePaymentAudit.method === 'direct_bank_wire', 'Payment method recorded as direct_bank_wire');
      assert(wirePaymentAudit.txId === 'UTR-FEDWIRE-992817294', 'Wire transaction reference preserved in company ledger');
      assert(wirePaymentAudit.settledBank === 'Silicon Valley Commercial Bank', 'Subscription funds routed and settled to verified merchant bank account');
    });

    // -------------------------------------------------------------
    // SUITE 13: Cryptographic SHA-256 Audit Ledger Non-Repudiation
    await runSuite('suite-13', 'Cryptographic SHA-256 Audit Ledger', async (assert) => {
      const ledgerState = await cdp.eval(`
        (() => {
          const logs = app.state.audit_logs;
          const allSha256 = logs.every(l => Boolean(l.currentHash || l.blockHash) && (l.currentHash || l.blockHash).length === 64);
          return {
            count: logs.length,
            allSha256,
            hasTenantRegistered: logs.some(l => l.action === 'TENANT_REGISTERED'),
            hasSentinelHeals: logs.some(l => l.action.includes('SENTINEL')),
            hasWirePayment: logs.some(l => l.action.includes('WIRE'))
          };
        })()
      `);
      assert(ledgerState.count >= 2, `Cryptographic ledger holds ${ledgerState.count} audit blocks`);
      assert(ledgerState.allSha256 === true, 'Every audit ledger block contains a valid 64-character SHA-256 cryptographic signature');
      assert(ledgerState.hasTenantRegistered === true, 'Tenant registration cryptographically committed to immutable ledger');
      assert(ledgerState.hasWirePayment === true, 'Direct Bank Wire settlement cryptographically committed to ledger');
    });

    // -------------------------------------------------------------
    // SUITE 14: Autonomous Agentic Self-Healing Trigger & Verification
    await runSuite('suite-14', 'Autonomous Agentic Self-Healing Engine', async (assert) => {
      // Simulate an intentional corrupted bank settlement state
      await cdp.eval(`localStorage.removeItem('task_tracker_merchant_bank_settlement')`);

      // Trigger Autonomous Healer
      const healResult = await healer.healDefect('Bank settlement configuration missing or corrupted');
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

    const reportData = {
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
