import { IsString, Length } from 'class-validator';

export class ConnectWifiDto {
    @IsString()
    @Length(1, 32)
    public ssid: string;

    @IsString()
    @Length(8, 64)
    public password: string;
}
