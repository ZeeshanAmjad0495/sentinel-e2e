// packages/dashboard/src/serve.ts
//
// Optional `--serve` mode (spec §1 grafted-from-hybrid idea, F8). Node built-ins
// ONLY (node:http) — zero new dependencies — bound to 127.0.0.1 (loopback). The
// server returns the generated dashboard HTML at `/`. When `auth` is provided it
// requires HTTP Basic Auth; without `auth` it serves openly.
//
// This is deliberately tiny and lenient: no SSE/live-tail, no fs.watch, no
// timing behaviour. It exists to let an operator open the static dashboard in a
// browser without writing a file. Everything interactive remains deferred (§10).
import * as http from "node:http";
import { generateDashboard } from "./render";
import type { DashboardModel } from "./model";

export interface ServeAuth {
  readonly user: string;
  readonly pass: string;
}

export interface ServeDashboardOptions {
  /** Port to bind on 127.0.0.1. Use 0 for an ephemeral port (tests). */
  readonly port: number;
  /** When set, require HTTP Basic Auth matching these credentials. */
  readonly auth?: ServeAuth;
}

export interface ServeDashboardResult {
  readonly server: http.Server;
  /**
   * The loopback URL. For a fixed port this is final immediately; for an
   * ephemeral port (`port: 0`) the host:port is filled in once the server has
   * bound — await `ready` to get the resolved URL deterministically.
   */
  readonly url: string;
  /** Resolves to the final loopback URL once the server is listening. */
  readonly ready: Promise<string>;
}

const REALM = 'Basic realm="Sentinel Dashboard"';

/** Constant-ish credential check against the configured Basic Auth header. */
function authOk(header: string | undefined, auth: ServeAuth): boolean {
  if (!header) return false;
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1]!, "base64").toString("utf8");
  } catch {
    return false;
  }
  const expected = `${auth.user}:${auth.pass}`;
  return decoded === expected;
}

/**
 * Serve a single self-contained dashboard over loopback. Accepts either the
 * already-generated HTML string or a `DashboardModel` (rendered here). Returns
 * the live server (caller closes it; long-running on the CLI path) and the URL.
 *
 * Binding is hard-coded to 127.0.0.1 — this is a local operator convenience, not
 * a network service. Optional Basic Auth (`auth`) is the only access control.
 */
export function serveDashboard(
  input: string | DashboardModel,
  opts: ServeDashboardOptions,
): ServeDashboardResult {
  const html = typeof input === "string" ? input : generateDashboard(input, {});

  const server = http.createServer((req, res) => {
    if (opts.auth && !authOk(req.headers.authorization, opts.auth)) {
      res.writeHead(401, {
        "WWW-Authenticate": REALM,
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Authentication required.");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  const urlFor = (): string => {
    const address = server.address();
    const port =
      address && typeof address === "object" ? address.port : opts.port;
    return `http://127.0.0.1:${port}`;
  };

  const ready = new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => resolve(urlFor()));
  });
  // Never let an unhandled rejection escape if the caller ignores `ready`.
  ready.catch(() => undefined);

  // Best-effort synchronous URL (final immediately for a fixed, non-zero port).
  return { server, url: urlFor(), ready };
}
