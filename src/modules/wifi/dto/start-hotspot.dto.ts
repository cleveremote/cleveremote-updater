import { IsOptional, IsString, Length } from 'class-validator';

export class StartHotspotDto {
    @IsOptional()
    @IsString()
    @Length(1, 32)
    public ssid?: string;

    @IsOptional()
    @IsString()
    @Length(8, 64)
    public password?: string;
}
