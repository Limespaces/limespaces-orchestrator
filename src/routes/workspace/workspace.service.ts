import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/modules/prisma/prisma.service';
import {
  Dto_Workspace_Create,
  Dto_Workspace_Get,
  Dto_Workspace_GetAll,
  WorkspaceCreateRequestDto,
} from '@limespaces/shared';
import { IUser } from 'src/common/user.decorator';
import { randomUUID } from 'crypto';
import { WorkspaceContainerState } from 'src/modules/prisma/generated/enums';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
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

  async get(user: IUser, workspaceId: string): Promise<Dto_Workspace_Get> {
    if (!workspaceId)
      throw new InternalServerErrorException('ASSERT: No workspace id');
    if (!user || !user.id)
      throw new InternalServerErrorException('ASSERT: No user');

    const workspace = await this.prismaService.workspace.findUnique({
      where: {
        id: workspaceId,
        user: {
          id: user.id,
        },
      },
      include: {
        workspaceContainer: true,
        user: true,
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    return new Dto_Workspace_Get(workspace);
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

  async power(user: IUser, workspaceId: string, action: 'start' | 'stop') {
    if (!workspaceId)
      throw new InternalServerErrorException('ASSERT: No workspace ID');
    if (!user || !user.id)
      throw new InternalServerErrorException('ASSERT: No user');

    const workspace = await this.prismaService.workspace.findUnique({
      where: {
        id: workspaceId,
        user: {
          id: user.id,
        },
      },
      include: {
        workspaceContainer: true,
        user: true,
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (
      !workspace.workspaceContainer ||
      !workspace.workspaceContainer.dockerContainerId
    )
      throw new BadRequestException('Container not found');

    if (
      (action == 'start' &&
        workspace.workspaceContainer.state !=
          WorkspaceContainerState.Stopped) ||
      (action == 'stop' &&
        workspace.workspaceContainer.state != WorkspaceContainerState.Running)
    )
      throw new BadRequestException(
        'This power action cannot be run when container is in its current state',
      );

    await this.prismaService.workspaceContainer.update({
      data: {
        state: {
          start: WorkspaceContainerState.Starting,
          stop: WorkspaceContainerState.Stopping,
        }[action],
      },
      where: {
        id: workspace.workspaceContainer.id,
      },
    });

    // TODO: Maybe add into bullmq?
    const status = await this.dockerService[
      {
        start: 'startContainer',
        stop: 'stopContainer',
      }[action]
    ](workspace.workspaceContainer.dockerContainerId);

    await this.prismaService.workspaceContainer.update({
      data: {
        state: status,
      },
      where: {
        id: workspace.workspaceContainer.id,
      },
    });

    return {};
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
