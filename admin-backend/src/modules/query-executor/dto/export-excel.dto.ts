import { IsUUID, IsString } from 'class-validator';

export class ExportExcelDto {
    @IsUUID()
    agentId: string;

    @IsString()
    sql: string;
}
