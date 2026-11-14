import * as fs from 'fs';
import * as os from 'os';
import { WifiService } from './wifi.service';
import { NmcliExecutorService } from './nmcli-executor.service';
import { NmcliError } from './nmcli.error';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
    NMCLI_CONNECT_TIMEOUT_MS,
    NMCLI_CONNECT_WAIT_S,
    WIFI_BACKGROUND_RESCAN_INTERVAL_MS,
    WIFI_CONNECT_SCAN_ATTEMPTS,
    WIFI_CONNECT_SCAN_RETRY_MS,
    WIFI_HOTSPOT_DNSMASQ_CONF_PATH
} from './wifi.constants';

const VALID_DNSMASQ_CONF = 'interface-name=zjzza6di.local,wlan0/4\nlocal=/local/\n';
const WIFI_LIST_RESCAN_ARGS = ['-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', 'ifname', 'wlan0', '--rescan', 'yes'];
const WIFI_LIST_CACHED_ARGS = ['-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', 'ifname', 'wlan0', '--rescan', 'no'];
const DELETE_CLIENT_PROFILE_ARGS = ['connection', 'delete', 'HomeNetwork'];
const ADD_CLIENT_PROFILE_ARGS = [
    'connection', 'add', 'type', 'wifi', 'ifname', 'wlan0', 'con-name', 'HomeNetwork', 'ssid', 'HomeNetwork',
    'wifi-sec.key-mgmt', 'wpa-psk',
    'wifi-sec.psk', 'housepass1'
];
const CONNECT_ARGS = ['-w', String(NMCLI_CONNECT_WAIT_S), 'connection', 'up', 'HomeNetwork', 'ifname', 'wlan0'];

