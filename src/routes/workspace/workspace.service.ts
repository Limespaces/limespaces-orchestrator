import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from 'src/modules/prisma/prisma.service';
import {
  Dto_Workspace_Create,
  Dto_Workspace_Get,
  Dto_Workspace_GetAll,
  EWorkspaceContainerState,
  WorkspaceCreateRequestDto,
} from '@limespaces/shared';
import { IUser } from 'src/common/user.decorator';
import { randomUUID } from 'crypto';
import { WorkspaceContainerState } from 'src/modules/prisma/generated/enums';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DockerService } from 'src/modules/docker/docker.service';
import { Observable } from 'rxjs';
import { EventsService } from 'src/modules/events/events.service';

@Injectable()
export class WorkspaceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly dockerService: DockerService,
    @InjectQueue('workspace')
    private readonly workspaceQueue: Queue,
    private readonly eventsService: EventsService,
  ) {}

  async onApplicationBootstrap() {
    await this.ensureRunningContainerNetworking();
  }

  // --- bootstrap ---
  /**
   * This ensures that traefik is connected to all of the running containers' network.
   * This is to fix one specific case -- backend restarts while there are still running containers.
   * Other cases are handled when container is starting.
   */
  async ensureRunningContainerNetworking() {
    const containers = await this.dockerService.findAllWorkspaceContainers();
    const runningIds = containers
      .filter((c) => c.state.Running)
      .map((c) => c.id);

    for (const id of runningIds) {
      if (!id) continue;

      const workspaceContainer =
        await this.prismaService.workspaceContainer.findFirst({
          where: {
            dockerContainerId: id,
          },
          include: {
            workspace: true,
          },
        });

      // TODO: Should probably delete the container -- orphan
      if (!workspaceContainer) continue;

      const fullContainerName = this.dockerService.localToFullName(
        'workspace',
        workspaceContainer.workspace.id,
      );
      const networkName = `${fullContainerName}-net`;
      const fullTraefikName = this.dockerService.localToFullName(
        'platform',
        'traefik',
      );

      await this.dockerService.joinNetwork(fullTraefikName, networkName);
    }
  }

  // --- rest api ---
  async getAll(user: IUser): Promise<Dto_Workspace_GetAll[]> {
    if (!user || !user.id)
      throw new InternalServerErrorException('ASSERT: No user');

    const workspaces = await this.prismaService.workspace.findMany({
      where: {
        user: {
          id: user.id,
        },
      },
      include: {
        user: true,
      },
    });

    return workspaces.map((workspace) => new Dto_Workspace_GetAll(workspace));
  }

  async get(user: IUser, workspaceId: string): Promise<Dto_Workspace_Get> {
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
        user: true,
        workspaceContainer: true,
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    let state: string = 'unknown';
    if (workspace.workspaceContainer?.dockerContainerId)
      state =
        (await this.dockerService.getContainerState(
          workspace.workspaceContainer.dockerContainerId,
        )) ?? 'unknown';

    return new Dto_Workspace_Get({
      ...workspace,
      workspaceContainer: {
        ...workspace.workspaceContainer!,
        state: workspace.workspaceContainer?.state as EWorkspaceContainerState,
      },
      dockerContainerState: state,
    });
  }

  async create(
    user: IUser,
    data: WorkspaceCreateRequestDto,
  ): Promise<Dto_Workspace_Create> {
    if (!user || !user.id)
      throw new InternalServerErrorException('ASSERT: No user');

    const id = randomUUID();
    const workspace = await this.prismaService.workspace.create({
      data: {
        id: id,
        name: data.name,
        userId: user.id,
      },
    });

    await this.prismaService.workspaceContainer.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        state: WorkspaceContainerState.WaitingForCreation,
      },
    });

    this.workspaceQueue.add('workspace:container:create', workspace.id);

    return new Dto_Workspace_Create(workspace);
  }

  async power(user: IUser, workspaceId: string, action: 'start' | 'stop') {
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
        user: true,
        workspaceContainer: true,
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    if (action == 'start')
      this.workspaceQueue.add('workspace:container:start', workspace.id);
    else if (action == 'stop')
      this.workspaceQueue.add('workspace:container:stop', workspace.id);
    else throw new BadRequestException('Invalid action');

    return {};
  }

  // --- sse ---
  async events(
    user: IUser,
    workspaceId: string,
  ): Promise<Observable<MessageEvent>> {
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
        user: true,
        workspaceContainer: true,
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const channel = `users:${workspace.user.id}:workspaces:${workspace.id}`;
    const sseChannel = this.eventsService.createSseChannel(channel);

    return sseChannel;
  }

  // --- jobs ---
  async $workspaceContainerCreate(workspaceId: string) {
    const workspace = await this._getWorkspaceById(workspaceId);

    await this._setWorkspaceContainerState(
      workspace.workspaceContainer.id,
      WorkspaceContainerState.Creating,
    );

    const eventsChannel = this.eventsService.getChannel(
      workspace.user.id,
      'workspace',
      workspace.id,
    );

    try {
      const container = await this.dockerService.createWorkspaceContainer(
        workspace.id,
        'fedora42-gnome:latest',
      );

      await this._setWorkspaceContainerState(
        workspace.workspaceContainer.id,
        WorkspaceContainerState.Created,
      );

      await this.prismaService.workspaceContainer.update({
        where: {
          id: workspace.workspaceContainer.id,
        },
        data: {
          dockerContainerId: container.id,
        },
      });

      await this.eventsService.emit(eventsChannel, 'workspaceUpdate', {});
    } catch (e) {
      // TODO: Should probably replace with error state
      await this._setWorkspaceContainerState(
        workspace.workspaceContainer.id,
        'WaitingForCreation',
      );

      await this.eventsService.emit(eventsChannel, 'workspaceUpdate', {});

      throw e;
    }
  }

  async $workspaceContainerStart(workspaceId: string) {
    const workspace = await this._getWorkspaceById(workspaceId);
    if (
      !workspace.workspaceContainer.dockerContainerId ||
      workspace.workspaceContainer.state != WorkspaceContainerState.Created
    )
      throw new BadRequestException('Container not ready yet.');

    // Ensure that traefik is connected to the containers network
    await this.dockerService.ensureTraefikOnWorkspaceNetwork(workspace.id);

    const containerState = await this.dockerService.getContainerState(
      workspace.workspaceContainer.dockerContainerId,
    );
    if (['running', 'starting', 'stopping'].includes(containerState ?? ''))
      throw new BadRequestException('Container is already running');

    await this.dockerService.startContainer(
      workspace.workspaceContainer.dockerContainerId,
    );

    const eventsChannel = this.eventsService.getChannel(
      workspace.user.id,
      'workspace',
      workspace.id,
    );
    await this.eventsService.emit(eventsChannel, 'workspaceUpdate', {});
  }

  async $workspaceContainerStop(workspaceId: string) {
    const workspace = await this._getWorkspaceById(workspaceId);
    if (
      !workspace.workspaceContainer.dockerContainerId ||
      workspace.workspaceContainer.state != WorkspaceContainerState.Created
    )
      throw new BadRequestException('Container not ready yet.');

    // TODO: It would maybe be polite to announce it inside of the container

    const containerState = await this.dockerService.getContainerState(
      workspace.workspaceContainer.dockerContainerId,
    );
    if (!['running', 'starting', 'dead'].includes(containerState ?? ''))
      throw new BadRequestException('Container is not running');

    await this.dockerService.stopContainer(
      workspace.workspaceContainer.dockerContainerId,
    );

    const eventsChannel = this.eventsService.getChannel(
      workspace.user.id,
      'workspace',
      workspace.id,
    );
    await this.eventsService.emit(eventsChannel, 'workspaceUpdate', {});
  }

  // --- internal ---
  private async _setWorkspaceContainerState(
    workspaceContainerId: string,
    state: WorkspaceContainerState,
  ) {
    await this.prismaService.workspaceContainer.update({
      where: {
        id: workspaceContainerId,
      },
      data: {
        state: state,
      },
    });
  }

  private async _getWorkspaceById(workspaceId: string) {
    if (!workspaceId) throw new Error('ASSERT: No workspace');

    const workspace = await this.prismaService.workspace.findUnique({
      where: {
        id: workspaceId,
      },
      include: {
        workspaceContainer: true,
        user: true,
      },
    });
    if (!workspace || !workspace.workspaceContainer)
      throw new Error('Workspace not found');

    return {
      ...workspace,
      workspaceContainer: workspace.workspaceContainer!,
    };
  }
}
