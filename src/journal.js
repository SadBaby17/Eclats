import { narrativeProse } from "./engine.js";
// Character knowledge is authored in the story JSON. Only encountered sources
// on the current narrative path contribute; publication order is irrelevant.
export function sourceAnchor(source) {
  return source.selected ? `${source.scene}-selected` : `${source.scene}-p${source.paragraph}`;
}

export function reachedAnchors(reading) {
  const anchors = new Set();
  for (const block of reading.blocks) {
    narrativeProse(block.scene).forEach(({ key }) => anchors.add(`${block.id}-${key}`));
    if (block.selected) anchors.add(`${block.id}-selected`);
  }
  return anchors;
}

export function retainDiscoveries(reading, seen = []) {
  const valid = reachedAnchors(reading);
  return new Set(seen.filter((anchor) => typeof anchor === "string" && valid.has(anchor)));
}

export function journalAnchors(story) {
  return new Set((story.characters || []).flatMap((c) => c.facts.map((f) => sourceAnchor(f.source))));
}

// Old saves have no exposure log. Confirmed decisions establish a conservative
// read prefix. The bookmark can extend it, but an unlocked next chapter alone
// never contributes information.
export function migrateDiscoveries(story, reading, saved) {
  if (!saved) return new Set();
  if (Array.isArray(saved.journalSeen)) return retainDiscoveries(reading, saved.journalSeen);
  let lastConfirmed = -1;
  reading.blocks.forEach((b, i) => { if (b.selected) lastConfirmed = i; });
  const sources = journalAnchors(story), seen = new Set();
  let bookmarkFound = false;
  for (let i = 0; i < reading.blocks.length; i++) {
    const block = reading.blocks[i];
    const anchors = narrativeProse(block.scene).map(({ key }) => `${block.id}-${key}`);
    if (block.selected) anchors.push(`${block.id}-selected`);
    for (const anchor of anchors) {
      if (i <= lastConfirmed && sources.has(anchor)) seen.add(anchor);
      if (anchor === saved.anchor) bookmarkFound = true;
    }
  }
  if (bookmarkFound) {
    outer: for (const block of reading.blocks) {
      const anchors = narrativeProse(block.scene).map(({ key }) => `${block.id}-${key}`);
      if (block.selected) anchors.push(`${block.id}-selected`);
      for (const anchor of anchors) {
        if (sources.has(anchor)) seen.add(anchor);
        if (anchor === saved.anchor) break outer;
      }
    }
  }
  return seen;
}

export function knownCharacters(story, reading, seen) {
  const order = new Map(reading.blocks.map((b, i) => [b.id, { block: b, index: i }]));
  return (story.characters || []).flatMap((character) => {
    const facts = character.facts.filter((fact) => {
      const entry = order.get(fact.source.scene);
      return entry && seen.has(sourceAnchor(fact.source))
        && (!fact.source.option || entry.block.selected?.id === fact.source.option);
    }).sort((a, b) => order.get(a.source.scene).index - order.get(b.source.scene).index
      || (a.source.selected ? Infinity : a.source.paragraph) - (b.source.selected ? Infinity : b.source.paragraph));
    const fields = {};
    for (const fact of facts) fields[fact.field] = fact.value;
    if (!fields.name) return [];
    return [{ id: character.id, kind: character.kind, name: fields.fullName || fields.name, fields, facts,
      firstSource: facts[0].source, chapter: story.scenes[facts[0].source.scene].chapter }];
  });
}
