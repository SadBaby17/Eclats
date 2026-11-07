import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
async function enterReader(page) {
  await expect(
    page.getByRole("heading", { name: "Bienvenue dans Éclats" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: /Lectures/ })
    .click();
  await expect(page.locator("#scene-arrivee")).toBeVisible();
}
async function openReader(page) {
  await page.goto("./");
  await enterReader(page);
}
async function decision(page, label) {
  await page.getByLabel(label, { exact: true }).check();
  await page.getByRole("button", { name: "Confirmer ce chemin" }).click();
}
test("mobile reading, explicit confirmation, branching, settings, restore and rewind", async ({
  page,
}) => {
  await openReader(page);
  await expect(
    page.getByRole("heading", { name: "Le phare des heures" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirmer ce chemin" }),
  ).toBeDisabled();
  await page
    .getByLabel("Passer par le jardin du phare", { exact: true })
    .check();
  await expect(page.locator("#scene-jardin")).toHaveCount(0);
  await page.getByRole("button", { name: "Confirmer ce chemin" }).click();
  await expect(page.locator("#scene-jardin p")).toHaveCount(4);
  await expect(
    page.getByLabel("Rejoindre Jeanne au port", { exact: true }),
  ).toHaveCount(0);
  await decision(page, "Monter dans la chambre de veille");
  await expect(page.locator("#scene-veille")).toBeVisible();
  await decision(page, "Proposer à Jeanne de rester");
  await expect(
    page.getByRole("heading", { name: "Une lumière partagée" }),
  ).toBeVisible();
  const savedBefore = await page.evaluate(
    () => JSON.parse(localStorage.getItem("eclats.reading.v1")).decisions,
  );
  await page.getByRole("button", { name: "Paramètres de lecture" }).click();
  await page.getByRole("button", { name: "Nuit", exact: true }).click();
  await page
    .getByRole("button", { name: "Agrandir la taille du texte" })
    .click();
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "night");
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("eclats.reading.v1")).decisions,
    ),
  ).toEqual(savedBefore);
  await page.locator("#veille-p1").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const y = await page.evaluate(() => scrollY);
  await page.reload();
  await enterReader(page);
  await expect(page.locator("#scene-fin-partage")).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y - 40);
  expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(50);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "night");
  await page.getByRole("button", { name: "Mes décisions" }).click();
  await page.getByRole("button", { name: /DÉCISION 1/ }).click();
  await page.getByLabel("Rejoindre Jeanne au port", { exact: true }).check();
  await page.getByRole("button", { name: "Conserver mon récit" }).click();
  await expect(page.locator("#scene-fin-partage")).toHaveCount(1);
  await page.getByRole("button", { name: "Mes décisions" }).click();
  await page.getByRole("button", { name: /DÉCISION 1/ }).click();
  await page.getByLabel("Rejoindre Jeanne au port", { exact: true }).check();
  await page.getByRole("button", { name: "Remplacer la suite" }).click();
  await expect(page.locator("#scene-jardin")).toHaveCount(0);
  await expect(page.locator("#scene-fin-partage")).toHaveCount(0);
  await expect(page.locator("#scene-jeanne")).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("eclats.reading.v1")).decisions.length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.locator(".scene").evaluateAll((nodes) => nodes.map((n) => n.id)),
  ).toEqual(["scene-arrivee", "scene-jeanne", "scene-seuil"]);
  await expect(page.locator("#jeanne-p3")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: "test-results/reader-mobile.png",
    fullPage: true,
  });
});
test("storage denied keeps the story usable and displays an honest warning", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw Error("denied");
      },
    });
  });
  await openReader(page);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "sauvegarde locale est indisponible" }),
  ).toBeVisible();
  await decision(page, "Rejoindre Jeanne au port");
  await expect(page.locator("#scene-jeanne")).toHaveCount(1);
});
test("corrupt saves recover and reduced motion suppresses reveal animations", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("eclats.reading.v1", "{broken"),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openReader(page);
  await expect(
    page.getByText(/sauvegarde est incompatible ou endommagée/),
  ).toBeVisible();
  await decision(page, "Rejoindre Jeanne au port");
  expect(
    await page
      .locator("#jeanne-p0")
      .evaluate((p) => getComputedStyle(p).animationName),
  ).toBe("none");
});
test("PWA installs a scoped cache and reopens offline including saved decisions", async ({
  page,
  context,
}) => {
  await openReader(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
  const manifest = await page.evaluate(async () =>
    (await fetch("manifest.webmanifest")).json(),
  );
  expect(manifest.start_url).toBe("./");
  await decision(page, "Rejoindre Jeanne au port");
  await context.setOffline(true);
  await page.reload();
  await enterReader(page);
  await expect(page.locator("#scene-jeanne")).toHaveCount(1);
  await decision(page, "Ouvrir la boîte de lettres");
  await expect(page.locator("#scene-lettres")).toHaveCount(1);
});

test("opening-page bookmark survives reload without skipping the title", async ({
  page,
}) => {
  await openReader(page);
  await expect(page.locator("#scene-arrivee")).toHaveCount(1);
  await page.reload();
  await enterReader(page);
  await expect(
    page.getByRole("heading", { name: "Le phare des heures" }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(10);
});
test("layouts fit small phones and desktop; dialogs support keyboard dismissal", async ({
  page,
}) => {
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await openReader(page);
    await expect(
      page.getByRole("heading", { name: "Le phare des heures" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Paramètres de lecture" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Paramètres de lecture" }),
    ).toBeFocused();
  }
});
test("an update waits for explicit activation, then preserves the reading save", async ({
  page,
}) => {
  await openReader(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
  await decision(page, "Passer par le jardin du phare");
  const path = "dist/sw.js",
    original = await readFile(path, "utf8");
  try {
    await writeFile(
      path,
      original.replace(
        /const CACHE="eclats-[^"]+"/,
        'const CACHE="eclats-update-test"',
      ),
    );
    await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      await r.update();
    });
    await expect(
      page.getByRole("button", { name: "Mettre à jour" }),
    ).toBeVisible();
    await expect(page.locator("#scene-jardin")).toHaveCount(1);
    await Promise.all([
      page.waitForEvent("load"),
      page.getByRole("button", { name: "Mettre à jour" }).click(),
    ]);
    await enterReader(page);
    await expect(page.locator("#scene-jardin")).toHaveCount(1);
    await expect
      .poll(() => page.evaluate(() => caches.keys()))
      .toEqual(["eclats-update-test"]);
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("eclats.reading.v1")).decisions,
      ),
    ).toEqual([{ scene: "arrivee", option: "jardin" }]);
  } finally {
    await writeFile(path, original);
  }
});

