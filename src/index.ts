import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import nodemailer from "nodemailer";
import { buildEvaluatorPrompt } from "./prompts.js";
import { loadProfile } from "./profile.js";
import {
  actualizarOfertaMetadata,
  actualizarEstadoOferta,
  agregarFeedbackOferta,
  guardarOferta,
  listarOfertas,
  obtenerOfertaPorId,
  type EstadoPostulacion,
} from "./database.js";

const HTTP_PORT = Number(process.env.PORT ?? 3000);
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const SCHEDULER_CONFIG_PATH = process.env.SCHEDULER_CONFIG_PATH ?? join(process.cwd(), "src", "data", "scheduler-config.json");

const EstadoPostulacionSchema = z.enum([
  "nueva",
  "evaluada",
  "descartada",
  "postulada",
  "feedback_recibido",
  "entrevista",
  "rechazada",
  "oferta",
]);

const JobEvaluationSchema = z.object({
  jobDescription: z.string().min(20),
  sourcePlatform: z.string().optional().default("LinkedIn"),
  expectedSalaryRange: z.string().optional(),
  ollamaModel: z.string().optional().default("qwen2.5:7b"),
  company: z.string().optional(),
  jobUrl: z.string().url().optional(),
  persistResult: z.boolean().optional().default(true),
});

const JobEvaluationBatchSchema = z.object({
  jobs: z.array(JobEvaluationSchema).min(1).max(100),
  continueOnError: z.boolean().optional().default(true),
});

const JobDiscoverySchema = z.object({
  search: z.string().min(2).optional().default("software engineer"),
  limit: z.number().int().positive().max(20).optional().default(10),
});

const GreenhouseDiscoverySchema = z.object({
  board: z.string().min(2),
  company: z.string().min(2).optional(),
  limit: z.number().int().positive().max(20).optional().default(10),
});

const LeverDiscoverySchema = z.object({
  company: z.string().min(2),
  companyLabel: z.string().min(2).optional(),
  limit: z.number().int().positive().max(20).optional().default(10),
});

const CoreDiscoverySchema = z.object({
  remotive: JobDiscoverySchema.optional(),
  greenhouse: z.union([GreenhouseDiscoverySchema, z.array(GreenhouseDiscoverySchema).min(1)]).optional(),
  lever: z.union([LeverDiscoverySchema, z.array(LeverDiscoverySchema).min(1)]).optional(),
  continueOnError: z.boolean().optional().default(true),
});

const SchedulerSchema = z.object({
  enabled: z.boolean().default(false),
  intervalMinutes: z.number().int().min(15).max(1440).default(180),
  timezone: z.string().min(3).default("America/Argentina/Buenos_Aires"),
  runHours: z.array(z.number().int().min(0).max(23)).min(1).default([8, 11, 14, 18]),
  minScoreForDigest: z.number().int().min(0).max(100).default(70),
  topMatchesLimit: z.number().int().min(1).max(50).default(10),
  recipientEmail: z.string().email().optional(),
  fromName: z.string().default("MCP Job Hunter Scheduler"),
  core: CoreDiscoverySchema,
});

const SchedulerConfigUpdateSchema = z.object({
  recipientEmail: z.string().email().optional(),
  fromName: z.string().min(2).optional(),
});

type SchedulerConfig = z.infer<typeof SchedulerSchema>;

type SchedulerRuntimeState = {
  isEnabled: boolean;
  isRunning: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  lastResult?: unknown;
  lastDigest?: {
    to?: string;
    subject: string;
    body: string;
    sent: boolean;
    reason?: string;
  };
};

type SchedulerCycleOutcome =
  | {
    ok: true;
    trigger: "manual" | "interval";
    runResult: Extract<Awaited<ReturnType<typeof executeCoreDiscoveryImport>>, { ok: true }>;
    digest: {
      to?: string;
      subject: string;
      sent: boolean;
      reason?: string;
    };
  }
  | {
    ok: false;
    trigger?: "manual" | "interval";
    error: string;
    runResult?: Extract<Awaited<ReturnType<typeof executeCoreDiscoveryImport>>, { ok: false }>;
  };

const schedulerState: SchedulerRuntimeState = {
  isEnabled: false,
  isRunning: false,
};

function getDefaultSchedulerConfig(): SchedulerConfig {
  return SchedulerSchema.parse({
    enabled: process.env.SCHEDULER_ENABLED === "true",
    intervalMinutes: process.env.SCHEDULER_INTERVAL_MINUTES ? Number(process.env.SCHEDULER_INTERVAL_MINUTES) : 180,
    timezone: process.env.SCHEDULER_TIMEZONE ?? "America/Argentina/Buenos_Aires",
    runHours: [8, 11, 14, 18, 21],
    minScoreForDigest: 72,
    topMatchesLimit: 12,
    recipientEmail: process.env.SCHEDULER_EMAIL_TO,
    fromName: "MCP Job Hunter Scheduler",
    core: {
      remotive: {
        search: "software architect OR delivery lead OR backend java senior",
        limit: 10,
      },
      greenhouse: [
        { board: "stripe", company: "Stripe", limit: 8 },
        { board: "coinbase", company: "Coinbase", limit: 8 },
        { board: "datadog", company: "Datadog", limit: 8 },
        { board: "figma", company: "Figma", limit: 8 },
        { board: "asana", company: "Asana", limit: 8 },
        { board: "mongodb", company: "MongoDB", limit: 8 },
      ],
      lever: [
        { company: "lever", companyLabel: "Lever", limit: 6 },
      ],
      continueOnError: true,
    },
  });
}

async function loadSchedulerConfig(): Promise<SchedulerConfig> {
  const fallback = getDefaultSchedulerConfig();

  try {
    const raw = await readFile(SCHEDULER_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return SchedulerSchema.parse({
      ...fallback,
      ...parsed,
      core: {
        ...fallback.core,
        ...(parsed.core ?? {}),
      },
    });
  } catch {
    return fallback;
  }
}

async function saveSchedulerConfig(config: SchedulerConfig): Promise<void> {
  await writeFile(SCHEDULER_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

function getHourForTimezone(date: Date, timezone: string): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  }).format(date);
  return Number(formatted);
}

function getMinutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

const UrlDiscoverySchema = z.object({
  sourceUrl: z.string().url(),
  limit: z.number().int().positive().max(20).optional().default(8),
});

