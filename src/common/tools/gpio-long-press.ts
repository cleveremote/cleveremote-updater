import { BinaryValue, Gpio } from 'onoff';
import { resolveGpioLine } from './gpio-line';

export interface GpioLongPressOptions {
    // Durée d'appui continu avant déclenchement
    holdMs?: number;
    // true : bouton câblé vers la masse avec pull-up (appuyé = niveau bas)
    activeLow?: boolean;
    // Anti-rebond matériel géré par onoff
    debounceMs?: number;
    onError?: (error: Error) => void;
}

export interface GpioLongPressWatcher {
    stop(): void;
}

const NOOP_WATCHER: GpioLongPressWatcher = { stop: (): void => undefined };

/**
 * Détecte un appui long sur une broche GPIO du Raspberry Pi (numérotation BCM).
 * onLongPress est appelé une seule fois par appui, dès que la broche est restée active holdMs
 * sans interruption (sans attendre le relâchement) ; il faut relâcher pour pouvoir redéclencher.
 * Un bouton déjà enfoncé au démarrage est ignoré jusqu'à son relâchement (évite un déclenchement
 * au boot sur une broche flottante ou un bouton bloqué).
 * Hors Raspberry Pi (Gpio inaccessible), retourne un watcher inerte.
 */
export async function watchGpioLongPress(
    bcmPin: number,
    onLongPress: (heldMs: number) => void,
    { holdMs = 5000, activeLow = false, debounceMs = 50, onError }: GpioLongPressOptions = {}
): Promise<GpioLongPressWatcher> {
    if (!Gpio.accessible) {
        return NOOP_WATCHER;
    }

    const gpio = new Gpio(await resolveGpioLine(bcmPin), 'in', 'both', { debounceTimeout: debounceMs, activeLow });
    let pressedAt: number | null = null;
    let timer: NodeJS.Timeout | null = null;

    const cancel = (): void => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        pressedAt = null;
    };

    const onEdge = (error: Error | null | undefined, value: BinaryValue): void => {
        if (error) {
            onError?.(error);
            return;
        }
        if (value !== 1) {
            cancel();
            return;
        }
        if (pressedAt !== null) {
            return;
        }
        pressedAt = Date.now();
        timer = setTimeout(() => {
            timer = null;
            // Relecture : protège contre un front de relâchement perdu
            if (pressedAt !== null && gpio.readSync() === 1) {
                onLongPress(Date.now() - pressedAt);
            }
        }, holdMs);
    };

    gpio.watch(onEdge);

    return {
        stop: (): void => {
            cancel();
            gpio.unwatch(onEdge);
            gpio.unexport();
        }
    };
}
