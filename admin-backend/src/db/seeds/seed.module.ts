import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SeedService } from './seed.service';
import { DrizzleModule } from '../drizzle.module';
import configuration from '../../config/configuration';

@Module({
    imports: [
        ConfigModule.forRoot({
            load: [configuration],
        }),
        DrizzleModule,
    ],
    providers: [SeedService],
    exports: [SeedService],
})
export class SeedModule { }
