// @vitest-environment jsdom
import {beforeEach,expect,it} from 'vitest';
import {emptyPlayback} from '@freeqify/shared';
import {readQueueDraft,writeQueueDraft,clearQueueDraft} from './queue-draft.js';
beforeEach(()=>localStorage.clear());
it('recovers unacknowledged references per account and clears only the signed-out account',()=>{
 const state={...emptyPlayback(),queue:[{key:'key',trackId:'song',source:'local' as const,origin:'manual' as const}],order:['key'],current:'key',position:42,contextLabel:'Album'};
 writeQueueDraft('alice',state);expect(readQueueDraft('alice')).toEqual(state);expect(readQueueDraft('bob')).toBeNull();writeQueueDraft('bob',emptyPlayback());clearQueueDraft('alice');expect(readQueueDraft('alice')).toBeNull();expect(readQueueDraft('bob')).toEqual(emptyPlayback());
});
it('rejects malformed or oversized drafts and stores no credentials or audio',()=>{
 localStorage.setItem('freeqify.queue-draft.alice','{"queue":[]}');expect(readQueueDraft('alice')).toBeNull();writeQueueDraft('alice',emptyPlayback());const text=localStorage.getItem('freeqify.queue-draft.alice')!;expect(text).not.toMatch(/csrf|password|cookie|blob:/);
});
