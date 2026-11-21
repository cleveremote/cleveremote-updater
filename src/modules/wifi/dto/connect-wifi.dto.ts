import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

export class ConnectWifiDto {
    @IsString()
    @Length(1, 32)
    public ssid: string;

    // Facultatif si le réseau est déjà configuré sur la box (isConfigured dans getNetworksList) :
    // la connexion réutilise alors le profil mémorisé. Une chaîne vide vaut absence.
    @Transform(({ value }) => (value === '' ? undefined : value))
    @IsOptional()
    @IsString()
    @Length(8, 64)
    public password?: string;
}
