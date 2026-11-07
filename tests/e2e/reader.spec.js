import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { replay, choose } from "../../src/engine.js";
const story = JSON.parse(
  await readFile("public/stories/accords-du-crepuscule.json", "utf8"),
);
const key = "eclats.reading.v1:accords-du-crepuscule";
const title = "Les Accords du Crépuscule";
async function enterReader(page) {
  await expect(
    page.getByRole("heading", { name: "Bienvenue dans Éclats" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: /Lectures/ })
    .click();
  await expect(page.locator("#scene-c1-rue")).toBeVisible();
}
async function openReader(page) {
  await page.goto("./");
  await enterReader(page);
}
async function decision(page, index = 0) {
  const form = page.locator(".choice");
  const prompt = await form.getAttribute("aria-label");
  await form.locator("input[type=radio]").nth(index).check();
  await form
    .getByRole("button", { name: "Confirmer ce chemin", exact: true })
    .click();
  await expect(
    page.getByRole("form", { name: prompt, exact: true }),
  ).toHaveCount(0);
}
async function library(page) {
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: /Bibliothèque/ })
    .click();
}
async function details(page) {
  await library(page);
  await page
    .getByRole("button", { name: `Voir les chapitres : ${title}`, exact: true })
    .click();
  await expect(page.locator(".chapter-link")).toHaveCount(13);
}
async function ready(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
}
async function saveValue(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
}
function advance(count) {
  let r = replay(story);
  for (let i = 0; i < count; i++)
    r = choose(story, r.decisions, r.pending.scene, r.pending.options[0].id);
  return r;
}
async function seed(page, count = 5) {
  const value = {
    schema: 1,
    story: story.id,
    version: 1,
    decisions: advance(count).decisions,
    anchor: "c1-rue-p0",
    offset: 0,
    chapter: "c1",
  };
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(value));
    },
    { key, value },
  );
}

test("library opens chapter details, locks future chapters and contains no demo", async ({
  page,
}) => {
  await page.goto("./");
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: /Bibliothèque/ })
    .click();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await expect(
    page.getByText("Le phare des heures", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.locator(".chapter-link")).toHaveCount(13);
  await expect(page.locator("#debut")).toBeHidden();
  await expect(page.locator("[data-chapter-id=c1]")).toBeEnabled();
  for (let n = 2; n <= 13; n++) {
    const chapter = page.locator(`[data-chapter-id=c${n}]`);
    await expect(chapter).toBeDisabled();
    await expect(chapter).toContainText("Inaccessible");
    await chapter.evaluate((button) => button.click());
    await expect(page.locator("#debut")).toBeHidden();
  }
  await page.screenshot({
    path: "test-results/chapters-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Commencer la lecture", exact: true })
    .click();
  await expect(page.locator("#scene-c1-rue")).toBeVisible();
  await expect(page.locator(".choice")).toHaveCount(1);
});

test("decisions require confirmation and unlock a full scene without navigation", async ({
  page,
}) => {
  await openReader(page);
  await expect(
    page.getByRole("button", { name: "Confirmer ce chemin" }),
  ).toBeDisabled();
  await page.locator(".choice input").first().check();
  await expect(page.locator("#scene-c1-nom")).toHaveCount(0);
  await decision(page);
  await expect(page.locator("#scene-c1-nom .prose p")).toHaveCount(4);
  await expect(page.locator("#scene-c1-prudence")).toHaveCount(0);
  expect((await saveValue(page)).decisions).toHaveLength(1);
});

