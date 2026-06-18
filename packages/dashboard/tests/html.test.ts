// packages/dashboard/tests/html.test.ts
import { test, expect } from "@playwright/test";
import {
  escapeHtml,
  jsonIsland,
  DASHBOARD_CSS,
  DASHBOARD_JS,
} from "../src/html";

test("escapeHtml escapes the five HTML-significant characters", () => {
  expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  expect(escapeHtml(`a & b "c" 'd' <e>`)).toBe(
    "a &amp; b &quot;c&quot; &#39;d&#39; &lt;e&gt;",
  );
  // ampersand escaped first so existing entities are not double-counted wrongly
  expect(escapeHtml("&lt;")).toBe("&amp;lt;");
});

test("jsonIsland neutralizes the </script> breakout and round-trips", () => {
  const island = jsonIsland({ s: "</script><img src=x onerror=alert(1)>" });
  // the breakout sequence must not appear verbatim
  expect(island).not.toContain("</script");
  expect(island).toContain("\\u003C/script");
  // raw < and > are escaped throughout
  expect(island).not.toMatch(/<[a-zA-Z/]/);
  // un-escaping the unicode escapes restores valid JSON that JSON.parse accepts
  const roundTripped = JSON.parse(island) as { s: string };
  expect(roundTripped.s).toBe("</script><img src=x onerror=alert(1)>");
});

test("jsonIsland escapes HTML comment openers and line/paragraph separators", () => {
  const sep =
    "a" + String.fromCharCode(0x2028) + "b" + String.fromCharCode(0x2029) + "c";
  const island = jsonIsland({ c: "<!--", sep });
  // the < escape alone neutralizes the comment opener: "<!--" -> escaped form
  expect(island).not.toContain("<!--");
  expect(island).toContain("\\u003C!--");
  expect(island).not.toContain(String.fromCharCode(0x2028));
  expect(island).not.toContain(String.fromCharCode(0x2029));
  expect(island).toContain("\\u2028");
  expect(island).toContain("\\u2029");
  const back = JSON.parse(island) as { c: string; sep: string };
  expect(back.c).toBe("<!--");
  expect(back.sep).toBe(sep);
});

test("inline assets are CDN-free and the client JS reads no innerHTML/eval/network", () => {
  // No external resources in the stylesheet.
  expect(DASHBOARD_CSS).not.toMatch(/https?:\/\//);
  expect(DASHBOARD_CSS).not.toContain("@import");
  expect(DASHBOARD_CSS).toContain("system-ui");

  // Client JS does only filter/sort/expand/anchor — never these.
  expect(DASHBOARD_JS).not.toContain("innerHTML");
  expect(DASHBOARD_JS).not.toContain("eval(");
  expect(DASHBOARD_JS).not.toContain("fetch(");
  expect(DASHBOARD_JS).not.toContain("XMLHttpRequest");
  expect(DASHBOARD_JS).not.toContain("new Function");
});
