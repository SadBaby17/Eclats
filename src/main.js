import "./style.css";
import { journalAnchors, migrateDiscoveries, retainDiscoveries, knownCharacters, sourceAnchor } from "./journal.js";
import { chapterProgress, chapterScene, chapterPage, chapterRecap } from "./chapters.js";
import { BOOKS, SELECTED_BOOK_KEY, findBook } from "./catalog.js";
import { validateStory, replay, choose, narrativeProse } from "./engine.js";
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
  settings = { theme: "system", size: 20 },
  loadFailed = false,
  journalSeen = new Set(),
  journalSources = new Set(),
  journalObserver;
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
const query = new URLSearchParams(location.search);
let selectedBook = findBook(query.get("story"));
try {
  selectedBook ||= findBook(storage?.getItem(SELECTED_BOOK_KEY));
  selectedBook ||= BOOKS[0];
  storage?.setItem(SELECTED_BOOK_KEY, selectedBook.id);
} catch {
  selectedBook ||= BOOKS[0];
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
  { class: "brand", href: "#debut", "aria-label": "Éclats, accueil" },
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
const menuButton = action("Ouvrir le menu", "☰", openMenu);
menuButton.setAttribute("aria-haspopup", "dialog");
menuButton.setAttribute("aria-expanded", "false");
actions.append(
  menuButton,
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
const destination = el("main", { class: "destination", hidden: "" });
book.hidden = true;
footer.hidden = true;
let activeView = null,
  readingPosition,
  currentChapter;
app.replaceChildren(top, notice, live, book, destination, footer);
function openMenu() {
  const dialog = modal("Votre espace");
  dialog.classList.add("app-menu");
  menuButton.setAttribute("aria-expanded", "true");
  dialog.addEventListener("close", () =>
    menuButton.setAttribute("aria-expanded", "false"),
  );
  dialog.append(
    el("p", { class: "menu-intro" }, "Un livre, un chemin, un moment à soi."),
  );
  dialog.append(mainNavigation(() => dialog.close()));
  dialog.append(
    el(
      "div",
      { class: "menu-signature" },
      "ÉCLATS · DES HISTOIRES, VOS CHEMINS",
    ),
  );
  dialog.showModal();
}
function mainNavigation(close = () => {}) {
  const navigation = el("nav", { "aria-label": "Navigation principale" });
  for (const [id, label, description, symbol] of [
    ["bibliotheque", "Bibliothèque", "Les histoires à découvrir", "▤"],
    ["lectures", "Lectures", "Retrouver le fil de votre récit", "▥"],
    [
      "journal",
      "Journal de personnage",
      "Les personnages de votre récit",
      "◇",
    ],
    ["parametres", "Paramètres", "Votre confort de lecture", "☼"],
  ]) {
    const button = el("button", {
      class: "menu-entry",
      ...(activeView === id ? { "aria-current": "page" } : {}),
    });
    const copy = el("span");
    copy.append(
      el("span", { class: "menu-label" }, label),
      el("small", {}, description),
    );
    button.append(
      el("span", { class: "menu-symbol", "aria-hidden": "true" }, symbol),
      copy,
      el("span", { class: "menu-arrow", "aria-hidden": "true" }, "›"),
    );
    button.onclick = () => {
      close();
      // Let the native dialog restore focus before opening the destination.
      setTimeout(
        () => (id === "parametres" ? openSettings() : showDestination(id)),
        0,
      );
    };
    navigation.append(button);
  }
  return navigation;
}
brand.onclick = (event) => {
  event.preventDefault();
  showDestination("accueil");
  window.scrollTo({ top: 0, behavior: "instant" });
};
function showDestination(id) {
  if (id === activeView) return;
  if (activeView === "lectures") {
    captureJournal();
    readingPosition = position();
    save();
  }
  activeView = id;
  menuButton.hidden = id === "accueil";
  book.hidden = id !== "lectures";
  footer.hidden = book.hidden;
  destination.hidden = !book.hidden;
  actions.querySelector('[aria-label="Mes décisions"]').hidden = book.hidden;
  actions.querySelector('[aria-label="Paramètres de lecture"]').hidden =
    book.hidden;
  if (id === "lectures") {
    if (
      readingPosition?.anchor &&
      document.getElementById(readingPosition.anchor)
    )
      restorePosition(readingPosition);
    else window.scrollTo({ top: 0, behavior: "instant" });
    updateProgress();
    captureJournal();
    observeJournal();
    save();
    book.tabIndex = -1;
    book.focus({ preventScroll: true });
    return;
  }
  destination.classList.remove("home-screen");
  destination.replaceChildren(
    el("div", { class: "eyebrow" }, "Votre espace Éclats"),
  );
  const title = el(
    "h1",
    { tabindex: "-1" },
    id === "accueil"
      ? "Bienvenue dans Éclats"
      : id === "bibliotheque"
        ? "Bibliothèque"
        : id === "histoire"
          ? selectedBook.title
          : "Journal de personnage",
  );
  destination.append(title);
  if (id === "accueil") {
    destination.classList.add("home-screen");
    title.replaceChildren(
      document.createTextNode("Bienvenue dans "),
      el("em", {}, "Éclats"),
    );
    const navigation = mainNavigation();
    const motifs = [
      [
        [
          "path",
          {
            d: "M18 35Q58 20 98 42V126Q58 104 18 119ZM98 42Q138 20 178 35V119Q138 104 98 126Z",
            fill: "none",
            stroke: "currentColor",
            "stroke-width": "1.8",
          },
        ],
        [
          "path",
          {
            d: "M29 49Q58 39 87 51M29 61Q58 51 87 63M29 73Q58 63 87 75M109 51Q139 39 167 49M109 63Q139 51 167 61M109 75Q139 63 167 73M98 42V126",
            fill: "none",
            stroke: "currentColor",
            "stroke-width": "1",
            opacity: ".55",
          },
        ],
        [
          "path",
          {
            d: "M150 10L153 18L161 21L153 24L150 32L147 24L139 21L147 18Z",
            fill: "currentColor",
          },
        ],
      ],
      [
        [
          "circle",
          {
            cx: "100",
            cy: "72",
            r: "44",
            fill: "none",
            stroke: "currentColor",
            "stroke-width": "1",
          },
        ],
        [
          "path",
          {
            d: "M113 32A43 43 0 1 0 138 99A40 40 0 0 1 113 32Z",
            fill: "currentColor",
            opacity: ".5",
          },
        ],
        [
          "path",
          {
            d: "M52 26L55 35L64 38L55 41L52 50L49 41L40 38L49 35ZM155 69L157 75L163 77L157 79L155 85L153 79L147 77L153 75Z",
            fill: "currentColor",
          },
        ],
      ],
      [
        [
          "path",
          {
            d: "M58 115L76 70Q97 28 151 24Q146 78 104 94L58 115ZM58 115L130 44M76 70L87 87L104 94",
            fill: "none",
            stroke: "currentColor",
            "stroke-width": "1.5",
          },
        ],
        [
          "path",
          {
            d: "M44 127H149M44 133H116",
            stroke: "currentColor",
            opacity: ".4",
          },
        ],
      ],
      [
        [
          "circle",
          {
            cx: "100",
            cy: "76",
            r: "27",
            fill: "none",
            stroke: "currentColor",
            "stroke-width": "1.5",
          },
        ],
        [
          "path",
          {
            d: "M100 35V23M100 117V129M59 76H47M141 76H153M71 47L63 39M129 105L137 113M129 47L137 39M71 105L63 113",
            stroke: "currentColor",
            "stroke-width": "1.5",
          },
        ],
      ],
    ];
    [...navigation.children].forEach((button, index) => {
      button.dataset.section = ["library", "reading", "journal", "settings"][
        index
      ];
      const label = el(
        "span",
        { class: "card-caption", "aria-hidden": "true" },
        ["01 · EXPLORER", "02 · S’ÉVADER", "03 · IMAGINER", "04 · S’INSTALLER"][
          index
        ],
      );
      button.prepend(label);
      button.querySelector(".menu-symbol").remove();
      const artwork = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      artwork.setAttribute("viewBox", "0 0 196 150");
      artwork.setAttribute("class", "card-art");
      artwork.setAttribute("aria-hidden", "true");
      for (const [tag, attrs] of motifs[index]) {
        const shape = document.createElementNS(
          "http://www.w3.org/2000/svg",
          tag,
        );
        for (const [name, value] of Object.entries(attrs))
          shape.setAttribute(name, value);
        artwork.append(shape);
      }
      button.append(artwork);
    });
    destination.append(
      el(
        "p",
        { class: "destination-intro" },
        "Des histoires à découvrir. Des chemins à choisir.",
      ),
      navigation,
      el(
        "p",
        { class: "home-footnote" },
        "✧  Chaque histoire commence par une porte entrouverte.",
      ),
    );
  } else if (id === "bibliotheque") {
    destination.append(
      el(
        "p",
        { class: "destination-intro" },
        "Des histoires à habiter, à votre rythme.",
      ),
    );
    for (const entry of BOOKS) {
      const card = el("article", { class: "book-card" });
      const cover = el("div", { class: "book-cover", "aria-hidden": "true" });
      cover.append(
        el("span", {}, "É C L A T S"),
        el("strong", {}, entry.cover),
        el("span", {}, "✧"),
      );
      const details = el("div", { class: "book-details" });
      const resume = el(
        "button",
        {
          class: "primary",
          "aria-label": `Voir les chapitres : ${entry.title}`,
        },
        "Voir les chapitres",
      );
      const bookUrl = new URL(location.href);
      bookUrl.searchParams.set("story", entry.id);
      bookUrl.searchParams.delete("read");
      bookUrl.hash = "chapitres";
      const openBook = () => {
        if (entry.id === selectedBook.id) showDestination("histoire");
        else {
          save();
          location.assign(bookUrl.href);
        }
      };
      resume.onclick = openBook;
      const titleLink = el(
        "a",
        { href: bookUrl.href, class: "book-title-link" },
        entry.title,
      );
      titleLink.onclick = (event) => {
        event.preventDefault();
        openBook();
      };
      const bookTitle = el("h2");
      bookTitle.append(titleLink);
      details.append(
        el("div", { class: "eyebrow" }, entry.label),
        bookTitle,
        el("p", {}, entry.description),
        resume,
      );
      card.append(cover, details);
      destination.append(card);
    }
  } else if (id === "histoire") {
    renderChapterList();
  } else {
    renderJournal();
  }
  window.scrollTo({ top: 0, behavior: "instant" });
  title.focus({ preventScroll: true });
}
function visibleJournalSource(node) {
  if (activeView !== "lectures" || book.hidden || !node.isConnected) return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > top.offsetHeight && rect.top < innerHeight;
}
function captureJournal() {
  if (activeView !== "lectures" || !story) return;
  for (const node of book.querySelectorAll("[data-anchor]"))
    if (journalSources.has(node.id) && visibleJournalSource(node)) journalSeen.add(node.id);
}
function observeJournal() {
  journalObserver?.disconnect();
  if (!story || !("IntersectionObserver" in window)) return;
  journalObserver ||= new IntersectionObserver((entries) => {
    let changed = false;
    for (const entry of entries) {
      if (!entry.isIntersecting || !visibleJournalSource(entry.target)) continue;
      if (!journalSeen.has(entry.target.id)) {
        journalSeen.add(entry.target.id);
        changed = true;
      }
      journalObserver.unobserve(entry.target);
    }
    if (changed) save();
  }, { rootMargin: `-${top.offsetHeight}px 0px 0px 0px` });
  for (const node of book.querySelectorAll("[data-anchor]"))
    if (journalSources.has(node.id) && !journalSeen.has(node.id)) journalObserver.observe(node);
}
function refreshJournal() {
  if (activeView !== "journal") return;
  activeView = null;
  showDestination("journal");
}
let journalRenderVersion = 0;
async function renderJournal() {
  const version = ++journalRenderVersion;
  if (!story || !state) {
    destination.append(el("p", { role: "status" }, loadFailed
      ? "Le journal n’a pas pu être chargé. Vérifiez votre connexion puis réessayez."
      : "Chargement du journal…"));
    if (loadFailed) {
      const retry = el("button", { class: "primary" }, "Réessayer");
      retry.onclick = () => location.reload();
      destination.append(retry);
    }
    return;
  }
  const currentStory = story;
  const groups = await Promise.all(BOOKS.map(async (entry) => {
    if (entry.id === currentStory.id) return { story: currentStory, characters: knownCharacters(story, state, journalSeen) };
    try {
      if (!storage?.getItem(`eclats.reading.v1:${entry.id}`)) return null;
      const response = await fetch(`${import.meta.env.BASE_URL}stories/${entry.file}`);
      if (!response.ok) throw Error();
      const other = validateStory(await response.json());
      const saved = readSave(storage, other);
      const reading = replay(other, saved?.decisions || []);
      return { story: other, characters: knownCharacters(other, reading, migrateDiscoveries(other, reading, saved)) };
    } catch { return null; }
  }));
  if (activeView !== "journal" || story !== currentStory || version !== journalRenderVersion) return;
  const characters = groups.filter(Boolean).flatMap((group) => group.characters.map((c) => ({ ...c, book: group.story })));

  destination.append(
    el("p", { class: "destination-intro" }, "Les visages de votre voyage. Les fiches se complètent avec les passages que vous découvrez."),
    el("p", { class: "journal-count" }, `${characters.length} fiche${characters.length > 1 ? "s" : ""} connue${characters.length > 1 ? "s" : ""}`),
  );
  if (!characters.length) {
    destination.append(
      el("h2", {}, "Vos rencontres commencent ici"),
      el("p", {}, "Lisez l’histoire pour découvrir les premières fiches. Aucun personnage à venir n’est affiché."),
    );
    const read = el("button", { class: "primary" }, "Reprendre ma lecture");
    read.onclick = () => showDestination("lectures");
    destination.append(read);
    return;
  }
  const tools = el("div", { class: "journal-tools" });
  const label = el("label", { for: "journal-search" }, "Rechercher un personnage connu");
  const search = el("input", { type: "search", id: "journal-search", placeholder: "Nom, métier, faction…" });
  const filterLabel = el("label", { for: "journal-filter" }, "Afficher");
  const filter = el("select", { id: "journal-filter" });
  filter.append(el("option", { value: "all" }, "Toutes les fiches"));
  for (const [kind, name] of [["person", "Personnages"], ["companion", "Compagnons"], ["animal", "Animaux rencontrés"], ["entity", "Entités"]])
    if (characters.some((c) => c.kind === kind)) filter.append(el("option", { value: kind }, name));
  tools.append(label, search, filterLabel, filter);
  const list = el("div", { class: "journal-stories" });
  const count = el("p", { class: "journal-results", role: "status" });
  const normalize = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
  function paint() {
    const query = normalize(search.value.trim());
    const found = characters.filter((c) => (filter.value === "all" || c.kind === filter.value)
      && normalize([c.name, ...Object.values(c.fields)].join(" ")).includes(query));
    list.replaceChildren();
    count.textContent = found.length ? `${found.length} fiche${found.length > 1 ? "s" : ""}` : "Aucune fiche connue ne correspond à cette recherche.";
    for (const group of groups.filter(Boolean)) {
      const matches = found.filter((c) => c.book.id === group.story.id);
      if (!matches.length) continue;
      const section = el("section", { class: "journal-story", "aria-label": group.story.title });
      section.append(el("h2", {}, group.story.title));
      const grid = el("div", { class: "journal-grid" });
      section.append(grid);
      list.append(section);
      for (const character of matches) {
        const button = el("button", { class: "character-card", "aria-label": `Voir la fiche de ${character.name}` });
        button.append(
          character.portrait
            ? el("img", { class: "character-portrait", src: `${import.meta.env.BASE_URL}${character.portrait.src}`, alt: "", loading: "lazy" })
            : el("span", { class: "character-initial", "aria-hidden": "true" }, character.name[0]),
          el("strong", {}, character.name),
          el("span", { class: "character-role" }, character.fields.occupation || character.fields.race || (character.kind === "companion" ? "Compagnon" : "Rencontre du récit")),
        );
        button.onclick = () => openCharacter(character);
        grid.append(button);
      }
    }
  }
  search.oninput = paint;
  filter.onchange = paint;
  paint();
  destination.append(tools, count, list);
}
function openCharacter(character) {
  const dialog = modal(character.name);
  dialog.classList.add("character-sheet");
  dialog.append(el("p", { class: "eyebrow" }, character.book.title));
  if (character.portrait) dialog.append(el("img", { class: "character-sheet-portrait", src: `${import.meta.env.BASE_URL}${character.portrait.src}`, alt: `Portrait de ${character.name}` }));
  const identity = el("dl", { class: "character-identity" });
  for (const [field, label] of [["age", "Âge"], ["occupation", "Métier / rôle"], ["race", "Race / nature"], ["class", "Classe"], ["affiliation", "Affiliation"]]) {
    if (field !== "age" && !character.fields[field]) continue;
    identity.append(el("dt", {}, label), el("dd", {}, character.fields[field] || "Non précisé à ce stade"));
  }
  dialog.append(identity);
  const groups = [
    ["Repères", (key) => ["appearance", "equipment", "size", "personality", "status"].includes(key)],
    ["Pouvoirs connus", (key) => key.startsWith("magic-")],
    ["Liens connus", (key) => key === "relation" || key.startsWith("link-")],
    ["Histoire connue", (key) => key === "history" || key.startsWith("history-")],
  ];
  for (const [label, includes] of groups) {
    const facts = Object.entries(character.fields).filter(([key]) => includes(key));
    if (!facts.length) continue;
    const section = el("section", { class: "character-facts" });
    section.append(el("h3", {}, label));
    const list = el("ul");
    for (const [, text] of facts) list.append(el("li", {}, text));
    section.append(list);
    dialog.append(section);
  }
  const chapter = character.book.chapters.find((c) => c.id === character.chapter);
  dialog.append(el("p", { class: "character-source" }, `Première découverte : chapitre ${chapter.number} · ${chapter.title}`));
  const revisit = el("button", { class: "text-button" }, "Relire la première rencontre");
  revisit.onclick = () => {
    dialog.close();
    if (character.book.id !== story.id) {
      save();
      const url = new URL(location.href);
      url.search = new URLSearchParams({ story: character.book.id, read: "1", encounter: character.id });
      url.hash = "";
      location.assign(url.href);
      return;
    }
    openChapter(character.chapter);
    const node = document.getElementById(sourceAnchor(character.firstSource));
    node?.scrollIntoView({ block: "center", behavior: "instant" });
    node?.focus({ preventScroll: true });
    save();
  };
  dialog.append(revisit);
  dialog.showModal();
}
function renderChapterList() {
  const back = el("button", { class: "text-button" }, "← Bibliothèque");
  back.onclick = () => showDestination("bibliotheque");
  destination.append(back);
  if (!story || !state) {
    destination.append(
      el(
        "p",
        { role: "status" },
        loadFailed
          ? "Le livre n’a pas pu être chargé. Vérifiez votre connexion."
          : "Chargement des chapitres…",
      ),
    );
    if (loadFailed) {
      const retry = el("button", { class: "primary" }, "Réessayer");
      retry.onclick = () => location.reload();
      destination.append(retry);
    }
    return;
  }
  const chapters = chapterProgress(story, state);
  const candidate =
    readingPosition?.chapter || restore?.chapter || chapters[0].id;
  const current = chapters.some((c) => c.id === candidate && c.unlocked)
    ? candidate
    : chapters.filter((c) => c.unlocked).at(-1)?.id;
  const introduction = el("div", { class: "story-summary" });
  introduction.append(
    el(
      "span",
      { class: "eyebrow" },
      `${chapters.length} chapitres · ${chapters.filter((c) => c.unlocked).length} accessible${chapters.filter((c) => c.unlocked).length > 1 ? "s" : ""}`,
    ),
    el("p", {}, selectedBook.description),
  );
  const resume = el(
    "button",
    { class: "primary" },
    restore || readingPosition || state.decisions.length
      ? "Reprendre ma lecture"
      : "Commencer la lecture",
  );
  resume.onclick = () => showDestination("lectures");
  introduction.append(resume);
  destination.append(
    introduction,
    el("h2", { class: "contents-title", id: "chapitres" }, "Les chapitres"),
    el(
      "p",
      { class: "contents-note" },
      "Les chapitres se débloquent au fil du récit. Vous pouvez revenir à un chapitre accessible sans modifier vos décisions.",
    ),
  );
  const list = el("ol", {
    class: "chapter-list",
    "aria-labelledby": "chapitres",
  });
  for (const chapter of chapters) {
    const row = el("li");
    const status = chapter.unlocked
      ? chapter.id === current
        ? "En cours"
        : "Accessible"
      : "Inaccessible";
    const button = el("button", {
      class: "chapter-link",
      "data-chapter-id": chapter.id,
      ...(chapter.unlocked
        ? {
            "aria-label": `Lire le chapitre ${chapter.number} : ${chapter.title}`,
          }
        : {
            disabled: "",
            "aria-label": `Chapitre ${chapter.number} : ${chapter.title} — Inaccessible`,
          }),
    });
    const copy = el("span", { class: "chapter-copy" });
    copy.append(
      el("span", { class: "chapter-name" }, chapter.title),
      el("span", { class: "chapter-status" }, status),
    );
    const indicator = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    for (const [name, value] of Object.entries({
      viewBox: "0 0 24 24",
      width: "22",
      height: "22",
      class: "chapter-indicator",
      "aria-hidden": "true",
      focusable: "false",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }))
      indicator.setAttribute(name, value);
    const iconPath = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    iconPath.setAttribute(
      "d",
      chapter.unlocked
        ? "M7 17 17 7M7 7h10v10"
        : "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z",
    );
    indicator.append(iconPath);
    button.append(
      el(
        "span",
        { class: "chapter-number", "aria-hidden": "true" },
        String(chapter.number).padStart(2, "0"),
      ),
      copy,
      indicator,
    );
    button.onclick = () => openChapter(chapter.id);
    row.append(button);
    list.append(row);
  }
  destination.append(list);
}
function openChapter(id) {
  if (!story || !state) return;
  const sceneId = chapterScene(story, state, id);
  if (!sceneId) return;
  save();
  currentChapter = id;
  render();
  showDestination("lectures");
  window.scrollTo({ top: 0, behavior: "instant" });
  const heading = book.querySelector(".chapter-heading");
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  readingPosition = position();
  save();
  updateProgress();
}
function refreshChapterList() {
  if (activeView !== "histoire") return;
  activeView = null;
  showDestination("histoire");
}
function storageError() {
  notice.textContent =
    "La sauvegarde locale est indisponible. Vous pouvez continuer à lire, mais votre progression risque de ne pas être conservée après fermeture.";
  saveState.textContent = "Progression non enregistrée";
}
if (!storage) storageError();
function position() {
  if (book.hidden && readingPosition) return readingPosition;
  const paragraphs = [...book.querySelectorAll("[data-anchor]")];
  const current =
    paragraphs.find(
      (p) =>
        p.getBoundingClientRect().bottom >
        top.getBoundingClientRect().bottom + 8,
    ) || paragraphs.at(-1);
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
  if (!canSave || !story || book.hidden) return;
  if (!storage) {
    storageError();
    return;
  }
  try {
    captureJournal();
    const p = position();
    writeSave(storage, story, state.decisions, p.anchor, p.offset, p.chapter, [...journalSeen]);
    saveState.textContent = "Progression enregistrée sur cet appareil";
  } catch {
    storageError();
  }
}
function restorePosition(p) {
  if (!p?.anchor || book.hidden) return;
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
  if (book.hidden) return;
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
  const page = chapterPage(story, state, currentChapter);
  currentChapter = page.chapter.id;
  book.dataset.chapter = currentChapter;
  const wanted = new Set(page.blocks.map((b) => `scene-${b.id}`));
  for (const node of book.querySelectorAll(".scene"))
    if (!wanted.has(node.id)) node.remove();
  book.querySelector(".ending")?.remove();
  book.querySelector(".chapter-navigation")?.remove();
  let lastChapter;
  let insertionPoint = book.querySelector(".book-heading");
  for (const block of page.blocks) {
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
        const recap = chapterRecap(story, state, currentChapter);
        if (recap.length) {
          const summary = el("aside", {
            class: "chapter-recap",
            "aria-label": "Résumé du chapitre précédent",
          });
          summary.append(el("h3", {}, "Précédemment"));
          for (const text of recap) summary.append(el("p", {}, text));
          heading.append(summary);
        }
        section.append(heading);
      }
      const prose = el("div", { class: "prose" });
      narrativeProse(block.scene).forEach(({ text, key }, i) => {
        prose.append(paragraph(text, `${block.id}-${key}`, animate, i));
        for (const illustration of story.illustrations?.[block.id] || []) {
          if (key !== `p${illustration.after}`) continue;
          const figure = el("figure", { class: "story-illustration" });
          const picture = el("img", {
            src: `${import.meta.env.BASE_URL}${illustration.src}`,
            alt: illustration.alt,
            width: illustration.width,
            height: illustration.height,
            loading: "lazy",
            decoding: "async",
          });
          // Keep the reserved space and readable alternative if an asset fails.
          picture.addEventListener("error", () => figure.classList.add("image-unavailable"));
          figure.append(picture);
          if (illustration.caption) figure.append(el("figcaption", {}, illustration.caption));
          prose.append(figure);
        }
      });
      section.append(prose);
      if (block.scene.cycleEnding) {
        const milestone = el("div", { class: "cycle-ending" });
        milestone.append(
          el("p", { class: "eyebrow" }, "Fin du premier cycle"),
          el("h3", {}, block.scene.cycleEnding),
        );
        section.append(milestone);
      }
      const guide = story.readingGuides?.[block.id];
      if (guide) {
        const details = el("details", { class: "reading-guide" });
        details.append(el("summary", {}, "Comprendre la scène"));
        details.append(el("h3", {}, guide.title));
        for (const text of guide.paragraphs) details.append(el("p", {}, text));
        if (guide.steps) {
          const diagram = el("ol", {
            class: "guide-diagram",
            "aria-label": guide.title,
          });
          for (const text of guide.steps) diagram.append(el("li", {}, text));
          details.append(diagram);
        }
        section.append(details);
      }
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
  if (state.ending && currentChapter === story.chapters.at(-1).id) {
    const ending = el("section", { class: "ending" });
    ending.append(
      el(
        "div",
        { class: "eyebrow" },
        story.publication?.status === "ongoing"
          ? "Fin des chapitres disponibles · À suivre"
          : "Fin du récit",
      ),
      el("h2", {}, state.ending),
      el(
        "p",
        {},
        "Chaque chemin laisse un éclat différent. Vous pouvez retrouver vos décisions dans le menu en haut de la page.",
      ),
    );
    book.append(ending);
  }
  const navigation = el("nav", {
    class: "chapter-navigation",
    "aria-label": "Navigation entre les chapitres",
  });
  if (page.previous) {
    const previous = el("button", { class: "text-button" }, "← Chapitre précédent");
    previous.onclick = () => openChapter(page.previous.id);
    navigation.append(previous);
  }
  if (page.next) {
    navigation.append(el("p", { class: "chapter-break" }, `Fin du chapitre ${page.chapter.number}`));
    const next = el("button", { class: "primary" }, "Chapitre suivant →");
    next.onclick = () => openChapter(page.next.id);
    navigation.append(next);
  }
  const contents = el("button", { class: "text-button" }, "Les chapitres");
  contents.onclick = () => showDestination("histoire");
  navigation.append(contents);
  book.append(navigation);
  observeJournal();
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
  if (activeView !== "lectures") showDestination("lectures");
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
    journalSeen = retainDiscoveries(replay(story, before), [...journalSeen]);
    state = choose(story, before, sceneId, selected.value);
    currentChapter = story.scenes[sceneId].chapter;
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
  const update = el("button", { class: "primary" }, "Mettre à jour Éclats");
  update.onclick = () => {
    save();
    location.assign(`${import.meta.env.BASE_URL}actualiser.html?auto=1`);
  };
  dialog.append(update);
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
      `${import.meta.env.BASE_URL}stories/${selectedBook.file}`,
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
    journalSources = journalAnchors(story);
    journalSeen = migrateDiscoveries(story, state, restore);
    readingPosition = restore;
    currentChapter = chapterPage(story, state, restore?.chapter).chapter.id;
    refreshChapterList();
    refreshJournal();
    if (restore && state.decisions.length !== restore.decisions.length)
      notice.textContent =
        "Les décisions incompatibles ont été retirées. Votre dernière progression valide a été conservée.";
    const heading = el("header", { class: "book-heading" });
    heading.append(
      el("div", { class: "eyebrow" }, selectedBook.label),
      el("h1", {}, story.title),
      el("p", { class: "subtitle" }, story.subtitle),
      el("div", { class: "ornament", "aria-hidden": "true" }, "✧"),
    );
    book.append(heading);
    render();
    await document.fonts.ready;
    requestAnimationFrame(() => {
      if (query.get("read") === "1") showDestination("lectures");
      else if (location.hash === "#chapitres") showDestination("histoire");
      restorePosition(restore);
      const encounter = knownCharacters(story, state, journalSeen).find((c) => c.id === query.get("encounter"));
      if (encounter) {
        openChapter(encounter.chapter);
        document.getElementById(sourceAnchor(encounter.firstSource))?.scrollIntoView({ block: "center", behavior: "instant" });
      }
      canSave = true;
      updateProgress();
      save();
    });
    if (import.meta.env.PROD && "serviceWorker" in navigator) setupOffline();
  } catch (error) {
    loadFailed = true;
    refreshChapterList();
    refreshJournal();
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
showDestination("accueil");
document.getElementById("boot-fallback")?.remove();
start();
