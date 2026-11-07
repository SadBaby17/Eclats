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
