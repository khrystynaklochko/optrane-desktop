import { admin } from './db.ts';
import { HttpError } from './http.ts';

export type AuthContext = { userId: string; token: string; email?: string };

export async function requireUser(req: Request): Promise<AuthContext> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new HttpError(401, 'Authentication required', 'auth_required');
  const token = match[1];
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Invalid or expired session', 'invalid_session');
  return { userId: data.user.id, token, email: data.user.email?.toLowerCase() };
}

export async function requireMember(userId: string, productionId: string, manage = false) {
  const { data, error } = await admin()
    .from('production_members')
    .select('role')
    .eq('production_id', productionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`membership query: ${error.message}`);
  if (!data) throw new HttpError(404, 'Production not found', 'production_not_found');
  if (manage && !['OWNER', 'PRODUCER'].includes(data.role)) {
    throw new HttpError(403, 'Producer permission required', 'producer_permission_required');
  }
  return data.role as 'OWNER' | 'PRODUCER' | 'VIEWER';
}
