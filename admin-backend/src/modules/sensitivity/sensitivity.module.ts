import { Module } from '@nestjs/common';
import { SensitivityController } from './sensitivity.controller';
import { SensitivityService } from './sensitivity.service';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [SensitivityController],
  providers: [SensitivityService],
  exports: [SensitivityService],
})
export class SensitivityModule {}
