import * as os from 'os';
import { Injectable, InternalServerErrorException, NotImplementedException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { NmcliExecutorService, NmcliResult } from './nmcli-executor.service';
import { NmcliError } from './nmcli.error';
import { ActiveConnectionRow, DeviceShowInfo, NmcliOutputParser, WifiNetwork } from './nmcli-output.parser';
import { WifiErrorMapper } from './wifi-error.mapper';
import { ConnectWifiDto } from './dto/connect-wifi.dto';
import { StartHotspotDto } from './dto/start-hotspot.dto';
import {
    WIFI_BACKGROUND_RESCAN_INTERVAL_MS,
    WIFI_DEFAULT_HOTSPOT_CON_NAME,
    WIFI_DEFAULT_HOTSPOT_SSID,
    WIFI_DEFAULT_INTERFACE
} from './wifi.constants';

export { WifiNetwork } from './nmcli-output.parser';

export interface WifiStatus {
    interface: string;
    mode: 'ap' | 'client' | 'disconnected';
    connectionName: string | null;
    ssid: string | null;
    deviceState: string;
}

@Injectable()
export class WifiService implements OnApplicationBootstrap, OnModuleDestroy {
    private _rescanTimer: NodeJS.Timeout | undefined;

    public constructor(
        private readonly _config: ConfigService,
        private readonly _nmcli: NmcliExecutorService,
        @InjectPinoLogger(WifiService.name) private readonly _logger: PinoLogger
    ) {
    }

    public async onApplicationBootstrap(): Promise<void> {

        if (os.platform() !== 'linux') {
            return;
        }
        try {
            // const status = await this.getStatus();
            // console.log('status', status);
            // if (status.mode !== 'disconnected') {
            //     return;
            // }
            // this._logger.info('no active WiFi connection at startup, starting hotspot'); ///NNN
            await this.startHotspot({});
        } catch (err) {
            this._logger.error({ err }, 'failed to auto-start hotspot at startup');
        }
        this._rescanTimer = setInterval(() => {
            void this._backgroundRescan();
        }, WIFI_BACKGROUND_RESCAN_INTERVAL_MS);
    }

    public onModuleDestroy(): void {
        clearInterval(this._rescanTimer);
    }

    public async startHotspot(dto: StartHotspotDto): Promise<WifiStatus> {
        this._assertLinux();
        const conName = this._hotspotConnectionName();
        const iface = this._interfaceName();
        const { ssid, password } = this._resolveHotspotCredentials(dto);
        await this._deleteHotspotProfile(conName);
        await this._createHotspotProfile(conName, iface, ssid, password);
        await this._run(['connection', 'up', conName], 'start hotspot: activate');
        return this.getStatus();
    }

    public async stopHotspot(): Promise<WifiStatus> {
        this._assertLinux();
        await this._deleteHotspotProfile(this._hotspotConnectionName());
        return this.getStatus();
    }

    public async connect(dto: ConnectWifiDto): Promise<WifiStatus> {
        this._assertLinux();
        const iface = this._interfaceName();
        await this._deleteHotspotProfile(this._hotspotConnectionName());
        try {
            await this._run(['device', 'wifi', 'connect', dto.ssid, 'password', dto.password, 'ifname', iface], 'connect to network');
        } catch (err) {
            await this._restartHotspotAfterFailedConnect();
            throw err;
        }
        return this.getStatus();
    }

    public async getStatus(): Promise<WifiStatus> {
        this._assertLinux();
        const iface = this._interfaceName();
        const [activeResult, deviceResult] = await Promise.all([
            this._run(['-t', '-f', 'NAME,DEVICE,TYPE', 'connection', 'show', '--active'], 'get status: active connections'),
            this._run(['-t', '-f', 'GENERAL.STATE,GENERAL.CONNECTION', 'device', 'show', iface], 'get status: device state')
        ]);
        const active = NmcliOutputParser.parseActiveConnections(activeResult.stdout).find((row) => row.device === iface);
        const device = NmcliOutputParser.parseDeviceShow(deviceResult.stdout);
        const ssid = active === undefined ? null : await this._getSsid(active.name);
        return this._buildStatus(iface, active, device, ssid);
    }

    public async scanNetworks(): Promise<WifiNetwork[]> {
        this._assertLinux();
        const iface = this._interfaceName();
        // --rescan no: a forced rescan briefly interrupts AP beaconing on this single radio,
        // dropping clients connected to our own hotspot mid-request. Return the cached list instead.
        const result = await this._run(
            ['-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', 'ifname', iface, '--rescan', 'no'],
            'scan networks'
        );
        return NmcliOutputParser.parseWifiList(result.stdout);
    }

    // Forces a real scan on a timer so scanNetworks() can safely stay on --rescan no
    // (a scan triggered mid user-request would interrupt our own hotspot beaconing).
    private async _backgroundRescan(): Promise<void> {
        const iface = this._interfaceName();
        await this._runIgnoringFailure(['device', 'wifi', 'list', 'ifname', iface, '--rescan', 'yes']);
    }

    private async _createHotspotProfile(conName: string, iface: string, ssid: string, password: string): Promise<void> {
        await this._run(
            ['connection', 'add', 'type', 'wifi', 'ifname', iface, 'con-name', conName, 'autoconnect', 'no', 'ssid', ssid],
            'start hotspot: create profile'
        );
        await this._run(
            [
                'connection', 'modify', conName,
                '802-11-wireless.mode', 'ap',
                '802-11-wireless.band', 'bg',
                'ipv4.method', 'shared',
                'wifi-sec.key-mgmt', 'wpa-psk',
                'wifi-sec.psk', password
            ],
            'start hotspot: configure profile'
        );
    }

    private async _restartHotspotAfterFailedConnect(): Promise<void> {
        try {
            await this.startHotspot({});
        } catch (err) {
            this._logger.error({ err }, 'connect: failed to restart hotspot after failed connection attempt');
        }
    }

    private async _deleteHotspotProfile(conName: string): Promise<void> {
        await this._runIgnoringFailure(['connection', 'down', conName]);
        await this._runIgnoringFailure(['connection', 'delete', conName]);
    }

    private async _getSsid(connectionName: string): Promise<string | null> {
        try {
            const result = await this._nmcli.run(['-t', '-f', '802-11-wireless.ssid', 'connection', 'show', connectionName]);
            return NmcliOutputParser.parseSsid(result.stdout);
        } catch (err) {
            if (err instanceof NmcliError) {
                this._logger.warn({ connectionName, stderr: err.stderr }, 'get status: failed to read ssid, ignoring');
                return null;
            }
            throw err;
        }
    }

    private _buildStatus(
        iface: string,
        active: ActiveConnectionRow | undefined,
        device: DeviceShowInfo,
        ssid: string | null
    ): WifiStatus {
        if (active === undefined) {
            return { interface: iface, mode: 'disconnected', connectionName: null, ssid: null, deviceState: device.state };
        }
        const mode = active.name === this._hotspotConnectionName() ? 'ap' : 'client';
        return { interface: iface, mode, connectionName: active.name, ssid, deviceState: device.state };
    }

    private _resolveHotspotCredentials(dto: StartHotspotDto): { ssid: string; password: string } {
        const ssid = dto.ssid ?? this._config.get<string>('WIFI_HOTSPOT_SSID') ?? WIFI_DEFAULT_HOTSPOT_SSID;
        const password = 'Nya0113?'//dto.password ?? this._config.get<string>('WIFI_HOTSPOT_PASSWORD');
        if (password === undefined || password.length === 0) {
            throw new InternalServerErrorException('WIFI_HOTSPOT_PASSWORD is not configured');
        }
        console.log('ssid', ssid, 'password', password);
        return { ssid, password };
    }

    private _interfaceName(): string {
        return this._config.get<string>('WIFI_INTERFACE') ?? WIFI_DEFAULT_INTERFACE;
    }

    private _hotspotConnectionName(): string {
        return this._config.get<string>('WIFI_HOTSPOT_CON_NAME') ?? WIFI_DEFAULT_HOTSPOT_CON_NAME;
    }

    private _assertLinux(): void {
        if (os.platform() !== 'linux') {
            throw new NotImplementedException('WiFi provisioning is only supported on Linux (NetworkManager/nmcli)');
        }
    }

    private async _run(args: string[], context: string): Promise<NmcliResult> {
        try {
            return await this._nmcli.run(args);
        } catch (err) {
            if (err instanceof NmcliError) {
                this._logger.error({ args: this._redactArgs(args), stderr: err.stderr }, `nmcli command failed: ${context}`);
                throw WifiErrorMapper.toHttpException(err, context);
            }
            throw err;
        }
    }

    private async _runIgnoringFailure(args: string[]): Promise<void> {
        try {
            await this._nmcli.run(args);
        } catch (err) {
            if (err instanceof NmcliError) {
                this._logger.warn({ args: this._redactArgs(args), stderr: err.stderr }, 'nmcli cleanup command failed, ignoring');
                return;
            }
            throw err;
        }
    }

    private _redactArgs(args: string[]): string[] {
        const secretKeys = new Set(['wifi-sec.psk', 'password']);
        return args.map((arg, index) => (index > 0 && secretKeys.has(args[index - 1]) ? '***' : arg));
    }
}
