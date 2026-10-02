import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesSearchTerm, splitSearchTerms } from "../src/search.js";

let testDir: string | undefined;

afterEach(async () => {
  delete process.env.PROFILE_PATH;
  vi.resetModules();
  if (testDir) await rm(testDir, { recursive: true, force: true });
  testDir = undefined;
});

async function profileModuleAtTemporaryPath() {
  testDir = await mkdtemp(join(tmpdir(), "open-job-hunter-profile-"));
  const profilePath = join(testDir, "config", "profile.json");
  process.env.PROFILE_PATH = profilePath;
  vi.resetModules();
  return { profilePath, profile: await import("../src/profile.js") };
}

const designer = {
  fullName: "Ana Perez",
  headline: "Product Designer",
  summary: "Product designer focused on research-driven mobile experiences.",
  coreCompetencies: { tools: ["Figma", "Maze"] },
  search: { keywords: "product designer, ux researcher" },
};

describe("candidate profile", () => {
  it("flags the shipped example profile as a placeholder", async () => {
    const { profile } = await profileModuleAtTemporaryPath();
    const { profile: loaded, path } = await profile.loadProfileWithSource();
    expect(path.endsWith("profile.example.json")).toBe(true);
    expect(profile.isPlaceholderProfile(loaded)).toBe(true);
  });

  it("saves to the user profile path and serves the new data without a restart", async () => {
    const { profilePath, profile } = await profileModuleAtTemporaryPath();
    await profile.loadProfile();

    await profile.saveProfile(designer);

    const reloaded = await profile.loadProfile();
    expect(reloaded.headline).toBe("Product Designer");
    expect(profile.isPlaceholderProfile(reloaded)).toBe(false);
    expect(JSON.parse(await readFile(profilePath, "utf-8")).fullName).toBe("Ana Perez");
  });

  it("rejects an invalid profile without writing it", async () => {
    const { profile } = await profileModuleAtTemporaryPath();
    await expect(profile.saveProfile({ fullName: "A" })).rejects.toThrow();
  });

  it("builds the evaluator prompt from the profile without assuming an architecture role", async () => {
    const { profile } = await profileModuleAtTemporaryPath();
    const saved = await profile.saveProfile(designer);
    const { buildEvaluatorPrompt } = await import("../src/prompts.js");
    const prompt = buildEvaluatorPrompt(saved);
    expect(prompt).toContain("Ana Perez, Product Designer");
    expect(prompt).not.toMatch(/architect/i);
    expect(profile.profileSearchKeywords(saved)).toBe("product designer, ux researcher");
  });
});

describe("search terms", () => {
  it("splits OR and comma separated alternatives into plain queries", () => {
    expect(splitSearchTerms("software architect OR backend engineer, Delivery Lead")).toEqual([
      "software architect",
      "backend engineer",
      "delivery lead",
    ]);
  });

  it("deduplicates and caps the number of queries", () => {
    expect(splitSearchTerms("a1, A1, b2 | c3 ; d4")).toEqual(["a1", "b2", "c3"]);
    expect(splitSearchTerms("  ")).toEqual([]);
  });
});

describe("local search matching", () => {
  it("requires every word of the term, ignoring case and accents", () => {
    expect(matchesSearchTerm("Senior Product Designer Design", "product designer")).toBe(true);
    expect(matchesSearchTerm("Diseñador UX Senior", "disenador ux")).toBe(true);
    expect(matchesSearchTerm("Senior Independent AI Engineer / Architect", "product designer")).toBe(false);
  });
});
