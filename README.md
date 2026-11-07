# Éclats

Un lecteur de romans interactifs, pensé pour le téléphone. La lecture reste un texte continu : les décisions sont rares, confirmées explicitement, puis intégrées à la narration. Aucun texte n’est généré par IA pendant la lecture.

## Développer

Prérequis : Node.js 22.12+ ou 24 LTS, npm. Aucun compte, serveur de données ou secret requis.

```sh
npm ci
npm run dev
```

Ouvrir le chemin `/Eclats/` sur le serveur indiqué. Le service worker est désactivé en développement pour éviter les anciens fichiers en cache.

```sh
npm test                      # moteur, parcours exhaustifs et sauvegardes
npx playwright install chromium
npm run test:e2e               # navigateur Chromium, profil Pixel 7, build de production
npm run build                 # sortie statique dist/, service worker inclus
npm run preview               # vérifier la production au chemin /Eclats/
```

Si Chromium est déjà installé, utiliser `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`. Dans un environnement aux répertoires utilisateur protégés, ajouter `--cache /workspace/.npm-cache` à `npm ci`.

Les tests navigateur lancent leur propre serveur sur le port 4173. Les captures et erreurs sont écrites dans `test-results/`, ignoré par Git.

## Utilisation

L’application s’ouvre sur son écran d’accueil et ses quatre rubriques, même lorsqu’une lecture est en cours. Toucher le logo **Éclats** ramène à cet accueil. Le bouton **☰**, disponible dans les autres écrans, ouvre le menu principal : **Bibliothèque** présente le livre de démonstration, **Lectures** retrouve le lecteur et sa position, **Journal de personnage** réserve un espace pour une prochaine étape, et **Paramètres** ouvre les réglages de lecture. Le récit et ses décisions sont conservés pendant les allers-retours.

- Faire défiler le roman. Cocher un chemin ne le valide pas : appuyer ensuite sur **Confirmer ce chemin**.
- La réponse devient un paragraphe du livre. Les nouvelles scènes sont ajoutées en dessous ; le texte déjà présent est conservé.
- **Aa** règle la taille de 16 à 28 px et le thème jour, nuit ou système. Le texte reste aligné à gauche pour préserver les espaces sur les écrans étroits.
- **↶** liste les décisions. Le lien après chaque passage choisi permet aussi d’y revenir. Sélectionner un autre chemin puis confirmer le remplacement. Annuler ou fermer la fenêtre conserve tout le récit. Confirmer supprime toutes les décisions suivantes, même lorsqu’un embranchement rejoint plus loin la même scène.
- La sauvegarde locale contient les décisions, le chapitre et un repère de paragraphe avec un décalage de lecture. Elle est enregistrée après chaque décision, lors du défilement et à la fermeture. Les préférences sont enregistrées séparément.
- Une sauvegarde endommagée ou d’une autre version du récit est signalée puis remplacée par une lecture neuve. Une erreur de stockage est signalée sans bloquer la lecture.

## Architecture

Pas de framework d’interface ni de backend. Vite sert et construit les modules JavaScript ; les dépendances sont utilisées uniquement pendant le développement.

- `src/engine.js` : validation structurelle, conditions et relecture déterministe des décisions. Indépendant du DOM et du stockage.
- `src/main.js` : interface accessible, confirmations, fenêtres natives, position de lecture, installation et mises à jour.
- `src/storage.js` : contrat des sauvegardes versionnées.
- `src/style.css` : mise en page mobile, thèmes et respect de `prefers-reduced-motion`.
- `public/stories/demo.json` : chapitre de démonstration entièrement écrit à l’avance. Deux bifurcations rejoignent des scènes communes ; les variables conditionnent une scène ultérieure et ses options ; deux conclusions, huit parcours complets.
- `scripts/build-sw.js` : génère le cache hors connexion à partir de **tous** les fichiers réellement construits et de leur empreinte.

Le DOM des scènes déjà lues est conservé quand une suite est ajoutée. Les paragraphes débloqués apparaissent avec un fondu de 300 ms, échelonné de 45 ms (plafonné à 225 ms). Aucune animation en mode de réduction des mouvements.

## Format des récits JSON (v1)

Pour préparer un autre récit, utiliser le même format que `public/stories/demo.json` puis appeler `validateStory` avant `replay`. Le chargement de la démo est centralisé dans `start()` ; il peut être remplacé ultérieurement par un import ou un catalogue. Il n’y a pas encore de bibliothèque ni de bouton d’import dans cette V1.

