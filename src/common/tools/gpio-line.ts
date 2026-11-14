import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Le numéro sysfs peut différer du BCM (base du gpiochip non nulle sur les noyaux récents / Pi 5) :
// on le lit dans /sys/kernel/debug/gpio (ligne "gpio-<sysfs> (GPIO<bcm> ...)"), repli sur le BCM sinon.
export async function resolveGpioLine(bcmPin: number): Promise<number> {
    try {
        const { stdout } = await execAsync(`grep -iw 'gpio${bcmPin}' /sys/kernel/debug/gpio`);
        const match = /gpio-(\d+)/.exec(stdout);
        if (match) {
            return Number(match[1]);
        }
    } catch {
        // debugfs inaccessible (droits) ou broche absente : repli sur le numéro BCM
    }
    return bcmPin;
}
