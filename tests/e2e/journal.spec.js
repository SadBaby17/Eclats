import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { replay, choose } from "../../src/engine.js";
const story = JSON.parse(await readFile("public/stories/accords-du-crepuscule.json", "utf8"));
const key = "eclats.reading.v1:accords-du-crepuscule";
function progress(n) { let r = replay(story); while (r.decisions.length < n) r = choose(story, r.decisions, r.pending.scene, r.pending.options[0].id); return r; }
async function seed(page, count) {
  await page.addInitScript(({ key, decisions }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ schema: 1, story: "accords-du-crepuscule", version: 1, decisions, anchor: "c1-rue-p0", offset: 0, chapter: "c1" }));
  }, { key, decisions: progress(count).decisions });
}
async function destination(page, label) {
  const home = page.getByRole("heading", { name: "Bienvenue dans Éclats" });
  if (!await home.isVisible()) await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: new RegExp(label) }).click();
}
async function journal(page) {
  await destination(page, "Journal de personnage");
  await expect(page.getByRole("heading", { name: "Journal de personnage", exact: true })).toBeVisible();
}
async function sheet(page, name) { await page.getByRole("button", { name: `Voir la fiche de ${name}`, exact: true }).click(); return page.getByRole("dialog"); }

test("new readers see an empty journal, not the published cast", async ({ page }) => {
  await page.goto("./"); await journal(page);
  await expect(page.getByRole("heading", { name: "Vos rencontres commencent ici" })).toBeVisible();
  await expect(page.locator(".character-card")).toHaveCount(0);
  await expect(page.locator(".destination")).not.toContainText("Aelyr");
  await expect(page.locator(".destination")).not.toContainText("Tessa");
});

test("old saves populate known characters with progressive facts and preserve the bookmark", async ({ page }) => {
  await seed(page, 20); await page.goto("./"); await journal(page);
  await expect(page.getByRole("button", { name: "Voir la fiche de Adèle Rive", exact: true })).toBeVisible();
  await expect(page.locator(".destination")).not.toContainText("Aelyr");
  await expect(page.locator(".destination")).not.toContainText("Tessa");
  const ansel = await sheet(page, "Ansel Rive");
  await expect(ansel).toContainText("Disparu");
  await expect(ansel).not.toContainText("Décès");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Voir la fiche de Ansel Rive", exact: true })).toBeFocused();
  const evan = await sheet(page, "Evan Kamikony");
  await expect(evan).toContainText("13 ans");
  await expect(evan).not.toContainText("Dompteur");
  await page.keyboard.press("Escape");
  await page.getByRole("searchbox").fill("Tessa");
  await expect(page.locator(".character-card")).toHaveCount(0);
  await page.getByRole("searchbox").fill("");
  await page.getByLabel("Afficher", { exact: true }).selectOption("companion");
  await expect(page.locator(".character-card")).toHaveCount(2);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  expect(saved.decisions).toHaveLength(20);
  expect(saved.anchor).toBe("c1-rue-p0");
});

test("facts are discovered when their paragraph is viewed, survive reload and stay within the current path", async ({ page }) => {
  await seed(page, 4); await page.goto("./"); await journal(page);
  const evan = await sheet(page, "Evan Kamikony");
  await expect(evan).not.toContainText("13 ans"); await page.keyboard.press("Escape");
  await destination(page, "Lectures");
  await page.locator("#c1-nuit-p4").scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).journalSeen, key)).toContain("c1-nuit-p4");
  await journal(page); await sheet(page, "Evan Kamikony");
  await expect(page.getByRole("dialog")).toContainText("13 ans");
  await page.keyboard.press("Escape"); await page.reload(); await journal(page); await sheet(page, "Evan Kamikony");
  await expect(page.getByRole("dialog")).toContainText("13 ans");
});

