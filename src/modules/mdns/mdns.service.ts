import * as os from 'os';
import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Bonjour, Service } from 'bonjour-service';
import { MDNS_DEFAULT_SERVICE_TYPE } from './mdns.constants';

@Injectable()
export class MdnsService implements OnApplicationBootstrap, OnApplicationShutdown {
    public constructor(
        private readonly _config: ConfigService,
        @InjectPinoLogger(MdnsService.name) private readonly _logger: PinoLogger
    ) {
    }

    private _bonjour: Bonjour | undefined;
    private _service: Service | undefined;

    public async onApplicationBootstrap(): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, 2000))
        const name = this._serviceName();
        const type = this._serviceType();
        const port = this._config.get<number>('APP_PORT');


        try {
            this._bonjour = new Bonjour();
            this._service = this._bonjour.publish({ name, type, port: 3200, host: `${name}.local`, txt: { id: name } });
            this._logger.info({ name, type, port }, 'mDNS service published');
        } catch (err) {
            this._logger.error({ err }, 'failed to publish mDNS service');
        }
    }

    public async onApplicationShutdown(): Promise<void> {
        if (this._bonjour === undefined) {
            return;
        }
        const bonjour = this._bonjour;
        await new Promise<void>((resolve) => bonjour.unpublishAll(() => resolve()));
        await new Promise<void>((resolve) => bonjour.destroy(() => resolve()));
        this._logger.info('mDNS service unpublished');
    }

    private _serviceName(): string {
        return this._config.get<string>('UPDATER_ID') || os.hostname();
    }

    private _serviceType(): string {
        return 'https';
    }
}
