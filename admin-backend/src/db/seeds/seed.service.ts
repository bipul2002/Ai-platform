import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { DRIZZLE, DrizzleDB } from '../drizzle.module';
import { adminUsers, sensitiveFieldRegistryGlobal } from '../schema';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';

@Injectable()
export class SeedService implements OnModuleInit {
    private readonly logger = new Logger(SeedService.name);

    constructor(@Inject(DRIZZLE) private db: DrizzleDB) {
        this.logger.log('SeedService initialized');
    }

    async onModuleInit() {
        this.logger.log('SeedService onModuleInit called');
        await this.seedAdmin();
        await this.seedGlobalSensitivityRules();
    }

    async seedAdmin() {
        this.logger.log('Starting seedAdmin...');
        try {
            const email = 'admin@platform.local';
            this.logger.log(`Checking for existing user with email: ${email}`);

            const existingUser = await this.db
                .select()
                .from(adminUsers)
                .where(eq(adminUsers.email, email))
                .limit(1);

            this.logger.log(`Found ${existingUser.length} existing users`);

            if (existingUser.length === 0) {
                this.logger.log(`Seeding default admin user: ${email}`);
                const salt = await bcrypt.genSalt(12);
                const passwordHash = await bcrypt.hash('SecureAdmin123!', salt);

                await this.db.insert(adminUsers).values({
                    email,
                    passwordHash,
                    role: 'super_admin',
                    firstName: 'System',
                    lastName: 'Admin',
                    isActive: true,
                });
                this.logger.log('Default admin user created successfully');
            }
        } catch (error) {
            this.logger.error('Failed to seed admin user', error);
        }
    }

    async seedGlobalSensitivityRules() {
        this.logger.log('Starting seedGlobalSensitivityRules...');
        try {
            const defaultRules = [
                {
                    patternType: 'column_name',
                    patternValue: 'password',
                    patternRegex: '.*(password|passwd|pwd).*',
                    sensitivityLevel: 'critical',
                    maskingStrategy: 'full',
                    description: 'Any column containing password',
                },
                {
                    patternType: 'value_regex',
                    patternValue: 'ssn',
                    patternRegex: '^\\d{3}-?\\d{2}-?\\d{4}$',
                    sensitivityLevel: 'critical',
                    maskingStrategy: 'full',
                    description: 'Social Security Numbers',
                },
                {
                    patternType: 'value_regex',
                    patternValue: 'api_key',
                    patternRegex: '^sk-[a-zA-Z0-9]{48}$',
                    sensitivityLevel: 'critical',
                    maskingStrategy: 'full',
                    description: 'API keys',
                },
                {
                    patternType: 'value_regex',
                    patternValue: 'credit_card',
                    patternRegex: '^\\d{13,19}$',
                    sensitivityLevel: 'critical',
                    maskingStrategy: 'full',
                    description: 'Credit card numbers',
                },
                {
                    patternType: 'column_name',
                    patternValue: 'email',
                    patternRegex: '.*email.*',
                    sensitivityLevel: 'medium',
                    maskingStrategy: 'partial',
                    description: 'Email addresses',
                },
                {
                    patternType: 'column_name',
                    patternValue: 'phone',
                    patternRegex: '.*(phone|mobile|cell|fax).*',
                    sensitivityLevel: 'medium',
                    maskingStrategy: 'partial',
                    description: 'Phone numbers',
                },
                {
                    patternType: 'column_name',
                    patternValue: 'address',
                    patternRegex: '.*(address|street|city|zip|postal|state|province).*',
                    sensitivityLevel: 'medium',
                    maskingStrategy: 'partial',
                    description: 'Physical addresses',
                },
                {
                    patternType: 'column_name',
                    patternValue: 'dob',
                    patternRegex: '.*(dob|birth_date|date_of_birth).*',
                    sensitivityLevel: 'high',
                    maskingStrategy: 'redact',
                    description: 'Dates of birth',
                },
                {
                    patternType: 'value_regex',
                    patternValue: 'iban',
                    patternRegex: '.*(iban|bank_account|account_number).*',
                    sensitivityLevel: 'critical',
                    maskingStrategy: 'full',
                    description: 'Bank account numbers (IBAN)',
                },
                {
                    patternType: 'column_name',
                    patternValue: 'driver_license',
                    patternRegex: '.*(driver_license|dl_number).*',
                    sensitivityLevel: 'critical',
                    maskingStrategy: 'full',
                    description: 'Driver license numbers',
                },
                {
                    patternType: 'column_name',
                    patternValue: 'passport',
                    patternRegex: '.*(passport|passport_num).*',
                    sensitivityLevel: 'critical',
                    maskingStrategy: 'full',
                    description: 'Passport numbers',
                },
                {
                    patternType: 'value_regex',
                    patternValue: 'ip_address',
                    patternRegex: '^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$',
                    sensitivityLevel: 'medium',
                    maskingStrategy: 'partial',
                    description: 'IP addresses',
                },
                {
                    patternType: 'column_name',
                    patternValue: 'mac_address',
                    patternRegex: '.*(mac_address|mac_addr).*',
                    sensitivityLevel: 'medium',
                    maskingStrategy: 'partial',
                    description: 'MAC addresses',
                },
                {
                    patternType: 'value_regex',
                    patternValue: 'jwt',
                    patternRegex: '^eyJ[A-Za-z0-9-_]+\\.[A-Za-z0-9-_]+\\.[A-Za-z0-9-_]+$',
                    sensitivityLevel: 'critical',
                    maskingStrategy: 'full',
                    description: 'JWT tokens',
                },
                {
                    patternType: 'value_regex',
                    patternValue: 'aws_key',
                    patternRegex: '^AKIA[0-9A-Z]{16}$',
                    sensitivityLevel: 'critical',
                    maskingStrategy: 'full',
                    description: 'AWS Access Keys',
                },
                {
                    patternType: 'value_regex',
                    patternValue: 'aws_secret',
                    patternRegex: '^[A-Za-z0-9/+=]{40}$',
                    sensitivityLevel: 'critical',
                    maskingStrategy: 'full',
                    description: 'AWS Secret Keys',
                },
                {
                    patternType: 'column_name',
                    patternValue: 'cvv',
                    patternRegex: '.*(cvv|cvc|security_code).*',
                    sensitivityLevel: 'critical',
                    maskingStrategy: 'full',
                    description: 'Card security codes',
                },
                {
                    patternType: 'column_name',
                    patternValue: 'salary',
                    patternRegex: '.*(salary|compensation|pay).*',
                    sensitivityLevel: 'high',
                    maskingStrategy: 'full',
                    description: 'Salary information',
                },
            ];

            for (const rule of defaultRules) {
                const existing = await this.db
                    .select()
                    .from(sensitiveFieldRegistryGlobal)
                    .where(eq(sensitiveFieldRegistryGlobal.patternValue, rule.patternValue))
                    .limit(1);

                if (existing.length === 0) {
                    this.logger.log(`Seeding global sensitivity rule: ${rule.patternValue}`);
                    // @ts-ignore
                    await this.db.insert(sensitiveFieldRegistryGlobal).values(rule);
                }
            }
            this.logger.log('Global sensitivity rules seeded successfully');
        } catch (error) {
            this.logger.error('Failed to seed global sensitivity rules', error);
        }
    }
}
