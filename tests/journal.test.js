import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replay, choose, narrativeProse } from "../src/engine.js";
import { sourceAnchor, journalAnchors, migrateDiscoveries, knownCharacters, retainDiscoveries } from "../src/journal.js";
import { readSave, writeSave } from "../src/storage.js";
const story = JSON.parse(readFileSync(new URL("../public/stories/accords-du-crepuscule.json", import.meta.url)));
function advance(count, decisions = []) {
  let r = replay(story, decisions);
  while (r.decisions.length < count) r = choose(story, r.decisions, r.pending.scene, r.pending.options[0].id);
  return r;
}
const legacy = (r) => migrateDiscoveries(story, r, { decisions: r.decisions, anchor: null });

test("every authored fact refers to a real paragraph and each character has an identity", () => {
  const ids = new Set();
  assert.equal(story.characters.length, 41);
  for (const c of story.characters) {
    assert.ok(c.facts.some((f) => f.field === "name"));
    assert.ok(["person", "companion", "animal", "entity"].includes(c.kind));
    for (const f of c.facts) {
      assert.ok(!ids.has(f.id)); ids.add(f.id);
      const node = story.scenes[f.source.scene];
      assert.ok(node, f.id);
      assert.equal(typeof node.paragraphs[f.source.paragraph], "string", f.id);
      assert.ok(f.value.length > 0);
      assert.ok(journalAnchors(story).has(sourceAnchor(f.source)));
    }
  }
});

test("publication and chapter unlocks do not reveal characters before their source is read", () => {
  const reading = advance(65);
  assert.equal(reading.pending.scene, "c14-1");
  assert.deepEqual(knownCharacters(story, reading, new Set()), []);
  const known = knownCharacters(story, reading, legacy(reading));
  assert.ok(known.some((c) => c.id === "ansel"));
  assert.ok(!known.some((c) => ["tessa", "luc", "mina", "voss"].includes(c.id)));
  const first = replay(story), seen = new Set(["c1-rue-p0"]);
  const evan = knownCharacters(story, first, seen).find((c) => c.id === "evan");
  assert.equal(evan.name, "Evan");
  assert.equal(evan.fields.age, undefined);
  assert.ok(!knownCharacters(story, first, new Set(["c9-4-p1"])).some((c) => c.id === "aelyr"));
});

test("identity, age and fate develop only after the corresponding passages", () => {
  const first = advance(5), before = new Set(["c1-rue-p0", "c1-incident-p3"]);
  const entry = (r, seen, id) => knownCharacters(story, r, seen).find((c) => c.id === id);
  assert.equal(entry(first, before, "evan").name, "Evan Kamikony");
  assert.equal(entry(first, before, "evan").fields.age, undefined);
  before.add("c1-nuit-p4");
  assert.equal(entry(first, before, "evan").fields.age, "13 ans");
  const midway = advance(20), later = advance(55);
  assert.match(entry(midway, legacy(midway), "ansel").fields.status, /Disparu/u);
  assert.match(entry(later, legacy(later), "ansel").fields.status, /Décès confirmé/u);
});

test("optional encounters are path dependent and late sources cannot survive a rewind", () => {
  const first = replay(story);
  let kept = advance(1);
  kept = choose(story, kept.decisions, kept.pending.scene, kept.pending.options[1].id);
  kept = advance(5, kept.decisions);
  assert.ok(!knownCharacters(story, kept, legacy(kept)).some((c) => c.id === "lise-enfant"));
  const shared = advance(5);
  assert.ok(knownCharacters(story, shared, legacy(shared)).some((c) => c.id === "lise-enfant"));
  const full = advance(165), retained = retainDiscoveries(advance(20), [...legacy(full)]);
  const known = knownCharacters(story, advance(20), retained);
  assert.match(known.find((c) => c.id === "ansel").fields.status, /Disparu/u);
  assert.ok(!known.some((c) => c.id === "aelyr" || c.id === "tessa"));
  assert.ok(!retained.has("c11-2-p4"));
});

test("a branch-only full name is never recovered from an unchosen route", () => {
  const before = advance(83); // fourth interaction of chapter 17
  assert.equal(before.pending.scene, "c17-4");
  const read = (index) => {
    const r = advance(90, choose(story, before.decisions, before.pending.scene, before.pending.options[index].id).decisions);
    return knownCharacters(story, r, legacy(r)).find((c) => c.id === "voss");
  };
  assert.equal(read(1).name, "Édran Voss");
  assert.equal(read(0).name, "Voss");
});

test("new saves persist discoveries; old or damaged optional logs preserve reading decisions", () => {
  const reading = advance(5), map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k,v) => map.set(k,v) };
  writeSave(storage, story, reading.decisions, "c1-nuit-p4", 0, "c1", ["c1-rue-p0"]);
  const saved = readSave(storage, story);
  assert.deepEqual(saved.decisions, reading.decisions);
  assert.deepEqual([...migrateDiscoveries(story, reading, saved)], ["c1-rue-p0"]);
  assert.ok(migrateDiscoveries(story, reading, { ...saved, journalSeen: "broken" }).has("c1-nuit-p4"));
  assert.deepEqual([...migrateDiscoveries(story, reading, { ...saved, journalSeen: ["missing"] })], []);
});

test("existing portraits require their own discovered source and disappear after a rewind", () => {
  const helio = JSON.parse(readFileSync(new URL("../public/stories/helio-a-mains-nues.json", import.meta.url)));
  const reading = replay(helio);
  const seen = new Set(["h-1-1-p0"]);
  assert.equal(knownCharacters(helio, reading, seen)[0].portrait, null);
  assert.ok(journalAnchors(helio).has("h-1-1-p4"));
  seen.add("h-1-1-p6");
  assert.equal(knownCharacters(helio, reading, seen)[0].portrait.src, "illustrations/helio/01-helio.webp");
  seen.delete("h-1-1-p6");
  seen.add("h-1-1-p4");
  assert.equal(knownCharacters(helio, reading, seen)[0].portrait.src, "illustrations/helio/01-helio.webp");
  seen.add("h-6-1-p2");
  assert.ok(!knownCharacters(helio, reading, seen).some((c) => c.id === "senn"));
  for (const c of helio.characters.filter((c) => c.portrait)) {
    assert.ok(readFileSync(new URL(`../public/${c.portrait.src}`, import.meta.url)).length > 0);
    assert.ok(narrativeProse(helio.scenes[c.portrait.source.scene]).some((p) => p.key === `p${c.portrait.source.paragraph}`));
  }
});
