import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';

export interface ISupervisorOkResponse<T> {
  isOk: true;
  data: T;
}

export interface ISupervisorErrorResponse {
  isOk: false;
  data: string;
}

export type ISupervisorResponse<T> =
  | ISupervisorOkResponse<T>
  | ISupervisorErrorResponse;

export enum ESupervisorVersion {
  v1 = '1',
}

@Injectable()
export class SupervisorService {
  // --- high level ---
  /**
   * Shows a zenity dialog inside of the workspace.
   * **Blocks await until button is pressed!** - Make sure this does
   * not block anything important (eg. shutdown sequence)
   * @param workspaceId
   * @param type
   * @param title
   * @param text
   */
  async showDialog(
    workspaceId: string,
    type: 'info' | 'warning' | 'error',
    title: string,
    text: string,
  ) {
    try {
      await this._runCommand(workspaceId, 'zenity', [
        `--${type}`,
        `--title=${title}`,
        `--text=${text}`,
      ]);
    } catch (e) {
      throw e;
    }
  }

  // --- low level ---
  // get /api/v1/health
  async _getHealth(workspaceId: string) {
    const result = await this._get<{
      status: 'ok' | 'error';
    }>(workspaceId, ESupervisorVersion.v1, 'health');

    if (!result.isOk) throw new InternalServerErrorException(result.data);
    return result.data;
  }

  // post /api/v1/command/run
  async _runCommand(workspaceId: string, command: string, args: string[]) {
    const result = await this._post<
      {},
      {
        command: string;
        args: string[];
      }
    >(workspaceId, ESupervisorVersion.v1, '/command/run', {
      command,
      args,
    });

    if (!result.isOk) throw new InternalServerErrorException(result.data);
    return result.data;
  }

  // --- internal ---
  private async _get<ResponseType>(
    workspaceId: string,
    version: ESupervisorVersion,
    path: string,
  ): Promise<ISupervisorResponse<ResponseType>> {
    return await this.request(workspaceId, 'get', version, path);
  }

  private async _post<ResponseType, BodyType>(
    workspaceId: string,
    version: ESupervisorVersion,
    path: string,
    body: BodyType,
  ): Promise<ISupervisorResponse<ResponseType>> {
    return await this.request(workspaceId, 'post', version, path, body);
  }

  private async _put<ResponseType, BodyType>(
    workspaceId: string,
    version: ESupervisorVersion,
    path: string,
    body: BodyType,
  ): Promise<ISupervisorResponse<ResponseType>> {
    return await this.request(workspaceId, 'put', version, path, body);
  }

  private async _patch<ResponseType, BodyType>(
    workspaceId: string,
    version: ESupervisorVersion,
    path: string,
    body: BodyType,
  ): Promise<ISupervisorResponse<ResponseType>> {
    return await this.request(workspaceId, 'patch', version, path, body);
  }

  private async _delete<ResponseType>(
    workspaceId: string,
    version: ESupervisorVersion,
    path: string,
  ): Promise<ISupervisorResponse<ResponseType>> {
    return await this.request(workspaceId, 'delete', version, path);
  }

  private async request<ResponseType, BodyType>(
    workspaceId: string,
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    version: string,
    path: string,
    body?: BodyType,
  ): Promise<ISupervisorResponse<ResponseType>> {
    const connector = axios.create({
      baseURL: 'http://limespaces-platform-traefik:80',
      headers: {
        Host: `supervisor.${workspaceId}.workspace.limespaces.local`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    const fullPath = `/api/v${version}${path.startsWith('/') ? '' : '/'}${path}`;

    const res = await (
      ['post', 'patch', 'put'].includes(method)
        ? connector[method as 'post' | 'patch' | 'put'](fullPath, body ?? {})
        : connector[method as 'get' | 'delete'](fullPath)
    ).catch((e) => ({ error: e.response }));

    if ('error' in res)
      return {
        isOk: false,
        data: res.error.data,
      };

    return {
      isOk: true,
      data: res.data,
    };
  }
}
