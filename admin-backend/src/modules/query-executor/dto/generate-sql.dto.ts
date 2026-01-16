import { IsString, IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateSqlDto {
    @ApiProperty({ description: 'Agent ID' })
    @IsUUID()
    @IsNotEmpty()
    agentId: string;

    @ApiProperty({ description: 'Natural language query to convert to SQL', example: 'Show me all customers who ordered last month' })
    @IsString()
    @IsNotEmpty()
    query: string;
}
