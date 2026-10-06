import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
    expect(loaded.responseLanguage).toBe("es");
  });

  it("defaults an older profile to Spanish and preserves English independently of spoken languages", async () => {
    const { profilePath, profile } = await profileModuleAtTemporaryPath();
    await mkdir(dirname(profilePath), { recursive: true });
    await writeFile(profilePath, JSON.stringify({
      ...designer,
      languages: [{ language: "Spanish", level: "Native" }],
    }), "utf-8");
    const legacy = await profile.loadProfile();
    expect(legacy.responseLanguage).toBe("es");

    const updated = await profile.saveProfile({ ...legacy, responseLanguage: "en" });
    expect(updated.responseLanguage).toBe("en");
    expect((await profile.loadProfile()).languages).toEqual([{ language: "Spanish", level: "Native" }]);
    expect(JSON.parse(await readFile(profilePath, "utf-8"))).toMatchObject({
      responseLanguage: "en",
      languages: [{ language: "Spanish", level: "Native" }],
    });
  });

  it("rejects unsupported response languages without overwriting the existing profile", async () => {
    const { profilePath, profile } = await profileModuleAtTemporaryPath();
    await profile.saveProfile({ ...designer, responseLanguage: "en" });
    await expect(profile.saveProfile({ ...designer, responseLanguage: "fr" })).rejects.toThrow();
    expect(JSON.parse(await readFile(profilePath, "utf-8")).responseLanguage).toBe("en");
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
    const { profilePath, profile } = await profileModuleAtTemporaryPath();
    await expect(profile.saveProfile({ fullName: "A" })).rejects.toThrow();
    await expect(access(profilePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to evaluate with the example profile and allows it once the user saves their own", async () => {
    const { profile } = await profileModuleAtTemporaryPath();
    await expect(profile.assertProfileConfigured()).rejects.toBeInstanceOf(profile.ProfileNotConfiguredError);

    await profile.saveProfile(designer);

    await expect(profile.assertProfileConfigured()).resolves.toMatchObject({ fullName: "Ana Perez" });
  });

  it("reports a corrupt profile instead of silently falling back to the example", async () => {
    const { profilePath, profile } = await profileModuleAtTemporaryPath();
    await mkdir(dirname(profilePath), { recursive: true });
    await writeFile(profilePath, "{ not json", "utf-8");

    await expect(profile.loadProfile()).rejects.toThrow(/not valid/);
    expect(await readFile(profilePath, "utf-8")).toBe("{ not json");
  });

  it("keeps a copy of a corrupt profile before an explicit save replaces it", async () => {
    const { profilePath, profile } = await profileModuleAtTemporaryPath();
    await mkdir(dirname(profilePath), { recursive: true });
    await writeFile(profilePath, "{ not json", "utf-8");

    await profile.saveProfile(designer);

    const entries = await readdir(dirname(profilePath));
    const backup = entries.find((name) => name.startsWith("profile.json.corrupt-"));
    expect(backup).toBeDefined();
    expect(await readFile(join(dirname(profilePath), backup!), "utf-8")).toBe("{ not json");
    expect(JSON.parse(await readFile(profilePath, "utf-8")).fullName).toBe("Ana Perez");
  });

  it("writes concurrent saves through unique temporary files and leaves none behind", async () => {
    const { profilePath, profile } = await profileModuleAtTemporaryPath();
    const names = Array.from({ length: 8 }, (_, index) => `Candidate ${index}`);

    await Promise.all(names.map((fullName) => profile.saveProfile({ ...designer, fullName })));

    expect(names).toContain(JSON.parse(await readFile(profilePath, "utf-8")).fullName);
    expect(await readdir(dirname(profilePath))).toEqual(["profile.json"]);
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

  it("instructs all narrative evaluation fields in the selected language without changing JSON keys", async () => {
    const { profile } = await profileModuleAtTemporaryPath();
    const { buildEvaluatorPrompt } = await import("../src/prompts.js");
    const spanish = buildEvaluatorPrompt(await profile.saveProfile(designer));
    const english = buildEvaluatorPrompt(await profile.saveProfile({ ...designer, responseLanguage: "en" }));

    for (const [prompt, language] of [[spanish, "Spanish (español)"], [english, "English"]]) {
      expect(prompt).toContain(`in ${language}, whatever the language of the job description`);
      expect(prompt).toContain('"detected_risks", "strong_points_to_highlight" and "custom_angle"');
      expect(prompt).toContain('"match_score" stays a number and "apply" stays a boolean');
      expect(prompt).toContain("Do not translate proper nouns");
    }
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
