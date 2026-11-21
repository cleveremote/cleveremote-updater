import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WifiController } from './wifi.controller';
import { NetworkController } from './network.controller';
import { WifiService } from './wifi.service';
import { NmcliExecutorService } from './nmcli-executor.service';
import { ConfigureService } from './configure.service';
import { BoxModeService } from './box-mode.service';
import { AuthenticationModule } from '../authentication/authentication.module';
import { GlobalSettingsModule } from '../global-settings/global-settings.module';

@Module({
    imports: [ConfigModule, AuthenticationModule, GlobalSettingsModule],
    controllers: [WifiController, NetworkController],
    providers: [WifiService, NmcliExecutorService, ConfigureService, BoxModeService]
})
export class WifiModule {
}
