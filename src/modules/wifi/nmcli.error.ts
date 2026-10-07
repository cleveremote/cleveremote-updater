export class NmcliError extends Error {
    public readonly args: string[];
    public readonly exitCode: number | null;
    public readonly stdout: string;
    public readonly stderr: string;
    public readonly didTimeOut: boolean;

    public constructor(message: string, args: string[], exitCode: number | null, stdout: string, stderr: string, didTimeOut: boolean) {
        super(message);
        this.name = 'NmcliError';
        this.args = args;
        this.exitCode = exitCode;
        this.stdout = stdout;
        this.stderr = stderr;
        this.didTimeOut = didTimeOut;
    }
}
