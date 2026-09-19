# AegisFlow: Zero-Trust Security Architecture & Threat Model

This document outlines the security architecture, threat model, cryptographic integrity design, and data governance policies powering the **AegisFlow** Enterprise Task & Operations Platform.

---

## 1. Core Threat Model & Defense-in-Depth Principles

To address the requirement of an unhackable and resilient system, AegisFlow adopts a **Zero-Trust Defense-in-Depth Model** where no component or actor is inherently trusted. Every request, input, state transition, and file payload is authenticated, authorized, validated, and cryptographically verified.

```
+-----------------------------------------------------------------------+
|                           BOUNDARY PERIMETER                          |
|  - Content Security Policy (CSP) & Subresource Integrity              |
|  - Frame-busting / Clickjacking Protection                            |
|  - Input Sanitization & HTML Entity Encoding (Anti-XSS)               |
+------------------------------------+----------------------------------+
                                     |
                                     v
+-----------------------------------------------------------------------+
|                    ACCESS CONTROL & AUTHORIZATION                     |
|  - Multi-Tier Role-Based Access Control (RBAC)                        |
|  - Contextual Attribute-Based Scopes (ABAC)                           |
|  - Strict Least Privilege Enforcement (Zero Trust)                    |
+------------------------------------+----------------------------------+
                                     |
                                     v
+-----------------------------------------------------------------------+
|                     DATA SANITIZATION & INTEGRITY                     |
|  - Strict URL Scheme Allowlisting (Reject javascript:, vbscript:)     |
|  - File Upload MIME & Magic-Byte Validation (No executable payloads)  |
|  - JSON Schema Validation & Input Boundary Length Checks              |
+------------------------------------+----------------------------------+
                                     |
                                     v
+-----------------------------------------------------------------------+
|                     IMMUTABLE AUDIT & CRYPTOGRAPHY                    |
|  - SHA-256 Hash-Chained Audit Ledger (Tamper-evident Blockchain style)|
|  - Cryptographic Export Integrity Checksumming                        |
|  - Non-repudiation of Task Reassignments & Status Logs                |
+-----------------------------------------------------------------------+
```

---

## 2. Multi-Tier Role-Based Access Control (RBAC) Matrix

Every action within AegisFlow is gated against strict role definitions:

| Feature / Action | Company Admin | Team Lead | Team Member (TM) | Cross-Team / Support | Security Auditor |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Manage Company Settings & Logo** | ✅ Full | ❌ Blocked | ❌ Blocked | ❌ Blocked | 👁️ Read-Only |
| **Create & Delete Teams** | ✅ Full | ❌ Blocked | ❌ Blocked | ❌ Blocked | 👁️ Read-Only |
| **Manage Team Emblems & Members** | ✅ Full | ✅ Own Team | ❌ Blocked | ❌ Blocked | 👁️ Read-Only |
| **Create New Tasks** | ✅ Full | ✅ Own Team | ✅ Assigned Team | ✅ Any Team | ❌ Blocked |
| **Assign & Reassign Tasks** | ✅ Any Task | ✅ Own Team | ❌ Blocked | ❌ Blocked | 👁️ Read-Only |
| **Work on Tasks Across Multiple Teams**| ✅ Allowed | ❌ Restricted | ❌ Restricted | ✅ **Universal** | ❌ Blocked |
| **Execute Automated Task Allocation** | ✅ Global | ✅ Own Team | ❌ Blocked | ❌ Blocked | 👁️ Read-Only |
| **Log Daily Status & Attach Tasks** | ✅ Allowed | ✅ Allowed | ✅ Assigned Only | ✅ Any Assigned | ❌ Blocked |
| **Trigger High-Tier Escalations (L2/L3)**| ✅ Allowed | ✅ Allowed | ❌ L1 Warning Only| ❌ L1 Warning Only| 👁️ Read-Only |
| **Export System Data (JSON / CSV)** | ✅ Full | ✅ Team Data | ❌ Blocked | ❌ Blocked | ✅ Audit Logs |
| **Import / Restore System Data** | ✅ Full | ❌ Blocked | ❌ Blocked | ❌ Blocked | ❌ Blocked |
| **View Cryptographic Audit Trail** | ✅ Full | ✅ Scoped | ❌ Blocked | ❌ Blocked | ✅ Full Verify |

---

## 3. Cryptographic Hash-Chained Audit Trail (Anti-Tampering)

To guarantee non-repudiation and prevent unauthorized retroactive edits or database injection attacks, AegisFlow maintains an **immutable cryptographic audit ledger**:

### Mathematical Specification:
For any event $E_n$ at index $n$:
$$H_0 = \text{SHA-256}(\text{"GENESIS\_AEGISFLOW\_SECURE\_LEDGER"} \parallel \text{CompanyId})$$
$$H_n = \text{SHA-256}(H_{n-1} \parallel \text{Timestamp} \parallel \text{ActorId} \parallel \text{Action} \parallel \text{TargetId} \parallel \text{Payload})$$

