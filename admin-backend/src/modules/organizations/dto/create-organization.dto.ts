import { IsString, IsNotEmpty, IsOptional, Matches, MinLength } from 'class-validator';

export class CreateOrganizationDto {
    @IsString()
    @IsNotEmpty()
    @MinLength(2)
    name: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^[a-z0-9-]+$/, { message: 'Slug must contain only lowercase letters, numbers, and hyphens' })
    slug: string;
}