const PrepareEmailSchema = z.object({
  to: z.string().email().optional(),
  fromName: z.string().optional().default(process.env.APPLICANT_NAME ?? "Candidate"),
  portfolioUrl: z.string().url().optional().default(process.env.PORTFOLIO_URL ?? "https://github.com/your-handle"),
  markAsPostulada: z.boolean().optional().default(false),
});

const ApplicationPackSchema = z.object({
  fromName: z.string().optional().default(process.env.APPLICANT_NAME ?? "Candidate"),
  portfolioUrl: z.string().url().optional().default(process.env.PORTFOLIO_URL ?? "https://github.com/your-handle"),
  to: z.string().email().optional(),
  markAsPostulada: z.boolean().optional().default(false),
});

const EvaluationResultSchema = z.object({
  match_score: z.number().min(0).max(100),
  apply: z.boolean(),
  detected_risks: z.array(z.string()),
  strong_points_to_highlight: z.array(z.string()),
  custom_angle: z.string().nullable().transform((value) => value ?? "Sin angulo personalizado generado"),
});

const ActualizarEstadoSchema = z.object({
  id: z.string().min(3),
  estado: EstadoPostulacionSchema,
});

const RegistrarFeedbackSchema = z.object({
  id: z.string().min(3),
  canal: z.string().min(2),
  mensaje: z.string().min(5),
  accionRecomendada: z.string().optional(),
});

const ListarPipelineSchema = z.object({
  estado: EstadoPostulacionSchema.optional(),
  limit: z.number().int().positive().max(200).optional().default(50),
});

