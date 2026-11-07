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
  await expect(page.locator(".chapter-heading")).toHaveCount(1);
}
async function openReader(page) {
  await page.goto("./");
  await enterReader(page);
}
async function decision(page, index = 0) {
  if (await page.locator(".choice").count() === 0)
    await page.getByRole("button", { name: "Chapitre suivant →", exact: true }).click();
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
  await expect(page.locator(".chapter-link")).toHaveCount(33);
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
  await expect(page.locator(".chapter-link")).toHaveCount(33);
  await expect(page.locator("#debut")).toBeHidden();
  await expect(page.locator("[data-chapter-id=c1]")).toBeEnabled();
  for (let n = 2; n <= 33; n++) {
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
    page.getByRole("heading", { name: "Journal de personnage", exact: true }),
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
    await expect(page.locator(".chapter-link")).toHaveCount(33);
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

test("all thirty-three chapters can be read and revisited after completion", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openReader(page);
  for (let i = 0; i < 165; i++) {
    if (await page.locator(".choice").count() === 0)
      await page.getByRole("button", { name: "Chapitre suivant →", exact: true }).click();
    if (i >= 15) await expect(page.locator(".choice input")).toHaveCount(5);
    await decision(page, i >= 15 && i !== 59 && i !== 149 ? i % 5 : 0);
  }
  await expect(page.locator(".chapter-heading")).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      name: "Une porte pour la nuit",
      exact: true,
    }),
  ).toBeVisible();
  const history = (await saveValue(page)).decisions;
  expect(history).toHaveLength(165);
  await details(page);
  await expect(page.locator(".chapter-link:enabled")).toHaveCount(33);
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

test("scene explanations start at chapter five, work on mobile and preserve decisions", async ({ page }) => {
  let progress = replay(story);
  while (progress.decisions.length < 20)
    progress = choose(story, progress.decisions, progress.pending.scene, progress.pending.options[0].id);
  await page.goto("./");
  await page.evaluate(({ key, decisions }) => {
    localStorage.setItem(key, JSON.stringify({ schema: 1, story: "accords-du-crepuscule", version: 1, decisions, anchor: "c5-1-p0", offset: 0, chapter: "c5" }));
  }, { key, decisions: progress.decisions });
  await page.reload();
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: /Lectures/ }).click();
  const guide = page.locator("#scene-c5-1 .reading-guide");
  await expect(guide).toHaveCount(1);
  await expect(page.locator('[data-chapter="c4"] .reading-guide')).toHaveCount(0);
  await expect(page.locator("#scene-c5-3")).toHaveCount(0);
  await guide.locator("summary").click();
  await expect(guide.getByRole("heading")).toHaveText("Qui fait quoi pendant l’expédition ?");
  await expect(guide.locator("li")).toHaveCount(3);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await guide.locator("summary").click();
  await decision(page);
  expect((await saveValue(page)).decisions.length).toBe(21);
});

test("a completed first-cycle save resumes at chapter fourteen and preserves its conclusion", async ({ page }) => {
  await seed(page, 65);
  await openReader(page);
  await details(page);
  await expect(page.locator(".chapter-link:enabled")).toHaveCount(14);
  await expect(page.locator("[data-chapter-id=c15]")).toBeDisabled();
  await page.locator("[data-chapter-id=c14]").click();
  await expect(page.locator("#scene-c14-1 .choice input")).toHaveCount(5);
  await expect(page.locator(".cycle-ending")).toHaveCount(0);
  const before = (await saveValue(page)).decisions;
  await decision(page, 2);
  await page.reload();
  await enterReader(page);
  const saved = (await saveValue(page)).decisions;
  expect(saved).toHaveLength(66);
  expect(saved.slice(0, 65)).toEqual(before);
  await page.locator("#scene-c14-1 .decision-mark button").click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input[type=radio]").first().check();
  await dialog.getByRole("button", { name: /Remplacer/ }).click();
  expect((await saveValue(page)).decisions).toHaveLength(66);
  await details(page);
  await expect(page.locator("[data-chapter-id=c15]")).toBeDisabled();
});

