import { test, expect } from "@playwright/test";
const key = "eclats.reading.v1:helio-a-mains-nues";
const oldKey = "eclats.reading.v1:accords-du-crepuscule";
async function decide(page, index = 0) {
  await expect.poll(() => page.locator(".choice input[type=radio]").count()).toBeGreaterThanOrEqual(2);
  const available = page.locator(".choice input[type=radio]:enabled");
  await available.nth(Math.min(index, await available.count() - 1)).check();
  await page.getByRole("button", { name: "Confirmer ce chemin", exact: true }).click();
}
async function pictures(page, count) {
  const imgs = page.locator(".story-illustration img");
  await expect(imgs).toHaveCount(count);
  for (const img of await imgs.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((i) => i.complete && i.naturalWidth > 0)).toBe(true);
    expect(await img.evaluate((i) => i.getBoundingClientRect().right <= innerWidth + 1 && i.getBoundingClientRect().left >= 0)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test("Hélio appears as a third book; forty decisions, twenty-one images and separate saves work offline", async ({ page, context }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./?read=1");
  await page.locator(".choice input[type=radio]").first().check();
  await page.getByRole("button", { name: "Confirmer ce chemin", exact: true }).click();
  const old = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).decisions, oldKey);
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: /Bibliothèque/ }).click();
  await expect(page.locator(".book-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Voir les chapitres : Hélio — À mains nues", exact: true }).click();
  await expect(page.locator(".chapter-link")).toHaveCount(8);
  await expect(page.locator(".chapter-link:enabled")).toHaveCount(1);
  await page.getByRole("button", { name: "Commencer la lecture", exact: true }).click();
  const counts = [3, 2, 3, 2, 3, 2, 3, 3];
  for (let n = 0; n < 40; n++) {
    if (n && n % 5 === 0) {
      await pictures(page, counts[n / 5 - 1]);
      await page.screenshot({ path: `test-results/helio-chapter-${n / 5}-mobile.png` });
      await page.getByRole("button", { name: "Chapitre suivant →", exact: true }).click();
    }
    await decide(page, 4);
  }
  await pictures(page, 3);
  await expect(page.locator(".ending")).toContainText("fin de cet arc");
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).decisions.length, key)).toBe(40);
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).decisions, oldKey)).toEqual(old);
  await page.screenshot({ path: "test-results/helio-chapter-8-mobile.png" });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Reprendre ma lecture", exact: true }).click();
  await pictures(page, 3);
  for (let chapter = 7; chapter >= 1; chapter--) {
    await page.getByRole("button", { name: "← Chapitre précédent", exact: true }).click();
    await pictures(page, counts[chapter - 1]);
  }
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).decisions.length, key)).toBe(40);
  await page.getByRole("button", { name: "Mes décisions" }).click();
  await page.getByRole("button", { name: /DÉCISION 5\b/ }).click();
  await page.getByRole("dialog").locator("input[type=radio]").nth(0).check();
  await page.getByRole("button", { name: "Remplacer la suite", exact: true }).click();
  await expect(page.locator("#scene-h-1-consequence-salon")).toBeVisible();
  await expect(page.locator(".ending")).toHaveCount(0);
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).decisions.length, key)).toBe(5);
  await page.getByRole("button", { name: "Chapitre suivant →", exact: true }).click();
  for (let n = 0; n < 3; n++) await decide(page);
  await expect(page.locator(".choice input[type=radio]")).toHaveCount(5);
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).decisions, oldKey)).toEqual(old);
  expect(errors).toEqual([]);
});

test("Hélio's opening fits desktop at large type and night theme", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("./?story=helio-a-mains-nues&read=1");
  await pictures(page, 1);
  await page.getByRole("button", { name: "Paramètres de lecture" }).click();
  const dialog = page.getByRole("dialog");
  const increase = dialog.getByRole("button", { name: "Agrandir la taille du texte", exact: true });
  while (await increase.isEnabled()) await increase.click();
  await dialog.getByRole("button", { name: "Nuit", exact: true }).click();
  await page.keyboard.press("Escape");
  await pictures(page, 1);
  await expect(page.locator(".choice")).toHaveCount(1);
  await page.screenshot({ path: "test-results/helio-desktop-night.png" });
});

