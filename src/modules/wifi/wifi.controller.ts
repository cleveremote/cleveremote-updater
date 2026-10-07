import { Body, Controller, Get, Post } from '@nestjs/common';
import { WifiService, WifiStatus, WifiNetwork } from './wifi.service';
import { ConnectWifiDto } from './dto/connect-wifi.dto';
import { StartHotspotDto } from './dto/start-hotspot.dto';
import { ConfigureDto } from './dto/configure.dto';
import { ConfigureService } from './configure.service';

@Controller('updater')
export class WifiController {
    public constructor(
        private readonly _wifiService: WifiService,
        private readonly _configureService: ConfigureService
    ) {
    }

    @Post('hotspot/start')
    public startHotspot(@Body() dto: StartHotspotDto): Promise<WifiStatus> {
        return this._wifiService.startHotspot(dto);
    }

    @Post('hotspot/stop')
    public stopHotspot(): Promise<WifiStatus> {
        return this._wifiService.stopHotspot();
    }

    @Post('connect')
    public connect(@Body() dto: ConnectWifiDto): Promise<WifiStatus> {
        return this._wifiService.connect(dto);
    }

    @Post('configure')
    public configure(@Body() dto: ConfigureDto): Promise<boolean> {
        return this._configureService.configure(dto);
    }

    @Get('getStatus')
    public getStatus(): Promise<WifiStatus> {
        return this._wifiService.getStatus();
    }

    @Get('getNetworksList')
    public scanNetworks(): Promise<WifiNetwork[]> {
        return this._wifiService.scanNetworks();
    }
}
