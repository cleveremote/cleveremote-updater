import * as os from 'os';
import * as bcrypt from 'bcrypt';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuthenticationRepository } from './authentication.repository';
import { AuthenticationModel } from './authentication.model';
import { Role } from './role.enum';

@Injectable()
export class AuthenticationService implements OnApplicationBootstrap {
    public constructor(
        private readonly _authenticationRepository: AuthenticationRepository,
        private readonly _config: ConfigService,
        @InjectPinoLogger(AuthenticationService.name) private readonly _logger: PinoLogger
    ) {
    }

    public async onApplicationBootstrap(): Promise<void> {
        try {
            await this.initAuthentication();
        } catch (err) {
            this._logger.error({ err }, 'failed to initialize authentication at startup');
        }
    }

    public async initAuthentication(): Promise<boolean> {
        const exists = await this._authenticationRepository.get();
        if (!(exists.login || exists.password)) {
            this._logger.info('no credentials found, initializing authentication');
            const model = await this._managePassword();
            return !!await this._authenticationRepository.update(model);
        }
        this._logger.info('authentication already initialized');
        return true;
    }

    public async checkPassword(data: AuthenticationModel): Promise<boolean> {
        const isValid = await bcrypt.compare(data.password, (await this._authenticationRepository.get()).password);
        if (!isValid) {
            this._logger.warn({ login: data.login }, 'authentication failed');
        }
        return isValid;
    }

    public async createUser(model: AuthenticationModel): Promise<AuthenticationModel> {
        const salt = bcrypt.genSaltSync(13);
        const user: AuthenticationModel = {
            ...model,
            password: bcrypt.hashSync(model.password, salt),
            role: model.role ?? Role.USER,
            deletedAt: null
        };
        return this._authenticationRepository.create(user);
    }

    private async _managePassword(): Promise<AuthenticationModel> {
        const salt = bcrypt.genSaltSync(13);
        const password = bcrypt.hashSync(this._config.get<string>('INITIAL_PASSWORD'), salt);
        const login = this._getLogin();
        return { id: login, login, password, role: Role.ADMIN, deletedAt: null };
    }

    private _getLogin(): string {
        return this._config.get<string>('UPDATER_ID') || os.hostname();
    }
}
