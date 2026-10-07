import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket, io } from 'socket.io-client';
import * as os from 'os';

@Injectable()
export class SocketIoClientProvider {
    @Inject(ConfigService)
    private readonly _config: ConfigService;

    private _socket: Socket;

    private _connect(): Socket {
        this._socket = io(this._config.get('SOCKET_SERVER'), {
            extraHeaders: {
                updaterId: this._config.get('UPDATER_ID') || os.hostname(),
                type: 'updater'
            }
        });
        return this._socket;
    }

    public getSocket = (): Socket => {
        if (!this._socket) {
            return this._connect();
        }
        return this._socket;
    };
}