test("finishing chapter one unlocks chapter two and jumping back preserves every decision", async ({
  page,
}) => {
  await openReader(page);
  for (let i = 0; i < 5; i++) await decision(page);
  const decisions = (await saveValue(page)).decisions;
  await details(page);
  await expect(page.locator("[data-chapter-id=c2]")).toBeEnabled();
  await expect(page.locator("[data-chapter-id=c3]")).toBeDisabled();
  await page.locator("[data-chapter-id=c2]").click();
  await expect(
    page.locator("#scene-c2-matin .chapter-heading"),
  ).toBeInViewport();
  expect((await saveValue(page)).decisions).toEqual(decisions);
  expect((await saveValue(page)).chapter).toBe("c2");
  await details(page);
  await page.locator("[data-chapter-id=c1]").click();
  await expect(page.locator("#scene-c1-rue .chapter-heading")).toBeInViewport();
  expect((await saveValue(page)).decisions).toEqual(decisions);
  await page.reload();
  await enterReader(page);
  expect((await saveValue(page)).decisions).toEqual(decisions);
  await details(page);
  await expect(page.locator("[data-chapter-id=c2]")).toBeEnabled();
});

test("revising an old decision requires confirmation and relocks subsequent chapters", async ({
  page,
}) => {
  await seed(page, 10);
  await openReader(page);
  await details(page);
  await expect(page.locator("[data-chapter-id=c3]")).toBeEnabled();
  await page.locator("[data-chapter-id=c1]").click();
  await page.getByRole("button", { name: "Mes décisions" }).click();
  await page.getByRole("button", { name: /DÉCISION 1\b/ }).click();
  await page.getByRole("dialog").locator("input[type=radio]").nth(1).check();
  await page.getByRole("button", { name: "Conserver mon récit" }).click();
  expect((await saveValue(page)).decisions).toHaveLength(10);
  await page.getByRole("button", { name: "Mes décisions" }).click();
  await page.getByRole("button", { name: /DÉCISION 1\b/ }).click();
  await page.getByRole("dialog").locator("input[type=radio]").nth(1).check();
  await page.getByRole("button", { name: "Remplacer la suite" }).click();
  await expect(page.locator("#scene-c1-prudence")).toBeVisible();
  await expect(page.locator("#scene-c2-matin")).toHaveCount(0);
  expect((await saveValue(page)).decisions).toHaveLength(1);
  await details(page);
  await expect(page.locator("[data-chapter-id=c2]")).toBeDisabled();
});

test("theme, font size and paragraph bookmark survive reload", async ({
  page,
}) => {
  await openReader(page);
  await decision(page);
  const decisions = (await saveValue(page)).decisions;
  await page.getByRole("button", { name: "Paramètres de lecture" }).click();
  await page.getByRole("button", { name: "Nuit", exact: true }).click();
  await page
    .getByRole("button", { name: "Agrandir la taille du texte" })
    .click();
  await page.keyboard.press("Escape");
  await page.locator("#c1-nom-p1").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const y = await page.evaluate(() => scrollY);
  await page.reload();
  await enterReader(page);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "night");
  expect((await saveValue(page)).decisions).toEqual(decisions);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y - 50);
  expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(60);
});

test("storage denial allows reading with an honest warning", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw Error("denied");
      },
    }),
  );
  await openReader(page);
  await expect(
    page.getByText("Progression non enregistrée", { exact: true }),
  ).toBeVisible();
  await decision(page);
  await expect(page.locator("#scene-c1-nom")).toBeVisible();
});

