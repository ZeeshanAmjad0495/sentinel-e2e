// packages/driver-playwright/src/strategy-compiler.ts
import type { Locator as PwLocator, Page } from "@playwright/test";
import type { LocatorStrategy } from "@sentinel/contracts";

type Aria =
  | "button"
  | "link"
  | "textbox"
  | "checkbox"
  | "radio"
  | "heading"
  | "tab"
  | "menuitem"
  | "option"
  | "combobox"
  | "listbox"
  | "dialog"
  | "alert";

function readName(options: LocatorStrategy["options"]): {
  name?: string;
  exact?: boolean;
} {
  const name = options?.["name"];
  const exact = options?.["exact"];
  return {
    name: typeof name === "string" ? name : undefined,
    exact: typeof exact === "boolean" ? exact : undefined,
  };
}

export function compileStrategy(
  scope: Page | PwLocator,
  strategy: LocatorStrategy,
): PwLocator {
  switch (strategy.kind) {
    case "role": {
      const { name, exact } = readName(strategy.options);
      return scope.getByRole(strategy.value as Aria, { name, exact });
    }
    case "label": {
      const { exact } = readName(strategy.options);
      return scope.getByLabel(strategy.value, { exact });
    }
    case "text": {
      const { exact } = readName(strategy.options);
      return scope.getByText(strategy.value, { exact });
    }
    case "testid":
      return scope.getByTestId(strategy.value);
    case "css":
    case "xpath":
      return scope.locator(strategy.value);
    default:
      throw new Error(
        `unsupported strategy kind: "${strategy.kind}" (compiler only handles role|label|text|testid|css|xpath)`,
      );
  }
}
