import test from "node:test";
import assert from "node:assert/strict";
import { parseLmlmArgs, resolveBackend, validateEndpoint } from "./hybrid-runtime.js";

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
  assert.throws(() => validateEndpoint("http://agent.example"), /must use HTTPS/);
  assert.throws(() => validateEndpoint("https://user:pass@agent.example"), /Do not embed credentials/);
});
