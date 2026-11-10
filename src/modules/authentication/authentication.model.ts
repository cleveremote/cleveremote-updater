import { Role } from './role.enum';

export class AuthenticationModel {
    public id: string;
    public login: string;
    public email?: string | null;
    public password: string;
    public role: Role;
    public deletedAt: Date | null;
}
