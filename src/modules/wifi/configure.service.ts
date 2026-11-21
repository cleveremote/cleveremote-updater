import {
    BadRequestException,
    ConflictException,
    HttpStatus,
    Injectable,
    InternalServerErrorException,
    UnauthorizedException
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WifiService } from './wifi.service';
import { AuthenticationService } from '../authentication/authentication.service';
import { AuthenticationModel } from '../authentication/authentication.model';
import { Role } from '../authentication/role.enum';
import { ConfigureDto } from './dto/configure.dto';
import { GlobalSettingsService } from '../global-settings/global-settings.service';
import { ErrorCode, ErrorBody, GetErrorCode } from '../../common/errors/error-code';
import { ConfigureAction, ConfigureState } from './configure.model';
import { ConnectLocalNetworkDto } from './dto/connect-local-network.dto';
import { CONFIGURE_RESPONSE_GRACE_MS } from './wifi.constants';

const SETUP_REQUIRED_FIELDS = ['deviceName', 'password'] as const;

/**
 * La bascule WiFi coupe le hotspot (radio unique) par lequel le front a envoyé sa requête : une réponse émise
 * après la bascule ne lui parvient jamais. configure() valide donc la requête, répond aussitôt (202), puis
 * applique la configuration en arrière-plan ; le résultat est mémorisé et lu par le front via getMode().
 *
 * Un refus de la requête lève une HttpException dont le corps porte un `code` (cf. ErrorCode) que le front traduit.
 * Un échec en arrière-plan porte le même type de code dans getState().errorCode : une erreur WiFi déjà codée par
 * WifiService (WIFI_INVALID_PSK, WIFI_NETWORK_NOT_FOUND...) est relayée telle quelle.
 *
 * connectToLocalNetwork() (POST /network/local/connect) suit le même principe pour un simple changement de réseau
 * WiFi et partage le même état : getState().action indique quelle opération l'a produit.
 */
@Injectable()
export class ConfigureService {
    private _state: ConfigureState = { action: null, status: 'idle', errorCode: null, ssid: null, startedAt: null, finishedAt: null };
    private _pending: Promise<void> | null = null;

    public constructor(
        private readonly _wifiService: WifiService,
        private readonly _authenticationService: AuthenticationService,
        private readonly _globalSettingsService: GlobalSettingsService,
        @InjectPinoLogger(ConfigureService.name) private readonly _logger: PinoLogger
    ) {
    }

    // Setup tant qu'aucun compte n'est configuré, recovery ensuite (même règle que BoxModeService).
    // currentPassword seul donne l'autorisation : mot de passe de l'étiquette en setup, celui du compte en recovery.
    // Résolue dès que la requête est acceptée : la configuration elle-même se poursuit en arrière-plan.
    public async configure(dto: ConfigureDto): Promise<boolean> {
        this._assertNotInProgress();
        const isSetup = !await this._authenticationService.hasConfiguredAccount();
        if (isSetup) {
            this._assertSetupFields(dto);
        }
        await this._assertCurrentPassword(dto, isSetup);
        await this._assertPskOrConfiguredNetwork(dto.ssid, dto.psk);
        // revérifié sans await avant de poser l'état : deux requêtes simultanées ne peuvent pas démarrer toutes les deux
        this._assertNotInProgress();
        const mode = isSetup ? 'setup' : 'recovery';
        this._start('configure', dto.ssid, mode, () => (isSetup ? this._setup(dto) : this._recovery(dto)));
        return true;
    }

    // Connexion à un nouveau réseau WiFi local, sans toucher au compte. Résolue dès que la requête est acceptée.
    // En cas d'échec, WifiService.connect() rouvre le hotspot.
    public async connectToLocalNetwork(dto: ConnectLocalNetworkDto): Promise<boolean> {
        this._assertNotInProgress();
        await this._assertPskOrConfiguredNetwork(dto.ssid, dto.psk);
        // revérifié sans await avant de poser l'état (cf. configure())
        this._assertNotInProgress();
        this._start('connected_to_local_network', dto.ssid, 'local-network', () => this._connect(dto.ssid, dto.psk));
        return true;
    }

    // Résultat du dernier configure accepté
    public getState(): ConfigureState {
        return { ...this._state };
    }

    // Résolue quand aucune configuration n'est en cours (tests, arrêt propre)
    public whenIdle(): Promise<void> {
        return this._pending ?? Promise.resolve();
    }

    // À appeler sans await depuis le dernier _assertNotInProgress() : deux requêtes simultanées ne peuvent pas démarrer
    private _start(action: ConfigureAction, ssid: string, mode: string, steps: () => Promise<void>): void {
        this._state = { action, status: 'in-progress', errorCode: null, ssid, startedAt: new Date().toISOString(), finishedAt: null };
        this._pending = this._apply(ssid, mode, steps).finally(() => {
            this._pending = null;
        });
    }

    // Ne rejette jamais : tout échec est mémorisé dans l'état
    private async _apply(ssid: string, mode: string, steps: () => Promise<void>): Promise<void> {
        try {
            // la réponse 202 doit avoir atteint le front avant que la bascule ne coupe le réseau qu'il utilise
            await this._sleep(CONFIGURE_RESPONSE_GRACE_MS);
            await steps();
            this._finish(null);
            this._logger.info({ ssid, mode }, 'configure: succeeded');
        } catch (err) {
            const errorCode = GetErrorCode(err) ?? ErrorCode.CONFIGURE_FAILED;
            this._finish(errorCode);
            this._logger.error({ err, ssid, mode, errorCode }, 'configure: failed');
        }
    }

    private _finish(errorCode: ErrorCode | null): void {
        this._state = {
            ...this._state,
            status: errorCode === null ? 'succeeded' : 'failed',
            errorCode,
            finishedAt: new Date().toISOString()
        };
    }