function jsonResponse(payload: unknown) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function writeHttpJson(res: any, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function normalizeLimit(limitRaw: string | null): number {
  if (!limitRaw) {
    return 50;
  }
  const parsed = Number(limitRaw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 50;
  }
  return Math.min(200, Math.trunc(parsed));
}

function computeFunnelMetrics(items: Awaited<ReturnType<typeof listarOfertas>>) {
  const postulacionesEnviadas = items.filter((item) =>
    ["postulada", "feedback_recibido", "entrevista", "rechazada", "oferta"].includes(item.estado)
  ).length;

  const feedbackRecibido = items.filter((item) =>
    ["feedback_recibido", "entrevista", "rechazada", "oferta"].includes(item.estado)
  ).length;

  const entrevistasConcretadas = items.filter((item) =>
    ["entrevista", "oferta"].includes(item.estado)
  ).length;

  return {
    postulacionesEnviadas,
    feedbackRecibido,
    entrevistasConcretadas,
  };
}

function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeLines(input: string): string[] {
  return input
    .split(/\r?\n|•|\u2022|\-/)
    .map((line) => stripHtmlTags(line).trim())
    .filter((line) => line.length >= 8)
    .slice(0, 12);
}

function extractSection(html: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}[\\s\\S]{0,80}<\\/h[1-6]>([\\s\\S]{0,3500})`, "i");
  const match = html.match(regex);
  if (!match || !match[1]) {
    return undefined;
  }
  return match[1];
}

function extractEmails(text: string): string[] {
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
  return [...new Set(matches.map((email) => email.toLowerCase()))];
}

function selectRecruiterEmail(emails: string[]): string | undefined {
  if (emails.length === 0) {
    return undefined;
  }

  const preferred = emails.find((email) => /(talent|recruit|hiring|jobs|careers|hr)/i.test(email));
  if (preferred) {
    return preferred;
  }

  const nonGeneric = emails.find((email) => !/(privacy|support|noreply|donotreply|help|legal)/i.test(email));
  return nonGeneric;
}

function extractApplyUrl(html: string, fallbackUrl?: string): string | undefined {
  const explicit = html.match(/href="([^"]+)"[^>]*>\s*Apply[^<]*<\/a>/i)?.[1];
  if (explicit) {
    return explicit.startsWith("http") ? explicit : fallbackUrl ? new URL(explicit, fallbackUrl).toString() : explicit;
  }

  const ashby = html.match(/https:\/\/jobs\.ashbyhq\.com\/[^"]+/i)?.[0];
  if (ashby) {
    return ashby;
  }

  return fallbackUrl;
}

async function enrichOfferFromUrl(item: Awaited<ReturnType<typeof obtenerOfertaPorId>>) {
  if (!item || !item.jobUrl) {
    throw new Error("La vacante no tiene jobUrl para enriquecer.");
  }

  const response = await fetch(item.jobUrl);
  if (!response.ok) {
    throw new Error(`No se pudo leer la URL de la vacante (${response.status}).`);
  }

  const html = await response.text();
  const text = stripHtmlTags(html);

  const requirementsHtml = extractSection(html, "Requirements")
    ?? extractSection(html, "What We're Looking For")
    ?? extractSection(html, "Qualifications");

  const excluyentesHtml = extractSection(html, "It is a MUST")
    ?? extractSection(html, "Must Have")
    ?? extractSection(html, "Required");

  const requisitos = requirementsHtml ? normalizeLines(stripHtmlTags(requirementsHtml)) : [];
  const excluyentes = excluyentesHtml ? normalizeLines(stripHtmlTags(excluyentesHtml)) : [];
  const emails = extractEmails(text);
  const recruiterEmail = selectRecruiterEmail(emails);
  const applyUrl = extractApplyUrl(html, item.jobUrl);

  const updated = await actualizarOfertaMetadata(item.id, {
    recruiterEmail,
    applyUrl,
    requisitos,
    excluyentes,
  });

  return {
    recruiterEmail,
    applyUrl,
    requisitos,
    excluyentes,
    item: updated,
  };
}

function parseSilverTitle(title: string) {
  const chunks = title.split(" - ");
  if (chunks.length >= 2) {
    return {
      company: chunks[0].trim(),
      role: chunks.slice(1).join(" - ").trim(),
    };
  }
  return {
    company: "Silver Opportunity",
    role: title.trim(),
  };
}

function extractMatch(input: string, regex: RegExp): string | undefined {
  const m = input.match(regex);
  if (!m || !m[1]) {
    return undefined;
  }
  return stripHtmlTags(m[1]).trim();
}

function compactText(input: string, maxLength: number): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function humanizeSlug(input: string): string {
  return input
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildEvaluationJobsFromDiscovery(items: Array<{
  title: string;
  company: string;
  url?: string;
  location?: string;
  salary?: string;
  compensation?: string;
  description: string;
  sourcePlatform: string;
}>) {
  return items.map((item) => JobEvaluationSchema.parse({
    company: item.company,
    sourcePlatform: item.sourcePlatform,
    expectedSalaryRange: item.salary ?? item.compensation,
    jobUrl: item.url,
    jobDescription: [item.title, item.location, item.description].filter(Boolean).join(". "),
    persistResult: true,
  }));
}

async function discoverJobsFromSilverUrl(sourceUrl: string, limit: number) {
  const listResponse = await fetch(sourceUrl);
  if (!listResponse.ok) {
    throw new Error(`Silver.dev respondio con estado ${listResponse.status}`);
  }

  const listHtml = await listResponse.text();
  const absoluteMatches = listHtml.match(/https:\/\/silver\.dev\/jobs\/[a-z0-9-]+/gi) ?? [];
  const relativeMatches = (listHtml.match(/href="\/jobs\/[a-z0-9-]+"/gi) ?? [])
    .map((item) => item.replace(/href="/i, "").replace(/"$/, ""))
    .map((path) => `https://silver.dev${path}`);

  const allLinks = [...new Set([...absoluteMatches, ...relativeMatches])]
    .filter((link) => !link.includes("?"))
    .slice(0, limit);

  const items: Array<{
    title: string;
    company: string;
    url: string;
    location?: string;
    locationType?: string;
    compensation?: string;
    description: string;
    sourcePlatform: string;
  }> = [];

  for (const jobUrl of allLinks) {
    try {
      const jobResponse = await fetch(jobUrl);
      if (!jobResponse.ok) {
        continue;
      }

      const jobHtml = await jobResponse.text();
      const h1Title = extractMatch(jobHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? "Backend Opportunity";
      const { company, role } = parseSilverTitle(h1Title);
      const location = extractMatch(jobHtml, /Location<\/h2>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
      const locationType = extractMatch(jobHtml, /Location type<\/h2>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
      const compensation = extractMatch(jobHtml, /Compensation<\/h2>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);

      const plainText = stripHtmlTags(jobHtml);
      const compactDescription = plainText.length > 1800 ? `${plainText.slice(0, 1800)}...` : plainText;

      items.push({
        title: role,
        company,
        url: jobUrl,
        location,
        locationType,
        compensation,
        description: compactDescription,
        sourcePlatform: "Silver.dev URL",
      });
    } catch {
      // Ignore parse failures in individual posts and continue with the rest.
    }
  }

  return items;
}

async function discoverJobsFromGreenhouse(board: string, company: string | undefined, limit: number) {
  const url = new URL(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`);
  url.searchParams.set("content", "true");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Greenhouse API respondio con estado ${response.status}`);
  }

  const data = (await response.json()) as {
    jobs?: Array<{
      title?: string;
      absolute_url?: string;
      location?: { name?: string };
      content?: string;
    }>;
  };

  return (data.jobs ?? []).slice(0, limit).map((job) => {
    const description = stripHtmlTags(job.content ?? "");
    return {
      title: job.title ?? "Sin titulo",
      company: company ?? humanizeSlug(board),
      url: job.absolute_url,
      location: job.location?.name,
      description: compactText(description, 1200),
      sourcePlatform: "Greenhouse API",
    };
  });
}

async function discoverJobsFromLever(company: string, companyLabel: string | undefined, limit: number) {
  const url = new URL(`https://api.lever.co/v0/postings/${company}`);
  url.searchParams.set("mode", "json");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Lever API respondio con estado ${response.status}`);
  }

  const data = (await response.json()) as Array<{
    text?: string;
    hostedUrl?: string;
    applyUrl?: string;
    categories?: { location?: string };
    description?: string;
    descriptionPlain?: string;
  }>;

  return data.slice(0, limit).map((job) => {
    const descriptionText = stripHtmlTags(job.descriptionPlain ?? job.description ?? "");
    return {
      title: job.text ?? "Sin titulo",
      company: companyLabel ?? humanizeSlug(company),
      url: job.hostedUrl ?? job.applyUrl,
      location: job.categories?.location,
      description: compactText(descriptionText, 1200),
      sourcePlatform: "Lever API",
    };
  });
}

async function runBatchEvaluation(jobs: z.infer<typeof JobEvaluationSchema>[], continueOnError = true) {
  const results: Array<{
    index: number;
    ok: boolean;
    company?: string;
    sourcePlatform?: string;
    match_score?: number;
    apply?: boolean;
    id?: string;
    error?: string;
  }> = [];

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    try {
      const outcome = await evaluarOferta(job);
      const record = outcome.record as { id?: string } | null;
      results.push({
        index: i,
        ok: true,
        company: job.company,
        sourcePlatform: job.sourcePlatform,
        match_score: outcome.evaluation.match_score,
        apply: outcome.evaluation.apply,
        id: record?.id,
      });
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error no controlado";
      results.push({
        index: i,
        ok: false,
        company: job.company,
        sourcePlatform: job.sourcePlatform,
        error: message,
      });
      failed += 1;

      if (!continueOnError) {
        break;
      }
    }
  }

  return {
    processed,
    failed,
    results,
  };
}

async function discoverJobsFromRemotive(search: string, limit: number) {
  const url = new URL("https://remotive.com/api/remote-jobs");
  url.searchParams.set("search", search);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Remotive API respondio con estado ${response.status}`);
  }

  const data = (await response.json()) as {
    jobs?: Array<{
      title?: string;
      company_name?: string;
      url?: string;
      candidate_required_location?: string;
      salary?: string;
      description?: string;
      category?: string;
    }>;
  };

  const jobs = (data.jobs ?? []).slice(0, limit).map((job) => {
    const descriptionText = stripHtmlTags(job.description ?? "");
    const compactDescription = descriptionText.length > 1200
      ? `${descriptionText.slice(0, 1200)}...`
      : descriptionText;

    return {
      title: job.title ?? "Sin titulo",
      company: job.company_name ?? "Sin empresa",
      url: job.url,
      location: job.candidate_required_location,
      salary: job.salary,
      category: job.category,
      description: compactDescription,
      sourcePlatform: "Remotive API",
    };
  });

  return jobs;
}

