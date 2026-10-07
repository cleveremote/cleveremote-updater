import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthenticationService } from './authentication.service';
import { AuthenticationRepository } from './authentication.repository';
import { Authentication, AuthenticationSchema } from './authentication.schema';

@Module({
    imports: [
        ConfigModule,
        MongooseModule.forFeature([{ name: Authentication.name, schema: AuthenticationSchema }])
    ],
    providers: [AuthenticationService, AuthenticationRepository],
    exports: [AuthenticationService]
})
export class AuthenticationModule {
}
