import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { SocketIoClientProvider } from './common/websocket/socket-io-client.provider';
import { SocketIoClientStrategy } from './common/websocket/socket-io-client.strategy';

// eslint-disable-next-line @typescript-eslint/naming-convention
function registerGlobalErrorHandlers(logger: Logger): void {
    process.on('unhandledRejection', (reason) => {
        logger.error({ err: reason }, 'unhandled promise rejection');
    });
    process.on('uncaughtException', (err) => {
        logger.error({ err }, 'uncaught exception');
    });
}

// eslint-disable-next-line @typescript-eslint/naming-convention
async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule, { cors: true, bufferLogs: true });
    app.useLogger(app.get(Logger));
    app.enableShutdownHooks([], { useProcessExit: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    const logger = app.get(Logger);
    registerGlobalErrorHandlers(logger);

    const appConfig = app.get<ConfigService>(ConfigService);
    const socketIoClientProvider = app.get<SocketIoClientProvider>(SocketIoClientProvider);

    app.connectMicroservice<MicroserviceOptions>({
        strategy: new SocketIoClientStrategy(socketIoClientProvider.getSocket())
    });

    await app.startAllMicroservices();

    app.enableCors();
    await app.listen(appConfig.get('APP_PORT'));
    logger.log(`🚀 Server listening on port ${appConfig.get('APP_PORT')}`);
}
bootstrap();
