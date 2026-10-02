import { constants } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataOverride = process.env.JOB_HUNTER_DATA_DIR;
const profileOverride = process.env.PROFILE_PATH;
const dataDir = dataOverride && isAbsolute(dataOverride)
  ? resolve(dataOverride)
  : join(projectRoot, "src", "data");
const profilePath = profileOverride && isAbsolute(profileOverride)
  ? resolve(profileOverride)
  : join(projectRoot, "config", "profile.json");
const exampleProfilePath = join(projectRoot, "config", "profile.example.json");
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const ollamaModel = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";
const checks = [];

function result(level, name, detail) {
  checks.push({ level, name, detail });
}

const major = Number(process.versions.node.split(".")[0]);
result(major >= 20 ? "OK" : "ERROR", "Node.js 20 o superior", process.version);
result(!dataOverride || isAbsolute(dataOverride) ? "OK" : "ERROR", "ruta de datos absoluta", dataOverride ?? "default del proyecto");
result(!profileOverride || isAbsolute(profileOverride) ? "OK" : "ERROR", "ruta de perfil absoluta", profileOverride ?? "default del proyecto");

for (const [name, path] of [
  ["package.json", join(projectRoot, "package.json")],
  ["build HTTP", join(projectRoot, "build", "bin", "http.js")],
  ["build MCP", join(projectRoot, "build", "bin", "mcp.js")],
]) {
  const present = await access(path).then(() => true, () => false);
  result(present ? "OK" : "ERROR", name, path);
}

try {
  await mkdir(dataDir, { recursive: true });
  await access(dataDir, constants.R_OK | constants.W_OK);
  result("OK", "directorio de datos legible y escribible", dataDir);
} catch (error) {
  result("ERROR", "directorio de datos legible y escribible", error instanceof Error ? error.message : String(error));
}

try {
  const activeProfilePath = await access(profilePath).then(() => profilePath, () => exampleProfilePath);
  const profile = JSON.parse(await readFile(activeProfilePath, "utf-8"));
  const configured = typeof profile.fullName === "string" && profile.fullName.trim() !== "Your Name";
  result(configured ? "OK" : "WARN", "perfil del candidato", configured ? activeProfilePath : "todavia usa profile.example.json; completalo en Mi perfil");
} catch (error) {
  result("ERROR", "perfil del candidato", error instanceof Error ? error.message : String(error));
}

try {
  const response = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const installed = (payload.models ?? []).map((item) => item.name).filter(Boolean);
  const normalize = (name) => name.includes(":") ? name : `${name}:latest`;
  const available = installed.some((name) => normalize(name) === normalize(ollamaModel));
  result(available ? "OK" : "WARN", "Ollama y modelo local", available ? `${ollamaBaseUrl} · ${ollamaModel}` : `Ollama responde, pero falta ${ollamaModel}; ejecuta: ollama pull ${ollamaModel}`);
} catch (error) {
  result("WARN", "Ollama local", `${ollamaBaseUrl} no disponible; las evaluaciones requieren Ollama (${error instanceof Error ? error.message : String(error)})`);
}

for (const check of checks) {
  console.log(`${check.level.padEnd(5)} ${check.name}: ${check.detail}`);
}

if (checks.some((check) => check.level === "ERROR")) process.exitCode = 1;
