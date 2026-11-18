import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Resource, ROLE_PERMISSIONS, roleCan } from './permissions';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

/** Every resource/action pair used by a guard decorator anywhere in src/. */
function usedPermissions() {
  const used: Array<{
    file: string;
    resource: string;
    action: string;
    admin: boolean;
  }> = [];
  for (const file of sourceFiles(join(__dirname, '..'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/AdminAccess\('([a-z-]+)',\s*'([a-z]+)'\)/g)) {
      used.push({ file, resource: m[1], action: m[2], admin: true });
    }
    for (const m of src.matchAll(
      /resource:\s*'([a-z-]+)',\s*action:\s*'([a-z]+)'/g,
    )) {
      used.push({ file, resource: m[1], action: m[2], admin: false });
    }
  }
  return used;
}

describe('permissions', () => {
  const used = usedPermissions();

  it('finds the decorators (sanity check of this test)', () => {
    expect(used.filter((u) => u.admin).length).toBeGreaterThan(30);
  });

  it('every resource used in a decorator exists (catches typos like "appointment")', () => {
    const known = new Set<string>(Object.values(Resource));
    const unknown = used.filter((u) => !known.has(u.resource));
    expect(unknown).toEqual([]);
  });

  it('every non-admin @Permissions is grantable to at least one role', () => {
    const orphan = used.filter(
      (u) =>
        !u.admin &&
        !Object.keys(ROLE_PERMISSIONS).some((r) =>
          roleCan(r, u.resource, u.action),
        ),
    );
    expect(orphan).toEqual([]);
  });

  it('admins can do every admin action; patients and doctors cannot reach admin-only resources', () => {
    const adminOnly: string[] = [
      Resource.ADMIN_DASHBOARD,
      Resource.USERS,
      Resource.DOCTORS,
      Resource.ORDERS,
      Resource.AUDIT_LOGS,
      Resource.IMPERSONATION,
      Resource.SETTINGS,
    ];
    for (const u of used.filter((x) => x.admin)) {
      expect(roleCan('ADMIN', u.resource, u.action)).toBe(true);
      if (adminOnly.includes(u.resource)) {
        expect(roleCan('PATIENT', u.resource, u.action)).toBe(false);
        expect(roleCan('DOCTOR', u.resource, u.action)).toBe(false);
      }
    }
  });

  it('admin write actions on shared resources stay admin-only', () => {
    // These resources are readable by others, but the admin back office writes must not be.
    expect(roleCan('PATIENT', Resource.PRODUCTS, 'update')).toBe(false);
    expect(roleCan('DOCTOR', Resource.PRODUCTS, 'create')).toBe(false);
    expect(roleCan('PATIENT', Resource.APPOINTMENTS, 'update')).toBe(false);
  });
});
