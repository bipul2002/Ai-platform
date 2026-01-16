import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { organizations } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    private auditService: AuditService,
  ) { }

  async create(createOrganizationDto: CreateOrganizationDto, userId?: string) {
    const [org] = await this.db.insert(organizations).values(createOrganizationDto).returning();

    if (userId) {
      await this.auditService.log({
        userId,
        organizationId: null, // Global action - only visible to Super Admin
        action: 'config_updated',
        resourceType: 'organization',
        resourceId: org.id,
        details: { action: 'created', name: org.name },
      });
    }

    return org;
  }

  async findAll() {
    return this.db.select().from(organizations);
  }

  async findOne(id: string) {
    const [org] = await this.db.select().from(organizations).where(eq(organizations.id, id));
    if (!org) {
      throw new NotFoundException(`Organization with ID ${id} not found`);
    }
    return org;
  }

  async update(id: string, updateOrganizationDto: UpdateOrganizationDto, userId?: string) {
    const [org] = await this.db.update(organizations)
      .set({ ...updateOrganizationDto, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();

    if (!org) {
      throw new NotFoundException(`Organization with ID ${id} not found`);
    }

    if (userId) {
      await this.auditService.log({
        userId,
        organizationId: null, // Global action - only visible to Super Admin
        action: 'config_updated',
        resourceType: 'organization',
        resourceId: id,
        details: { action: 'updated', changes: Object.keys(updateOrganizationDto) },
      });
    }

    return org;
  }

  async remove(id: string, userId?: string) {
    const [org] = await this.db.delete(organizations).where(eq(organizations.id, id)).returning();
    if (!org) {
      throw new NotFoundException(`Organization with ID ${id} not found`);
    }

    if (userId) {
      await this.auditService.log({
        userId,
        organizationId: null, // Global action - only visible to Super Admin
        action: 'config_updated',
        resourceType: 'organization',
        resourceId: id,
        details: { action: 'deleted', name: org.name },
      });
    }

    return org;
  }
}
