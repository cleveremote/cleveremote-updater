import { execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import { Injectable, NotImplementedException } from '@nestjs/common';
import { NmcliError } from './nmcli.error';
import { NMCLI_BINARY, NMCLI_TIMEOUT_MS } from './wifi.constants';

export interface NmcliResult {
    stdout: string;
    stderr: string;
}

interface ExecFileError extends Error {
    code?: number | string;
    killed?: boolean;
    stdout?: string;
    stderr?: string;
}

type ExecFileAsync = (file: string, args: string[], options: { timeout: number; killSignal: NodeJS.Signals }) => Promise<NmcliResult>;

// Exposed as a spy-able object (rather than a bare module-level const) so tests can
// intercept the underlying shell call without mocking `child_process`/`util.promisify` internals.
export const nmcliShell: { execFileAsync: ExecFileAsync } = {
    execFileAsync: promisify(execFile) as ExecFileAsync
};

@Injectable()
export class NmcliExecutorService {
    public async run(args: string[]): Promise<NmcliResult> {
        this._assertLinux();
        try {
            const { stdout, stderr } = await nmcliShell.execFileAsync(NMCLI_BINARY, args, {
                timeout: NMCLI_TIMEOUT_MS,
                killSignal: 'SIGTERM'
            });
            return { stdout, stderr };
        } catch (err) {
            throw this._toNmcliError(err as ExecFileError, args);
        }
    }

    private _assertLinux(): void {
        if (os.platform() !== 'linux') {
            throw new NotImplementedException('nmcli execution is only supported on Linux');
        }
    }

    private _toNmcliError(err: ExecFileError, args: string[]): NmcliError {
        const exitCode = typeof err.code === 'number' ? err.code : null;
        return new NmcliError(err.message, args, exitCode, err.stdout ?? '', err.stderr ?? '', Boolean(err.killed));
    }
}
