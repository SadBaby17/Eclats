import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateStory, replay, choose } from "../src/engine.js";
import { readSave, writeSave, saveKey } from "../src/storage.js";
const story = JSON.parse(
  readFileSync(new URL("./fixtures/branching-story.json", import.meta.url)),
);
test("all reachable paths terminate, both branch pairs rejoin, and both endings are reachable", () => {
  validateStory(story);
  const endings = new Set(),
    scenes = new Set();
  let count = 0;
  function explore(decisions) {
    const r = replay(story, decisions);
    r.blocks.forEach((b) => scenes.add(b.id));
    if (r.ending) {
      endings.add(r.ending);
      count++;
      assert.ok(r.blocks.some((b) => b.id === "seuil"));
      assert.ok(r.blocks.some((b) => b.id === "table"));
      return;
    }
    for (const option of r.pending.options)
      explore(choose(story, decisions, r.pending.scene, option.id).decisions);
  }
  explore([]);
  assert.equal(count, 8);
  assert.equal(endings.size, 2);
  assert.equal(scenes.size, Object.keys(story.scenes).length);
});
test("choices unlock full scenes and preserve authored narrative", () => {
  const r = choose(story, [], "arrivee", "port");
  assert.equal(
    r.blocks[0].selected.passage,
    story.scenes.arrivee.choice.options[0].passage,
  );
  assert.ok(
    r.blocks.find((b) => b.id === "jeanne").scene.paragraphs.length >= 3,
  );
  assert.equal(r.pending.scene, "seuil");
  assert.equal(r.variables.confiance, true);
});
test("rewind recomputes variables and invalidates all subsequent decisions", () => {
  let r = choose(story, [], "arrivee", "jardin");
  r = choose(story, r.decisions, "seuil", "veille");
  r = choose(story, r.decisions, "armoire", "ensemble");
  assert.ok(r.ending);
  assert.equal(r.variables.cle, true);
  const revised = choose(story, r.decisions.slice(0, 0), "arrivee", "port");
  assert.equal(revised.decisions.length, 1);
  assert.equal(revised.variables.cle, false);
  assert.equal(revised.variables.confiance, true);
  assert.ok(
    !revised.blocks.some((b) => b.id === "jardin" || b.id === "armoire"),
  );
  assert.equal(revised.pending.scene, "seuil");
});
test("invalid and stale decisions cannot skip a scene or unlock an unavailable answer", () => {
  assert.throws(() => choose(story, [], "arrivee", "invented"));
  assert.throws(() => choose(story, [], "seuil", "veille"));
  assert.equal(
    replay(story, [{ scene: "seuil", option: "veille" }]).decisions.length,
    0,
  );
  const edited = structuredClone(story);
  edited.scenes.arrivee.choice.options[0].when = { cle: true };
  assert.throws(() => choose(edited, [], "arrivee", "port"));
});
test("validation rejects missing targets, duplicate options, and absent fallback", () => {
  const edited = structuredClone(story);
  edited.scenes.jeanne.next = "missing";
  assert.throws(() => validateStory(edited));
  const duplicate = structuredClone(story);
  duplicate.scenes.arrivee.choice.options[1].id = "port";
  assert.throws(() => validateStory(duplicate));
  const routes = structuredClone(story);
  routes.scenes.table.routes.pop();
  assert.throws(() => validateStory(routes));
});
test("cycles fail explicitly instead of hanging", () => {
  const edited = structuredClone(story);
  edited.scenes.jeanne.next = "jeanne";
  assert.throws(() => choose(edited, [], "arrivee", "port"), /Boucle/);
});
function memory() {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
  };
}
test("save round trip retains decisions, chapter, anchor, and offset", () => {
  const storage = memory(),
    decisions = choose(story, [], "arrivee", "port").decisions;
  writeSave(storage, story, decisions, "jeanne-p2", 65, "ch1");
  const s = readSave(storage, story);
  assert.deepEqual(s.decisions, decisions);
  assert.equal(s.chapter, "ch1");
  assert.equal(s.anchor, "jeanne-p2");
  assert.equal(s.offset, 65);
  assert.deepEqual(replay(story, s.decisions), replay(story, decisions));
});
test("corrupt and incompatible saves are detected; unavailable storage errors propagate", () => {
  const storage = memory();
  storage.setItem(saveKey(story), "{");
  assert.throws(() => readSave(storage, story));
  writeSave(storage, { ...story, version: 99 }, [], null, 0, "ch1");
  assert.throws(() => readSave(storage, story));
  assert.throws(() =>
    writeSave(
      {
        setItem() {
          throw Error("quota");
        },
      },
      story,
      [],
      null,
      0,
      "ch1",
    ),
  );
});

test("changing a middle decision retains its prefix but replaces the complete future", () => {
  let r = choose(story, [], "arrivee", "jardin");
  r = choose(story, r.decisions, "seuil", "veille");
  r = choose(story, r.decisions, "armoire", "ensemble");
  const revised = choose(story, r.decisions.slice(0, 1), "seuil", "lettres");
  assert.deepEqual(revised.decisions, [
    { scene: "arrivee", option: "jardin" },
    { scene: "seuil", option: "lettres" },
  ]);
  assert.ok(revised.blocks.some((b) => b.id === "lettres"));
  assert.ok(
    !revised.blocks.some((b) => b.id === "veille" || b.id === "fin-partage"),
  );
  assert.equal(revised.pending.scene, "armoire");
});

test("scene links can continue across chapters without resetting the decisions", () => {
  const book = structuredClone(story);
  book.chapters.push({
    id: "ch2",
    number: 2,
    title: "Le lendemain",
    start: "table",
  });
  for (const id of [
    "table",
    "armoire",
    "invitation",
    "fin-partage",
    "fin-calme",
  ])
    book.scenes[id].chapter = "ch2";
  validateStory(book);
  let r = choose(book, [], "arrivee", "port");
  r = choose(book, r.decisions, "seuil", "lettres");
  assert.equal(r.blocks.find((b) => b.id === "table").scene.chapter, "ch2");
  assert.equal(r.decisions.length, 2);
});

test("expanded prose keeps original paragraph keys and rejects invalid insertion positions", async () => {
  const { narrativeProse } = await import("../src/engine.js");
  const scene = { paragraphs: ["Avant", "Choisir"], insertions: [
    { before: 1, paragraphs: ["Une vraie scène ajoutée.", "La suite."] },
    { before: 2, paragraphs: ["Après."] },
  ] };
  assert.deepEqual(narrativeProse(scene).map((p) => p.text), ["Avant", "Une vraie scène ajoutée.", "La suite.", "Choisir", "Après."]);
  assert.deepEqual(narrativeProse(scene).map((p) => p.key), ["p0", "e0-p0", "e0-p1", "p1", "e1-p0"]);
  const story = { format: 1, id: "test", version: 1, chapters: [{ id: "c", start: "s" }], scenes: { s: { chapter: "c", paragraphs: [], ending: "Fin", insertions: [{ before: 1, paragraphs: ["Invalid"] }] } } };
  assert.throws(() => validateStory(story), /Passage ajouté invalide/u);
});
