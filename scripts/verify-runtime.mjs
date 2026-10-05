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
const profilePath = join(dataDir, "profile.json");
const port = 3217;

function start(entrypoint, mode, extraEnv = {}) {
  const child = spawn(process.execPath, [join(projectRoot, "build", "bin", entrypoint)], {
    cwd: foreignCwd,
    env: {
      ...process.env,
      JOB_HUNTER_MODE: mode,
      JOB_HUNTER_DATA_DIR: dataDir,
      PROFILE_PATH: profilePath,
      OLLAMA_BASE_URL: "http://127.0.0.1:1",
      PORT: String(port),
      ...extraEnv,
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
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

async function postJson(path, body, method = "POST") {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

/** Sends newline-delimited JSON-RPC to MCP stdio and waits for the response with the given id. */
async function mcpRequest(runtime, message, timeoutMs = 10_000) {
  runtime.child.stdin.write(`${JSON.stringify(message)}\n`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = runtime.getStdout().split("\n").filter(Boolean).map((line) => JSON.parse(line))
      .find((item) => item.id === message.id);
    if (response) return response;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`MCP no respondio ${message.method}: ${runtime.getStderr()}`);
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
  if (healthPayload.profileConfigured !== false || healthPayload.ollama?.reachable !== false) {
    throw new Error(`Healthcheck no reporto perfil de ejemplo y Ollama ausente: ${JSON.stringify(healthPayload)}`);
  }
  const dashboard = await fetch(`http://127.0.0.1:${port}/`);
  const html = await dashboard.text();
  if (!dashboard.ok || !html.includes("JobHunter")) {
    throw new Error("La interfaz principal no fue servida correctamente");
  }
  if (!html.includes("const esc =") || !html.includes("const safeUrl =")) {
    throw new Error("La interfaz no incluyo las defensas esperadas para datos externos");
  }

  const profileBefore = await fetch(`http://127.0.0.1:${port}/api/profile`);
  const profileBeforePayload = await profileBefore.json();
  if (!profileBefore.ok || !profileBeforePayload.isPlaceholder || !profileBeforePayload.isExampleFile
    || profileBeforePayload.profile.responseLanguage !== "es") {
    throw new Error("El perfil inicial no fue identificado como ejemplo");
  }

  const sampleJob = {
    jobDescription: "Product designer role requiring research, prototyping and collaboration.",
    sourcePlatform: "runtime-test",
    persistResult: false,
  };
  for (const [path, body] of [["/api/evaluar", sampleJob], ["/api/evaluar-lote", { jobs: [sampleJob] }]]) {
    const blocked = await postJson(path, body);
    if (blocked.status !== 409 || !String(blocked.payload.error).includes("Mi perfil")) {
      throw new Error(`${path} evaluo con el perfil de ejemplo: ${blocked.status}`);
    }
  }

  const invalidSave = await postJson("/api/profile", { fullName: "A" }, "PUT");
  if (invalidSave.status !== 400) throw new Error(`Un perfil invalido no fue rechazado con 400: ${invalidSave.status}`);
  if (await readFile(profilePath, "utf-8").then(() => true, () => false)) {
    throw new Error("Un perfil invalido llego a escribirse en PROFILE_PATH");
  }

  const candidateProfile = {
    fullName: "Runtime Tester",
    headline: "Product Designer",
    summary: "Perfil temporal para verificar el flujo HTTP completo.",
    coreCompetencies: { design: ["Figma", "Research"] },
    locations: ["Remote"],
    languages: [{ language: "Spanish", level: "Native" }],
    responseLanguage: "en",
    search: { keywords: "product designer", minScoreToApply: 70, boards: {} },
  };
  const profileSave = await fetch(`http://127.0.0.1:${port}/api/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(candidateProfile),
  });
  if (!profileSave.ok) throw new Error(`No se pudo guardar el perfil por HTTP: ${profileSave.status}`);
  const savedProfile = JSON.parse(await readFile(profilePath, "utf-8"));
  if (savedProfile.headline !== candidateProfile.headline || savedProfile.responseLanguage !== "en") {
    throw new Error("El perfil guardado por HTTP no se persistio en PROFILE_PATH");
  }

  const profileAfterPayload = await fetch(`http://127.0.0.1:${port}/api/profile`).then((response) => response.json());
  if (profileAfterPayload.isPlaceholder || profileAfterPayload.isExampleFile
    || profileAfterPayload.profile.headline !== candidateProfile.headline
    || profileAfterPayload.profile.responseLanguage !== "en"
    || profileAfterPayload.profile.languages[0]?.language !== "Spanish") {
    throw new Error("El endpoint de perfil no sirvio los cambios sin reiniciar");
  }
  const invalidLanguage = await postJson("/api/profile", { ...candidateProfile, responseLanguage: "fr" }, "PUT");
  if (invalidLanguage.status !== 400 || JSON.parse(await readFile(profilePath, "utf-8")).responseLanguage !== "en") {
    throw new Error("Un idioma no soportado no fue rechazado con 400 o modifico el perfil guardado");
  }
  const healthAfterSave = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  if (healthAfterSave.profileConfigured !== true) throw new Error("Healthcheck no reflejo el perfil guardado");

  const pipelineRows = Array.from({ length: 227 }, (_, index) => ({
    id: `runtime-offer-${String(index).padStart(3, "0")}`,
    oferta: `Vacante de analista funcional número ${index}`,
    sourcePlatform: "runtime-test",
    company: index === 219 ? "Empresa Única" : `Empresa ${String(index).padStart(3, "0")}`,
    estado: index < 220 ? "evaluada"
      : ["oferta", "descartada", "rechazada", "nueva", "postulada", "aplicada", "entrevista_inicial"][index - 220],
    evaluacion: index < 220 ? {
      match_score: index % 100,
      apply: true,
      detected_risks: [],
      strong_points_to_highlight: [],
      custom_angle: "Prueba",
    } : undefined,
    feedbackHistorial: [],
    fechaProcesado: new Date(1_760_000_000_000 + index * 1000).toISOString(),
    fechaActualizacion: new Date(1_760_000_000_000 + index * 1000).toISOString(),
  }));
  pipelineRows[100].fechaActualizacion = pipelineRows[101].fechaActualizacion;
  pipelineRows[210].company = "";
  pipelineRows[211].company = "   ";
  const seededDatabase = `${JSON.stringify(pipelineRows, null, 2)}\n`;
  const runtimeDatabasePath = join(dataDir, "db.json");
  await writeFile(runtimeDatabasePath, seededDatabase, "utf-8");
  const getPipeline = async (query) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/pipeline?${query}`);
    return { status: response.status, payload: await response.json() };
  };
  const defaultPage = await getPipeline("");
  if (defaultPage.status !== 200 || defaultPage.payload.items.length !== 50
    || defaultPage.payload.total !== 227 || defaultPage.payload.allTotal !== 227
    || defaultPage.payload.hasMore !== true) {
    throw new Error("Pipeline perdio la paginacion predeterminada o no informo el total real");
  }
  const firstPage = await getPipeline("estado=evaluada&limit=25&offset=0");
  const lastPage = await getPipeline("estado=evaluada&limit=25&offset=200");
  if (firstPage.status !== 200 || firstPage.payload.total !== 220 || firstPage.payload.allTotal !== 227
    || firstPage.payload.items.length !== 25 || firstPage.payload.hasMore !== true
    || lastPage.payload.items.length !== 20 || lastPage.payload.hasMore !== false
    || lastPage.payload.total !== 220 || lastPage.payload.items.at(-1)?.id !== "runtime-offer-000") {
    throw new Error("Pipeline no pagino correctamente las vacantes posteriores al limite anterior de 200");
  }
  const grouped = await getPipeline("estados=descartada,rechazada&limit=25");
  if (grouped.payload.total !== 2 || grouped.payload.allTotal !== 227
    || !grouped.payload.items.some((item) => item.estado === "rechazada")
    || !grouped.payload.items.some((item) => item.estado === "descartada")) {
    throw new Error("Pipeline no agrupo descartadas y rechazadas con sus totales reales");
  }
  const unreviewed = await getPipeline("estado=nueva");
  if (unreviewed.payload.total !== 1 || unreviewed.payload.items[0]?.estado !== "nueva") {
    throw new Error("Pipeline oculto vacantes nuevas sin evaluar");
  }
  const legacy = await getPipeline("estados=aplicada,entrevista_inicial");
  if (legacy.status !== 200 || legacy.payload.total !== 2 || legacy.payload.allTotal !== 227
    || !legacy.payload.items.some((item) => item.estado === "aplicada")
    || !legacy.payload.items.some((item) => item.estado === "entrevista_inicial")) {
    throw new Error("Pipeline oculto estados heredados de la base anterior");
  }
  const legacyWrite = await postJson("/api/postulaciones/runtime-offer-220/estado", { estado: "aplicada" }, "PATCH");
  if (legacyWrite.status !== 400) throw new Error("La compatibilidad de lectura permitio escribir un estado heredado");
  const search = await getPipeline("estado=evaluada&q=empresa%20unica");
  if (search.payload.total !== 1 || search.payload.items[0]?.company !== "Empresa Única"
    || search.payload.allTotal !== 227) {
    throw new Error("Pipeline no busco sobre todas las vacantes o altero el total global");
  }
  const byScore = await getPipeline("estado=evaluada&sort=score_desc&limit=25");
  if (byScore.payload.items.length !== 25 || byScore.payload.items.some((item, index, items) =>
    index > 0 && item.evaluacion.match_score > items[index - 1].evaluacion.match_score)) {
    throw new Error("Pipeline no ordeno por compatibilidad descendente");
  }
  const byCompany = await getPipeline("estado=evaluada&sort=company_asc&limit=1");
  if (byCompany.payload.items[0]?.company !== "Empresa 000") {
    throw new Error("Pipeline no ordeno por empresa ascendente");
  }
  const withoutCompany = await getPipeline("estado=evaluada&sort=company_asc&offset=218&limit=2");
  if (withoutCompany.payload.items.map((item) => item.id).join(",") !== "runtime-offer-211,runtime-offer-210") {
    throw new Error("Pipeline no dejo empresas vacias al final con desempate estable");
  }
  const tiedDates = await getPipeline("estado=evaluada&sort=updated_desc&offset=118&limit=2");
  if (tiedDates.payload.items.map((item) => item.id).join(",") !== "runtime-offer-100,runtime-offer-101") {
    throw new Error("Pipeline no desempato por ID cuando coincide la fecha");
  }
  const invalidQueries = ["offset=-1", "offset=1.5", "estados=desconocida", "estados=", "sort=otro", "estado=evaluada&estados=oferta"];
  const invalidResults = await Promise.all(invalidQueries.map(getPipeline));
  for (const [index, invalid] of invalidResults.entries()) {
    if (invalid.status !== 400) throw new Error(`Pipeline acepto el parametro invalido ${invalidQueries[index]}: ${invalid.status}`);
  }
  if (await readFile(runtimeDatabasePath, "utf-8") !== seededDatabase) {
    throw new Error("Las consultas del pipeline modificaron la base de datos");
  }

  const evaluationWithoutOllama = await fetch(`http://127.0.0.1:${port}/api/evaluar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sampleJob),
  });
  const evaluationError = await evaluationWithoutOllama.json();
  if (evaluationWithoutOllama.status !== 503 || !String(evaluationError.error).includes("Ollama")) {
    throw new Error(`Ollama ausente no produjo un diagnostico HTTP 503: ${evaluationWithoutOllama.status}`);
  }
  const schedulerStatus = await fetch(`http://127.0.0.1:${port}/api/scheduler/status`);
  if (schedulerStatus.status !== 500) throw new Error("El scheduler acepto silenciosamente JSON corrupto");
  if (await readFile(schedulerConfigPath, "utf-8") !== "invalid-scheduler-json") {
    throw new Error("El scheduler modifico el archivo corrupto");
  }

  conflicting = start("all.js", "all");
  const conflictExitCode = await waitForExit(conflicting.child, 10_000);
  if (conflictExitCode === 0) throw new Error("El proceso con bind conflictivo termino con codigo exitoso");
  if (!conflicting.getStderr().includes("Could not bind HTTP")) {
    throw new Error(`El fallo de bind no fue diagnosticado: ${conflicting.getStderr()}`);
  }

  await stop(http.child);
  http = undefined;

  // A profile path that does not exist yet, so MCP runs on the shipped example.
  mcp = start("mcp.js", "mcp", { PROFILE_PATH: join(dataDir, "mcp-unconfigured", "profile.json") });
  await waitForHttp(`http://127.0.0.1:${port}/health`, false);
  if (mcp.child.exitCode !== null) throw new Error(`MCP termino prematuramente: ${mcp.getStderr()}`);
  if (mcp.getStdout() !== "") throw new Error(`MCP contamino stdout sin recibir mensajes: ${mcp.getStdout()}`);
  await mcpRequest(mcp, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-runtime", version: "0" } },
  });
  mcp.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const mcpEvaluation = await mcpRequest(mcp, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "evaluar_oferta_laboral", arguments: sampleJob },
  });
  const mcpPayload = JSON.parse(mcpEvaluation.result?.content?.[0]?.text ?? "{}");
  if (mcpPayload.ok !== false || !String(mcpPayload.error).includes("Mi perfil")) {
    throw new Error(`MCP evaluo con el perfil de ejemplo: ${JSON.stringify(mcpEvaluation)}`);
  }
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
  console.log("OK  HTTP y MCP rechazaron evaluar con el perfil de ejemplo");
  console.log("OK  un perfil invalido fue rechazado sin escribirse");
  console.log("OK  perfil HTTP se guardo, persistio y recargo sin reiniciar");
  console.log("OK  pipeline pagino mas de 200 vacantes con totales, filtros, orden y estados completos");
  console.log("OK  healthcheck reporto perfil y Ollama");
  console.log("OK  Ollama ausente produjo un diagnostico HTTP 503");
  console.log("OK  dashboard incluyo escape de contenido y validacion de URLs");
  console.log(`OK  persistencia concurrente entre procesos preservo ${writerCount} ofertas`);
  console.log(`OK  datos aislados en ${dataDir}`);
} finally {
  await Promise.all([http, conflicting, mcp].filter(Boolean).map((runtime) => stop(runtime.child)));
  await rm(dataDir, { recursive: true, force: true });
}
