import { Role } from './role.enum';

export class AuthenticationModel {
    public id: string;
    public login: string;
    public email?: string | null;
    public password: string;
    public role: Role;
    // true pour un compte créé via /updater/configure (setup), false pour le compte technique du boot
    public isConfigured?: boolean;
    public deletedAt: Date | null;
}
