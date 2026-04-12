import type { DualRoleUser } from '../stores/authStore';

export function isDualRole(user: DualRoleUser): boolean {
  return user.has_player_access && user.has_responsible_access;
}

export function canPlay(user: DualRoleUser): boolean {
  return user.has_player_access;
}

export function canMonitor(user: DualRoleUser): boolean {
  return user.has_responsible_access;
}

export function isAdmin(user: DualRoleUser): boolean {
  return user.is_admin;
}

export function getActiveRoles(user: DualRoleUser): ('player' | 'responsible')[] {
  const roles: ('player' | 'responsible')[] = [];
  if (user.has_player_access) roles.push('player');
  if (user.has_responsible_access) roles.push('responsible');
  return roles;
}
