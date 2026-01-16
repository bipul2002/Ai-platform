import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class InviteUserDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsEmail()
    email: string;

    @ApiProperty({ example: 'viewer', enum: ['admin', 'viewer'] })
    @IsEnum(['admin', 'viewer'])
    role: string;

    @ApiProperty({ example: 'John', required: false })
    @IsOptional()
    @IsString()
    firstName?: string;

    @ApiProperty({ example: 'Doe', required: false })
    @IsOptional()
    @IsString()
    lastName?: string;

    @ApiProperty({ example: 'uuid-here', required: false, description: 'Organization ID (Super Admin only)' })
    @IsOptional()
    @IsUUID()
    organizationId?: string;
}
