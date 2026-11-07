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

L’application s’ouvre sur son écran d’accueil et ses quatre rubriques, même lorsqu’une lecture est en cours. Toucher le logo **Éclats** ramène à cet accueil. Le bouton **☰**, disponible dans les autres écrans, ouvre le menu principal : **Bibliothèque** présente les récits disponibles et ouvre leur fiche de chapitres, **Lectures** retrouve le lecteur et sa position, **Journal de personnage** réserve un espace pour une prochaine étape, et **Paramètres** ouvre les réglages de lecture. Le récit et ses décisions sont conservés pendant les allers-retours.

- Faire défiler le roman. Cocher un chemin ne le valide pas : appuyer ensuite sur **Confirmer ce chemin**.
- La réponse devient un paragraphe du livre. Les nouvelles scènes sont ajoutées en dessous ; le texte déjà présent est conservé.
- **Aa** règle la taille de 16 à 28 px et le thème jour, nuit ou système. Le texte reste aligné à gauche pour préserver les espaces sur les écrans étroits.
- **↶** liste les décisions. Le lien après chaque passage choisi permet aussi d’y revenir. Sélectionner un autre chemin puis confirmer le remplacement. Annuler ou fermer la fenêtre conserve tout le récit. Confirmer supprime toutes les décisions suivantes, même lorsqu’un embranchement rejoint plus loin la même scène.
- La fiche d’un roman liste tous ses chapitres. Ceux qui ne figurent pas encore dans le parcours sont grisés, désactivés et marqués **Inaccessible**. Un chapitre devient accessible lorsque le récit l’atteint après les décisions précédentes. Choisir un chapitre accessible déplace la lecture à son titre sans réinitialiser les décisions. Modifier une ancienne décision annule la suite et recalcule aussi les accès aux chapitres.
- La sauvegarde locale contient les décisions, le chapitre et un repère de paragraphe avec un décalage de lecture. Elle est enregistrée après chaque décision, lors du défilement et à la fermeture. Les préférences sont enregistrées séparément. Chaque livre conserve sa propre progression.
- Une sauvegarde endommagée ou d’une autre version du récit est signalée puis remplacée par une lecture neuve. Une erreur de stockage est signalée sans bloquer la lecture.

## Architecture

Pas de framework d’interface ni de backend. Vite sert et construit les modules JavaScript ; les dépendances sont utilisées uniquement pendant le développement.

- `src/engine.js` : validation structurelle, conditions et relecture déterministe des décisions. Indépendant du DOM et du stockage.
- `src/main.js` : interface accessible, confirmations, fenêtres natives, position de lecture, installation et mises à jour.
- `src/storage.js` : contrat des sauvegardes versionnées, isolées par livre.
- `src/chapters.js` : accès aux chapitres dérivé du parcours narratif, sans compteur de déblocage indépendant.
- `src/catalog.js` : catalogue local, livre sélectionné et métadonnées de bibliothèque.
- `src/style.css` : mise en page mobile, thèmes et respect de `prefers-reduced-motion`.
- `public/stories/accords-du-crepuscule.json` : 33 chapitres en deux cycles, avec cinq interactions par chapitre. Les treize premiers chapitres conservent leur texte et leurs choix (environ 15 à 20 minutes à 220 mots/minute). Le second cycle, chapitres 14 à 33, propose des épisodes plus courts : environ 5 à 7 minutes de lecture hors réflexion, avec au moins cinq réponses par interaction. Les trois conclusions originales sont conservées comme fins du premier cycle ; les anciennes sauvegardes de 65 décisions poursuivent au chapitre 14, sans réinitialisation. Le nouveau projet sélectionné au chapitre 30 conduit à trois conclusions du second cycle. Les aides de lecture restent facultatives et locales à la scène débloquée. L’audit du graphe vérifie les continuations, les chapitres accessibles, les longueurs et le nombre d’interactions sur tous les états narratifs distincts.
- `scripts/build-sw.js` : génère le cache hors connexion à partir de **tous** les fichiers réellement construits et de leur empreinte.

La lecture affiche un seul chapitre par page. Les boutons « Chapitre suivant » et « Chapitre précédent » changent de page sans modifier les décisions ; le suivant apparaît uniquement une fois débloqué. Les chapitres 2 à 33 commencent par un court résumé statique du précédent (`chapterRecaps`), dont les variantes utilisent uniquement les décisions antérieures au chapitre affiché. Le chapitre et le repère de paragraphe restent sauvegardés dans le format existant. Le DOM des scènes du chapitre affiché est conservé quand une suite est ajoutée. Les paragraphes débloqués apparaissent avec un fondu de 300 ms, échelonné de 45 ms (plafonné à 225 ms). Aucune animation en mode de réduction des mouvements.

