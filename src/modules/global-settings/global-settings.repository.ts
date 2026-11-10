import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GlobalSettingsModel, LocalCoordinatesModel } from './global-settings.model';
import { GlobalSettings, GlobalSettingsDocument } from './global-settings.schema';
import { GlobalSettingsMapper } from './global-settings.mapper';

@Injectable()
export class GlobalSettingsRepository {
    public constructor(
        @InjectModel(GlobalSettings.name) private readonly _globalSettingsModel: Model<GlobalSettingsDocument>
    ) {
    }

    public async get(): Promise<GlobalSettingsModel> {
        const globalSettings = await this._globalSettingsModel.findOne();
        return globalSettings ? GlobalSettingsMapper.mapToModel(globalSettings) : new GlobalSettingsModel();
    }

    // $set cible : le document unique est partage avec la box, ses autres champs sont preserves
    public async updateLocalCoordinates(coordinates: LocalCoordinatesModel): Promise<GlobalSettingsModel> {
        const saved = await this._globalSettingsModel.findOneAndUpdate(
            {},
            { $set: { localCoordinates: GlobalSettingsMapper.mapCoordinatesToSchema(coordinates) } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        return GlobalSettingsMapper.mapToModel(saved);
    }
}
