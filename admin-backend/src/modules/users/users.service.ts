import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InviteUserDto } from './dto/invite-user.dto'; // Import InviteUserDto
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { adminUsers } from '../../db/schema';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    private authService: AuthService,
  ) { }

  async inviteUser(inviteUserDto: InviteUserDto, organizationId: string) {
    // Check if user exists
    const existingUsers = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, inviteUserDto.email.toLowerCase()))
      .limit(1);

    let userId: string;

    if (existingUsers.length > 0) {
      throw new ConflictException('User with this email already exists');
    }

    // Create new user
    const newUsers = await this.db.insert(adminUsers).values({
      email: inviteUserDto.email.toLowerCase(),
      organizationId,
      role: inviteUserDto.role as 'admin' | 'viewer',
      firstName: inviteUserDto.firstName,
      lastName: inviteUserDto.lastName,
      isActive: true,
    }).returning();
    userId = newUsers[0].id;

    // Send Invite (Magic Link)
    await this.authService.sendMagicLink(inviteUserDto.email);
    return { message: 'Invitation sent successfully' };
  }

  async findAll(organizationId: string) {
    // If no organizationId provided, return empty array
    // This can happen if user doesn't have an organization assigned
    if (!organizationId) {
      return [];
    }

    return this.db
      .select({
        id: adminUsers.id,
        email: adminUsers.email,
        role: adminUsers.role,
        firstName: adminUsers.firstName,
        lastName: adminUsers.lastName,
        isActive: adminUsers.isActive,
        lastLoginAt: adminUsers.lastLoginAt,
      })
      .from(adminUsers)
      .where(eq(adminUsers.organizationId, organizationId));
  }

  findOne(id: number) {
    return 'This action returns a #' + id + ' user';
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const existingUsers = await this.db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);

    if (existingUsers.length === 0) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const [updatedUser] = await this.db.update(adminUsers)
      .set({
        ...updateUserDto,
        updatedAt: new Date(),
      })
      .where(eq(adminUsers.id, id))
      .returning();

    return updatedUser;
  }

  async remove(id: string) {
    const existingUsers = await this.db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);

    if (existingUsers.length === 0) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    await this.db.delete(adminUsers).where(eq(adminUsers.id, id));

    return { message: `User with ID ${id} removed successfully` };
  }
}
