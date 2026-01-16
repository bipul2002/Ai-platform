import { Injectable, UnauthorizedException, ConflictException, Inject, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import * as bcrypt from 'bcrypt';
import { eq, and, gt } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { adminUsers, refreshTokens, magicLinks, agentApiKeys, agents } from '../../db/schema';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { AgentApiKeysService } from '../agents/agent-api-keys.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  organizationId: string | null;
  agentId?: string;
  apiKeyId?: string;
  apiKeyName?: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class AuthService {
  private readonly SALT_ROUNDS = 12;
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCK_DURATION_MINUTES = 15;

  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    private jwtService: JwtService,
    private configService: ConfigService,
    private agentApiKeysService: AgentApiKeysService,
    private emailService: EmailService,
  ) { }

  async sendMagicLink(email: string): Promise<void> {
    const users = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email.toLowerCase()))
      .limit(1);

    if (users.length === 0) {
      throw new UnauthorizedException('User not found');
    }

    const user = users[0];

    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    // Generate specific token format (Base64 random number)
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    await this.db.insert(magicLinks).values({
      userId: user.id,
      token,
      expiresAt,
    });
    const frontendUrl = this.configService.get<string>('frontendUrl');
    const link = `${frontendUrl}/verify?token=${token}`;
    await this.emailService.sendMagicLink({
      email,
      link,
      userName: user.firstName || user.email,
    });
  }

  async verifyMagicLink(token: string): Promise<TokenResponseDto> {
    const links = await this.db
      .select()
      .from(magicLinks)
      .where(eq(magicLinks.token, token))
      .limit(1);

    if (links.length === 0) {
      throw new UnauthorizedException('Invalid magic link');
    }

    const link = links[0];

    if (link.used) {
      throw new UnauthorizedException('Magic link already used');
    }

    if (new Date() > link.expiresAt) {
      throw new UnauthorizedException('Magic link expired');
    }

    // Mark as used
    await this.db
      .update(magicLinks)
      .set({ used: true })
      .where(eq(magicLinks.id, link.id));

    // Get User
    const users = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, link.userId))
      .limit(1);

    if (users.length === 0) {
      throw new UnauthorizedException('User not found');
    }

    const user = users[0];

    // Update Last Login
    await this.db
      .update(adminUsers)
      .set({ lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(adminUsers.id, user.id));

    const { passwordHash, ...userWithoutPassword } = user;
    return this.generateTokens(userWithoutPassword);
  }

  async login(loginDto: LoginDto): Promise<{ message: string }> {
    await this.sendMagicLink(loginDto.email);
    return {
      message: 'If your email is registered, you will receive a magic link shortly.',
    };
  }

  async register(registerDto: RegisterDto, creatorRole?: string): Promise<TokenResponseDto> {
    if (registerDto.role !== 'viewer' && creatorRole !== 'super_admin') {
      throw new ForbiddenException('Only super admins can create admin users');
    }

    const existingUsers = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, registerDto.email.toLowerCase()))
      .limit(1);

    if (existingUsers.length > 0) {
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(registerDto.password, this.SALT_ROUNDS);

    const newUsers = await this.db
      .insert(adminUsers)
      .values({
        email: registerDto.email.toLowerCase(),
        passwordHash,
        role: registerDto.role || 'viewer',
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        isActive: true,
      })
      .returning();

    const user = newUsers[0];
    const { passwordHash: _, ...userWithoutPassword } = user;

    return this.generateTokens(userWithoutPassword);
  }

  async refreshTokens(refreshToken: string): Promise<TokenResponseDto> {
    const tokenHash = await this.hashToken(refreshToken);

    const tokens = await this.db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          eq(refreshTokens.isRevoked, false),
          gt(refreshTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (tokens.length === 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const storedToken = tokens[0];

    await this.db
      .update(refreshTokens)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(eq(refreshTokens.id, storedToken.id));

    const users = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, storedToken.userId))
      .limit(1);

    if (users.length === 0 || !users[0].isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const { passwordHash, ...user } = users[0];
    return this.generateTokens(user);
  }

  async logout(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(eq(refreshTokens.userId, userId));
  }

  async validateToken(token: string): Promise<JwtPayload> {
    try {
      return this.jwtService.verify(token);
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  async getUserById(userId: string) {
    const users = await this.db
      .select({
        id: adminUsers.id,
        email: adminUsers.email,
        role: adminUsers.role,
        organizationId: adminUsers.organizationId,
        firstName: adminUsers.firstName,
        lastName: adminUsers.lastName,
        isActive: adminUsers.isActive,
        lastLoginAt: adminUsers.lastLoginAt,
        createdAt: adminUsers.createdAt,
      })
      .from(adminUsers)
      .where(eq(adminUsers.id, userId))
      .limit(1);

    if (users.length === 0) {
      throw new UnauthorizedException('User not found');
    }

    return users[0];
  }

  async exchangeApiKeyForToken(apiKey: string, agentId: string, parentOrigin: string): Promise<TokenResponseDto> {
    // Find matching API key
    const matchedKey = await this.agentApiKeysService.findByAgentAndKey(agentId, apiKey, parentOrigin);

    if (!matchedKey) {
      throw new UnauthorizedException('Invalid API key or the origin is not whitelisted!');
    }

    // Get agent info
    const agentResults = await this.db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (agentResults.length === 0 || !agentResults[0].isActive) {
      throw new UnauthorizedException('Agent not found or inactive');
    }

    const agent = agentResults[0];

    // Generate short-lived JWT (1 hour for iframe)
    const payload: JwtPayload = {
      sub: matchedKey.id,
      email: `apikey-${matchedKey.id}@system`,
      role: 'api_key',
      organizationId: agent.organizationId || null,
      agentId: agent.id,
      apiKeyId: matchedKey.id,
      apiKeyName: matchedKey.name,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });

    return {
      accessToken,
      refreshToken: '', // or whatever appropriate empty value if not using refresh tokens for API keys
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: {
        id: matchedKey.id,
        email: payload.email,
        role: 'api_key',
        organizationId: agent.organizationId || undefined,
      },
    };
  }

  private async generateTokens(user: any): Promise<TokenResponseDto> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId || null,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = uuidv4();
    const refreshTokenHash = await this.hashToken(refreshToken);

    const refreshExpiration = this.configService.get<string>('jwt.refreshExpiration', '7d');
    const expiresAt = this.calculateExpiration(refreshExpiration);

    await this.db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: refreshTokenHash,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.getExpirationSeconds(this.configService.get<string>('jwt.expiration', '24h')),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId || undefined,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  private async incrementFailedAttempts(userId: string): Promise<void> {
    const users = await this.db
      .select({ failedLoginAttempts: adminUsers.failedLoginAttempts })
      .from(adminUsers)
      .where(eq(adminUsers.id, userId))
      .limit(1);

    const currentAttempts = (users[0]?.failedLoginAttempts || 0) + 1;
    const updateData: any = { failedLoginAttempts: currentAttempts };

    if (currentAttempts >= this.MAX_LOGIN_ATTEMPTS) {
      updateData.lockedUntil = new Date(Date.now() + this.LOCK_DURATION_MINUTES * 60 * 1000);
    }

    await this.db
      .update(adminUsers)
      .set(updateData)
      .where(eq(adminUsers.id, userId));
  }

  private async resetFailedAttempts(userId: string): Promise<void> {
    await this.db
      .update(adminUsers)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(adminUsers.id, userId));
  }

  private async hashToken(token: string): Promise<string> {
    return bcrypt.hash(token, 10);
  }

  private calculateExpiration(duration: string): Date {
    const seconds = this.getExpirationSeconds(duration);
    return new Date(Date.now() + seconds * 1000);
  }

  private getExpirationSeconds(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 86400;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 86400;
    }
  }
}
