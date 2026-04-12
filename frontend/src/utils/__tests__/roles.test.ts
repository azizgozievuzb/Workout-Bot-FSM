import { describe, it, expect } from 'vitest';
import { isDualRole, canPlay, canMonitor, isAdmin, getActiveRoles } from '../roles';
import type { DualRoleUser } from '../../stores/authStore';

// ─── Mock users ────────────────────────────────────────────────────
const playerOnly: DualRoleUser = {
  primary_role: 'player',
  has_player_access: true,
  has_responsible_access: false,
  is_admin: false,
};

const responsibleOnly: DualRoleUser = {
  primary_role: 'responsible',
  has_player_access: false,
  has_responsible_access: true,
  is_admin: false,
};

const dualRole: DualRoleUser = {
  primary_role: 'player',
  has_player_access: true,
  has_responsible_access: true,
  is_admin: false,
};

const adminUser: DualRoleUser = {
  primary_role: 'responsible',
  has_player_access: true,
  has_responsible_access: true,
  is_admin: true,
};

// ─── isDualRole ────────────────────────────────────────────────────
describe('isDualRole', () => {
  it('returns false for player-only', () => {
    expect(isDualRole(playerOnly)).toBe(false);
  });
  it('returns false for responsible-only', () => {
    expect(isDualRole(responsibleOnly)).toBe(false);
  });
  it('returns true for dual-role user', () => {
    expect(isDualRole(dualRole)).toBe(true);
  });
  it('returns true for admin with both accesses', () => {
    expect(isDualRole(adminUser)).toBe(true);
  });
});

// ─── canPlay ───────────────────────────────────────────────────────
describe('canPlay', () => {
  it('true for player', () => {
    expect(canPlay(playerOnly)).toBe(true);
  });
  it('false for responsible-only', () => {
    expect(canPlay(responsibleOnly)).toBe(false);
  });
  it('true for dual-role', () => {
    expect(canPlay(dualRole)).toBe(true);
  });
});

// ─── canMonitor ────────────────────────────────────────────────────
describe('canMonitor', () => {
  it('false for player-only', () => {
    expect(canMonitor(playerOnly)).toBe(false);
  });
  it('true for responsible', () => {
    expect(canMonitor(responsibleOnly)).toBe(true);
  });
  it('true for dual-role', () => {
    expect(canMonitor(dualRole)).toBe(true);
  });
});

// ─── isAdmin ───────────────────────────────────────────────────────
describe('isAdmin', () => {
  it('false for regular player', () => {
    expect(isAdmin(playerOnly)).toBe(false);
  });
  it('false for regular responsible', () => {
    expect(isAdmin(responsibleOnly)).toBe(false);
  });
  it('true for admin', () => {
    expect(isAdmin(adminUser)).toBe(true);
  });
});

// ─── getActiveRoles ────────────────────────────────────────────────
describe('getActiveRoles', () => {
  it('returns ["player"] for player-only', () => {
    expect(getActiveRoles(playerOnly)).toEqual(['player']);
  });
  it('returns ["responsible"] for responsible-only', () => {
    expect(getActiveRoles(responsibleOnly)).toEqual(['responsible']);
  });
  it('returns both for dual-role', () => {
    expect(getActiveRoles(dualRole)).toEqual(['player', 'responsible']);
  });
  it('returns both for admin', () => {
    expect(getActiveRoles(adminUser)).toEqual(['player', 'responsible']);
  });
});
