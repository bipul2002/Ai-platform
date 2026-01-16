
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { EmailService } from './email.service';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { join } from 'path';
@Module({
  imports: [
    ConfigModule,
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        transport: {
          host: configService.get<string>('email.host', 'smtp.gmail.com'),
          port: configService.get<number>('email.port', 587),
          secure: configService.get<boolean>('email.secure', false),
          auth: {
            user: configService.get<string>('email.user'),
            pass: configService.get<string>('email.pass'),
          },
          tls: {
            rejectUnauthorized: configService.get<boolean>('email.rejectUnauthorized', true),
          },
        },
        defaults: {
          from: configService.get<string>('email.from', 'noreply@aiqueryplatform.com'),
        },
        template: {
          dir: join(__dirname, 'templates'),
          adapter: new HandlebarsAdapter(),
          options: {
            strict: true,
          },
        },
      }),
    }),
  ],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule { }
