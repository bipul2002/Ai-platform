import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UserAgentAccessService } from './user-agent-access.service';
import { DrizzleModule } from '../../db/drizzle.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DrizzleModule, forwardRef(() => AuthModule)],
  controllers: [UsersController],
  providers: [UsersService, UserAgentAccessService],
  exports: [UsersService, UserAgentAccessService],
})
export class UsersModule { }
