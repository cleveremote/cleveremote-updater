import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { GlobalSettingsRepository } from './global-settings.repository';
import { GlobalSettingsModel, LocalCoordinatesModel } from './global-settings.model';

@Injectable()
export class GlobalSettingsService {
    public constructor(
        private readonly _globalSettingsRepository: GlobalSettingsRepository,
        @InjectPinoLogger(GlobalSettingsService.name) private readonly _logger: PinoLogger
    ) {
    }

    public get(): Promise<GlobalSettingsModel> {
        return this._globalSettingsRepository.get();
    }

    public async setLocalCoordinates(coordinates: LocalCoordinatesModel): Promise<GlobalSettingsModel> {
        const saved = await this._globalSettingsRepository.updateLocalCoordinates(coordinates);
        this._logger.info({ localCoordinates: saved.localCoordinates }, 'local coordinates saved');
        return saved;
    }
}
