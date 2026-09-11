import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const foreignCwd = process.platform === "win32" && process.env.SystemRoot
  ? process.env.SystemRoot
  : tmpdir();
const dataDir = await mkdtemp(join(tmpdir(), "mcp-job-hunter-runtime-"));
const schedulerConfigPath = join(dataDir, "scheduler-config.json");
const port = 3217;

function start(entrypoint, mode) {
  const child = spawn(process.execPath, [join(projectRoot, "build", "bin", entrypoint)], {
    cwd: foreignCwd,
    env: {
      ...process.env,
      JOB_HUNTER_MODE: mode,
      JOB_HUNTER_DATA_DIR: dataDir,
      PORT: String(port),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  return { child, getStdout: () => stdout, getStderr: () => stderr };
}

function runDatabaseWriter(index, databasePath) {
  const child = spawn(process.execPath, [
    join(projectRoot, "tests", "fixtures", "database-writer.mjs"),
    `Cross-process TypeScript role ${index}`,
    `Cross-process Company ${index}`,
  ], {
    cwd: foreignCwd,
    env: { ...process.env, JOB_HUNTER_DB_PATH: databasePath },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  return new Promise((resolveWriter, rejectWriter) => {
    child.once("exit", (code) => {
      if (code === 0) resolveWriter(undefined);
      else rejectWriter(new Error(`Writer ${index} fallo (${code}): ${stderr}`));
    });
  });
}

async function waitForHttp(url, shouldSucceed) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url);
      if (shouldSucceed) return response;
    } catch {
      if (!shouldSucceed && attempt >= 5) return undefined;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(shouldSucceed ? `HTTP no respondio en ${url}` : `MCP abrio inesperadamente ${url}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolveExit) => {
    const timeout = setTimeout(resolveExit, 2000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
    child.kill();
  });
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return child.exitCode;
  return await new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => rejectExit(new Error("El proceso no termino dentro del plazo")), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolveExit(code);
    });
  });
}

let http;
let conflicting;
let mcp;
try {
  await writeFile(schedulerConfigPath, "invalid-scheduler-json", "utf-8");
  http = start("http.js", "http");
  const health = await waitForHttp(`http://127.0.0.1:${port}/health`, true);
  if (!health?.ok) throw new Error(`Healthcheck HTTP invalido: ${health?.status}`);
  if (health.headers.has("access-control-allow-origin")) {
    throw new Error("HTTP habilito CORS sin un origen configurado explicitamente");
  }
  const healthPayload = await health.json();
  if (healthPayload.mode !== "http") throw new Error(`Healthcheck reporto modo incorrecto: ${healthPayload.mode}`);
  const dashboard = await fetch(`http://127.0.0.1:${port}/`);
  const html = await dashboard.text();
  if (!dashboard.ok || !html.includes("JobHunter")) {
    throw new Error("La interfaz principal no fue servida correctamente");
  }
  const schedulerStatus = await fetch(`http://127.0.0.1:${port}/api/scheduler/status`);
  if (schedulerStatus.status !== 500) throw new Error("El scheduler acepto silenciosamente JSON corrupto");
  if (await readFile(schedulerConfigPath, "utf-8") !== "invalid-scheduler-json") {
    throw new Error("El scheduler modifico el archivo corrupto");
  }

  conflicting = start("all.js", "all");
  const conflictExitCode = await waitForExit(conflicting.child, 3000);
  if (conflictExitCode === 0) throw new Error("El proceso con bind conflictivo termino con codigo exitoso");
  if (!conflicting.getStderr().includes("Could not bind HTTP")) {
    throw new Error(`El fallo de bind no fue diagnosticado: ${conflicting.getStderr()}`);
  }

  await stop(http.child);
  http = undefined;

  mcp = start("mcp.js", "mcp");
  await waitForHttp(`http://127.0.0.1:${port}/health`, false);
  if (mcp.child.exitCode !== null) throw new Error(`MCP termino prematuramente: ${mcp.getStderr()}`);
  if (mcp.getStdout() !== "") throw new Error(`MCP contamino stdout sin recibir mensajes: ${mcp.getStdout()}`);
  await stop(mcp.child);
  mcp = undefined;

  const concurrentDbPath = join(dataDir, "concurrent", "db.json");
  const writerCount = 12;
  await Promise.all(Array.from({ length: writerCount }, (_, index) => runDatabaseWriter(index, concurrentDbPath)));
  const concurrentRows = JSON.parse(await readFile(concurrentDbPath, "utf-8"));
  if (concurrentRows.length !== writerCount) {
    throw new Error(`Persistencia entre procesos perdio filas: ${concurrentRows.length}/${writerCount}`);
  }

  console.log(`OK  HTTP e interfaz iniciaron desde ${foreignCwd}`);
  console.log("OK  un fallo de bind cerro el proceso combinado con error");
  console.log("OK  MCP stdio no abrio un puerto HTTP");
  console.log("OK  MCP stdio no escribio logs en stdout");
  console.log("OK  scheduler preservo JSON corrupto y reporto error");
  console.log(`OK  persistencia concurrente entre procesos preservo ${writerCount} ofertas`);
  console.log(`OK  datos aislados en ${dataDir}`);
} finally {
  await Promise.all([http, conflicting, mcp].filter(Boolean).map((runtime) => stop(runtime.child)));
  await rm(dataDir, { recursive: true, force: true });
}
