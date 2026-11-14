import * as os from 'os';
import { NmcliExecutorService, nmcliShell } from './nmcli-executor.service';
import { NmcliError } from './nmcli.error';
import { NMCLI_TIMEOUT_MS } from './wifi.constants';

describe('NmcliExecutorService', () => {
    let service: NmcliExecutorService;

    beforeEach(() => {
        service = new NmcliExecutorService();
        jest.spyOn(os, 'platform').mockReturnValue('linux');
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('calls execFile with the nmcli binary and the exact argv array', async () => {
        const spy = jest.spyOn(nmcliShell, 'execFileAsync').mockResolvedValue({ stdout: 'ok', stderr: '' });
        const args = ['connection', 'up', 'cleveremote-hotspot'];

        const result = await service.run(args);

        expect(spy).toHaveBeenCalledWith('nmcli', args, expect.objectContaining({ timeout: expect.any(Number) }));
        expect(result).toEqual({ stdout: 'ok', stderr: '' });
    });

    it('uses the default timeout unless a per-command timeout is given', async () => {
        const spy = jest.spyOn(nmcliShell, 'execFileAsync').mockResolvedValue({ stdout: '', stderr: '' });

        await service.run(['connection', 'show']);
        await service.run(['device', 'wifi', 'connect', 'HomeNetwork'], 70000);

        expect(spy.mock.calls[0][2].timeout).toBe(NMCLI_TIMEOUT_MS);
        expect(spy.mock.calls[1][2].timeout).toBe(70000);
    });

    it('never invokes execFile with a joined/interpolated command string', async () => {
        const spy = jest.spyOn(nmcliShell, 'execFileAsync').mockResolvedValue({ stdout: '', stderr: '' });

        await service.run(['device', 'wifi', 'connect', 'my ssid; rm -rf /', 'password', '$(whoami)']);

        const calledArgs = spy.mock.calls[0][1];
        expect(Array.isArray(calledArgs)).toBe(true);
        expect(calledArgs).toContain('my ssid; rm -rf /');
        expect(calledArgs).toContain('$(whoami)');
    });

    it('wraps a rejected exec into an NmcliError preserving stdout/stderr/exitCode', async () => {
        const err = Object.assign(new Error('Command failed'), { code: 1, stdout: 'out', stderr: 'no secrets provided' });
        jest.spyOn(nmcliShell, 'execFileAsync').mockRejectedValue(err);

        const rejection = service.run(['connection', 'up', 'x']);
        await expect(rejection).rejects.toBeInstanceOf(NmcliError);
        await expect(rejection).rejects.toMatchObject({ exitCode: 1, stdout: 'out', stderr: 'no secrets provided' });
    });

    it('marks a killed/timed-out command distinctly', async () => {
        const err = Object.assign(new Error('Command timed out'), { killed: true, stdout: '', stderr: '' });
        jest.spyOn(nmcliShell, 'execFileAsync').mockRejectedValue(err);

        await expect(service.run(['device', 'wifi', 'list'])).rejects.toMatchObject({ didTimeOut: true });
    });

    it('rejects without calling execFile when the platform is not Linux', async () => {
        jest.spyOn(os, 'platform').mockReturnValue('darwin');
        const spy = jest.spyOn(nmcliShell, 'execFileAsync');

        await expect(service.run(['connection', 'show'])).rejects.toThrow();
        expect(spy).not.toHaveBeenCalled();
    });
});
