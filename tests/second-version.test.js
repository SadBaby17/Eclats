import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateStory, replay, choose } from "../src/engine.js";
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
