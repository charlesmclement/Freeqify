import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink,chmod,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {readPrivateFile} from '../../../scripts/private-files.mjs';
import {navidromeSandbox} from '../../../scripts/sandbox.mjs';
it('reads private files through execute-only ancestors without relaxing link or permission checks',async()=>{
 const root=await mkdtemp('/tmp/freeqify-searchable-parent-');const parent=join(root,'searchable');
 try{
  await mkdir(parent,{mode:0o700});const file=join(parent,'secret');
  await writeFile(file,'private fixture',{mode:0o600});await symlink(file,join(parent,'link'));
  await chmod(parent,0o111);
  expect(readPrivateFile(file)).toBe('private fixture');
  expect(()=>readPrivateFile(join(parent,'link'))).toThrow();
  await chmod(file,0o644);expect(()=>readPrivateFile(file)).toThrow();
  await chmod(file,0o600);await chmod(parent,0o133);expect(()=>readPrivateFile(file)).toThrow();
 }finally{await chmod(parent,0o700);await rm(root,{recursive:true,force:true});}
});
it('accepts private regular files, rejects permissive files, links and unsafe parents',async()=>{const d=await mkdtemp('/tmp/freeqify-private-file-');try{const f=join(d,'secret');await writeFile(f,'synthetic',{mode:0o600});expect(readPrivateFile(f)).toBe('synthetic');await chmod(f,0o644);expect(()=>readPrivateFile(f)).toThrow('0600');await chmod(f,0o600);await symlink(f,join(d,'link'));expect(()=>readPrivateFile(join(d,'link'))).toThrow();await symlink(d,join(d,'parent-link'));expect(()=>readPrivateFile(join(d,'parent-link/secret'))).toThrow();await mkdir(join(d,'unsafe'),{mode:0o777});await chmod(join(d,'unsafe'),0o777);await writeFile(join(d,'unsafe/file'),'synthetic',{mode:0o600});expect(()=>readPrivateFile(join(d,'unsafe/file'))).toThrow();expect(()=>readPrivateFile(d)).toThrow();expect(readPrivateFile(join(d,'missing'),true)).toBeUndefined();expect(()=>readPrivateFile(join(d,'missing'))).toThrow();}finally{await rm(d,{recursive:true,force:true});}});
it('builds a narrow engine mount tree without the host root or home',()=>{const args=navidromeSandbox({binary:'/synthetic/engine',music:'/synthetic/music with spaces',data:'/synthetic/state'});expect(args).not.toContain('/home');expect(args.join(' ')).not.toContain('--ro-bind / /');expect(args).toContain('--unshare-pid');expect(args).toContain('/music');expect(args).toContain('/synthetic/music with spaces');expect(args).toContain('/state');expect(args).not.toContain('--unshare-net');});
