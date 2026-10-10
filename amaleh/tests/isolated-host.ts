import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const emptyHostHome=mkdtempSync(join(tmpdir(),'amaleh-test-host-'));
process.env.CODEX_HOME=emptyHostHome;
process.env.CLAUDE_CONFIG_DIR=emptyHostHome;
process.on('exit',()=>rmSync(emptyHostHome,{recursive:true,force:true}));
