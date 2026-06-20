import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { IUser } from 'src/common/user.decorator';
import { PrismaService } from 'src/modules/prisma/prisma.service';
import { jwtVerify, SignJWT } from 'jose';
import { OrchestratorConfig } from 'src/config';
import { Dto_Workspace_Vnc_CreateToken } from '@limespaces/shared';
import { WebSocket } from 'ws';

@Injectable()
export class VncService {
  constructor(private readonly prismaService: PrismaService) {}

  async createToken(
    user: IUser,
    workspaceId: string,
  ): Promise<Dto_Workspace_Vnc_CreateToken> {
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
        user: true,
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const token = await new SignJWT({
      workspaceId: workspace.id,
      userId: user.id,
      host: `${workspaceId}.workspace.limespaces.local`,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('urn:limespaces:orchestrator:vnc')
      .setAudience('urn:limespaces:orchestrator:vnc:ws')
      .setExpirationTime('30s')
      .sign(new TextEncoder().encode(OrchestratorConfig.jwt.vnc.secret));

    return new Dto_Workspace_Vnc_CreateToken({
      token: token,
    });
  }

  async vncProxy(token: string, ws: WebSocket) {
    if (!token || typeof token != 'string' || token.trim().length < 1)
      throw new UnauthorizedException('Invalid token');

    const { payload } = await jwtVerify<{
      userId: string;
      workspaceId: string;
      host: string;
    }>(token, new TextEncoder().encode(OrchestratorConfig.jwt.vnc.secret), {
      issuer: 'urn:limespaces:orchestrator:vnc',
      audience: 'urn:limespaces:orchestrator:vnc:ws',
    }).catch(() => {
      throw new UnauthorizedException('Invalid token');
    });

    if (!payload.workspaceId || !payload.userId || !payload.host)
      throw new UnauthorizedException('Invalid token payload');

    const workspace = await this.prismaService.workspace.findUnique({
      where: {
        id: payload.workspaceId,
        user: {
          id: payload.userId,
        },
      },
      include: {
        user: true,
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const targetWs = new WebSocket(`ws://limespaces-platform-traefik:80`, {
      headers: {
        host: `${workspace.id}.workspace.limespaces.local`,
      },
    });

    ws.on('message', (data, isBinary) => {
      if (targetWs.readyState === WebSocket.OPEN)
        targetWs.send(data, { binary: isBinary });
    });

    targetWs.on('message', (data, isBinary) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: isBinary });
    });

    ws.on('close', () => targetWs.close());
    targetWs.on('close', () => ws.close());

    ws.on('error', (err) => targetWs.close());
    targetWs.on('error', (err) => ws.close());
  }
}
