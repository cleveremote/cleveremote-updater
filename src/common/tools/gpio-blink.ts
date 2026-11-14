import { Gpio } from 'onoff';
import { resolveGpioLine } from './gpio-line';

export interface GpioBlinkOptions {
    onMs?: number;
    offMs?: number;
    onError?: (error: Error) => void;
}

export interface GpioBlinker {
    // Idempotents : start() sur un clignotement en cours ou stop() sur une LED éteinte ne font rien
    start(): void;
    stop(): void;
}

const NOOP_BLINKER: GpioBlinker = { start: (): void => undefined, stop: (): void => undefined };

/**
 * Fait clignoter une LED sur une broche GPIO du Raspberry Pi (numérotation BCM).
 * stop() éteint la LED. La broche n'est jamais unexportée : elle peut être partagée avec un autre
 * process (ex. LED de statut de cleveremote-box), qui la reconfigure lui-même.
 * Hors Raspberry Pi (Gpio inaccessible), retourne un blinker inerte.
 */
export async function createGpioBlinker(
    bcmPin: number,
    { onMs = 500, offMs = 500, onError }: GpioBlinkOptions = {}
): Promise<GpioBlinker> {
    if (!Gpio.accessible) {
        return NOOP_BLINKER;
    }

    const gpio = new Gpio(await resolveGpioLine(bcmPin), 'out');
    let timer: NodeJS.Timeout | null = null;

    const write = (value: 0 | 1): boolean => {
        try {
            gpio.writeSync(value);
            return true;
        } catch (err) {
            onError?.(err as Error);
            return false;
        }
    };

    const cycle = (value: 0 | 1): void => {
        if (!write(value)) {
            timer = null;
            return;
        }
        timer = setTimeout(() => cycle(value === 1 ? 0 : 1), value === 1 ? onMs : offMs);
    };

    return {
        start: (): void => {
            if (timer === null) {
                cycle(1);
            }
        },
        stop: (): void => {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            write(0);
        }
    };
}
