// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {fileName,offlineAccount,rememberOfflineAccount,forgetOfflineAccount,offlineDatabase,type LocalTrack} from './offline-store.js';
afterEach(()=>localStorage.clear());
it('remembers only a device account and never restores administrator authority or server credentials',()=>{rememberOfflineAccount({id:'owner',username:'Owner',role:'admin',status:'active',createdAt:1});expect(offlineAccount()).toMatchObject({id:'owner',role:'listener'});expect(JSON.stringify(offlineAccount())).not.toMatch(/csrf|token|password/);forgetOfflineAccount();expect(offlineAccount()).toBeNull();});
it('rejects malformed/disabled device identities and isolates browser databases by account',()=>{rememberOfflineAccount({id:'bad/id',username:'Owner',role:'listener',status:'active',createdAt:1});expect(offlineAccount()).toBeNull();rememberOfflineAccount({id:'owner',username:'Owner',role:'admin',status:'disabled',createdAt:1});expect(offlineAccount()).toBeNull();expect(offlineDatabase('one')).not.toBe(offlineDatabase('two'));});
it('exports a safe ordinary filename with an extension derived from verified media type',()=>{const item={track:{title:'Track/one\u0000',artist:'Artist:Two'},type:'audio/flac'} as LocalTrack;expect(fileName(item)).toBe('Artist_Two - Track_one_.flac');});
