import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(MODULE_DIR, "..");

function absoluteOverride(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path: ${value}`);
  return resolve(value);
}

export const DATA_DIR = absoluteOverride("JOB_HUNTER_DATA_DIR") ?? join(PROJECT_ROOT, "src", "data");
export const DB_PATH = absoluteOverride("JOB_HUNTER_DB_PATH") ?? join(DATA_DIR, "db.json");
export const SCHEDULER_CONFIG_PATH = absoluteOverride("SCHEDULER_CONFIG_PATH") ?? join(DATA_DIR, "scheduler-config.json");
export const PROFILE_PATH = absoluteOverride("PROFILE_PATH") ?? join(PROJECT_ROOT, "config", "profile.json");
export const PROFILE_EXAMPLE_PATH = join(PROJECT_ROOT, "config", "profile.example.json");
