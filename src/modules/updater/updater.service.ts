import { Injectable } from '@nestjs/common';
import * as os from 'os';

export interface UpdaterStatus {
    name: string;
    status: string;
    timestamp: string;
}

@Injectable()
export class UpdaterService {
    public getStatus(): UpdaterStatus {
        return {
            name: os.hostname(),
            status: 'ok',
            timestamp: new Date().toISOString()
        };
    }
}
