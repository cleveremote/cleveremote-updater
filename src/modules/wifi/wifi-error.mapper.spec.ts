import {
    BadRequestException,
    ConflictException,
    InternalServerErrorException,
    NotFoundException,
    RequestTimeoutException
} from '@nestjs/common';
import { WifiErrorMapper } from './wifi-error.mapper';
import { NmcliError } from './nmcli.error';
import { ErrorCode, GetErrorCode } from '../../common/errors/error-code';

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

    it('maps an expired nmcli wait (-w) to a RequestTimeoutException', () => {
        const err = BuildError('failed', 'Error: Timeout 60 sec expired.');
        const exception = WifiErrorMapper.toHttpException(err, 'ctx');
        expect(exception).toBeInstanceOf(RequestTimeoutException);
        expect(GetErrorCode(exception)).toBe(ErrorCode.WIFI_TIMEOUT);
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

    it.each([
        ['spawn nmcli ENOENT', '', false, ErrorCode.WIFI_NMCLI_UNAVAILABLE],
        ['Command timed out', '', true, ErrorCode.WIFI_TIMEOUT],
        ['failed', 'Error: Secrets were required, but not provided.', false, ErrorCode.WIFI_INVALID_PSK],
        ['failed', 'Error: No network with SSID \'foo\' found.', false, ErrorCode.WIFI_NETWORK_NOT_FOUND],
        ['failed', 'Error: Device or resource busy.', false, ErrorCode.WIFI_INTERFACE_BUSY],
        ['failed', 'some unexpected nmcli output', false, ErrorCode.WIFI_OPERATION_FAILED]
    ])('exposes an error code for the front (%s / %s)', (message, stderr, didTimeOut, code) => {
        expect(GetErrorCode(WifiErrorMapper.toHttpException(BuildError(message, stderr, didTimeOut), 'ctx'))).toBe(code);
    });
});