test("damaged preferences do not discard an intact reading save", async ({
  page,
}) => {
  await openReader(page);
  await decision(page, "Passer par le jardin du phare");
  await page.evaluate(() =>
    localStorage.setItem("eclats.settings.v1", "{broken"),
  );
  await page.reload();
  await enterReader(page);
  await expect(page.locator("#scene-jardin")).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("eclats.reading.v1")).decisions.length,
    ),
  ).toBe(1);
});

test("a write quota failure warns without blocking decisions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await openReader(page);
  await expect(
    page.getByText("Progression non enregistrée", { exact: true }),
  ).toBeVisible();
  await decision(page, "Rejoindre Jeanne au port");
  await expect(page.locator("#scene-jeanne")).toHaveCount(1);
});

test("dismissing installation consumes its single-use prompt cleanly", async ({
  page,
}) => {
  await openReader(page);
  await expect(page.locator("#scene-arrivee")).toHaveCount(1);
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = async () => {};
    event.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(event);
  });
  await page.getByRole("button", { name: "Installer Éclats" }).click();
  await expect(
    page.getByRole("button", { name: "Installer Éclats" }),
  ).toHaveCount(0);
  await decision(page, "Rejoindre Jeanne au port");
  await expect(page.locator("#scene-jeanne")).toHaveCount(1);
});

