// Unlocks are derived from the current replay, never from an independent counter.
// Replacing an earlier decision therefore relocks incompatible future chapters.
export function chapterProgress(story, reading) {
  const reached = new Map();
  for (const block of reading.blocks) {
    if (!reached.has(block.scene.chapter))
      reached.set(block.scene.chapter, block.id);
  }
  return story.chapters.map((chapter) => ({
    ...chapter,
    unlocked: reached.has(chapter.id),
    sceneId: reached.get(chapter.id) || null,
  }));
}
export function chapterScene(story, reading, chapterId) {
  return (
    chapterProgress(story, reading).find((c) => c.id === chapterId)?.sceneId ||
    null
  );
}

// Page navigation is separate from narrative progress: switching pages never
// accepts a choice, removes a decision, or reveals a locked chapter.
export function chapterPage(story, reading, requested) {
  const chapters = chapterProgress(story, reading);
  const chapter = chapters.find((c) => c.id === requested && c.unlocked)
    || chapters.filter((c) => c.unlocked).at(-1);
  const index = chapters.findIndex((c) => c.id === chapter.id);
  return {
    chapter,
    blocks: reading.blocks.filter((b) => b.scene.chapter === chapter.id),
    previous: chapters[index - 1]?.unlocked ? chapters[index - 1] : null,
    next: chapters[index + 1]?.unlocked ? chapters[index + 1] : null,
  };
}

export function chapterRecap(story, reading, chapterId) {
  const index = story.chapters.findIndex((c) => c.id === chapterId);
  if (index <= 0 || !reading.blocks.some((b) => b.scene.chapter === chapterId))
    return [];
  // Use only decisions BEFORE this chapter, even when rereading a finished
  // novel. Later choices must never leak into the recap of an earlier page.
  const variables = { ...story.variables };
  for (const block of reading.blocks) {
    if (block.scene.chapter === chapterId) break;
    Object.assign(variables, block.selected?.set || {});
  }
  const variants = story.chapterRecaps?.[chapterId] || [];
  return variants.find((v) => !v.when || Object.entries(v.when)
    .every(([key, value]) => variables[key] === value))?.paragraphs || [];
}
