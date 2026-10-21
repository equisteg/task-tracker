# Contributing Guidelines

## Workflow

1. **Pull the latest main**:
   ```bash
   git checkout main
   git pull origin main
   ```

2. **Create a feature branch**:
   ```bash
   git checkout -b feature/short-description
   ```
   Use `fix/` or `chore/` prefixes where appropriate.

3. **Make your changes, commit using [Conventional Commits](https://www.conventionalcommits.org/)**:
   ```bash
   git commit -m "feat: add login screen"
   git commit -m "fix: correct token refresh bug"
   ```

4. **Push your branch**:
   ```bash
   git push origin feature/short-description
   ```

5. **Open a Pull Request into main**:
   - Fill out the PR template.
   - CI (lint, type-check, tests) must pass.
   - A code owner for the folders you touched must approve.
   - Once approved, a code owner/lead merges using **Squash and merge**.

## Rules

- **No direct pushes to `main`** — everything goes through a reviewed PR.
- Keep PRs focused and small where possible.
- **Never commit secrets** — use `.env` files (strictly excluded via `.gitignore`).
- Rotate credentials if a team member leaves.

## Access

See the internal Tools Setup & Team Access Guide for role assignments per tool (GitHub, Vercel, Render, Expo/EAS, Sentry, DB access).

## Build team: work through a fork
If you have read access to this repo, you can clone it, build it, run every test and send changes as pull requests from your own fork.

1. On GitHub, open this repo, click **Fork** and choose your account as the owner (the fork stays private).
2. Clone your fork and keep it up to date:
   ```
   git clone https://github.com/<you>/task-tracker.git
   cd task-tracker
   git remote add upstream https://github.com/equisteg/task-tracker.git
   git fetch upstream
   git switch -c feature/short-description upstream/main
   ```
3. `npm install` (this also turns on the pre-commit secret check), make the change and run the tests.
4. Commit with Conventional Commits, push to your fork and open a PR into `equisteg/task-tracker` `main`.
5. CI runs on the PR after a member of the R&D team approves the run. R&D reviews and merges.

## Build team: Claude commands
You can ask Claude to work on a PR or an issue by commenting one of these. R&D adds you to the allowed list first.

| Comment | What happens |
|---|---|
| `/review` | Specialist reviewers check the PR and reply with verdicts and findings |
| `/test` | Claude reads the PR's lint, typecheck, unit test and build results and fixes what fails |
| `/change <what to change>` | Claude makes the change, with tests, and reviews it |
| `/update <new feature>` | Claude builds the feature, with tests, and reviews it |
| `/newapp` | Claude builds a whole product from the prototype in `inputs/`, over several runs |

Claude reacts with 👀, works for a few minutes inside GitHub, then replies. Code changes come on a branch `claude/<number>-<run>` and the reply shows how to pull it into your branch. Read the change, run the tests, then push it to your PR. There is a daily limit per repo. If a result is held back by a safety check, R&D is told and follows up.

## R&D
Members of the R&D team run `npm run kit` once per checkout. It installs the private Claude setup, which is git-ignored and never committed here. Without access it prints a note and changes nothing.
