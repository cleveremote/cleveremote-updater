import { GlobalSettingsModel, LocalCoordinatesModel } from './global-settings.model';
import { GlobalSettingsDocument, LocalCoordinates } from './global-settings.schema';

export class GlobalSettingsMapper {
    public static mapToModel(globalSettings: GlobalSettingsDocument): GlobalSettingsModel {
        const model = new GlobalSettingsModel();
        model.id = globalSettings._id;
        model.localCoordinates = globalSettings.localCoordinates
            ? GlobalSettingsMapper._mapCoordinatesToModel(globalSettings.localCoordinates)
            : undefined;
        return model;
    }

    public static mapCoordinatesToSchema(model: LocalCoordinatesModel): LocalCoordinates {
        const coordinates = new LocalCoordinates();
        coordinates.latitude = model.latitude;
        coordinates.longitude = model.longitude;
        return coordinates;
    }

    private static _mapCoordinatesToModel(coordinates: LocalCoordinates): LocalCoordinatesModel {
        const model = new LocalCoordinatesModel();
        model.latitude = coordinates.latitude;
        model.longitude = coordinates.longitude;
        return model;
    }
}
