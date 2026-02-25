# Sentinel

Sentinel is a brandable, tool-agnostic automation framework designed to scale from UI end-to-end testing to API, mobile, and AI-assisted automation.

Sentinel is **not** ERP-specific and **not** bound to any single runner (Playwright, Appium, etc.). It is structured as a reusable framework with pluggable drivers, reporters, and “flows” that express domain intent.

---

## What Sentinel Is

- A **framework**: reusable primitives, contracts, and plugins
- A **platform**: multiple drivers (web, api, mobile) can coexist
- A **model**: hybrid **Component Object Model (COM)** + **Functional Page/Flow Model (FPM)**
- An **engineering baseline**: deterministic execution, analyzable failures, CI-ready

## What Sentinel Is Not

- Not “a test suite for one app”
- Not tied to a single tool or UI technology
- Not dependent on brittle, app-specific conventions

---

## Core Design Goals

- **Tool-agnostic**: drivers implement common contracts
- **Deterministic**: race-based state evaluation, explicit waits, no sleeps
- **Observable**: structured results, artifacts, telemetry-first
- **Composable**: components + flows, minimal duplication
- **Extensible**: plugin architecture for reporters, storage, AI, and integrations
- **Portable**: local + Docker parity; CI-friendly by default

---

## Architecture (Framework, Not Test Suite)

Sentinel is split into **core framework** and **adapters**:

### 1) Core (tool-agnostic)

- Contracts (interfaces) for drivers, elements, sessions, and assertions
- Telemetry and structured results (machine-readable)
- Error taxonomy (business vs system failures)
- Reporting pipeline (JSON-first, extensible sinks)

### 2) Drivers / Adapters (tool-specific)

- Web driver (e.g., Playwright / Selenium)
- API driver (e.g., HTTP client-based)
- Mobile driver (e.g., Appium)
- AI driver (vision/LLM-assisted actions) as an optional layer

### 3) Test Assets (app-specific)

- Example projects and templates live under `examples/`
- Real projects can live under `projects/` (optional) or separate repos

---

## Recommended Monorepo Layout (npm workspaces)

Use a monorepo so Sentinel can grow beyond web:

```
.
├── packages/
│   ├── sentinel-core/                 # tool-agnostic contracts + telemetry + errors
│   ├── sentinel-reporting/            # reporters + JSON schema + sinks
│   ├── sentinel-driver-web-playwright/# Playwright adapter (optional / current)
│   ├── sentinel-driver-api-http/      # API adapter (future)
│   ├── sentinel-driver-mobile-appium/ # Mobile adapter (future)
│   ├── sentinel-ai/                   # AI-assisted layer (future)
│   └── sentinel-cli/                  # CLI runner, scaffolding, utilities (future)
│
├── examples/
│   ├── web-erpnext/                   # example SUT (today), not the framework identity
│   └── web-demo-app/                  # another example target
│
├── docs/                              # design docs, decisions (ADRs), guides
├── .husky/                            # git hooks
├── package.json                       # workspace root
└── README.md
```

### Why this is “framework-grade”

- `packages/sentinel-core` stays stable and reusable.
- Drivers evolve independently without contaminating core.
- Examples demonstrate usage without defining the framework.

---

## COM + FPM in Sentinel

### Component Object Model (COM)

Reusable UI components (or API components) such as:

- `Form`, `DataTable`, `Dialog`, `AppShell`
- For API: `ApiClient`, `AuthSession`, `Resource`

Components encapsulate selectors/protocol details and expose **capabilities**, not low-level mechanics.

### Functional Page/Flow Model (FPM)

“Flows” orchestrate components and return structured results:

- `auth.login(credentials) -> LoginResult`
- `employee.create(data) -> CreateEmployeeResult`

Flows express **domain intent** and remain tool-agnostic as much as possible.

---

## Structured Results & Error Model

Sentinel distinguishes:

- **Business failures**: expected invalid states (e.g., wrong password)
  → returned as structured results (`success: false`)
- **System failures**: broken UI/driver/timeouts/selector drift
  → raised as system errors with context (artifacts + telemetry)

This enables:

- programmatic analysis
- CI trend reporting
- AI diagnostics later

---

## Getting Started (Example: Web via Playwright)

> The current example uses Playwright, but Sentinel’s core is tool-agnostic.

### Install dependencies

```
npm install
npx playwright install
```

### Run tests

```
npm run test
npm run test:headed
npm run test:ui
```

---

## Tooling & Quality Gates

- ESLint (flat config) + Prettier
- Husky + lint-staged (pre-commit)
- Commitlint (Conventional Commits)

### Conventional Commits examples

```
feat(core): add structured result schema
feat(web): add login component capability
fix(reporting): include screenshot path in json
refactor(core): split telemetry timers
chore(repo): configure commit hooks
```

---

## Roadmap

- `sentinel-driver-api-http`: API-first workflows (auth, resources, contract checks)
- `sentinel-driver-mobile-appium`: mobile automation primitives
- `sentinel-reporting`: richer sinks (Slack, JUnit, HTML dashboard)
- `sentinel-ai`: AI-assisted diagnosis, resilient actions, flake classification
- `sentinel-cli`: scaffolding and project templates
- Stable JSON schemas for results/artifacts across drivers

---

## License

MIT
