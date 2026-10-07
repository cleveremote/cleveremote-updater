import {
    BadRequestException,
    ConflictException,
    InternalServerErrorException,
    NotFoundException,
    RequestTimeoutException
} from '@nestjs/common';
import { WifiErrorMapper } from './wifi-error.mapper';
import { NmcliError } from './nmcli.error';

function BuildError(message: string, stderr: string, didTimeOut = false): NmcliError {
    return new NmcliError(message, [], 1, '', stderr, didTimeOut);
}

describe('WifiErrorMapper', () => {
    it('maps a missing nmcli binary to an InternalServerErrorException', () => {
        const err = BuildError('spawn nmcli ENOENT', '');
        expect(WifiErrorMapper.toHttpException(err, 'ctx')).toBeInstanceOf(InternalServerErrorException);
    });

    it('maps a timed-out command to a RequestTimeoutException', () => {
        const err = BuildError('Command timed out', '', true);
        expect(WifiErrorMapper.toHttpException(err, 'ctx')).toBeInstanceOf(RequestTimeoutException);
    });

    it('maps an authentication failure to a BadRequestException', () => {
        const err = BuildError('failed', 'Error: Secrets were required, but not provided.');
        expect(WifiErrorMapper.toHttpException(err, 'ctx')).toBeInstanceOf(BadRequestException);
    });

    it('maps a missing SSID to a NotFoundException', () => {
        const err = BuildError('failed', 'Error: No network with SSID \'foo\' found.');
        expect(WifiErrorMapper.toHttpException(err, 'ctx')).toBeInstanceOf(NotFoundException);
    });

    it('maps a busy device to a ConflictException', () => {
        const err = BuildError('failed', 'Error: Device or resource busy.');
        expect(WifiErrorMapper.toHttpException(err, 'ctx')).toBeInstanceOf(ConflictException);
    });

    it('falls back to an InternalServerErrorException for unrecognized failures', () => {
        const err = BuildError('failed', 'some unexpected nmcli output');
        expect(WifiErrorMapper.toHttpException(err, 'ctx')).toBeInstanceOf(InternalServerErrorException);
    });
});
