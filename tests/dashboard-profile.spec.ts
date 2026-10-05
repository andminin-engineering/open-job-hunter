import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

let html: string;

beforeAll(async () => {
  html = await readFile(resolve("app", "index.html"), "utf-8");
});

function dashboardWithProfile(profile: Record<string, unknown>, isPlaceholder: boolean, isExampleFile = isPlaceholder) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("No se encontró el script del dashboard");

  const elements = new Map<string, {
    value: string;
    disabled: boolean;
    textContent: string;
    className: string;
    style: { display: string };
    classList: { add: () => void; remove: () => void; toggle: () => void };
    addEventListener: (event: string, handler: (event: { preventDefault: () => void }) => Promise<void>) => void;
  }>();
  const handlers = new Map<string, (event: { preventDefault: () => void }) => Promise<void>>();
  let saved: Record<string, unknown> | undefined;

  function element(id: string) {
    if (!elements.has(id)) {
      elements.set(id, {
        value: "",
        disabled: id === "profileBtn",
        textContent: "",
        className: "",
        style: { display: "" },
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener(event, handler) { handlers.set(`${id}:${event}`, handler); },
      });
    }
    return elements.get(id)!;
  }

  const fetch = async (url: string, options?: { method?: string; body?: string }) => {
    if (url.endsWith("/health")) return { ok: false };
    if (url.endsWith("/api/profile") && options?.method === "PUT") {
      saved = JSON.parse(options.body ?? "{}");
      return { ok: true, json: async () => ({ ok: true, profile: saved, isPlaceholder: false }) };
    }
    if (url.endsWith("/api/profile")) {
      return { ok: true, json: async () => ({ ok: true, profile, isPlaceholder, isExampleFile }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const dashboard = vm.runInNewContext(`${script}\n({ loadProfileForm })`, {
    document: { getElementById: element, querySelectorAll: () => [] },
    location: { hostname: "127.0.0.1", origin: "http://127.0.0.1:3000" },
    localStorage: { getItem: () => null },
    fetch,
    AbortSignal: { timeout: () => undefined },
    setTimeout: () => 0,
    setInterval: () => 0,
    URL,
  }) as { loadProfileForm: () => Promise<void> };

  return {
    element,
    load: dashboard.loadProfileForm,
    submit: () => handlers.get("profileForm:submit")!({ preventDefault() {} }),
    saved: () => saved,
  };
}

describe("dashboard profile loading guard", () => {
  it("starts with profile saving disabled", () => {
    expect(html).toMatch(/<button[^>]+id="profileBtn"[^>]+disabled[^>]*>/);
  });

  it("keeps the button disabled and shows recovery guidance when loading fails", () => {
    const loadStart = html.indexOf("async function loadProfileForm() {");
    const submitStart = html.indexOf("$('profileForm').addEventListener", loadStart);
    const loadProfileForm = html.slice(loadStart, submitStart);

    expect(loadProfileForm).toContain("$('profileBtn').disabled = true");
    expect(loadProfileForm).toContain("$('profileStatus').textContent = `No se pudo cargar el perfil:");
    expect(loadProfileForm).toContain("Corregí o eliminá el archivo; no se sobrescribirá.");
  });

  it("refuses submission before constructing or sending a PUT request", () => {
    const submitStart = html.indexOf("$('profileForm').addEventListener");
    const initStart = html.indexOf("/* Init */", submitStart);
    const submitHandler = html.slice(submitStart, initStart);
    const guard = submitHandler.indexOf("if (loadedProfile === null)");
    const payload = submitHandler.indexOf("const payload =");
    const put = submitHandler.indexOf("method: 'PUT'");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(payload).toBeGreaterThan(guard);
    expect(put).toBeGreaterThan(payload);
    expect(submitHandler.slice(guard, payload)).toContain("return;");
  });

  it("renders an unreadable-profile health error as text rather than HTML", () => {
    expect(html).toContain("profileErrorHint = health && health.profileError ? health.profileError : ''");
    expect(html).toContain("$('profileBannerMessage').textContent = `${profileErrorHint}");
  });
});

describe("dashboard profile onboarding", () => {
  it("shows empty fields for the shipped example and saves only values entered by the user", async () => {
    const page = dashboardWithProfile({
      fullName: "Your Name",
      headline: "Your Professional Headline",
      summary: "Replace this with your experience and strengths.",
      coreCompetencies: { skills: ["Replace with your main skills"] },
      portfolioUrl: "https://github.com/your-handle",
      locations: ["Replace with your preferred location or modality"],
      languages: [{ language: "Your language", level: "Your level" }],
      search: { minScoreToApply: 70, boards: {} },
    }, true);

    await page.load();

    for (const id of ["pName", "pHeadline", "pSummary", "pSkills", "pPortfolio", "pLocations", "pLanguages", "pKeywords"]) {
      expect(page.element(id).value, id).toBe("");
    }
    expect(page.element("pResponseLanguage").value).toBe("es");
    expect(page.element("pMinScore").value).toBe(70);
    expect(page.element("profileBtn").disabled).toBe(false);
    expect(page.element("profileStatus").textContent).toContain("Completá y guardá");

    page.element("pName").value = "Ana Pérez";
    page.element("pHeadline").value = "Analista funcional";
    page.element("pSummary").value = "Relevo requisitos y diseño procesos para equipos de producto.";
    page.element("pSkills").value = "análisis: requisitos, historias de usuario";
    await page.submit();

    const saved = page.saved();
    expect(saved).toMatchObject({
      fullName: "Ana Pérez",
      headline: "Analista funcional",
      responseLanguage: "es",
      locations: [],
      languages: [],
      coreCompetencies: { análisis: ["requisitos", "historias de usuario"] },
    });
    expect(saved).not.toHaveProperty("portfolioUrl");
    expect(JSON.stringify(saved)).not.toMatch(/Your Name|Replace with|your-handle/i);
  });

  it("loads a real profile and persists the selected response language separately from known languages", async () => {
    const profile = {
      fullName: "Ana Pérez",
      headline: "Analista funcional",
      summary: "Analizo procesos y facilito acuerdos entre negocio y tecnología.",
      coreCompetencies: { análisis: ["requisitos"] },
      languages: [{ language: "Inglés", level: "B2" }],
      responseLanguage: "en",
      search: { keywords: "analista funcional", minScoreToApply: 65, boards: { greenhouse: ["acme"] } },
    };
    const page = dashboardWithProfile(profile, false);

    await page.load();

    expect(page.element("pName").value).toBe("Ana Pérez");
    expect(page.element("pSkills").value).toBe("análisis: requisitos");
    expect(page.element("pLanguages").value).toBe("Inglés: B2");
    expect(page.element("pResponseLanguage").value).toBe("en");
    expect(page.element("pMinScore").value).toBe(65);
    expect(page.element("qSearch").value).toBe("analista funcional");

    page.element("pResponseLanguage").value = "es";
    await page.submit();

    expect(page.saved()).toMatchObject({
      responseLanguage: "es",
      languages: [{ language: "Inglés", level: "B2" }],
      search: { boards: { greenhouse: ["acme"] } },
    });
  });

  it("defaults to Spanish when a saved profile predates the language preference", async () => {
    const page = dashboardWithProfile({
      fullName: "Ana Pérez",
      headline: "Analista funcional",
      summary: "Analizo procesos y facilito acuerdos entre negocio y tecnología.",
      coreCompetencies: { análisis: ["requisitos"] },
      languages: [{ language: "Inglés", level: "B2" }],
    }, false);

    await page.load();

    expect(page.element("pName").value).toBe("Ana Pérez");
    expect(page.element("pResponseLanguage").value).toBe("es");
  });

  it("preserves a user's profile when only its name still matches the example", async () => {
    const page = dashboardWithProfile({
      fullName: "Your Name",
      headline: "Analista funcional",
      summary: "Datos propios que no deben desaparecer del formulario.",
      coreCompetencies: { análisis: ["requisitos"] },
      responseLanguage: "en",
    }, true, false);

    await page.load();

    expect(page.element("pHeadline").value).toBe("Analista funcional");
    expect(page.element("pSummary").value).toContain("Datos propios");
    expect(page.element("pResponseLanguage").value).toBe("en");
    expect(page.element("profileStatus").textContent).toContain("Reemplazá el nombre");
  });
});
