import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WifiService } from './wifi.service';
import { AuthenticationService } from '../authentication/authentication.service';
import { AuthenticationModel } from '../authentication/authentication.model';
import { Role } from '../authentication/role.enum';
import { ConfigureDto } from './dto/configure.dto';
import { GlobalSettingsService } from '../global-settings/global-settings.service';

@Injectable()
export class ConfigureService {
    public constructor(
        private readonly _wifiService: WifiService,
        private readonly _authenticationService: AuthenticationService,
        private readonly _globalSettingsService: GlobalSettingsService,
        @InjectPinoLogger(ConfigureService.name) private readonly _logger: PinoLogger
    ) {
    }

    public async configure(dto: ConfigureDto): Promise<boolean> {
        if (!await this._connect(dto)) {
            return false;
        }
        if (!await this._saveLocalCoordinates(dto)) {
            return false;
        }
        if (!await this._createUser(dto)) {
            return false;
        }
        return this._stopHotspot();
    }

    private async _connect(dto: ConfigureDto): Promise<boolean> {
        try {
            await this._wifiService.connect({ ssid: dto.ssid, password: dto.psk });
            return true;
        } catch (err) {
            this._logger.error({ err, ssid: dto.ssid }, 'configure: failed to connect to WiFi network');
            return false;
        }
    }

    private async _saveLocalCoordinates(dto: ConfigureDto): Promise<boolean> {
        try {
            await this._globalSettingsService.setLocalCoordinates({
                latitude: dto.localCoordinates.latitude,
                longitude: dto.localCoordinates.longitude
            });
            return true;
        } catch (err) {
            this._logger.error({ err, localCoordinates: dto.localCoordinates }, 'configure: failed to save local coordinates');
            return false;
        }
    }

    private async _createUser(dto: ConfigureDto): Promise<boolean> {
        try {
            await this._authenticationService.createUser({
                login: dto.login,
                email: dto.email,
                password: dto.password || 'CLV_Box-121715!',
                role: Role.ADMIN
            } as AuthenticationModel);
            return true;
        } catch (err) {
            this._logger.error({ err, login: dto.login }, 'configure: failed to create or update user');
            return false;
        }
    }

    private async _stopHotspot(): Promise<boolean> {
        try {
            await this._wifiService.stopHotspot();
            return true;
        } catch (err) {
            this._logger.error({ err }, 'configure: failed to stop hotspot');
            return false;
        }
    }
}
