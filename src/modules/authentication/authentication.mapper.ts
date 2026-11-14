import { AuthenticationModel } from './authentication.model';
import { Authentication, AuthenticationDocument } from './authentication.schema';

export class AuthenticationMapper {
    public static mapToModel(authentication: AuthenticationDocument): AuthenticationModel {
        const model = new AuthenticationModel();
        model.id = authentication._id;
        model.login = authentication.login;
        model.email = authentication.email ?? null;
        model.password = authentication.password;
        model.role = authentication.role;
        model.isConfigured = authentication.isConfigured ?? false;
        model.deletedAt = authentication.deletedAt;
        return model;
    }

    public static mapToSchema(model: AuthenticationModel): Authentication {
        const authentication = new Authentication();
        authentication.login = model.login;
        // undefined => champ ignore par mongoose lors d'un update (email existant conserve)
        authentication.email = model.email;
        authentication.password = model.password;
        authentication.role = model.role;
        // undefined => champ ignore lors d'un update (un compte configure le reste)
        authentication.isConfigured = model.isConfigured;
        authentication.deletedAt = model.deletedAt;
        return authentication;
    }
}
