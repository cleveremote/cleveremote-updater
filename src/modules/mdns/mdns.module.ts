import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MdnsService } from './mdns.service';

@Module({
    imports: [ConfigModule],
    providers: [MdnsService]
})
export class MdnsModule {
}
