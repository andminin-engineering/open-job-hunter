import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

let html: string;
let esc: (value: unknown) => string;
let safeUrl: (value: unknown) => string;

function extractDeclaration(source: string, name: string): string {
  const match = source.match(new RegExp(`const ${name} = .*;`));
  if (!match) throw new Error(`No se encontro la declaracion de ${name} en app/index.html`);
  return match[0];
}

function innerHtmlInterpolations(source: string): string[] {
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
  const file = ts.createSourceFile("dashboard.js", script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const expressions: string[] = [];

  function collectTemplates(node: ts.Node): void {
    if (ts.isTemplateExpression(node)) {
      expressions.push(...node.templateSpans.map((span) => span.expression.getText(file)));
    }
    ts.forEachChild(node, collectTemplates);
  }

  function visit(node: ts.Node): void {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === "innerHTML"
    ) {
      collectTemplates(node.right);
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return expressions;
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
  it("sanitizes every external-data reference used by an HTML interpolation", () => {
    const interpolations = innerHtmlInterpolations(html);
    const externalReference = /\b(?:item|e|j)\.[A-Za-z_]\w*/g;

    for (const expression of interpolations) {
      const references = [...expression.matchAll(externalReference)].map((match) => match[0]);
      for (const reference of references) {
        const escapedDirectly = expression.includes(`esc(${reference}`) || expression.includes(`safeUrl(${reference}`);
        const escapedCollection = expression.includes(`${reference}.map(esc)`);
        const usedOnlyAsEscapedCollectionGuard =
          expression.includes(`${reference}?.length`) && expression.includes(`${reference}.map(esc)`);
        // scoreBadge produces a fixed numeric score and escapes it before returning markup.
        const renderedBySafeHelper = expression === `scoreBadge(${reference})`;
        // A boolean may choose between fixed labels without rendering its value.
        const selectsFixedLabels = new RegExp(
          `^${reference.replace(".", "\\.")} \\? '[^']*' : '[^']*'$`,
        ).test(expression);

        expect(
          escapedDirectly ||
            escapedCollection ||
            usedOnlyAsEscapedCollectionGuard ||
            renderedBySafeHelper ||
            selectsFixedLabels,
          `Unsafe external reference ${reference} in HTML interpolation: \${${expression}}`,
        ).toBe(true);
      }
    }
  });
});
