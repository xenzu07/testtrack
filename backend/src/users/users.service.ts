import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

// never return passwordHash
const userSelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  userType: true,
  isActive: true,
  tradeUnit: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      select: userSelect,
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    });
  }

  private async resolveTradeUnit(role: Role, tradeUnitId?: string | null) {
    if (role !== Role.TECHNICIAN) return null;
    if (!tradeUnitId) {
      throw new BadRequestException('A trade unit is required for technicians');
    }
    const unit = await this.prisma.tradeUnit.findUnique({ where: { id: tradeUnitId } });
    if (!unit) throw new NotFoundException('Trade unit not found');
    return unit.id;
  }

  private rethrow(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException('That email is already registered');
    }
    throw e;
  }

  async create(dto: CreateUserDto) {
    const tradeUnitId = await this.resolveTradeUnit(dto.role, dto.tradeUnitId);
    try {
      return await this.prisma.user.create({
        data: {
          fullName: dto.fullName.trim(),
          email: dto.email.trim().toLowerCase(),
          passwordHash: await bcrypt.hash(dto.password, 10),
          role: dto.role,
          userType: dto.role === Role.REPORTER ? dto.userType?.trim() || null : null,
          tradeUnitId,
        },
        select: userSelect,
      });
    } catch (e) {
      this.rethrow(e);
    }
  }

  async update(id: string, actingUserId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const role = dto.role ?? user.role;
    if (id === actingUserId && (dto.isActive === false || role !== user.role)) {
      throw new BadRequestException(
        'You cannot deactivate your own account or change your own role',
      );
    }

    const tradeUnitId = await this.resolveTradeUnit(
      role,
      dto.tradeUnitId ?? user.tradeUnitId,
    );

    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          fullName: dto.fullName?.trim(),
          email: dto.email?.trim().toLowerCase(),
          role,
          userType:
            role === Role.REPORTER
              ? dto.userType !== undefined
                ? dto.userType.trim() || null
                : user.userType
              : null,
          tradeUnitId,
          isActive: dto.isActive,
        },
        select: userSelect,
      });
    } catch (e) {
      this.rethrow(e);
    }
  }

  async resetPassword(id: string, dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) },
    });
    return { ok: true };
  }
}