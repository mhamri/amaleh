import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { withCheckLock, checkLockDir } from '../scripts/check-lock.ts';

async function amalehDir(t:any){const dir=await mkdtemp(join(tmpdir(),'amaleh-check-lock-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
function gate(){let open!:()=>void;const opened=new Promise<void>(r=>{open=r;});return {open,opened};}
const settle=()=>new Promise(r=>setTimeout(r,700));

test('an isolated check waits until every shared check has finished',async t=>{
 const dir=await amalehDir(t),order:string[]=[],shared=gate(),sharedStarted=gate();
 const first=withCheckLock(dir,'shared',async()=>{order.push('shared-start');sharedStarted.open();await shared.opened;order.push('shared-end');});
 await sharedStarted.opened;
 const alone=withCheckLock(dir,'exclusive',async()=>{order.push('isolated');});
 await settle();
 assert.deepEqual(order,['shared-start']);
 shared.open();await Promise.all([first,alone]);
 assert.deepEqual(order,['shared-start','shared-end','isolated']);
});

test('shared checks wait while an isolated check runs, and none start between',async t=>{
 const dir=await amalehDir(t),order:string[]=[],isolated=gate(),isolatedStarted=gate();
 const alone=withCheckLock(dir,'exclusive',async()=>{order.push('isolated-start');isolatedStarted.open();await isolated.opened;order.push('isolated-end');});
 await isolatedStarted.opened;
 const others=[1,2].map(n=>withCheckLock(dir,'shared',async()=>{order.push(`shared-${n}`);}));
 await settle();
 assert.deepEqual(order,['isolated-start']);
 isolated.open();await Promise.all([alone,...others]);
 assert.deepEqual(order.slice(0,2),['isolated-start','isolated-end']);
 assert.deepEqual(order.slice(2).sort(),['shared-1','shared-2']);
});

test('shared checks run together',async t=>{
 const dir=await amalehDir(t),running=new Set<number>();let most=0;
 await Promise.all([1,2,3].map(n=>withCheckLock(dir,'shared',async()=>{running.add(n);most=Math.max(most,running.size);await new Promise(r=>setTimeout(r,300));running.delete(n);})));
 assert.equal(most,3);
});

test('a holder left by a dead process does not block, and is cleared',async t=>{
 const dir=await amalehDir(t),lock=checkLockDir(dir);await mkdir(lock,{recursive:true});
 const stale='x-000000000000001-stale.json';
 await writeFile(join(lock,stale),JSON.stringify({pid:2147483647,host:hostname()}));
 let ran=false;await withCheckLock(dir,'shared',async()=>{ran=true;});
 assert.equal(ran,true);
 assert.deepEqual(await readdir(lock),[]);
});

test('isolated checks run one at a time, and every one of them runs',async t=>{
 const dir=await amalehDir(t),running=new Set<number>(),ran:number[]=[];let most=0;
 await Promise.all([1,2,3].map(n=>withCheckLock(dir,'exclusive',async()=>{running.add(n);most=Math.max(most,running.size);await new Promise(r=>setTimeout(r,100));running.delete(n);ran.push(n);})));
 assert.equal(most,1);
 assert.deepEqual(ran.sort(),[1,2,3]);
});

test('an isolated check waits for a running isolated check whose name sorts after its own',async t=>{
 const dir=await amalehDir(t),lock=checkLockDir(dir);await mkdir(lock,{recursive:true});
 const working=join(lock,'x-999999999999999-working.json');
 await writeFile(working,JSON.stringify({pid:process.pid,host:hostname()}));
 let ran=false;const alone=withCheckLock(dir,'exclusive',async()=>{ran=true;});
 await settle();
 assert.equal(ran,false);
 await rm(working);await alone;
 assert.equal(ran,true);
});

test('a holder whose file stopped being refreshed is cleared, even when its process id is in use again',async t=>{
 const dir=await amalehDir(t),lock=checkLockDir(dir);await mkdir(lock,{recursive:true});
 const reused=join(lock,'x-000000000000001-reused.json'),longAgo=new Date(Date.now()-10*60000);
 await writeFile(reused,JSON.stringify({pid:process.pid,host:hostname()}));await utimes(reused,longAgo,longAgo);
 let ran=false;await withCheckLock(dir,'shared',async()=>{ran=true;});
 assert.equal(ran,true);
 assert.deepEqual(await readdir(lock),[]);
});

test('a fresh holder entry that cannot be read counts as held and is not removed',async t=>{
 const dir=await amalehDir(t),lock=checkLockDir(dir),unreadable=join(lock,'s-000000000000001-unreadable.json');
 await mkdir(unreadable,{recursive:true});
 let ran=false;const alone=withCheckLock(dir,'exclusive',async()=>{ran=true;});
 await settle();
 assert.equal(ran,false);
 assert.ok((await readdir(lock)).includes('s-000000000000001-unreadable.json'));
 await rm(unreadable,{recursive:true});await alone;
 assert.equal(ran,true);
});

test('a waiting isolated check whose file was removed registers again',async t=>{
 const dir=await amalehDir(t),lock=checkLockDir(dir),shared=gate(),sharedStarted=gate();
 const first=withCheckLock(dir,'shared',async()=>{sharedStarted.open();await shared.opened;});
 await sharedStarted.opened;
 let ran=false;const alone=withCheckLock(dir,'exclusive',async()=>{ran=true;});
 await settle();
 for(const name of (await readdir(lock)).filter(n=>n.startsWith('x-')))await rm(join(lock,name));
 shared.open();await first;await alone;
 assert.equal(ran,true);
});

test('the holder is released when the check throws',async t=>{
 const dir=await amalehDir(t);
 await assert.rejects(()=>withCheckLock(dir,'exclusive',async()=>{throw new Error('check crashed');}),/check crashed/);
 assert.deepEqual(await readdir(checkLockDir(dir)),[]);
 let ran=false;await withCheckLock(dir,'shared',async()=>{ran=true;});assert.equal(ran,true);
});
