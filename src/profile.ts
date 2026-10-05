import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { PROFILE_EXAMPLE_PATH, PROFILE_PATH } from "./paths.js";

/**
 * Candidate profile schema.
 *
 * This is the core of open-job-hunter: instead of hard-coding a single person,
 * every user describes themselves here and the evaluator scores job offers
 * against *their* profile. Copy config/profile.example.json to
 * config/profile.json (or point PROFILE_PATH at your own file) and edit it,
 * or use the "Mi perfil" tab of the dashboard.
 */
export const ProfileSchema = z.object({
  fullName: z.string().min(2),
  headline: z.string().min(2),
  seniorityYears: z.number().int().min(0).max(60).optional(),
  summary: z.string().min(10),
  coreCompetencies: z.record(z.string(), z.array(z.string())),
  portfolioUrl: z.string().url().optional(),
  salaryTargetUsd: z.number().positive().optional(),
  locations: z.array(z.string()).default([]),
  languages: z
    .array(z.object({ language: z.string(), level: z.string() }))
    .default([]),
  search: z
    .object({
      keywords: z.string().default(""),
      minScoreToApply: z.number().int().min(0).max(100).default(70),
      boards: z
        .object({
          remotive: z
            .object({ search: z.string(), limit: z.number().int().positive().max(50) })
            .optional(),
          greenhouse: z.array(z.string()).optional(),
          lever: z.array(z.string()).optional(),
        })
        .default({}),
    })
    .default({}),
});

export type Profile = z.infer<typeof ProfileSchema>;

/** Placeholder name shipped in profile.example.json. */
export const PLACEHOLDER_FULL_NAME = "Your Name";

let cachedProfile: { profile: Profile; path: string } | null = null;

/** Evaluating against the shipped example would score offers for a fictional candidate. */
export class ProfileNotConfiguredError extends Error {
  readonly statusCode = 409;

  constructor() {
    super("Completa tu perfil en Mi perfil antes de evaluar ofertas: todavia usa los datos de ejemplo.");
    this.name = "ProfileNotConfiguredError";
  }
}

/**
 * True while the user is still running on the shipped example data, which
 * would make every evaluation score offers against a fictional candidate.
 */
export function isPlaceholderProfile(profile: Profile): boolean {
  return profile.fullName.trim() === PLACEHOLDER_FULL_NAME;
}

/**
 * Loads the user's profile, or profile.example.json when the user has not
 * created one yet, so the server always boots. A profile that exists but is
 * unreadable is an error: falling back would let the next save replace it.
 */
export async function loadProfile(): Promise<Profile> {
  return (await loadProfileWithSource()).profile;
}

export async function loadProfileWithSource(): Promise<{ profile: Profile; path: string }> {
  if (cachedProfile) {
    return cachedProfile;
  }

  const userProfile = await readProfileFile(PROFILE_PATH);
  if (userProfile) {
    cachedProfile = { profile: userProfile, path: PROFILE_PATH };
    return cachedProfile;
  }

  const exampleProfile = await readProfileFile(PROFILE_EXAMPLE_PATH);
  if (!exampleProfile) {
    throw new Error("No candidate profile file found. See config/profile.example.json.");
  }
  console.error(
    "[open-job-hunter] Using profile.example.json. Create config/profile.json with your own data for real results."
  );
  cachedProfile = { profile: exampleProfile, path: PROFILE_EXAMPLE_PATH };
  return cachedProfile;
}

/** Returns undefined only when the file does not exist; invalid content throws. */
async function readProfileFile(path: string): Promise<Profile | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return ProfileSchema.parse(JSON.parse(raw));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`The candidate profile at ${path} is not valid; fix or remove it. ${message}`);
  }
}

/** Loads the profile and refuses to continue while it is still the shipped example. */
export async function assertProfileConfigured(): Promise<Profile> {
  const profile = await loadProfile();
  if (isPlaceholderProfile(profile)) throw new ProfileNotConfiguredError();
  return profile;
}

// Saves in this process run one at a time; unique temporary names cover other processes.
let pendingSave: Promise<unknown> = Promise.resolve();

/** Validates and atomically writes the user's profile to PROFILE_PATH (never to the example). */
export async function saveProfile(input: unknown): Promise<Profile> {
  const profile = ProfileSchema.parse(input);
  const save = pendingSave.then(() => writeProfile(profile));
  pendingSave = save.catch(() => undefined);
  await save;
  return profile;
}

async function writeProfile(profile: Profile): Promise<void> {
  await mkdir(dirname(PROFILE_PATH), { recursive: true });
  await preserveUnreadableProfile();
  const tmpPath = `${PROFILE_PATH}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tmpPath, `${JSON.stringify(profile, null, 2)}\n`, "utf-8");
    await rename(tmpPath, PROFILE_PATH);
  } finally {
    await rm(tmpPath, { force: true });
  }
  cachedProfile = { profile, path: PROFILE_PATH };
}

/** Keeps a copy of an existing profile that cannot be parsed before it is replaced. */
async function preserveUnreadableProfile(): Promise<void> {
  try {
    await readProfileFile(PROFILE_PATH);
  } catch {
    await copyFile(PROFILE_PATH, `${PROFILE_PATH}.corrupt-${Date.now()}`);
  }
}

/** Search terms configured by the user, preferring the Remotive-specific query. */
export function profileSearchKeywords(profile: Profile): string {
  return (profile.search.boards.remotive?.search ?? profile.search.keywords).trim();
}

/** Renders the profile's competencies as readable bullet lines for prompts. */
export function renderCompetencies(profile: Profile): string {
  return Object.entries(profile.coreCompetencies)
    .map(([category, items]) => `- ${capitalize(category)}: ${items.join(", ")}.`)
    .join("\n");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
