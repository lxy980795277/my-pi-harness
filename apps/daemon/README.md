# Local daemon

The M0 daemon exposes read-only runtime diagnostics. It owns its HTTP listener and SSE subscriptions, while the desktop process supervises its lifetime. It does not create agents or access model credentials.

`GET /api/health` returns the shared health response. `GET /api/runtime/events` starts with one `runtime.ready` event and sends heartbeat comments every 15 seconds; pending response backpressure skips disposable heartbeat comments until the buffer drains. This streaming route does not accept `HEAD`. Closing a connection releases its subscription; stopping the daemon ends every SSE response before closing HTTP. Shutdown also closes HTTP connections with incomplete request headers.

| Environment variable          | Purpose                                                                       | Default  |
| ----------------------------- | ----------------------------------------------------------------------------- | -------- |
| `MY_PI_HARNESS_PORT`          | TCP port; `0` selects an available port                                       | `4311`   |
| `MY_PI_HARNESS_WEB_DIST_PATH` | Compiled Web assets containing `index.html`                                   | Disabled |
| `MY_PI_HARNESS_PARENT_PID`    | Positive signed 32-bit desktop process ID to watch; its exit stops the daemon | Disabled |

The listener always binds to `127.0.0.1`. Relative asset paths resolve from the daemon's working directory. SPA navigation falls back to `index.html`; missing API routes remain JSON 404 responses.

After listening, `src/bootstrap.ts` writes one JSON `daemon.ready` record to stdout with the actual port and instance ID. Logs go to stderr. `SIGINT`, `SIGTERM`, or a missing parent process closes the daemon. A desktop-owned process also accepts the validated `daemon.shutdown` control message over Node IPC and stops when that channel disconnects; standalone launches do not require an IPC channel.

Development runs TypeScript through `tsx`. Published launches execute `dist/bootstrap.js` under the separately bundled Node runtime. Build the protocol package before building this application; source checks and tests resolve protocol source directly.

`pnpm --filter @my-pi-harness/daemon test` runs source behavior tests. Artifact tests use a real `dist/bootstrap.js` subprocess with dynamic ports and an IPC owner channel: first run `pnpm build`, then `pnpm --filter @my-pi-harness/daemon test:built`. They validate invalid startup configuration, readiness, invalid control input, SSE, graceful shutdown, and owner disconnection. Artifact tests are excluded from the source suite so stale or missing `dist` cannot affect source checks.
