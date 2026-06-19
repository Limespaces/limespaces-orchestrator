export const OrchestratorConfig = {
  corsAllowedOrigins: (process.env.CORS_ORIGINS ?? process.env.DASHBOARD_ORIGIN ?? '').split(','),
  oidc: {
    audience: process.env.OIDC_AUDIENCE ?? '',
    issuer: process.env.OIDC_ISSUER ?? '',
    jwksUrl: process.env.OIDC_JWKS ?? '',
    requiredRealmRole: process.env.OIDC_REQUIRED_REALM_ROLE ?? '',
    requiredClientRole: process.env.OIDC_REQUIRED_CLIENT_ROLE ?? '',
    clientId: process.env.OIDC_CLIENT_ID ?? 'limespaces-dashboard-devel',
  },
};
