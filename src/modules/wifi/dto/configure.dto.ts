import { IsString, Length } from 'class-validator';

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

    @IsString()
    @Length(8, 64)
    public password: string;
}
