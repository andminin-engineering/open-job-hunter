import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

let html: string;

beforeAll(async () => {
  html = await readFile(new URL("../app/index.html", import.meta.url), "utf-8");
});

function dashboardWithManyOffers(options: { holdLaterPage?: boolean; holdRefresh?: boolean; evaluatedTotal?: number } = {}) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("No se encontró el script del dashboard");

  const elements = new Map<string, ReturnType<typeof makeElement>>();
  const handlers = new Map<string, (event: unknown) => unknown>();
  const urls: URL[] = [];
  const patches: Array<{ id: string; estado: string }> = [];
  const evaluatedTotal = options.evaluatedTotal ?? 105;
  const allTotal = evaluatedTotal + 133;
  const stateTotals: Record<string, number> = {
    evaluada: evaluatedTotal,
    postulada: 15,
    feedback_recibido: 4,
    entrevista: 2,
    oferta: 1,
    rechazada: 3,
    descartada: 100,
    nueva: 0,
    "aplicada,entrevista_inicial": 8,
  };
  let activeElement: unknown;
  let focusedAfterLoad = false;
  let releaseLaterPage: (() => void) | undefined;
  let releaseRefresh: (() => void) | undefined;
  let evaluatedFirstPageCalls = 0;
  const focusTarget = { focus() { focusedAfterLoad = true; } };

  function makeElement(id: string) {
    return {
      id,
      value: id === "pipelineSort" ? "updated_desc" : "",
      innerHTML: "",
      textContent: "",
      className: "",
      disabled: false,
      style: { display: "" },
      dataset: {} as Record<string, string>,
      scrollTop: 0,
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {},
      querySelectorAll: () => [],
      querySelector: (selector: string) => id === "board" && selector.includes('data-load-more="evaluada"') ? focusTarget : null,
      focus() { activeElement = this; },
      addEventListener(event: string, handler: (event: unknown) => unknown) { handlers.set(`${id}:${event}`, handler); },
    };
  }

  function element(id: string) {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id)!;
  }

  const fetch = async (input: string, init?: { method?: string; body?: string }) => {
    const url = new URL(input);
    if (url.pathname === "/health") return { ok: false };
    if (url.pathname === "/api/metrics/funnel") return { ok: true, json: async () => ({ metrics: {} }) };
    const move = url.pathname.match(/^\/api\/postulaciones\/([^/]+)\/estado$/);
    if (move && init?.method === "PATCH") {
      const id = decodeURIComponent(move[1]);
      const { estado } = JSON.parse(init.body || "{}") as { estado: string };
      const previous = id.split("-")[0];
      if (!(previous in stateTotals) || !(estado in stateTotals)) throw new Error("Estado de prueba desconocido");
      stateTotals[previous] -= 1;
      stateTotals[estado] += 1;
      patches.push({ id, estado });
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (url.pathname !== "/api/pipeline") throw new Error(`Unexpected request: ${input}`);
    urls.push(url);
    const lane = url.searchParams.get("estados") ?? url.searchParams.get("estado");
    const query = url.searchParams.get("q");
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    if (lane === "evaluada" && offset === 25 && options.holdLaterPage) {
      await new Promise<void>((resolve) => { releaseLaterPage = resolve; });
    }
    if (lane === "evaluada" && offset === 0 && options.holdRefresh && ++evaluatedFirstPageCalls === 2) {
      await new Promise<void>((resolve) => { releaseRefresh = resolve; });
    }
    const total = query ? (lane === "evaluada" ? 2 : 0) : (stateTotals[lane ?? ""] ?? 0);
    const count = Math.min(limit, Math.max(0, total - offset));
    const items = Array.from({ length: count }, (_, index) => ({
      id: `${lane}-${offset + index}`,
      company: lane === "evaluada" ? "Asana" : "Empresa de prueba",
      oferta: "Analista funcional <img src=x onerror=alert(1)> para procesos",
      sourcePlatform: "test",
      estado: lane === "aplicada,entrevista_inicial" ? (index % 2 ? "aplicada" : "entrevista_inicial") : lane,
      fechaActualizacion: "2026-10-05T12:00:00.000Z",
    }));
    return {
      ok: true,
      json: async () => ({ ok: true, allTotal, total, items, limit, offset, hasMore: offset + count < total }),
    };
  };

  const documentRef = {
    getElementById: element,
    querySelectorAll: () => [],
    get activeElement() { return activeElement; },
  };
  const dashboard = vm.runInNewContext(`${script}\ncheckHealth = async () => true; ({ loadPipeline, loadMorePipeline })`, {
    document: documentRef,
    location: { hostname: "127.0.0.1", origin: "http://127.0.0.1:3000" },
    localStorage: { getItem: () => null },
    fetch,
    AbortSignal: { timeout: () => undefined },
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    setInterval: () => 0,
    URL,
    URLSearchParams,
  }) as { loadPipeline: () => Promise<void>; loadMorePipeline: (lane: string, button: { disabled: boolean }) => Promise<void> };

  return {
    element, urls, patches, handlers, load: dashboard.loadPipeline, loadMore: dashboard.loadMorePipeline,
    setActiveElement: (value: unknown) => { activeElement = value; },
    wasFocusRestored: () => focusedAfterLoad,
    releaseLaterPage: () => releaseLaterPage?.(),
    releaseRefresh: () => releaseRefresh?.(),
  };
}