## Format des récits JSON (v1)

Pour préparer un autre récit, utiliser le même format que `public/stories/accords-du-crepuscule.json` puis appeler `validateStory` avant `replay`. Le chargement est centralisé dans `start()` à partir du catalogue `src/catalog.js`. Ajouter un récit JSON puis son entrée au catalogue le rend disponible dans la bibliothèque. Le paramètre `?story=<id>` sélectionne un livre ; le livre sélectionné est mémorisé localement. Il n’y a pas encore de bouton d’import de fichiers externes.

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

Rejouer les décisions reconstruit les variables depuis leurs valeurs initiales. Une sauvegarde ne peut donc pas injecter des variables arbitraires ni des choix devenus indisponibles. Incrémenter `version` lorsqu’une modification rend les anciennes décisions incompatibles. Adapter le test d’exploration exhaustive lorsqu’un nouveau contenu est ajouté.

## PWA et mises à jour

L’application fonctionne sous HTTPS (ou localhost pour le développement). Le manifest utilise des chemins relatifs et des icônes PNG 192/512, avec une zone de sécurité pour les masques Android. Leur source SVG et un script de régénération optionnel avec Pillow sont inclus ; Python n’est pas requis pour construire l’application.

Après une première ouverture en ligne et l’installation réussie du service worker, les fichiers, icônes et récit sont disponibles hors connexion. Une nouvelle version reste en attente : un bouton **Mettre à jour** propose son activation. La progression est sauvegardée avant le rechargement. L’ancien cache n’est supprimé qu’à l’activation ; un téléchargement incomplet ne remplace pas l’édition active. L’interface et le récit JSON sont servis depuis la même édition pour éviter leur mélange. Les sauvegardes localStorage sont indépendantes du cache. Le récit de démonstration a été retiré du catalogue et des ressources publiques. Les anciens réglages qui le sélectionnaient reviennent au roman disponible ; aucune donnée locale sans rapport n’est effacée. Les tests du moteur utilisent un petit graphe synthétique interne, absent du build.

Sur Android/Chrome, utiliser le bouton d’installation lorsqu’il est proposé, ou le menu du navigateur « Installer l’application » / « Ajouter à l’écran d’accueil ». L’installation native et le comportement réel sous Android doivent aussi être vérifiés sur un appareil avant une diffusion publique.

Si une ancienne version installée reste affichée, ouvrir `actualiser.html` sous le chemin de l’application et appuyer sur **Actualiser Éclats**. Cette page vérifie les fichiers en ligne, retire uniquement le service worker d’Éclats et recharge une page neuve, sans supprimer localStorage ni les sauvegardes. En cas d’écran blanc, le même parcours est disponible directement dans `reparer.html`. Un écran de secours reste affiché si le code du lecteur ne peut pas démarrer.

## Publier sur GitHub Pages

1. Pousser les fichiers sur la branche `main` du dépôt `SadBaby17/Eclats`.
2. Dans **Settings → Pages → Build and deployment**, sélectionner **GitHub Actions**.
3. Le workflow `.github/workflows/pages.yml` exécute les tests moteur et navigateur, construit `dist` puis déploie après réussite.
4. L’application sera servie sous `https://sadbaby17.github.io/Eclats/`.

Aucune publication n’est effectuée par les commandes locales. Pour un hébergement à un autre chemin, modifier `base` dans `vite.config.js`. Les ressources du manifest et le périmètre du service worker restent relatifs.

## Limites de cette V1

Un roman complet de treize chapitres, pas de compte ni synchronisation. Effacer les données du navigateur supprime la progression ; le mode privé peut ne pas la conserver. Pas de fusion de modifications simultanées dans plusieurs onglets (la dernière sauvegarde gagne). Le repère de lecture résiste aux réglages usuels, mais un changement important d’écran peut modifier légèrement la position visuelle. Pas de retour automatique à une ancienne progression après confirmation d’un remplacement. Pas de création de personnage, mécanique JDR ni génération de texte. Le tableau de bord d’auteur et les notes de préparation restent en dehors des fichiers publics et du dépôt.
