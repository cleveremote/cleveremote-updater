import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlobalSettingsService } from './global-settings.service';
import { GlobalSettingsRepository } from './global-settings.repository';
import { GlobalSettings, GlobalSettingsSchema } from './global-settings.schema';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: GlobalSettings.name, schema: GlobalSettingsSchema }])
    ],
    providers: [GlobalSettingsService, GlobalSettingsRepository],
    exports: [GlobalSettingsService]
})
export class GlobalSettingsModule {
}
