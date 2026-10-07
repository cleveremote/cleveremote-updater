import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy, ReadPacket, WritePacket } from '@nestjs/microservices';
import { SocketIoClientProvider } from '../socket-io-client.provider';

@Injectable()
export class SocketIoClientProxyService extends ClientProxy {
    @Inject(SocketIoClientProvider)
    private _client: SocketIoClientProvider;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public async connect(): Promise<any> {
        // no-op: required ClientProxy override, connection is managed by SocketIoClientProvider
    }

    public async close(): Promise<void> {
        // no-op: required ClientProxy override, connection is managed by SocketIoClientProvider
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    public async dispatchEvent(packet: ReadPacket<string>): Promise<any> {
        // no-op: required ClientProxy override, not used by this proxy
    }

    public async sendMessage(packet: ReadPacket<string>): Promise<string> {
        return this._emitMessage<string>(packet);
    }

    private async _emitMessage<T>(packet: ReadPacket<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this._client.getSocket().emit(packet.pattern, packet.data, (response) => {
                if (!response) return reject('err');
                resolve(response);
            });
        });
    }

    public unwrap<T>(): T {
        return this._client as unknown as T;
    }

    /* istanbul ignore next */
    public publish<T>(
        packet: ReadPacket<T>,
        callback: (packet: WritePacket<T>) => void
    ): () => void {
        setTimeout(() => callback({ response: packet.data }), 5000);
        return () => undefined;
    }
}
