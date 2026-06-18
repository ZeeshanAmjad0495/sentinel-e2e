# @sentinele2e/driver-playwright

The Playwright driver for [Sentinel](https://github.com/ZeeshanAmjad0495/sentinel-e2e). It implements the `@sentinele2e/contracts` driver/session interface on top of Playwright, compiling Sentinel locator strategies to Playwright selectors and emitting `@sentinele2e/core` telemetry for every action and assertion. `@playwright/test` is a peer dependency you install alongside it.

## Install

```sh
npm install @sentinele2e/driver-playwright @playwright/test
```

See the [root README](https://github.com/ZeeshanAmjad0495/sentinel-e2e#readme) for the full Sentinel overview.
