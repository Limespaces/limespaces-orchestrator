import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { VncService } from './vnc.service';
import { type IUser, User } from 'src/common/user.decorator';
import { Dto_Workspace_Vnc_CreateToken } from '@limespaces/shared';
import { JwtAuthGuard } from 'src/common/auth/jwt-auth.guard';

@Controller('/workspace/:workspaceId/vnc')
@UseGuards(JwtAuthGuard)
export class VncController {
  constructor(private readonly vncService: VncService) {}

  @Post('token')
  async createToken(
    @User() user: IUser,
    @Param('workspaceId') workspaceId: string,
  ): Promise<Dto_Workspace_Vnc_CreateToken> {
    return await this.vncService.createToken(user, workspaceId);
  }
}