If an attacker attempts to modify a historical record (e.g., changing who approved an escalation or reallocated a task), the recalculation of the hash chain will immediately fail verification:
$$\text{Verify}(H_{1..N}) \implies \forall i \in [1, N], H_i \stackrel{?}{=} \text{SHA-256}(H_{i-1} \parallel \text{Data}_i)$$

The application UI includes a built-in **Cryptographic Ledger Verifier** that dynamically validates the entire chain using the standard **W3C Web Crypto API (`crypto.subtle.digest`)**.

---

## 4. Input Sanitization & Payload Protection

### 4.1 Cross-Site Scripting (XSS) Prevention
- All user-supplied text (task names, descriptions, comments, standup notes, member names) is strictly sanitized prior to DOM insertion.
- Text nodes are bound via `textContent` or converted through an HTML Entity Encoder:
  ```javascript
  function sanitizeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  ```

### 4.2 Malicious Hyperlink Neutralization
- When users attach reference links (Figma, GitHub, Docs), the URL is parsed with `new URL()` and validated against a strict protocol allowlist:
  - Allowed: `http:`, `https:`
  - Denied & Blocked: `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`
- All rendered links enforce `target="_blank" rel="noopener noreferrer"`.

### 4.3 Secure File Uploads
- File attachments are validated against a strict MIME-type whitelist:
  - Allowed: `image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`, `application/pdf`, `text/plain`, `text/csv`.
  - Blocked: `.exe`, `.dll`, `.bat`, `.sh`, `.php`, `.js`, `.py`, `.html`.
- Maximum file size is strictly enforced (5 MB per attachment).
- Files are stored as sandboxed Data URIs / ArrayBuffers, neutralizing server execution vectors.

---

## 5. Free Persistent Database Architecture

AegisFlow eliminates recurring infrastructure costs by implementing a **Multi-Store Transactional IndexedDB Engine**:

1. **Zero Hosting / Server Cost**: The database lives entirely within the browser's persistent storage partition, providing ACID compliance, indexed queries, and zero cloud hosting bills.
2. **Deterministic Schemas**:
   - `company`: Tenant settings, branding metadata, logo blobs.
   - `teams`: Team identifiers, names, lead IDs, emblem blobs.
   - `users`: User profiles, role tiers, avatar blobs, skill sets, cross-team flags.
   - `tasks`: Task lifecycle, assignees, priorities, SLA deadlines, escalation tiers, attachments, links.
   - `daily_updates`: Daily standup entries with linked task references, hours spent, progress %, and blocker indicators.
   - `audit_logs`: Hash-chained tamper-evident event log.
3. **Disaster Recovery & Portability**:
   - Complete JSON Export with cryptographic SHA-256 payload integrity signature.
   - CSV Task and Standup Log exports for compatibility with Excel, BI, and reporting tools.
   - Safe JSON Import with schema validation, format verification, and preview before committing.

---

## 6. Multi-Tenant Identity Verification & Paywall Architecture

AegisFlow enforces a tiered multi-tenant licensing and access control policy:

### 6.1 Equisteg Master Identity Verification (`equisteg@gmail.com`)
- **Lifetime Free Unlimited License ($0.00 / Forever)**: The **Equisteg** organization is granted an exclusive, unconditional lifetime complimentary license across all enterprise features, unlimited user seats, unrestricted automated allocations, and immutable ledger logging.
- **Cryptographic Verification Gate**: Access to the Equisteg unlimited workspace is strictly gated behind verified Google Identity Services (OAuth 2.0 / TOTP security challenge) authenticating the master identity: `equisteg@gmail.com`.
- **Anti-Impersonation Protection**: Any attempt to authenticate as Equisteg via standard corporate password portals is automatically intercepted and routed to the Google Identity Verification Gateway.

### 6.2 Commercial Organizations (Access After Payment)
- **Commercial Paywall**: Any organization other than Equisteg (or any unverified instance) operates on a commercial subscription model.
- **Subscription Tiers**:
  - **Starter Tier ($19/mo)**: Small teams up to 5 members, task boards, and daily standups.
  - **Professional Tier ($49/mo)**: Mid-size teams up to 25 members, automated task allocation engine, interactive SLA calendar, and SHA-256 audit ledger.
  - **Enterprise Tier ($99/mo)**: Unlimited members, dedicated SLA radar, cross-team floating support specialists, and custom branding.
- **License Key Activation**: Commercial enterprises may alternatively activate perpetual access using signed license keys (`EQUISTEG-PAID-XXXX`).
- **Automated Feature Gating**: Unpaid or trial-expired commercial organizations are prompted with the paywall gateway when accessing premium features (automated allocation, cross-team reallocations, and cryptographic data exports).