test("an unlocked or opened chapter does not reveal people below the reading position", async ({ page }) => {
  await seed(page, 65); await page.goto("./"); await journal(page);
  await expect(page.locator(".destination")).not.toContainText("Tessa");
  await destination(page, "Bibliothèque");
  await page.getByRole("button", { name: "Voir les chapitres : Les Accords du Crépuscule", exact: true }).click();
  await page.locator("[data-chapter-id=c14]").click();
  await journal(page); await expect(page.locator(".destination")).not.toContainText("Tessa");
  await destination(page, "Lectures"); await page.locator("#c14-1-p2").scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).journalSeen, key)).toContain("c14-1-p2");
  await journal(page);
  await expect(page.getByRole("button", { name: "Voir la fiche de Tessa", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Voir la fiche de Luc", exact: true })).toHaveCount(0);
});

test("rewinding removes future characters and revealed fates, including after reload", async ({ page }) => {
  await seed(page, 110); await page.goto("./"); await journal(page);
  await sheet(page, "Ansel Rive"); await expect(page.getByRole("dialog")).toContainText("Décès confirmé");
  await page.keyboard.press("Escape");
  await destination(page, "Lectures"); await page.getByRole("button", { name: "Mes décisions" }).click();
  await page.getByRole("button", { name: /DÉCISION 1\b/ }).click();
  await page.getByRole("dialog").locator("input[type=radio]").nth(1).check();
  await page.getByRole("button", { name: "Remplacer la suite" }).click();
  await journal(page);
  await expect(page.getByRole("button", { name: "Voir la fiche de Ansel Rive", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Voir la fiche de Tessa", exact: true })).toHaveCount(0);
  await page.reload(); await journal(page);
  await expect(page.getByRole("button", { name: "Voir la fiche de Tessa", exact: true })).toHaveCount(0);
  expect((await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)).decisions).toHaveLength(1);
});

test("character sheets fit a narrow phone, support night mode and link back without changing decisions", async ({ page }) => {
  await seed(page, 20); await page.goto("./"); await journal(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await destination(page, "Paramètres"); await page.getByRole("button", { name: "Nuit", exact: true }).click(); await page.keyboard.press("Escape");
  await sheet(page, "Iseult Vale");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.getByRole("dialog").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/journal-character-night.png" });
  await page.getByRole("button", { name: "Relire la première rencontre" }).click();
  await expect(page.locator("#debut")).toHaveAttribute("data-chapter", "c1");
  await expect(page.locator("#c1-incident-p1")).toBeInViewport();
  expect((await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)).decisions).toHaveLength(20);
});

test("the journal and its saved discoveries remain usable offline", async ({ page, context }) => {
  await seed(page, 20); await page.goto("./");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  });
  await context.setOffline(true); await page.reload(); await journal(page);
  const profile = await sheet(page, "Ansel Rive");
  await expect(profile).toContainText("Disparu");
  await expect(profile).not.toContainText("Décès");
  expect((await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)).decisions).toHaveLength(20);
});

test("journal groups independent books and reveals only discovered existing portraits", async ({ page }) => {
  const helio = JSON.parse(await readFile("public/stories/helio-a-mains-nues.json", "utf8"));
  await seed(page, 4);
  const helioKey = `eclats.reading.v1:${helio.id}`;
  const saved = { schema: 1, story: helio.id, version: helio.version, decisions: [], anchor: "h-1-1-p0", offset: 0, chapter: helio.chapters[0].id, journalSeen: ["h-1-1-p0"] };
  await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), { key: helioKey, saved });
  await page.goto("./"); await journal(page);
  const group = page.getByRole("region", { name: helio.title, exact: true });
  await expect(group.getByRole("heading", { name: helio.title })).toBeVisible();
  await expect(page.getByRole("region", { name: story.title, exact: true })).toBeVisible();
  await expect(group.locator(".character-portrait")).toHaveCount(0);
  await expect(group).not.toContainText("Maël");
  await group.getByRole("button", { name: "Voir la fiche de Hélio", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(helio.title);
  await page.getByRole("button", { name: "Relire la première rencontre" }).click();
  await expect(page).toHaveURL(/story=helio-a-mains-nues/);
  await expect(page.locator("#h-1-1-p0")).toBeInViewport();
  await page.locator("#h-1-1-p4").scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).journalSeen, helioKey)).toContain("h-1-1-p4");
  await journal(page);
  const portrait = page.getByRole("region", { name: helio.title, exact: true }).locator(".character-portrait");
  await expect(portrait).toHaveCount(1);
  await expect.poll(() => portrait.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect((await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)).decisions).toHaveLength(4);
});
