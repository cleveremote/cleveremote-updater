import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ConfigureService } from './configure.service';
import { ConnectLocalNetworkDto } from './dto/connect-local-network.dto';
import { WifiService, WifiStatus } from './wifi.service';

@Controller('updater/network')
export class NetworkController {
    public constructor(
        private readonly _configureService: ConfigureService,
        private readonly _wifiService: WifiService
    ) {
    }

    @Post('startHotspot')
    public startHotspot(): Promise<WifiStatus> {
        return this._wifiService.startHotspot();
    }

    // Même principe que /updater/configure : 202 dès que la requête est acceptée, puis bascule WiFi en arrière-plan
    // (la box quitte le réseau par lequel le front l'a jointe). Le résultat est lu dans getMode().configure :
    // { action: 'connected_to_local_network', status: 'succeeded' | 'failed', errorCode, ... }
    // psk facultatif pour un réseau déjà configuré (isConfigured) ; sinon 400 WIFI_PSK_REQUIRED.
    @Post('joinLocalNetwork')
    @HttpCode(HttpStatus.ACCEPTED)
    public connectToLocalNetwork(@Body() dto: ConnectLocalNetworkDto): Promise<boolean> {
        return this._configureService.connectToLocalNetwork(dto);
    }
}
