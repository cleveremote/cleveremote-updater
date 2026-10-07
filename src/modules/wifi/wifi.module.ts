import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WifiController } from './wifi.controller';
import { WifiService } from './wifi.service';
import { NmcliExecutorService } from './nmcli-executor.service';
import { ConfigureService } from './configure.service';
import { AuthenticationModule } from '../authentication/authentication.module';

@Module({
    imports: [ConfigModule, AuthenticationModule],
    controllers: [WifiController],
    providers: [WifiService, NmcliExecutorService, ConfigureService]
})
export class WifiModule {
}
