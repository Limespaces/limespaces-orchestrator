import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  WorkspaceCreateRequestDto,
  WorkspaceResponseDto,
} from '@limespaces/shared';
import { IUser } from 'src/common/user.decorator';
import { randomUUID } from 'crypto';
import { WorkspaceContainerState } from 'src/prisma/generated/enums';

@Injectable()
export class WorkspaceService {
  constructor(private readonly prismaService: PrismaService) {}

  async getAll(user: IUser): Promise<WorkspaceResponseDto[]> {
    if (!user || !user.id)
      throw new InternalServerErrorException('ASSERT: No user/user id');

    const workspaces = await this.prismaService.workspace.findMany({
      where: {
        user: {
          id: user.id,
        },
      },
    });

    return workspaces.map((workspace) => new WorkspaceResponseDto(workspace));
  }

  async create(
    user: IUser,
    data: WorkspaceCreateRequestDto,
  ): Promise<WorkspaceResponseDto> {
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

    // TODO: Queue docker container creation

    return new WorkspaceResponseDto(workspace);
  }
}
