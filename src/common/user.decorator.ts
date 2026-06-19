import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User as PrismaUser } from 'src/prisma/generated/client';

export const User = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): PrismaUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

export type IUser = PrismaUser;
