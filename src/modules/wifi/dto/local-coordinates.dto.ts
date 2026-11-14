import { IsLatitude, IsLongitude, IsNumber } from 'class-validator';

export class LocalCoordinatesDto {
    // IsNumber en plus : IsLatitude/IsLongitude acceptent aussi les chaines
    @IsNumber()
    @IsLatitude()
    public latitude: number;

    @IsNumber()
    @IsLongitude()
    public longitude: number;
}
