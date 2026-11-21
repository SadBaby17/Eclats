import { test, expect } from "@playwright/test";

test("the linear novel opens from the library and restores an illustrated chapter offline", async ({ page, context }) => {
  const oldKey = "eclats.reading.v1:accords-du-crepuscule";
  const newKey = "eclats.reading.v1:les-heures-decalees";
  const readSave = (key) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);

  await page.goto("./");
  await expect(page.getByRole("link", { name: "Découvrir les nouveaux personnages" })).toHaveCount(0);
  await page.getByRole("button", { name: /Lectures/ }).click();
  await expect(page.locator(".chapter-heading")).toBeVisible();
  await page.getByRole("link", { name: "Éclats, accueil" }).click();
  const priorProgress = await readSave(oldKey);
  expect(priorProgress).toBeTruthy();
  await page.getByRole("button", { name: /Bibliothèque/ }).click();
  await page.getByRole("button", { name: "Voir les chapitres : Les Heures décalées" }).click();
  await page.getByRole("button", { name: "Commencer la lecture" }).click();
  await expect(page.getByRole("heading", { name: "La première fournée" })).toBeVisible();
  await expect(page.locator(".scene-viewpoint")).toHaveText(["Noé", "Alix", "Léandre", "Adriel"]);
  await expect(page.locator(".choice")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mes décisions" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Paramètres de lecture" })).toBeVisible();

  const pictures = page.locator(".story-illustration img");
  await expect(pictures).toHaveCount(3);
  for (const picture of await pictures.all()) {
    await picture.scrollIntoViewIfNeeded();
    await expect.poll(() => picture.evaluate((img) => img.naturalWidth)).toBe(1536);
  }
  await expect(page.getByRole("heading", { name: "À suivre" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);

  await page.locator("#adriel-p12").evaluate((node) => node.scrollIntoView({ block: "center" }));
  await expect.poll(async () => (await readSave(newKey))?.anchor).toMatch(/^adriel-/);
  const bookmark = await readSave(newKey);
  expect(bookmark.decisions).toEqual([]);
  expect(bookmark.chapter).toBe("la-premiere-fournee");
  expect(await readSave(oldKey)).toEqual(priorProgress);

  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Reprendre ma lecture" }).click();
  await expect(page.locator(`#${bookmark.anchor}`)).toBeInViewport();
  for (const picture of await pictures.all()) {
    await picture.scrollIntoViewIfNeeded();
    await expect.poll(() => picture.evaluate((img) => img.naturalWidth)).toBe(1536);
  }
});
