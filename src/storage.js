export const SAVE_KEY = "eclats.reading.v1",
  SETTINGS_KEY = "eclats.settings.v1";
export function saveKey(story) {
  return `${SAVE_KEY}:${story.id}`;
}
export function readSave(storage, story) {
  const raw = storage.getItem(saveKey(story));
  if (!raw) return null;
  const s = JSON.parse(raw);
  if (
    s.schema !== 1 ||
    s.story !== story.id ||
    s.version !== story.version ||
    !Array.isArray(s.decisions) ||
    !s.decisions.every(
      (d) => typeof d?.scene === "string" && typeof d?.option === "string",
    ) ||
    !Number.isFinite(s.offset) ||
    Math.abs(s.offset) > 1000000
  )
    throw Error("Sauvegarde incompatible ou endommagée.");
  return s;
}
export function writeSave(storage, story, decisions, anchor, offset, chapter, journalSeen) {
  storage.setItem(
    saveKey(story),
    JSON.stringify({
      schema: 1,
      story: story.id,
      version: story.version,
      decisions,
      anchor,
      offset,
      chapter,
      ...(Array.isArray(journalSeen) ? { journalSeen } : {}),
    }),
  );
}
