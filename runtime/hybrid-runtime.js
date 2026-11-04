import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 15 * 60_000;

export function parseLmlmArgs(argv) {
  const [command, ...rest] = argv;
  if (command === "status" && rest.length === 0) {
    return { command: "status" };
  }
  if (command !== "run") {
    throw new Error("Usage: codex lmlm <status | run --task <text> [--backend auto|codex|lmlm] [--workspace <path>]>");
  }

  const options = { backend: "auto", workspace: process.cwd(), task: "" };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--task" || argument === "-t") {
      const value = rest[++index];
      if (!value) throw new Error("--task requires a non-empty value");
      options.task = value;
    } else if (argument === "--backend") {
      const value = rest[++index];
      if (!["auto", "codex", "lmlm"].includes(value)) {
        throw new Error("--backend must be auto, codex, or lmlm");
      }
      options.backend = value;
    } else if (argument === "--workspace" || argument === "-C") {
      const value = rest[++index];
      if (!value) throw new Error("--workspace requires a path");
      options.workspace = value;
    } else if (argument === "--timeout") {
      const value = Number(rest[++index]);
      if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
        throw new Error(`--timeout must be an integer from 1 to ${MAX_TIMEOUT_MS} milliseconds`);
      }
      options.timeoutMs = value;
    } else {
      throw new Error(`Unknown LMLM option: ${argument}`);
    }
  }

  if (!options.task.trim()) throw new Error("A task is required; pass --task <text>");
  return { command: "run", ...options };
}

export function resolveBackend(requested, env = process.env) {
  if (requested !== "auto") return requested;
  return env.LMLM_BASE_URL && env.LMLM_API_KEY ? "lmlm" : "codex";
}

export function validateEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("LMLM_BASE_URL must be a valid absolute URL");
  }
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && localHost)) {
    throw new Error("LMLM_BASE_URL must use HTTPS (HTTP is allowed only for localhost)");
  }
  if (endpoint.username || endpoint.password) {
    throw new Error("Do not embed credentials in LMLM_BASE_URL; use LMLM_API_KEY");
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/v1/tasks`;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

async function resolveWorkspace(workspace) {
  const absolutePath = await realpath(path.resolve(workspace));
  const details = await stat(absolutePath);
  if (!details.isDirectory()) throw new Error("--workspace must point to a directory");
  return absolutePath;
}

function printStatus(env, stdout) {
  const configured = Boolean(env.LMLM_BASE_URL && env.LMLM_API_KEY);
  stdout.write("CodexLMLM hybrid runtime\n");
  stdout.write(`Codex backend: available through the bundled native Codex executable\n`);
  stdout.write(`LMLM backend: ${configured ? "configured" : "not configured"}\n`);
  stdout.write(`LMLM endpoint: ${env.LMLM_BASE_URL || "not set"}\n`);
  stdout.write("Default backend: auto (LMLM when configured, otherwise Codex)\n");
  stdout.write("Execution policy: backend policy applies; LMLM requests require approval\n");
}

async function runCodex({ executable, task, workspace }) {
  if (!executable) throw new Error("The bundled Codex executable could not be resolved");
  const child = spawn(executable, ["exec", "--cd", workspace, task], { stdio: "inherit" });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

async function runLmlm({ env, task, workspace, timeoutMs, stdout }) {
  if (!env.LMLM_BASE_URL || !env.LMLM_API_KEY) {
    throw new Error("LMLM backend requires LMLM_BASE_URL and LMLM_API_KEY");
  }
  const endpoint = validateEndpoint(env.LMLM_BASE_URL);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.LMLM_API_KEY}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        protocol: "codexlmlm.tasks.v1",
        task,
        workspace,
        policy: {
          approval: "required",
          sandbox: "workspace-write",
          network: "deny-by-default",
        },
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`LMLM endpoint returned HTTP ${response.status}: ${body.slice(0, 1000)}`);
    }
    let result;
    try {
      result = JSON.parse(body);
    } catch {
      throw new Error("LMLM endpoint returned a non-JSON response");
    }
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("LMLM endpoint response must be a JSON object");
    }
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return ["failed", "error", "cancelled"].includes(result.status) ? 1 : 0;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`LMLM task timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runLmlmCommand(argv, dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;
  const options = parseLmlmArgs(argv);
  if (options.command === "status") {
    printStatus(env, stdout);
    return 0;
  }

  const backend = resolveBackend(options.backend, env);
  const workspace = await resolveWorkspace(options.workspace);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (backend === "codex") {
    return runCodex({
      executable: dependencies.codexExecutable,
      task: options.task,
      workspace,
    });
  }

  return runLmlm({ env, task: options.task, workspace, timeoutMs, stdout });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runLmlmCommand(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`CodexLMLM: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
