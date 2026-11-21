import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Codes d'erreur stables renvoyés au front (champ `code`), qui les traduit.
 * Ne jamais renommer une valeur existante : le front s'appuie dessus. `message` reste un texte technique (anglais).
 */
export enum ErrorCode {
    // Requête
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    SETUP_FIELDS_REQUIRED = 'SETUP_FIELDS_REQUIRED',
    INVALID_CURRENT_PASSWORD = 'INVALID_CURRENT_PASSWORD',

    // /updater/configure : requête refusée car une configuration est déjà en cours
    CONFIGURE_IN_PROGRESS = 'CONFIGURE_IN_PROGRESS',

    // Étapes de /updater/configure (résultat lu par le front dans getMode().configure.errorCode)
    CONFIGURE_FAILED = 'CONFIGURE_FAILED',
    WIFI_CONNECT_FAILED = 'WIFI_CONNECT_FAILED',
    LOCAL_COORDINATES_SAVE_FAILED = 'LOCAL_COORDINATES_SAVE_FAILED',
    USER_SAVE_FAILED = 'USER_SAVE_FAILED',
    HOTSPOT_STOP_FAILED = 'HOTSPOT_STOP_FAILED',

    // WiFi (nmcli)
    WIFI_UNSUPPORTED_PLATFORM = 'WIFI_UNSUPPORTED_PLATFORM',
    WIFI_NMCLI_UNAVAILABLE = 'WIFI_NMCLI_UNAVAILABLE',
    WIFI_TIMEOUT = 'WIFI_TIMEOUT',
    WIFI_INVALID_PSK = 'WIFI_INVALID_PSK',
    // psk absent alors qu'aucun profil n'est mémorisé pour ce SSID (psk facultatif seulement pour un réseau déjà configuré)
    WIFI_PSK_REQUIRED = 'WIFI_PSK_REQUIRED',
    WIFI_NETWORK_NOT_FOUND = 'WIFI_NETWORK_NOT_FOUND',
    WIFI_INTERFACE_BUSY = 'WIFI_INTERFACE_BUSY',
    WIFI_HOTSPOT_PASSWORD_NOT_CONFIGURED = 'WIFI_HOTSPOT_PASSWORD_NOT_CONFIGURED',
    WIFI_OPERATION_FAILED = 'WIFI_OPERATION_FAILED'
}

// Corps JSON de toute erreur HTTP portant un code
export interface ErrorResponse {
    statusCode: number;
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
}

// À passer au constructeur d'une exception Nest : new BadRequestException(ErrorBody(...)) renvoie ce corps tel quel
export function ErrorBody(status: HttpStatus, code: ErrorCode, message: string, details?: Record<string, unknown>): ErrorResponse {
    return details === undefined ? { statusCode: status, code, message } : { statusCode: status, code, message, details };
}

export function GetErrorCode(err: unknown): ErrorCode | undefined {
    if (!(err instanceof HttpException)) {
        return undefined;
    }
    const response = err.getResponse();
    return typeof response === 'object' && response !== null && 'code' in response
        ? (response as ErrorResponse).code
        : undefined;
}
