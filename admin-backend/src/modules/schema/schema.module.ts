import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SchemaController } from './schema.controller';
import { SchemaService } from './schema.service';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ExternalDbModule } from '../external-db/external-db.module';

@Module({
  imports: [AuthModule, AuditModule, ExternalDbModule, HttpModule],
  controllers: [SchemaController],
  providers: [SchemaService],
  exports: [SchemaService],
})
export class SchemaModule {}
