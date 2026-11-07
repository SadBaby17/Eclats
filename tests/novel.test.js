import test from "node:test";
import { createHash } from "node:crypto";
import { audit, words } from "./helpers/story-audit.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replay, validateStory, choose, narrativeProse } from "../src/engine.js";
import { readSave, writeSave, SAVE_KEY, saveKey } from "../src/storage.js";
const novel = JSON.parse(
  readFileSync(
    new URL("../public/stories/accords-du-crepuscule.json", import.meta.url),
  ),
);
const fixtureStory = JSON.parse(
  readFileSync(new URL("./fixtures/branching-story.json", import.meta.url)),
);
test("all reachable narrative states have valid continuations and chapter lengths", () => {
  validateStory(novel);
  const result = audit(novel);
  assert.equal(result.paths, 2n ** 15n * 5n ** 150n);
  assert.equal(result.reached.size, Object.keys(novel.scenes).length);
  novel.chapters.forEach((c, i) => {
    assert.equal(result.minChoices[i], 5);
    assert.equal(result.maxChoices[i], 5);
    assert.ok(
      result.minWords[i] >= 3300,
      `chapter ${i + 1}: minimum ${result.minWords[i]}`,
    );
    assert.ok(
      result.maxWords[i] <= 4400,
      `chapter ${i + 1}: maximum ${result.maxWords[i]}`,
    );
    console.log(
      `Chapter ${i + 1}: ${result.minWords[i]}–${result.maxWords[i]} words; 5 interactions.`,
    );
  });
  assert.ok(
    result.states < 100000,
    "equivalent histories are merged rather than brute-forced",
  );
});

test("the published first three chapters remain unchanged and their saves resume at chapter four", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/novel-first-release.json", import.meta.url),
    ),
  );
  const canonical = (x) =>
    JSON.stringify(x, (_, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
          )
        : v,
    );
  assert.equal(novel.version, fixture.version);
  assert.deepEqual(novel.chapters.slice(0, 3), fixture.chapters);
  for (const [id, hash] of Object.entries(fixture.scenes)) {
    const node = structuredClone(novel.scenes[id]);
    if (id === "c3-retour") delete node.next;
    assert.equal(
      createHash("sha256").update(canonical(node)).digest("hex"),
      hash,
      id,
    );
  }
  let r = replay(novel);
  while (r.decisions.length < 15)
    r = choose(novel, r.decisions, r.pending.scene, r.pending.options[0].id);
  const map = new Map(),
    storage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, v),
    };
  writeSave(storage, novel, r.decisions, "c3-retour-p7", 20, "c3");
  const saved = readSave(storage, novel),
    resumed = replay(novel, saved.decisions);
  assert.equal(resumed.decisions.length, 15);
  assert.equal(resumed.pending.scene, "c4-1");
  assert.equal(saved.anchor, "c3-retour-p7");
});

// Measure what the reader receives before another prompt, including automatic
// routing scenes. A short route marker is not itself an interruption.
const passageLengths = new Map();
function beforeNextChoice(id) {
  if (passageLengths.has(id)) return passageLengths.get(id);
  const node = novel.scenes[id];
  let total = words(narrativeProse(node).map((p) => p.text).join(" "));
  if (!node.choice && !node.ending) {
    const targets = node.routes
      ? node.routes.map((route) => route.next)
      : [node.next];
    total += Math.min(...targets.map(beforeNextChoice));
  }
  passageLengths.set(id, total);
  return total;
}
test("each new interaction has five distinct valid answers", () => {
  for (const s of Object.values(novel.scenes))
    if (s.choice && Number(s.chapter.slice(1)) >= 4) {
      assert.ok(s.choice.options.length >= 5);
      assert.equal(
        new Set(s.choice.options.map((o) => o.label)).size,
        s.choice.options.length,
      );
      for (const o of s.choice.options) {
        assert.ok(o.passage.length > 20);
        assert.ok(
          beforeNextChoice(o.next) >= 100,
          `substantial narrative continuation for ${o.id}`,
        );
      }
    }
});

test("sampled complete histories replay all one hundred sixty-five decisions and preserve five-way answers", () => {
  let seed = 7193;
  for (let sample = 0; sample < 128; sample++) {
    let r = replay(novel);
    while (r.pending) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const o = r.pending.options[seed % r.pending.options.length];
      r = choose(novel, r.decisions, r.pending.scene, o.id);
    }
    assert.equal(r.decisions.length, 165);
    assert.equal(r.blocks.at(-1).scene.chapter, "c33");
    assert.deepEqual(replay(novel, r.decisions).decisions, r.decisions);
  }
});

