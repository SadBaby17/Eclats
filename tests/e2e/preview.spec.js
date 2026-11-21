import { test, expect } from "@playwright/test";

test("the character preview fits a phone, opens offline and preserves reading progress", async ({ page, context }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /Lectures/ }).click();
  await expect(page.locator(".chapter-heading")).toBeVisible();
  await page.getByRole("link", { name: "Éclats, accueil" }).click();

  const saveKey = "eclats.reading.v1:accords-du-crepuscule";
  const saved = await page.evaluate((key) => localStorage.getItem(key), saveKey);
  expect(saved).toBeTruthy();

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }),
      );
    }
  });

  const preview = page.getByRole("link", { name: "Découvrir les nouveaux personnages" });
  await preview.click();
  await expect(page).toHaveURL(/\/apercu-nice\.html$/);
  const illustration = page.getByRole("img");
  await expect.poll(() => illustration.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText("De gauche à droite : Noé, Adriel, Alix et Léandre.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize().width,
  );

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Télécharger l’image" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("apercu-nice.webp");
  expect(await file.failure()).toBeNull();

  await page.getByRole("link", { name: "Retour à l’accueil" }).click();
  await context.setOffline(true);
  await preview.click();
  await expect.poll(() => illustration.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Ouvrir l’image en grand" }).click();
  await expect(page).toHaveURL(/\/illustrations\/apercu-nice\.webp$/);
  await expect.poll(() => page.locator("img").evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await page.goBack();
  await page.getByRole("link", { name: "Retour à l’accueil" }).click();
  await expect(preview).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), saveKey)).toBe(saved);
});
