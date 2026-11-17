import * as os from 'os';
import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WifiService, WifiStatus } from './wifi.service';
import { BoxModeStatus, RecoveryReason, TransitionPhase } from './box-mode.model';
import { BoxGpio } from './box-gpio';
import { AuthenticationService } from '../authentication/authentication.service';
import { ConfigureService } from './configure.service';
import {
    BOX_BOOT_CONNECT_TIMEOUT_MS,
    BOX_RECONNECT_TIMEOUT_MS,
    BOX_RECOVERY_MAX_RETRIES,
    BOX_RECOVERY_RETRY_INTERVAL_MS,
    BOX_STATUS_LED_CHECK_INTERVAL_MS,
    BOX_STATUS_POLL_MS
} from './wifi.constants';

/**
 * Modes de la box : décision au démarrage, recovery automatique (avec nouvelles tentatives), recovery manuel
 * (appui long sur le bouton) et LED. Le mode exposé est dérivé de l'état réel (compte en base + nmcli), donc
 * reste juste après hotspot/start, hotspot/stop, connect ou configure ; seule la raison du recovery est mémorisée.
 */
@Injectable()
export class BoxModeService implements OnApplicationBootstrap, OnModuleDestroy {
    private _recoveryReason: RecoveryReason | null = null;
    private _retryCount = 0;
    private _phase: TransitionPhase | null = null;
    // Verrou unique partagé par le démarrage, le bouton et les tentatives automatiques
    private _transition: Promise<void> | null = null;
    private _gpio: BoxGpio | undefined;
    private _timers: NodeJS.Timeout[] = [];

    public constructor(
        private readonly _wifiService: WifiService,
        private readonly _authenticationService: AuthenticationService,
        private readonly _configureService: ConfigureService,
        @InjectPinoLogger(BoxModeService.name) private readonly _logger: PinoLogger
    ) {
    }

    public async onApplicationBootstrap(): Promise<void> {
        if (os.platform() !== 'linux') {
            return;
        }
        this._gpio = await BoxGpio.open((heldMs) => this._onButtonLongPress(heldMs), this._logger);
        this._timers = [
            setInterval(() => void this._refreshLinkState(), BOX_STATUS_LED_CHECK_INTERVAL_MS),
            setInterval(() => void this._retryRecoveryIfPossible(), BOX_RECOVERY_RETRY_INTERVAL_MS)
        ];
        // Non attendu : l'attente du WiFi (jusqu'à BOX_BOOT_CONNECT_TIMEOUT_MS) ne doit pas retarder app.listen()
        this._runExclusive('startup', () => this._startup());
    }

    public onModuleDestroy(): void {
        this._timers.forEach((timer) => clearInterval(timer));
        this._gpio?.close();
    }

    public async getMode(): Promise<BoxModeStatus> {
        // lu avant tout await : un configure qui se termine pendant les lectures suivantes reste rapporté 'in-progress'
        const configure = this._configureService.getState();
        const wifi = await this._readStatus();
        const transient = this._phase ?? (configure.status === 'in-progress' ? 'connecting' : null);
        if (transient !== null || !await this._hasConfiguredAccount()) {
            return { mode: transient ?? 'setup', recoveryReason: null, wifi, configure };
        }
        // hotspot ouvert hors de ce service (POST hotspot/start) => assimilé à un recovery manuel
        const recoveryReason = wifi?.mode === 'ap' ? this._recoveryReason ?? 'manual' : null;
        return { mode: recoveryReason === null ? 'normal' : 'recovery', recoveryReason, wifi, configure };
    }

    // Résolue quand aucune transition n'est en cours (tests, arrêt propre)
    public whenIdle(): Promise<void> {
        return this._transition ?? Promise.resolve();
    }

    private async _startup(): Promise<void> {
        this._phase = 'starting';
        try {
            if (!await this._hasConfiguredAccount()) {
                this._logger.info('startup: no configured account, starting hotspot (setup mode)');
                await this._wifiService.startHotspot();
                return;
            }
            // Hotspot resté actif (application redémarrée pendant un recovery) : coupé, puis reconnexion explicite
            const hasLeftoverHotspot = (await this._readStatus())?.mode === 'ap';
            if (hasLeftoverHotspot) {
                this._logger.info('startup: leftover hotspot found, stopping it');
                await this._wifiService.stopHotspot();
            }
            this._retryCount = 0;
            await this._connectOrEnterRecovery(BOX_BOOT_CONNECT_TIMEOUT_MS, hasLeftoverHotspot);
        } finally {
            this._phase = null;
        }
    }

    // Appui long, hotspot coupé - setup : le rouvre ; normal : entre en recovery manuel.
    // Hotspot ouvert - recovery : en sort et tente le réseau connu (échec => recovery automatique) ;
    // setup : le coupe et tente au mieux un réseau déjà mémorisé, sans repli (il revient au prochain appui ou au redémarrage)
    private _onButtonLongPress(heldMs: number): void {
        this._runExclusive('recovery button', async () => {
            const isSetup = !await this._hasConfiguredAccount();
            if ((await this._readStatus())?.mode !== 'ap') {
                this._logger.info({ heldMs, isSetup }, 'recovery button: starting hotspot');
                await (isSetup ? this._wifiService.startHotspot() : this._enterRecovery('manual'));
                return;
            }
            this._logger.info({ heldMs, isSetup }, 'recovery button: stopping hotspot');
            this._retryCount = 0;
            await this._wifiService.stopHotspot();
            if (isSetup) {
                await this._wifiService.reconnectClient();
                return;
            }
            await this._connectOrEnterRecovery(BOX_RECONNECT_TIMEOUT_MS, true);
        });
    }

