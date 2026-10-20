import { describe, expect, it } from 'vitest';
import { emptyPlayback, validPlayback, type Track } from '@freeqify/shared';
import { enqueue, removeQueued, shuffleQueue, step } from './playback-queue.js';
const tracks = Array.from({ length: 5 }, (_, i) => ({ id: `song-${i}` } as Track));
describe('playback queue', () => {
  it('plays albums in original order and advances forwards/backwards', () => { const s = enqueue(emptyPlayback(), tracks, true); expect(s.queue.map(t => t.trackId)).toEqual(tracks.map(t => t.id)); expect(step(s, 1).current).toBe(s.order[1]); expect(step(step(s, 1), -1).current).toBe(s.current); expect(step(s, -1)).toBe(s); });
  it('stops at the end, wraps repeat all, and repeats one only on ended', () => { const s = enqueue(emptyPlayback(), tracks, true); const last = { ...s, current: s.order.at(-1)! }; expect(step(last, 1)).toBe(last); expect(step({ ...last, repeat: 'all' }, 1).current).toBe(s.order[0]); expect(step({ ...s, repeat: 'one' }, 1, true).current).toBe(s.current); expect(step({ ...s, repeat: 'one' }, 1).current).toBe(s.order[1]); });
  it('shuffles without duplicates, retains current, and restores original order', () => { const s = enqueue(emptyPlayback(), tracks, true); const shuffled = shuffleQueue(s, () => 0); expect(shuffled.current).toBe(s.current); expect(shuffled.order[0]).toBe(s.current); expect(new Set(shuffled.order).size).toBe(5); expect(shuffled.order).not.toEqual(s.order); expect(shuffleQueue(shuffled).order).toEqual(s.order); });
  it('adds, removes and clears entries without losing stable references', () => { let s = enqueue(emptyPlayback(), tracks.slice(0, 2), true); s = enqueue(s, [tracks[0]!]); expect(new Set(s.queue.map(t => t.key)).size).toBe(3); s = removeQueued(s, s.current!); expect(s.current).toBe(s.order[0]); while (s.queue.length) s = removeQueued(s, s.queue[0]!.key); expect(s.current).toBeNull(); expect(s.order).toEqual([]); });
  it('caps queue and validates persisted state; refuses foreign namespaces and unknown current/order', () => { const s = enqueue(emptyPlayback(), Array.from({ length: 5001 }, () => tracks[0]!), true); expect(s.queue).toHaveLength(5000); expect(validPlayback(s)).toBe(true); expect(validPlayback({ ...s, current: 'unknown' })).toBe(false); expect(validPlayback({ ...s, position: Infinity })).toBe(false); expect(validPlayback({ ...s, queue: [{ key: 'a', source: 'remote', trackId: 'a' }] })).toBe(false); });
});

it('keeps all 5,000 occurrences through shuffle, repeat and queue restoration validation',()=>{
 const songs=Array.from({length:5000},(_,i)=>({id:`song-${i%300}`} as Track));const queue=enqueue(emptyPlayback(),songs,true);
 expect(queue.queue.map(t=>t.trackId)).toEqual(songs.map(t=>t.id));expect(validPlayback(JSON.parse(JSON.stringify(queue)))).toBe(true);
 const shuffled=shuffleQueue(queue,()=>0.4);expect(new Set(shuffled.order).size).toBe(5000);expect(shuffleQueue(shuffled).order).toEqual(queue.order);
 const last={...queue,current:queue.order.at(-1)!,repeat:'all' as const};expect(step(last,1).current).toBe(queue.current);expect(step({...last,repeat:'one'},1,true).current).toBe(last.current);
 expect(validPlayback({...queue,queue:[...queue.queue,{key:'overflow',source:'local',trackId:'song'}],order:[...queue.order,'overflow']})).toBe(false);
});

describe('manual priority and context boundaries',()=>{
 const titles=(s:ReturnType<typeof emptyPlayback>)=>s.order.map(key=>s.queue.find(t=>t.key===key)!.trackId);
 it('plays A, X, Y, B, C then resumes context and retains every occurrence',async()=>{
  const {queueManually,startContext,manualKeys,clearManual}=await import('./playback-queue.js');
  let s=startContext(emptyPlayback(),tracks.slice(0,3),0,'Album');
  s=queueManually(s,[{id:'X'} as Track],true);s=queueManually(s,[{id:'Y'} as Track]);
  expect(titles(s)).toEqual(['song-0','X','Y','song-1','song-2']);expect(manualKeys(s)).toHaveLength(2);
  s=step(s,1);expect(s.queue.find(t=>t.key===s.current)?.trackId).toBe('X');
  const cleared=clearManual(s);expect(cleared.current).toBe(s.current);expect(titles(cleared)).toEqual(['song-0','X','song-1','song-2']);
  expect(titles(step(s,1))).toEqual(titles(s));expect(step(step(s,1),1).current).toBe(s.order[3]);
 });
 it('retains pending manual ordering when starting a new context, including Play Next stacking',async()=>{
  const {queueManually,startContext,manualKeys}=await import('./playback-queue.js');
  let s=startContext(emptyPlayback(),tracks.slice(0,3));s=queueManually(s,[{id:'X'} as Track],true);s=queueManually(s,[{id:'Y'} as Track],true);
  const manual=manualKeys(s);s=startContext(s,tracks.slice(3),0,'Second album');expect(manualKeys(s)).toEqual(manual);expect(titles(s)).toEqual(['song-3','Y','X','song-4']);
 });
 it('shuffles only remaining context, preserving current/history and manual order',async()=>{
  const {queueManually,startContext,manualKeys}=await import('./playback-queue.js');
  let s=startContext(emptyPlayback(),tracks);s=step(s,1);s=queueManually(s,[{id:'X'} as Track,{id:'X'} as Track]);const manual=manualKeys(s),past=s.order.slice(0,2);
  const shuffled=shuffleQueue(s,()=>0);expect(shuffled.order.slice(0,2)).toEqual(past);expect(manualKeys(shuffled)).toEqual(manual);expect(shuffled.order.slice(2,4)).toEqual(manual);
  expect(shuffleQueue(shuffled).order).toEqual(s.order);expect(validPlayback(shuffled)).toBe(true);
 });
 it('does not omit context tracks before the randomly selected shuffle start',async()=>{
  const {startContext,upcoming}=await import('./playback-queue.js');const s=startContext(emptyPlayback(),tracks,3,'Album',true);
  expect(s.order[0]).toBe(s.current);expect(upcoming(s)).toHaveLength(4);expect(new Set(s.order).size).toBe(5);
 });
 it('reorders only upcoming songs within their own section, never the current song',async()=>{
  const {queueManually,startContext,moveQueued,manualKeys}=await import('./playback-queue.js');let s=queueManually(startContext(emptyPlayback(),tracks),tracks.slice(0,2));
  const [a,b]=manualKeys(s);s=moveQueued(s,a!,b!);expect(manualKeys(s)).toEqual([b,a]);expect(moveQueued(s,s.current!,b!)).toBe(s);expect(moveQueued(s,b!,s.order.at(-1)!)).toBe(s);
 });
 it('validates backward-compatible state and rejects forged origin/context fields',()=>{
  const s=enqueue(emptyPlayback(),tracks,true);expect(validPlayback(s)).toBe(true);expect(validPlayback({...s,contextLabel:'Album'})).toBe(true);
  expect(validPlayback({...s,contextLabel:'x'.repeat(161)})).toBe(false);expect(validPlayback({...s,queue:s.queue.map(t=>({...t,origin:'remote'}))})).toBe(false);
 });
});