test("chapter boundaries pause reading; next and previous pages preserve choices and show a short recap", async ({ page }) => {
  await openReader(page);
  await expect(page.locator(".chapter-recap")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Chapitre suivant →" })).toHaveCount(0);
  for (let i = 0; i < 5; i++) await decision(page);
  await expect(page.locator("#debut")).toHaveAttribute("data-chapter", "c1");
  await expect(page.locator("#scene-c2-matin")).toHaveCount(0);
  await expect(page.locator(".choice")).toHaveCount(0);
  await expect(page.locator(".chapter-break")).toHaveText("Fin du chapitre 1");
  const decisions = (await saveValue(page)).decisions;
  await page.getByRole("button", { name: "Chapitre suivant →", exact: true }).click();
  await expect(page.locator("#debut")).toHaveAttribute("data-chapter", "c2");
  await expect(page.locator("#scene-c1-rue")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Résumé du chapitre précédent" })).toContainText("citerne");
  await expect(page.locator(".chapter-heading")).toHaveCount(1);
  expect((await saveValue(page)).decisions).toEqual(decisions);
  expect((await saveValue(page)).chapter).toBe("c2");
  await page.reload();
  await enterReader(page);
  await expect(page.locator("#debut")).toHaveAttribute("data-chapter", "c2");
  await page.getByRole("button", { name: "Chapitre précédent", exact: false }).click();
  await expect(page.locator("#debut")).toHaveAttribute("data-chapter", "c1");
  expect((await saveValue(page)).decisions).toEqual(decisions);
  await expect(page.locator(".chapter-recap")).toHaveCount(0);
});

test("history can revise a decision on a different chapter page and remove incompatible future recaps", async ({ page }) => {
  await seed(page, 15);
  await openReader(page);
  await details(page);
  await page.locator("[data-chapter-id=c4]").click();
  await expect(page.locator(".chapter-recap")).toHaveCount(1);
  await page.getByRole("button", { name: "Mes décisions" }).click();
  await page.getByRole("button", { name: /DÉCISION 1\b/ }).click();
  await page.getByRole("dialog").locator("input[type=radio]").nth(1).check();
  await page.getByRole("button", { name: "Remplacer la suite" }).click();
  await expect(page.locator("#debut")).toHaveAttribute("data-chapter", "c1");
  await expect(page.locator(".chapter-recap")).toHaveCount(0);
  await expect(page.locator("#scene-c4-1")).toHaveCount(0);
  expect((await saveValue(page)).decisions).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Chapitre suivant →" })).toHaveCount(0);
});

test("chapter six illustrations follow the unlocked prose and remain available offline on a narrow phone", async ({ page, context }) => {
  await seed(page, 25);
  await openReader(page);
  await details(page);
  await page.locator("[data-chapter-id=c6]").click();
  await expect(page.locator(".story-illustration")).toHaveCount(1);
  const first = page.locator(".story-illustration img").first();
  await first.scrollIntoViewIfNeeded();
  await expect.poll(() => first.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await first.getAttribute("src")).toMatch(/^\/Eclats\/illustrations\//u);
  expect(await first.evaluate((img) => img.getBoundingClientRect().right <= innerWidth)).toBe(true);
  expect(await page.locator("#c6-1-p7").evaluate((p) => p.nextElementSibling.classList.contains("story-illustration"))).toBe(true);
  await decision(page);
  await expect(page.locator(".story-illustration")).toHaveCount(2);
  await ready(page);
  const decisions = (await saveValue(page)).decisions;
  await context.setOffline(true);
  await page.reload();
  await enterReader(page);
  for (const img of await page.locator(".story-illustration img").all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((node) => node.complete && node.naturalWidth === 1536)).toBe(true);
  }
  expect((await saveValue(page)).decisions).toEqual(decisions);
  await expect(page.locator("#c6-2-p3")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("expanded chapters keep old paragraph anchors and restore bookmarks inside the added prose", async ({ page }) => {
  await seed(page, 65);
  await openReader(page);
  await details(page);
  await page.locator("[data-chapter-id=c14]").click();
  await expect(page.locator("#c14-1-p2")).toHaveCount(1);
  const added = page.locator("#c14-1-e0-p2");
  await expect(added).toHaveCount(1);
  const text = await added.textContent();
  await added.evaluate((node) => node.scrollIntoView({ block: "start", behavior: "instant" }));
  await page.waitForTimeout(350);
  const before = await saveValue(page);
  expect(before.anchor).toMatch(/c14-1-e0-p/u);
  const y = await page.evaluate(() => scrollY);
  await page.reload();
  await enterReader(page);
  await expect(added).toHaveText(text);
  expect((await saveValue(page)).decisions).toEqual(before.decisions);
  expect((await saveValue(page)).chapter).toBe("c14");
  expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(80);
  await expect(page.locator(".chapter-heading")).toHaveCount(1);
});
