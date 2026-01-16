import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request Magic Link' })
  @ApiResponse({ status: 200, description: 'Magic link sent' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify Magic Link and Get Tokens' })
  @ApiResponse({ status: 200, description: 'Token verified', type: TokenResponseDto })
  async verify(@Body() verifyDto: VerifyMagicLinkDto, @Res({ passthrough: true }) res: Response): Promise<TokenResponseDto> {
    const tokens = await this.authService.verifyMagicLink(verifyDto.token);

    // Set Cookies
    (res as any).cookie('access_token', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    });

    (res as any).cookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return tokens;
  }

  @Post('exchange-api-key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange API key for JWT token' })
  @ApiResponse({ status: 200, description: 'Token generated successfully', type: TokenResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid API key or agent' })
  async exchangeApiKey(
    @Body() body: { apiKey: string; agentId: string; parentOrigin: string; },
  ): Promise<TokenResponseDto> {
    return this.authService.exchangeApiKeyForToken(body.apiKey, body.agentId, body.parentOrigin);
  }

  @Post('register')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register a new admin user (super admin only)' })
  @ApiResponse({ status: 201, description: 'User registered successfully', type: TokenResponseDto })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async register(
    @Body() registerDto: RegisterDto,
    @Request() req: any,
  ): Promise<TokenResponseDto> {
    return this.authService.register(registerDto, req.user?.role);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully', type: TokenResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(@Body() refreshTokenDto: RefreshTokenDto): Promise<TokenResponseDto> {
    return this.authService.refreshTokens(refreshTokenDto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout and invalidate tokens' })
  @ApiResponse({ status: 204, description: 'Logged out successfully' })
  async logout(@Request() req: any): Promise<void> {
    return this.authService.logout(req.user.sub);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  async getProfile(@Request() req: any) {
    return this.authService.getUserById(req.user.sub);
  }
}
