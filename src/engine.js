// The engine replays decisions from the beginning: variables are never mutated in saves.
export function matches(condition, variables) {
  return (
    !condition ||
    Object.entries(condition).every(([key, value]) => variables[key] === value)
  );
}
export function validateStory(story) {
  if (
    !story ||
    story.format !== 1 ||
    typeof story.id !== "string" ||
    !Number.isInteger(story.version) ||
    !Array.isArray(story.chapters) ||
    !story.chapters.length ||
    !story.scenes
  )
    throw Error("Format de récit invalide.");
  const ids = new Set();
  for (const chapter of story.chapters) {
    if (!chapter.id || ids.has(chapter.id) || !story.scenes[chapter.start])
      throw Error("Chapitre invalide.");
    ids.add(chapter.id);
  }
  const target = (id) => {
    if (!story.scenes[id]) throw Error(`Scène introuvable : ${id}`);
  };
  for (const [id, scene] of Object.entries(story.scenes)) {
    if (
      !ids.has(scene.chapter) ||
      !Array.isArray(scene.paragraphs) ||
      !scene.paragraphs.every((p) => typeof p === "string")
    )
      throw Error(`Scène invalide : ${id}`);
    if (scene.insertions !== undefined && (
      !Array.isArray(scene.insertions) || scene.insertions.some((part) =>
        !Number.isInteger(part.before) || part.before < 0 || part.before > scene.paragraphs.length
        || !Array.isArray(part.paragraphs) || !part.paragraphs.every((p) => typeof p === "string"))
    )) throw Error(`Passage ajouté invalide : ${id}`);
    if (
      [!!scene.choice, !!scene.next, !!scene.routes, !!scene.ending].filter(
        Boolean,
      ).length !== 1
    )
      throw Error(`Une seule sortie requise : ${id}`);
    if (scene.next) target(scene.next);
    if (scene.routes) {
      if (
        !Array.isArray(scene.routes) ||
        !scene.routes.length ||
        scene.routes.at(-1).when
      )
        throw Error("Route de secours requise.");
      scene.routes.forEach((r) => target(r.next));
    }
    if (scene.choice) {
      if (
        !scene.choice.prompt ||
        !Array.isArray(scene.choice.options) ||
        scene.choice.options.length < 2
      )
        throw Error("Choix invalide.");
      const options = new Set();
      for (const o of scene.choice.options) {
        if (!o.id || options.has(o.id) || !o.label || !o.passage)
          throw Error("Option invalide.");
        if (o.retired !== undefined && typeof o.retired !== "boolean") throw Error("Option archivée invalide.");
        if (o.disabledReason !== undefined && (typeof o.disabledReason !== "string" || !o.disabledReason.trim() || !o.when))
          throw Error("Motif d’indisponibilité invalide.");
        options.add(o.id);
        target(o.next);
      }
    }
  }
  if (story.illustrations !== undefined) {
    if (!story.illustrations || typeof story.illustrations !== "object" || Array.isArray(story.illustrations))
      throw Error("Illustrations invalides.");
    for (const [id, pictures] of Object.entries(story.illustrations)) {
      const scene = story.scenes[id];
      if (!scene || !Array.isArray(pictures) || pictures.some((picture) =>
        !picture || !Number.isInteger(picture.after) || picture.after < 0 || picture.after >= scene.paragraphs.length
        || typeof picture.src !== "string" || !/^illustrations\/[a-zA-Z0-9_/-]+\.webp$/.test(picture.src)
        || picture.src.includes("..") || typeof picture.alt !== "string" || !picture.alt.trim()
        || !Number.isInteger(picture.width) || picture.width <= 0
        || !Number.isInteger(picture.height) || picture.height <= 0
        || (picture.caption !== undefined && (typeof picture.caption !== "string" || !picture.caption.trim()))
      )) throw Error(`Illustration invalide : ${id}`);
    }
  }
  return story;
}
export function replay(story, decisions = []) {
  const variables = { ...story.variables },
    blocks = [],
    accepted = [],
    visited = new Set();
  let id = story.chapters[0].start;
  while (id) {
    if (visited.has(id)) throw Error("Boucle narrative détectée.");
    visited.add(id);
    const scene = story.scenes[id];
    if (!scene) throw Error(`Scène manquante : ${id}`);
    blocks.push({ id, scene });
    if (scene.ending)
      return {
        blocks,
        decisions: accepted,
        variables,
        ending: scene.ending,
        pending: null,
      };
    if (scene.choice) {
      // Archived answers remain replayable for published saves, but cannot be
      // selected in a new reading. Locked answers are displayed separately.
      const eligible = scene.choice.options.filter((o) => matches(o.when, variables));
      const options = eligible.filter((o) => !o.retired);
      const unavailableOptions = scene.choice.options.filter((o) => !o.retired && o.disabledReason && !matches(o.when, variables));
      if (!options.length) throw Error("Aucun choix disponible.");
      const decision = decisions[accepted.length];
      const option =
        decision?.scene === id && eligible.find((o) => o.id === decision.option);
      if (!option)
        return {
          blocks,
          decisions: accepted,
          variables,
          pending: { scene: id, ...scene.choice, options, unavailableOptions },
        };
      blocks.at(-1).selected = option;
      accepted.push({ scene: id, option: option.id });
      Object.assign(variables, option.set || {});
      id = option.next;
    } else if (scene.routes) {
      id = scene.routes.find((r) => matches(r.when, variables))?.next;
      if (!id) throw Error("Aucune suite valide.");
    } else id = scene.next;
  }
  throw Error("Récit sans conclusion.");
}
export function choose(story, decisions, scene, option) {
  const current = replay(story, decisions);
  if (
    current.pending?.scene !== scene ||
    !current.pending.options.some((o) => o.id === option)
  )
    throw Error("Choix indisponible.");
  return replay(story, [...current.decisions, { scene, option }]);
}

// Original paragraph keys remain stable when a published scene is expanded.
// The same ordered prose powers rendering, bookmarks and reading-length audits.
export function narrativeProse(scene) {
  const result = [];
  for (let i = 0; i <= scene.paragraphs.length; i++) {
    (scene.insertions || []).forEach((part, slot) => {
      if (part.before === i) part.paragraphs.forEach((text, n) => result.push({ key: `e${slot}-p${n}`, text }));
    });
    if (i < scene.paragraphs.length) result.push({ key: `p${i}`, text: scene.paragraphs[i] });
  }
  return result;
}
