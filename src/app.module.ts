import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from 'nestjs-pino';
import { UpdaterModule } from './modules/updater/updater.module';
import { WifiModule } from './modules/wifi/wifi.module';
import { MdnsModule } from './modules/mdns/mdns.module';
import { AuthenticationModule } from './modules/authentication/authentication.module';

@Module({
    imports: [
        ConfigModule.forRoot(),
        LoggerModule.forRoot({
            pinoHttp: {
                transport:
                    process.env.NODE_ENV !== 'production'
                        ? { target: 'pino-pretty', options: { singleLine: true } }
                        : undefined,
                level: process.env.LOG_LEVEL ?? 'info'
            }
        }),
        MongooseModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({ uri: config.get<string>('MONGO_URI') })
        }),
        UpdaterModule,
        WifiModule,
        MdnsModule,
        AuthenticationModule
    ]
})
export class AppModule {
}
