import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsEmail, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { LocalCoordinatesDto } from './local-coordinates.dto';

export class ConfigureDto {

    @IsString()
    @Length(1, 32)
    public deviceName: string;

    @IsString()
    @Length(1, 32)
    public ssid: string;

    @IsString()
    @Length(8, 64)
    public psk: string;

    @IsString()
    @Length(1, 64)
    public login: string;

    @IsBoolean()
    public useDefaultPassword: boolean;

    @IsEmail()
    @Length(3, 254)
    public email: string;

    // absent ou vide => mot de passe par defaut (cf. ConfigureService._createUser)
    @Transform(({ value }) => (value === '' ? undefined : value))
    @IsOptional()
    @IsString()
    @Length(8, 64)
    public password?: string;

    @IsDefined()
    @ValidateNested()
    @Type(() => LocalCoordinatesDto)
    public localCoordinates: LocalCoordinatesDto;
}
