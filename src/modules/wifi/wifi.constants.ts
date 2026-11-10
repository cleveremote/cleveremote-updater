export const NMCLI_BINARY = 'nmcli';
export const NMCLI_TIMEOUT_MS = 15000;
export const WIFI_BACKGROUND_RESCAN_INTERVAL_MS = 5 * 60 * 1000;

export const WIFI_DEFAULT_INTERFACE = 'wlan0';
export const WIFI_DEFAULT_HOTSPOT_CON_NAME = 'cleveremote-hotspot';
export const WIFI_DEFAULT_HOTSPOT_SSID = 'cleveremote-setup';

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
