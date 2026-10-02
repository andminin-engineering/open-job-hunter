import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

let html: string;
let esc: (value: unknown) => string;
let safeUrl: (value: unknown) => string;

function extractDeclaration(source: string, name: string): string {
  const match = source.match(new RegExp(`const ${name} = .*;`));
  if (!match) throw new Error(`No se encontro la declaracion de ${name} en app/index.html`);
  return match[0];
}

beforeAll(async () => {
  html = await readFile(resolve("app", "index.html"), "utf-8");
  const helpers = vm.runInNewContext(
    `${extractDeclaration(html, "esc")}\n${extractDeclaration(html, "safeUrl")}\n({ esc, safeUrl })`,
    { URL },
  ) as { esc: (value: unknown) => string; safeUrl: (value: unknown) => string };
  esc = helpers.esc;
  safeUrl = helpers.safeUrl;
});

describe("dashboard HTML escaping", () => {
  it("neutralizes script elements and their quoted content", () => {
    expect(esc("<script>alert('x')</script>")).toBe("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
  });

  it("neutralizes attribute injection, ampersands and both quote types", () => {
    expect(esc(`\"><img src=x onerror=alert('x')>&`)).toBe(
      "&quot;&gt;&lt;img src=x onerror=alert(&#39;x&#39;)&gt;&amp;",
    );
  });
});

describe("dashboard URL allowlist", () => {
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    " https://example.test/job",
    "not a url",
  ])("rejects an unsafe or invalid URL: %s", (value) => {
    expect(safeUrl(value)).toBe("");
  });

  it("accepts only clean HTTP and HTTPS URLs", () => {
    expect(safeUrl("http://example.test/job")).toBe("http://example.test/job");
    expect(safeUrl("https://example.test/job?id=1")).toBe("https://example.test/job?id=1");
  });
});

describe("external data rendered through innerHTML", () => {
  it("escapes job-board fields, evaluation text and validated URLs", () => {
    const requiredDefenses = [
      "esc(item.id)",
      "esc(item.company || 'Empresa sin nombre')",
      "esc(item.sourcePlatform)",
      "esc(item.expectedSalaryRange)",
      "safeUrl(item.jobUrl)",
      "esc(url)",
      "esc(e.match_score)",
      "e.strong_points_to_highlight.map(esc)",
      "e.detected_risks.map(esc)",
      "safeUrl(j.url)",
      "esc(j.title)",
      "esc(j.company)",
      "esc(j.location)",
      "esc(j.salary)",
    ];
    for (const defense of requiredDefenses) expect(html).toContain(defense);

    const forbiddenDirectInterpolations = [
      /\$\{item\.(?:id|company|sourcePlatform|expectedSalaryRange|jobUrl)\}/,
      /\$\{e\.(?:match_score|strong_points_to_highlight|detected_risks)\}/,
      /\$\{j\.(?:title|company|location|salary|url|description)\}/,
    ];
    for (const unsafe of forbiddenDirectInterpolations) expect(html).not.toMatch(unsafe);
  });
});
