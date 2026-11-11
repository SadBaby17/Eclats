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
    label: "Aventure complète · 13 chapitres",
    description:
      "Une nouvelle aventure d'Evan, Diva et Tam-Tam dans l'univers d'Elyrion. Treize chapitres, une aventure complète à découvrir.",
  },
  {
    id: "helio-a-mains-nues",
    file: "helio-a-mains-nues.json",
    title: "Hélio — À mains nues",
    cover: "Hélio\nÀ mains nues",
    label: "Univers inédit · 8 chapitres",
    description:
      "À Brévane, la magie accompagne chaque geste du quotidien. Hélio, graveur de runes aussi solaire qu'inventif, découvre que certains choix laissent des traces bien après l'aventure.",
  },
];
export const SELECTED_BOOK_KEY = "eclats.selected-book.v1";
export function findBook(id) {
  return BOOKS.find((book) => book.id === id);
}
