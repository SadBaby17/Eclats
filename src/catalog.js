export const BOOKS = [
  {
    id: "accords-du-crepuscule",
    file: "accords-du-crepuscule.json",
    title: "Les Accords du Crépuscule",
    cover: "Les Accords\ndu Crépuscule",
    label: "Roman · Chapitres 1 à 8",
    description:
      "À Noctarion, Evan, jeune musicien hybride, cherche une place pour lui et ses deux compagnons. Un roman dans l’univers d’Elyrion.",
  },
];
export const SELECTED_BOOK_KEY = "eclats.selected-book.v1";
export function findBook(id) {
  return BOOKS.find((book) => book.id === id);
}
