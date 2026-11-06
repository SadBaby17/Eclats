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
        options.add(o.id);
        target(o.next);
      }
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
      const options = scene.choice.options.filter((o) =>
        matches(o.when, variables),
      );
      if (!options.length) throw Error("Aucun choix disponible.");
      const decision = decisions[accepted.length];
      const option =
        decision?.scene === id && options.find((o) => o.id === decision.option);
      if (!option)
        return {
          blocks,
          decisions: accepted,
          variables,
          pending: { scene: id, ...scene.choice, options },
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
