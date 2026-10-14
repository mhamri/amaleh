import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {elapsedMs,namesWorkspace,parsePsListing,parseWindowsListing,stopStrays,strayProcesses,type ProcessRow} from '../scripts/strays.ts';

const since=Date.parse('2026-10-04T16:00:00.000Z');
const row=(pid:number,parent:number,command:string,started=since+1000):ProcessRow=>({pid,parent,started,command});
const workspace='C:\\w\\counteasy\\.amaleh\\worktrees\\dashboard';
const amalehScripts=join(dirname(fileURLToPath(import.meta.url)),'..','scripts');

test('a command names the workspace only at a path boundary',()=>{
 assert.ok(namesWorkspace('"C:\\flutter\\bin\\cache\\flutter_tester.exe" C:\\w\\counteasy\\.amaleh\\worktrees\\dashboard\\build\\test.dill',workspace,'win32'));
 assert.ok(namesWorkspace('flutter_tester --packages=c:/w/counteasy/.amaleh/worktrees/dashboard',workspace,'win32'),'case and slashes are ignored on Windows');
 assert.ok(!namesWorkspace('flutter_tester C:\\w\\counteasy\\.amaleh\\worktrees\\dashboard-filters\\a.dill',workspace,'win32'),'a sibling folder with a longer name is another workspace');
 assert.ok(!namesWorkspace('flutter_tester C:\\w\\counteasy\\.amaleh\\worktrees\\filters\\a.dill','C:\\w\\counteasy','win32'),'a task worktree under .amaleh is not the main checkout');
 assert.ok(!namesWorkspace('flutter_tester /W/Counteasy/a.dill','/w/counteasy','linux'),'case counts on POSIX');
});

test('only orphans that started during the call and name the workspace are strays',()=>{
 const tester=`flutter_tester ${workspace}\\build\\test.dill`;
 const rows=[
  row(10,1234,`node pi.js --session-dir x`),
  row(11,999,tester),
  row(12,11,`${tester} --child`),
  row(13,10,tester),
  row(14,4321,tester),
  row(4321,1,'pwsh -NoProfile'),
  row(15,999,tester,since-1000),
  row(16,999,'flutter_tester C:\\w\\other\\a.dill'),
  row(17,999,`bun ${join(amalehScripts,'run.ts')} delegate ${workspace}`),
 ];
 const strays=strayProcesses(rows,{workspace,since,callPid:10,platform:'win32'}).map(r=>r.pid).sort();
 assert.deepEqual(strays,[11,12,13]);
});

test('Windows and ps listings parse into rows',()=>{
 assert.deepEqual(parseWindowsListing(JSON.stringify({pid:5,parent:4,started:'2026-10-04T16:00:01.0000000Z',command:'a b'})),[{pid:5,parent:4,started:Date.parse('2026-10-04T16:00:01Z'),command:'a b'}]);
 assert.deepEqual(parseWindowsListing(JSON.stringify([{pid:6,parent:0,started:'',command:'x'},{pid:7,parent:1,started:'2026-10-04T16:00:01Z',command:null}])),[],'rows without a start time or a command line are skipped');
 assert.equal(elapsedMs('1-02:03:04'),((26*60+3)*60+4)*1000);
 assert.equal(elapsedMs('03:04'),(3*60+4)*1000);
 assert.equal(elapsedMs('bad'),undefined);
 assert.deepEqual(parsePsListing('  42     1    00:05 /usr/bin/flutter_tester /w/a\n',100000),[{pid:42,parent:1,started:95000,command:'/usr/bin/flutter_tester /w/a'}]);
});

test('a process left behind by an exited parent is stopped',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'amaleh-strays-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const since=Date.now()-1000;
 const pidFile=join(dir,'orphan.pid');
 const orphan=`setInterval(()=>{},1000);require('node:fs').writeFileSync(process.argv[1],String(process.pid));`;
 const parent="require('node:child_process').spawn(process.execPath,['-e',...process.argv.slice(1)],{detached:true,stdio:'ignore',windowsHide:true}).unref();";
 const call=spawn(process.execPath,['-e',parent,orphan,pidFile,dir],{stdio:'ignore',windowsHide:true});
 await new Promise(done=>call.on('close',done));
 let pid=0;
 for(let i=0;i<100&&!pid;i++){pid=Number(await readFile(pidFile,'utf8').catch(()=>''));if(!pid)await new Promise(r=>setTimeout(r,100));}
 assert.ok(pid,'the orphan started');
 t.after(()=>{try{process.kill(pid,'SIGKILL');}catch{}});
 const stopped=await stopStrays({workspace:dir,since,callPid:call.pid});
 assert.deepEqual(stopped.map(s=>s.pid),[pid]);
 let alive=true;
 for(let i=0;i<50&&alive;i++){try{process.kill(pid,0);await new Promise(r=>setTimeout(r,100));}catch{alive=false;}}
 assert.equal(alive,false);
});
