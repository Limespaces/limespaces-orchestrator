import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { Dto_Workspace_Create, Dto_Workspace_GetAll, WorkspaceCreateRequestDto } from '@limespaces/shared';
import { JwtAuthGuard } from 'src/common/auth/jwt-auth.guard';
import { type IUser, User } from 'src/common/user.decorator';

@Controller('/workspace')
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get()
  async getAll(@User() user: IUser): Promise<Dto_Workspace_GetAll[]> {
    return await this.workspaceService.getAll(user);
  }

  @Post()
  async create(
    @User() user: IUser,
    @Body() body: WorkspaceCreateRequestDto,
  ): Promise<Dto_Workspace_Create> {
    return await this.workspaceService.create(user, body);
  }
}
