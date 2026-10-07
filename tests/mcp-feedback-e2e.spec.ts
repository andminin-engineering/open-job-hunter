import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tsxCli = join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");

/** Entirely fictional candidate profile: valid but synthetic, never the shipped example. */
const SYNTHETIC_PROFILE = {
  fullName: "Candidata Sintetica",
  headline: "Desarrolladora de Software",
  summary: "Perfil ficticio creado solo para la prueba e2e de feedback de recruiter.",
  coreCompetencies: { lenguajes: ["TypeScript", "Python"] },
  locations: ["Remoto"],
  languages: [{ language: "Espanol", level: "Nativo" }],
  responseLanguage: "es",
  search: { keywords: "software", minScoreToApply: 70, boards: {} },
};

/** Entirely fictional job posting used only to seed the pipeline in this test. */
const SYNTHETIC_JOB = {
  jobDescription:
    "Empresa ficticia busca desarrolladora de software senior con experiencia en TypeScript, " +
    "Node.js y diseno de APIs. Puesto 100% remoto, contrato indefinido, salario competitivo. " +
    "Vacante creada exclusivamente para pruebas automatizadas, no es una oferta real.",
  sourcePlatform: "e2e-feedback-test",
  company: "Acme Ficticia S.A.",
  persistResult: true,
};

/** Canned evaluator output the fake Ollama server returns for any prompt. */
const CANNED_EVALUATION = {
  match_score: 82,
  apply: true,
  detected_risks: [],
  strong_points_to_highlight: ["Experiencia en TypeScript"],
  custom_angle: "Angulo sintetico generado por la prueba e2e.",
};

const SYNTHETIC_FEEDBACK = {
  canal: "email",
  mensaje:
    "La recruiter indico que el perfil encaja con la vacante y pidio disponibilidad " +
    "para una entrevista tecnica la proxima semana. Mensaje ficticio de prueba.",
  accionRecomendada:
    "Responder el email con tres horarios disponibles y adjuntar el CV actualizado. " +
    "Accion ficticia de prueba.",
};

interface ToolTextResult {
  content: Array<{ type: string; text?: string }>;
}

function parseToolPayload(result: ToolTextResult): any {
  const text = result.content.find((item) => item.type === "text")?.text;
  expect(text, "la herramienta MCP devolvio contenido de texto").toBeTruthy();
  return JSON.parse(text as string);
}

describe("mcp feedback e2e", () => {
  let testDir: string | undefined;
  let ollamaStub: Server | undefined;
  let client: Client | undefined;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "mcp-feedback-e2e-"));
    await writeFile(join(testDir, "profile.json"), JSON.stringify(SYNTHETIC_PROFILE, null, 2), "utf-8");

    ollamaStub = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/generate") {
        req.resume();
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ response: JSON.stringify(CANNED_EVALUATION) }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => ollamaStub?.listen(0, "127.0.0.1", resolve));
    const stubPort = (ollamaStub.address() as { port: number }).port;

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [tsxCli, "src/bin/mcp.ts"],
      cwd: projectRoot,
      stderr: "pipe",
      env: {
        ...process.env,
        JOB_HUNTER_DB_PATH: join(testDir, "db.json"),
        PROFILE_PATH: join(testDir, "profile.json"),
        OLLAMA_BASE_URL: `http://127.0.0.1:${stubPort}`,
      },
    });

    client = new Client({ name: "mcp-feedback-e2e", version: "0.0.0" }, { capabilities: {} });
    await client.connect(transport);
  });

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    client = undefined;
    await new Promise<void>((resolve) => {
      if (!ollamaStub) return resolve();
      ollamaStub.close(() => resolve());
    });
    ollamaStub = undefined;
    if (testDir) await rm(testDir, { recursive: true, force: true });
    testDir = undefined;
  });

  it("registers recruiter feedback through the MCP stdio transport and reads it back from the pipeline", async () => {
    expect(client).toBeDefined();
    const mcp = client as Client;

    // 1. Create a synthetic application through the MCP transport (never via the DB helper).
    const evaluation = parseToolPayload(
      (await mcp.callTool({ name: "evaluar_oferta_laboral", arguments: SYNTHETIC_JOB })) as ToolTextResult,
    );
    expect(evaluation.ok).toBe(true);
    const applicationId: string = evaluation.record?.id;
    expect(typeof applicationId).toBe("string");

    // 2. Move it to "postulada" so feedback registration follows the real pipeline flow.
    const applied = parseToolPayload(
      (await mcp.callTool({
        name: "actualizar_estado_postulacion",
        arguments: { id: applicationId, estado: "postulada" },
      })) as ToolTextResult,
    );
    expect(applied.ok).toBe(true);
    expect(applied.item.estado).toBe("postulada");

    // 3. Register the recruiter feedback through the MCP transport.
    const feedback = parseToolPayload(
      (await mcp.callTool({
        name: "registrar_feedback_postulacion",
        arguments: { id: applicationId, ...SYNTHETIC_FEEDBACK },
      })) as ToolTextResult,
    );
    expect(feedback.ok).toBe(true);
    expect(feedback.item.estado).toBe("feedback_recibido");

    // 4. Verify the feedback is returned by the pipeline: channel, message and recommended action.
    const pipeline = parseToolPayload(
      (await mcp.callTool({
        name: "listar_pipeline_postulaciones",
        arguments: { estado: "feedback_recibido" },
      })) as ToolTextResult,
    );
    expect(pipeline.ok).toBe(true);
    const item = pipeline.items.find((entry: { id: string }) => entry.id === applicationId);
    expect(item, "la postulacion con feedback aparece en el pipeline").toBeDefined();
    const history = item.feedbackHistorial;
    expect(Array.isArray(history) && history.length).toBeGreaterThan(0);
    const last = history[history.length - 1];
    expect(last.canal).toBe(SYNTHETIC_FEEDBACK.canal);
    expect(last.mensaje).toBe(SYNTHETIC_FEEDBACK.mensaje);
    expect(last.accionRecomendada).toBe(SYNTHETIC_FEEDBACK.accionRecomendada);
  }, 60_000);

  it("removes every temporary file once the MCP server stops", async () => {
    const dir = testDir as string;
    await expect(stat(dir)).resolves.toBeDefined();
    await client?.close();
    client = undefined;
    await new Promise<void>((resolve) => {
      ollamaStub?.close(() => resolve());
    });
    ollamaStub = undefined;
    await rm(dir, { recursive: true, force: true });
    testDir = undefined;
    await expect(stat(dir)).rejects.toThrow();
  }, 60_000);
});
