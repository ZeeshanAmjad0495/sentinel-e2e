# @sentinele2e/core

The framework-agnostic engine of [Sentinel](https://github.com/ZeeshanAmjad0495/sentinel-e2e). It provides the locator strategy registry and resolver, the structured-error taxonomy (selector-not-found, timeout, driver-session, system-failure), and the telemetry sink and signal model that turn each run into a clean, domain-level record. Drivers build on top of it; the AI analyzer reasons over the telemetry it emits.

## Install

```sh
npm install @sentinele2e/core
```

See the [root README](https://github.com/ZeeshanAmjad0495/sentinel-e2e#readme) for the full Sentinel overview.
