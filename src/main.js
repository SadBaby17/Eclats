import "./style.css";
import { validateStory, replay, choose } from "./engine.js";
import { readSave, writeSave, SETTINGS_KEY } from "./storage.js";

const app = document.querySelector("#app");
const el = (tag, attrs = {}, text) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
};
let story,
  state,
  storage,
  restore,
  canSave = false,
  saveTimer,
  settings = { theme: "system", size: 20 };
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
history.scrollRestoration = "manual";
try {
  storage = localStorage;
  const rawSettings = storage.getItem(SETTINGS_KEY);
  let saved;
  try {
    saved = JSON.parse(rawSettings || "null");
  } catch {
    // Damaged preferences must never prevent restoring a valid reading save.
    saved = null;
  }
  if (
    saved &&
    ["system", "light", "night"].includes(saved.theme) &&
    Number.isFinite(saved.size)
  )
    settings = {
      theme: saved.theme,
      size: Math.min(28, Math.max(16, saved.size)),
    };
} catch {
  storage = null;
}
function applySettings() {
  document.body.dataset.theme =
    settings.theme === "system"
      ? systemTheme.matches
        ? "night"
        : "light"
      : settings.theme;
  document.documentElement.style.setProperty(
    "--reading-size",
    `${settings.size}px`,
  );
  document.querySelector("meta[name=theme-color]").content =
    document.body.dataset.theme === "night" ? "#1b1d1d" : "#f8f5ef";
}
applySettings();
systemTheme.addEventListener("change", applySettings);
const top = el("header", { class: "topbar" });
const brand = el(
  "a",
  { class: "brand", href: "#debut", "aria-label": "Éclats, début du livre" },
  "éclats",
);
brand.append(el("span", {}, " ✧"));
top.append(
  brand,
  el("span", { class: "top-meta" }, "Des histoires, vos chemins"),
);
const actions = el("nav", {
  class: "top-actions",
  "aria-label": "Outils de lecture",
});
function action(label, symbol, handler) {
  const button = el(
    "button",
    { class: "icon-button", "aria-label": label, title: label },
    symbol,
  );
  button.onclick = handler;
  return button;
}
actions.append(
  action("Mes décisions", "↶", openHistory),
  action("Paramètres de lecture", "Aa", openSettings),
);
top.append(actions);
const notice = el("div", { class: "notice", role: "status" });
const live = el("div", {
  class: "sr-only",
  role: "status",
  "aria-live": "polite",
});
const book = el("main", { class: "book", id: "debut" });
const footer = el("footer", { class: "footer" });
const progress = el("div", {
  class: "progress",
  role: "progressbar",
  "aria-label": "Position dans le texte disponible",
  "aria-valuemin": "0",
  "aria-valuemax": "100",
  "aria-valuenow": "0",
});
const progressText = el("span", {}, "CHAPITRE 01");
const saveState = el(
  "span",
  { class: "save-state" },
  "Sauvegarde locale automatique",
);
footer.append(progress, progressText, saveState);
app.replaceChildren(top, notice, live, book, footer);
function storageError() {
  notice.textContent =
    "La sauvegarde locale est indisponible. Vous pouvez continuer à lire, mais votre progression risque de ne pas être conservée après fermeture.";
  saveState.textContent = "Progression non enregistrée";
}
if (!storage) storageError();
function position() {
  const paragraphs = [...book.querySelectorAll("[data-anchor]")];
  const current =
    paragraphs.find((p) => p.getBoundingClientRect().bottom > 8) ||
    paragraphs.at(-1);
  return {
    anchor: current?.id || null,
    offset: current ? -current.getBoundingClientRect().top : 0,
    chapter:
      current?.closest("[data-chapter]")?.dataset.chapter ||
      story?.chapters[0]?.id ||
      null,
  };
}
function save() {
  if (!canSave || !story) return;
  if (!storage) {
    storageError();
    return;
  }
  try {
    const p = position();
    writeSave(storage, story, state.decisions, p.anchor, p.offset, p.chapter);
    saveState.textContent = "Progression enregistrée sur cet appareil";
  } catch {
    storageError();
  }
}
function restorePosition(p) {
  if (!p?.anchor) return;
  const node = document.getElementById(p.anchor);
  if (node)
    window.scrollTo({
      top:
        window.scrollY +
        node.getBoundingClientRect().top +
        Math.min(p.offset, node.offsetHeight),
      behavior: "instant",
    });
}
function updateProgress() {
  const max = document.documentElement.scrollHeight - innerHeight;
  const amount =
    max <= 0
      ? 100
      : Math.round(Math.min(100, Math.max(0, (scrollY / max) * 100)));
  progress.style.width = `${amount}%`;
  progress.setAttribute("aria-valuenow", amount);
  const chapter = story?.chapters.find((c) => c.id === position().chapter);
  progressText.textContent = `CHAPITRE ${String(chapter?.number || 1).padStart(2, "0")} · ${amount} %`;
}
window.addEventListener(
  "scroll",
  () => {
    if (!story) return;
    updateProgress();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 180);
  },
  { passive: true },
);
window.addEventListener("pagehide", save);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) save();
});
function paragraph(text, id, animate, index) {
  const p = el(
    "p",
    {
      id,
      "data-anchor": "",
      ...(animate
        ? { class: "reveal", style: `--delay:${Math.min(index, 5) * 45}ms` }
        : {}),
    },
    text,
  );
  return p;
}
function render(animate = false) {
  // Retain existing scene DOM and paragraph nodes so unlocking text never resets scroll.
  const wanted = new Set(state.blocks.map((b) => `scene-${b.id}`));
  for (const node of book.querySelectorAll(".scene"))
    if (!wanted.has(node.id)) node.remove();
  book.querySelector(".ending")?.remove();
  let lastChapter;
  let insertionPoint = book.querySelector(".book-heading");
  for (const block of state.blocks) {
    let section = document.getElementById(`scene-${block.id}`);
    if (!section) {
      section = el("section", {
        class: "scene",
        id: `scene-${block.id}`,
        "data-chapter": block.scene.chapter,
      });
      if (lastChapter !== block.scene.chapter) {
        const chapter = story.chapters.find(
          (c) => c.id === block.scene.chapter,
        );
        const heading = el("header", { class: "chapter-heading" });
        heading.append(
          el(
            "div",
            { class: "eyebrow" },
            `Chapitre ${String(chapter.number).padStart(2, "0")}`,
          ),
          el("h2", {}, chapter.title),
        );
        section.append(heading);
      }
      const prose = el("div", { class: "prose" });
      block.scene.paragraphs.forEach((text, i) =>
        prose.append(paragraph(text, `${block.id}-p${i}`, animate, i)),
      );
      section.append(prose);
    }
    if (insertionPoint.nextElementSibling !== section)
      book.insertBefore(section, insertionPoint.nextSibling);
    insertionPoint = section;
    lastChapter = block.scene.chapter;
    if (block.scene.choice) {
      const old = section.querySelector(".interaction");
      if (old?.dataset.selection === (block.selected?.id || "pending"))
        continue;
      old?.remove();
      const interaction = el("div", {
        class: "interaction",
        "data-selection": block.selected?.id || "pending",
      });
      if (block.selected) {
        const passage = el("div", { class: "prose" });
        passage.append(
          paragraph(block.selected.passage, `${block.id}-selected`, animate, 0),
        );
        const mark = el("div", { class: "decision-mark" });
        const change = el(
          "button",
          {
            class: "text-button",
            "aria-label": `Modifier : ${block.selected.label}`,
          },
          "Revenir sur ce choix",
        );
        change.onclick = () => openRevision(block.id);
        mark.append(el("span", { "aria-hidden": "true" }, "◇"), change);
        interaction.append(passage, mark);
      } else interaction.append(choiceForm(state.pending));
      section.append(interaction);
    }
  }
  if (state.ending) {
    const ending = el("section", { class: "ending" });
    ending.append(
      el("div", { class: "eyebrow" }, "Fin du chapitre de démonstration"),
      el("h2", {}, state.ending),
      el(
        "p",
        {},
        "Chaque chemin laisse un éclat différent. Vous pouvez retrouver vos décisions dans le menu en haut de la page.",
      ),
    );
    book.append(ending);
  }
  updateProgress();
}
function optionsField(options, name, selected) {
  const field = el("fieldset", { class: "options" });
  field.append(
    el(
      "legend",
      { class: "sr-only" },
      "Choisissez une direction pour le récit",
    ),
  );
  options.forEach((option) => {
    const label = el("label", { class: "option" });
    const input = el("input", { type: "radio", name, value: option.id });
    input.checked = selected === option.id;
    label.append(input, document.createTextNode(option.label));
    field.append(label);
  });
  return field;
}
function choiceForm(pending) {
  const form = el("form", { class: "choice", "aria-label": pending.prompt });
  const title = el(
    "p",
    { class: "choice-prompt", id: `prompt-${pending.scene}` },
    pending.prompt,
  );
  const field = optionsField(pending.options, "decision");
  field.setAttribute("aria-labelledby", title.id);
  const confirm = el(
    "button",
    { class: "primary confirm", type: "submit", disabled: "" },
    "Confirmer ce chemin",
  );
  form.append(
    el("div", { class: "choice-note" }, "À la croisée du récit"),
    title,
    field,
    confirm,
  );
  form.onchange = () => {
    confirm.disabled = !form.querySelector("input:checked");
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    const selected = form.querySelector("input:checked");
    if (!selected) return;
    state = choose(story, state.decisions, pending.scene, selected.value);
    render(true);
    save();
    live.textContent =
      "Votre choix est intégré au récit. La suite est disponible en dessous.";
    const passage = document.getElementById(`${pending.scene}-selected`);
    passage.tabIndex = -1;
    passage.focus({ preventScroll: true });
  };
  return form;
}
function modal(title) {
  const dialog = el("dialog");
  const header = el("div", { class: "dialog-top" });
  const heading = el("h2", { id: "dialog-title" }, title);
  const close = action("Fermer", "×", () => dialog.close());
  header.append(heading, close);
  dialog.append(header);
  dialog.setAttribute("aria-labelledby", heading.id);
  document.body.append(dialog);
  const opener = document.activeElement;
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        dialog.close();
    }
  });
  return dialog;
}
function openHistory() {
  if (!state) return;
  const dialog = modal("Vos chemins");
  dialog.append(
    el(
      "p",
      {},
      "Retrouvez une décision pour explorer un autre chemin. La suite sera remplacée uniquement après confirmation.",
    ),
  );
  if (!state.decisions.length)
    dialog.append(
      el("p", {}, "Vos décisions apparaîtront ici au fil de la lecture."),
    );
  state.decisions.forEach((d, i) => {
    const option = story.scenes[d.scene].choice.options.find(
      (o) => o.id === d.option,
    );
    const button = el("button", { class: "history-item" });
    button.append(
      el("small", {}, `DÉCISION ${i + 1}`),
      document.createTextNode(option.label),
    );
    button.onclick = () => {
      dialog.close();
      openRevision(d.scene);
    };
    dialog.append(button);
  });
  dialog.showModal();
}
function openRevision(sceneId) {
  const index = state.decisions.findIndex((d) => d.scene === sceneId);
  if (index < 0) return;
  const before = state.decisions.slice(0, index),
    pending = replay(story, before).pending;
  const current = state.decisions[index].option;
  const dialog = modal("Un autre chemin");
  dialog.append(
    el("p", {}, pending.prompt),
    el(
      "p",
      {},
      "Confirmer un nouveau choix remplacera tous les passages et toutes les décisions qui suivent cet endroit. Cette action ne peut pas être annulée.",
    ),
  );
  const field = optionsField(pending.options, "revision", current);
  const confirm = el(
    "button",
    { class: "primary", disabled: "" },
    "Remplacer la suite",
  );
  field.onchange = () => {
    confirm.disabled = field.querySelector("input:checked")?.value === current;
  };
  const cancel = el("button", { class: "text-button" }, "Conserver mon récit");
  cancel.onclick = () => dialog.close();
  confirm.onclick = () => {
    const selected = field.querySelector("input:checked");
    if (!selected || selected.value === current) return;
    state = choose(story, before, sceneId, selected.value);
    dialog.close();
    render(true);
    const anchor = document.getElementById(`${sceneId}-selected`);
    anchor.scrollIntoView({ block: "center", behavior: "instant" });
    anchor.tabIndex = -1;
    anchor.focus({ preventScroll: true });
    save();
    live.textContent =
      "Le chemin a été remplacé. Les décisions suivantes ont été annulées.";
  };
  const buttons = el("div", { class: "dialog-actions" });
  buttons.append(cancel, confirm);
  dialog.append(field, buttons);
  dialog.showModal();
}
function openSettings() {
  const dialog = modal("À votre rythme");
  const size = el("div", { class: "setting" });
  const sizeValue = el("span", {}, `${settings.size} px`);
  size.append(el("span", { class: "setting-title" }, "Taille du texte"));
  const controls = el("div", { class: "setting-controls" });
  const smaller = action("Réduire la taille du texte", "A−", () =>
    changeSize(-1),
  );
  const larger = action("Agrandir la taille du texte", "A+", () =>
    changeSize(1),
  );
  function changeSize(delta) {
    const p = position();
    settings.size = Math.max(16, Math.min(28, settings.size + delta));
    persistSettings();
    restorePosition(p);
    sizeValue.textContent = `${settings.size} px`;
    smaller.disabled = settings.size === 16;
    larger.disabled = settings.size === 28;
    save();
  }
  smaller.disabled = settings.size === 16;
  larger.disabled = settings.size === 28;
  controls.append(smaller, sizeValue, larger);
  size.append(controls);
  const theme = el("div", { class: "setting" });
  theme.append(el("span", { class: "setting-title" }, "Ambiance de lecture"));
  const themes = el("div", { class: "setting-controls" });
  for (const [value, label] of [
    ["light", "Jour"],
    ["night", "Nuit"],
    ["system", "Système"],
  ]) {
    const button = el(
      "button",
      {
        class: "theme-button",
        "aria-pressed": String(settings.theme === value),
      },
      label,
    );
    button.onclick = () => {
      settings.theme = value;
      persistSettings();
      themes
        .querySelectorAll("button")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    };
    themes.append(button);
  }
  theme.append(themes);
  dialog.append(
    size,
    theme,
    el(
      "p",
      {},
      "Votre progression et vos préférences sont conservées sur cet appareil. Pour lire hors connexion, ouvrez une première fois le livre en ligne.",
    ),
  );
  dialog.showModal();
}
function persistSettings() {
  applySettings();
  try {
    if (!storage) throw Error();
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    storageError();
  }
}
async function start() {
  try {
    const response = await fetch(
      `${import.meta.env.BASE_URL}stories/demo.json`,
    );
    if (!response.ok) throw Error("Le livre est indisponible.");
    story = validateStory(await response.json());
    try {
      if (storage) restore = readSave(storage, story);
    } catch {
      notice.textContent =
        "La sauvegarde est incompatible ou endommagée. Une nouvelle lecture a été ouverte.";
    }
    state = replay(story, restore?.decisions || []);
    if (restore && state.decisions.length !== restore.decisions.length)
      notice.textContent =
        "Les décisions incompatibles ont été retirées. Votre dernière progression valide a été conservée.";
    const heading = el("header", { class: "book-heading" });
    heading.append(
      el("div", { class: "eyebrow" }, "Les récits d’Éclats · Nouvelle 01"),
      el("h1", {}, story.title),
      el("p", { class: "subtitle" }, story.subtitle),
      el("div", { class: "ornament", "aria-hidden": "true" }, "✧"),
    );
    book.append(heading);
    render();
    await document.fonts.ready;
    requestAnimationFrame(() => {
      restorePosition(restore);
      canSave = true;
      updateProgress();
      save();
    });
    if (import.meta.env.PROD && "serviceWorker" in navigator) setupOffline();
  } catch (error) {
    book.replaceChildren(
      el("h1", {}, "Le livre n’a pas pu être ouvert"),
      el(
        "p",
        {},
        "Vérifiez votre connexion puis réessayez. Votre sauvegarde n’a pas été modifiée.",
      ),
    );
    const retry = el("button", { class: "primary" }, "Réessayer");
    retry.onclick = () => location.reload();
    book.append(retry);
    console.error(error);
  }
}
async function setupOffline() {
  try {
    const registration = await navigator.serviceWorker.register(
      `${import.meta.env.BASE_URL}sw.js`,
      { scope: import.meta.env.BASE_URL },
    );
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) location.reload();
    });
    function updateAvailable() {
      if (!registration.waiting || !navigator.serviceWorker.controller) return;
      const banner = el("div", { class: "notice" });
      banner.append(
        document.createTextNode(
          "Une nouvelle édition de l’application est disponible. ",
        ),
      );
      const button = el("button", { class: "text-button" }, "Mettre à jour");
      button.onclick = () => {
        save();
        reloading = true;
        registration.waiting?.postMessage({ type: "ACTIVATE" });
      };
      banner.append(button);
      top.after(banner);
    }
    updateAvailable();
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed") updateAvailable();
      });
    });
  } catch {
    notice.textContent =
      "Le mode hors connexion n’a pas pu être préparé. La lecture et la sauvegarde locale restent disponibles.";
  }
}
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  const button = action("Installer Éclats", "↓", async () => {
    button.disabled = true;
    try {
      await event.prompt();
      await event.userChoice;
    } catch {
      notice.textContent =
        "Vous pouvez installer Éclats depuis le menu de votre navigateur.";
    } finally {
      // A browser installation prompt can only be used once, even if dismissed.
      button.remove();
    }
  });
  actions.append(button);
});
start();
