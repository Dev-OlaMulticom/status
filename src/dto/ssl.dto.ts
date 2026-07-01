export interface SslInfo {
  valid: boolean;
  expiresAt: string | null;
  daysRemaining: number | null;
  issuer: string | null;
}