```json
{
  "format": 1,
  "id": "mon-roman",
  "version": 1,
  "title": "Mon roman",
  "subtitle": "Une histoire à découvrir",
  "variables": { "confiance": false },
  "chapters": [
    { "id": "c1", "number": 1, "title": "Le départ", "start": "accueil" }
  ],
  "scenes": {
    "accueil": {
      "chapter": "c1",
      "paragraphs": ["Un véritable passage narratif…"],
      "choice": {
        "prompt": "Quel chemin prendre ?",
        "options": [
          {
            "id": "rester",
            "label": "Rester",
            "passage": "Elle décida de rester.",
            "set": { "confiance": true },
            "next": "retour"
          },
          {
            "id": "partir",
            "label": "Partir",
            "passage": "Elle reprit la route.",
            "next": "retour"
          }
        ]
      }
    },
    "retour": {
      "chapter": "c1",
      "paragraphs": ["La suite du récit…"],
      "ending": "Une nouvelle journée"
    }
  }
}
```

Chaque scène possède exactement une sortie :

| Champ                                                                       | Effet                                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `next: "id"`                                                                | Enchaîner sans interaction                                                                             |
| `choice: { prompt, options }`                                               | Attendre une décision confirmée                                                                        |
| `routes: [{ when: { variable: valeur }, next: "id" }, { next: "secours" }]` | Première route dont toutes les conditions sont satisfaites ; dernière route sans condition obligatoire |
| `ending: "Titre"`                                                           | Conclusion                                                                                             |

Les options acceptent également `when`, une égalité stricte pour chaque variable demandée. `set` remplace les valeurs après validation de l’option. Préférer des valeurs primitives JSON. Au moins une option doit rester disponible dans chaque état accessible. Les références doivent pointer vers des scènes existantes ; les identifiants d’options sont uniques par scène. Le moteur refuse les boucles : cette V1 modélise des romans à graphe acyclique. Les chapitres s’enchaînent par `next` ; `chapter` détermine leur titre dans le flux. Le récit commence au `start` du premier chapitre.

Rejouer les décisions reconstruit les variables depuis leurs valeurs initiales. Une sauvegarde ne peut donc pas injecter des variables arbitraires ni des choix devenus indisponibles. Incrémenter `version` lorsqu’une modification rend les anciennes décisions incompatibles. Adapter le test d’exploration exhaustive lorsqu’un nouveau contenu remplace la démo.

## PWA et mises à jour

L’application fonctionne sous HTTPS (ou localhost pour le développement). Le manifest utilise des chemins relatifs et des icônes PNG 192/512, avec une zone de sécurité pour les masques Android. Leur source SVG et un script de régénération optionnel avec Pillow sont inclus ; Python n’est pas requis pour construire l’application.

Après une première ouverture en ligne et l’installation réussie du service worker, les fichiers, icônes et récit sont disponibles hors connexion. Une nouvelle version reste en attente : un bouton **Mettre à jour** propose son activation. La progression est sauvegardée avant le rechargement. L’ancien cache n’est supprimé qu’à l’activation ; un téléchargement incomplet ne remplace pas l’édition active. L’interface et le récit JSON sont servis depuis la même édition pour éviter leur mélange. Les sauvegardes localStorage sont indépendantes du cache.

Sur Android/Chrome, utiliser le bouton d’installation lorsqu’il est proposé, ou le menu du navigateur « Installer l’application » / « Ajouter à l’écran d’accueil ». L’installation native et le comportement réel sous Android doivent aussi être vérifiés sur un appareil avant une diffusion publique.

## Publier sur GitHub Pages

1. Pousser les fichiers sur la branche `main` du dépôt `SadBaby17/Eclats`.
2. Dans **Settings → Pages → Build and deployment**, sélectionner **GitHub Actions**.
3. Le workflow `.github/workflows/pages.yml` exécute les tests moteur et navigateur, construit `dist` puis déploie après réussite.
4. L’application sera servie sous `https://sadbaby17.github.io/Eclats/`.

Aucune publication n’est effectuée par les commandes locales. Pour un hébergement à un autre chemin, modifier `base` dans `vite.config.js`. Les ressources du manifest et le périmètre du service worker restent relatifs.

## Limites de cette V1

Une seule nouvelle de démonstration, pas de compte ni synchronisation. Effacer les données du navigateur supprime la progression ; le mode privé peut ne pas la conserver. Pas de fusion de modifications simultanées dans plusieurs onglets (la dernière sauvegarde gagne). Le repère de lecture résiste aux réglages usuels, mais un changement important d’écran peut modifier légèrement la position visuelle. Pas de retour automatique à une ancienne progression après confirmation d’un remplacement. Aucune bibliothèque, création de personnage, mécanique JDR ni génération de texte.
