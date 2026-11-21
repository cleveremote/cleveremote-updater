import * as bcrypt from 'bcrypt';
import { AuthenticationService } from './authentication.service';
import { AuthenticationRepository } from './authentication.repository';
import { AuthenticationModel } from './authentication.model';
import { Role } from './role.enum';

describe('AuthenticationService password checks', () => {
    // coût minimal : le coût réel (13) prend plusieurs secondes sur le Raspberry Pi
    const hash = (password: string): string => bcrypt.hashSync(password, 4);
    let repository: { findByLogin: jest.Mock; updateByLogin: jest.Mock };
    let config: { get: jest.Mock };
    let logger: Record<'info' | 'warn' | 'error', jest.Mock>;
    let service: AuthenticationService;

    function User(overrides: Partial<AuthenticationModel> = {}): AuthenticationModel {
        return {
            id: '1', login: 'alice', email: null, password: hash('user-password'), role: Role.ADMIN, isConfigured: true, deletedAt: null, ...overrides
        };
    }

    beforeEach(() => {
        repository = { findByLogin: jest.fn(), updateByLogin: jest.fn().mockResolvedValue({}) };
        config = { get: jest.fn((key: string) => (key === 'UPDATER_ID' ? 'box-01' : undefined)) };
        logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        service = new AuthenticationService(repository as unknown as AuthenticationRepository, config as any, logger as any);
    });

    describe('verifyInitialPassword', () => {
        it('compares with the technical account stored in database', async () => {
            repository.findByLogin.mockResolvedValue(User({ login: 'box-01', isConfigured: false, password: hash('label-password') }));

            await expect(service.verifyInitialPassword('label-password', 'box-01')).resolves.toBe(true);
            await expect(service.verifyInitialPassword('wrong', 'box-01')).resolves.toBe(false);
            expect(repository.findByLogin).toHaveBeenCalledWith('box-01');
        });

        it('fails when the technical account is missing', async () => {
            repository.findByLogin.mockResolvedValue(null);

            await expect(service.verifyInitialPassword('label-password', 'box-01')).resolves.toBe(false);
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('checkPassword', () => {
        it('accepts the password of the given login and rejects a wrong one', async () => {
            repository.findByLogin.mockResolvedValue(User());

            await expect(service.checkPassword('alice', 'user-password')).resolves.toBe(true);
            await expect(service.checkPassword('alice', 'wrong')).resolves.toBe(false);
            expect(repository.findByLogin).toHaveBeenCalledWith('alice');
        });

        it.each([
            ['unknown login', null],
            ['deleted account', User({ deletedAt: new Date() })]
        ])('rejects a %s', async (_label, user) => {
            repository.findByLogin.mockResolvedValue(user);

            await expect(service.checkPassword('alice', 'user-password')).resolves.toBe(false);
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe('verifyConfiguredCredentials', () => {
        it('accepts the password of a configured account and rejects a wrong one', async () => {
            repository.findByLogin.mockResolvedValue(User());

            await expect(service.verifyConfiguredCredentials('alice', 'user-password')).resolves.toBe(true);
            await expect(service.verifyConfiguredCredentials('alice', 'wrong')).resolves.toBe(false);
            expect(repository.findByLogin).toHaveBeenCalledWith('alice');
        });

        it('accepts a legacy configured account identified by its email', async () => {
            repository.findByLogin.mockResolvedValue(User({ isConfigured: false, email: 'alice@example.com' }));

            await expect(service.verifyConfiguredCredentials('alice', 'user-password')).resolves.toBe(true);
        });

        it.each([
            ['unknown login', null],
            ['technical account', User({ isConfigured: false, email: null })],
            ['deleted account', User({ deletedAt: new Date() })]
        ])('rejects a %s', async (_label, user) => {
            repository.findByLogin.mockResolvedValue(user);

            await expect(service.verifyConfiguredCredentials('alice', 'user-password')).resolves.toBe(false);
        });
    });

    describe('completeConfiguredUser', () => {
        it('updates only the supplied fields and hashes the new password', async () => {
            await service.completeConfiguredUser('alice', { email: 'new@example.com', password: 'other-password' });

            const saved = repository.updateByLogin.mock.calls[0][0] as AuthenticationModel;
            expect(saved).toEqual(expect.objectContaining({ login: 'alice', email: 'new@example.com' }));
            expect(saved.role).toBeUndefined();
            expect(saved.isConfigured).toBeUndefined();
            expect(saved.deletedAt).toBeUndefined();
            expect(bcrypt.compareSync('other-password', saved.password)).toBe(true);
        });

        it('keeps the current password when no new one is supplied', async () => {
            await service.completeConfiguredUser('alice', { email: 'new@example.com' });

            expect(repository.updateByLogin.mock.calls[0][0].password).toBeUndefined();
        });

        it('writes nothing when no field is supplied', async () => {
            await service.completeConfiguredUser('alice', {});

            expect(repository.updateByLogin).not.toHaveBeenCalled();
        });
    });
});
