# Publication Avahi / résolution du hostname

Remplacé par le script idempotent `tools/provisioning/setup-box-network.sh` (à lancer en root, une fois par box) :

```bash
sudo tools/provisioning/setup-box-network.sh <box-host> [wifi-iface] [eth-iface]
```

Il configure :
- le hostname (`hostnamectl` + `/etc/hosts`) ;
- `/etc/avahi/avahi-daemon.conf` : `allow-interfaces=<wifi>,<eth>` (sinon la box disparaît du réseau local
  quand le hotspot démarre, alors qu'elle y reste joignable par câble) ;
- `/etc/avahi/services/https.service` : découverte `_https._tcp` sur 443 (Caddy), txt `id=<box-host>` ;
- `/etc/NetworkManager/dnsmasq-shared.d/cleveremote-box.conf` : réponse DNS unicast `<box-host>.local`
  aux clients du hotspot (Android, Windows), qui ne résolvent pas `.local` en mDNS.

Si le hostname change, régénérer ensuite le certificat : `sudo tools/certs-generator/gen-pi-cert.sh <box-host>`.
