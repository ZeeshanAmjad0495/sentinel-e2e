# @sentinele2e/ai

The AI run-analyzer for [Sentinel](https://github.com/ZeeshanAmjad0495/sentinel-e2e). It loads a run's `@sentinele2e/core` telemetry, redacts sensitive fields, and classifies failures as real-bug, infra-flake, or selector-drift — first with deterministic rules, then optionally escalating to Claude (the `@anthropic-ai/sdk` provider is imported lazily, so importing the package never requires an API key). Ships the `sentinel-analyze` CLI.

## Install

```sh
npm install @sentinele2e/ai
```

## CLI

```sh
npx sentinel-analyze <run.jsonl>
```

See the [root README](https://github.com/ZeeshanAmjad0495/sentinel-e2e#readme) for the full Sentinel overview.
