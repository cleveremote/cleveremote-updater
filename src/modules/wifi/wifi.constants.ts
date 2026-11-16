export const NMCLI_BINARY = 'nmcli';
export const NMCLI_TIMEOUT_MS = 15000;
export const WIFI_BACKGROUND_RESCAN_INTERVAL_MS = 5 * 60 * 1000;

// Connexion à un réseau client (`nmcli connection up`) : association + DHCP dépassent couramment 10 s.
// nmcli attend lui-même jusqu'à NMCLI_CONNECT_WAIT_S (-w) et rend alors sa propre erreur ; le kill du process
// reste au-dessus pour ne jamais couper une activation que NetworkManager est encore en train de mener.
export const NMCLI_CONNECT_WAIT_S = 60;
export const NMCLI_CONNECT_TIMEOUT_MS = 70 * 1000;

// Juste après l'arrêt du hotspot, la liste de scan de NetworkManager peut ne pas (encore) contenir le réseau
// visé, or son type de sécurité y est lu et l'activation échoue s'il reste introuvable : on rescanne avant de se connecter.
export const WIFI_CONNECT_SCAN_ATTEMPTS = 4;
export const WIFI_CONNECT_SCAN_RETRY_MS = 2000;

// /updater/configure répond 202 puis coupe le hotspot : délai laissé à la réponse pour atteindre le front
// (elle transite par Caddy puis par le hotspot lui-même)
export const CONFIGURE_RESPONSE_GRACE_MS = 2000;

export const WIFI_DEFAULT_INTERFACE = 'wlan0';
export const WIFI_DEFAULT_HOTSPOT_CON_NAME = 'cleveremote-hotspot';
export const WIFI_DEFAULT_HOTSPOT_SSID = 'cleveremote-setup';

// IP fixe de la box sur son hotspot (sinon NetworkManager la choisit lui-même dans 10.42.x.1).
// Doit rester alignée avec le SAN "IP:" de tools/certs-generator/gen-pi-cert.sh.
export const WIFI_HOTSPOT_IPV4_CIDR = '10.42.0.1/24';

// Config dnsmasq du hotspot, déposée par tools/provisioning/setup-box-network.sh : répond <hostname>.local
// en DNS unicast aux clients qui ne font pas de mDNS (Android, Windows en profil "Public").
export const WIFI_HOTSPOT_DNSMASQ_CONF_PATH = '/etc/NetworkManager/dnsmasq-shared.d/cleveremote-box.conf';

// Bouton physique de mode recovery manuel (numérotation BCM, câblé vers 3.3V avec pull-down)
export const BOX_RECOVERY_BUTTON_BCM_PIN = 17;
export const BOX_RECOVERY_BUTTON_HOLD_MS = 5000;

// LED qui clignote tant que le hotspot est actif (numérotation BCM).
// GPIO21 = LED de statut, aussi utilisée par cleveremote-box pour son signal "ready" au démarrage.
export const BOX_STATUS_LED_BCM_PIN = 21;
export const BOX_STATUS_LED_BLINK_MS = 500;
// Période de vérification de l'état réel du hotspot (LED + oubli de la raison de recovery)
export const BOX_STATUS_LED_CHECK_INTERVAL_MS = 3000;

// Attente de la connexion WiFi client
export const BOX_STATUS_POLL_MS = 3000;
// Au boot : délai laissé à NetworkManager pour se connecter seul au réseau connu avant de basculer en recovery
export const BOX_BOOT_CONNECT_TIMEOUT_MS = 60 * 1000;
// Sortie de recovery (bouton ou retry auto) : délai de connexion au réseau connu avant de rouvrir le hotspot
export const BOX_RECONNECT_TIMEOUT_MS = 45 * 1000;

// Recovery automatique : nouvelle tentative sur le réseau connu dès qu'il réapparaît dans le scan
export const BOX_RECOVERY_RETRY_INTERVAL_MS = 5 * 60 * 1000;
export const BOX_RECOVERY_MAX_RETRIES = 3;
