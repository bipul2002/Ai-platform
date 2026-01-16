import { Controller, Get, Post, Body, Patch, Param, Delete, Put, UseGuards, Request, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UserAgentAccessService } from './user-agent-access.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly userAgentAccessService: UserAgentAccessService,
  ) { }

  @Post('invite')
  @Roles('admin', 'super_admin')
  @ApiOperation({ summary: 'Invite user to organization' })
  @ApiResponse({ status: 201, description: 'Invitation sent' })
  invite(@Body() inviteUserDto: InviteUserDto, @Request() req: any) {
    // Super Admin can specify organizationId in the DTO, Admin uses their own
    const organizationId = req.user.role === 'super_admin' && inviteUserDto.organizationId
      ? inviteUserDto.organizationId
      : req.user.organizationId;
    return this.usersService.inviteUser(inviteUserDto, organizationId);
  }

  @Get()
  @Roles('admin', 'super_admin')
  @ApiOperation({ summary: 'List users in organization' })
  findAll(@Query('organizationId') organizationId: string, @Request() req: any) {
    // Super Admin can query any organization, Admin is restricted to their own
    const effectiveOrgId = req.user.role === 'super_admin' && organizationId
      ? organizationId
      : req.user.organizationId;
    return this.usersService.findAll(effectiveOrgId);
  }

  @Patch(':id')
  @Roles('admin', 'super_admin')
  @ApiOperation({ summary: 'Update user' })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @Roles('admin', 'super_admin')
  @ApiOperation({ summary: 'Delete user' })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Get(':id/agent-access')
  @Roles('admin', 'super_admin')
  @ApiOperation({ summary: 'Get user agent access' })
  @ApiResponse({ status: 200, description: 'List of agents user has access to' })
  async getUserAgentAccess(@Param('id') userId: string, @Request() req: any) {
    return this.userAgentAccessService.getUserAgentsWithDetails(
      userId,
      req.user.organizationId
    );
  }

  @Put(':id/agent-access')
  @Roles('admin', 'super_admin')
  @ApiOperation({ summary: 'Set user agent access' })
  @ApiResponse({ status: 200, description: 'Agent access updated successfully' })
  async setUserAgentAccess(
    @Param('id') userId: string,
    @Body('agentIds') agentIds: string[],
    @Request() req: any
  ) {
    await this.userAgentAccessService.setUserAgentAccess(
      userId,
      agentIds,
      req.user.sub,
      req.user.organizationId
    );
    return { message: 'Agent access updated successfully' };
  }
}