describe('WifiService', () => {
    let service: WifiService;
    let config: { get: jest.Mock };
    let nmcli: { run: jest.Mock };
    let logger: { error: jest.Mock; warn: jest.Mock };
    let readFile: jest.SpyInstance;

    function ConfigureNmcliRun(
        overrides: { activeStdout?: string; deviceStdout?: string; wifiListStdout?: string; ssidStdout?: string } = {}
    ): void {
        nmcli.run.mockImplementation((args: string[]) => {
            if (args.includes('--active')) {
                return Promise.resolve({ stdout: overrides.activeStdout ?? '', stderr: '' });
            }
            if (args.includes('device') && args.includes('show')) {
                return Promise.resolve({ stdout: overrides.deviceStdout ?? '', stderr: '' });
            }
            if (args.includes('802-11-wireless.ssid')) {
                return Promise.resolve({ stdout: overrides.ssidStdout ?? '', stderr: '' });
            }
            if (args.includes('list')) {
                return Promise.resolve({ stdout: overrides.wifiListStdout ?? '', stderr: '' });
            }
            return Promise.resolve({ stdout: '', stderr: '' });
        });
    }

    async function flushMicrotasks(): Promise<void> {
        for (let i = 0; i < 5; i += 1) {
            await Promise.resolve();
        }
    }

    beforeEach(() => {
        config = { get: jest.fn() };
        nmcli = { run: jest.fn() };
        logger = { error: jest.fn(), warn: jest.fn() };
        service = new WifiService(config as any, nmcli as unknown as NmcliExecutorService, logger as any);
        jest.spyOn(os, 'platform').mockReturnValue('linux');
        jest.spyOn(os, 'hostname').mockReturnValue('ZJzzA6Di');
        readFile = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(VALID_DNSMASQ_CONF);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('startHotspot runs the expected nmcli command sequence and returns the resulting status', async () => {
        config.get.mockImplementation((key: string) => (key === 'WIFI_HOTSPOT_PASSWORD' ? 'supersecret' : undefined));
        ConfigureNmcliRun({
            activeStdout: 'cleveremote-hotspot:wlan0:wifi',
            deviceStdout: 'GENERAL.STATE:100 (connected)\nGENERAL.CONNECTION:cleveremote-hotspot',
            ssidStdout: '802-11-wireless.ssid:cleveremote-setup'
        });

        const status = await service.startHotspot({});

        const calledArgSets = nmcli.run.mock.calls.map((call) => call[0]);
        expect(calledArgSets).toEqual([
            ['connection', 'down', 'cleveremote-hotspot'],
            ['connection', 'delete', 'cleveremote-hotspot'],
            [
                'connection', 'add', 'type', 'wifi', 'ifname', 'wlan0',
                'con-name', 'cleveremote-hotspot', 'autoconnect', 'no', 'ssid', 'cleveremote-setup'
            ],
            [
                'connection', 'modify', 'cleveremote-hotspot',
                '802-11-wireless.mode', 'ap',
                '802-11-wireless.band', 'bg',
                'ipv4.method', 'shared',
                'ipv4.addresses', '10.42.0.1/24',
                'wifi-sec.key-mgmt', 'wpa-psk',
                'wifi-sec.psk', 'supersecret'
            ],
            ['connection', 'up', 'cleveremote-hotspot'],
            ['-t', '-f', 'NAME,DEVICE,TYPE', 'connection', 'show', '--active'],
            ['-t', '-f', 'GENERAL.STATE,GENERAL.CONNECTION', 'device', 'show', 'wlan0'],
            ['-t', '-f', '802-11-wireless.ssid', 'connection', 'show', 'cleveremote-hotspot']
        ]);
        expect(status).toEqual({
            interface: 'wlan0', mode: 'ap', connectionName: 'cleveremote-hotspot', ssid: 'cleveremote-setup', deviceState: 'connected'
        });
    });

    it('throws and never calls nmcli when no hotspot password is configured or supplied', async () => {
        config.get.mockReturnValue(undefined);
        await expect(service.startHotspot({})).rejects.toThrow('WIFI_HOTSPOT_PASSWORD is not configured');
        expect(nmcli.run).not.toHaveBeenCalled();
    });

    it('stopHotspot brings the hotspot profile down and deletes it, then reports status', async () => {
        ConfigureNmcliRun();
        await service.stopHotspot();
        const calledArgSets = nmcli.run.mock.calls.map((call) => call[0]);
        expect(calledArgSets[0]).toEqual(['connection', 'down', 'cleveremote-hotspot']);
        expect(calledArgSets[1]).toEqual(['connection', 'delete', 'cleveremote-hotspot']);
    });

    it('stopHotspot is idempotent when the profile does not exist', async () => {
        nmcli.run.mockImplementation((args: string[]) => {
            if (args[0] === 'connection' && (args[1] === 'down' || args[1] === 'delete')) {
                return Promise.reject(new NmcliError('failed', args, 1, '', 'Error: unknown connection', false));
            }
            return Promise.resolve({ stdout: '', stderr: '' });
        });

        await expect(service.stopHotspot()).resolves.toEqual({
            interface: 'wlan0', mode: 'disconnected', connectionName: null, ssid: null, deviceState: ''
        });
        expect(logger.warn).toHaveBeenCalled();
    });

    it('connect frees the radio, rescans until the network is visible, then creates its profile and activates it with the long timeout', async () => {
        ConfigureNmcliRun({
            activeStdout: 'HomeNetwork:wlan0:wifi',
            deviceStdout: 'GENERAL.STATE:100 (connected)\nGENERAL.CONNECTION:HomeNetwork',
            ssidStdout: '802-11-wireless.ssid:HomeNetwork',
            wifiListStdout: 'HomeNetwork:80:WPA2\n'
        });

        const status = await service.connect({ ssid: 'HomeNetwork', password: 'housepass1' });

        const calledArgSets = nmcli.run.mock.calls.map((call) => call[0]);
        expect(calledArgSets[0]).toEqual(['connection', 'down', 'cleveremote-hotspot']);
        expect(calledArgSets[1]).toEqual(['connection', 'delete', 'cleveremote-hotspot']);
        expect(calledArgSets[2]).toEqual(WIFI_LIST_RESCAN_ARGS);
        expect(calledArgSets[3]).toEqual(DELETE_CLIENT_PROFILE_ARGS);
        expect(calledArgSets[4]).toEqual(ADD_CLIENT_PROFILE_ARGS);
        expect(nmcli.run.mock.calls[5]).toEqual([CONNECT_ARGS, NMCLI_CONNECT_TIMEOUT_MS]);
        expect(status.mode).toBe('client');
        expect(status.connectionName).toBe('HomeNetwork');
        expect(status.ssid).toBe('HomeNetwork');
    });

    // `nmcli device wifi connect` modifie un profil existant du même SSID, ce que NetworkManager refuse pour un
    // profil netplan ("key-mgmt: property is missing") : la connexion ne doit jamais repasser par cette commande
    it('connect never relies on `nmcli device wifi connect`', async () => {
        ConfigureNmcliRun({ wifiListStdout: 'HomeNetwork:80:WPA2\n' });

        await service.connect({ ssid: 'HomeNetwork', password: 'housepass1' });

        const hasDeviceWifiConnect = nmcli.run.mock.calls.some((call) => call[0].includes('device') && call[0].includes('connect'));
        expect(hasDeviceWifiConnect).toBe(false);
    });

    it.each([
        ['WPA2', 'wpa-psk'],
        ['WPA1 WPA2', 'wpa-psk'],
        ['WPA2 WPA3', 'wpa-psk'],
        ['WPA3', 'sae']
    ])('connect creates the profile with the key management matching a %s network (%s)', async (security, keyMgmt) => {
        ConfigureNmcliRun({ wifiListStdout: `HomeNetwork:80:${security}\n` });

        await service.connect({ ssid: 'HomeNetwork', password: 'housepass1' });

        const addArgs = nmcli.run.mock.calls.map((call) => call[0]).find((args) => args[1] === 'add');
        expect(addArgs[addArgs.indexOf('wifi-sec.key-mgmt') + 1]).toBe(keyMgmt);
    });

    it('connect redacts the WiFi password when the profile creation fails', async () => {
        config.get.mockImplementation((key: string) => (key === 'WIFI_HOTSPOT_PASSWORD' ? 'supersecret' : undefined));
        nmcli.run.mockImplementation((args: string[]) => {
            if (args[1] === 'add' && args.includes('HomeNetwork')) {
                return Promise.reject(new NmcliError('failed', args, 1, '', 'Error: 802-11-wireless-security.psk: property is invalid.', false));
            }
            return Promise.resolve({ stdout: args.includes('list') ? 'HomeNetwork:80:WPA2\n' : '', stderr: '' });
        });

        await expect(service.connect({ ssid: 'HomeNetwork', password: 'housepass1' })).rejects.toBeInstanceOf(BadRequestException);

        const loggedArgs = logger.error.mock.calls[0][0].args;
        expect(loggedArgs).toContain('***');
        expect(loggedArgs).not.toContain('housepass1');
    });

    describe('connect: waiting for the network to show up in the scan results', () => {
        let sleep: jest.SpyInstance;

        function CountCalls(args: string[]): number {
            return nmcli.run.mock.calls.filter((call) => JSON.stringify(call[0]) === JSON.stringify(args)).length;
        }

        beforeEach(() => {
            sleep = jest.spyOn(service as any, '_sleep').mockResolvedValue(undefined);
        });

        it('rescans again when the network is missing from the first scan (hotspot just stopped)', async () => {
            let scanCount = 0;
            nmcli.run.mockImplementation((args: string[]) => {
                if (args.includes('list')) {
                    scanCount += 1;
                    return Promise.resolve({ stdout: scanCount === 1 ? 'Neighbour:40:WPA2\n' : 'HomeNetwork:80:WPA2\n', stderr: '' });
                }
                return Promise.resolve({ stdout: '', stderr: '' });
            });

            await service.connect({ ssid: 'HomeNetwork', password: 'housepass1' });

            expect(CountCalls(WIFI_LIST_RESCAN_ARGS)).toBe(2);
            expect(sleep).toHaveBeenCalledTimes(1);
            expect(sleep).toHaveBeenCalledWith(WIFI_CONNECT_SCAN_RETRY_MS);
            expect(CountCalls(CONNECT_ARGS)).toBe(1);
        });

        it('falls back to the cached list when the forced rescan is refused', async () => {
            nmcli.run.mockImplementation((args: string[]) => {
                if (args.includes('list') && args.includes('yes')) {
                    const stderr = 'Error: Scanning not allowed immediately following previous scan.';
                    return Promise.reject(new NmcliError('failed', args, 1, '', stderr, false));
                }
                if (args.includes('list')) {
                    return Promise.resolve({ stdout: 'HomeNetwork:80:WPA2\n', stderr: '' });
                }
                return Promise.resolve({ stdout: '', stderr: '' });
            });

            await service.connect({ ssid: 'HomeNetwork', password: 'housepass1' });

            expect(CountCalls(WIFI_LIST_CACHED_ARGS)).toBe(1);
            expect(sleep).not.toHaveBeenCalled();
            expect(CountCalls(CONNECT_ARGS)).toBe(1);
        });

        it('still attempts the connection when the network never shows up, then drops the profile and restarts the hotspot on failure', async () => {
            config.get.mockImplementation((key: string) => (key === 'WIFI_HOTSPOT_PASSWORD' ? 'supersecret' : undefined));
            nmcli.run.mockImplementation((args: string[]) => {
                if (JSON.stringify(args) === JSON.stringify(CONNECT_ARGS)) {
                    const stderr = 'Error: Connection activation failed: The Wi-Fi network could not be found';
                    return Promise.reject(new NmcliError('failed', args, 4, '', stderr, false));
                }
                return Promise.resolve({ stdout: '', stderr: '' });
            });

            await expect(service.connect({ ssid: 'HomeNetwork', password: 'housepass1' })).rejects.toBeInstanceOf(NotFoundException);

            expect(CountCalls(WIFI_LIST_RESCAN_ARGS)).toBe(WIFI_CONNECT_SCAN_ATTEMPTS);
            expect(sleep).toHaveBeenCalledTimes(WIFI_CONNECT_SCAN_ATTEMPTS - 1);
            expect(CountCalls(ADD_CLIENT_PROFILE_ARGS)).toBe(1);
            expect(CountCalls(CONNECT_ARGS)).toBe(1);
            // avant la création du profil, puis après l'échec de son activation
            expect(CountCalls(DELETE_CLIENT_PROFILE_ARGS)).toBe(2);
            expect(CountCalls(['connection', 'up', 'cleveremote-hotspot'])).toBe(1);
        });
    });

    it('getStatus reports disconnected when no active connection exists on the interface', async () => {
        ConfigureNmcliRun({ activeStdout: '', deviceStdout: 'GENERAL.STATE:30 (disconnected)\nGENERAL.CONNECTION:' });
        const status = await service.getStatus();
        expect(status).toEqual({
            interface: 'wlan0', mode: 'disconnected', connectionName: null, ssid: null, deviceState: 'disconnected'
        });
    });

    it('getStatus reports the SSID of the currently connected network', async () => {
        ConfigureNmcliRun({
            activeStdout: 'HomeNetwork:wlan0:wifi',
            deviceStdout: 'GENERAL.STATE:100 (connected)\nGENERAL.CONNECTION:HomeNetwork',
            ssidStdout: '802-11-wireless.ssid:HomeNetwork'
        });
        const status = await service.getStatus();
        expect(status.ssid).toBe('HomeNetwork');
    });

    it('getStatus returns a null ssid when reading it fails, without throwing', async () => {
        nmcli.run.mockImplementation((args: string[]) => {
            if (args.includes('--active')) {
                return Promise.resolve({ stdout: 'HomeNetwork:wlan0:wifi', stderr: '' });
            }
            if (args.includes('device') && args.includes('show')) {
                return Promise.resolve({ stdout: 'GENERAL.STATE:100 (connected)\nGENERAL.CONNECTION:HomeNetwork', stderr: '' });
            }
            if (args.includes('802-11-wireless.ssid')) {
                return Promise.reject(new NmcliError('failed', args, 1, '', 'Error: unknown connection', false));
            }
            return Promise.resolve({ stdout: '', stderr: '' });
        });

        const status = await service.getStatus();
        expect(status.ssid).toBeNull();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('scanNetworks parses the wifi list output', async () => {
        ConfigureNmcliRun({ wifiListStdout: 'HomeNetwork:80:WPA2\n' });
        const networks = await service.scanNetworks();
        expect(networks).toEqual([{ ssid: 'HomeNetwork', signal: 80, security: 'WPA2' }]);
    });

    it.each([
        ['startHotspot', () => service.startHotspot({})],
        ['stopHotspot', () => service.stopHotspot()],
        ['connect', () => service.connect({ ssid: 'x', password: 'password1' })],
        ['getStatus', () => service.getStatus()],
        ['scanNetworks', () => service.scanNetworks()]
    ])('%s rejects and never calls nmcli when the platform is not Linux', async (_name, invoke) => {
        jest.spyOn(os, 'platform').mockReturnValue('darwin');
        await expect(invoke()).rejects.toThrow();
        expect(nmcli.run).not.toHaveBeenCalled();
    });

    it('maps an nmcli failure to an HTTP exception and redacts the secret before logging', async () => {
        config.get.mockImplementation((key: string) => (key === 'WIFI_HOTSPOT_PASSWORD' ? 'supersecret' : undefined));
        nmcli.run.mockImplementation((args: string[]) => {
            if (args[0] === 'connection' && args[1] === 'modify') {
                return Promise.reject(new NmcliError('failed', args, 1, '', 'Error: Secrets were required, but not provided.', false));
            }
            return Promise.resolve({ stdout: '', stderr: '' });
        });

        await expect(service.startHotspot({})).rejects.toThrow();
        const loggedArgs = logger.error.mock.calls[0][0].args;
        expect(loggedArgs).toContain('***');
        expect(loggedArgs).not.toContain('supersecret');
    });

    it('getLinkState distinguishes hotspot, client and transitional states', async () => {
        ConfigureNmcliRun({ deviceStdout: 'GENERAL.STATE:100 (connected)\nGENERAL.CONNECTION:cleveremote-hotspot' });
        await expect(service.getLinkState()).resolves.toBe('hotspot');
        ConfigureNmcliRun({ deviceStdout: 'GENERAL.STATE:100 (connected)\nGENERAL.CONNECTION:HomeNetwork' });
        await expect(service.getLinkState()).resolves.toBe('client');
        ConfigureNmcliRun({ deviceStdout: 'GENERAL.STATE:70 (connecting (getting IP configuration))\nGENERAL.CONNECTION:HomeNetwork' });
        await expect(service.getLinkState()).resolves.toBe('none');
    });

    it('getSavedWifiSsids lists saved client WiFi profiles, excluding the hotspot and other connection types', async () => {
        nmcli.run.mockImplementation((args: string[]) => {
            if (args.includes('NAME,TYPE')) {
                return Promise.resolve({
                    stdout: 'HomeNetwork:802-11-wireless\ncleveremote-hotspot:802-11-wireless\nWired connection 1:802-3-ethernet\nlo:loopback\n',
                    stderr: ''
                });
            }
            if (args.includes('802-11-wireless.ssid')) {
                return Promise.resolve({ stdout: `802-11-wireless.ssid:${args[args.length - 1]}-ssid`, stderr: '' });
            }
            return Promise.resolve({ stdout: '', stderr: '' });
        });
        await expect(service.getSavedWifiSsids()).resolves.toEqual(['HomeNetwork-ssid']);
    });

    it('reconnectClient asks NetworkManager to connect the interface and ignores failures', async () => {
        nmcli.run.mockRejectedValue(new NmcliError('failed', [], 3, '', 'Error: Timeout expired', true));
        await expect(service.reconnectClient()).resolves.toBeUndefined();
        expect(nmcli.run).toHaveBeenCalledWith(['-w', '10', 'device', 'connect', 'wlan0']);
    });

    describe('background rescan', () => {
        beforeEach(() => {
            // @types/jest here predates the object-config overload; the installed @jest/fake-timers runtime supports it.
            (jest.useFakeTimers as unknown as (config: { doNotFake: string[] }) => void)({ doNotFake: ['performance', 'nextTick', 'queueMicrotask'] });
            config.get.mockImplementation((key: string) => (key === 'WIFI_HOTSPOT_PASSWORD' ? 'supersecret' : undefined));
            ConfigureNmcliRun({
                activeStdout: 'cleveremote-hotspot:wlan0:wifi',
                deviceStdout: 'GENERAL.STATE:100 (connected)\nGENERAL.CONNECTION:cleveremote-hotspot'
            });
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('triggers a forced rescan every WIFI_BACKGROUND_RESCAN_INTERVAL_MS after bootstrap', async () => {
            await service.onApplicationBootstrap();
            nmcli.run.mockClear();

            jest.advanceTimersByTime(WIFI_BACKGROUND_RESCAN_INTERVAL_MS);
            await flushMicrotasks();

            expect(nmcli.run).toHaveBeenCalledWith(['device', 'wifi', 'list', 'ifname', 'wlan0', '--rescan', 'yes']);
        });

        it('swallows nmcli failures during the background rescan without throwing', async () => {
            await service.onApplicationBootstrap();
            nmcli.run.mockImplementation((args: string[]) => (
                args.includes('--rescan')
                    ? Promise.reject(new NmcliError('failed', args, 1, '', 'Error: busy', false))
                    : Promise.resolve({ stdout: '', stderr: '' })
            ));

            jest.advanceTimersByTime(WIFI_BACKGROUND_RESCAN_INTERVAL_MS);
            await flushMicrotasks();

            expect(logger.warn).toHaveBeenCalled();
        });

        it('onModuleDestroy stops the timer so no further rescans occur', async () => {
            await service.onApplicationBootstrap();
            nmcli.run.mockClear();

            service.onModuleDestroy();
            jest.advanceTimersByTime(WIFI_BACKGROUND_RESCAN_INTERVAL_MS * 2);
            await flushMicrotasks();

            expect(nmcli.run).not.toHaveBeenCalled();
        });
    });

    describe('hotspot DNS config check at bootstrap', () => {
        afterEach(() => {
            service.onModuleDestroy();
        });

        it('stays silent when the dnsmasq config matches the hostname (case-insensitive) and interface', async () => {
            service.onApplicationBootstrap();
            await flushMicrotasks();

            expect(readFile).toHaveBeenCalledWith(WIFI_HOTSPOT_DNSMASQ_CONF_PATH, 'utf8');
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it('warns without throwing when the dnsmasq config is missing', async () => {
            readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

            service.onApplicationBootstrap();
            await flushMicrotasks();

            expect(logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({ path: WIFI_HOTSPOT_DNSMASQ_CONF_PATH }),
                expect.stringContaining('hotspot DNS config missing')
            );
        });

        it('warns when the dnsmasq config targets another hostname', async () => {
            readFile.mockResolvedValue('interface-name=pi-dev-1.local,wlan0/4\n');

            service.onApplicationBootstrap();
            await flushMicrotasks();

            expect(logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({ expectedEntry: 'interface-name=zjzza6di.local,wlan0' }),
                expect.stringContaining('does not match')
            );
        });

        it('skips the check outside Linux', async () => {
            jest.spyOn(os, 'platform').mockReturnValue('darwin');

            service.onApplicationBootstrap();
            await flushMicrotasks();

            expect(readFile).not.toHaveBeenCalled();
        });
    });
});
