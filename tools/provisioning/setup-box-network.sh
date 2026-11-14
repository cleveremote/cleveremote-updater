#!/bin/bash
# À exécuter en root, une fois par box (idempotent : peut être relancé sans risque).
#
# Usage : sudo ./setup-box-network.sh [box-host] [wifi-iface] [eth-iface]
#   box-host   : hostname de la box (défaut : hostname actuel), mis en minuscules
#   wifi-iface : interface du hotspot (défaut : wlan0, = WIFI_INTERFACE de l'app)
#   eth-iface  : interface Ethernet (défaut : eth0)
#
# Rend la box joignable en https://<box-host>.local quel que soit le mode réseau :
#   - réseau client : mDNS via Avahi, sur le WiFi ET l'Ethernet (quand le hotspot
#                     démarre, wlan0 quitte le réseau local : seul eth0 y reste)
#   - hotspot       : mDNS via Avahi + DNS unicast via le dnsmasq de NetworkManager
#                     (Android, Windows en profil "Public" ne résolvent pas .local en mDNS)
# Avahi et dnsmasq suivent eux-mêmes l'IP courante des interfaces : rien à régénérer
# quand la box bascule entre client et hotspot.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Erreur : ce script doit être exécuté en root (sudo)." >&2
  exit 1
fi

BOX_HOST="$(echo "${1:-$(hostname -s)}" | tr '[:upper:]' '[:lower:]')"
WIFI_IFACE="${2:-wlan0}"
ETH_IFACE="${3:-eth0}"

if ! [[ "${BOX_HOST}" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
  echo "Erreur : hostname invalide '${BOX_HOST}' (lettres, chiffres, tirets ; 63 caractères max)." >&2
  exit 1
fi

AVAHI_DAEMON_CONF="/etc/avahi/avahi-daemon.conf"
AVAHI_SERVICE_FILE="/etc/avahi/services/https.service"
DNSMASQ_SHARED_DIR="/etc/NetworkManager/dnsmasq-shared.d"
# Chemin lu par l'app au démarrage : WIFI_HOTSPOT_DNSMASQ_CONF_PATH (src/modules/wifi/wifi.constants.ts)
DNSMASQ_CONF_FILE="${DNSMASQ_SHARED_DIR}/cleveremote-box.conf"

PREVIOUS_HOST="$(hostname -s)"

echo "Hostname    : ${BOX_HOST}.local (actuel : ${PREVIOUS_HOST})"
echo "Interfaces  : ${WIFI_IFACE} (WiFi/hotspot), ${ETH_IFACE} (Ethernet)"

# --- 1. Hostname -------------------------------------------------------------
hostnamectl set-hostname "${BOX_HOST}"
if grep -q '^127\.0\.1\.1' /etc/hosts; then
  sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t${BOX_HOST}/" /etc/hosts
else
  printf '127.0.1.1\t%s\n' "${BOX_HOST}" >> /etc/hosts
fi
echo "  hostname et /etc/hosts à jour"

# --- 2. Interfaces écoutées par Avahi ---------------------------------------------
# WiFi + Ethernet uniquement : docker0/veth* exclues (sinon Avahi y annoncerait 172.17.x).
# Une interface absente (box sans câble) est simplement ignorée par Avahi.
if [ ! -f "${AVAHI_DAEMON_CONF}" ]; then
  echo "Erreur : ${AVAHI_DAEMON_CONF} introuvable (avahi-daemon installé ?)." >&2
  exit 1
fi
AVAHI_ALLOW="allow-interfaces=${WIFI_IFACE},${ETH_IFACE}"
if grep -qE '^#?allow-interfaces=' "${AVAHI_DAEMON_CONF}"; then
  sed -i -E "0,/^#?allow-interfaces=.*/s//${AVAHI_ALLOW}/" "${AVAHI_DAEMON_CONF}"
else
  sed -i "/^\[server\]/a ${AVAHI_ALLOW}" "${AVAHI_DAEMON_CONF}"
fi
echo "  ${AVAHI_DAEMON_CONF} : ${AVAHI_ALLOW}"

# --- 3. Service de découverte publié par Avahi --------------------------------
# Une seule instance _https._tcp, sur le port de Caddy (443). Le txt "id" est celui
# que publiait auparavant l'app via bonjour-service.
mkdir -p "$(dirname "${AVAHI_SERVICE_FILE}")"
cat > "${AVAHI_SERVICE_FILE}" <<EOF
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<!-- Généré par tools/provisioning/setup-box-network.sh -->
<service-group>
  <name replace-wildcards="yes">%h</name>
  <service>
    <type>_https._tcp</type>
    <port>443</port>
    <txt-record>id=${BOX_HOST}</txt-record>
  </service>
</service-group>
EOF
echo "  ${AVAHI_SERVICE_FILE} écrit"

# --- 4. DNS unicast pour les clients du hotspot ---------------------------------
# interface-name : renvoie l'IPv4 courante de l'interface (suit les changements d'IP)
# local=/local/  : les autres noms .local ne sont jamais transmis aux DNS amont
mkdir -p "${DNSMASQ_SHARED_DIR}"
cat > "${DNSMASQ_CONF_FILE}" <<EOF
# Généré par tools/provisioning/setup-box-network.sh
# Réponse DNS unicast aux clients du hotspot (Android/Windows ne font pas de mDNS)
interface-name=${BOX_HOST}.local,${WIFI_IFACE}/4
local=/local/
EOF
chmod 644 "${DNSMASQ_CONF_FILE}"
echo "  ${DNSMASQ_CONF_FILE} écrit"

# --- 5. Prise en compte -----------------------------------------------------------
systemctl restart avahi-daemon
echo "  avahi-daemon redémarré"
echo
echo "dnsmasq lit ${DNSMASQ_SHARED_DIR} à chaque démarrage du hotspot :"
echo "la config s'applique au prochain hotspot/start (ou appui long sur le bouton)."

if [ "${PREVIOUS_HOST}" != "${BOX_HOST}" ]; then
  echo
  echo "Le hostname a changé : régénérer le certificat Caddy avec"
  echo "  sudo tools/certs-generator/gen-pi-cert.sh ${BOX_HOST}"
  echo "puis redémarrer l'app (elle vérifie la config dnsmasq au démarrage)."
fi
