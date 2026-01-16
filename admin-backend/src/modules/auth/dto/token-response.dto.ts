import { ApiProperty } from '@nestjs/swagger';

class UserInfo {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  role: string;

  @ApiProperty({ required: false, nullable: true })
  organizationId?: string | null;

  @ApiProperty({ required: false })
  firstName?: string;

  @ApiProperty({ required: false })
  lastName?: string;
}

export class TokenResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken: string;

  @ApiProperty({ description: 'Refresh token for obtaining new access tokens' })
  refreshToken: string;

  @ApiProperty({ example: 'Bearer', description: 'Token type' })
  tokenType: string;

  @ApiProperty({ example: 86400, description: 'Token expiration time in seconds' })
  expiresIn: number;

  @ApiProperty({ type: UserInfo, description: 'User information' })
  user: UserInfo;
}
