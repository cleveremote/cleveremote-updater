export const NMCLI_BINARY = 'nmcli';
export const NMCLI_TIMEOUT_MS = 15000;
export const WIFI_BACKGROUND_RESCAN_INTERVAL_MS = 5 * 60 * 1000;

export const WIFI_DEFAULT_INTERFACE = 'wlan0';
export const WIFI_DEFAULT_HOTSPOT_CON_NAME = 'cleveremote-hotspot';
export const WIFI_DEFAULT_HOTSPOT_SSID = 'cleveremote-setup';

// Bouton physique de bascule du hotspot (numérotation BCM, câblé vers 3.3V avec pull-down)
export const WIFI_HOTSPOT_BUTTON_BCM_PIN = 17;
export const WIFI_HOTSPOT_BUTTON_HOLD_MS = 5000;

// LED qui clignote tant que le hotspot est actif (numérotation BCM).
// GPIO21 = LED de statut, aussi utilisée par cleveremote-box pour son signal "ready" au démarrage.
export const WIFI_HOTSPOT_LED_BCM_PIN = 21;
export const WIFI_HOTSPOT_LED_BLINK_MS = 500;
// Période de vérification de l'état réel du hotspot pour la LED
export const WIFI_HOTSPOT_LED_CHECK_INTERVAL_MS = 3000;
