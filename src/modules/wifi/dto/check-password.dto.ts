import { IsOptional, IsString, Length } from 'class-validator';

/**
 * - setup    : { currentPassword }        => mot de passe de l'étiquette (compte technique)
 * - recovery : { login, currentPassword } => mot de passe choisi lors du setup
 * Mêmes champs et mêmes règles que ConfigureDto : le front peut valider le mot de passe
 * avant d'envoyer /updater/configure. `login` n'est exigé qu'en recovery (vérifié par ConfigureService).
 */
export class CheckPasswordDto {
    @IsOptional()
    @IsString()
    @Length(1, 64)
    public login?: string;

    @IsString()
    @Length(1, 72)
    public currentPassword: string;
}
