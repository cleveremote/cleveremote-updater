import * as fs from 'fs';
import * as os from 'os';
import {
    BadRequestException,
    HttpStatus,
    Injectable,
    InternalServerErrorException,
    NotImplementedException,
    OnApplicationBootstrap,
    OnModuleDestroy
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { NmcliExecutorService, NmcliResult } from './nmcli-executor.service';
import { NmcliError } from './nmcli.error';
import { ActiveConnectionRow, DeviceShowInfo, NmcliOutputParser, WifiNetwork } from './nmcli-output.parser';
import { WifiErrorMapper } from './wifi-error.mapper';
import { ErrorCode, ErrorBody } from '../../common/errors/error-code';
import { ConnectWifiDto } from './dto/connect-wifi.dto';
import {
    NMCLI_CONNECT_TIMEOUT_MS,
    NMCLI_CONNECT_WAIT_S,
    WIFI_BACKGROUND_RESCAN_INTERVAL_MS,
    WIFI_CONNECT_SCAN_ATTEMPTS,
    WIFI_CONNECT_SCAN_RETRY_MS,
    WIFI_DEFAULT_HOTSPOT_CON_NAME,
    WIFI_DEFAULT_HOTSPOT_SSID,
    WIFI_DEFAULT_INTERFACE,
    WIFI_HOTSPOT_CHANNEL,
    WIFI_HOTSPOT_DNSMASQ_CONF_PATH,
    WIFI_HOTSPOT_IPV4_CIDR,
    WIFI_HOTSPOT_POWERSAVE_DISABLED
} from './wifi.constants';

export { WifiNetwork } from './nmcli-output.parser';

// Réseau visible, annoté pour le front : isConfigured = un profil client mémorisé existe déjà pour ce SSID ;
// isConnected = la box est actuellement connectée (mode client, interface "connected") à ce SSID
export interface WifiNetworkListItem extends WifiNetwork {
    isConfigured: boolean;
    isConnected: boolean;
}

export interface WifiStatus {
    interface: string;
    mode: 'ap' | 'client' | 'disconnected';
    connectionName: string | null;
    ssid: string | null;
    deviceState: string;
}

// État réel du lien WiFi, lu en une seule commande nmcli (adapté à un polling fréquent) :
// 'hotspot' / 'client' uniquement si l'interface est "connected" ("connecting"/"deactivating" => 'none').
export type WifiLinkState = 'hotspot' | 'client' | 'none';

// Profil client WiFi mémorisé par NetworkManager
interface SavedWifiProfile {
    name: string;
    ssid: string;
}

const NMCLI_WIFI_CONNECTION_TYPE = '802-11-wireless';
const NMCLI_KEY_MGMT_WPA_PSK = 'wpa-psk';
const NMCLI_KEY_MGMT_SAE = 'sae';
// Doit rester sous NMCLI_TIMEOUT_MS : au-delà, nmcli rend la main mais NetworkManager poursuit l'activation
const NMCLI_DEVICE_CONNECT_WAIT_S = '10';

// Adaptateur NetworkManager (nmcli) de l'interface WiFi. L'orchestration des modes (setup / recovery / normal),
// le bouton et la LED sont dans BoxModeService.
@Injectable()
export class WifiService implements OnApplicationBootstrap, OnModuleDestroy {
    private _rescanTimer: NodeJS.Timeout | undefined;

    public constructor(
        private readonly _config: ConfigService,
        private readonly _nmcli: NmcliExecutorService,
        @InjectPinoLogger(WifiService.name) private readonly _logger: PinoLogger
    ) {
    }

    public onApplicationBootstrap(): void {
        if (os.platform() !== 'linux') {
            return;
        }
        this._rescanTimer = setInterval(() => {
            void this._backgroundRescan();
        }, WIFI_BACKGROUND_RESCAN_INTERVAL_MS);
        void this._checkHotspotDnsConfig();
    }

    public onModuleDestroy(): void {
        clearInterval(this._rescanTimer);
    }

    // SSID et mot de passe lus depuis la configuration (.env : WIFI_HOTSPOT_SSID, WIFI_HOTSPOT_PASSWORD)
    public async startHotspot(): Promise<WifiStatus> {
        this._assertLinux();
        const conName = this._hotspotConnectionName();
        const iface = this._interfaceName();
        const { ssid, password } = this._resolveHotspotCredentials();
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

    // Sans mot de passe, le profil déjà mémorisé pour ce SSID est réactivé tel quel ; à défaut de profil,
    // la requête est refusée (WIFI_PSK_REQUIRED) avant de toucher au hotspot.
    public async connect(dto: ConnectWifiDto): Promise<WifiStatus> {
        this._assertLinux();
        const iface = this._interfaceName();
        const savedProfile = dto.password === undefined ? await this._requireSavedProfile(dto.ssid) : undefined;
        await this._deleteHotspotProfile(this._hotspotConnectionName());
        try {
            const network = await this._waitForNetworkVisible(iface, dto.ssid);
            if (savedProfile === undefined) {
                await this._activateClientProfile(iface, dto, network);
            } else {
                await this._activateSavedProfile(iface, savedProfile);
            }
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
        const result = await this._run(this._wifiListArgs(iface, 'no'), 'scan networks');
        return NmcliOutputParser.parseWifiList(result.stdout);
    }

    public async listNetworks(): Promise<WifiNetworkListItem[]> {
        const [networks, savedSsids, status] = await Promise.all([this.scanNetworks(), this.getSavedWifiSsids(), this.getStatus()]);
        const saved = new Set(savedSsids);
        const connectedSsid = status.mode === 'client' && status.deviceState === 'connected' ? status.ssid : null;
        return networks.map((network) => {
            const hasSsid = network.ssid.length > 0;
            return {
                ...network,
                isConfigured: hasSsid && saved.has(network.ssid),
                isConnected: hasSsid && network.ssid === connectedSsid
            };
        });
    }

    public async getLinkState(): Promise<WifiLinkState> {
        this._assertLinux();
        const result = await this._run(
            ['-t', '-f', 'GENERAL.STATE,GENERAL.CONNECTION', 'device', 'show', this._interfaceName()],
            'get link state'
        );
        return this._toLinkState(NmcliOutputParser.parseDeviceShow(result.stdout));
    }

    // SSID des réseaux WiFi client mémorisés par NetworkManager (profil hotspot exclu)
    public async getSavedWifiSsids(): Promise<string[]> {
        this._assertLinux();
        const profiles = await this._listSavedWifiProfiles();
        return [...new Set(profiles.map((profile) => profile.ssid))];
    }

    // Demande à NetworkManager d'activer le meilleur profil client disponible (y compris un profil dont
    // l'autoconnect a été bloqué après des échecs). Le résultat se lit ensuite via getStatus()/getLinkState().
    public async reconnectClient(): Promise<void> {
        this._assertLinux();
        await this._runIgnoringFailure(['-w', NMCLI_DEVICE_CONNECT_WAIT_S, 'device', 'connect', this._interfaceName()]);
    }

    // Forces a real scan on a timer so scanNetworks() can safely stay on --rescan no
    // (a scan triggered mid user-request would interrupt our own hotspot beaconing).
    private async _backgroundRescan(): Promise<void> {
        const iface = this._interfaceName();
        await this._runIgnoringFailure(['device', 'wifi', 'list', 'ifname', iface, '--rescan', 'yes']);
    }

    // Le profil client est créé explicitement (type de sécurité compris) puis activé, au lieu de
    // `nmcli device wifi connect` : ce dernier réutilise un profil existant du même SSID et tente de le modifier,
    // ce que NetworkManager refuse pour un profil généré par netplan
    // ("802-11-wireless-security.key-mgmt: property is missing"), sans jamais essayer le mot de passe.
    // Le profil porte le nom du SSID, comme ceux que créait `device wifi connect` : il remplace donc l'ancien.
    private async _activateClientProfile(iface: string, dto: ConnectWifiDto, network: WifiNetwork | undefined): Promise<void> {
        const conName = dto.ssid;
        await this._runIgnoringFailure(['connection', 'delete', conName]);
        await this._run(
            [
                'connection', 'add', 'type', 'wifi', 'ifname', iface, 'con-name', conName, 'ssid', dto.ssid,
                'wifi-sec.key-mgmt', this._keyManagementFor(network),
                'wifi-sec.psk', dto.password
            ],
            'connect to network: create profile'
        );
        try {
            await this._run(
                ['-w', String(NMCLI_CONNECT_WAIT_S), 'connection', 'up', conName, 'ifname', iface],
                'connect to network',
                NMCLI_CONNECT_TIMEOUT_MS
            );
        } catch (err) {
            // Un profil au mot de passe refusé ne doit pas rester "réseau connu" (retry automatique du recovery)
            await this._runIgnoringFailure(['connection', 'delete', conName]);
            throw err;
        }
    }

    // Profil existant (créé par la box ou généré par netplan) : activé sans être modifié, et conservé en cas
    // d'échec puisque rien de nouveau n'a été saisi. Un mot de passe devenu faux remonte en WIFI_INVALID_PSK.
    private async _activateSavedProfile(iface: string, profile: SavedWifiProfile): Promise<void> {
        await this._run(
            ['-w', String(NMCLI_CONNECT_WAIT_S), 'connection', 'up', profile.name, 'ifname', iface],
            'connect to network: activate saved profile',
            NMCLI_CONNECT_TIMEOUT_MS
        );
    }

    private async _requireSavedProfile(ssid: string): Promise<SavedWifiProfile> {
        const profile = (await this._listSavedWifiProfiles()).find((candidate) => candidate.ssid === ssid);
        if (profile === undefined) {
            throw new BadRequestException(ErrorBody(
                HttpStatus.BAD_REQUEST, ErrorCode.WIFI_PSK_REQUIRED, 'a password is required for a WiFi network that is not configured yet'
            ));
        }
        return profile;
    }

    private async _listSavedWifiProfiles(): Promise<SavedWifiProfile[]> {
        const result = await this._run(['-t', '-f', 'NAME,TYPE', 'connection', 'show'], 'list saved connections');
        const names = NmcliOutputParser.parseConnectionList(result.stdout)
            .filter((row) => row.type === NMCLI_WIFI_CONNECTION_TYPE && row.name !== this._hotspotConnectionName())
            .map((row) => row.name);
        const profiles: SavedWifiProfile[] = [];
        for (const name of names) {
            const ssid = await this._getSsid(name);
            if (ssid !== null) {
                profiles.push({ name, ssid });
            }
        }
        return profiles;
    }

    // WPA3 seul => SAE ; WPA1/WPA2, mode mixte WPA2/WPA3 ou réseau absent du scan => WPA-PSK
    private _keyManagementFor(network: WifiNetwork | undefined): string {
        const security = network?.security ?? '';
        return security.includes('WPA3') && !/WPA[12]/.test(security) ? NMCLI_KEY_MGMT_SAE : NMCLI_KEY_MGMT_WPA_PSK;
    }

    // Juste après l'arrêt du hotspot, le réseau visé peut ne pas encore figurer dans la liste de scan de
    // NetworkManager : on attend de le voir, en forçant un scan (sans risque ici : le hotspot est déjà coupé).
    // Au mieux : s'il reste invisible, la connexion est tentée quand même et c'est nmcli qui donne l'erreur réelle.
    private async _waitForNetworkVisible(iface: string, ssid: string): Promise<WifiNetwork | undefined> {
        for (let attempt = 1; attempt <= WIFI_CONNECT_SCAN_ATTEMPTS; attempt += 1) {
            const network = (await this._scanBeforeConnect(iface)).find((candidate) => candidate.ssid === ssid);
            if (network !== undefined) {
                return network;
            }
            if (attempt < WIFI_CONNECT_SCAN_ATTEMPTS) {
                await this._sleep(WIFI_CONNECT_SCAN_RETRY_MS);
            }
        }
        this._logger.warn({ ssid, attempts: WIFI_CONNECT_SCAN_ATTEMPTS }, 'connect: network not seen in scan results, trying anyway');
        return undefined;
    }

    // Scan forcé ; s'il est refusé (scan déjà en cours, ou trop proche du précédent), on lit la liste en cache
    private async _scanBeforeConnect(iface: string): Promise<WifiNetwork[]> {
        return await this._tryListNetworks(iface, 'yes') ?? await this._tryListNetworks(iface, 'no') ?? [];
    }

    private async _tryListNetworks(iface: string, rescan: 'yes' | 'no'): Promise<WifiNetwork[] | null> {
        try {
            const result = await this._nmcli.run(this._wifiListArgs(iface, rescan));
            return NmcliOutputParser.parseWifiList(result.stdout);
        } catch (err) {
            if (err instanceof NmcliError) {
                this._logger.warn({ rescan, stderr: err.stderr }, 'connect: failed to list networks, ignoring');
                return null;
            }
            throw err;
        }
    }

    private _wifiListArgs(iface: string, rescan: 'yes' | 'no'): string[] {
        return ['-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', 'ifname', iface, '--rescan', rescan];
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
                '802-11-wireless.channel', WIFI_HOTSPOT_CHANNEL,
                '802-11-wireless.powersave', WIFI_HOTSPOT_POWERSAVE_DISABLED,
                'ipv4.method', 'shared',
                'ipv4.addresses', WIFI_HOTSPOT_IPV4_CIDR,
                'wifi-sec.key-mgmt', 'wpa-psk',
                'wifi-sec.psk', password
            ],
            'start hotspot: configure profile'
        );
    }

    // Non bloquant : sans cette config, seuls les clients mDNS (iOS, macOS, Linux) résolvent <hostname>.local sur le hotspot
    private async _checkHotspotDnsConfig(): Promise<void> {
        const expectedEntry = `interface-name=${os.hostname().toLowerCase()}.local,${this._interfaceName()}`;
        let content: string;
        try {
            content = await fs.promises.readFile(WIFI_HOTSPOT_DNSMASQ_CONF_PATH, 'utf8');
        } catch (err) {
            this._logger.warn(
                { err, path: WIFI_HOTSPOT_DNSMASQ_CONF_PATH },
                'hotspot DNS config missing: Android/Windows clients will not resolve the box hostname on the hotspot (run tools/provisioning/setup-box-network.sh)'
            );
            return;
        }
        if (!content.toLowerCase().includes(expectedEntry)) {
            this._logger.warn(
                { path: WIFI_HOTSPOT_DNSMASQ_CONF_PATH, expectedEntry },
                'hotspot DNS config does not match the current hostname/interface (re-run tools/provisioning/setup-box-network.sh)'
            );
        }
    }

    private async _restartHotspotAfterFailedConnect(): Promise<void> {
        try {
            await this.startHotspot();
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

    private _toLinkState(device: DeviceShowInfo): WifiLinkState {
        if (device.state !== 'connected') {
            return 'none';
        }
        return device.connection === this._hotspotConnectionName() ? 'hotspot' : 'client';
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

    private _resolveHotspotCredentials(): { ssid: string; password: string } {
        const ssid = this._config.get<string>('WIFI_HOTSPOT_SSID') || WIFI_DEFAULT_HOTSPOT_SSID;
        const password = this._config.get<string>('WIFI_HOTSPOT_PASSWORD');
        if (password === undefined || password.length === 0) {
            throw new InternalServerErrorException(ErrorBody(
                HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.WIFI_HOTSPOT_PASSWORD_NOT_CONFIGURED, 'WIFI_HOTSPOT_PASSWORD is not configured'
            ));
        }
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
            throw new NotImplementedException(ErrorBody(
                HttpStatus.NOT_IMPLEMENTED, ErrorCode.WIFI_UNSUPPORTED_PLATFORM, 'WiFi provisioning is only supported on Linux (NetworkManager/nmcli)'
            ));
        }
    }

    private async _run(args: string[], context: string, timeoutMs?: number): Promise<NmcliResult> {
        try {
            return await (timeoutMs === undefined ? this._nmcli.run(args) : this._nmcli.run(args, timeoutMs));
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

    private readonly _sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
}
