import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  assert.equal(story.chapters.length, 13);
  const result = audit(story);
  assert.equal(result.reached.size, Object.keys(story.scenes).length);
  assert.ok(result.paths > 30000n);
  for (let i = 0; i < 13; i++) {
    assert.ok(result.minWords[i] >= 3300, `Chapter ${i + 1} is too short`);
    assert.ok(result.maxWords[i] <= 4400, `Chapter ${i + 1} is too long`);
    assert.equal(result.minChoices[i], 5);
    assert.equal(result.maxChoices[i], 5);
  }
});

test("each interaction offers at least five available, distinct answers in every reachable state", () => {
  let checked = 0;
  audit(story, (id, scene, variables) => {
    if (!scene.choice) return;
    const edges = scene.choice.options.filter((option) => matches(option.when, variables));
    assert.ok(edges.length >= 5, `${id}: fewer than five available choices`);
    assert.equal(new Set(edges.map((o) => o.label)).size, edges.length);
    assert.equal(new Set(edges.map((o) => o.passage)).size, edges.length);
    assert.equal(new Set(edges.map((o) => story.scenes[o.next].paragraphs.join(" "))).size, edges.length);
    checked++;
  });
  assert.ok(checked >= 65);
});

test("the first published fifteen-decision save now opens chapter four without a reset", () => {
  const options = ["tam", "briser", "diva", "musique", "peur", "haut", "calme", "glace", "signal", "lassitude", "porte", "renforts", "diva", "peur", "mara"];
  const scenes = ["v2-1-1", "v2-1-2", "v2-1-3", "v2-1-5", "v2-1-6", "v2-2-1", "v2-2-2", "v2-2-3", "v2-2-5", "v2-2-6", "v2-3-1", "v2-3-2", "v2-3-3", "v2-3-5", "v2-3-6"];
  const decisions = scenes.map((scene, i) => ({ scene, option: options[i] }));
  const reading = replay(story, decisions);
  assert.equal(story.version, 1);
  assert.deepEqual(reading.decisions, decisions);
  assert.equal(reading.pending.scene, "v2-4-1");
  assert.equal(reading.ending, undefined);
  assert.deepEqual(chapterProgress(story, reading).filter((c) => c.unlocked).map((c) => c.number), [1, 2, 3, 4]);
});

