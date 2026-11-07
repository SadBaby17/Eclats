import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replay, validateStory, choose } from "../src/engine.js";
import { readSave, writeSave, SAVE_KEY, saveKey } from "../src/storage.js";
const novel = JSON.parse(
  readFileSync(
    new URL("../public/stories/accords-du-crepuscule.json", import.meta.url),
  ),
);
const demo = JSON.parse(
  readFileSync(new URL("../public/stories/demo.json", import.meta.url)),
);
const words = (text) => text.trim().split(/\s+/u).filter(Boolean).length;

test("all 32768 narrative paths traverse three chapters and fifteen valid decisions", () => {
  validateStory(novel);
  const reached = new Set();
  const spans = novel.chapters.map(() => ({ min: Infinity, max: 0 }));
  const counts = new Map(
    Object.entries(novel.scenes).map(([id, s]) => [
      id,
      words(s.paragraphs.join(" ")),
    ]),
  );
  let paths = 0;
  function walk(decisions) {
    const r = replay(novel, decisions);
    r.blocks.forEach((b) => reached.add(b.id));
    assert.equal(
      r.decisions.length,
      decisions.length,
      "no silently discarded decision",
    );
    if (r.pending) {
      assert.ok(r.pending.options.length >= 2);
      for (const o of r.pending.options)
        walk([...decisions, { scene: r.pending.scene, option: o.id }]);
      return;
    }
    paths++;
    assert.ok(r.ending);
    assert.equal(r.decisions.length, 15);
    novel.chapters.forEach((c, index) => {
      const blocks = r.blocks.filter((b) => b.scene.chapter === c.id);
      assert.equal(blocks.filter((b) => b.selected).length, 5);
      const total = blocks.reduce(
        (n, b) =>
          n + counts.get(b.id) + (b.selected ? words(b.selected.passage) : 0),
        0,
      );
      spans[index].min = Math.min(spans[index].min, total);
      spans[index].max = Math.max(spans[index].max, total);
    });
  }
  walk([]);
  assert.equal(paths, 32768);
  assert.equal(
    reached.size,
    Object.keys(novel.scenes).length,
    "no unreachable published scene",
  );
  spans.forEach((span, index) => {
    assert.ok(
      span.min >= 3300,
      `chapter ${index + 1} is a full reading passage: ${span.min}`,
    );
    assert.ok(
      span.max <= 4300,
      `chapter ${index + 1} stays within the intended scale: ${span.max}`,
    );
    console.log(
      `Chapter ${index + 1}: ${span.min}–${span.max} words per path; 5 interactions.`,
    );
  });
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

test("demo and novel saves remain independent, with the legacy demo key preserved", () => {
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
    demo,
    [{ scene: "arrivee", option: "port" }],
    "jeanne-p2",
    30,
    "ch1",
  );
  writeSave(storage, novel, decisions, "c1-rue-p1", 15, "c1");
  assert.equal(saveKey(demo), SAVE_KEY);
  assert.notEqual(saveKey(novel), SAVE_KEY);
  assert.equal(readSave(storage, demo).anchor, "jeanne-p2");
  assert.deepEqual(readSave(storage, novel).decisions, decisions);
});

test("only the first three chapters are published, with no author dashboard or future revelations", () => {
  assert.equal(novel.chapters.length, 3);
  assert.equal(novel.publication.status, "ongoing");
  assert.equal(novel.publication.availableChapters, 3);
  const content = Object.values(novel.scenes)
    .flatMap((s) => s.paragraphs)
    .join(" ");
  assert.doesNotMatch(
    content,
    /Aelyr|Keryth|Zerathiel|Diablo|TODO|selon votre choix/iu,
  );
});
