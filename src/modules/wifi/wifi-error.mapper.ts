import {
    BadRequestException,
    ConflictException,
    HttpException,
    InternalServerErrorException,
    NotFoundException,
    RequestTimeoutException
} from '@nestjs/common';
import { NmcliError } from './nmcli.error';

interface ErrorMatcher {
    test: (err: NmcliError) => boolean;
    build: (err: NmcliError) => HttpException;
}

const _errorMatchers: ErrorMatcher[] = [
    {
        test: (err) => /enoent/i.test(err.message),
        build: () => new InternalServerErrorException('NetworkManager (nmcli) is not available on this system')
    },
    {
        test: (err) => err.didTimeOut,
        build: () => new RequestTimeoutException('nmcli command timed out')
    },
    {
        test: (err) => /secrets were required|802-11-wireless-security|no secrets provided/i.test(err.stderr),
        build: () => new BadRequestException('Incorrect WiFi password or authentication failed')
    },
    {
        test: (err) => /no network with ssid/i.test(err.stderr),
        build: () => new NotFoundException('WiFi network was not found')
    },
    {
        test: (err) => /device or resource busy|another connection|already active/i.test(err.stderr),
        build: () => new ConflictException('WiFi interface is busy with another operation')
    }
];

export class WifiErrorMapper {
    public static toHttpException(err: NmcliError, context: string): HttpException {
        const matcher = _errorMatchers.find((candidate) => candidate.test(err));
        if (matcher !== undefined) {
            return matcher.build(err);
        }
        return new InternalServerErrorException(`WiFi operation failed: ${context}`);
    }
}
