import { NmcliOutputParser } from './nmcli-output.parser';

describe('NmcliOutputParser', () => {
    describe('splitTerseLine', () => {
        it('splits on unescaped colons', () => {
            expect(NmcliOutputParser.splitTerseLine('cleveremote-hotspot:wlan0:wifi')).toEqual([
                'cleveremote-hotspot', 'wlan0', 'wifi'
            ]);
        });

        it('treats a backslash-escaped colon as a literal character', () => {
            expect(NmcliOutputParser.splitTerseLine('my\\:ssid:wlan0:wifi')).toEqual(['my:ssid', 'wlan0', 'wifi']);
        });

        it('returns a single field when there is no colon', () => {
            expect(NmcliOutputParser.splitTerseLine('100 (connected)')).toEqual(['100 (connected)']);
        });
    });

    describe('parseActiveConnections', () => {
        it('parses one row per non-empty line', () => {
            const stdout = 'cleveremote-hotspot:wlan0:wifi\neth-static:eth0:ethernet\n';
            expect(NmcliOutputParser.parseActiveConnections(stdout)).toEqual([
                { name: 'cleveremote-hotspot', device: 'wlan0', type: 'wifi' },
                { name: 'eth-static', device: 'eth0', type: 'ethernet' }
            ]);
        });

        it('returns an empty array for blank output', () => {
            expect(NmcliOutputParser.parseActiveConnections('')).toEqual([]);
        });
    });

    describe('parseDeviceShow', () => {
        it('extracts GENERAL.STATE and GENERAL.CONNECTION fields, reducing state to its readable label', () => {
            const stdout = 'GENERAL.STATE:100 (connected)\nGENERAL.CONNECTION:cleveremote-hotspot\n';
            expect(NmcliOutputParser.parseDeviceShow(stdout)).toEqual({
                state: 'connected',
                connection: 'cleveremote-hotspot'
            });
        });

        it('defaults to empty strings for missing fields', () => {
            expect(NmcliOutputParser.parseDeviceShow('')).toEqual({ state: '', connection: '' });
        });
    });

    describe('parseWifiList', () => {
        it('parses SSID/signal/security rows and coerces signal to a number', () => {
            const stdout = 'HomeNetwork:78:WPA2\nmy\\:ssid:40:WPA2\n';
            expect(NmcliOutputParser.parseWifiList(stdout)).toEqual([
                { ssid: 'HomeNetwork', signal: 78, security: 'WPA2' },
                { ssid: 'my:ssid', signal: 40, security: 'WPA2' }
            ]);
        });

        it('collapses duplicate SSID rows (e.g. dual-band APs) into the strongest signal', () => {
            const stdout = 'HomeNetwork:40:WPA2\nOtherNetwork:60:WPA2\nHomeNetwork:78:WPA3\n';
            expect(NmcliOutputParser.parseWifiList(stdout)).toEqual([
                { ssid: 'HomeNetwork', signal: 78, security: 'WPA3' },
                { ssid: 'OtherNetwork', signal: 60, security: 'WPA2' }
            ]);
        });

        it('keeps every hidden network (empty SSID) row without merging them', () => {
            const stdout = ':30:WPA2\n:50:WPA2\n';
            expect(NmcliOutputParser.parseWifiList(stdout)).toEqual([
                { ssid: '', signal: 30, security: 'WPA2' },
                { ssid: '', signal: 50, security: 'WPA2' }
            ]);
        });
    });
});