async function executeCoreDiscoveryImport(parsed: z.infer<typeof CoreDiscoverySchema>) {
  const discoveryItems: Array<{
    title: string;
    company: string;
    url?: string;
    location?: string;
    salary?: string;
    compensation?: string;
    description: string;
    sourcePlatform: string;
  }> = [];
  const sourceSummaries: Record<string, { total: number; ok: boolean; error?: string }> = {};

  if (parsed.remotive) {
    try {
      const remotiveItems = await discoverJobsFromRemotive(parsed.remotive.search, parsed.remotive.limit);
      discoveryItems.push(...remotiveItems);
      sourceSummaries.remotive = { total: remotiveItems.length, ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error no controlado";
      sourceSummaries.remotive = { total: 0, ok: false, error: message };
      if (!parsed.continueOnError) {
        throw error;
      }
    }
  }

  const greenhouseConfigs = parsed.greenhouse
    ? (Array.isArray(parsed.greenhouse) ? parsed.greenhouse : [parsed.greenhouse])
    : [];

  let greenhouseTotal = 0;
  let greenhouseFailed = false;
  for (const item of greenhouseConfigs) {
    try {
      const greenhouseItems = await discoverJobsFromGreenhouse(item.board, item.company, item.limit);
      discoveryItems.push(...greenhouseItems);
      greenhouseTotal += greenhouseItems.length;
    } catch (error) {
      greenhouseFailed = true;
      const message = error instanceof Error ? error.message : "Error no controlado";
      sourceSummaries[`greenhouse:${item.board}`] = { total: 0, ok: false, error: message };
      if (!parsed.continueOnError) {
        throw error;
      }
    }
  }
  if (greenhouseConfigs.length > 0) {
    sourceSummaries.greenhouse = { total: greenhouseTotal, ok: !greenhouseFailed };
  }

  const leverConfigs = parsed.lever
    ? (Array.isArray(parsed.lever) ? parsed.lever : [parsed.lever])
    : [];

  let leverTotal = 0;
  let leverFailed = false;
  for (const item of leverConfigs) {
    try {
      const leverItems = await discoverJobsFromLever(item.company, item.companyLabel, item.limit);
      discoveryItems.push(...leverItems);
      leverTotal += leverItems.length;
    } catch (error) {
      leverFailed = true;
      const message = error instanceof Error ? error.message : "Error no controlado";
      sourceSummaries[`lever:${item.company}`] = { total: 0, ok: false, error: message };
      if (!parsed.continueOnError) {
        throw error;
      }
    }
  }
  if (leverConfigs.length > 0) {
    sourceSummaries.lever = { total: leverTotal, ok: !leverFailed };
  }

  if (discoveryItems.length === 0) {
    return {
      ok: false as const,
      source: "core",
      totalImported: 0,
      processed: 0,
      failed: 0,
      sourceSummaries,
      results: [],
      error: "No se configuraron fuentes para el núcleo diario.",
    };
  }

  const batch = await runBatchEvaluation(buildEvaluationJobsFromDiscovery(discoveryItems), parsed.continueOnError);
  return {
    ok: true as const,
    source: "core",
    totalImported: discoveryItems.length,
    processed: batch.processed,
    failed: batch.failed,
    sourceSummaries,
    results: batch.results,
  };
}

async function buildSchedulerDigest(
  runResult: Awaited<ReturnType<typeof executeCoreDiscoveryImport>>,
  config: SchedulerConfig
) {
  const all = await listarOfertas();
  const top = [...all]
    .filter((item) => (item.evaluacion?.match_score ?? 0) >= config.minScoreForDigest)
    .sort((a, b) => (b.evaluacion?.match_score ?? 0) - (a.evaluacion?.match_score ?? 0))
    .slice(0, config.topMatchesLimit);

  const subject = `[MCP Job Hunter] Resumen scheduler ${new Date().toISOString().slice(0, 10)}`;
  const lines = [
    "Resumen de corrida automatizada",
    "",
    `Total descubiertas/importadas: ${runResult.totalImported}`,
    `Procesadas: ${runResult.processed}`,
    `Fallidas: ${runResult.failed}`,
    "",
    "Top vacantes por match_score:",
    ...(top.length > 0
      ? top.map((item, idx) => {
        const score = item.evaluacion?.match_score ?? 0;
        const apply = item.evaluacion?.apply ? "SI" : "NO";
        return `${idx + 1}. [${score}] ${item.company ?? "Empresa"} | ${item.sourcePlatform} | apply=${apply} | ${item.jobUrl ?? "sin URL"}`;
      })
      : ["(sin vacantes por encima del score mínimo)"
      ]),
    "",
    "Fuente por fuente:",
    ...Object.entries(runResult.sourceSummaries).map(([name, info]) => `${name}: ok=${info.ok} total=${info.total}${info.error ? ` error=${info.error}` : ""}`),
  ];

  return {
    to: config.recipientEmail,
    subject,
    body: lines.join("\n"),
    topCount: top.length,
  };
}

async function deliverSchedulerDigest(digest: { to?: string; subject: string; body: string }) {
  if (!digest.to) {
    return {
      sent: false,
      reason: "recipientEmail no configurado",
    };
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    return {
      sent: false,
      reason: "SMTP no configurado; se genero solo borrador de resumen",
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from: smtpFrom,
    to: digest.to,
    subject: digest.subject,
    text: digest.body,
  });

  return {
    sent: true,
  };
}

async function runSchedulerCycle(trigger: "manual" | "interval"): Promise<SchedulerCycleOutcome> {
  if (schedulerState.isRunning) {
    return {
      ok: false,
      error: "Scheduler ya se encuentra ejecutando una corrida.",
    };
  }

  schedulerState.isRunning = true;
  try {
    const config = await loadSchedulerConfig();
    const parsedCore = CoreDiscoverySchema.parse(config.core);
    const runResult = await executeCoreDiscoveryImport(parsedCore);
    if (!runResult.ok) {
      schedulerState.lastResult = {
        trigger,
        ...runResult,
      };
      return {
        ok: false,
        trigger,
        error: runResult.error,
        runResult,
      };
    }

    const digest = await buildSchedulerDigest(runResult, config);
    const delivered = await deliverSchedulerDigest(digest);

    schedulerState.lastRunAt = new Date().toISOString();
    schedulerState.lastResult = {
      trigger,
      ...runResult,
    };
    schedulerState.lastDigest = {
      to: digest.to,
      subject: digest.subject,
      body: digest.body,
      sent: delivered.sent,
      reason: delivered.sent ? undefined : delivered.reason,
    };

    return {
      ok: true,
      trigger,
      runResult,
      digest: {
        to: digest.to,
        subject: digest.subject,
        sent: delivered.sent,
        reason: delivered.sent ? undefined : delivered.reason,
      },
    };
  } finally {
    schedulerState.isRunning = false;
  }
}

function shouldRunSchedulerNow(now: Date, config: SchedulerConfig) {
  const hour = getHourForTimezone(now, config.timezone);
  return config.runHours.includes(hour);
}

function startSchedulerLoop() {
  setInterval(async () => {
    try {
      const config = await loadSchedulerConfig();
      schedulerState.isEnabled = config.enabled;
      schedulerState.nextRunAt = getMinutesFromNow(config.intervalMinutes);

      if (!config.enabled) {
        return;
      }

      if (!shouldRunSchedulerNow(new Date(), config)) {
        return;
      }

      const minGapMs = config.intervalMinutes * 60 * 1000;
      const lastRunTime = schedulerState.lastRunAt ? new Date(schedulerState.lastRunAt).getTime() : 0;
      if (lastRunTime && Date.now() - lastRunTime < minGapMs) {
        return;
      }

      const result = await runSchedulerCycle("interval");
      if (!result.ok) {
        console.error("Scheduler cycle con error:", result);
      } else {
        console.error("Scheduler cycle OK:", {
          totalImported: result.runResult.totalImported,
          processed: result.runResult.processed,
          failed: result.runResult.failed,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error no controlado";
      console.error("Scheduler loop fallo:", message);
    }
  }, 60 * 1000);
}

function buildEmailDraft(
  item: Awaited<ReturnType<typeof obtenerOfertaPorId>>,
  input: z.infer<typeof PrepareEmailSchema>
) {
  if (!item) {
    throw new Error("Vacante no encontrada");
  }

  const strongPoints = item.evaluacion?.strong_points_to_highlight ?? [];
  const bulletSection = strongPoints.length > 0
    ? strongPoints.map((point) => `- ${point}`).join("\n")
    : "- Experiencia en arquitectura y backend de nivel senior.\n- Liderazgo tecnico y foco en calidad de entrega.";

  const to = input.to ?? item.recruiterEmail;
  if (!to) {
    throw new Error("No se detecto email del recruiter. Ingresalo manualmente o usa applyUrl.");
  }

  const subject = `Application - ${item.company ?? "Company"} - ${input.fromName}`;
  const body = [
    `Hello ${item.company ?? "Hiring Team"},`,
    "",
    `I am interested in applying for this opportunity (${item.applyUrl ?? item.jobUrl ?? "job post"}).`,
    "Based on my background, I can contribute strongly in:",
    bulletSection,
    "",
    `Portfolio: ${input.portfolioUrl}`,
    "",
    "I would be glad to continue the conversation and share my CV.",
    "",
    `Best regards,`,
    `${input.fromName}`,
  ].join("\n");

  const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return {
    to,
    subject,
    body,
    mailtoUrl,
  };
}

function buildApplicationPack(
  item: Awaited<ReturnType<typeof obtenerOfertaPorId>>,
  input: z.infer<typeof ApplicationPackSchema>
) {
  if (!item) {
    throw new Error("Vacante no encontrada");
  }

  const requisitos = item.requisitos ?? [];
  const excluyentes = item.excluyentes ?? [];
  const intro = `Postulacion sugerida para ${item.company ?? "empresa"}`;
  const textoSugerido = [
    `${intro}`,
    "",
    `Hola ${item.company ?? "equipo de seleccion"},`,
    "",
    `Me interesa esta vacante (${item.applyUrl ?? item.jobUrl ?? "sin URL"}) y considero que puedo aportar valor rapido en backend/arquitectura.`,
    "",
    "Alineacion con requisitos:",
    ...(requisitos.length > 0 ? requisitos.slice(0, 5).map((r) => `- ${r}`) : ["- Experiencia en arquitectura y delivery de software enterprise."]),
    "",
    "Puntos excluyentes cubiertos:",
    ...(excluyentes.length > 0 ? excluyentes.slice(0, 5).map((r) => `- ${r}`) : ["- Disponibilidad inmediata y seniority tecnico/lead."]),
    "",
    `Portfolio: ${input.portfolioUrl}`,
    "",
    `Saludos,`,
    `${input.fromName}`,
  ].join("\n");

  return {
    recruiterEmail: item.recruiterEmail,
    applyUrl: item.applyUrl ?? item.jobUrl,
    requisitos,
    excluyentes,
    textoSugerido,
  };
}

async function parseJsonBody(req: any): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf-8").trim();
  if (!text) {
    return {};
  }
  return JSON.parse(text);
}

async function evaluarOferta(input: z.infer<typeof JobEvaluationSchema>) {
  const profile = await loadProfile();
  const systemPrompt = buildEvaluatorPrompt(profile);
  const promptConsolidado = `${systemPrompt}
    
[DATOS DE ENTRADA DE LA BÚSQUEDA]
- Plataforma Origen: ${input.sourcePlatform}
- Rango Salarial Provisto: ${input.expectedSalaryRange || "No especificado"}
- Empresa: ${input.company || "No especificada"}
- URL de oferta: ${input.jobUrl || "No especificada"}
- Descripción del Puesto:
${input.jobDescription}

Por favor, ejecuta el análisis estructural estricto basándote en el perfil del candidato y devuelve el objeto JSON requerido de forma directa.`;

  console.error(`Iniciando peticion a Ollama local usando el modelo: ${input.ollamaModel}...`);

  const ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.ollamaModel,
      prompt: promptConsolidado,
      stream: false,
      format: "json",
    }),
  });

  if (!ollamaResponse.ok) {
    throw new Error(`Ollama API respondio con estado: ${ollamaResponse.status}`);
  }

  const ollamaData = (await ollamaResponse.json()) as { response?: string };

  if (!ollamaData.response || typeof ollamaData.response !== "string") {
    throw new Error("Ollama no devolvio una respuesta JSON valida en el campo response.");
  }

  const parsedEvaluation = EvaluationResultSchema.parse(JSON.parse(ollamaData.response));
  let registroPersistido: unknown = null;

  if (input.persistResult) {
    const estado: EstadoPostulacion = parsedEvaluation.apply ? "evaluada" : "descartada";
    registroPersistido = await guardarOferta({
      oferta: input.jobDescription,
      sourcePlatform: input.sourcePlatform,
      expectedSalaryRange: input.expectedSalaryRange,
      company: input.company,
      jobUrl: input.jobUrl,
      estado,
      evaluacion: parsedEvaluation,
    });
  }

  return {
    ok: true,
    evaluation: parsedEvaluation,
    persisted: Boolean(input.persistResult),
    record: registroPersistido,
  };
}

