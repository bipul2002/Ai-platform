import { Type } from 'class-transformer';
import {
    IsString,
    IsOptional,
    IsNumber,
    IsBoolean,
    IsArray,
    ValidateNested,
    IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImportColumnDto {
    @ApiProperty({ description: 'Column name' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({ description: 'SQL data type (e.g., varchar(255), uuid, integer)' })
    @IsString()
    @IsNotEmpty()
    type: string;

    @ApiPropertyOptional({ description: 'Whether NULL values are allowed', default: true })
    @IsOptional()
    @IsBoolean()
    nullable?: boolean;

    @ApiPropertyOptional({ description: 'Is this the primary key?', default: false })
    @IsOptional()
    @IsBoolean()
    isPrimaryKey?: boolean;

    @ApiPropertyOptional({ description: 'Is this a foreign key?', default: false })
    @IsOptional()
    @IsBoolean()
    isForeignKey?: boolean;

    @ApiPropertyOptional({ description: 'Does this column have a unique constraint?', default: false })
    @IsOptional()
    @IsBoolean()
    isUnique?: boolean;

    @ApiPropertyOptional({ description: 'Is this column indexed?', default: false })
    @IsOptional()
    @IsBoolean()
    isIndexed?: boolean;

    @ApiPropertyOptional({ description: 'Default value expression' })
    @IsOptional()
    @IsString()
    defaultValue?: string;

    @ApiPropertyOptional({ description: 'Business description of the column' })
    @IsOptional()
    @IsString()
    comment?: string;
}

export class ImportTableDto {
    @ApiProperty({ description: 'Table name' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiPropertyOptional({ description: 'Schema name', default: 'public' })
    @IsOptional()
    @IsString()
    schema?: string;

    @ApiPropertyOptional({ description: 'Business description of the table' })
    @IsOptional()
    @IsString()
    comment?: string;

    @ApiPropertyOptional({ description: 'Estimated number of rows' })
    @IsOptional()
    @IsNumber()
    rowCount?: number;

    @ApiProperty({ description: 'List of column definitions', type: [ImportColumnDto] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ImportColumnDto)
    columns: ImportColumnDto[];
}

export class ImportRelationshipDto {
    @ApiProperty({ description: 'Table containing the foreign key' })
    @IsString()
    @IsNotEmpty()
    sourceTable: string;

    @ApiProperty({ description: 'Column name of the foreign key' })
    @IsString()
    @IsNotEmpty()
    sourceColumn: string;

    @ApiProperty({ description: 'Referenced table (usually the one with the primary key)' })
    @IsString()
    @IsNotEmpty()
    targetTable: string;

    @ApiProperty({ description: 'Referenced column (usually id)' })
    @IsString()
    @IsNotEmpty()
    targetColumn: string;

    @ApiPropertyOptional({ description: 'Relationship type', default: 'foreign_key' })
    @IsOptional()
    @IsString()
    type?: string;

    @ApiPropertyOptional({ description: 'Original constraint name in database' })
    @IsOptional()
    @IsString()
    constraintName?: string;
}

export class ImportSchemaDto {
    @ApiProperty({ description: 'List of table definitions', type: [ImportTableDto] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ImportTableDto)
    tables: ImportTableDto[];

    @ApiPropertyOptional({ description: 'List of relationship definitions', type: [ImportRelationshipDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ImportRelationshipDto)
    relationships?: ImportRelationshipDto[];
}
