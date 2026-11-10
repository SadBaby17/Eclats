import { test, expect } from "@playwright/test";

const original = "Les Accords du Crépuscule";
const sequel = "Evan — Deuxième version";
const oldKey = "eclats.reading.v1:accords-du-crepuscule";
const newKey = "eclats.reading.v1:evan-deuxieme-version";

async function library(page) {
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: /Bibliothèque/ }).click();
}
async function decide(page, index = 0) {
  const form = page.locator(".choice");
  await form.locator("input[type=radio]").nth(index).check();
  await form.getByRole("button", { name: "Confirmer ce chemin", exact: true }).click();
}

test("both library books switch correctly, preserve separate progress and the new chapters work offline", async ({ page, context }) => {
  test.setTimeout(120000);
  await page.goto("./?read=1");
  await expect(page.locator(".choice")).toHaveCount(1);
  await decide(page);
  const oldSave = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), oldKey);
  await library(page);
  await expect(page.locator(".book-card")).toHaveCount(3);
  await page.getByRole("button", { name: `Voir les chapitres : ${sequel}`, exact: true }).click();
  await expect(page).toHaveURL(/story=evan-deuxieme-version/);
  await expect(page.locator(".chapter-link")).toHaveCount(13);
  await expect(page.locator(".chapter-link:enabled")).toHaveCount(1);
  await page.getByRole("button", { name: /^(Commencer la lecture|Reprendre ma lecture)$/ }).click();
  await expect(page.locator(".book-heading h1")).toHaveText(sequel);
  await decide(page);
  await library(page);
  await page.getByRole("link", { name: original, exact: true }).click();
  await expect(page.locator(".chapter-link")).toHaveCount(33);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions, oldKey)).toEqual(oldSave.decisions);
  await page.getByRole("button", { name: /Bibliothèque/ }).click();
  await page.getByRole("link", { name: sequel, exact: true }).click();
  await expect(page.locator(".chapter-link")).toHaveCount(13);
  await page.getByRole("button", { name: "Reprendre ma lecture", exact: true }).click();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions.length, newKey)).toBe(1);
  for (let i = 1; i < 65; i++) {
    if (i > 0 && i % 5 === 0) {
      await expect(page.locator(".choice")).toHaveCount(0);
      await page.getByRole("button", { name: "Chapitre suivant →", exact: true }).click();
    }
    await decide(page);
  }
  await page.getByText("Un morceau pour rentrer — fin de cet arc", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText("Un morceau pour rentrer — fin de cet arc", { exact: true })).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions.length, newKey)).toBe(65);
  await page.screenshot({ path: "test-results/second-version-mobile.png", fullPage: false });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Reprendre ma lecture", exact: true }).click();
  await expect(page.getByText("Un morceau pour rentrer — fin de cet arc", { exact: true })).toBeVisible();
  await library(page);
  await expect(page.locator(".book-card")).toHaveCount(3);
  await page.getByRole("link", { name: original, exact: true }).click();
  await expect(page.locator(".chapter-link")).toHaveCount(33);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions, oldKey)).toEqual(oldSave.decisions);
});

test("all twenty-one illustrations fit mobile, preserve choices and load offline", async ({ page, context }) => {
  test.setTimeout(120000);
  await page.goto("./?story=evan-deuxieme-version&read=1");
  let picturesSeen = 0;
  async function checkPictures() {
    const pictures = page.locator(".story-illustration img");
    const count = await pictures.count();
    for (const picture of await pictures.all()) {
      await picture.scrollIntoViewIfNeeded();
      await expect(picture).toBeVisible();
      await expect.poll(() => picture.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
      expect(await picture.evaluate((img) => img.getBoundingClientRect().right <= innerWidth + 1 && img.getBoundingClientRect().left >= 0)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    return count;
  }
  for (let i = 0; i < 65; i++) {
    if (i > 0 && i % 5 === 0) {
      picturesSeen += await checkPictures();
      await page.screenshot({ path: `test-results/evan-v2-chapter-${i / 5}.png` });
      await page.getByRole("button", { name: "Chapitre suivant →", exact: true }).click();
    }
    await expect.poll(() => page.locator(".choice input[type=radio]").count()).toBeGreaterThanOrEqual(5);
    await decide(page, 4);
  }
  picturesSeen += await checkPictures();
  expect(picturesSeen).toBe(21);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions.length, newKey)).toBe(65);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  let offlinePictures = 0;
  for (let chapter = 13; chapter >= 1; chapter--) {
    offlinePictures += await checkPictures();
    if (chapter > 1) await page.getByRole("button", { name: "← Chapitre précédent", exact: true }).click();
  }
  expect(offlinePictures).toBe(21);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions.length, newKey)).toBe(65);
});

test("a published fifteen-decision save opens chapter four and keeps the original bookmark", async ({ page }) => {
  const options = ["tam", "briser", "diva", "musique", "peur", "haut", "calme", "glace", "signal", "lassitude", "porte", "renforts", "diva", "peur", "mara"];
  const scenes = ["v2-1-1", "v2-1-2", "v2-1-3", "v2-1-5", "v2-1-6", "v2-2-1", "v2-2-2", "v2-2-3", "v2-2-5", "v2-2-6", "v2-3-1", "v2-3-2", "v2-3-3", "v2-3-5", "v2-3-6"];
  const decisions = scenes.map((scene, i) => ({ scene, option: options[i] }));
  await page.addInitScript(({ key, decisions }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ schema: 1, story: "evan-deuxieme-version", version: 1, decisions, anchor: "v2-3-7-p0", offset: 0, chapter: "v2c3" }));
  }, { key: newKey, decisions });
  await page.goto("./?story=evan-deuxieme-version&read=1");
  await expect(page.locator("#v2-3-7-p0")).toHaveText("Ils rentrèrent au moulin avant la nuit.");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions, newKey)).toEqual(decisions);
  await page.getByRole("button", { name: "Chapitre suivant →", exact: true }).click();
  await expect(page.locator(".choice")).toHaveCount(1);
  await expect(page.locator(".chapter-heading")).toContainText("4");
  await decide(page);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions.slice(0, 15), newKey)).toEqual(decisions);
  await page.reload();
  await expect(page.locator(".choice")).toHaveCount(1);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions.length, newKey)).toBe(16);
});
