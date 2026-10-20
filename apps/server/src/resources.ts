import {AuthError} from './auth/password.js';
export const defaultResources = {streams:16,streamsPerUser:8,transcodes:2,catalog:8,catalogPerUser:4,catalogTimeoutMs:30000,requestsPerMinute:600,personalBytes:256*1024*1024,totalPersonalBytes:2*1024*1024*1024,metadataBytes:16*1024,databaseBytes:4*1024*1024*1024,minFreeBytes:256*1024*1024};
export type ResourceLimits = typeof defaultResources;
/** Fail-fast admission: bounded queue length is zero, so disconnects cannot leave waiters. */
export class Admission {
 private active=0;private readonly users=new Map<string,number>();
 constructor(private readonly global:number,private readonly perUser:number){}
 acquire(user:string){
  const count=this.users.get(user)??0;
  if(count>=this.perUser)throw new AuthError(429,'RESOURCE_LIMIT','Your concurrent request limit was reached. Retry shortly.');
  if(this.active>=this.global)throw new AuthError(503,'RESOURCE_LIMIT','The server is busy. Retry shortly.');
  this.active++;this.users.set(user,count+1);let released=false;
  return ()=>{if(released)return;released=true;this.active--;const n=(this.users.get(user)??1)-1;if(n)this.users.set(user,n);else this.users.delete(user);};
 }
}
