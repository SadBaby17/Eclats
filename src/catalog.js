export const BOOKS = [
  {
    id: "accords-du-crepuscule",
    file: "accords-du-crepuscule.json",
    title: "Les Accords du Crépuscule",
    cover: "Les Accords\ndu Crépuscule",
    label: "Deux cycles · 33 chapitres",
    description:
      "À Noctarion, Evan, jeune musicien hybride, cherche une place pour lui et ses deux compagnons. Un roman dans l’univers d’Elyrion.",
  },
  {
    id: "evan-deuxieme-version",
    file: "evan-deuxieme-version.json",
    title: "Evan — Deuxième version",
    cover: "Evan\nDeuxième version",
    label: "Nouvelle histoire · 3 premiers chapitres",
    description:
      "Une nouvelle aventure d'Evan, Diva et Tam-Tam dans l'univers d'Elyrion. Trois premiers chapitres à découvrir.",
  },
];
export const SELECTED_BOOK_KEY = "eclats.selected-book.v1";
export function findBook(id) {
  return BOOKS.find((book) => book.id === id);
}
