// Exact DAG analysis. States differing only in variables never read again are
// equivalent; merging them avoids enumerating trillions of complete histories.
import { matches, narrativeProse } from "../../src/engine.js";
export const words = (text) => text.trim().split(/\s+/u).filter(Boolean).length;
export function audit(story, inspect = () => {}) {
  const liveMemo = new Map(),
    visiting = new Set(),
    memo = new Map(),
    reached = new Set();
  const vector = () => story.chapters.map(() => 0);
  const index = new Map(story.chapters.map((c, i) => [c.id, i]));
  function edges(s) {
    if (s.choice)
      return s.choice.options.map((o) => ({
        next: o.next,
        set: o.set || {},
        when: o.when,
      }));
    if (s.routes) return s.routes;
    return s.next ? [{ next: s.next }] : [];
  }
  function live(id) {
    if (liveMemo.has(id)) return liveMemo.get(id);
    if (visiting.has(id)) throw Error(`Cycle: ${id}`);
    visiting.add(id);
    const s = story.scenes[id];
    if (!s) throw Error(`Missing: ${id}`);
    const keys = new Set();
    for (const e of edges(s)) {
      Object.keys(e.when || {}).forEach((k) => keys.add(k));
      for (const k of live(e.next))
        if (!Object.hasOwn(e.set || {}, k)) keys.add(k);
    }
    visiting.delete(id);
    liveMemo.set(id, keys);
    return keys;
  }
  function walk(id, variables) {
    reached.add(id);
    const key = JSON.stringify([
      id,
      [...live(id)].sort().map((k) => [k, variables[k]]),
    ]);
    if (memo.has(key)) return memo.get(key);
    const s = story.scenes[id];
    let exits;
    inspect(id, s, variables);
    if (s.choice)
      exits = s.choice.options.filter((o) => matches(o.when, variables));
    else if (s.routes)
      exits = [s.routes.find((r) => matches(r.when, variables))].filter(
        Boolean,
      );
    else exits = s.next ? [{ next: s.next }] : [];
    if (!s.ending && !exits.length) throw Error(`Dead end: ${id}`);
    const tails = exits.map((e) => ({
      result: walk(e.next, { ...variables, ...e.set }),
      passage: e.passage || "",
    }));
    if (s.ending)
      tails.push({
        result: {
          paths: 1n,
          minWords: vector(),
          maxWords: vector(),
          minChoices: vector(),
          maxChoices: vector(),
        },
        passage: "",
      });
    const result = {
      paths: 0n,
      minWords: vector().map(() => Infinity),
      maxWords: vector(),
      minChoices: vector().map(() => Infinity),
      maxChoices: vector(),
    };
    for (const { result: r, passage } of tails) {
      result.paths += r.paths;
      story.chapters.forEach((_, i) => {
        const current = index.get(s.chapter) === i;
        const w = current ? words([...narrativeProse(s).map((p) => p.text), passage].join(" ")) : 0;
        const c = current && s.choice ? 1 : 0;
        result.minWords[i] = Math.min(result.minWords[i], r.minWords[i] + w);
        result.maxWords[i] = Math.max(result.maxWords[i], r.maxWords[i] + w);
        result.minChoices[i] = Math.min(
          result.minChoices[i],
          r.minChoices[i] + c,
        );
        result.maxChoices[i] = Math.max(
          result.maxChoices[i],
          r.maxChoices[i] + c,
        );
      });
    }
    memo.set(key, result);
    return result;
  }
  return {
    ...walk(story.chapters[0].start, { ...story.variables }),
    reached,
    states: memo.size,
  };
}
