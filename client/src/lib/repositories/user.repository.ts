import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export class UserRepository {
  async findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
    });
  }

  async findManyByTenantId(tenantId: string) {
    return prisma.user.findMany({
      where: { tenantId },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async create(data: Prisma.UserCreateInput) {
    return prisma.user.create({
      data,
    });
  }

  async update(id: string, data: Prisma.UserUpdateInput) {
    return prisma.user.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return prisma.$transaction(async (tx) => {
      // Set assignedToId to null in tickets where this user was assigned
      await tx.ticket.updateMany({
        where: { assignedToId: id },
        data: { assignedToId: null },
      });

      // Delete the user permanently
      return tx.user.delete({
        where: { id },
      });
    });
  }
}
