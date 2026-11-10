import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateStory, replay, choose, matches } from "../src/engine.js";
import { audit } from "./helpers/story-audit.js";
import { chapterProgress, chapterRecap } from "../src/chapters.js";
import { journalAnchors, retainDiscoveries, knownCharacters } from "../src/journal.js";
import { saveKey, readSave, writeSave } from "../src/storage.js";
import { BOOKS } from "../src/catalog.js";
const load = (file) => JSON.parse(readFileSync(new URL(`../public/stories/${file}`, import.meta.url)));
const story = load("helio-a-mains-nues.json");
function follow(overrides = {}, count = 15) {
  let r = replay(story);
  while (r.pending && r.decisions.length < count) {
    const p = r.pending;
    r = choose(story, r.decisions, p.scene, overrides[p.scene] || p.options[0].id);
  }
  return r;
}

test("Hélio has three complete chapters, every path reaches the reading minimum and five interactions", () => {
  validateStory(story);
  assert.equal(story.chapters.length, 3);
  let states = 0;
  const result = audit(story, (id, scene, variables) => {
    if (!scene.choice) return;
    const options = scene.choice.options.filter((o) => matches(o.when, variables));
    assert.ok(options.length >= 5, id);
    for (const field of ["id", "label", "passage", "next"]) assert.equal(new Set(options.map((o) => o[field])).size, options.length, `${id}: ${field}`);
    assert.equal(new Set(options.map((o) => story.scenes[o.next].paragraphs.join(" "))).size, options.length, id);
    states++;
  });
  assert.equal(result.reached.size, Object.keys(story.scenes).length);
  assert.ok(states >= 15);
  assert.ok(result.paths > 5n ** 14n);
  for (let n = 0; n < 3; n++) {
    assert.ok(result.minWords[n] >= 3300, `chapter ${n + 1}: ${result.minWords[n]}`);
    assert.ok(result.maxWords[n] <= 4400);
    assert.equal(result.minChoices[n], 5);
    assert.equal(result.maxChoices[n], 5);
  }
});

test("the five losses last across two chapters and constrain the actual available actions", () => {
  const endings = new Set();
  for (const loss of story.scenes["h-1-5"].choice.options) {
    const reading = follow({ "h-1-5": loss.id });
    assert.equal(reading.decisions.length, 15);
    assert.ok(reading.ending);
    assert.ok(reading.blocks.some((b) => b.id === `h-2-perte-${loss.id}`));
    assert.ok(reading.blocks.some((b) => b.id === `h-3-perte-${loss.id}`));
    endings.add(reading.blocks.find((b) => b.id === `h-3-perte-${loss.id}`).scene.paragraphs.join(" "));
    const before = follow({ "h-1-5": loss.id }, 8);
    assert.equal(before.pending.scene, "h-2-4");
    assert.equal(before.pending.options.some((o) => o.id === "salon"), loss.id !== "salon");
    if (loss.id !== "salon") assert.equal(follow({ "h-1-5": loss.id, "h-2-4": "salon" }).decisions[8].option, "salon");
  }
  assert.equal(endings.size, 5);
});

test("early relationships and rescue choices change scenes in chapter three", () => {
  for (const [scene, prefix] of [["h-1-2", "h-3-contact"], ["h-1-4", "h-3-lien"], ["h-3-1", "h-3-suite"]]) {
    const echoes = new Set();
    for (const option of story.scenes[scene].choice.options) {
      const r = follow({ [scene]: option.id });
      const echo = r.blocks.find((b) => b.id === `${prefix}-${option.id}`);
      assert.ok(echo, option.id);
      echoes.add(echo.scene.paragraphs.join(" "));
      assert.equal(r.decisions.length, 15);
    }
    assert.equal(echoes.size, 5);
  }
});

test("eight local WebP illustrations follow actual descriptions, with varied counts", () => {
  const counts = story.chapters.map(() => 0), sources = new Set();
  let bytes = 0;
  for (const [id, images] of Object.entries(story.illustrations)) {
    const index = story.chapters.findIndex((c) => c.id === story.scenes[id].chapter);
    for (const image of images) {
      assert.equal(typeof story.scenes[id].paragraphs[image.after], "string");
      assert.ok(image.alt.trim());
      const file = readFileSync(new URL(`../public/${image.src}`, import.meta.url));
      assert.equal(file.toString("ascii", 0, 4), "RIFF");
      assert.equal(file.toString("ascii", 8, 12), "WEBP");
      assert.ok(image.width >= 1024 && image.height >= 768);
      assert.ok(file.length < 700000);
      bytes += file.length;counts[index]++;sources.add(image.src);
    }
  }
  assert.deepEqual(counts, [3, 2, 3]);
  assert.equal(sources.size, 8);
  assert.ok(bytes < 5000000);
});

test("the three books have independent saves and Hélio resumes and rewinds without revealing later journal facts", () => {
  const values = new Map(), storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) };
  assert.equal(new Set(BOOKS.map((b) => saveKey(load(b.file)))).size, 3);
  for (const book of BOOKS.filter((b) => b.id !== story.id)) {
    const s = load(book.file), r = replay(s);
    const one = choose(s, [], r.pending.scene, r.pending.options[0].id);
    writeSave(storage, s, one.decisions, null, 0, s.chapters[0].id);
  }
  const others = [...values];
  const finished = follow({ "h-1-5": "bras", "h-3-5": "ensemble" });
  const seen = retainDiscoveries(finished, [...journalAnchors(story)]);
  writeSave(storage, story, finished.decisions, "h-3-6-p0", 19, "hc3", [...seen]);
  const saved = readSave(storage, story);
  assert.deepEqual(replay(story, saved.decisions).decisions, finished.decisions);
  assert.equal(saved.anchor, "h-3-6-p0");
  for (const [key, value] of others) assert.equal(values.get(key), value);
  const early = follow({}, 1), reduced = retainDiscoveries(early, [...seen]);
  assert.ok(!knownCharacters(story, early, reduced).some((c) => c.id === "rusk"));
  assert.deepEqual(chapterRecap(story, early, "hc3"), []);
  assert.deepEqual(chapterProgress(story, early).filter((c) => c.unlocked).map((c) => c.number), [1]);
  const revised = follow({ "h-1-5": "salon" }, 5);
  assert.equal(revised.variables.salon_intact, false);
  for (const c of story.characters) for (const fact of c.facts) {
    const p = story.scenes[fact.source.scene]?.paragraphs[fact.source.paragraph];
    assert.equal(typeof p, "string", `${c.id}: ${fact.field}`);
    if (fact.field === "name") assert.ok(p.includes(fact.value));
  }
});
