export interface ActiveConnectionRow {
    name: string;
    device: string;
    type: string;
}

export interface DeviceShowInfo {
    state: string;
    connection: string;
}

export interface WifiNetwork {
    ssid: string;
    signal: number;
    security: string;
}

export class NmcliOutputParser {
    public static splitTerseLine(line: string): string[] {
        const fields: string[] = [];
        let current = '';
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '\\' && line[i + 1] === ':') {
                current += ':';
                i++;
                continue;
            }
            if (char === ':') {
                fields.push(current);
                current = '';
                continue;
            }
            current += char;
        }
        fields.push(current);
        return fields;
    }

    public static parseActiveConnections(stdout: string): ActiveConnectionRow[] {
        return NmcliOutputParser._nonEmptyLines(stdout).map((line) => {
            const [name, device, type] = NmcliOutputParser.splitTerseLine(line);
            return { name: name ?? '', device: device ?? '', type: type ?? '' };
        });
    }

    public static parseDeviceShow(stdout: string): DeviceShowInfo {
        const info: DeviceShowInfo = { state: '', connection: '' };
        for (const line of NmcliOutputParser._nonEmptyLines(stdout)) {
            const [field, ...rest] = NmcliOutputParser.splitTerseLine(line);
            const value = rest.join(':');
            if (field === 'GENERAL.STATE') {
                info.state = NmcliOutputParser._extractStateLabel(value);
            } else if (field === 'GENERAL.CONNECTION') {
                info.connection = value;
            }
        }
        return info;
    }

    public static parseSsid(stdout: string): string | null {
        for (const line of NmcliOutputParser._nonEmptyLines(stdout)) {
            const [field, ...rest] = NmcliOutputParser.splitTerseLine(line);
            if (field === '802-11-wireless.ssid') {
                const value = rest.join(':');
                return value.length > 0 ? value : null;
            }
        }
        return null;
    }

    public static parseWifiList(stdout: string): WifiNetwork[] {
        const networks = NmcliOutputParser._nonEmptyLines(stdout).map((line) => {
            const [ssid, signal, security] = NmcliOutputParser.splitTerseLine(line);
            return { ssid: ssid ?? '', signal: Number(signal) || 0, security: security ?? '' };
        });
        return NmcliOutputParser._dedupeBySsid(networks);
    }

    private static _dedupeBySsid(networks: WifiNetwork[]): WifiNetwork[] {
        const bestBySsid = new Map<string, WifiNetwork>();
        const result: WifiNetwork[] = [];
        for (const network of networks) {
            if (network.ssid.length === 0) {
                result.push(network);
                continue;
            }
            const existing = bestBySsid.get(network.ssid);
            if (existing === undefined) {
                bestBySsid.set(network.ssid, network);
                result.push(network);
            } else if (network.signal > existing.signal) {
                existing.signal = network.signal;
                existing.security = network.security;
            }
        }
        return result;
    }

    private static _extractStateLabel(rawState: string): string {
        const match = /\(([^)]+)\)/.exec(rawState);
        return match !== null ? match[1] : rawState;
    }

    private static _nonEmptyLines(stdout: string): string[] {
        return stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
    }
}
