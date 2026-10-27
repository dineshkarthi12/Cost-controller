import type { Request } from 'express';
import { prisma, type Db } from '../lib/prisma.js';
import { forbidden, notFound } from '../lib/errors.js';

export interface AuthUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
}

/** Everything the API needs to authorise a request. Built once per request. */
export interface AccessContext {
  user: AuthUser;
  orgId: string;
  sessionId: string;
  orgRoleCodes: string[];
  orgPermissions: Set<string>;
  projectRoleCodes: Map<string, string[]>;
  projectPermissions: Map<string, Set<string>>;
  memberProjectIds: Set<string>;
  allProjects: boolean;
  ip?: string;
  userAgent?: string;
}

export async function loadAccessContext(userId: string, sessionId: string, req?: Request): Promise<AccessContext> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      orgId: true,
      email: true,
      name: true,
      roles: { select: { projectId: true, role: { select: { code: true, permissions: { select: { permissionCode: true } } } } } },
      memberships: { where: { isActive: true }, select: { projectId: true } },
    },
  });
  if (!user) throw notFound('User');
  const orgPermissions = new Set<string>();
  const orgRoleCodes: string[] = [];
  const projectPermissions = new Map<string, Set<string>>();
  const projectRoleCodes = new Map<string, string[]>();
  for (const ur of user.roles) {
    const perms = ur.role.permissions.map((p) => p.permissionCode);
    if (ur.projectId) {
      const set = projectPermissions.get(ur.projectId) ?? new Set<string>();
      perms.forEach((p) => set.add(p));
      projectPermissions.set(ur.projectId, set);
      projectRoleCodes.set(ur.projectId, [...(projectRoleCodes.get(ur.projectId) ?? []), ur.role.code]);
    } else {
      perms.forEach((p) => orgPermissions.add(p));
      orgRoleCodes.push(ur.role.code);
    }
  }
  return {
    user: { id: user.id, orgId: user.orgId, email: user.email, name: user.name },
    orgId: user.orgId,
    sessionId,
    orgRoleCodes,
    orgPermissions,
    projectRoleCodes,
    projectPermissions,
    memberProjectIds: new Set([...user.memberships.map((m) => m.projectId), ...projectPermissions.keys()]),
    allProjects: orgPermissions.has('project.all'),
    ip: req?.ip,
    userAgent: req?.get('user-agent') ?? undefined,
  };
}

export function can(ctx: AccessContext, permission: string, projectId?: string | null): boolean {
  if (ctx.orgPermissions.has(permission)) return true;
  if (projectId) return ctx.projectPermissions.get(projectId)?.has(permission) ?? false;
  return false;
}

export function permissionsFor(ctx: AccessContext, projectId?: string | null): string[] {
  const set = new Set(ctx.orgPermissions);
  if (projectId) ctx.projectPermissions.get(projectId)?.forEach((p) => set.add(p));
  return [...set].sort();
}

export function roleCodesFor(ctx: AccessContext, projectId?: string | null): string[] {
  return [...new Set([...ctx.orgRoleCodes, ...(projectId ? (ctx.projectRoleCodes.get(projectId) ?? []) : [])])];
}

export function canAccessProject(ctx: AccessContext, projectId: string): boolean {
  return ctx.allProjects || ctx.memberProjectIds.has(projectId);
}

export function assertCan(ctx: AccessContext, permission: string, projectId?: string | null) {
  if (!can(ctx, permission, projectId)) throw forbidden(`Missing permission: ${permission}`);
}

/** Verifies project exists in the user's organisation and the user may access it. */
export async function assertProjectAccess(db: Db, ctx: AccessContext, projectId: string) {
  const project = await db.project.findFirst({ where: { id: projectId, orgId: ctx.orgId } });
  if (!project || !canAccessProject(ctx, projectId)) throw notFound('Project');
  return project;
}

/** Project ids visible to the user (for cross-project queries). */
export async function accessibleProjectIds(db: Db, ctx: AccessContext): Promise<string[]> {
  if (ctx.allProjects) return (await db.project.findMany({ where: { orgId: ctx.orgId }, select: { id: true } })).map((p) => p.id);
  const ids = [...ctx.memberProjectIds];
  return (await db.project.findMany({ where: { orgId: ctx.orgId, id: { in: ids } }, select: { id: true } })).map((p) => p.id);
}

/** Users (ids) holding a role code for a project — org-wide holders who can access the project, plus project-scoped holders. */
export async function usersWithRole(db: Db, orgId: string, projectId: string, roleCode: string): Promise<string[]> {
  const rows = await db.userRole.findMany({
    where: { role: { orgId, code: roleCode }, OR: [{ projectId }, { projectId: null }], user: { status: 'ACTIVE' } },
    select: { userId: true, projectId: true, user: { select: { memberships: { where: { projectId, isActive: true }, select: { id: true } }, roles: { select: { role: { select: { permissions: { where: { permissionCode: 'project.all' }, select: { permissionCode: true } } } } } } } } },
  });
  return [
    ...new Set(
      rows
        .filter((r) => r.projectId === projectId || r.user.memberships.length > 0 || r.user.roles.some((x) => x.role.permissions.length > 0))
        .map((r) => r.userId),
    ),
  ];
}
