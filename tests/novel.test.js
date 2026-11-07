import test from "node:test";
import { createHash } from "node:crypto";
import { audit } from "./helpers/story-audit.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replay, validateStory, choose } from "../src/engine.js";
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
  assert.equal(result.paths, 2n ** 15n * 5n ** 25n);
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
        assert.ok(novel.scenes[o.next].paragraphs.join(" ").length > 100);
      }
    }
});

test("sampled complete histories replay all forty decisions and preserve five-way answers", () => {
  let seed = 7193;
  for (let sample = 0; sample < 128; sample++) {
    let r = replay(novel);
    while (r.pending) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const o = r.pending.options[seed % r.pending.options.length];
      r = choose(novel, r.decisions, r.pending.scene, o.id);
    }
    assert.equal(r.decisions.length, 40);
    assert.equal(r.blocks.at(-1).id, "c8-fin");
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

test("only the first eight chapters are published, without the final author revelations", () => {
  assert.equal(novel.chapters.length, 8);
  assert.equal(novel.publication.status, "ongoing");
  assert.equal(novel.publication.availableChapters, 8);
  const content = Object.values(novel.scenes)
    .flatMap((s) => s.paragraphs)
    .join(" ");
  assert.doesNotMatch(content, /Aelyr|Diablo|TODO|selon votre choix/iu);
});
