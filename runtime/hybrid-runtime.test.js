import test from "node:test";
import assert from "node:assert/strict";
import { parseLmlmArgs, resolveBackend, runLmlmCommand, validateEndpoint } from "./hybrid-runtime.js";

test("status command has no run options", () => {
  assert.deepEqual(parseLmlmArgs(["status"]), { command: "status" });
});

test("run command parses task, backend, workspace and timeout", () => {
  assert.deepEqual(
    parseLmlmArgs(["run", "--task", "fix tests", "--backend", "lmlm", "--workspace", ".", "--timeout", "5000"]),
    { command: "run", backend: "lmlm", workspace: ".", task: "fix tests", timeoutMs: 5000 },
  );
});

test("run command requires a task", () => {
  assert.throws(() => parseLmlmArgs(["run"]), /A task is required/);
});

test("auto backend selects LMLM only when endpoint and key are configured", () => {
  assert.equal(resolveBackend("auto", {}), "codex");
  assert.equal(resolveBackend("auto", { LMLM_BASE_URL: "https://localhost", LMLM_API_KEY: "test" }), "lmlm");
  assert.equal(resolveBackend("codex", { LMLM_BASE_URL: "https://localhost", LMLM_API_KEY: "test" }), "codex");
});

test("LMLM endpoint requires HTTPS except loopback", () => {
  assert.equal(validateEndpoint("https://agent.example").href, "https://agent.example/v1/tasks");
  assert.equal(validateEndpoint("http://127.0.0.1:8080").href, "http://127.0.0.1:8080/v1/tasks");
  assert.equal(validateEndpoint("http://[::1]:8080").href, "http://[::1]:8080/v1/tasks");
  assert.throws(() => validateEndpoint("http://agent.example"), /must use HTTPS/);
  assert.throws(() => validateEndpoint("https://user:pass@agent.example"), /Do not embed credentials/);
});

test("LMLM backend sends policy-scoped task request to the fake gateway", async () => {
  let request;
  let output = "";
  const exitCode = await runLmlmCommand(
    ["run", "--backend", "lmlm", "--workspace", ".", "--task", "inspect repository"],
    {
      env: { LMLM_BASE_URL: "http://127.0.0.1:8080", LMLM_API_KEY: "unit-test-token" },
      stdout: { write: (value) => { output += value; } },
      fetchImpl: async (url, options) => {
        request = { url: url.toString(), options };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: "task-1", status: "queued" }),
        };
      },
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(request.url, "http://127.0.0.1:8080/v1/tasks");
  assert.equal(request.options.headers.authorization, "Bearer unit-test-token");
  assert.equal(request.options.redirect, "error");
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.protocol, "codexlmlm.tasks.v1");
  assert.equal(payload.task, "inspect repository");
  assert.equal(payload.policy.approval, "required");
  assert.equal(payload.policy.sandbox, "workspace-write");
  assert.equal(payload.policy.network, "deny-by-default");
  assert.match(output, /"status": "queued"/);
});

test("LMLM failed task status returns a non-zero exit code", async () => {
  const exitCode = await runLmlmCommand(
    ["run", "--backend", "lmlm", "--workspace", ".", "--task", "test failure"],
    {
      env: { LMLM_BASE_URL: "http://localhost:8080", LMLM_API_KEY: "unit-test-token" },
      stdout: { write: () => {} },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "task-2", status: "failed" }),
      }),
    },
  );

  assert.equal(exitCode, 1);
});
