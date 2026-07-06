import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@crm/types';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Declares the permission(s) a route requires. The PermissionsGuard enforces
 * that the current user's role grants ALL listed permissions (least privilege).
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
