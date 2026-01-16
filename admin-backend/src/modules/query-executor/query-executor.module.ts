import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { QueryExecutorController } from './query-executor.controller';
import { QueryExecutorService } from './query-executor.service';
import { ExternalDbService } from './external-db.service';
import { ExcelExportService } from './excel-export.service';
import { DrizzleModule } from '../../db/drizzle.module';
import { EncryptionService } from '../../common/encryption.service';
import { AgentsModule } from '../agents/agents.module';

@Module({
    imports: [DrizzleModule, AgentsModule, HttpModule],
    controllers: [QueryExecutorController],
    providers: [
        QueryExecutorService,
        ExternalDbService,
        ExcelExportService,
        EncryptionService,
    ],
    exports: [QueryExecutorService, ExternalDbService],
})
export class QueryExecutorModule { }
