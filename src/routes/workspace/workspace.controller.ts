import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import {
  Dto_Workspace_Create,
  Dto_Workspace_Get,
  Dto_Workspace_GetAll,
  WorkspaceCreateRequestDto,
} from '@limespaces/shared';
import { JwtAuthGuard } from 'src/common/auth/jwt-auth.guard';
import { type IUser, User } from 'src/common/user.decorator';
import { Observable } from 'rxjs';

@Controller('/workspace')
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get()
  async getAll(@User() user: IUser): Promise<Dto_Workspace_GetAll[]> {
    return await this.workspaceService.getAll(user);
  }

  @Get('/:workspaceId')
  async get(
    @User() user: IUser,
    @Param('workspaceId') workspaceId: string,
  ): Promise<Dto_Workspace_Get> {
    return await this.workspaceService.get(user, workspaceId);
  }

  @Post()
  async create(
    @User() user: IUser,
    @Body() body: WorkspaceCreateRequestDto,
  ): Promise<Dto_Workspace_Create> {
    return await this.workspaceService.create(user, body);
  }

  @Post('/:workspaceId/power/start')
  async start(
    @User() user: IUser,
    @Param('workspaceId') workspaceId: string,
  ): Promise<{}> {
    return await this.workspaceService.power(user, workspaceId, 'start');
  }

  @Post('/:workspaceId/power/stop')
  async stop(
    @User() user: IUser,
    @Param('workspaceId') workspaceId: string,
  ): Promise<{}> {
    return await this.workspaceService.power(user, workspaceId, 'stop');
  }

  @Sse('/:workspaceId/events')
  async events(
    @User() user: IUser,
    @Param('workspaceId') workspaceId: string,
  ): Promise<Observable<MessageEvent>> {
    return await this.workspaceService.events(user, workspaceId);
  }

  @Post('/:workspaceId/supervisor')
  async testSupervisor(
    @User() user: IUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return await this.workspaceService.testSupervisor(workspaceId);
  }
}
