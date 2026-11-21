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
  await expect(page.getByRole("button", { name: "Chapitre suivant →" })).toBeVisible();
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


test("new chapters follow in order offline and save the current chapter", async ({ page, context }) => {
  const chapters = [
    { title: "La première fournée", viewpoints: ["Noé", "Alix", "Léandre", "Adriel"], pictures: 3 },
    { title: "Le poids du carton", viewpoints: ["Adriel", "Noé"], pictures: 3 },
    { title: "Le blanc sous le vert", viewpoints: ["Alix"], pictures: 3 },
    { title: "Jusqu’à la ligne", viewpoints: ["Léandre"], pictures: 3 },
    { title: "Quatre minutes", viewpoints: ["Noé", "Adriel"], pictures: 4 },
  ];
  await page.goto("?story=les-heures-decalees&read=1");
  await expect(page.getByRole("heading", { name: chapters[0].title })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);

  for (const [index, chapter] of chapters.entries()) {
    await expect(page.getByRole("heading", { name: chapter.title })).toBeVisible();
    await expect(page.locator(".scene-viewpoint")).toHaveText(chapter.viewpoints);
    await expect(page.locator(".interaction")).toHaveCount(0);
    const pictures = page.locator(".story-illustration img");
    await expect(pictures).toHaveCount(chapter.pictures);
    for (const picture of await pictures.all()) {
      await picture.scrollIntoViewIfNeeded();
      await expect.poll(() => picture.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    }
    if (index < chapters.length - 1) {
      await expect(page.getByRole("heading", { name: "À suivre" })).toHaveCount(0);
      await page.getByRole("button", { name: "Chapitre suivant →" }).click();
    }
  }

  await expect(page.getByRole("heading", { name: "À suivre" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: chapters.at(-1).title })).toBeVisible();
  await page.getByRole("button", { name: "← Chapitre précédent" }).click();
  await expect(page.getByRole("heading", { name: chapters.at(-2).title })).toBeVisible();
  await page.getByRole("button", { name: "Les chapitres" }).click();
  await expect(page.locator(".chapter-link:enabled")).toHaveCount(5);
});
