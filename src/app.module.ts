import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from 'nestjs-pino';
import { UpdaterModule } from './modules/updater/updater.module';
import { WifiModule } from './modules/wifi/wifi.module';
import { AuthenticationModule } from './modules/authentication/authentication.module';

// In the packaged SEA binary, process.execPath is the executable itself, so this
// resolves .env next to it regardless of the caller's cwd. In dev (`nest start`),
// process.execPath is the node binary, so this is false and the default cwd-relative
// .env lookup below still applies.
const execDirEnvPath = join(dirname(process.execPath), '.env');

@Module({
    imports: [
        ConfigModule.forRoot({
            // .env.local (non versionné : secrets locaux) prioritaire sur .env
            envFilePath: existsSync(execDirEnvPath)
                ? [join(dirname(process.execPath), '.env.local'), execDirEnvPath]
                : ['.env.local', '.env']
        }),
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
        AuthenticationModule
    ]
})
export class AppModule {
}
