import { ErrorCode } from '../../common/errors/error-code';

/**
 * - idle        : aucun configure accepté depuis le démarrage de l'application (état en mémoire uniquement)
 * - in-progress : configure accepté (202), bascule WiFi en cours
 * - succeeded   : la box est connectée au réseau demandé (et le compte est créé en setup)
 * - failed      : voir errorCode ; si la connexion WiFi a échoué, le hotspot a été rouvert
 */
export type ConfigureStatus = 'idle' | 'in-progress' | 'succeeded' | 'failed';

/**
 * Opération à l'origine de l'état :
 * - configure                  : POST /updater/configure (setup / recovery)
 * - connected_to_local_network : POST /network/local/connect (simple changement de réseau WiFi)
 */
export type ConfigureAction = 'configure' | 'connected_to_local_network';

// Résultat de la dernière opération WiFi acceptée (configure ou network/local/connect), exposé par GET /updater/getMode
export interface ConfigureState {
    // null tant que status === 'idle'
    action: ConfigureAction | null;
    status: ConfigureStatus;
    // non null uniquement si status === 'failed'
    errorCode: ErrorCode | null;
    // réseau WiFi demandé
    ssid: string | null;
    // dates ISO 8601
    startedAt: string | null;
    finishedAt: string | null;
}
