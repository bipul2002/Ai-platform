import { Module, forwardRef } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentApiKeysController } from './agent-api-keys.controller';
import { AgentApiKeysService } from './agent-api-keys.service';
import { EncryptionService } from '../../common/encryption.service';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [forwardRef(() => AuthModule), AuditModule, UsersModule],
  controllers: [AgentsController, AgentApiKeysController],
  providers: [AgentsService, AgentApiKeysService, EncryptionService],
  exports: [AgentsService, AgentApiKeysService],
})
export class AgentsModule {}