test("main menu opens four sections and preserves reading across destinations", async ({
  page,
}) => {
  await openReader(page);
  await decision(page, "Rejoindre Jeanne au port");
  await page.locator("#jeanne-p1").scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const before = await page.evaluate(() => scrollY);
  const decisions = await page.evaluate(
    () => JSON.parse(localStorage.getItem("eclats.reading.v1")).decisions,
  );
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav.getByRole("button")).toHaveCount(4);
  await nav.getByRole("button", { name: /Bibliothèque/ }).click();
  await expect(
    page.getByRole("heading", { name: "Bibliothèque", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#debut")).toBeHidden();
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("button", { name: /Journal de personnage/ }).click();
  await expect(
    page.getByRole("heading", { name: "Une page encore blanche" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: /Paramètres/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "À votre rythme" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: /Lectures/ })
    .click();
  await expect(page.locator("#scene-jeanne")).toBeVisible();
  expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(
    50,
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("eclats.reading.v1")).decisions,
    ),
  ).toEqual(decisions);
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.screenshot({ path: "test-results/menu-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Ouvrir le menu" }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("the application opens on its home menu, even with a reading in progress", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Bienvenue dans Éclats" }),
  ).toBeVisible();
  await expect(page.locator("#debut")).toBeHidden();
  await expect(
    page
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("button"),
  ).toHaveCount(4);
  await page.screenshot({ path: "test-results/home-mobile.png" });
  await enterReader(page);
  await decision(page, "Rejoindre Jeanne au port");
  await page.getByRole("link", { name: "Éclats, accueil" }).click();
  await expect(
    page.getByRole("heading", { name: "Bienvenue dans Éclats" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("#debut")).toBeHidden();
  await enterReader(page);
  await expect(page.locator("#scene-jeanne")).toBeVisible();
});

test("the recovery page activates a waiting edition without clearing progress", async ({
  page,
}) => {
  await openReader(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
  await decision(page, "Rejoindre Jeanne au port");
  const original = await readFile("dist/sw.js", "utf8");
  try {
    await writeFile(
      "dist/sw.js",
      original.replace(
        /const CACHE="eclats-[^"]+"/,
        'const CACHE="eclats-recovery-test"',
      ),
    );
    await page.goto("actualiser.html");
    await page.getByRole("button", { name: "Actualiser Éclats" }).click();
    await expect(
      page.getByRole("heading", { name: "Bienvenue dans Éclats" }),
    ).toBeVisible();
    expect(await page.evaluate(() => caches.keys())).toEqual([
      "eclats-recovery-test",
    ]);
    await enterReader(page);
    await expect(page.locator("#scene-jeanne")).toBeVisible();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("eclats.reading.v1")).decisions,
      ),
    ).toEqual([{ scene: "arrivee", option: "port" }]);
  } finally {
    await writeFile("dist/sw.js", original);
  }
});

test("decorated home fits phone and desktop in both themes", async ({
  page,
}) => {
  for (const width of [320, 393, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./");
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(nav.getByRole("button")).toHaveCount(4);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const reading = await page.locator("[data-section=reading]").boundingBox();
    const journal = await page.locator("[data-section=journal]").boundingBox();
    expect(reading.x).not.toBe(journal.x);
    expect(reading.y).not.toBe(journal.y);
  }
  await page.setViewportSize({ width: 393, height: 1000 });
  await page.screenshot({
    path: "test-results/home-decorated-light.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: /Paramètres/ })
    .click();
  await page.getByRole("button", { name: "Nuit", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-theme", "night");
  await page.screenshot({
    path: "test-results/home-decorated-night.png",
    fullPage: true,
  });
});
