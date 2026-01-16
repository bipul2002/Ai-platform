import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';

export interface MagicLinkEmailData {
  email: string;
  link: string;
  userName?: string;
}
@Injectable()
export class EmailService {
  constructor(
    private configService: ConfigService,
    private mailerService: MailerService,
  ) { }

  async sendMagicLink(data: MagicLinkEmailData): Promise<void> {
    const appName = this.configService.get<string>('app.name', 'AI Query Platform');

    await this.mailerService.sendMail({
      to: data.email,
      from: this.configService.get<string>('email.from', 'noreply@aiqueryplatform.com'),
      subject: `Sign in to ${appName}`,
      template: 'magic-link',
      context: {
        userName: data.userName || data.email,
        appName,
        link: data.link,
        email: data.email,
      },
    });
  }
}
