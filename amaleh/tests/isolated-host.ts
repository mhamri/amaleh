import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const isolatedHost=mkdtempSync(join(tmpdir(),'amaleh-test-host-'));
const emptyHostHome=join(isolatedHost,'home');
mkdirSync(emptyHostHome);
process.env.CODEX_HOME=emptyHostHome;
process.env.CLAUDE_CONFIG_DIR=emptyHostHome;

const gitConfig=join(isolatedHost,'gitconfig');
writeFileSync(gitConfig,'[user]\n\tname = Amaleh test\n\temail = test@amaleh.invalid\n');
process.env.GIT_CONFIG_GLOBAL=gitConfig;
process.env.GIT_CONFIG_NOSYSTEM='1';

process.on('exit',()=>rmSync(isolatedHost,{recursive:true,force:true}));