    // Le hotspot et le client partagent la même radio : chaque tentative coupe le hotspot.
    // On ne tente donc que si un réseau connu est visible dans le scan, et au plus BOX_RECOVERY_MAX_RETRIES fois
    // (au-delà, le mot de passe a probablement changé : on laisse le hotspot stable pour le front).
    // Jamais pendant un configure, qui pilote déjà le WiFi.
    private async _retryRecoveryIfPossible(): Promise<void> {
        const isEligible = this._transition === null
            && this._configureService.getState().status !== 'in-progress'
            && this._recoveryReason === 'connection-failed'
            && this._retryCount < BOX_RECOVERY_MAX_RETRIES;
        if (!isEligible) {
            return;
        }
        const knownSsid = await this._findVisibleKnownSsid();
        if (knownSsid === undefined) {
            return;
        }
        this._runExclusive('recovery retry', async () => {
            this._retryCount += 1;
            this._logger.info({ ssid: knownSsid, attempt: this._retryCount, max: BOX_RECOVERY_MAX_RETRIES }, 'recovery: retrying known network');
            await this._wifiService.stopHotspot();
            await this._connectOrEnterRecovery(BOX_RECONNECT_TIMEOUT_MS, true);
        });
    }

    // SSID d'un réseau mémorisé présent dans le dernier scan (cache), uniquement si le hotspot est actif
    private async _findVisibleKnownSsid(): Promise<string | undefined> {
        try {
            if ((await this._wifiService.getLinkState()) !== 'hotspot') {
                return undefined;
            }
            const savedSsids = await this._wifiService.getSavedWifiSsids();
            const visible = await this._wifiService.scanNetworks();
            return visible.find((network) => savedSsids.includes(network.ssid))?.ssid;
        } catch (err) {
            this._logger.warn({ err }, 'recovery: failed to look for a known network');
            return undefined;
        }
    }

    private async _connectOrEnterRecovery(timeoutMs: number, activelyConnect: boolean): Promise<void> {
        this._phase = 'connecting';
        let isConnected: boolean;
        try {
            if (activelyConnect) {
                await this._wifiService.reconnectClient();
            }
            isConnected = await this._waitForClient(timeoutMs);
        } finally {
            this._phase = null;
        }
        if (isConnected) {
            this._logger.info('connected to known WiFi network (normal mode)');
            this._recoveryReason = null;
            this._retryCount = 0;
            return;
        }
        this._logger.warn({ timeoutMs }, 'no WiFi connection, entering recovery mode');
        await this._enterRecovery('connection-failed');
    }

    private async _enterRecovery(reason: RecoveryReason): Promise<void> {
        // posée avant l'ouverture du hotspot : le front qui s'y connecte lit directement la bonne raison
        this._recoveryReason = reason;
        await this._wifiService.startHotspot();
        this._logger.info({ reason }, 'recovery mode: hotspot started');
    }

    // Nombre d'essais fixe (et non une échéance Date.now()) pour rester déterministe sous fake timers
    private async _waitForClient(timeoutMs: number): Promise<boolean> {
        const attempts = Math.max(1, Math.ceil(timeoutMs / BOX_STATUS_POLL_MS));
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            if ((await this._readStatus())?.mode === 'client') {
                return true;
            }
            if (attempt < attempts) {
                await this._sleep(BOX_STATUS_POLL_MS);
            }
        }
        return false;
    }

    private _runExclusive(name: string, transition: () => Promise<void>): void {
        if (this._transition !== null) {
            this._logger.info({ transition: name }, 'another transition is in progress, ignoring');
            return;
        }
        this._transition = transition()
            .catch((err) => this._logger.error({ err, transition: name }, 'transition failed'))
            .finally(() => {
                this._transition = null;
            });
    }

    // Périodique, pour suivre aussi les changements faits hors de ce service (endpoints HTTP, nmcli manuel) :
    // - la LED clignote uniquement si le hotspot est réellement actif
    // - une fois revenue sur un réseau client, la box oublie la raison du dernier recovery
    private async _refreshLinkState(): Promise<void> {
        try {
            const link = await this._wifiService.getLinkState();
            this._gpio?.setHotspotLed(link === 'hotspot');
            if (link === 'client' && this._transition === null) {
                this._recoveryReason = null;
                this._retryCount = 0;
            }
        } catch {
            // état inconnu : LED éteinte plutôt qu'un clignotement potentiellement faux (erreur déjà loggée par WifiService)
            this._gpio?.setHotspotLed(false);
        }
    }

    private async _readStatus(): Promise<WifiStatus | null> {
        try {
            return await this._wifiService.getStatus();
        } catch (err) {
            this._logger.debug({ err }, 'failed to read WiFi status (NetworkManager not ready?)');
            return null;
        }
    }

    private async _hasConfiguredAccount(): Promise<boolean> {
        try {
            return await this._authenticationService.hasConfiguredAccount();
        } catch (err) {
            // Base injoignable : box supposée configurée (si le WiFi échoue elle ouvre quand même le hotspot en recovery)
            this._logger.error({ err }, 'failed to check configured account, assuming configured');
            return true;
        }
    }

    private readonly _sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
}
