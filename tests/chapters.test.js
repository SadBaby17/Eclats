import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replay, choose } from "../src/engine.js";
import { chapterProgress, chapterScene } from "../src/chapters.js";
import { BOOKS, findBook } from "../src/catalog.js";
const story = JSON.parse(
  readFileSync(
    new URL("../public/stories/accords-du-crepuscule.json", import.meta.url),
  ),
);
function advance(count) {
  let r = replay(story);
  for (let i = 0; i < count; i++)
    r = choose(story, r.decisions, r.pending.scene, r.pending.options[0].id);
  return r;
}
test("only reached chapters are accessible; all thirty-three are listed from the start", () => {
  const fresh = replay(story),
    chapters = chapterProgress(story, fresh);
  assert.equal(chapters.length, 33);
  assert.deepEqual(
    chapters.filter((c) => c.unlocked).map((c) => c.number),
    [1],
  );
  assert.equal(chapterScene(story, fresh, "c8"), null);
  assert.equal(chapterScene(story, fresh, "missing"), null);
  assert.equal(chapterScene(story, fresh, "c1"), "c1-rue");
});
test("completing chapter decisions unlocks the next one without changing history", () => {
  const r = advance(5),
    saved = JSON.stringify(r);
  assert.deepEqual(
    chapterProgress(story, r)
      .filter((c) => c.unlocked)
      .map((c) => c.number),
    [1, 2],
  );
  assert.equal(chapterScene(story, r, "c1"), "c1-rue");
  assert.equal(chapterScene(story, r, "c2"), "c2-matin");
  assert.equal(JSON.stringify(r), saved);
  assert.equal(chapterScene(story, r, "c3"), null);
});
test("old three-chapter saves unlock the fourth; replacing an early decision relocks the future", () => {
  assert.equal(
    chapterProgress(story, advance(15)).filter((c) => c.unlocked).length,
    4,
  );
  const full = advance(165);
  assert.ok(chapterProgress(story, full).every((c) => c.unlocked));
  const pending = replay(story).pending;
  const revised = choose(story, [], pending.scene, pending.options[1].id);
  assert.deepEqual(
    chapterProgress(story, revised)
      .filter((c) => c.unlocked)
      .map((c) => c.number),
    [1],
  );
  assert.equal(chapterScene(story, revised, "c8"), null);
});
test("the catalogue exposes only the preserved thirty-three-chapter novel", () => {
  assert.equal(BOOKS.length, 1);
  assert.equal(BOOKS[0].id, story.id);
  assert.equal(findBook("demo"), undefined);
  assert.equal(findBook("le-phare-des-heures"), undefined);
  assert.equal(story.chapters.length, 33);
});
