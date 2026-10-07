import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Role } from './role.enum';

export type AuthenticationDocument = Authentication & Document;

@Schema({ collection: 'authentications', timestamps: true })
export class Authentication {
    @Prop({ type: String, default: () => randomUUID() })
    public _id: string;

    @Prop({ required: true })
    public login: string;

    @Prop({ required: true })
    public password: string;

    @Prop({ type: String, enum: Role, required: true, default: Role.USER })
    public role: Role;

    @Prop({ type: Date, default: null })
    public deletedAt: Date | null;
}

export const AuthenticationSchema = SchemaFactory.createForClass(Authentication);
