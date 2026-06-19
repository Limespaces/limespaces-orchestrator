import {
  Controller,
  Get,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from 'src/common/auth/jwt-auth.guard';
import type { Request } from 'express';
import { CheckAuthResponseDto } from '@limespaces/shared';

@Controller('/users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('/check-auth')
  async getMe(@Req() req: Request) {
    if (!req.user || !(req.user as any).userId)
      throw new UnauthorizedException('JWT is valid, but user is missing');

    return new CheckAuthResponseDto({ authorized: true });
  }
}
