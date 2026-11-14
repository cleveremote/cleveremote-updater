# Génération de l'exécutable autonome (SEA)

`npm run build:sea` produit un exécutable Node.js autonome (aucune installation
de Node.js requise sur la machine cible) dans `release/<platform>-<arch>/`.

Même mécanisme que pour `cleveremote-box` (`scripts/build-sea.js`).

## Étapes

1. Se placer sur la machine correspondant à la plateforme cible (voir
   "Limite : pas de cross-compilation" ci-dessous).

2. Sélectionner la version de Node du projet (`node --build-sea` nécessite
   la version de `.nvmrc`) :

   ```bash
   nvm use
   ```

3. S'assurer que les dépendances sont installées et que les modules natifs
   sont compilés pour cette machine :

   ```bash
   npm install
   ```

   (`npm run build:sea` vérifie automatiquement que les modules natifs se
   chargent correctement et relance `npm rebuild` si besoin — mais un
   `npm install` propre en amont évite les surprises.)

4. Lancer le build :

   ```bash
   npm run build:sea
   ```

5. Résultat dans `release/<platform>-<arch>/` :
   - `cleveremote-updater` (ou `.exe` sous Windows) — l'exécutable
   - `node_modules/` — dépendances de production (y compris les binaires
     natifs : bcrypt, epoll)
   - `.env` — copié depuis la racine du projet

## Déploiement

Copier **tout le dossier** `release/<platform>-<arch>/` (pas seulement le
binaire) sur la machine cible, puis :

```bash
cd cleveremote-updater-linux-arm64   # ou le nom que vous avez donné au dossier copié
./cleveremote-updater
```

Rien d'autre n'est nécessaire — pas de Node.js à installer sur la cible.

Configuration : le binaire lit `.env` (et `.env.local`, prioritaire, s'il
existe) **à côté de l'exécutable**, quel que soit le répertoire courant
(`src/app.module.ts`). Les variables d'environnement déjà définies (systemd,
shell…) restent prioritaires sur ces fichiers.

> Le `.env` est **versionné** : c'est celui du dépôt qui est copié dans la
> release, y compris en CI (archive déposée sur S3 par `deploy-sea-s3.yml`).
> Ne pas y mettre de secret propre à une machine : les surcharges locales vont
> dans `.env.local` (non versionné), à déposer à côté de l'exécutable sur la cible.

## GPIO (LED de statut, bouton recovery)

`onoff` est importé directement par l'application
(`src/common/tools/gpio-*.ts`), il est donc **toujours** embarqué dans la
release. Son addon natif `epoll` n'est compilé (et vérifié par le script)
que sous Linux. Hors Raspberry Pi, `Gpio.accessible` vaut `false` : la LED et
le bouton deviennent inertes, sans erreur.

## Limite : pas de cross-compilation

Ce script utilise le mécanisme natif **Node SEA** (`node --build-sea`), pas un
outil comme `pkg`. Concrètement :

- Le binaire produit **embarque le binaire Node exact de la machine qui a
  lancé le build** → il ne tourne que sur le même OS + architecture CPU.
- Les modules natifs (epoll, bcrypt) sont des fichiers `.node` compilés pour
  cette même machine → eux non plus ne sont pas portables d'une architecture
  à l'autre.

**Donc pour générer un exécutable pour une autre plateforme (ex : un
Raspberry Pi 32 bits armv7, un serveur x64...), il faut lancer
`npm run build:sea` directement sur une machine de cette plateforme** (ou une
VM/conteneur qui matche exactement l'OS + l'architecture cible).

Le script nomme automatiquement le dossier de sortie `release/<platform>-<arch>`
(ex : `linux-arm64`, `linux-arm`, `linux-x64`) pour éviter d'écraser un build
précédent d'une autre plateforme.

## Dépannage

- **Modules natifs qui échouent à charger** : le script tente un `npm
  rebuild` automatique. S'il échoue toujours, vérifier que les outils de
  compilation sont présents sur la machine (`python3`, `make`, `g++`).
  Attention : après ce rebuild, `node_modules` est compilé pour la version de
  Node du build (`.nvmrc`) — utiliser la même version en dev (`nvm use`).
- **Le binaire démarre mais ne produit aucune sortie** : les logs sont
  bufferisés jusqu'à la fin de l'initialisation de Nest, qui attend la
  connexion MongoDB (`MONGO_URI`, 9 tentatives par défaut). Vérifier que le
  `.env` est bien à côté de l'exécutable et que MongoDB est joignable.
- **`NODE_ENV`** : le binaire force `NODE_ENV=production` par défaut (voir
  `scripts/sea-prelude.js`) pour éviter que `nestjs-pino` utilise le
  transport `pino-pretty`, qui passe par un worker thread — connu pour se
  bloquer silencieusement dans un binaire SEA.
