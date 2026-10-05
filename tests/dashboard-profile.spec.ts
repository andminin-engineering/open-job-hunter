import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

let html: string;

beforeAll(async () => {
  html = await readFile(resolve("app", "index.html"), "utf-8");
});

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
