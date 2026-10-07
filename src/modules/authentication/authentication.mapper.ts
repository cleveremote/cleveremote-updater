import { AuthenticationModel } from './authentication.model';
import { Authentication, AuthenticationDocument } from './authentication.schema';

export class AuthenticationMapper {
    public static mapToModel(authentication: AuthenticationDocument): AuthenticationModel {
        const model = new AuthenticationModel();
        model.id = authentication._id;
        model.login = authentication.login;
        model.password = authentication.password;
        model.role = authentication.role;
        model.deletedAt = authentication.deletedAt;
        return model;
    }

    public static mapToSchema(model: AuthenticationModel): Authentication {
        const authentication = new Authentication();
        authentication.login = model.login;
        authentication.password = model.password;
        authentication.role = model.role;
        authentication.deletedAt = model.deletedAt;
        return authentication;
    }
}
