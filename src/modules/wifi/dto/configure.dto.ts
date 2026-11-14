import { Transform, Type } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { LocalCoordinatesDto } from './local-coordinates.dto';

/**
 * - setup    : { deviceName, ssid, psk, login, email?, currentPassword, password, localCoordinates? }
 * - recovery : { ssid, psk, login, currentPassword }
 * Le mode n'est connu qu'au moment de l'appel : les champs propres au setup sont donc optionnels ici
 * et leur présence est vérifiée par ConfigureService.
 */
export class ConfigureDto {

    @IsOptional()
    @IsString()
    @Length(1, 32)
    public deviceName?: string;

    @IsString()
    @Length(1, 32)
    public ssid: string;

    @IsString()
    @Length(8, 64)
    public psk: string;

    @IsString()
    @Length(1, 64)
    public login: string;

    @Transform(({ value }) => (value === '' ? undefined : value))
    @IsOptional()
    @IsEmail()
    @Length(3, 254)
    public email?: string;

    // Mot de passe accepté par la box au moment de l'appel : celui de l'étiquette en setup,
    // celui choisi par l'utilisateur en recovery (vérifié contre le hash en base)
    @IsString()
    @Length(1, 72)
    public currentPassword: string;

    // Nouveau mot de passe du compte (setup uniquement)
    @IsOptional()
    @IsString()
    @Length(8, 64)
    public password?: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => LocalCoordinatesDto)
    public localCoordinates?: LocalCoordinatesDto;
}
