import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateStory, replay, choose, matches } from "../src/engine.js";
import { chapterProgress, chapterRecap } from "../src/chapters.js";
import { saveKey, writeSave, readSave } from "../src/storage.js";
import { knownCharacters, journalAnchors, retainDiscoveries } from "../src/journal.js";
import { audit } from "./helpers/story-audit.js";
import { BOOKS } from "../src/catalog.js";

const load = (file) => JSON.parse(readFileSync(new URL(`../public/stories/${file}`, import.meta.url), "utf8"));
const story = load("evan-deuxieme-version.json");
const original = load("accords-du-crepuscule.json");

test("every second-version path keeps the reading minimum and five decisions per chapter", () => {
  validateStory(story);
  assert.equal(story.chapters.length, 3);
  const result = audit(story);
  assert.equal(result.reached.size, Object.keys(story.scenes).length);
  assert.ok(result.paths > 30000n);
  for (let i = 0; i < 3; i++) {
    assert.ok(result.minWords[i] >= 3300, `Chapter ${i + 1} is too short`);
    assert.ok(result.maxWords[i] <= 4400, `Chapter ${i + 1} is too long`);
    assert.equal(result.minChoices[i], 5);
    assert.equal(result.maxChoices[i], 5);
  }
});

test("each interaction offers at least five available, distinct answers in every reachable state", () => {
  const conditionKeys = new Set();
  for (const scene of Object.values(story.scenes)) {
    for (const edge of [...(scene.routes || []), ...(scene.choice?.options || [])]) {
      Object.keys(edge.when || {}).forEach((key) => conditionKeys.add(key));
    }
  }
  const visited = new Set();
  function visit(id, variables) {
    const key = JSON.stringify([id, [...conditionKeys].sort().map((k) => [k, variables[k]])]);
    if (visited.has(key)) return;
    visited.add(key);
    const scene = story.scenes[id];
    let edges = [];
    if (scene.choice) {
      edges = scene.choice.options.filter((option) => matches(option.when, variables));
      assert.ok(edges.length >= 5, `${id}: fewer than five available choices`);
      assert.equal(new Set(edges.map((o) => o.label)).size, edges.length);
      assert.equal(new Set(edges.map((o) => o.passage)).size, edges.length);
      assert.equal(new Set(edges.map((o) => story.scenes[o.next].paragraphs.join(" "))).size, edges.length);
    } else if (scene.routes) edges = [scene.routes.find((route) => matches(route.when, variables))];
    else if (scene.next) edges = [{ next: scene.next }];
    for (const edge of edges) visit(edge.next, { ...variables, ...edge.set });
  }
  visit(story.chapters[0].start, { ...story.variables });
  assert.ok(visited.size >= Object.keys(story.scenes).length);
});

test("the first published fifteen-decision save still reaches its ending without a reset", () => {
  const options = ["tam", "briser", "diva", "musique", "peur", "haut", "calme", "glace", "signal", "lassitude", "porte", "renforts", "diva", "peur", "mara"];
  const scenes = ["v2-1-1", "v2-1-2", "v2-1-3", "v2-1-5", "v2-1-6", "v2-2-1", "v2-2-2", "v2-2-3", "v2-2-5", "v2-2-6", "v2-3-1", "v2-3-2", "v2-3-3", "v2-3-5", "v2-3-6"];
  const decisions = scenes.map((scene, i) => ({ scene, option: options[i] }));
  const reading = replay(story, decisions);
  assert.equal(story.version, 1);
  assert.deepEqual(reading.decisions, decisions);
  assert.ok(reading.ending);
});

test("three optimized chapter illustrations reference existing paragraphs and local WebP files", () => {
  assert.equal(Object.keys(story.illustrations).length, 3);
  let totalBytes = 0;
  for (const [id, pictures] of Object.entries(story.illustrations)) {
    for (const picture of pictures) {
      assert.ok(story.scenes[id].paragraphs[picture.after]);
      const bytes = readFileSync(new URL(`../public/${picture.src}`, import.meta.url));
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
      assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
      assert.equal(picture.width, 1536);
      assert.equal(picture.height, 1024);
      assert.ok(bytes.length < 600000);
      totalBytes += bytes.length;
    }
  }
  assert.ok(totalBytes < 1500000);
});

test("published catalogue entries are loadable and each has an independent save", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.notEqual(saveKey(story), saveKey(original));
  for (const entry of BOOKS) assert.equal(validateStory(load(entry.file)).id, entry.id);
  const oldDecision = replay(original).pending;
  const old = choose(original, [], oldDecision.scene, oldDecision.options[0].id);
  writeSave(storage, original, old.decisions, "c1-rue-p0", 0, "c1");
  const before = values.get(saveKey(original));
  const first = replay(story).pending;
  const reading = choose(story, [], first.scene, first.options[0].id);
  writeSave(storage, story, reading.decisions, "v2-1-1-p0", 0, "v2c1");
  assert.equal(values.get(saveKey(original)), before);
  assert.deepEqual(readSave(storage, story).decisions, reading.decisions);
  assert.deepEqual(readSave(storage, original).decisions, old.decisions);
});

test("conditional routes, chapter access and a revision use only the accepted choices", () => {
  for (const index of [0, 1, 2]) {
    let reading = replay(story);
    while (reading.pending) {
      const pending = reading.pending;
      reading = choose(story, reading.decisions, pending.scene, pending.options[index % pending.options.length].id);
    }
    assert.equal(reading.decisions.length, 15);
    assert.ok(reading.ending);
    assert.ok(chapterProgress(story, reading).every((c) => c.unlocked));
    const signalScene = reading.variables.fusee ? "v2-renforts-piste" : "v2-renforts-prevenus";
    assert.ok(reading.blocks.some((b) => b.id === signalScene));
    for (const chapter of story.chapters.slice(1)) assert.ok(chapterRecap(story, reading, chapter.id).length);
    const revised = replay(story, [{ scene: "v2-1-1", option: "diva" }, ...reading.decisions.slice(1, 2)]);
    assert.equal(chapterProgress(story, revised).filter((c) => c.unlocked).length, 1);
    assert.deepEqual(chapterRecap(story, revised, "v2c2"), []);
  }
  let reading = replay(story);
  reading = choose(story, [], reading.pending.scene, "tam");
  reading = choose(story, reading.decisions, reading.pending.scene, "briser");
  while (reading.pending.scene !== "v2-2-3") {
    reading = choose(story, reading.decisions, reading.pending.scene, reading.pending.options[0].id);
  }
  assert.ok(!reading.pending.options.some((o) => o.id === "collier"));
});

test("the new character journal reveals only authored, encountered sources and survives a rewind", () => {
  for (const character of story.characters) {
    assert.ok(character.facts.some((f) => f.field === "name"));
    for (const fact of character.facts) {
      const paragraph = story.scenes[fact.source.scene]?.paragraphs[fact.source.paragraph];
      assert.equal(typeof paragraph, "string");
      if (fact.field === "name") assert.ok(paragraph.includes(fact.value));
    }
  }
  const fresh = replay(story);
  assert.deepEqual(knownCharacters(story, fresh, new Set()), []);
  const seen = retainDiscoveries(fresh, [...journalAnchors(story)]);
  assert.deepEqual(knownCharacters(story, fresh, seen).map((c) => c.id), ["evan", "diva", "tam-tam"]);
  assert.ok(!knownCharacters(story, fresh, seen).some((c) => c.id === "mara" || c.id === "lio"));
});
