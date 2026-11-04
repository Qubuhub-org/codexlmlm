# CodexLMLM hybrid runtime bridge

This package-level bridge adds an explicit runtime entry point without replacing the bundled Rust Codex engine.

## Commands

```sh
codex lmlm status
codex lmlm run --backend codex --workspace . --task "Inspect the project and report risks"
codex lmlm run --backend lmlm --workspace . --task "Review the current change"
codex lmlm run --backend auto --workspace . --task "Run the project checks"
```

`auto` selects LMLM only when both `LMLM_BASE_URL` and `LMLM_API_KEY` are present. Otherwise it uses the bundled Codex executable. The normal Codex CLI remains unchanged for all commands that do not begin with `lmlm`.

## LMLM task adapter protocol v1

Configure the adapter with environment variables:

- `LMLM_BASE_URL`: HTTPS base URL for the LMLM task gateway. Plain HTTP is accepted only for loopback development endpoints.
- `LMLM_API_KEY`: bearer token. Never place credentials in the URL or commit them to source control.
- `--timeout`: optional request timeout in milliseconds (1–900000; default 120000).

The bridge sends a JSON `POST` to `{LMLM_BASE_URL}/v1/tasks` with protocol identifier `codexlmlm.tasks.v1`, task text, canonical workspace path, and requested policy hints (`approval=required`, `sandbox=workspace-write`, `network=deny-by-default`). The gateway must independently authenticate the caller, validate the workspace, enforce approvals and sandbox/network policy, and return a JSON object. The bridge does not treat policy hints as enforcement and does not expose a shell-execution endpoint.

The endpoint response is printed as JSON. A response status of `failed`, `error`, or `cancelled` produces a non-zero exit code. HTTP errors, malformed responses, and timeouts fail closed.

## Security and current limits

- LMLM requests are explicitly routed only when selected or when `auto` sees both required credentials.
- The workspace path is sent to the configured LMLM gateway; use a trusted local gateway or a secured environment that can access that path.
- The bridge does not transfer repository files, start remote workers, or grant the gateway access to the local machine by itself.
- The native Codex backend delegates to the existing bundled Codex executable and its existing sandbox/approval controls.
- This is the first executable adapter boundary, not a claim that an LMLM server or production worker is already deployed.

## Tests

Run `npm run test:hybrid-runtime` from the repository root, or run `node --test runtime/hybrid-runtime.test.js` directly. Node.js 18 or newer is required.