async function clickInterviewOutcome(page: ReturnType<typeof dashboardWithManyOffers>, estado: string) {
  const button = {
    dataset: { id: "entrevista-0", estado },
    closest: (selector: string) => selector === ".col" ? { dataset: { lane: "entrevista" } } : null,
  };
  await page.handlers.get("board:click")!({
    target: { closest: (selector: string) => selector === "button[data-id]" ? button : null },
  });
}

describe("scalable dashboard pipeline", () => {
  it("constrains each keyboard-accessible lane and keeps outcome tabs visible above the board", () => {
    expect(html).toMatch(/\.col \{[^}]*height: clamp\(/);
    expect(html).toMatch(/\.col-scroll \{[^}]*overflow-y: auto/);
    expect(html).toContain('role="region" aria-labelledby="${headingId}" tabindex="0"');
    expect(html).toContain('class="col-footer"><span aria-live="polite"');
    expect(html.indexOf('id="pipelineModes"')).toBeLessThan(html.indexOf('id="board"'));
  });

  it("shows real totals, four active lanes, and separate accepted, rejected and discarded views", async () => {
    const page = dashboardWithManyOffers();
    await page.load();

    expect(page.element("kpis").innerHTML).toContain('class="num">238</div>');
    expect(page.element("activeCount").textContent).toBe("(126)");
    expect(page.element("acceptedCount").textContent).toBe("(1)");
    expect(page.element("rejectedCount").textContent).toBe("(3)");
    expect(page.element("discardedCount").textContent).toBe("(100)");
    expect(page.element("legacyCount").textContent).toBe("(8)");
    expect(page.urls.some(url => url.searchParams.get("estado") === "rechazada")).toBe(true);
    expect(page.urls.some(url => url.searchParams.get("estado") === "descartada")).toBe(true);
    expect(page.urls.some(url => url.searchParams.get("estados") === "descartada,rechazada")).toBe(false);
    expect(page.element("board").innerHTML).toContain("25 de 105");
    expect(page.element("board").innerHTML).not.toContain("🏆 Aceptadas");
    expect(page.element("board").innerHTML).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(page.element("board").innerHTML).not.toContain("<img src=x");

    page.handlers.get("pipelineModes:click")!({ target: { closest: () => ({ dataset: { pipelineView: "accepted" } }) } });
    expect(page.element("board").innerHTML).toContain("🏆 Aceptadas");
    expect(page.element("board").innerHTML).toContain("1 vacante</span>");
    expect(page.element("pipelineViewHint").textContent).toContain("¡Recibí oferta!");
    expect(page.element("board").innerHTML).not.toContain("✅ Listas para postular");

    page.handlers.get("pipelineModes:click")!({ target: { closest: () => ({ dataset: { pipelineView: "rejected" } }) } });
    expect(page.element("board").innerHTML).toContain("⛔ Rechazadas");
    expect(page.element("board").innerHTML).toContain("3 vacantes</span>");
    expect(page.element("board").innerHTML).toContain("3 de 3");
    expect(page.element("board").innerHTML).not.toContain("Descartada");
    expect(page.element("pipelineViewHint").textContent).toContain("No avanzó");

    page.handlers.get("pipelineModes:click")!({ target: { closest: () => ({ dataset: { pipelineView: "discarded" } }) } });
    expect(page.element("board").innerHTML).toContain("🗂️ Descartadas");
    expect(page.element("board").innerHTML).toContain("100 vacantes</span>");
    expect(page.element("board").innerHTML).toContain("25 de 100");
    expect(page.element("board").innerHTML).not.toContain("Rechazada");
    await page.loadMore("descartada", { disabled: false });
    expect(page.element("board").innerHTML).toContain("50 de 100");

    page.handlers.get("pipelineModes:click")!({ target: { closest: () => ({ dataset: { pipelineView: "offers" } }) } });
    expect(page.element("board").innerHTML).toContain("🗂️ Descartadas");

    page.handlers.get("pipelineModes:click")!({ target: { closest: () => ({ dataset: { pipelineView: "legacy" } }) } });
    expect(page.element("board").innerHTML).toContain("Aplicada (estado anterior)");
    expect(page.element("board").innerHTML).toContain("Entrevista inicial (estado anterior)");
    expect(page.element("board").innerHTML).not.toContain('data-id=');
    expect(page.element("board").innerHTML).not.toContain('data-estado=');
    expect(page.element("pipelineViewHint").textContent).toContain("sin modificar su estado");
  });

  it("shows interview outcomes in accepted or rejected without adding stored states", async () => {
    const accepted = dashboardWithManyOffers();
    await accepted.load();
    expect(accepted.element("board").innerHTML).toContain('data-id="entrevista-0" data-estado="oferta">¡Recibí oferta!</button>');
    await clickInterviewOutcome(accepted, "oferta");
    expect(accepted.patches).toEqual([{ id: "entrevista-0", estado: "oferta" }]);
    expect(accepted.element("activeCount").textContent).toBe("(125)");
    expect(accepted.element("acceptedCount").textContent).toBe("(2)");
    accepted.handlers.get("pipelineModes:click")!({ target: { closest: () => ({ dataset: { pipelineView: "accepted" } }) } });
    expect(accepted.element("board").innerHTML).toContain("🏆 Aceptadas");
    expect(accepted.element("board").innerHTML).toContain("2 vacantes</span>");

    const rejected = dashboardWithManyOffers();
    await rejected.load();
    expect(rejected.element("board").innerHTML).toContain('data-id="entrevista-0" data-estado="rechazada">No avanzó</button>');
    await clickInterviewOutcome(rejected, "rechazada");
    expect(rejected.patches).toEqual([{ id: "entrevista-0", estado: "rechazada" }]);
    expect(rejected.element("activeCount").textContent).toBe("(125)");
    expect(rejected.element("rejectedCount").textContent).toBe("(4)");
    rejected.handlers.get("pipelineModes:click")!({ target: { closest: () => ({ dataset: { pipelineView: "rejected" } }) } });
    expect(rejected.element("board").innerHTML).toContain("⛔ Rechazadas");
    expect(rejected.element("board").innerHTML).toContain("4 vacantes</span>");
  });

  it("loads later pages and sends search and sort to the API instead of filtering loaded cards", async () => {
    const page = dashboardWithManyOffers();
    await page.load();
    const moreButton = { disabled: false };
    await page.loadMore("evaluada", moreButton);
    expect(page.urls.some(url => url.searchParams.get("estado") === "evaluada" && url.searchParams.get("offset") === "25")).toBe(true);
    expect(page.element("board").innerHTML).toContain("50 de 105");

    await page.load();
    expect(page.urls.some(url => url.searchParams.get("estado") === "evaluada" && url.searchParams.get("limit") === "50")).toBe(true);
    expect(page.element("board").innerHTML).toContain("50 de 105");

    page.element("pipelineSearch").value = "Asana";
    page.element("pipelineSort").value = "score_desc";
    await page.load();
    expect(page.urls.slice(-9)).toHaveLength(9);
    for (const url of page.urls.slice(-9)) {
      expect(url.searchParams.get("q")).toBe("Asana");
      expect(url.searchParams.get("sort")).toBe("score_desc");
      expect(url.searchParams.get("limit")).toBe("25");
    }
    expect(page.element("kpis").innerHTML).toContain('class="num">238</div>');
    expect(page.element("board").innerHTML).toContain("2 de 2");
  });

  it("restores keyboard focus after loading more offers", async () => {
    const page = dashboardWithManyOffers();
    await page.load();
    const button = { disabled: false };
    page.setActiveElement(button);

    await page.loadMore("evaluada", button);

    expect(page.wasFocusRestored()).toBe(true);
    expect(page.element("board").innerHTML).toContain("50 de 105");
  });

  it("does not let an old load-more response overwrite a refreshed lane", async () => {
    const page = dashboardWithManyOffers({ holdLaterPage: true });
    await page.load();
    const pendingMore = page.loadMore("evaluada", { disabled: false });
    await Promise.resolve();
    await page.load();
    page.releaseLaterPage();
    await pendingMore;

    expect(page.element("board").innerHTML).toContain("25 de 105");
    expect(page.element("board").innerHTML).not.toContain("50 de 105");
  });

  it("ignores load-more clicks while a refresh is in progress", async () => {
    const page = dashboardWithManyOffers({ holdRefresh: true });
    await page.load();
    const refreshing = page.load();
    await Promise.resolve();
    const requestsBefore = page.urls.length;
    await page.loadMore("evaluada", { disabled: false });
    expect(page.urls.length).toBe(requestsBefore);
    page.releaseRefresh();
    await refreshing;
  });

  it("keeps more than 200 loaded offers visible after a refresh", async () => {
    const page = dashboardWithManyOffers({ evaluatedTotal: 220 });
    await page.load();
    for (let index = 0; index < 8; index += 1) {
      await page.loadMore("evaluada", { disabled: false });
    }
    expect(page.element("board").innerHTML).toContain("220 de 220");

    await page.load();

    expect(page.urls.some(url => url.searchParams.get("estado") === "evaluada"
      && url.searchParams.get("offset") === "200" && url.searchParams.get("limit") === "20")).toBe(true);
    expect(page.element("board").innerHTML).toContain("220 de 220");
    expect(page.element("kpis").innerHTML).toContain('class="num">353</div>');
  });
});
