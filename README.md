# MandapamBook

A marketplace for booking kalyana mandapams, convention halls and auditoriums for weddings and functions in India.

Plan and architecture: [docs/architecture.md](docs/architecture.md).

## Repository layout

| Path              | What                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| `apps/api`        | Express 5 + TypeScript API (PostgreSQL, Redis)                        |
| `apps/web`        | Angular 22 app (standalone components, Tailwind, lazy routes by role) |
| `packages/shared` | Zod schemas, shared types, money (paise) and phone helpers            |
| `docker/`         | Dockerfiles and nginx config                                          |
| `docs/`           | Architecture, threat model, runbook, payments migration               |

## Prerequisites

- Node.js 24 LTS and pnpm 10 (`corepack enable`)
- Docker Desktop (for the full local stack)
- [gitleaks](https://github.com/gitleaks/gitleaks#installing), required by the pre-commit hook

## Getting started

```sh
pnpm install
cp .env.example .env          # then replace every change-me value
node scripts/generate-secrets.mjs >> .env   # auth key rings and secrets
docker compose up -d postgres redis mailpit seaweedfs   # or point DATABASE_URL at Neon
pnpm --filter @mandapambook/shared build
pnpm --filter @mandapambook/api db:migrate
pnpm --filter @mandapambook/api db:seed
pnpm --filter @mandapambook/api dev   # http://localhost:4000/health
pnpm --filter @mandapambook/web start # http://localhost:4200
```

Or run everything in containers: `docker compose up --build`, then open http://localhost:8080. Mailpit's inbox is at http://localhost:8025.

## Common scripts

| Command             | Does                            |
| ------------------- | ------------------------------- |
| `pnpm lint`         | ESLint across the monorepo      |
| `pnpm typecheck`    | `tsc --noEmit` in every package |
| `pnpm test`         | All unit and integration tests  |
| `pnpm build`        | Build shared, API and web       |
| `pnpm format`       | Prettier                        |
| `pnpm secrets:scan` | gitleaks over the git history   |

Database workflow and integrity rules: [docs/database.md](docs/database.md). Auth, tokens and permissions: [docs/auth.md](docs/auth.md). Owner onboarding, KYC, uploads and pricing: [docs/owners.md](docs/owners.md). Admin review, KYC verification and settings: [docs/admin.md](docs/admin.md).

## Contributing

- Branch from `develop`: `feat/<scope>-<desc>`, `fix/...`, `chore/...`, `docs/...`. Never commit to `main` or `develop`.
- Conventional Commits, enforced by commitlint. The pre-commit hook runs gitleaks, lint-staged and typecheck.
- Open a PR to `develop` using the template. A human reviewer merges.

Security reports: see [SECURITY.md](SECURITY.md).
