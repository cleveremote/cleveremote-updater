import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthenticationService } from './authentication.service';
import { CheckPasswordDto } from './dto/check-password.dto';

@Controller('updater/authentication')
export class AuthenticationController {
    public constructor(private readonly _authenticationService: AuthenticationService) {
    }

    @Post('checkPassword')
    @HttpCode(HttpStatus.OK)
    public checkPassword(@Body() dto: CheckPasswordDto): Promise<boolean> {
        return this._authenticationService.checkPassword(dto.login, dto.password);
    }
}
