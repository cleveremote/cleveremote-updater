import { WifiStatus } from './wifi.service';

/**
 * - starting   : séquence de démarrage en cours (décision pas encore prise)
 * - connecting : tentative de connexion au réseau WiFi connu (hotspot coupé)
 * - setup      : aucun compte configuré ; hotspot ouvert par défaut pour la première configuration,
 *                peut être coupé / rouvert par un appui long sur le bouton (voir wifi.mode)
 * - recovery   : compte configuré mais hotspot ouvert (WiFi injoignable ou appui long sur le bouton)
 * - normal     : compte configuré, hotspot fermé
 */
export type BoxMode = 'starting' | 'connecting' | 'setup' | 'recovery' | 'normal';
export type RecoveryReason = 'connection-failed' | 'manual';

export interface BoxModeStatus {
    mode: BoxMode;
    // non null uniquement en mode recovery
    recoveryReason: RecoveryReason | null;
    // null si l'état WiFi n'a pas pu être lu
    wifi: WifiStatus | null;
}
