import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { User } from 'src/prisma/generated/client';

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  async ensureCreated(userId: string): Promise<User> {
    if (!userId) throw new BadRequestException('Invalid user ID');

    const user = await this.prismaService.user.findUnique({
      where: {
        id: userId,
      },
    });
    if (user) return user;

    return await this.prismaService.user.create({
      data: {
        id: userId,
      },
    });
  }
}