test("write quota errors do not block choices", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await openReader(page);
  await decision(page);
  await expect(
    page.getByText("Progression non enregistrée", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#scene-c1-nom")).toBeVisible();
});

test("corrupt saves recover and reduced motion disables paragraph animation", async ({
  page,
}) => {
  await page.addInitScript((key) => localStorage.setItem(key, "{broken"), key);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openReader(page);
  await expect(
    page.getByText(/sauvegarde est incompatible ou endommagée/),
  ).toBeVisible();
  await decision(page);
  expect(
    await page
      .locator("#c1-nom-p0")
      .evaluate((p) => getComputedStyle(p).animationName),
  ).toBe("none");
});

test("corrupt preferences do not discard reading progress", async ({
  page,
}) => {
  await openReader(page);
  await decision(page);
  await page.evaluate(() =>
    localStorage.setItem("eclats.settings.v1", "{broken"),
  );
  await page.reload();
  await enterReader(page);
  await expect(page.locator("#scene-c1-nom")).toBeVisible();
  expect((await saveValue(page)).decisions).toHaveLength(1);
});

test("offline reopening preserves chapters, decisions and further reading", async ({
  page,
  context,
}) => {
  await openReader(page);
  await ready(page);
  for (let i = 0; i < 5; i++) await decision(page);
  await context.setOffline(true);
  await page.reload();
  await enterReader(page);
  await details(page);
  await expect(page.locator("[data-chapter-id=c2]")).toBeEnabled();
  await expect(page.locator("[data-chapter-id=c3]")).toBeDisabled();
  await page.locator("[data-chapter-id=c2]").click();
  await decision(page);
  expect((await saveValue(page)).decisions).toHaveLength(6);
});

test("application opens on the main menu even with reading progress", async ({
  page,
}) => {
  await openReader(page);
  await decision(page);
  await page.getByRole("link", { name: "Éclats, accueil" }).click();
  await expect(
    page.getByRole("heading", { name: "Bienvenue dans Éclats" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("#debut")).toBeHidden();
  await expect(
    page
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("button"),
  ).toHaveCount(4);
  await enterReader(page);
  await expect(page.locator("#scene-c1-nom")).toBeVisible();
});

test("menu destinations preserve reading position and decisions", async ({
  page,
}) => {
  await openReader(page);
  await decision(page);
  await page.locator("#c1-nom-p1").scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => scrollY);
  const decisions = (await saveValue(page)).decisions;
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: /Journal de personnage/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Une page encore blanche" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: /Lectures/ })
    .click();
  await expect(page.locator("#debut")).toBeVisible();
  expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(50);
  expect((await saveValue(page)).decisions).toEqual(decisions);
});

test("home and chapter list fit narrow phones, desktop and night theme", async ({
  page,
}) => {
  for (const width of [320, 393, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./");
    await expect(
      page.getByRole("heading", { name: "Bienvenue dans Éclats" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("button", { name: /Bibliothèque/ })
      .click();
    await page
      .getByRole("button", {
        name: `Voir les chapitres : ${title}`,
        exact: true,
      })
      .click();
    await expect(page.locator(".chapter-link")).toHaveCount(13);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 393, height: 900 });
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: /Paramètres/ })
    .click();
  await page.getByRole("button", { name: "Nuit", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-theme", "night");
  await page.screenshot({
    path: "test-results/chapters-night.png",
    fullPage: true,
  });
});

test("dialogs support keyboard dismissal and restore focus", async ({
  page,
}) => {
  await openReader(page);
  const opener = page.getByRole("button", { name: "Paramètres de lecture" });
  await opener.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("dismissing the single-use installation prompt leaves reading functional", async ({
  page,
}) => {
  await openReader(page);
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = async () => {};
    e.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(e);
  });
  await page.getByRole("button", { name: "Installer Éclats" }).click();
  await expect(
    page.getByRole("button", { name: "Installer Éclats" }),
  ).toHaveCount(0);
  await decision(page);
});

test("updates wait for activation and preserve the saved chapter access", async ({
  page,
}) => {
  await seed(page, 5);
  await openReader(page);
  await ready(page);
  const original = await readFile("dist/sw.js", "utf8");
  try {
    await writeFile(
      "dist/sw.js",
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
    await Promise.all([
      page.waitForEvent("load"),
      page.getByRole("button", { name: "Mettre à jour" }).click(),
    ]);
    await enterReader(page);
    await expect
      .poll(() => page.evaluate(() => caches.keys()))
      .toEqual(["eclats-update-test"]);
    await details(page);
    await expect(page.locator("[data-chapter-id=c2]")).toBeEnabled();
    expect((await saveValue(page)).decisions).toHaveLength(5);
  } finally {
    await writeFile("dist/sw.js", original);
  }
});

test("repair recovers a broken cached script without losing chapter access", async ({
  page,
}) => {
  await seed(page, 5);
  await openReader(page);
  await ready(page);
  await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys())
        if (new URL(request.url).pathname.endsWith(".js"))
          await cache.put(
            request,
            new Response('throw new Error("broken");', {
              headers: { "Content-Type": "application/javascript" },
            }),
          );
    }
  });
  await page.reload();
  await expect(page.locator("#boot-fallback")).toBeVisible();
  await page
    .getByRole("link", { name: "Réparer et ouvrir Éclats", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Réparer et ouvrir Éclats", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bienvenue dans Éclats" }),
  ).toBeVisible();
  await enterReader(page);
  await details(page);
  await expect(page.locator("[data-chapter-id=c2]")).toBeEnabled();
  expect((await saveValue(page)).decisions).toHaveLength(5);
});

test("repair reports offline failures and preserves reading data", async ({
  page,
  context,
}) => {
  await openReader(page);
  await decision(page);
  await page.goto("reparer.html");
  const before = await saveValue(page);
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Réparer et ouvrir Éclats", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "La réparation n’a pas abouti",
  );
  expect(await saveValue(page)).toEqual(before);
});