const server = new Server(
  {
    name: "open-job-hunter",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "evaluar_oferta_laboral",
        description: "Evaluates a job offer against the configured candidate profile (config/profile.json) using a local Ollama model. If persistResult=true, stores the result in the local pipeline DB.",
        inputSchema: {
          type: "object",
          properties: {
            jobDescription: {
              type: "string",
              description: "Texto completo de la postulacion o descripcion del puesto (JD).",
            },
            sourcePlatform: {
              type: "string",
              description: "Plataforma de origen (ej: LinkedIn, Mail).",
            },
            expectedSalaryRange: {
              type: "string",
              description: "Rango salarial estimado (opcional).",
            },
            ollamaModel: {
              type: "string",
              description: "Modelo de Ollama a utilizar (opcional, por defecto qwen2.5:7b).",
            },
            company: {
              type: "string",
              description: "Empresa de la vacante (opcional).",
            },
            jobUrl: {
              type: "string",
              description: "URL publica de la vacante (opcional).",
            },
            persistResult: {
              type: "boolean",
              description: "Si es true guarda la vacante y evaluacion en la base local.",
            },
          },
          required: ["jobDescription"],
        },
      },
      {
        name: "listar_pipeline_postulaciones",
        description: "Lista vacantes almacenadas en la base local, opcionalmente filtradas por estado.",
        inputSchema: {
          type: "object",
          properties: {
            estado: {
              type: "string",
              enum: ["nueva", "evaluada", "descartada", "postulada", "feedback_recibido", "entrevista", "rechazada", "oferta"],
            },
            limit: {
              type: "number",
              description: "Cantidad maxima de registros a devolver (default 50).",
            },
          },
          required: [],
        },
      },
      {
        name: "actualizar_estado_postulacion",
        description: "Actualiza el estado de una vacante ya persistida usando su id.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
            },
            estado: {
              type: "string",
              enum: ["nueva", "evaluada", "descartada", "postulada", "feedback_recibido", "entrevista", "rechazada", "oferta"],
            },
          },
          required: ["id", "estado"],
        },
      },
      {
        name: "registrar_feedback_postulacion",
        description: "Registra feedback recibido de recruiter/hiring manager y mueve el estado a feedback_recibido.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
            },
            canal: {
              type: "string",
              description: "Canal de feedback: email, linkedin, llamada, etc.",
            },
            mensaje: {
              type: "string",
              description: "Resumen textual del feedback recibido.",
            },
            accionRecomendada: {
              type: "string",
              description: "Siguiente accion sugerida para mejorar conversion.",
            },
          },
          required: ["id", "canal", "mensaje"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "evaluar_oferta_laboral") {
      const parsedArgs = JobEvaluationSchema.parse(args);
      return jsonResponse(await evaluarOferta(parsedArgs));
    }

    if (name === "listar_pipeline_postulaciones") {
      const parsedArgs = ListarPipelineSchema.parse(args ?? {});
      const data = await listarOfertas(parsedArgs.estado);
      const ordered = [...data]
        .sort((a, b) => b.fechaActualizacion.localeCompare(a.fechaActualizacion))
        .slice(0, parsedArgs.limit);

      return jsonResponse({
        ok: true,
        total: ordered.length,
        items: ordered,
      });
    }

    if (name === "actualizar_estado_postulacion") {
      const parsedArgs = ActualizarEstadoSchema.parse(args);
      const updated = await actualizarEstadoOferta(parsedArgs.id, parsedArgs.estado);
      if (!updated) {
        return jsonResponse({
          ok: false,
          message: `No existe una vacante con id ${parsedArgs.id}`,
        });
      }

      return jsonResponse({
        ok: true,
        item: updated,
      });
    }

    if (name === "registrar_feedback_postulacion") {
      const parsedArgs = RegistrarFeedbackSchema.parse(args);
      const target = await obtenerOfertaPorId(parsedArgs.id);
      if (!target) {
        return jsonResponse({
          ok: false,
          message: `No existe una vacante con id ${parsedArgs.id}`,
        });
      }

      const updated = await agregarFeedbackOferta(parsedArgs.id, {
        fecha: new Date().toISOString(),
        canal: parsedArgs.canal,
        mensaje: parsedArgs.mensaje,
        accionRecomendada: parsedArgs.accionRecomendada,
      });

      return jsonResponse({
        ok: true,
        item: updated,
      });
    }

    throw new Error(`Herramienta no encontrada: ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error no controlado";
    return jsonResponse({
      ok: false,
      error: message,
    });
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP Job Hunter + Ollama Server corriendo exitosamente en Stdio!");

const httpServer = createServer(async (req, res) => {
  try {
    if (!req.url || !req.method) {
      writeHttpJson(res, 400, { ok: false, error: "Request invalido" });
      return;
    }

    if (req.method === "OPTIONS") {
      writeHttpJson(res, 204, { ok: true });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    if (req.method === "GET" && path === "/health") {
      writeHttpJson(res, 200, { ok: true, service: "mcp-job-hunter", mode: "http+mcp-stdio" });
      return;
    }

    if (req.method === "GET" && path === "/api/pipeline") {
      const estadoRaw = url.searchParams.get("estado");
      const estado = estadoRaw ? EstadoPostulacionSchema.parse(estadoRaw) : undefined;
      const limit = normalizeLimit(url.searchParams.get("limit"));
      const items = await listarOfertas(estado);
      const ordered = [...items]
        .sort((a, b) => b.fechaActualizacion.localeCompare(a.fechaActualizacion))
        .slice(0, limit);

      writeHttpJson(res, 200, { ok: true, total: ordered.length, items: ordered });
      return;
    }

    if (req.method === "GET" && path === "/api/metrics/funnel") {
      const items = await listarOfertas();
      writeHttpJson(res, 200, { ok: true, metrics: computeFunnelMetrics(items), totalRegistros: items.length });
      return;
    }

    if (req.method === "POST" && path === "/api/evaluar") {
      const body = await parseJsonBody(req);
      const parsed = JobEvaluationSchema.parse(body);
      const data = await evaluarOferta(parsed);
      writeHttpJson(res, 200, data);
      return;
    }

    if (req.method === "POST" && path === "/api/evaluar-lote") {
      const body = await parseJsonBody(req);
      const parsed = JobEvaluationBatchSchema.parse(body);
      const batch = await runBatchEvaluation(parsed.jobs, parsed.continueOnError);

      writeHttpJson(res, 200, {
        ok: true,
        total: parsed.jobs.length,
        processed: batch.processed,
        failed: batch.failed,
        continueOnError: parsed.continueOnError,
        results: batch.results,
      });
      return;
    }

    if (req.method === "GET" && path === "/api/discovery/greenhouse") {
      const parsed = GreenhouseDiscoverySchema.parse({
        board: url.searchParams.get("board") ?? undefined,
        company: url.searchParams.get("company") ?? undefined,
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      });

      const items = await discoverJobsFromGreenhouse(parsed.board, parsed.company, parsed.limit);
      writeHttpJson(res, 200, {
        ok: true,
        source: "greenhouse",
        board: parsed.board,
        company: parsed.company ?? humanizeSlug(parsed.board),
        total: items.length,
        items,
      });
      return;
    }

    if (req.method === "POST" && path === "/api/discovery/greenhouse/import") {
      const body = await parseJsonBody(req);
      const parsed = GreenhouseDiscoverySchema.parse(body);
      const items = await discoverJobsFromGreenhouse(parsed.board, parsed.company, parsed.limit);
      const batch = await runBatchEvaluation(buildEvaluationJobsFromDiscovery(items), true);

      writeHttpJson(res, 200, {
        ok: true,
        source: "greenhouse",
        board: parsed.board,
        company: parsed.company ?? humanizeSlug(parsed.board),
        totalImported: items.length,
        processed: batch.processed,
        failed: batch.failed,
        results: batch.results,
      });
      return;
    }

    if (req.method === "GET" && path === "/api/discovery/lever") {
      const parsed = LeverDiscoverySchema.parse({
        company: url.searchParams.get("company") ?? undefined,
        companyLabel: url.searchParams.get("companyLabel") ?? undefined,
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      });

      const items = await discoverJobsFromLever(parsed.company, parsed.companyLabel, parsed.limit);
      writeHttpJson(res, 200, {
        ok: true,
        source: "lever",
        company: parsed.companyLabel ?? humanizeSlug(parsed.company),
        companySlug: parsed.company,
        total: items.length,
        items,
      });
      return;
    }

    if (req.method === "POST" && path === "/api/discovery/lever/import") {
      const body = await parseJsonBody(req);
      const parsed = LeverDiscoverySchema.parse(body);
      const items = await discoverJobsFromLever(parsed.company, parsed.companyLabel, parsed.limit);
      const batch = await runBatchEvaluation(buildEvaluationJobsFromDiscovery(items), true);

      writeHttpJson(res, 200, {
        ok: true,
        source: "lever",
        company: parsed.companyLabel ?? humanizeSlug(parsed.company),
        companySlug: parsed.company,
        totalImported: items.length,
        processed: batch.processed,
        failed: batch.failed,
        results: batch.results,
      });
      return;
    }

    if (req.method === "GET" && path === "/api/discovery/url") {
      const parsed = UrlDiscoverySchema.parse({
        sourceUrl: url.searchParams.get("sourceUrl") ?? undefined,
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      });

      const items = await discoverJobsFromSilverUrl(parsed.sourceUrl, parsed.limit);
      writeHttpJson(res, 200, {
        ok: true,
        source: "url",
        sourceUrl: parsed.sourceUrl,
        total: items.length,
        items,
      });
      return;
    }

    if (req.method === "POST" && path === "/api/discovery/url/import") {
      const body = await parseJsonBody(req);
      const parsed = UrlDiscoverySchema.parse(body);
      const discovered = await discoverJobsFromSilverUrl(parsed.sourceUrl, parsed.limit);

      const jobs = discovered.map((item) => JobEvaluationSchema.parse({
        company: item.company,
        sourcePlatform: item.sourcePlatform,
        expectedSalaryRange: item.compensation,
        jobUrl: item.url,
        jobDescription: `${item.title}. ${item.locationType ?? ""}. ${item.description}`,
        persistResult: true,
      }));

      const batch = await runBatchEvaluation(jobs, true);

      writeHttpJson(res, 200, {
        ok: true,
        source: "url",
        sourceUrl: parsed.sourceUrl,
        totalImported: discovered.length,
        processed: batch.processed,
        failed: batch.failed,
        results: batch.results,
      });
      return;
    }

    if (req.method === "GET" && path === "/api/discovery/remotive") {
      const parsed = JobDiscoverySchema.parse({
        search: url.searchParams.get("search") ?? undefined,
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      });

      const jobs = await discoverJobsFromRemotive(parsed.search, parsed.limit);
      writeHttpJson(res, 200, {
        ok: true,
        source: "remotive",
        total: jobs.length,
        items: jobs,
      });
      return;
    }

    if (req.method === "POST" && path === "/api/discovery/core/import") {
      const body = await parseJsonBody(req);
      const parsed = CoreDiscoverySchema.parse(body);
      const outcome = await executeCoreDiscoveryImport(parsed);
      writeHttpJson(res, outcome.ok ? 200 : 400, outcome);
      return;
    }

    if (req.method === "GET" && path === "/api/scheduler/status") {
      const config = await loadSchedulerConfig();
      schedulerState.isEnabled = config.enabled;
      writeHttpJson(res, 200, {
        ok: true,
        status: schedulerState,
        config: {
          enabled: config.enabled,
          intervalMinutes: config.intervalMinutes,
          timezone: config.timezone,
          runHours: config.runHours,
          minScoreForDigest: config.minScoreForDigest,
          topMatchesLimit: config.topMatchesLimit,
          recipientEmail: config.recipientEmail,
          sources: {
            remotive: Boolean(config.core.remotive),
            greenhouse: Boolean(config.core.greenhouse),
            lever: Boolean(config.core.lever),
          },
        },
      });
      return;
    }

    if (req.method === "GET" && path === "/api/scheduler/smtp-status") {
      const smtpHost = process.env.SMTP_HOST;
      const smtpPortRaw = process.env.SMTP_PORT;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const smtpFrom = process.env.SMTP_FROM ?? smtpUser;
      const smtpPort = smtpPortRaw ? Number(smtpPortRaw) : 587;

      const missing: string[] = [];
      if (!smtpHost) missing.push("SMTP_HOST");
      if (!smtpUser) missing.push("SMTP_USER");
      if (!smtpPass) missing.push("SMTP_PASS");
      if (!smtpFrom) missing.push("SMTP_FROM");

      writeHttpJson(res, 200, {
        ok: true,
        smtp: {
          ready: missing.length === 0,
          secure: smtpPort === 465,
          hostConfigured: Boolean(smtpHost),
          userConfigured: Boolean(smtpUser),
          passConfigured: Boolean(smtpPass),
          fromConfigured: Boolean(smtpFrom),
          host: smtpHost ? "configured" : "missing",
          port: smtpPort,
          missing,
        },
      });
      return;
    }

    if ((req.method === "PATCH" || req.method === "POST") && path === "/api/scheduler/config") {
      const body = await parseJsonBody(req);
      const parsed = SchedulerConfigUpdateSchema.parse(body);
      const current = await loadSchedulerConfig();
      const nextConfig: SchedulerConfig = {
        ...current,
        ...parsed,
      };

      await saveSchedulerConfig(nextConfig);
      writeHttpJson(res, 200, {
        ok: true,
        config: {
          recipientEmail: nextConfig.recipientEmail,
          fromName: nextConfig.fromName,
        },
      });
      return;
    }

    if (req.method === "POST" && path === "/api/scheduler/run-now") {
      const result = await runSchedulerCycle("manual");
      writeHttpJson(res, result.ok ? 200 : 400, result);
      return;
    }

    if (req.method === "POST" && path === "/api/discovery/remotive/import") {
      const body = await parseJsonBody(req);
      const parsed = JobDiscoverySchema.parse(body);
      const jobs = await discoverJobsFromRemotive(parsed.search, parsed.limit);

      const payload = {
        jobs: jobs.map((job) => ({
          company: job.company,
          sourcePlatform: job.sourcePlatform,
          expectedSalaryRange: job.salary,
          jobUrl: job.url,
          jobDescription: `${job.title}. ${job.description}`,
          persistResult: true,
        })),
        continueOnError: true,
      };

      const batchPayload = JobEvaluationBatchSchema.parse(payload);
      const batch = await runBatchEvaluation(batchPayload.jobs, true);

      writeHttpJson(res, 200, {
        ok: true,
        source: "remotive",
        totalImported: jobs.length,
        processed: batch.processed,
        failed: batch.failed,
        results: batch.results,
      });
      return;
    }

    const estadoMatch = path.match(/^\/api\/postulaciones\/([^/]+)\/estado$/);
    if (req.method === "PATCH" && estadoMatch) {
      const id = decodeURIComponent(estadoMatch[1]);
      const body = await parseJsonBody(req);
      const parsed = ActualizarEstadoSchema.parse({ id, ...(body as object) });
      const updated = await actualizarEstadoOferta(parsed.id, parsed.estado);
      if (!updated) {
        writeHttpJson(res, 404, { ok: false, error: `No existe vacante con id ${parsed.id}` });
        return;
      }
      writeHttpJson(res, 200, { ok: true, item: updated });
      return;
    }

    const feedbackMatch = path.match(/^\/api\/postulaciones\/([^/]+)\/feedback$/);
    if (req.method === "POST" && feedbackMatch) {
      const id = decodeURIComponent(feedbackMatch[1]);
      const body = await parseJsonBody(req);
      const parsed = RegistrarFeedbackSchema.parse({ id, ...(body as object) });
      const updated = await agregarFeedbackOferta(parsed.id, {
        fecha: new Date().toISOString(),
        canal: parsed.canal,
        mensaje: parsed.mensaje,
        accionRecomendada: parsed.accionRecomendada,
      });

      if (!updated) {
        writeHttpJson(res, 404, { ok: false, error: `No existe vacante con id ${parsed.id}` });
        return;
      }

      writeHttpJson(res, 200, { ok: true, item: updated });
      return;
    }

    const emailDraftMatch = path.match(/^\/api\/postulaciones\/([^/]+)\/email-draft$/);
    if (req.method === "POST" && emailDraftMatch) {
      const id = decodeURIComponent(emailDraftMatch[1]);
      const body = await parseJsonBody(req);
      const parsed = PrepareEmailSchema.parse(body);
      const item = await obtenerOfertaPorId(id);
      if (!item) {
        writeHttpJson(res, 404, { ok: false, error: `No existe vacante con id ${id}` });
        return;
      }

      const draft = buildEmailDraft(item, parsed);

      if (parsed.markAsPostulada) {
        await actualizarEstadoOferta(id, "postulada");
      }

      writeHttpJson(res, 200, {
        ok: true,
        id,
        estadoActualizado: parsed.markAsPostulada,
        draft,
      });
      return;
    }

    const enrichMatch = path.match(/^\/api\/postulaciones\/([^/]+)\/enrich$/);
    if (req.method === "POST" && enrichMatch) {
      const id = decodeURIComponent(enrichMatch[1]);
      const item = await obtenerOfertaPorId(id);
      if (!item) {
        writeHttpJson(res, 404, { ok: false, error: `No existe vacante con id ${id}` });
        return;
      }

      const enriched = await enrichOfferFromUrl(item);
      writeHttpJson(res, 200, {
        ok: true,
        id,
        recruiterEmail: enriched.recruiterEmail,
        applyUrl: enriched.applyUrl,
        requisitos: enriched.requisitos,
        excluyentes: enriched.excluyentes,
      });
      return;
    }

    const packMatch = path.match(/^\/api\/postulaciones\/([^/]+)\/application-pack$/);
    if (req.method === "POST" && packMatch) {
      const id = decodeURIComponent(packMatch[1]);
      const body = await parseJsonBody(req);
      const parsed = ApplicationPackSchema.parse(body);
      const item = await obtenerOfertaPorId(id);
      if (!item) {
        writeHttpJson(res, 404, { ok: false, error: `No existe vacante con id ${id}` });
        return;
      }

      const currentItem = item.jobUrl ? (await enrichOfferFromUrl(item)).item ?? item : item;
      const pack = buildApplicationPack(currentItem, parsed);

      if (parsed.markAsPostulada) {
        await actualizarEstadoOferta(id, "postulada");
      }

      writeHttpJson(res, 200, {
        ok: true,
        id,
        estadoActualizado: parsed.markAsPostulada,
        ...pack,
      });
      return;
    }

    writeHttpJson(res, 404, { ok: false, error: "Endpoint no encontrado" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error no controlado";
    writeHttpJson(res, 500, { ok: false, error: message });
  }
});

httpServer.listen(HTTP_PORT, () => {
  console.error(`HTTP bridge activo en puerto ${HTTP_PORT}`);
});

startSchedulerLoop();
