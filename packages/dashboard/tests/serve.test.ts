// packages/dashboard/tests/serve.test.ts
//
// LENIENT loopback smoke for the optional `--serve` mode (spec §8, F8). No SSE,
// no timing assertions, no browser: just http.get the ephemeral 127.0.0.1 port.
// The server is always closed in `finally`.
import { test, expect } from "@playwright/test";
import * as http from "node:http";
import { serveDashboard } from "../src/serve";

const HTML = `<!doctype html><html><body><main>hi</main>
<script id="sentinel-data" type="application/json">{"ok":true}</script>
</body></html>`;

/** GET a loopback URL, resolving with the status + body. */
function get(
  url: string,
  headers: http.OutgoingHttpHeaders = {},
): Promise<{ status: number; body: string; wwwAuth?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body,
          wwwAuth: res.headers["www-authenticate"] as string | undefined,
        }),
      );
    });
    req.on("error", reject);
  });
}

test("serveDashboard serves the HTML at / on an ephemeral loopback port", async () => {
  const { server, ready } = serveDashboard(HTML, { port: 0 });
  try {
    const url = await ready;
    expect(url.startsWith("http://127.0.0.1:")).toBe(true);
    const res = await get(url);
    expect(res.status).toBe(200);
    expect(res.body).toContain("sentinel-data");
  } finally {
    server.close();
  }
});

test("serveDashboard with auth: 401 without credentials, 200 with the right ones", async () => {
  const { server, ready } = serveDashboard(HTML, {
    port: 0,
    auth: { user: "u", pass: "p" },
  });
  try {
    const url = await ready;
    const anon = await get(url);
    expect(anon.status).toBe(401);
    expect(anon.wwwAuth).toContain("Basic");

    const wrong = await get(url, {
      authorization: "Basic " + Buffer.from("u:wrong").toString("base64"),
    });
    expect(wrong.status).toBe(401);

    const ok = await get(url, {
      authorization: "Basic " + Buffer.from("u:p").toString("base64"),
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toContain("sentinel-data");
  } finally {
    server.close();
  }
});
