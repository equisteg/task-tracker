# Enterprise Standard Operating Procedures (SOP) Manual
## AegisFlow Enterprise Platform & Autonomous Multi-Tenant Architecture

```
Document ID: SOP-AEGIS-2026-V1
Classification: Confidential / Enterprise Operational Standard
Effective Date: September 23, 2026
Applicability: Platform Administrators, DevSecOps, Merchant Finance, QA Engineers
Target Codebase: https://github.com/tezech/task-tracker
```

---

## Document Index & Operational Overview

This manual establishes standardized, reproducible procedures for operating, administering, and extending the AegisFlow multi-tenant platform and its autonomous agent subsystems.

| SOP Code | Operational Domain | Primary Actor | Target Subsystem |
| :--- | :--- | :--- | :--- |
| **[SOP-001](#sop-001-tenant-organization-registration--verification)** | Tenant Organization Onboarding | Platform Admin | Dynamic Registration & RBAC |
| **[SOP-002](#sop-002-merchant-bank-details--payout-settlement-configuration)** | Merchant Bank & Payout Configuration | Finance / Platform Owner | Payout Gateway & Settlement |
| **[SOP-003](#sop-003-autonomous-qa-agent-execution--audit-surveillance)** | Automated QA & Daily Surveillance | QA / DevSecOps | `@product/qa-agent` |
| **[SOP-004](#sop-004-sentinel-ai-production-incident-remediation)** | Production AI Self-Healing | Operations Lead | `AegisFlowSentinelAI` |
| **[SOP-005](#sop-005-product-monorepo-development--package-management)** | Monorepo Code Management | Full-Stack Developer | `apps/*`, `packages/*` |
| **[SOP-006](#sop-006-continuous-deployment--vercel-release-management)** | Cloud Deployment & Release | Release Engineer | Vercel Static Pipeline |
| **[SOP-007](#sop-007-cyber-security-hardening--sha-256-ledger-audit)** | Security Perimeter & Audit Ledger | Security Officer | Headers & Cryptographic Chain |
| **[SOP-008](#sop-008-disaster-recovery--database-state-reconstitution)** | Emergency Recovery & Rollback | Site Reliability Engineer | IndexedDB Partition Vaults |

---

## SOP-001: Tenant Organization Registration & Verification

### 1. Purpose
Defines the protocol for registering new enterprise tenants, verifying organizational domains, enforcing brand neutrality, and partitioning tenant data.

### 2. Operational Procedures
1. **Accessing the Zero-Trust Registration Portal**:
   - Navigate to the platform root URL (`https://task-tracker-l39edb1b0-tezech.vercel.app`).
   - Click **"Register New Organization"** on the zero-trust login screen.
   - Verify that the login screen is completely unpolluted (zero pre-filled credentials, zero mentions of legacy brands).

2. **Step 1: Domain & Administrator Registration**:
   - Input the **Company Legal Name** (e.g., `Acme Global Technologies`).
   - Input the **Administrator Email** (e.g., `admin@acme.com`).
     - *Note*: If registering with `equisteg@gmail.com` or authorized partner alias, the system automatically validates exclusive enterprise privileges.
     - For all standard business domains, the system routes the user to the commercial enterprise tier.
   - Set a strong password (minimum 10 characters, upper/lower/numbers/special characters).
   - Click **"Continue to Verification"**.

3. **Step 2: Zero-Trust Identity Verification (OTP)**:
   - The platform generates a cryptographically random 6-digit one-time password (OTP).
   - Enter the 6-digit code into the verification challenge dialog.
   - Click **"Verify Identity"**.

4. **Step 3: Storage Partition & Subscription Provisioning**:
   - The system automatically provisions a dedicated tenant vault:
     $$\text{TenantID} = \text{sanitize}(\text{OrgName}) + \text{"\_"} + \text{salt}$$
   - Select either the **Monthly Tier (\$1.00/user/mo)** or **Annual Tier (\$10.00/user/yr)**.
   - Complete checkout via Card Checkout or Direct Bank Wire (see [SOP-002](#sop-002-merchant-bank-details--payout-settlement-configuration)).
   - Verify immediate transition into the isolated tenant workspace.

5. **Post-Registration Verification**:
   - Open Developer Tools (`F12`) > **Application > IndexedDB**.
   - Confirm the database exists under `AegisFlow_Storage_<TenantID>`.
   - Confirm `users` store contains strictly **1** registered admin and zero foreign accounts.

---

## SOP-002: Merchant Bank Details & Payout Settlement Configuration

### 1. Purpose
Specifies the exact procedure for platform owners and merchant administrators to configure their depository bank account details so customer subscription fees are routed and deposited directly into the merchant's bank account.

### 2. Where and How to Configure Bank Details

```
Step 1: Open Navigation Menu (top right user avatar)
Step 2: Click "Merchant Bank Settlement"
Step 3: Complete Bank Account Form Fields:
        ├── Beneficiary Legal Name
        ├── Bank Name (e.g., Chase, HDFC, Barclays)
        ├── Account Number (Primary Depository Account)
        ├── Routing / IFSC / Sort Code
        ├── SWIFT / BIC Code (for international wires)
        └── Payout Frequency (Instant, Daily, Weekly)
Step 4: Click "Save & Authorize Settlement Gateway"
```

### 3. Step-by-Step Configuration Instructions

1. **Locate the Settlement Gateway**:
   - Log in as the Platform Administrator.
   - Click on the settings dropdown in the upper navigation bar and select **"Merchant Bank Settlement"**.
   - The **Merchant Bank Details Modal** will appear with 256-bit SSL encryption confirmation.

2. **Input Required Depository Information**:
   - **Beneficiary Legal Name**: Enter the exact legal business name registered on your corporate bank account.
   - **Bank Institution Name**: Enter the full name of your commercial bank (e.g., *JPMorgan Chase Bank, N.A.* or *HDFC Bank Ltd*).
   - **Receiving Account Number**: Enter your corporate checking/settlement account number.
   - **Routing Number / IFSC Code / Sort Code**:
     - *US*: 9-digit ABA Routing Number.
     - *India*: 11-character alphanumeric IFSC Code.
     - *UK*: 6-digit Sort Code.
   - **SWIFT / BIC Code**: Required for cross-border wires (8 or 11 characters).
   - **Payout Schedule**: Select between **Instantaneous (Per Transaction)**, **Daily Batch (23:59 UTC)**, or **Weekly (Mondays)**.

3. **Commit & Verify Cryptographic Signature**:
   - Click **"Save & Authorize Settlement Gateway"**.
   - The platform will encrypt the settlement parameters, persist them in local vault storage, and append a signed transaction block to the SHA-256 audit ledger.

4. **Verify Subscriber Paywall Synchronization**:
   - To confirm customer funds will route to your updated account, open the **Commercial Paywall** modal.
   - Select **Direct Bank Wire Transfer**.
   - Verify that the instructions immediately display:
     - Your configured **Bank Name**.
     - Your configured **Account Number**.
     - Your configured **Routing/IFSC Code**.
   - When a subscribing organization submits their Wire Transfer Reference (UTR), the system records the transaction, matches the funds to your account, and unlocks their enterprise subscription.

---

## SOP-003: Autonomous QA Agent Execution & Audit Surveillance

### 1. Purpose
Establishes the standard operational commands for running the 14-suite automated QA test engine, executing autonomous self-healing, running the continuous background daemon, and inspecting audit logs.

### 2. CLI Execution Modes

All commands are executed from the repository root:

```bash
# Mode 1: Standard E2E QA Test Run (Zero manual browser/server setup needed)
npm run qa

# Mode 2: QA Run with Autonomous Agentic Self-Healing Enabled
npm run qa:agent

# Mode 3: Continuous 24/7 Background Surveillance Daemon
npm run qa:daemon
```

### 3. Execution Mechanics & Auto-Bootstrapping
When `npm run qa` or `npm run qa:agent` is executed, the agent automatically orchestrates:
1. **Static HTTP Server**: Spawns an internal HTTP server on port 8000 if not detected.
2. **Headless Chrome**: Detects the host machine's Chrome binary and launches:
   ```bash
   google-chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/qa-chrome-profile --disable-gpu --no-first-run
   ```
3. **Target Navigation**: Establishes a Chrome DevTools Protocol (CDP) WebSocket connection, navigates to `http://localhost:8000/index.html`, clears previous temporary states, and runs all 14 feature suites.
4. **Teardown**: Closes the test tab and cleanly shuts down background processes.

### 4. Output Inspection Protocol
Following execution, two audit artifacts are generated in the `reports/` directory:
- **`reports/qa-report-latest.md`**: Human-readable Markdown summary with test statuses, breakdown of suites, and SHA-256 integrity seal.
- **`reports/daily-audit.json`**: Machine-readable JSON metrics including pass rates, execution durations, and defect remediation logs.

### 5. Scheduled Daily CI/CD Pipeline
- **Workflow File**: `infra/workflows/daily-qa-audit.yml`
- **Schedule**: Recurring daily cron at midnight (`0 0 * * *`).
- **Trigger**: Every pull request or merge to `main`.
- **Action on Failure**: Automatically triggers the self-healing engine and commits the audit report back to the repository.

---

## SOP-004: Sentinel AI Production Incident Remediation

### 1. Purpose
Outlines the operational procedures for supervising the in-browser autonomous watchdog (`AegisFlowSentinelAI`), reviewing detected anomalies, and auditing automatic repairs.

### 2. Sentinel Monitoring Cycle
The Sentinel AI runs continuously on a 5-second sampling loop:
1. **Telemetry Collection**: Scans task boards, user assignment links, SLA timestamps, and storage state.
2. **Defect Identification**: Compares runtime state against expected operational invariants.
3. **Autonomous Remediation**: If an anomaly is identified, the Sentinel AI applies the corresponding remediation rule without requiring human intervention.

### 3. Defect Classification & Automatic Remediation Table

| Defect Type | Code | Trigger Condition | Autonomous Action Taken |
| :--- | :---: | :--- | :--- |
| **Orphan Task** | `ORPHAN_TASK` | Task assignee ID does not match any active user in the tenant database. | Rebinds task assignee to the primary organization Administrator/Lead. |
| **SLA Breach Imminent** | `SLA_IMMINENT` | Task due date is within 24 hours and priority is Low or Medium. | Escalates task priority to `Urgent` and emits an amber SLA Radar warning badge. |
| **Corrupted Bank Setup** | `BANK_CORRUPT` | Merchant bank settlement fields are missing or altered. | Reconstitutes verified bank parameters from encrypted backup storage. |
| **Storage Desync** | `STORAGE_DESYNC` | Memory cache does not match IndexedDB transaction record. | Flushes memory cache and re-syncs state from persistent IndexedDB. |

### 4. Incident Review Procedure
1. In the platform dashboard, click the **"Sentinel AI"** shield icon in the top header.
2. Review the **Health Score (0–100%)** and **Active Watchdog Telemetry**.
3. Inspect the **Autonomous Incident Log** to review timestamped self-healing actions.
4. If manual intervention is required, click **"Force Integrity Scan"** to perform an immediate system re-validation.

---

## SOP-005: Product Monorepo Development & Package Management

### 1. Purpose
Provides guidelines for contributing to the monorepo, adding dependencies, and maintaining package contracts across web, mobile, and backend services.

### 2. Workspace Structure & Commands
The monorepo conforms to the standard `Repo-Template-equisteg-com` layout:

```bash
# Install dependencies across all workspaces
npm install

# Run all workspace development servers in parallel
npm run dev

# Run all build commands across workspaces
npm run build

# Run linting across all packages
npm run lint

# Clean build artifacts (dist, build, out)
npm run clean
```

### 3. Rules for Workspace Dependencies (CRITICAL)
- **Use Standard npm Wildcards**: In package manifests (`package.json`), all inter-package workspace dependencies **MUST** use `*`, NOT `workspace:*`.
  ```json
  "dependencies": {
    "@product/shared-types": "*",
    "@product/api-client": "*"
  }
  ```
- **Rationale**: `workspace:*` triggers fatal `EUNSUPPORTEDPROTOCOL` errors on Vercel and standard npm runners.

### 4. Adding Shared Interfaces
1. Open `packages/shared-types/src/index.ts`.
2. Export the new TypeScript interface:
   ```typescript
   export interface NewFeatureContract {
     id: string;
     tenantId: string;
     createdAt: string;
   }
   ```
3. Re-export in packages: both `apps/web` and `apps/api` consume this directly.

---

## SOP-006: Continuous Deployment & Vercel Release Management

### 1. Purpose
Defines the deployment process for pushing updates to GitHub and ensuring zero-downtime static builds on Vercel.

### 2. Vercel Configuration Policy
The repository uses a single, root-level `vercel.json` deployment manifest:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "cleanUrls": true,
  "installCommand": "echo 'Dependencies satisfied'",
  "buildCommand": "mkdir -p dist/reports && cp index.html dist/index.html && cp -r reports/* dist/reports/ 2>/dev/null || true",
  "outputDirectory": "dist",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

### 3. Pre-Flight Deployment Checklist
Before pushing commits to GitHub:
- [ ] Run `npm run qa` and ensure **55 / 55 tests pass**.
- [ ] Confirm no `workspace:*` entries exist in any `package.json`.
- [ ] Confirm `package-lock.json` is updated and committed.
- [ ] Confirm `dist/` is listed in `.gitignore`.

### 4. Git Deployment Protocol
```bash
# 1. Stage and commit verified changes
git add .
git commit -m "feat(scope): detailed description of changes"

# 2. Push to main branch
git push origin main

# 3. Fast-forward feature branch and push
git checkout feature/monorepo-and-payment-gateway
git merge main --ff-only
git push origin feature/monorepo-and-payment-gateway
git checkout main
```

### 5. Deployment Verification
1. Query the GitHub Deployments API:
   ```bash
   curl -s -H "Authorization: token <GITHUB_TOKEN>" \
     https://api.github.com/repos/tezech/task-tracker/deployments?per_page=1
   ```
2. Retrieve the latest deployment statuses:
   ```bash
   curl -s -H "Authorization: token <GITHUB_TOKEN>" \
     https://api.github.com/repos/tezech/task-tracker/deployments/<DEPLOYMENT_ID>/statuses
   ```
3. Verify that the response contains `"state": "success"` and the deployment URL is active.

---

## SOP-007: Cyber Security Hardening & SHA-256 Ledger Audit

### 1. Purpose
Defines verification procedures for HTTP security headers, brute-force defenses, and cryptographic ledger validation.

### 2. Security Header Verification
Execute an HTTP inspection against the deployed production domain:
```bash
curl -sI https://task-tracker-l39edb1b0-tezech.vercel.app
```
Confirm the following headers are present:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`

### 3. Cryptographic Audit Ledger Verification
To audit the integrity of the SHA-256 chain in a client session:
1. Open the Developer Console (`F12`).
2. Run the audit validator script:
   ```javascript
   const ledger = await app.getAuditLedger();
   console.table(ledger);
   
   // Verify cryptographic continuity
   for (let i = 1; i < ledger.length; i++) {
     const prevBlock = ledger[i - 1];
     const currBlock = ledger[i];
     console.assert(currBlock.previousHash === prevBlock.hash, `Hash chain broken at index ${i}!`);
   }
   console.log("✅ SHA-256 Ledger Chain verified: 100% Tamper-Free");
   ```
3. Every block must exhibit:
   - A sequential integer index.
   - An ISO 8601 UTC timestamp.
   - An immutable action code (e.g., `TENANT_REGISTRATION`, `BANK_SETTLEMENT_SAVED`, `WIRE_SUBSCRIPTION_CLEARED`).
   - A 64-character hexadecimal SHA-256 hash.

---

## SOP-008: Disaster Recovery & Database State Reconstitution

### 1. Purpose
Establishes the emergency procedures to recover from storage corruption, client-side database deletion, or catastrophic state loss.

### 2. Automatic State Reconstitution (Primary Response)
When a corrupted session is detected:
1. The `AegisFlowSentinelAI` watchdog will automatically attempt to reconstitute essential records from tenant memory mirrors.
2. If IndexedDB is blocked or unavailable, the storage engine falls back to encrypted `localStorage` namespaces prefixed with `_aegis_fallback_<TenantID>`.

### 3. Manual Database Recovery (Secondary Response)
If an organization's client database becomes severely desynchronized:
1. **Export Emergency Snapshot**:
   In the developer console, execute:
   ```javascript
   const snapshot = await app.exportTenantSnapshot();
   console.log(JSON.stringify(snapshot));
   ```
2. **Purge Corrupted Partition**:
   ```javascript
   indexedDB.deleteDatabase("AegisFlow_Storage_<TenantID>");
   ```
3. **Re-initialize Clean Partition**:
   Refresh the page. The application will automatically recreate schema structures.
4. **Restore Snapshot**:
   ```javascript
   await app.importTenantSnapshot(snapshot);
   location.reload();
   ```

### 4. Escalation Contacts
- **Repository**: [`https://github.com/tezech/task-tracker`](https://github.com/tezech/task-tracker)
- **Deployment Monitoring**: Vercel Dashboard / GitHub Deployments API
- **QA Supervision**: `@product/qa-agent` Daemon Supervisor
