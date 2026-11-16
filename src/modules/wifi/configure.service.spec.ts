import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigureService } from './configure.service';
import { ConfigureDto } from './dto/configure.dto';
import { CheckPasswordDto } from './dto/check-password.dto';
import { WifiService } from './wifi.service';
import { AuthenticationService } from '../authentication/authentication.service';
import { GlobalSettingsService } from '../global-settings/global-settings.service';
import { Role } from '../authentication/role.enum';
import { ErrorCode, ErrorBody } from '../../common/errors/error-code';
import { CONFIGURE_RESPONSE_GRACE_MS } from './wifi.constants';

describe('ConfigureService', () => {
    let wifi: { connect: jest.Mock; stopHotspot: jest.Mock };
    let auth: Record<'hasConfiguredAccount' | 'verifyInitialPassword' | 'verifyConfiguredCredentials' | 'createUser', jest.Mock>;
    let settings: { setLocalCoordinates: jest.Mock };
    let logger: Record<'info' | 'warn' | 'error', jest.Mock>;
    let service: ConfigureService;
    let sleep: jest.SpyInstance;

    // Requête acceptée, puis fin de l'application en arrière-plan
    async function Apply(dto: ConfigureDto): Promise<void> {
        await expect(service.configure(dto)).resolves.toBe(true);
        await service.whenIdle();
    }

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

    // Statut HTTP et corps renvoyés au front quand la requête est refusée
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
        // Le délai laissé à la réponse 202 est instantané en test
        sleep = jest.spyOn(service as unknown as { _sleep: (ms: number) => Promise<void> }, '_sleep').mockResolvedValue(undefined);
    });

    describe('response before the WiFi switch', () => {
        it('accepts the request, then waits for the response to reach the front before touching the WiFi', async () => {
            let release: () => void = () => undefined;
            sleep.mockReturnValue(new Promise<void>((resolve) => {
                release = resolve;
            }));

            await expect(service.configure(SetupDto())).resolves.toBe(true);

            expect(sleep).toHaveBeenCalledWith(CONFIGURE_RESPONSE_GRACE_MS);
            expect(wifi.connect).not.toHaveBeenCalled();
            expect(service.getState()).toEqual(expect.objectContaining({
                status: 'in-progress', errorCode: null, ssid: 'HomeNetwork', finishedAt: null
            }));

            release();
            await service.whenIdle();

            expect(wifi.connect).toHaveBeenCalled();
            expect(service.getState()).toEqual(expect.objectContaining({ status: 'succeeded', errorCode: null, ssid: 'HomeNetwork' }));
            expect(service.getState().finishedAt).not.toBeNull();
        });

        it('returns 409 CONFIGURE_IN_PROGRESS while a configuration is running, and accepts a new one afterwards', async () => {
            let release: () => void = () => undefined;
            sleep.mockReturnValueOnce(new Promise<void>((resolve) => {
                release = resolve;
            }));
            await service.configure(SetupDto());

            const { status, body } = await Failure(SetupDto());

            expect(status).toBe(HttpStatus.CONFLICT);
            expect(body).toEqual(expect.objectContaining({ statusCode: 409, code: ErrorCode.CONFIGURE_IN_PROGRESS }));
            release();
            await service.whenIdle();
            expect(wifi.connect).toHaveBeenCalledTimes(1);

            await Apply(SetupDto());
            expect(wifi.connect).toHaveBeenCalledTimes(2);
        });

        it('reports idle until a request is accepted', async () => {
            auth.verifyInitialPassword.mockResolvedValue(false);
            await Failure(SetupDto());

            expect(service.getState()).toEqual({ status: 'idle', errorCode: null, ssid: null, startedAt: null, finishedAt: null });
        });
    });

    describe('setup mode (no configured account)', () => {
        it('checks the label password, then connects, saves coordinates, creates the configured user and stops the hotspot', async () => {
            await Apply(SetupDto());

            expect(auth.verifyInitialPassword).toHaveBeenCalledWith('alice', 'label-password');
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
            expect(service.getState().status).toBe('succeeded');
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
            await Apply(SetupDto({ email: undefined, localCoordinates: undefined }));

            expect(settings.setLocalCoordinates).not.toHaveBeenCalled();
            expect(auth.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: undefined, isConfigured: true }));
        });

        it('records the WiFi error code (e.g. wrong PSK) and stops before creating the user', async () => {
            wifi.connect.mockRejectedValue(new BadRequestException(ErrorBody(HttpStatus.BAD_REQUEST, ErrorCode.WIFI_INVALID_PSK, 'bad psk')));

            await Apply(SetupDto());

            expect(service.getState()).toEqual(expect.objectContaining({
                status: 'failed', errorCode: ErrorCode.WIFI_INVALID_PSK, ssid: 'HomeNetwork'
            }));
            expect(service.getState().finishedAt).not.toBeNull();
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
        ])('records the step code when the %s step fails without a code', async (_step, arrange, code) => {
            arrange();

            await Apply(SetupDto());

            expect(service.getState()).toEqual(expect.objectContaining({ status: 'failed', errorCode: code }));
        });
    });

    describe('recovery mode (configured account)', () => {
        beforeEach(() => {
            auth.hasConfiguredAccount.mockResolvedValue(true);
        });

        it('checks the user credentials, then only changes the WiFi', async () => {
            await Apply(RecoveryDto());

            expect(auth.verifyConfiguredCredentials).toHaveBeenCalledWith('alice', 'user-password');
            expect(auth.verifyInitialPassword).not.toHaveBeenCalled();
            expect(wifi.connect).toHaveBeenCalledWith({ ssid: 'NewNetwork', password: 'wifi-secret' });
            expect(wifi.stopHotspot).toHaveBeenCalled();
            expect(auth.createUser).not.toHaveBeenCalled();
            expect(settings.setLocalCoordinates).not.toHaveBeenCalled();
            expect(service.getState().status).toBe('succeeded');
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
            await Apply(RecoveryDto({ password: 'other-password', email: 'x@example.com' }));

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

                expect(auth.verifyInitialPassword).toHaveBeenCalledWith(undefined, 'label-password');
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
