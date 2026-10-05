import { afterEach, describe, expect, it, vi } from "vitest";
import { checkOllama, generateJson, isModelInstalled, OllamaUnavailableError } from "../src/ollama.js";

const BASE_URL = "http://ollama.test";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("ollama model matching", () => {
  it("treats a missing tag as :latest", () => {
    expect(isModelInstalled("llama3", ["llama3:latest"])).toBe(true);
    expect(isModelInstalled("qwen2.5:7b", ["qwen2.5:7b", "llama3:latest"])).toBe(true);
    expect(isModelInstalled("qwen2.5:7b", ["qwen2.5:3b"])).toBe(false);
  });
});

describe("ollama readiness probe", () => {
  it("reports an unreachable server with an install hint instead of throwing", async () => {
    stubFetch(async () => { throw new TypeError("fetch failed"); });
    const status = await checkOllama("qwen2.5:7b", BASE_URL);
    expect(status).toMatchObject({ reachable: false, modelAvailable: false });
    expect(status.hint).toContain("https://ollama.com");
  });

  it("reports a missing model with the pull command", async () => {
    stubFetch(async () => Response.json({ models: [{ name: "llama3:latest" }] }));
    const status = await checkOllama("qwen2.5:7b", BASE_URL);
    expect(status).toMatchObject({ reachable: true, modelAvailable: false, installedModels: ["llama3:latest"] });
    expect(status.hint).toContain("ollama pull qwen2.5:7b");
  });

  it("is ready when the model is installed", async () => {
    stubFetch(async () => Response.json({ models: [{ name: "qwen2.5:7b" }] }));
    const status = await checkOllama("qwen2.5:7b", BASE_URL);
    expect(status).toMatchObject({ reachable: true, modelAvailable: true });
    expect(status.hint).toBeUndefined();
  });
});

describe("ollama generation", () => {
  it("turns a connection failure into an actionable 503 error", async () => {
    stubFetch(async () => { throw new TypeError("fetch failed"); });
    const failure = generateJson("qwen2.5:7b", "prompt", BASE_URL);
    await expect(failure).rejects.toBeInstanceOf(OllamaUnavailableError);
    await expect(failure).rejects.toThrow(/No se pudo conectar con Ollama/);
  });

  it("explains a missing model instead of a bare 404", async () => {
    stubFetch(async () => new Response("model not found", { status: 404 }));
    await expect(generateJson("qwen2.5:7b", "prompt", BASE_URL)).rejects.toThrow(/ollama pull qwen2.5:7b/);
  });

  it("returns the JSON object produced by the model", async () => {
    const fetchMock = stubFetch(async () => Response.json({ response: "{\"match_score\": 80}" }));
    await expect(generateJson("qwen2.5:7b", "prompt", BASE_URL)).resolves.toEqual({ match_score: 80 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/generate`);
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "qwen2.5:7b", format: "json", stream: false });
  });

  it("rejects malformed model output with a readable message", async () => {
    stubFetch(async () => Response.json({ response: "not json" }));
    await expect(generateJson("qwen2.5:7b", "prompt", BASE_URL)).rejects.toThrow(/JSON invalido/);
  });
});
