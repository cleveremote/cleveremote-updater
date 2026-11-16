import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { WifiService, WifiStatus, WifiNetwork } from './wifi.service';
import { ConnectWifiDto } from './dto/connect-wifi.dto';
import { StartHotspotDto } from './dto/start-hotspot.dto';
import { ConfigureDto } from './dto/configure.dto';
import { ConfigureService } from './configure.service';
import { BoxModeService } from './box-mode.service';
import { BoxModeStatus } from './box-mode.model';

@Controller('updater')
export class WifiController {
    public constructor(
        private readonly _wifiService: WifiService,
        private readonly _configureService: ConfigureService,
        private readonly _boxModeService: BoxModeService
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

    // Répond 202 dès que la requête est validée, puis bascule le WiFi en arrière-plan : le hotspot étant coupé
    // par la bascule, le résultat ne peut pas être renvoyé ici. Le front le lit dans getMode().configure.
    @Post('configure')
    @HttpCode(HttpStatus.ACCEPTED)
    public configure(@Body() dto: ConfigureDto): Promise<boolean> {
        return this._configureService.configure(dto);
    }

    @Get('getStatus')
    public getStatus(): Promise<WifiStatus> {
        return this._wifiService.getStatus();
    }

    // Mode de la box (setup / recovery / normal...) : à appeler par le front dès qu'il joint la box
    @Get('getMode')
    public getMode(): Promise<BoxModeStatus> {
        return this._boxModeService.getMode();
    }

    @Get('getNetworksList')
    public scanNetworks(): Promise<WifiNetwork[]> {
        return this._wifiService.scanNetworks();
    }
}
