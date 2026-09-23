# GitHub Workflows & Automation

The CI/CD pipeline definitions for this standard product monorepo are maintained in [`infra/workflows/`](../infra/workflows/):
- `ci.yml`: Continuous integration (lint, type-checking, e2e test execution)
- `deploy.yml`: Continuous deployment for web, mobile, and API

To activate GitHub Actions in environments with full repository admin permissions, link or copy `infra/workflows/*.yml` into `.github/workflows/`.
