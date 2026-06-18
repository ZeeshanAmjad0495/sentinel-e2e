# @sentinel/driver-playwright

The Playwright driver for [Sentinel](https://github.com/ZeeshanAmjad0495/sentinel-e2e). It implements the `@sentinel/contracts` driver/session interface on top of Playwright, compiling Sentinel locator strategies to Playwright selectors and emitting `@sentinel/core` telemetry for every action and assertion. `@playwright/test` is a peer dependency you install alongside it.

## Install

```sh
npm install @sentinel/driver-playwright @playwright/test
```

See the [root README](https://github.com/ZeeshanAmjad0495/sentinel-e2e#readme) for the full Sentinel overview.