test("all thirteen chapters can be read and revisited after completion", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openReader(page);
  for (let i = 0; i < 65; i++) {
    if (i >= 15) await expect(page.locator(".choice input")).toHaveCount(5);
    await decision(page, i >= 15 && i !== 59 ? i % 5 : 0);
  }
  await expect(page.locator(".chapter-heading")).toHaveCount(13);
  await expect(
    page.getByRole("heading", {
      name: "Les portes qui restent ouvertes",
      exact: true,
    }),
  ).toBeVisible();
  const history = (await saveValue(page)).decisions;
  expect(history).toHaveLength(65);
  await details(page);
  await expect(page.locator(".chapter-link:enabled")).toHaveCount(13);
  await page.locator("[data-chapter-id=c4]").click();
  await expect(page.locator("#scene-c4-1 .chapter-heading")).toBeInViewport();
  expect((await saveValue(page)).decisions).toEqual(history);
});

test("old chapter-three saves resume without resets and expose chapter four", async ({
  page,
}) => {
  await seed(page, 15);
  await openReader(page);
  await details(page);
  await expect(page.locator(".chapter-link:enabled")).toHaveCount(4);
  await page.locator("[data-chapter-id=c4]").click();
  await expect(page.locator("#scene-c4-1 .choice input")).toHaveCount(5);
  await decision(page, 3);
  await page.reload();
  await enterReader(page);
  expect((await saveValue(page)).decisions).toHaveLength(16);
});

test("removed demo selection falls back to the novel without deleting existing data", async ({
  page,
}) => {
  await seed(page, 5);
  await page.addInitScript(() => {
    localStorage.setItem("eclats.selected-book.v1", "le-phare-des-heures");
    localStorage.setItem("eclats.reading.v1", "legacy data to retain");
  });
  await page.goto("./?story=demo");
  await enterReader(page);
  await details(page);
  await expect(page.locator(".chapter-link:enabled")).toHaveCount(2);
  expect(
    await page.evaluate(() => localStorage.getItem("eclats.reading.v1")),
  ).toBe("legacy data to retain");
  expect(
    await page.evaluate(() => localStorage.getItem("eclats.selected-book.v1")),
  ).toBe("accords-du-crepuscule");
  const sw = await readFile("dist/sw.js", "utf8");
  expect(sw).not.toContain("demo.json");
  const response = await page.request.get("stories/demo.json");
  expect(response.headers()["content-type"]).not.toContain("application/json");
});

test("an existing chapter-eight save unlocks chapter nine without clearing decisions", async ({
  page,
}) => {
  await seed(page, 40);
  await openReader(page);
  await details(page);
  await expect(page.locator(".chapter-link:enabled")).toHaveCount(9);
  await expect(page.locator("[data-chapter-id=c10]")).toBeDisabled();
  await page.locator("[data-chapter-id=c9]").click();
  await expect(page.locator("#scene-c9-1 .choice input")).toHaveCount(5);
  await decision(page, 3);
  await page.reload();
  await enterReader(page);
  expect((await saveValue(page)).decisions).toHaveLength(41);
  await details(page);
  await expect(page.locator(".chapter-link:enabled")).toHaveCount(9);
});
