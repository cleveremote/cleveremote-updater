# Setup système requis — hotspot WiFi (hors dépôt versionné)

Le démarrage automatique du hotspot (`WifiService.onApplicationBootstrap`) appelle `nmcli`
pour activer une connexion partagée (AP). Par défaut, NetworkManager/polkit refuse cette
action pour un process non-root :

```
Error: Connection activation failed: Not authorized to share connections via wifi.
```

Ce document décrit la configuration système à appliquer **manuellement sur chaque appareil**
(elle vit hors du dépôt, dans `/etc`, donc n'est pas versionnée ni déployée par l'app).

## 1. Prérequis

L'utilisateur qui exécute le service Node (ex. `clv`) doit appartenir au groupe `netdev` :

```bash
groups <user>          # vérifier
sudo usermod -aG netdev <user>   # si absent, puis relog/redémarrer la session
```

## 2. Règle polkit

Créer (ou compléter s'il existe déjà vide) le fichier suivant :

`/etc/polkit-1/rules.d/50-nmcli.rules`

```js
polkit.addRule(function(action, subject) {
    if (action.id.indexOf("org.freedesktop.NetworkManager.") === 0 &&
        subject.isInGroup("netdev")) {
        return polkit.Result.YES;
    }
});
```

Commandes :

```bash
sudo tee /etc/polkit-1/rules.d/50-nmcli.rules > /dev/null <<'EOF'
polkit.addRule(function(action, subject) {
    if (action.id.indexOf("org.freedesktop.NetworkManager.") === 0 &&
        subject.isInGroup("netdev")) {
        return polkit.Result.YES;
    }
});
EOF

sudo chown root:polkitd /etc/polkit-1/rules.d/50-nmcli.rules
sudo chmod 640 /etc/polkit-1/rules.d/50-nmcli.rules
sudo systemctl restart polkit
```

> Cette règle autorise **tout le groupe `netdev`** sur **toutes** les actions
> `org.freedesktop.NetworkManager.*` sans authentification. C'est volontairement large pour
> couvrir `wifi.share.protected` (activation d'un AP). À restreindre si le device est
> multi-utilisateur ou exposé.

## 3. Vérification

```bash
sudo systemctl status polkit --no-pager   # doit être "active (running)"
sudo od -c /etc/polkit-1/rules.d/50-nmcli.rules   # vérifier que le fichier n'est pas vide
```

Puis relancer l'application et vérifier dans les logs que `startHotspot` (déclenché par
`onApplicationBootstrap` si aucune connexion active) ne renvoie plus l'erreur
`Not authorized to share connections via wifi`.

## 4. À reproduire sur chaque nouvel appareil

Cette configuration n'étant pas dans le dépôt, elle doit être :
- soit appliquée manuellement selon ce document à chaque provisioning d'un nouvel appareil,
- soit intégrée dans le script/image de provisioning (ex. Ansible, image Raspberry Pi
  pré-configurée, script `postinstall`) — **à faire si ce n'est pas déjà le cas**, pour éviter
  une régression silencieuse sur les prochains appareils.
