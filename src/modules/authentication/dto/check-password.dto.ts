import { IsString, Length } from 'class-validator';

export class CheckPasswordDto {
    @IsString()
    @Length(1, 64)
    public login: string;

    @IsString()
    @Length(1, 72)
    public password: string;
}
