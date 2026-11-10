import { PinoLogger } from 'nestjs-pino';
import { GpioLongPressWatcher, watchGpioLongPress } from '../../common/tools/gpio-long-press';
import { createGpioBlinker, GpioBlinker } from '../../common/tools/gpio-blink';
import {
    BOX_RECOVERY_BUTTON_BCM_PIN,
    BOX_RECOVERY_BUTTON_HOLD_MS,
    BOX_STATUS_LED_BCM_PIN,
    BOX_STATUS_LED_BLINK_MS
} from './wifi.constants';

/**
 * Bouton de recovery (appui long) et LED de statut de la box.
 * Une broche inaccessible est loggée sans bloquer le démarrage ; hors Raspberry Pi les deux sont inertes.
 */
export class BoxGpio {
    private constructor(
        private readonly _led: GpioBlinker | undefined,
        private readonly _button: GpioLongPressWatcher | undefined
    ) {
    }

    public static async open(onLongPress: (heldMs: number) => void, logger: PinoLogger): Promise<BoxGpio> {
        return new BoxGpio(await BoxGpio._openLed(logger), await BoxGpio._openButton(onLongPress, logger));
    }

    // true : la LED clignote (hotspot actif), false : éteinte. Idempotent.
    public setHotspotLed(isOn: boolean): void {
        if (isOn) {
            this._led?.start();
        } else {
            this._led?.stop();
        }
    }

    public close(): void {
        this._button?.stop();
        this._led?.stop();
    }

    private static async _openLed(logger: PinoLogger): Promise<GpioBlinker | undefined> {
        try {
            return await createGpioBlinker(BOX_STATUS_LED_BCM_PIN, {
                onMs: BOX_STATUS_LED_BLINK_MS,
                offMs: BOX_STATUS_LED_BLINK_MS,
                onError: (err) => logger.warn({ err }, 'status LED: GPIO write error')
            });
        } catch (err) {
            logger.error({ err }, 'status LED: failed to open GPIO');
            return undefined;
        }
    }

    private static async _openButton(onLongPress: (heldMs: number) => void, logger: PinoLogger): Promise<GpioLongPressWatcher | undefined> {
        try {
            return await watchGpioLongPress(BOX_RECOVERY_BUTTON_BCM_PIN, onLongPress, {
                holdMs: BOX_RECOVERY_BUTTON_HOLD_MS,
                activeLow: false,
                onError: (err) => logger.warn({ err }, 'recovery button: GPIO watch error')
            });
        } catch (err) {
            logger.error({ err }, 'recovery button: failed to watch GPIO');
            return undefined;
        }
    }
}
