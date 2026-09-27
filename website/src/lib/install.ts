import { REPOSITORY_URL } from './links';

export const CLONE_COMMAND = `git clone ${REPOSITORY_URL}`;

export const INSTALL_COMMANDS = [
  CLONE_COMMAND,
  'cd amaleh',
  'bun amaleh/scripts/run.ts doctor',
  'bun amaleh/scripts/run.ts install',
].join('\n');
