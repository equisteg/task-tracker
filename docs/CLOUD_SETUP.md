# Cloud Backend Setup

The web app (`index.html`) runs in **cloud mode** whenever `/api/health` responds (the Vercel functions in `api/`).
In cloud mode, accounts, email, payments and all workspace data live on the server. When no `/api` is reachable
(opening the file directly, the Android asset build, the QA runner's static server) it falls back to the original
**offline demo mode**, where data stays in the browser and emails and payments are simulated.

## How it works

| Concern | Implementation |
| --- | --- |
| Registration | Admin details → 6-digit OTP **emailed** from the platform SMTP (10 min expiry, 5 attempts, 60 s resend cooldown). The company is created and logged in **only** after a free trial, a verified Razorpay payment, a valid license key, or master eligibility. |
| Data isolation | One Supabase Postgres. `platform` schema = companies, logins, registrations, payments, license keys. Each company gets its **own schema** `t_<company>_<id>` holding `teams`, `users`, `tasks`, `daily_updates`, `audit_logs`, `settings`. |
| Members | Admin adds a member with their email → a temporary password + sign-in link are emailed. The member **must set a new password** before they can use the workspace. |
| Email | Registration OTPs use the platform SMTP. Invitations use the company's own SMTP (Teams → Company Email) and fall back to the platform SMTP when it isn't configured. SMTP passwords are AES-256-GCM encrypted at rest. |
| Payments | Razorpay Checkout. Amounts are computed server-side. The payment signature is verified server-side before activation. A payment can't be reused. |
| Company DB access | Admin → Teams → Direct Database Access generates a **read-only** Postgres login that can only see that company's schema. Friendly views are included: `v_tasks`, `v_members`, `v_teams`, `v_daily_updates`, `v_audit_logs`. |
| Delete organization | People & teams → Danger zone (admins only). Requires typing the company name and the admin password. Permanently drops the company schema, its read-only database login and all member accounts; everyone is signed out. The email addresses can then register again. |
| Roles | Only Admins manage members, SMTP, DB access and billing. Admins/Leads manage teams. Auditors are read-only. Sessions are revoked when a member is deleted or changes password. |

## 1. Supabase

1. Create a project at supabase.com.
2. Go to **Project Settings → Database → Connection string**, choose the **Session pooler** URI (IPv4-compatible), and fill in the password.
   Use the default `postgres` user: it needs permission to create schemas and roles.
3. Nothing else to run. The `platform` schema and tables are created automatically on the first API call.

## 2. Vercel environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (see `infra/.env.example` for the full list):

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Supabase session pooler URI |
| `JWT_SECRET` | yes | 32+ random chars (`openssl rand -base64 48`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | yes | Platform mailbox. For Gmail, use an [App Password](https://myaccount.google.com/apppasswords), port 587. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | optional | Razorpay Dashboard → Account & Settings → API Keys. Use test keys first. Until set, "Pay & Activate" is hidden; trials, license keys and bank transfers still work. |
| `APP_URL` | recommended | e.g. `https://task-tracker.vercel.app`, used in invite links |
| `BILLING_CURRENCY` | optional | Default `USD`. USD needs *International Payments* enabled on Razorpay; otherwise use `INR` and set prices accordingly. |
| `PRICE_PER_USER_MONTHLY` / `PRICE_PER_USER_YEARLY` | optional | Default `1` / `10` |
| `APP_ENCRYPTION_KEY` | optional | Separate key for SMTP password encryption |

Redeploy after setting them. `GET /api/health` lists any missing variable names under `missing`.

## 3. Operating tasks (SQL editor in Supabase)

Create a license key (single use):

```sql
INSERT INTO platform.license_keys (key, seats, valid_days) VALUES ('ENTERPRISE-2026-ACME01', 50, 365);
-- valid_days NULL = perpetual
```

Confirm a bank transfer a company submitted:

```sql
SELECT id, name, pending_wire_reference FROM platform.companies WHERE pending_wire_reference IS NOT NULL;

UPDATE platform.companies
   SET paid_until = now() + interval '1 year', paid_at = now(), seats = 10,
       plan = 'Commercial Paid (Bank Transfer)', last_transaction_id = pending_wire_reference,
       pending_wire_reference = NULL
 WHERE id = '<company id>';
```

Unlock a member locked out after 5 failed sign-ins (the lock also expires after 15 minutes):

```sql
UPDATE platform.accounts SET failed_attempts = 0, locked_until = NULL WHERE email = 'person@company.com';
```

## Notes & limits

- Master (free, unlimited) access is reserved for `equisteg@gmail.com` only. It is fixed in code (`api/_lib/company.js`), is granted only after that inbox receives and enters the registration code, and can't be enabled for any other address through settings.
- An email address can belong to one company.
- Seats limit the number of logins (admin included). Admins can add seats by paying again from the paywall.
- Trials last 14 days, and a company gets one trial. When a trial or subscription ends, members are blocked and the admin is asked to pay on sign-in.
- Signing out clears the cached workspace from that browser.
