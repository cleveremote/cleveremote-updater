import * as os from 'os';
import { WifiService } from './wifi.service';
import { NmcliExecutorService } from './nmcli-executor.service';
import { NmcliError } from './nmcli.error';
import { WIFI_BACKGROUND_RESCAN_INTERVAL_MS } from './wifi.constants';

describe('WifiService', () => {
    let service: WifiService;
    let config: { get: jest.Mock };
    let nmcli: { run: jest.Mock };
    let logger: { error: jest.Mock; warn: jest.Mock };

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

    it('connect activates the requested network and cleans up the hotspot profile afterwards', async () => {
        ConfigureNmcliRun({
            activeStdout: 'HomeNetwork:wlan0:wifi',
            deviceStdout: 'GENERAL.STATE:100 (connected)\nGENERAL.CONNECTION:HomeNetwork',
            ssidStdout: '802-11-wireless.ssid:HomeNetwork'
        });

        const status = await service.connect({ ssid: 'HomeNetwork', password: 'housepass1' });

        const calledArgSets = nmcli.run.mock.calls.map((call) => call[0]);
        expect(calledArgSets[0]).toEqual(['device', 'wifi', 'connect', 'HomeNetwork', 'password', 'housepass1', 'ifname', 'wlan0']);
        expect(calledArgSets[1]).toEqual(['connection', 'down', 'cleveremote-hotspot']);
        expect(calledArgSets[2]).toEqual(['connection', 'delete', 'cleveremote-hotspot']);
        expect(status.mode).toBe('client');
        expect(status.connectionName).toBe('HomeNetwork');
        expect(status.ssid).toBe('HomeNetwork');
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
});