test("twenty-one optimized chapter illustrations reference existing paragraphs and local WebP files", () => {
  assert.equal(Object.values(story.illustrations).flat().length, 21);
  let totalBytes = 0;
  for (const [id, pictures] of Object.entries(story.illustrations)) {
    for (const picture of pictures) {
      assert.ok(story.scenes[id].paragraphs[picture.after]);
      const bytes = readFileSync(new URL(`../public/${picture.src}`, import.meta.url));
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
      assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
      assert.ok(picture.width >= 1024);
      assert.ok(picture.height >= 768);
      assert.ok(bytes.length < 600000);
      totalBytes += bytes.length;
    }
  }
  assert.ok(totalBytes < 11000000);
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
    assert.equal(reading.decisions.length, 65);
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

test("published paragraphs, option identifiers, bookmark keys and imported chapters stay intact", () => {
  const published = JSON.parse(readFileSync(new URL("./fixtures/second-version-first-release.json", import.meta.url)));
  for (const [id, scene] of Object.entries(published.scenes)) {
    const before = structuredClone(scene), after = structuredClone(story.scenes[id]);
    if (id === "v2-3-7") {
      delete before.ending; delete after.next;
      assert.equal(story.scenes[id].next, "v2-4-1");
    }
    assert.deepEqual(after, before, id);
  }
  assert.deepEqual(story.chapters.slice(0, 3), published.chapters);
  for (const [id, images] of Object.entries(published.illustrations)) assert.deepEqual(story.illustrations[id], images);
  for (const character of published.characters) assert.deepEqual(story.characters.find((c) => c.id === character.id), character);
  const hashes = JSON.parse(readFileSync(new URL("./fixtures/second-version-imported-hashes.json", import.meta.url)));
  const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
  for (let n = 4; n <= 7; n++) {
    const scenes = structuredClone(Object.fromEntries(Object.entries(story.scenes).filter(([, s]) => s.chapter === `v2c${n}`)));
    if (n === 7) delete scenes["v2-7-7"].next;
    assert.equal(createHash("sha256").update(JSON.stringify(canonical(scenes))).digest("hex"), hashes[n], `Imported chapter ${n}`);
  }
});

function follow(overrides = {}, count = 65) {
  let reading = replay(story);
  while (reading.pending && reading.decisions.length < count) {
    const p = reading.pending, key = overrides[p.scene] || p.options[0].id;
    reading = choose(story, reading.decisions, p.scene, key);
  }
  return reading;
}

test("delayed choices change the actual path two to four chapters later", () => {
  const pairs = [
    ["v2-4-1", "cordage", "linge", "v2-6-2-echo"],
    ["v2-5-3", "franchise", "humour", "v2-9-nina"],
    ["v2-6-6", "trajet", "treuil", "v2-8-echo"],
    ["v2-7-6", "lanternes", "linge", "v2-10-berthe"],
    ["v2-8-5", "bache", "chariot", "v2-9-sortie"],
    ["v2-10-5", "concert", "outils", "v2-11-entree"],
    ["v2-11-5", "cales", "animaux", "v2-12-secours"],
    ["v2-12-5", "registre", "selie", "v2-13-preuve"],
  ];
  for (const [scene, a, b, echo] of pairs) {
    const left = follow({ [scene]: a }), right = follow({ [scene]: b });
    for (const r of [left, right]) { assert.equal(r.decisions.length, 65); assert.ok(r.ending); }
    const tail = (r) => r.blocks.filter((x) => x.id.startsWith(echo + "-")).map((x) => x.scene.paragraphs).flat();
    assert.ok(tail(left).length, echo);
    assert.ok(tail(right).length, echo);
    assert.notDeepEqual(tail(left), tail(right), echo);
    const changed = left.decisions.findIndex((d) => d.scene === scene);
    assert.ok(changed >= 0);
    assert.deepEqual(left.decisions.slice(0, changed), right.decisions.slice(0, changed));
  }
});

test("all five personal conclusions resolve the arc and survive a version-one save round trip", () => {
  const storage = new Map(), adapter = { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) };
  for (const option of story.scenes["v2-13-5"].choice.options) {
    const reading = follow({ "v2-13-5": option.id });
    assert.equal(reading.decisions.length, 65);
    assert.ok(reading.blocks.some((b) => b.id === option.next));
    assert.equal(reading.ending, "Un morceau pour rentrer — fin de cet arc");
    const anchor = `${option.next}-p0`;
    writeSave(adapter, story, reading.decisions, anchor, 17, "v2c13", [anchor]);
    const saved = readSave(adapter, story);
    assert.deepEqual(saved.decisions, reading.decisions);
    assert.equal(saved.anchor, anchor);
    assert.equal(replay(story, saved.decisions).ending, reading.ending);
  }
});

test("a rewind removes future chapters and their journal revelations", () => {
  const complete = follow();
  const seen = retainDiscoveries(complete, [...journalAnchors(story)]);
  const known = knownCharacters(story, complete, seen);
  for (const name of ["Nina", "Berthe", "Oren", "Veyre", "Sélie", "Luan"]) assert.ok(known.some((c) => c.fields.name === name), name);
  const revised = replay(story, complete.decisions.slice(0, 20));
  const retained = retainDiscoveries(revised, [...seen]);
  const after = knownCharacters(story, revised, retained);
  assert.ok(!after.some((c) => ["nina", "berthe", "oren", "veyre", "selie", "luan"].includes(c.id)));
  assert.ok(!chapterProgress(story, revised).find((c) => c.number === 6).unlocked);
  assert.deepEqual(chapterRecap(story, revised, "v2c13"), []);
});