    private _assertNotInProgress(): void {
        if (this._state.status === 'in-progress') {
            throw new ConflictException(ErrorBody(HttpStatus.CONFLICT, ErrorCode.CONFIGURE_IN_PROGRESS, 'a configuration is already in progress'));
        }
    }

    private _assertSetupFields(dto: ConfigureDto): void {
        const missing = SETUP_REQUIRED_FIELDS.filter((field) => dto[field] === undefined);
        if (missing.length > 0) {
            throw new BadRequestException(ErrorBody(
                HttpStatus.BAD_REQUEST,
                ErrorCode.SETUP_FIELDS_REQUIRED,
                `required in setup mode: ${missing.join(', ')}`,
                { fields: missing }
            ));
        }
    }

    // psk facultatif pour un réseau déjà configuré (profil réactivé par WifiService) : refusé ici en 400 plutôt qu'en arrière-plan
    private async _assertPskOrConfiguredNetwork(ssid: string, psk: string | undefined): Promise<void> {
        if (psk !== undefined) {
            return;
        }
        const savedSsids = await this._wifiService.getSavedWifiSsids();
        if (!savedSsids.includes(ssid)) {
            throw new BadRequestException(ErrorBody(
                HttpStatus.BAD_REQUEST, ErrorCode.WIFI_PSK_REQUIRED, 'psk is required for a WiFi network that is not configured yet', { ssid }
            ));
        }
    }

    private async _assertCurrentPassword(dto: ConfigureDto, isSetup: boolean): Promise<void> {
        const isValid = isSetup
            ? await this._authenticationService.verifyInitialPassword(dto.currentPassword, dto.login)
            : await this._authenticationService.verifyConfiguredCredentials(dto.login, dto.currentPassword);
        if (!isValid) {
            this._logger.warn({ login: dto.login, mode: isSetup ? 'setup' : 'recovery' }, 'configure: invalid current password');
            this._state = {
                ...this._state,
                action: 'configure',
                status: 'failed',
                errorCode: ErrorCode.INVALID_CURRENT_PASSWORD,
                finishedAt: new Date().toISOString()
            };
            throw new UnauthorizedException(ErrorBody(HttpStatus.UNAUTHORIZED, ErrorCode.INVALID_CURRENT_PASSWORD, 'invalid current password'));
        }
    }

    private async _setup(dto: ConfigureDto): Promise<void> {
        await this._connect(dto.ssid, dto.psk);
        if (dto.localCoordinates) {
            await this._saveLocalCoordinates(dto);
        }
        await this._createUser(dto);
        await this._stopHotspot();
    }

    // Recovery : le WiFi change et les informations déjà présentes sont complétées par les champs fournis
    // (coordonnées, email, nouveau mot de passe) ; un champ absent garde sa valeur
    private async _recovery(dto: ConfigureDto): Promise<void> {
        await this._connect(dto.ssid, dto.psk);
        if (dto.localCoordinates) {
            await this._saveLocalCoordinates(dto);
        }
        await this._completeUser(dto);
        await this._stopHotspot();
    }

    private async _connect(ssid: string, psk: string | undefined): Promise<void> {
        try {
            await this._wifiService.connect({ ssid, password: psk });
        } catch (err) {
            this._logger.error({ err, ssid }, 'configure: failed to connect to WiFi network');
            throw this._toCodedError(err, ErrorCode.WIFI_CONNECT_FAILED, 'failed to connect to WiFi network');
        }
    }

    private async _saveLocalCoordinates(dto: ConfigureDto): Promise<void> {
        try {
            await this._globalSettingsService.setLocalCoordinates({
                latitude: dto.localCoordinates.latitude,
                longitude: dto.localCoordinates.longitude
            });
        } catch (err) {
            this._logger.error({ err, localCoordinates: dto.localCoordinates }, 'configure: failed to save local coordinates');
            throw this._toCodedError(err, ErrorCode.LOCAL_COORDINATES_SAVE_FAILED, 'failed to save local coordinates');
        }
    }

    private async _createUser(dto: ConfigureDto): Promise<void> {
        try {
            await this._authenticationService.createUser({
                login: dto.login,
                email: dto.email,
                password: dto.password,
                role: Role.ADMIN,
                isConfigured: true
            } as AuthenticationModel);
        } catch (err) {
            this._logger.error({ err, login: dto.login }, 'configure: failed to create or update user');
            throw this._toCodedError(err, ErrorCode.USER_SAVE_FAILED, 'failed to create or update user');
        }
    }

    private async _completeUser(dto: ConfigureDto): Promise<void> {
        try {
            await this._authenticationService.completeConfiguredUser(dto.login, { email: dto.email, password: dto.password });
        } catch (err) {
            this._logger.error({ err, login: dto.login }, 'configure: failed to complete user');
            throw this._toCodedError(err, ErrorCode.USER_SAVE_FAILED, 'failed to complete user');
        }
    }

    private async _stopHotspot(): Promise<void> {
        try {
            await this._wifiService.stopHotspot();
        } catch (err) {
            this._logger.error({ err }, 'configure: failed to stop hotspot');
            throw this._toCodedError(err, ErrorCode.HOTSPOT_STOP_FAILED, 'failed to stop hotspot');
        }
    }

    // Garde le code le plus précis : celui de l'erreur d'origine s'il existe, sinon celui de l'étape
    private _toCodedError(err: unknown, fallback: ErrorCode, message: string): Error {
        if (GetErrorCode(err) !== undefined) {
            return err as Error;
        }
        return new InternalServerErrorException(ErrorBody(HttpStatus.INTERNAL_SERVER_ERROR, fallback, message));
    }

    private readonly _sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
}
