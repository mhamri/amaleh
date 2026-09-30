import { hostname } from 'node:os';

export function processAlive(pid:number){try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=='ESRCH';}}
// A remote owner cannot be proven dead from here, so it counts as alive.
export function ownerAlive(owner:{pid:number;coordinatorPid?:number;host:string}){return owner.host!==hostname()||[owner.pid,owner.coordinatorPid].some(pid=>pid!==undefined&&processAlive(pid));}
