import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from 'src/modules/prisma/prisma.service';
import {
  Dto_Workspace_Create,
  Dto_Workspace_GetAll,
  WorkspaceCreateRequestDto,
} from '@limespaces/shared';
import { IUser } from 'src/common/user.decorator';
import { randomUUID } from 'crypto';
import { WorkspaceContainerState } from 'src/modules/prisma/generated/enums';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Workspace } from 'src/modules/prisma/generated/client';
import { DockerService } from 'src/modules/docker/docker.service';

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly dockerService: DockerService,
    @InjectQueue('workspace')
    private readonly workspaceQueue: Queue,
  ) {}

  async getAll(user: IUser): Promise<Dto_Workspace_GetAll[]> {
    if (!user || !user.id)
      throw new InternalServerErrorException('ASSERT: No user/user id');

    const workspaces = await this.prismaService.workspace.findMany({
      where: {
        user: {
          id: user.id,
        },
      },
      include: {
        workspaceContainer: true,
      },
    });

    return workspaces.map((workspace) => new Dto_Workspace_GetAll(workspace));
  }

  async create(
    user: IUser,
    data: WorkspaceCreateRequestDto,
  ): Promise<Dto_Workspace_Create> {
    if (!user || !user.id)
      throw new InternalServerErrorException('ASSERT: No user/user id');

    const workspace = await this.prismaService.workspace.create({
      data: {
        id: randomUUID(),
        name: data.name,
        userId: user.id,
      },
    });

    const workspaceContainer =
      await this.prismaService.workspaceContainer.create({
        data: {
          id: randomUUID(),
          state: WorkspaceContainerState.WaitingForCreation,
          workspaceId: workspace.id,
        },
      });

    this.workspaceQueue.add('createContainer', workspace.id);

    return new Dto_Workspace_Create(workspace);
  }

  async $createContainer(workspaceId: string) {
    if (!workspaceId) throw new Error('Workspace not found');

    const workspace = await this.prismaService.workspace.findUnique({
      where: {
        id: workspaceId,
      },
      include: {
        workspaceContainer: true,
        user: true,
      },
    });
    if (!workspace) throw new Error('Workspace not found');
    if (!workspace.workspaceContainer)
      throw new Error('Workspace container not found');

    await this.prismaService.workspaceContainer.update({
      data: {
        state: WorkspaceContainerState.Creating,
      },
      where: {
        id: workspace.workspaceContainer.id,
      },
    });

    const containerId = await this.dockerService.createWorkspaceContainer(
      workspace.id,
      'fedora42-gnome',
    );

    await this.prismaService.workspaceContainer.update({
      data: {
        state: WorkspaceContainerState.Stopped,
        dockerContainerId: containerId,
      },
      where: {
        id: workspace.workspaceContainer.id,
      },
    });
  }
}
