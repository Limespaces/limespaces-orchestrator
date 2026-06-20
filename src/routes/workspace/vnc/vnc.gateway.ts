import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { VncService } from './vnc.service';
import { WebSocket } from 'ws';

@WebSocketGateway({
  path: '/api/v1/workspace-vnc',
})
export class VncGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(private readonly vncService: VncService) {}

  async handleConnection(client: WebSocket, request: IncomingMessage) {
    const query = new URLSearchParams((request.url ?? '').split('?')[1] ?? '');
    const token = query.get('token');

    await this.vncService
      .vncProxy(token ?? '', client)
      .catch(() => client.close());
  }

  handleDisconnect(client: any) {}
}
