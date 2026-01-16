import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { DrizzleModule } from './db/drizzle.module';
import { AuthModule } from './modules/auth/auth.module';
import { AgentsModule } from './modules/agents/agents.module';
import { SchemaModule } from './modules/schema/schema.module';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module';
import { SensitivityModule } from './modules/sensitivity/sensitivity.module';
import { AuditModule } from './modules/audit/audit.module';
import { ExternalDbModule } from './modules/external-db/external-db.module';
import { HealthModule } from './modules/health/health.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { SeedModule } from './db/seeds/seed.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { MessagesModule } from './modules/messages/messages.module';
import { QueryExecutorModule } from './modules/query-executor/query-executor.module';
import configuration from './config/configuration';

import { RedisModule } from './modules/redis/redis.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { UsersModule } from './modules/users/users.module';
import { EmailModule } from './modules/email/email.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([{
        ttl: config.get<number>('throttle.ttl', 60) * 1000,
        limit: config.get<number>('throttle.limit', 100),
      }]),
    }),
    DrizzleModule,
    RedisModule, // NEW
    EmailModule,
    AuthModule,
    AgentsModule,
    SchemaModule,
    EmbeddingsModule,
    SensitivityModule,
    AuditModule,
    ExternalDbModule,
    HealthModule,
    SeedModule,
    ConversationsModule,
    MessagesModule,
    QueryExecutorModule,
    OrganizationsModule,
    UsersModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
