import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/**
 * Candidate profile schema.
 *
 * This is the core of open-job-hunter: instead of hard-coding a single person,
 * every user describes themselves here and the evaluator scores job offers
 * against *their* profile. Copy config/profile.example.json to
 * config/profile.json (or point PROFILE_PATH at your own file) and edit it.
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
      keywords: z.string().default("software engineer"),
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

const DEFAULT_PROFILE_PATHS = [
  process.env.PROFILE_PATH,
  join(process.cwd(), "config", "profile.json"),
  join(process.cwd(), "config", "profile.example.json"),
].filter(Boolean) as string[];

let cachedProfile: Profile | null = null;

/**
 * Loads the first profile file that exists, validates it, and caches it.
 * Falls back to profile.example.json so the server always boots.
 */
export async function loadProfile(): Promise<Profile> {
  if (cachedProfile) {
    return cachedProfile;
  }

  for (const path of DEFAULT_PROFILE_PATHS) {
    try {
      const raw = await readFile(path, "utf-8");
      const parsed = ProfileSchema.parse(JSON.parse(raw));
      if (path.endsWith("profile.example.json")) {
        console.error(
          "[open-job-hunter] Using profile.example.json. Create config/profile.json with your own data for real results."
        );
      }
      cachedProfile = parsed;
      return parsed;
    } catch (error) {
      // Try the next candidate path.
      if (path === DEFAULT_PROFILE_PATHS[DEFAULT_PROFILE_PATHS.length - 1]) {
        const message = error instanceof Error ? error.message : "unknown error";
        throw new Error(
          `Could not load a valid candidate profile. Last error at ${path}: ${message}`
        );
      }
    }
  }

  throw new Error("No candidate profile file found. See config/profile.example.json.");
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