test("a version-one fifteen-decision save continues at chapter four without losing its bookmark or decisions", async ({ page }) => {
  const { readFileSync } = await import("node:fs");
  const { replay, choose } = await import("../../src/engine.js");
  const first = JSON.parse(readFileSync(new URL("../fixtures/helio-first-three.json", import.meta.url)));
  let r = replay(first);
  while (r.pending) r = choose(first, r.decisions, r.pending.scene, r.pending.options[0].id);
  const decisions = r.decisions;
  await page.addInitScript(({ key, decisions }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ schema: 1, story: "helio-a-mains-nues", version: 1, decisions, anchor: "h-3-6-p0", offset: 0, chapter: "hc3" }));
  }, { key, decisions });
  await page.goto("./?story=helio-a-mains-nues&read=1");
  await expect(page.locator("#h-3-6-p0")).toContainText("La confiance");
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).decisions, key)).toEqual(decisions);
  await page.getByRole("button", { name: "Chapitre suivant →", exact: true }).click();
  await expect(page.locator(".chapter-heading")).toContainText("04");
  await decide(page);
  await pictures(page, 1);
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).decisions.slice(0, 15), key)).toEqual(decisions);
  await page.reload();
  await expect(page.locator(".choice")).toHaveCount(1);
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).decisions.length, key)).toBe(16);
});

async function seedHelio(page, overrides, count, chapter, anchor) {
  const { readFileSync } = await import("node:fs");
  const { replay, choose } = await import("../../src/engine.js");
  const story = JSON.parse(readFileSync("public/stories/helio-a-mains-nues.json", "utf8"));
  let r = replay(story);
  while (r.pending && r.decisions.length < count) {
    const p = r.pending;
    r = choose(story, r.decisions, p.scene, overrides[p.scene] || p.options[0].id);
  }
  await page.addInitScript(({ key, save }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(save));
  }, { key, save: { schema: 1, story: story.id, version: story.version, decisions: r.decisions, anchor, chapter, offset: 0 } });
}

test("locked choices explain earlier preparations, survive offline and unlock after a revision", async ({ page, context }) => {
  await seedHelio(page, { "h-4-4": "main", "h-5-4": "temoins", "h-6-2": "plaisir" }, 30, "hc7", "h-7-1-p0");
  await page.goto("./?story=helio-a-mains-nues&read=1");
  await expect(page.locator(".content-warning")).toContainText("Public adulte");
  const portal = page.locator('.choice input[value="passage"]');
  await expect(portal).toBeDisabled();
  await expect(page.locator(".option-unavailable")).toContainText("point d’arrivée");
  expect(await page.locator(".choice input:enabled").count()).toBeGreaterThanOrEqual(2);
  await page.setViewportSize({ width: 320, height: 640 });
  await portal.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "test-results/helio-revised-locked-mobile.png" });
  await decide(page); await decide(page);
  await expect(page.locator('.choice input[value="ombre"]')).toBeDisabled();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  });
  await context.setOffline(true); await page.reload();
  await expect(page.locator('.choice input[value="ombre"]')).toBeDisabled();
  await page.getByRole("button", { name: "Mes décisions" }).click();
  await page.getByRole("button", { name: /DÉCISION 24\b/ }).click();
  await page.getByRole("dialog").locator('input[value="matériel"]').check();
  await page.getByRole("button", { name: "Remplacer la suite", exact: true }).click();
  await decide(page);
  await page.getByRole("button", { name: "Chapitre suivant →", exact: true }).click();
  for (let i = 0; i < 5; i++) await decide(page);
  await page.getByRole("button", { name: "Chapitre suivant →", exact: true }).click();
  await expect(page.locator('.choice input[value="passage"]')).toBeEnabled();
  await page.locator('.choice input[value="passage"]').check();
  await page.getByRole("button", { name: "Confirmer ce chemin", exact: true }).click();
  await expect(page.locator("#scene-h-7-1-passage")).toContainText("traversa");
  await decide(page);
  await expect(page.locator('.choice input[value="ombre"]')).toBeEnabled();
  await page.locator('.choice input[value="ombre"]').check();
  await page.getByRole("button", { name: "Confirmer ce chemin", exact: true }).click();
  await expect(page.locator("#scene-h-7-3-ombre")).toContainText("filet");
});

test("published archived answers remain readable and are kept until an explicit revision", async ({ page }) => {
  const { readFileSync } = await import("node:fs");
  const fixture = JSON.parse(readFileSync("tests/fixtures/helio-saves-before-revision.json", "utf8"));
  const save = { ...fixture.saves[2], chapter: "hc4", anchor: "h-4-1-messages-p0" };
  await page.addInitScript(({ key, save }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(save));
  }, { key, save });
  await page.goto("./?story=helio-a-mains-nues&read=1");
  await expect(page.locator("#h-4-1-messages-p0")).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions, key)).toEqual(save.decisions);
  await page.getByRole("button", { name: "Mes décisions" }).click();
  await page.getByRole("button", { name: /DÉCISION 16\b/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Votre réponse enregistrée reste conservée");
  await expect(page.getByRole("dialog").locator('input[value="messages"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Conserver mon récit", exact: true }).click();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions, key)).toEqual(save.decisions);
});
