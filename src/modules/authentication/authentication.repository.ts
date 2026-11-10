import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthenticationModel } from './authentication.model';
import { Authentication, AuthenticationDocument } from './authentication.schema';
import { AuthenticationMapper } from './authentication.mapper';

@Injectable()
export class AuthenticationRepository {
    public constructor(
        @InjectModel(Authentication.name) private readonly _authenticationModel: Model<AuthenticationDocument>
    ) {
    }

    public async get(): Promise<AuthenticationModel> {
        const authentication = await this._authenticationModel.findOne();
        return authentication ? AuthenticationMapper.mapToModel(authentication) : new AuthenticationModel();
    }

    public async update(entity: AuthenticationModel): Promise<AuthenticationModel> {
        const saved = await this._authenticationModel.findOneAndUpdate(
            {},
            AuthenticationMapper.mapToSchema(entity),
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        return AuthenticationMapper.mapToModel(saved);
    }

    // Compte configuré = créé via /updater/configure (seul chemin qui pose un email, obligatoire dans ConfigureDto).
    // Le compte technique créé au boot par initAuthentication() n'a pas d'email et n'est donc pas compté.
    public async existsConfigured(): Promise<boolean> {
        const found = await this._authenticationModel.exists({ email: { $ne: null }, deletedAt: null });
        return found !== null;
    }

    public async findByLogin(login: string): Promise<AuthenticationModel | null> {
        const authentication = await this._authenticationModel.findOne({ login });
        return authentication ? AuthenticationMapper.mapToModel(authentication) : null;
    }

    public async updateByLogin(entity: AuthenticationModel): Promise<AuthenticationModel> {
        const saved = await this._authenticationModel.findOneAndUpdate(
            { login: entity.login },
            AuthenticationMapper.mapToSchema(entity),
            { new: true }
        );
        return AuthenticationMapper.mapToModel(saved);
    }

    public async create(entity: AuthenticationModel): Promise<AuthenticationModel> {
        const created = await this._authenticationModel.create(AuthenticationMapper.mapToSchema(entity));
        return AuthenticationMapper.mapToModel(created);
    }
}
