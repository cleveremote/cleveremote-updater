import { Controller, Get } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { UpdaterService, UpdaterStatus } from './updater.service';

@Controller()
export class UpdaterController {
    public constructor(private readonly _updaterService: UpdaterService) {
    }

    @Get('ping')
    public ping(): UpdaterStatus {
        return this._updaterService.getStatus();
    }

    @MessagePattern(['updater/check/connection'])
    public checkConnection(): boolean {
        return true;
    }
}
