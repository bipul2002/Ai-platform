import { IsUUID, IsString, IsOptional, IsInt, Min, Max } from 'class-validator';

export class ExecuteQueryDto {
    @IsUUID()
    agentId: string;

    @IsString()
    sql: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    page?: number = 1;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(100)
    pageSize?: number = 10;
}
