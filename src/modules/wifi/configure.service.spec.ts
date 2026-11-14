import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigureService } from './configure.service';
import { ConfigureDto } from './dto/configure.dto';
import { CheckPasswordDto } from './dto/check-password.dto';
import { WifiService } from './wifi.service';
import { AuthenticationService } from '../authentication/authentication.service';
import { GlobalSettingsService } from '../global-settings/global-settings.service';
import { Role } from '../authentication/role.enum';
import { ErrorCode, ErrorBody } from '../../common/errors/error-code';

describe('ConfigureService', () => {
    let wifi: { connect: jest.Mock; stopHotspot: jest.Mock };
    let auth: Record<'hasConfiguredAccount' | 'verifyInitialPassword' | 'verifyConfiguredCredentials' | 'createUser', jest.Mock>;
    let settings: { setLocalCoordinates: jest.Mock };
    let logger: Record<'info' | 'warn' | 'error', jest.Mock>;
    let service: ConfigureService;

    function SetupDto(overrides: Partial<ConfigureDto> = {}): ConfigureDto {
        return {
            deviceName: 'Salon',
            ssid: 'HomeNetwork',
            psk: 'wifi-secret',
            login: 'alice',
            email: 'alice@example.com',
            currentPassword: 'label-password',
            password: 'new-password',
            localCoordinates: { latitude: 48.85, longitude: 2.35 },
            ...overrides
        } as ConfigureDto;
    }

    function RecoveryDto(overrides: Partial<ConfigureDto> = {}): ConfigureDto {
        return { ssid: 'NewNetwork', psk: 'wifi-secret', login: 'alice', currentPassword: 'user-password', ...overrides } as ConfigureDto;
    }

    // Statut HTTP et corps renvoyés au front
    async function Failure(dto: ConfigureDto): Promise<{ status: number; body: Record<string, unknown> }> {
        const err = await service.configure(dto).then(() => undefined, (e: unknown) => e);
        expect(err).toBeInstanceOf(HttpException);
        const http = err as HttpException;
        return { status: http.getStatus(), body: http.getResponse() as Record<string, unknown> };
    }

    beforeEach(() => {
        wifi = { connect: jest.fn().mockResolvedValue({}), stopHotspot: jest.fn().mockResolvedValue({}) };
        auth = {
            hasConfiguredAccount: jest.fn().mockResolvedValue(false),
            verifyInitialPassword: jest.fn().mockResolvedValue(true),
            verifyConfiguredCredentials: jest.fn().mockResolvedValue(true),
            createUser: jest.fn().mockResolvedValue({})
        };
        settings = { setLocalCoordinates: jest.fn().mockResolvedValue({}) };
        logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        service = new ConfigureService(
            wifi as unknown as WifiService,
            auth as unknown as AuthenticationService,
            settings as unknown as GlobalSettingsService,
            logger as any
        );
    });

    describe('setup mode (no configured account)', () => {
        it('checks the label password, then connects, saves coordinates, creates the configured user and stops the hotspot', async () => {
            await expect(service.configure(SetupDto())).resolves.toBe(true);

            expect(auth.verifyInitialPassword).toHaveBeenCalledWith('label-password');
            expect(auth.verifyConfiguredCredentials).not.toHaveBeenCalled();
            expect(wifi.connect).toHaveBeenCalledWith({ ssid: 'HomeNetwork', password: 'wifi-secret' });
            expect(settings.setLocalCoordinates).toHaveBeenCalledWith({ latitude: 48.85, longitude: 2.35 });
            expect(auth.createUser).toHaveBeenCalledWith({
                login: 'alice',
                email: 'alice@example.com',
                password: 'new-password',
                role: Role.ADMIN,
                isConfigured: true
            });
            expect(wifi.stopHotspot).toHaveBeenCalled();
        });

        it('returns 401 INVALID_CURRENT_PASSWORD and changes nothing when the label password is wrong', async () => {
            auth.verifyInitialPassword.mockResolvedValue(false);

            const { status, body } = await Failure(SetupDto());

            expect(status).toBe(HttpStatus.UNAUTHORIZED);
            expect(body).toEqual(expect.objectContaining({ statusCode: 401, code: ErrorCode.INVALID_CURRENT_PASSWORD }));
            expect(wifi.connect).not.toHaveBeenCalled();
            expect(auth.createUser).not.toHaveBeenCalled();
        });

        it('returns 400 SETUP_FIELDS_REQUIRED with the missing fields', async () => {
            const { status, body } = await Failure(SetupDto({ deviceName: undefined, password: undefined }));

            expect(status).toBe(HttpStatus.BAD_REQUEST);
            expect(body).toEqual(expect.objectContaining({
                code: ErrorCode.SETUP_FIELDS_REQUIRED,
                details: { fields: ['deviceName', 'password'] }
            }));
            expect(auth.verifyInitialPassword).not.toHaveBeenCalled();
            expect(wifi.connect).not.toHaveBeenCalled();
        });

        it('accepts a payload without email nor localCoordinates', async () => {
            await expect(service.configure(SetupDto({ email: undefined, localCoordinates: undefined }))).resolves.toBe(true);

            expect(settings.setLocalCoordinates).not.toHaveBeenCalled();
            expect(auth.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: undefined, isConfigured: true }));
        });

        it('relays the WiFi error code (e.g. wrong PSK) and stops before creating the user', async () => {
            wifi.connect.mockRejectedValue(new BadRequestException(ErrorBody(HttpStatus.BAD_REQUEST, ErrorCode.WIFI_INVALID_PSK, 'bad psk')));

            const { status, body } = await Failure(SetupDto());

            expect(status).toBe(HttpStatus.BAD_REQUEST);
            expect(body).toEqual(expect.objectContaining({ code: ErrorCode.WIFI_INVALID_PSK }));
            expect(auth.createUser).not.toHaveBeenCalled();
        });

        it.each([
            ['WiFi connection', (): void => {
                wifi.connect.mockRejectedValue(new Error('boom'));
            }, ErrorCode.WIFI_CONNECT_FAILED],
            ['coordinates', (): void => {
                settings.setLocalCoordinates.mockRejectedValue(new Error('mongo down'));
            }, ErrorCode.LOCAL_COORDINATES_SAVE_FAILED],
            ['user', (): void => {
                auth.createUser.mockRejectedValue(new Error('mongo down'));
            }, ErrorCode.USER_SAVE_FAILED],
            ['hotspot stop', (): void => {
                wifi.stopHotspot.mockRejectedValue(new Error('nmcli'));
            }, ErrorCode.HOTSPOT_STOP_FAILED]
        ])('returns 500 with the step code when the %s step fails without a code', async (_step, arrange, code) => {
            arrange();

            const { status, body } = await Failure(SetupDto());

            expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
            expect(body).toEqual(expect.objectContaining({ statusCode: 500, code }));
        });
    });

    describe('recovery mode (configured account)', () => {
        beforeEach(() => {
            auth.hasConfiguredAccount.mockResolvedValue(true);
        });

        it('checks the user credentials, then only changes the WiFi', async () => {
            await expect(service.configure(RecoveryDto())).resolves.toBe(true);

            expect(auth.verifyConfiguredCredentials).toHaveBeenCalledWith('alice', 'user-password');
            expect(auth.verifyInitialPassword).not.toHaveBeenCalled();
            expect(wifi.connect).toHaveBeenCalledWith({ ssid: 'NewNetwork', password: 'wifi-secret' });
            expect(wifi.stopHotspot).toHaveBeenCalled();
            expect(auth.createUser).not.toHaveBeenCalled();
            expect(settings.setLocalCoordinates).not.toHaveBeenCalled();
        });

        it('returns 401 INVALID_CURRENT_PASSWORD and keeps the hotspot when the credentials are wrong', async () => {
            auth.verifyConfiguredCredentials.mockResolvedValue(false);

            const { status, body } = await Failure(RecoveryDto());

            expect(status).toBe(HttpStatus.UNAUTHORIZED);
            expect(body).toEqual(expect.objectContaining({ code: ErrorCode.INVALID_CURRENT_PASSWORD }));
            expect(wifi.connect).not.toHaveBeenCalled();
            expect(wifi.stopHotspot).not.toHaveBeenCalled();
        });

        it('ignores setup-only fields (no password reset)', async () => {
            await service.configure(RecoveryDto({ password: 'other-password', email: 'x@example.com' }));

            expect(auth.createUser).not.toHaveBeenCalled();
        });
    });

    describe('checkPassword', () => {
        async function CheckFailure(dto: CheckPasswordDto): Promise<{ status: number; body: Record<string, unknown> }> {
            const err = await service.checkPassword(dto).then(() => undefined, (e: unknown) => e);
            expect(err).toBeInstanceOf(HttpException);
            const http = err as HttpException;
            return { status: http.getStatus(), body: http.getResponse() as Record<string, unknown> };
        }

        function ExpectNothingChanged(): void {
            expect(wifi.connect).not.toHaveBeenCalled();
            expect(wifi.stopHotspot).not.toHaveBeenCalled();
            expect(auth.createUser).not.toHaveBeenCalled();
            expect(settings.setLocalCoordinates).not.toHaveBeenCalled();
        }

        describe('setup mode', () => {
            it('checks the label password without login and changes nothing', async () => {
                await expect(service.checkPassword({ currentPassword: 'label-password' })).resolves.toBe(true);

                expect(auth.verifyInitialPassword).toHaveBeenCalledWith('label-password');
                expect(auth.verifyConfiguredCredentials).not.toHaveBeenCalled();
                ExpectNothingChanged();
            });

            it('returns 401 INVALID_CURRENT_PASSWORD when the label password is wrong', async () => {
                auth.verifyInitialPassword.mockResolvedValue(false);

                const { status, body } = await CheckFailure({ currentPassword: 'wrong' });

                expect(status).toBe(HttpStatus.UNAUTHORIZED);
                expect(body).toEqual(expect.objectContaining({ statusCode: 401, code: ErrorCode.INVALID_CURRENT_PASSWORD }));
                ExpectNothingChanged();
            });
        });

        describe('recovery mode', () => {
            beforeEach(() => {
                auth.hasConfiguredAccount.mockResolvedValue(true);
            });

            it('checks the configured account credentials and changes nothing', async () => {
                await expect(service.checkPassword({ login: 'alice', currentPassword: 'user-password' })).resolves.toBe(true);

                expect(auth.verifyConfiguredCredentials).toHaveBeenCalledWith('alice', 'user-password');
                expect(auth.verifyInitialPassword).not.toHaveBeenCalled();
                ExpectNothingChanged();
            });

            it('returns 401 INVALID_CURRENT_PASSWORD when the credentials are wrong', async () => {
                auth.verifyConfiguredCredentials.mockResolvedValue(false);

                const { status, body } = await CheckFailure({ login: 'alice', currentPassword: 'wrong' });

                expect(status).toBe(HttpStatus.UNAUTHORIZED);
                expect(body).toEqual(expect.objectContaining({ code: ErrorCode.INVALID_CURRENT_PASSWORD }));
            });

            it('returns 400 VALIDATION_FAILED on login when it is missing', async () => {
                const { status, body } = await CheckFailure({ currentPassword: 'user-password' });

                expect(status).toBe(HttpStatus.BAD_REQUEST);
                expect(body).toEqual(expect.objectContaining({
                    code: ErrorCode.VALIDATION_FAILED,
                    details: { fields: [{ field: 'login', constraints: ['isDefined'] }] }
                }));
                expect(auth.verifyConfiguredCredentials).not.toHaveBeenCalled();
            });
        });
    });
});
