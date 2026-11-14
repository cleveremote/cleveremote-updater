import {
    BadRequestException,
    ConflictException,
    HttpException,
    HttpStatus,
    InternalServerErrorException,
    NotFoundException,
    RequestTimeoutException
} from '@nestjs/common';
import { NmcliError } from './nmcli.error';
import { ErrorCode, ErrorBody } from '../../common/errors/error-code';

interface ErrorMatcher {
    test: (err: NmcliError) => boolean;
    build: (err: NmcliError) => HttpException;
}

const _errorMatchers: ErrorMatcher[] = [
    {
        test: (err) => /enoent/i.test(err.message),
        build: () => new InternalServerErrorException(ErrorBody(
            HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.WIFI_NMCLI_UNAVAILABLE, 'NetworkManager (nmcli) is not available on this system'
        ))
    },
    {
        test: (err) => err.didTimeOut,
        build: () => new RequestTimeoutException(ErrorBody(HttpStatus.REQUEST_TIMEOUT, ErrorCode.WIFI_TIMEOUT, 'nmcli command timed out'))
    },
    {
        test: (err) => /secrets were required|802-11-wireless-security|no secrets provided/i.test(err.stderr),
        build: () => new BadRequestException(ErrorBody(
            HttpStatus.BAD_REQUEST, ErrorCode.WIFI_INVALID_PSK, 'Incorrect WiFi password or authentication failed'
        ))
    },
    {
        test: (err) => /no network with ssid/i.test(err.stderr),
        build: () => new NotFoundException(ErrorBody(HttpStatus.NOT_FOUND, ErrorCode.WIFI_NETWORK_NOT_FOUND, 'WiFi network was not found'))
    },
    {
        test: (err) => /device or resource busy|another connection|already active/i.test(err.stderr),
        build: () => new ConflictException(ErrorBody(
            HttpStatus.CONFLICT, ErrorCode.WIFI_INTERFACE_BUSY, 'WiFi interface is busy with another operation'
        ))
    }
];

export class WifiErrorMapper {
    public static toHttpException(err: NmcliError, context: string): HttpException {
        const matcher = _errorMatchers.find((candidate) => candidate.test(err));
        if (matcher !== undefined) {
            return matcher.build(err);
        }
        return new InternalServerErrorException(ErrorBody(
            HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.WIFI_OPERATION_FAILED, `WiFi operation failed: ${context}`
        ));
    }
}