test("rewinding the new novel discards every later consequence", () => {
  let r = replay(novel);
  while (r.pending)
    r = choose(novel, r.decisions, r.pending.scene, r.pending.options[0].id);
  const first = replay(novel).pending;
  const revised = choose(novel, [], first.scene, first.options[1].id);
  assert.equal(revised.decisions.length, 1);
  assert.equal(revised.variables.conversation, "");
  assert.equal(revised.variables.manoeuvre, "");
  assert.equal(revised.variables.temoignage, "");
  assert.ok(!revised.blocks.some((b) => b.scene.chapter === "c3"));
});

test("other stored data remains intact when saving the novel", () => {
  const map = new Map();
  const storage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
  };
  const first = replay(novel).pending;
  const decisions = choose(
    novel,
    [],
    first.scene,
    first.options[0].id,
  ).decisions;
  writeSave(
    storage,
    fixtureStory,
    [{ scene: "arrivee", option: "port" }],
    "jeanne-p2",
    30,
    "ch1",
  );
  writeSave(storage, novel, decisions, "c1-rue-p1", 15, "c1");
  assert.equal(saveKey(novel), `${SAVE_KEY}:${novel.id}`);
  assert.notEqual(saveKey(novel), SAVE_KEY);
  assert.equal(readSave(storage, fixtureStory).anchor, "jeanne-p2");
  assert.deepEqual(readSave(storage, novel).decisions, decisions);
});

test("the complete thirty-three-chapter novel has three reachable conclusions", () => {
  assert.equal(novel.chapters.length, 33);
  assert.equal(novel.publication.status, "complete");
  assert.equal(novel.publication.availableChapters, 33);
  const content = Object.values(novel.scenes)
    .flatMap((s) => narrativeProse(s).map((p) => p.text))
    .join(" ");
  assert.doesNotMatch(content, /Diablo|TODO|selon votre choix/iu);
});

test("the first eight chapters remain unchanged and forty-decision saves continue at chapter nine", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/novel-eight-chapters.json", import.meta.url),
    ),
  );
  const canonical = (x) =>
    JSON.stringify(x, (_, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
          )
        : v,
    );
  assert.equal(novel.version, fixture.version);
  assert.deepEqual(novel.chapters.slice(0, 8), fixture.chapters);
  for (const [id, hash] of Object.entries(fixture.scenes)) {
    const node = structuredClone(novel.scenes[id]);
    if (id === "c8-fin") delete node.next;
    assert.equal(
      createHash("sha256").update(canonical(node)).digest("hex"),
      hash,
      id,
    );
  }
  let r = replay(novel);
  while (r.decisions.length < 40)
    r = choose(novel, r.decisions, r.pending.scene, r.pending.options[0].id);
  const map = new Map(),
    storage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, v),
    };
  writeSave(storage, novel, r.decisions, "c8-fin-p7", 20, "c8");
  const saved = readSave(storage, novel);
  const continued = replay(novel, saved.decisions);
  assert.equal(continued.decisions.length, 40);
  assert.equal(continued.pending.scene, "c9-1");
  assert.equal(saved.anchor, "c8-fin-p7");
});

test("the final configuration produces three complete endings and can be revised", () => {
  let before = replay(novel);
  while (before.pending.scene !== "c12-5")
    before = choose(
      novel,
      before.decisions,
      before.pending.scene,
      before.pending.options[0].id,
    );
  const prefix = before.decisions,
    endings = new Set();
  for (const option of before.pending.options) {
    let r = choose(novel, prefix, "c12-5", option.id);
    while (r.pending)
      r = choose(novel, r.decisions, r.pending.scene, r.pending.options[0].id);
    endings.add(r.blocks.find((b) => b.scene.cycleEnding)?.scene.cycleEnding);
    assert.equal(r.decisions.length, 165);
    assert.equal(r.blocks.at(-1).scene.chapter, "c33");
    const rewritten = choose(
      novel,
      prefix,
      "c12-5",
      before.pending.options.find((o) => o.id !== option.id).id,
    );
    assert.equal(rewritten.decisions.length, prefix.length + 1);
    assert.equal(rewritten.pending.scene, "c13-1");
  }
  assert.equal(endings.size, 3);
});

test("combat options expose concrete powers and preserve their distinct consequences", () => {
  for (const id of ["c9-2", "c12-2", "c12-3"]) {
    const node = novel.scenes[id];
    assert.equal(node.choice.options.length, 5);
    assert.equal(new Set(node.choice.options.map((o) => o.passage)).size, 5);
    for (const option of node.choice.options)
      assert.ok(option.passage.split(/\s+/u).length >= 35);
  }
});

