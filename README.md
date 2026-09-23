# Product Monorepo

Standard monorepo for web, mobile, and backend — built once, deployed everywhere.

## Structure

```
product/
├── apps/
│   ├── web/ → React + TypeScript (web frontend)
│   ├── mobile/ → React Native + Expo (mobile app)
│   └── api/ → Node.js backend (NestJS/Express)
├── packages/
│   ├── shared-types/ → Shared TypeScript interfaces (API contracts)
│   └── api-client/ → Shared fetch/API request logic
├── infra/ → Docker configs, environment templates
└── .github/
    └── workflows/ → CI/CD pipeline definitions
```

## Getting started

1. Clone the repo
2. `npm install` at the root
3. See each app's own README for local dev instructions:
   - [Web Frontend README](./apps/web/README.md)
   - [Mobile App README](./apps/mobile/README.md)
   - [Backend API README](./apps/api/README.md)

## Workflow

- **Never push directly to `main`**. Always work on a feature branch.
- Branch naming: `feature/xxx`, `fix/xxx`, `chore/xxx`
- Open a PR into `main` — CI must pass and a code owner must approve before merge
- See [CONTRIBUTING.md](./CONTRIBUTING.md) for full details

## Stack & Features

- **Web (`apps/web`)**: React + TypeScript, Zero-Trust Architecture, ACID IndexedDB Storage, Automated Task Allocation, Sentinel Agentic AI Production Self-Healing, and Payout Settlement.
- **Mobile (`apps/mobile`)**: React Native + Expo with offline synchronization and native Android Gradle wrapper.
- **Backend API (`apps/api`)**: Node.js + Express with Payment Gateway integration (Stripe / Razorpay webhooks) and Bank Settlement services.
- **Shared Packages (`packages/*`)**: Shared TypeScript interfaces (`packages/shared-types`) and universal API client (`packages/api-client`).
- **Infra (`infra/`)**: Docker Compose, production Nginx reverse proxy, and environment templates.
