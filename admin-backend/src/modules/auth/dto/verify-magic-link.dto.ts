import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyMagicLinkDto {
    @ApiProperty({ example: 'base64-token-string' })
    @IsString()
    @IsNotEmpty()
    token: string;
}
