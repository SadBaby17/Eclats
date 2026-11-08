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
  await page.goto("./?read=1");
  await expect(page.locator(".choice")).toHaveCount(1);
  await decide(page);
  const oldSave = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), oldKey);
  await library(page);
  await expect(page.locator(".book-card")).toHaveCount(2);
  await page.getByRole("button", { name: `Voir les chapitres : ${sequel}`, exact: true }).click();
  await expect(page).toHaveURL(/story=evan-deuxieme-version/);
  await expect(page.locator(".chapter-link")).toHaveCount(3);
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
  await expect(page.locator(".chapter-link")).toHaveCount(3);
  await page.getByRole("button", { name: "Reprendre ma lecture", exact: true }).click();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions.length, newKey)).toBe(1);
  for (let i = 1; i < 15; i++) {
    if (i === 5 || i === 10) {
      await expect(page.locator(".choice")).toHaveCount(0);
      await page.getByRole("button", { name: "Chapitre suivant →", exact: true }).click();
    }
    await decide(page);
  }
  await page.getByText("Fin des trois premiers chapitres — à suivre", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText("Fin des trois premiers chapitres — à suivre", { exact: true })).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions.length, newKey)).toBe(15);
  await page.screenshot({ path: "test-results/second-version-mobile.png", fullPage: false });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Reprendre ma lecture", exact: true }).click();
  await expect(page.getByText("Fin des trois premiers chapitres — à suivre", { exact: true })).toBeVisible();
  await library(page);
  await expect(page.locator(".book-card")).toHaveCount(2);
  await page.getByRole("link", { name: original, exact: true }).click();
  await expect(page.locator(".chapter-link")).toHaveCount(33);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions, oldKey)).toEqual(oldSave.decisions);
});

test("five available answers and all three illustrations fit mobile, preserve choices and load offline", async ({ page, context }) => {
  await page.goto("./?story=evan-deuxieme-version&read=1");
  for (let i = 0; i < 15; i++) {
    if (i === 5 || i === 10) await page.getByRole("button", { name: "Chapitre suivant →", exact: true }).click();
    const choices = page.locator(".choice input[type=radio]");
    expect(await choices.count()).toBeGreaterThanOrEqual(5);
    if (i === 0 || i === 5 || i === 13) {
      const picture = page.locator(".story-illustration img");
      await picture.scrollIntoViewIfNeeded();
      await expect(picture).toBeVisible();
      await expect.poll(() => picture.evaluate((img) => img.naturalWidth)).toBe(1536);
      expect(await picture.evaluate((img) => img.getBoundingClientRect().right <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/evan-v2-chapter-${Math.floor(i / 5) + 1}.png` });
    }
    await decide(page, 4);
  }
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions.length, newKey)).toBe(15);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  for (let chapter = 3; chapter >= 1; chapter--) {
    const picture = page.locator(".story-illustration img");
    await picture.scrollIntoViewIfNeeded();
    await expect.poll(() => picture.evaluate((img) => img.complete && img.naturalWidth === 1536)).toBe(true);
    if (chapter > 1) await page.getByRole("button", { name: "← Chapitre précédent", exact: true }).click();
  }
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).decisions.length, newKey)).toBe(15);
});
