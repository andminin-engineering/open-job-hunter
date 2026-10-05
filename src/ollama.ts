/**
 * Local Ollama adapter.
 *
 * Every offer evaluation depends on a local Ollama instance. When it is not
 * installed, not running, or the model was never pulled, the raw failure is a
 * bare "fetch failed" that tells the user nothing. This module turns those
 * cases into actionable messages and exposes a readiness probe for /health.
 */

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";
const GENERATE_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 180_000);
const PROBE_TIMEOUT_MS = 3_000;

export class OllamaUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OllamaUnavailableError";
  }
}

export type OllamaStatus = {
  baseUrl: string;
  model: string;
  reachable: boolean;
  modelAvailable: boolean;
  installedModels: string[];
  hint?: string;
};

function unreachableMessage(baseUrl: string): string {
  return `No se pudo conectar con Ollama en ${baseUrl}. Instala Ollama (https://ollama.com), abrelo y verifica que este corriendo.`;
}

function missingModelMessage(model: string): string {
  return `El modelo "${model}" no esta descargado en Ollama. Ejecuta: ollama pull ${model}`;
}

/** Matches "qwen2.5:7b" against installed names, treating a missing tag as ":latest". */
export function isModelInstalled(model: string, installed: string[]): boolean {
  const withTag = (name: string) => (name.includes(":") ? name : `${name}:latest`);
  const wanted = withTag(model);
  return installed.some((name) => withTag(name) === wanted);
}

export async function checkOllama(
  model: string = DEFAULT_OLLAMA_MODEL,
  baseUrl: string = OLLAMA_BASE_URL,
): Promise<OllamaStatus> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!response.ok) {
      return { baseUrl, model, reachable: false, modelAvailable: false, installedModels: [], hint: unreachableMessage(baseUrl) };
    }
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    const installedModels = (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
    const modelAvailable = isModelInstalled(model, installedModels);
    return {
      baseUrl,
      model,
      reachable: true,
      modelAvailable,
      installedModels,
      hint: modelAvailable ? undefined : missingModelMessage(model),
    };
  } catch {
    return { baseUrl, model, reachable: false, modelAvailable: false, installedModels: [], hint: unreachableMessage(baseUrl) };
  }
}

/** Calls /api/generate in JSON mode and returns the parsed JSON object produced by the model. */
export async function generateJson(
  model: string,
  prompt: string,
  baseUrl: string = OLLAMA_BASE_URL,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, format: "json" }),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new OllamaUnavailableError(
        `Ollama no respondio en ${Math.round(GENERATE_TIMEOUT_MS / 1000)} s. El modelo "${model}" puede ser demasiado pesado para este equipo; prueba uno mas liviano o aumenta OLLAMA_TIMEOUT_MS.`,
        { cause: error },
      );
    }
    throw new OllamaUnavailableError(unreachableMessage(baseUrl), { cause: error });
  }

  if (response.status === 404) throw new OllamaUnavailableError(missingModelMessage(model));
  if (!response.ok) throw new Error(`Ollama API respondio con estado: ${response.status}`);

  const data = (await response.json()) as { response?: string };
  if (!data.response || typeof data.response !== "string") {
    throw new Error("Ollama no devolvio una respuesta JSON valida en el campo response.");
  }

  try {
    return JSON.parse(data.response);
  } catch (error) {
    throw new Error("El modelo devolvio un JSON invalido. Reintenta la evaluacion o usa otro modelo.", { cause: error });
  }
}