test("reading guides only explain unlocked scenes from chapter five onward without altering the novel", () => {
  assert.equal(Object.keys(novel.readingGuides).length, 29);
  const covered = new Set();
  for (const [id, guide] of Object.entries(novel.readingGuides)) {
    const scene = novel.scenes[id];
    assert.ok(scene, id);
    assert.ok(Number(scene.chapter.slice(1)) >= 5);
    covered.add(scene.chapter);
    assert.equal(typeof guide.title, "string");
    assert.ok(guide.paragraphs.length >= 2);
    assert.ok(guide.paragraphs.every((p) => typeof p === "string" && p.length > 40));
    if (guide.steps) assert.ok(guide.steps.length >= 3);
  }
  assert.equal(covered.size, 19);
  const withoutGuides = structuredClone(novel);
  delete withoutGuides.readingGuides;
  let current = replay(novel);
  while (current.pending)
    current = choose(novel, current.decisions, current.pending.scene, current.pending.options[0].id);
  assert.deepEqual(replay(withoutGuides, current.decisions), current);
});


test("all thirteen original chapters and their decisions are preserved across the cycle transition", () => {
  const baseline = JSON.parse(readFileSync(new URL("./fixtures/novel-thirteen-chapters.json", import.meta.url)));
  const canonical = (x) => JSON.stringify(x, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
  assert.equal(novel.version, baseline.version);
  assert.deepEqual(novel.chapters.slice(0, 13), baseline.chapters);
  for (const [id, hash] of Object.entries(baseline.scenes)) {
    const node = structuredClone(novel.scenes[id]);
    if (baseline.cycleEndings[id]) {
      assert.equal(node.cycleEnding, baseline.cycleEndings[id]);
      assert.match(node.next, /^c14-pont-/u);
      node.ending = node.cycleEnding;
      delete node.cycleEnding;
      delete node.next;
    }
    assert.equal(createHash("sha256").update(canonical(node)).digest("hex"), hash, id);
  }
  let r = replay(novel);
  while (r.decisions.length < 65) r = choose(novel, r.decisions, r.pending.scene, r.pending.options[0].id);
  assert.equal(r.pending.scene, "c14-1");
  assert.equal(r.decisions.length, 65);
  assert.equal(r.blocks.filter((b) => b.scene.cycleEnding).length, 1);
});

test("the second cycle has twenty chapters, one hundred decisions and three distinct conclusions", () => {
  assert.equal(novel.chapters.slice(13).length, 20);
  let before = replay(novel);
  while (before.pending.scene !== "c30-5") before = choose(novel, before.decisions, before.pending.scene, before.pending.options[0].id);
  const endings = new Set();
  for (const option of before.pending.options) {
    let r = choose(novel, before.decisions, before.pending.scene, option.id);
    while (r.pending) r = choose(novel, r.decisions, r.pending.scene, r.pending.options[0].id);
    endings.add(r.ending);
    assert.equal(r.decisions.length, 165);
    assert.equal(r.variables.strategie_finale, before.variables.strategie_finale);
  }
  assert.equal(endings.size, 3);
  const revised = choose(novel, before.decisions, before.pending.scene, before.pending.options[2].id);
  assert.equal(revised.pending.scene, "c31-1");
  assert.equal(revised.variables.projet_routes, "c");
});


test("expanding the second cycle preserves all original scenes, paragraph anchors, choices and journal sources", () => {
  const baseline = JSON.parse(readFileSync(new URL("./fixtures/novel-before-expansion.json", import.meta.url)));
  const canonical = (x) => JSON.stringify(x, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
  const digest = (x) => createHash("sha256").update(canonical(x)).digest("hex");
  assert.deepEqual(Object.keys(novel.scenes), Object.keys(baseline.scenes));
  for (const [id, hash] of Object.entries(baseline.scenes)) {
    const node = structuredClone(novel.scenes[id]);
    if (Number(node.chapter.slice(1)) < 14) assert.equal(node.insertions, undefined);
    delete node.insertions;
    assert.equal(digest(node), hash, id);
  }
  for (const [key, hash] of Object.entries(baseline.metadata)) assert.equal(digest(novel[key]), hash, key);
  const added = Object.values(novel.scenes).flatMap((scene) => (scene.insertions || []).flatMap((part) => part.paragraphs));
  assert.equal(new Set(added).size, added.length, "no duplicated paragraphs used to pad the manuscript");
  assert.ok(words(added.join(" ")) > 40000);
});
