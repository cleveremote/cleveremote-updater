import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SocketIoClientProvider } from '../../common/websocket/socket-io-client.provider';
import { SocketIoClientProxyService } from '../../common/websocket/socket-io-client-proxy/socket-io-client-proxy.service';
import { UpdaterController } from './updater.controller';
import { UpdaterService } from './updater.service';

@Module({
    imports: [ConfigModule],
    controllers: [UpdaterController],
    providers: [SocketIoClientProvider, SocketIoClientProxyService, UpdaterService],
    exports: [SocketIoClientProvider]
})
export class UpdaterModule {
}
