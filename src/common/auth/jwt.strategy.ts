import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { OrchestratorConfig } from 'src/config';
import { UsersService } from 'src/routes/users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer: OrchestratorConfig.oidc.issuer,

      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: OrchestratorConfig.oidc.jwksUrl,
      }),
    });
  }

  async validate(payload: any) {
    const requiredRealmRole = OrchestratorConfig.oidc.requiredRealmRole;
    const requiredClientRole = OrchestratorConfig.oidc.requiredClientRole;
    const clientId = OrchestratorConfig.oidc.clientId;

    if (requiredRealmRole) {
      const realmRoles = payload.realm_access?.roles ?? [];

      if (!realmRoles.includes(requiredRealmRole))
        throw new UnauthorizedException(
          `User lacks required realm role: ${requiredRealmRole}`,
        );
    }

    if (requiredClientRole && clientId) {
      const clientRoles = payload.resource_access?.[clientId]?.roles ?? [];

      if (!clientRoles.includes(requiredClientRole))
        throw new UnauthorizedException(
          `User lacks required client role: ${requiredClientRole}`,
        );
    }

    const user = await this.usersService.ensureCreated(payload.sub);

    return user;
  }
}
