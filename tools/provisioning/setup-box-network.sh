#!/bin/bash
# À exécuter en root, une fois par box (idempotent : peut être relancé sans risque).
#
# Usage : sudo ./setup-box-network.sh [box-host] [wifi-iface] [eth-iface] [wifi-country]
#   box-host     : hostname de la box (défaut : hostname actuel), mis en minuscules
#   wifi-iface   : interface du hotspot (défaut : wlan0, = WIFI_INTERFACE de l'app)
#   eth-iface    : interface Ethernet (défaut : eth0)
#   wifi-country : pays WiFi ISO 3166-1 alpha-2 (défaut : FR)
#
# Rend la box joignable en https://<box-host>.local quel que soit le mode réseau :
#   - réseau client : mDNS via Avahi, sur le WiFi ET l'Ethernet (quand le hotspot
#                     démarre, wlan0 quitte le réseau local : seul eth0 y reste)
#   - hotspot       : mDNS via Avahi + DNS unicast via le dnsmasq de NetworkManager
#                     (Android, Windows en profil "Public" ne résolvent pas .local en mDNS)
# Avahi et dnsmasq suivent eux-mêmes l'IP courante des interfaces : rien à régénérer
# quand la box bascule entre client et hotspot.
#
# Fiabilise aussi la radio du hotspot (box -> téléphone) :
#   - pays WiFi réellement appliqué (sinon le pilote reste en "country 00")
#   - Bluetooth désactivé : sur le BCM4345/6 du Pi, il partage la radio 2,4 GHz avec le WiFi

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Erreur : ce script doit être exécuté en root (sudo)." >&2
  exit 1
fi

BOX_HOST="$(echo "${1:-$(hostname -s)}" | tr '[:upper:]' '[:lower:]')"
WIFI_IFACE="${2:-wlan0}"
ETH_IFACE="${3:-eth0}"
WIFI_COUNTRY="$(echo "${4:-FR}" | tr '[:lower:]' '[:upper:]')"

if ! [[ "${BOX_HOST}" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
  echo "Erreur : hostname invalide '${BOX_HOST}' (lettres, chiffres, tirets ; 63 caractères max)." >&2
  exit 1
fi

if ! [[ "${WIFI_COUNTRY}" =~ ^[A-Z]{2}$ ]]; then
  echo "Erreur : pays WiFi invalide '${WIFI_COUNTRY}' (code ISO à 2 lettres, ex. FR)." >&2
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
echo "Pays WiFi   : ${WIFI_COUNTRY}"

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

# --- 5. Pays WiFi -------------------------------------------------------------------
# Le noyau du Pi ne fait confiance qu'à la base réglementaire signée en amont : la version
# Debian (alternative par défaut) est rejetée ("regulatory.db is malformed or signature is
# missing/invalid") et le pays reste "00", même avec cfg80211.ieee80211_regdom dans cmdline.txt.
if [ -f /lib/firmware/regulatory.db-upstream ] && update-alternatives --list regulatory.db >/dev/null 2>&1; then
  update-alternatives --set regulatory.db /lib/firmware/regulatory.db-upstream >/dev/null
  echo "  regulatory.db : version upstream"
fi
CMDLINE_FILE="/boot/firmware/cmdline.txt"
[ -f "${CMDLINE_FILE}" ] || CMDLINE_FILE="/boot/cmdline.txt"
if [ -f "${CMDLINE_FILE}" ]; then
  if grep -q 'cfg80211\.ieee80211_regdom=' "${CMDLINE_FILE}"; then
    sed -i -E "s/cfg80211\.ieee80211_regdom=[A-Za-z0-9]+/cfg80211.ieee80211_regdom=${WIFI_COUNTRY}/" "${CMDLINE_FILE}"
  else
    sed -i -E "1s/\$/ cfg80211.ieee80211_regdom=${WIFI_COUNTRY}/" "${CMDLINE_FILE}"
  fi
  echo "  ${CMDLINE_FILE} : cfg80211.ieee80211_regdom=${WIFI_COUNTRY}"
fi
iw reg reload 2>/dev/null || true
iw reg set "${WIFI_COUNTRY}"
echo "  pays WiFi appliqué (effectif après quelques secondes : iw reg get)"

# --- 6. Bluetooth désactivé -----------------------------------------------------------
# Inutilisé par la box ; actif, il dégrade la réception du WiFi 2,4 GHz côté téléphone.
CONFIG_TXT="/boot/firmware/config.txt"
[ -f "${CONFIG_TXT}" ] || CONFIG_TXT="/boot/config.txt"
if [ -f "${CONFIG_TXT}" ] && ! grep -qE '^dtoverlay=disable-bt' "${CONFIG_TXT}"; then
  printf '\n[all]\ndtoverlay=disable-bt\n' >> "${CONFIG_TXT}"
  echo "  ${CONFIG_TXT} : dtoverlay=disable-bt (effectif au prochain redémarrage)"
fi
systemctl disable --now hciuart.service >/dev/null 2>&1 || true
systemctl disable --now bluetooth.service >/dev/null 2>&1 || true
echo "  services hciuart/bluetooth arrêtés et désactivés"

# --- 7. Prise en compte -----------------------------------------------------------
systemctl restart avahi-daemon
echo "  avahi-daemon redémarré"
echo
echo "dnsmasq lit ${DNSMASQ_SHARED_DIR} à chaque démarrage du hotspot :"
echo "la config s'applique au prochain hotspot/start (ou appui long sur le bouton ;"
echo "si le hotspot est déjà ouvert : un appui long pour le couper, un second pour le rouvrir)."

if [ "${PREVIOUS_HOST}" != "${BOX_HOST}" ]; then
  echo
  echo "Le hostname a changé : régénérer le certificat Caddy avec"
  echo "  sudo tools/certs-generator/gen-pi-cert.sh ${BOX_HOST}"
  echo "puis redémarrer l'app (elle vérifie la config dnsmasq au démarrage)."
fi
echo
echo "Redémarrer la box pour finir de couper le Bluetooth (dtoverlay=disable-bt)."
