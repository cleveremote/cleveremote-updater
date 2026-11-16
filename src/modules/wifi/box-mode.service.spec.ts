import * as os from 'os';
import { BoxModeService } from './box-mode.service';
import { WifiService, WifiStatus } from './wifi.service';
import { AuthenticationService } from '../authentication/authentication.service';
import { ConfigureService } from './configure.service';
import { ConfigureState } from './configure.model';
import { BOX_BOOT_CONNECT_TIMEOUT_MS, BOX_RECOVERY_MAX_RETRIES, BOX_STATUS_POLL_MS } from './wifi.constants';
import { watchGpioLongPress } from '../../common/tools/gpio-long-press';
import { ErrorCode } from '../../common/errors/error-code';

// Jamais de vrai GPIO en test (la suite peut tourner sur le Raspberry Pi)
jest.mock('../../common/tools/gpio-long-press', () => ({
    watchGpioLongPress: jest.fn().mockResolvedValue({ stop: jest.fn() })
}));
jest.mock('../../common/tools/gpio-blink', () => ({
    createGpioBlinker: jest.fn().mockResolvedValue({ start: jest.fn(), stop: jest.fn() })
}));

describe('BoxModeService', () => {
    // Faux WiFi à état : hotspot actif => 'ap', sinon 'client' si le réseau connu est joignable
    let net: { hotspot: boolean; reachable: boolean };
    type WifiMethod = 'getStatus' | 'startHotspot' | 'stopHotspot' | 'reconnectClient' | 'getLinkState' | 'getSavedWifiSsids' | 'scanNetworks';
    let wifi: Record<WifiMethod, jest.Mock>;
    let auth: { hasConfiguredAccount: jest.Mock };
    let configureState: ConfigureState;
    let logger: Record<'info' | 'warn' | 'error' | 'debug', jest.Mock>;
    let service: BoxModeService;

    function Status(): WifiStatus {
        const mode = net.hotspot ? 'ap' : net.reachable ? 'client' : 'disconnected';
        return { interface: 'wlan0', mode, connectionName: null, ssid: null, deviceState: mode === 'disconnected' ? 'disconnected' : 'connected' };
    }

    async function Boot(): Promise<void> {
        await service.onApplicationBootstrap();
        await service.whenIdle();
    }

    function LongPress(): void {
        const onLongPress = (watchGpioLongPress as jest.Mock).mock.calls[0][1] as (heldMs: number) => void;
        onLongPress(5000);
    }

    function Retry(): Promise<void> {
        return (service as unknown as { _retryRecoveryIfPossible: () => Promise<void> })._retryRecoveryIfPossible();
    }

    beforeEach(() => {
        // @types/jest here predates the object-config overload; the installed @jest/fake-timers runtime supports it.
        (jest.useFakeTimers as unknown as (config: { doNotFake: string[] }) => void)({ doNotFake: ['performance', 'nextTick', 'queueMicrotask'] });
        jest.spyOn(os, 'platform').mockReturnValue('linux');
        (watchGpioLongPress as jest.Mock).mockClear();
        net = { hotspot: false, reachable: true };
        wifi = {
            getStatus: jest.fn(() => Promise.resolve(Status())),
            startHotspot: jest.fn(() => {
                net.hotspot = true;
                return Promise.resolve(Status());
            }),
            stopHotspot: jest.fn(() => {
                net.hotspot = false;
                return Promise.resolve(Status());
            }),
            reconnectClient: jest.fn().mockResolvedValue(undefined),
            getLinkState: jest.fn(() => Promise.resolve(net.hotspot ? 'hotspot' : net.reachable ? 'client' : 'none')),
            getSavedWifiSsids: jest.fn().mockResolvedValue(['HomeNetwork']),
            scanNetworks: jest.fn().mockResolvedValue([{ ssid: 'HomeNetwork', signal: 70, security: 'WPA2' }])
        };
        auth = { hasConfiguredAccount: jest.fn().mockResolvedValue(true) };
        configureState = { status: 'idle', errorCode: null, ssid: null, startedAt: null, finishedAt: null };
        logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        service = new BoxModeService(
            wifi as unknown as WifiService,
            auth as unknown as AuthenticationService,
            { getState: () => configureState } as unknown as ConfigureService,
            logger as any
        );
        // L'attente entre deux lectures d'état est instantanée en test
        jest.spyOn(service as unknown as { _sleep: (ms: number) => Promise<void> }, '_sleep').mockResolvedValue(undefined);
    });

    afterEach(() => {
        service.onModuleDestroy();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    describe('startup', () => {
        it('starts the hotspot in setup mode when no account is configured', async () => {
            auth.hasConfiguredAccount.mockResolvedValue(false);
            await Boot();
            expect(wifi.startHotspot).toHaveBeenCalledTimes(1);
            await expect(service.getMode()).resolves.toMatchObject({ mode: 'setup', recoveryReason: null });
        });

        it('stays in normal mode when the known network connects', async () => {
            await Boot();
            expect(wifi.startHotspot).not.toHaveBeenCalled();
            expect(wifi.reconnectClient).not.toHaveBeenCalled();
            await expect(service.getMode()).resolves.toMatchObject({ mode: 'normal', recoveryReason: null });
        });

        it('waits for NetworkManager, then enters recovery when the known network never connects', async () => {
            net.reachable = false;
            await Boot();
            expect(wifi.getStatus).toHaveBeenCalledTimes(1 + Math.ceil(BOX_BOOT_CONNECT_TIMEOUT_MS / BOX_STATUS_POLL_MS));
            expect(wifi.startHotspot).toHaveBeenCalledTimes(1);
            await expect(service.getMode()).resolves.toMatchObject({ mode: 'recovery', recoveryReason: 'connection-failed' });
        });

        it('keeps polling while nmcli is not ready yet', async () => {
            wifi.getStatus
                .mockRejectedValueOnce(new Error('NetworkManager not running'))
                .mockRejectedValueOnce(new Error('NetworkManager not running'));
            await Boot();
            expect(wifi.startHotspot).not.toHaveBeenCalled();
            await expect(service.getMode()).resolves.toMatchObject({ mode: 'normal' });
        });

        it('stops a leftover hotspot and actively reconnects the known network', async () => {
            net.hotspot = true;
            await Boot();
            expect(wifi.stopHotspot).toHaveBeenCalledTimes(1);
            expect(wifi.reconnectClient).toHaveBeenCalledTimes(1);
            await expect(service.getMode()).resolves.toMatchObject({ mode: 'normal' });
        });

        it('assumes a configured box when the account check fails', async () => {
            auth.hasConfiguredAccount.mockRejectedValue(new Error('mongo down'));
            await Boot();
            expect(wifi.startHotspot).not.toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalled();
        });

        it('reports the starting mode while the startup sequence runs', async () => {
            let release: () => void = () => undefined;
            auth.hasConfiguredAccount.mockReturnValueOnce(new Promise((resolve) => {
                release = (): void => resolve(true);
            }));
            await service.onApplicationBootstrap();
            await expect(service.getMode()).resolves.toMatchObject({ mode: 'starting' });
            release();
            await service.whenIdle();
        });
    });

    describe('recovery button (long press)', () => {
        it('enters manual recovery from normal mode', async () => {
            await Boot();
            LongPress();
            await service.whenIdle();
            expect(wifi.startHotspot).toHaveBeenCalledTimes(1);
            await expect(service.getMode()).resolves.toMatchObject({ mode: 'recovery', recoveryReason: 'manual' });
        });

        it('leaves recovery and goes back to normal when the known network connects', async () => {
            await Boot();
            LongPress();
            await service.whenIdle();
            LongPress();
            await service.whenIdle();
            expect(wifi.stopHotspot).toHaveBeenCalledTimes(1);
            expect(wifi.reconnectClient).toHaveBeenCalledTimes(1);
            await expect(service.getMode()).resolves.toMatchObject({ mode: 'normal', recoveryReason: null });
        });

        it('falls back to automatic recovery when leaving recovery fails to connect', async () => {
            await Boot();
            LongPress();
            await service.whenIdle();
            net.reachable = false;
            LongPress();
            await service.whenIdle();
            expect(wifi.startHotspot).toHaveBeenCalledTimes(2);
            await expect(service.getMode()).resolves.toMatchObject({ mode: 'recovery', recoveryReason: 'connection-failed' });
        });

        it('stops the hotspot in setup mode, without falling back to recovery', async () => {
            auth.hasConfiguredAccount.mockResolvedValue(false);
            net.reachable = false;
            await Boot();
            LongPress();
            await service.whenIdle();
            expect(wifi.stopHotspot).toHaveBeenCalledTimes(1);
            expect(wifi.reconnectClient).toHaveBeenCalledTimes(1);
            expect(wifi.startHotspot).toHaveBeenCalledTimes(1);
            await expect(service.getMode()).resolves.toMatchObject({
                mode: 'setup', recoveryReason: null, wifi: { mode: 'disconnected' }
            });
        });

        it('restarts the hotspot in setup mode when it is off', async () => {
            auth.hasConfiguredAccount.mockResolvedValue(false);
            await Boot();
            LongPress();
            await service.whenIdle();
            LongPress();
            await service.whenIdle();
            expect(wifi.stopHotspot).toHaveBeenCalledTimes(1);
            expect(wifi.startHotspot).toHaveBeenCalledTimes(2);
            await expect(service.getMode()).resolves.toMatchObject({ mode: 'setup', wifi: { mode: 'ap' } });
        });

        it('ignores a long press while another transition is in progress', async () => {
            net.reachable = false;
            await service.onApplicationBootstrap();
            LongPress();
            await service.whenIdle();
            expect(wifi.startHotspot).toHaveBeenCalledTimes(1);
            expect(logger.info).toHaveBeenCalledWith({ transition: 'recovery button' }, 'another transition is in progress, ignoring');
        });
    });

    describe('automatic recovery retry', () => {
        async function BootIntoAutoRecovery(): Promise<void> {
            net.reachable = false;
            await Boot();
            wifi.startHotspot.mockClear();
            wifi.stopHotspot.mockClear();
        }

        it('reconnects when a known network is visible again', async () => {
            await BootIntoAutoRecovery();
            net.reachable = true;
            await Retry();
            await service.whenIdle();
            expect(wifi.stopHotspot).toHaveBeenCalledTimes(1);
            await expect(service.getMode()).resolves.toMatchObject({ mode: 'normal' });
        });

        it('does not drop the hotspot when no known network is visible', async () => {
            await BootIntoAutoRecovery();
            wifi.scanNetworks.mockResolvedValue([{ ssid: 'Neighbour', signal: 40, security: 'WPA2' }]);
            await Retry();
            await service.whenIdle();
            expect(wifi.stopHotspot).not.toHaveBeenCalled();
        });

        it(`gives up after ${BOX_RECOVERY_MAX_RETRIES} failed attempts`, async () => {
            await BootIntoAutoRecovery();
            for (let i = 0; i < BOX_RECOVERY_MAX_RETRIES + 2; i += 1) {
                await Retry();
                await service.whenIdle();
            }
            expect(wifi.stopHotspot).toHaveBeenCalledTimes(BOX_RECOVERY_MAX_RETRIES);
            await expect(service.getMode()).resolves.toMatchObject({ mode: 'recovery', recoveryReason: 'connection-failed' });
        });

        it('does not retry while a configure is in progress', async () => {
            await BootIntoAutoRecovery();
            configureState = { ...configureState, status: 'in-progress', ssid: 'HomeNetwork' };
            await Retry();
            await service.whenIdle();
            expect(wifi.stopHotspot).not.toHaveBeenCalled();
        });

        it('never retries in manual recovery', async () => {
            await Boot();
            LongPress();
            await service.whenIdle();
            await Retry();
            await service.whenIdle();
            expect(wifi.stopHotspot).not.toHaveBeenCalled();
        });
    });

    describe('configure result', () => {
        it('exposes the result of the last configure next to the mode', async () => {
            net.reachable = false;
            await Boot();
            configureState = {
                status: 'failed',
                errorCode: ErrorCode.WIFI_INVALID_PSK,
                ssid: 'HomeNetwork',
                startedAt: '2026-11-16T10:00:00.000Z',
                finishedAt: '2026-11-16T10:00:20.000Z'
            };
            await expect(service.getMode()).resolves.toMatchObject({ mode: 'recovery', configure: configureState });
        });

        it('reports the connecting mode while a configure is in progress', async () => {
            auth.hasConfiguredAccount.mockResolvedValue(false);
            await Boot();
            configureState = { ...configureState, status: 'in-progress', ssid: 'HomeNetwork' };
            await expect(service.getMode()).resolves.toMatchObject({
                mode: 'connecting', recoveryReason: null, configure: { status: 'in-progress' }
            });
        });
    });

    it('reports a hotspot opened outside this service (HTTP) as manual recovery', async () => {
        await Boot();
        net.hotspot = true;
        await expect(service.getMode()).resolves.toMatchObject({ mode: 'recovery', recoveryReason: 'manual' });
    });
});
