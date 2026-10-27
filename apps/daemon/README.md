# Local daemon

The daemon owns the local application API, cookie authorization, provider gateway, Pi session runtime and profile storage. Browser and Electron clients share committed session facts. Routes project public DTOs; credentials remain in host-owned stores, with plugin OAuth persistence owned by [plugin connections](src/plugin-connections/README.md). See [M1 protocol](../../docs/03_API/model-session.md).

`src/bootstrap.ts` is the process entry. `src/application/` owns configuration, startup environment policy, parent monitoring and service assembly. `src/http/` owns Fastify, request access/error handling, cancellation, runtime SSE and Web documents. Auth, sessions, models, MCP, Skills, plugins and other domains live directly under `src/`; route assembly does not own their business implementations. Skill resource adaptation belongs to `skills/runtime.ts`, and independent approval context belongs to `tools/approval-context.ts`.

Service initialization releases every acquired resource after failure, even when an individual cleanup rejects, and closes profile storage last. Combined failures retain the startup error followed by cleanup errors; successful cleanup preserves the original startup failure.

Workspace registration and execution share the `execution` package's root policy: existing absolute directories are resolved with `realpath` and checked for directory/read access. Filesystem roots, the user home or its ancestors, profile overlaps and roots containing sensitive directory components are rejected. Registration accepts directory aliases and stores the real path; execution rechecks its identity and each actual target. The default display name follows the protocol length limit without truncating the stored path; explicit names remain strictly validated. Workspace names use optimistic revisions. Removing a workspace archives only metadata and requires all its sessions to be archived first; user files are never removed. Sessions created without a workspace remain plain chats and do not inherit the daemon working directory.

`GET /api/health` returns the shared health response. `GET /api/runtime/events` starts with one `runtime.ready` event and sends heartbeat comments every 15 seconds; pending response backpressure skips disposable heartbeat comments until the buffer drains. This streaming route does not accept `HEAD`. Closing a connection releases its subscription; stopping the daemon ends every SSE response before closing HTTP. Shutdown also closes HTTP connections with incomplete request headers.

| Environment variable          | Purpose                                                                       | Default  |
| ----------------------------- | ----------------------------------------------------------------------------- | -------- |
| `MY_PI_HARNESS_PORT`          | TCP port; `0` selects an available port                                       | `4311`   |
| `MY_PI_HARNESS_WEB_DIST_PATH` | Compiled Web assets containing `index.html`                                   | Disabled |
| `MY_PI_HARNESS_PARENT_PID`    | Positive signed 32-bit desktop process ID to watch; its exit stops the daemon | Disabled |

`bootstrap.ts` clears the verified OpenAI/Anthropic SDK environment overrides once before creating model services: API/admin keys, auth tokens, organization/project IDs, base URLs, custom headers, webhook secrets and SDK console log levels. Other host environment variables remain available. Credentials, endpoints and permitted model headers come from the application configuration. Embedded hosts must apply the same startup policy; constructing `ApplicationServices` does not mutate global environment.

The listener always binds to `127.0.0.1`. Relative asset paths resolve from the daemon's working directory. SPA navigation falls back to `index.html`; missing API routes remain JSON 404 responses.

After listening, `src/bootstrap.ts` writes one JSON `daemon.ready` record to stdout with the actual port and instance ID. Logs go to stderr. `SIGINT`, `SIGTERM`, or a missing parent process closes the daemon. A desktop-owned process also accepts the validated `daemon.shutdown` control message over Node IPC and stops when that channel disconnects; standalone launches do not require an IPC channel.

Development runs TypeScript through `tsx`. Published launches execute `dist/bootstrap.js` under the separately bundled Node runtime. Build protocol, agent-runtime and storage before building this application; source checks and tests resolve workspace source directly.

`pnpm --filter @my-pi-harness/daemon test` runs source behavior tests. Artifact tests use a real `dist/bootstrap.js` subprocess with dynamic ports and an IPC owner channel: first run `pnpm build`, then `pnpm --filter @my-pi-harness/daemon test:built`. They validate invalid startup configuration, readiness, invalid control input, SSE, graceful shutdown, and owner disconnection. Artifact tests are excluded from the source suite so stale or missing `dist` cannot affect source checks.
