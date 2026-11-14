import { BadRequestException, HttpStatus, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WifiService } from './wifi.service';
import { AuthenticationService } from '../authentication/authentication.service';
import { AuthenticationModel } from '../authentication/authentication.model';
import { Role } from '../authentication/role.enum';
import { ConfigureDto } from './dto/configure.dto';
import { CheckPasswordDto } from './dto/check-password.dto';
import { GlobalSettingsService } from '../global-settings/global-settings.service';
import { ErrorCode, ErrorBody, GetErrorCode } from '../../common/errors/error-code';

const SETUP_REQUIRED_FIELDS = ['deviceName', 'password'] as const;

/**
 * Chaque échec lève une HttpException dont le corps porte un `code` (cf. ErrorCode) que le front traduit.
 * Une erreur WiFi déjà codée par WifiService (WIFI_INVALID_PSK, WIFI_NETWORK_NOT_FOUND...) est relayée telle quelle.
 */
@Injectable()
export class ConfigureService {
    public constructor(
        private readonly _wifiService: WifiService,
        private readonly _authenticationService: AuthenticationService,
        private readonly _globalSettingsService: GlobalSettingsService,
        @InjectPinoLogger(ConfigureService.name) private readonly _logger: PinoLogger
    ) {
    }

    // Setup tant qu'aucun compte n'est configuré, recovery ensuite (même règle que BoxModeService)
    public async configure(dto: ConfigureDto): Promise<boolean> {
        const isSetup = !await this._authenticationService.hasConfiguredAccount();
        if (isSetup) {
            this._assertSetupFields(dto);
        }
        await this._assertCurrentPassword(dto, isSetup);
        if (isSetup) {
            await this._setup(dto);
        } else {
            await this._recovery(dto);
        }
        return true;
    }

    // Validation seule du mot de passe courant (étiquette en setup, compte configuré en recovery), sans rien modifier
    public async checkPassword(dto: CheckPasswordDto): Promise<boolean> {
        const isSetup = !await this._authenticationService.hasConfiguredAccount();
        if (!isSetup && dto.login === undefined) {
            throw new BadRequestException(ErrorBody(
                HttpStatus.BAD_REQUEST,
                ErrorCode.VALIDATION_FAILED,
                'invalid request: login',
                { fields: [{ field: 'login', constraints: ['isDefined'] }] }
            ));
        }
        await this._assertCurrentPassword(dto, isSetup);
        return true;
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

    private async _assertCurrentPassword(dto: CheckPasswordDto, isSetup: boolean): Promise<void> {
        const isValid = isSetup
            ? await this._authenticationService.verifyInitialPassword(dto.login,dto.currentPassword)
            : await this._authenticationService.verifyConfiguredCredentials(dto.login, dto.currentPassword);
        if (!isValid) {
            this._logger.warn({ login: dto.login, mode: isSetup ? 'setup' : 'recovery' }, 'configure: invalid current password');
            throw new UnauthorizedException(ErrorBody(HttpStatus.UNAUTHORIZED, ErrorCode.INVALID_CURRENT_PASSWORD, 'invalid current password'));
        }
    }

    private async _setup(dto: ConfigureDto): Promise<void> {
        await this._connect(dto);
        if (dto.localCoordinates) {
            await this._saveLocalCoordinates(dto);
        }
        await this._createUser(dto);
        await this._stopHotspot();
    }

    // Recovery : seul le WiFi change, le compte et les réglages restent ceux du setup
    private async _recovery(dto: ConfigureDto): Promise<void> {
        await this._connect(dto);
        await this._stopHotspot();
    }

    private async _connect(dto: ConfigureDto): Promise<void> {
        try {
            await this._wifiService.connect({ ssid: dto.ssid, password: dto.psk });
        } catch (err) {
            this._logger.error({ err, ssid: dto.ssid }, 'configure: failed to connect to WiFi network');
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
}
