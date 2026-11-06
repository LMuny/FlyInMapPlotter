# Fly-in Map Plotter

Éditeur visuel de cartes pour le projet Fly-in : place des hubs, relie-les, vérifie la carte et exporte le fichier `.txt`.

## Lancer
Double-clique sur `fly-in-map-plotter.html`. Aucune installation ni connexion Internet nécessaire.

Ce fichier contient toute l'application : tu peux le déplacer ou l'envoyer seul. Ta carte en cours est enregistrée automatiquement dans le navigateur.

## Démarrer une carte
1. Clique sur **New**, puis sur la grille : le premier hub devient le départ, le deuxième l'arrivée.
2. Appuie sur **L** et glisse d'un hub à l'autre pour les relier.
3. Appuie sur **Ctrl+S** pour enregistrer le `.txt`.

Pour ouvrir une carte existante, dépose le fichier `.txt` sur la fenêtre ou colle son contenu avec **Ctrl+V**.

## Raccourcis
V sélection · H ajouter un hub · L connecter · Suppr effacer · flèches déplacer · Ctrl+Z / Ctrl+Y annuler / rétablir · Ctrl+S enregistrer · Ctrl+O importer · Ctrl+V coller une carte

## Modifier le code
- `index.html` — structure de la page
- `css/style.css` — style (thème clair / sombre automatique)
- `js/core.js` — logique de la carte : parsing, export, vérifications, plus court chemin
- `js/app.js` — interface : dessin, outils, inspecteur, import / export
- `build.py` — régénère `fly-in-map-plotter.html`

`index.html` s'ouvre directement pendant le développement. Après une modification, lance `python3 build.py` pour mettre à jour le fichier unique.
