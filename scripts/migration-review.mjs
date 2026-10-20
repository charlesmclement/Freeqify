/** Explicit private copies/config only. Does not load operator defaults or mutate databases. */
import {DatabaseSync} from 'node:sqlite';
import {lstat,realpath} from 'node:fs/promises';
import {parse} from 'dotenv';
import {readPrivateFile} from './private-files.mjs';
import {absolute,exclusivePrivate} from './installation.mjs';
import {readConfig} from '../apps/server/dist/config.js';
import {Navidrome} from '../apps/server/dist/integrations/navidrome.js';
import {captureReferenceBaseline,verifyReferenceBaseline} from '../apps/server/dist/migration-review.js';
if(process.getuid()===0||process.argv.length!==6)throw new Error('As copy owner: migration-review.mjs capture|check PRIVATE_COPY_DB EXPLICIT_PRIVATE_SERVER_ENV BASELINE_JSON');
const [command,file,configFile,baselineFile]=process.argv.slice(2);
if(!['capture','check'].includes(command))throw new Error('Choose capture or check.');
const path=absolute(file);const info=await lstat(path);
if(await realpath(path)!==path||!info.isFile()||info.uid!==process.getuid()||(info.mode&0o077)!==0)throw new Error('Use an owner-only regular database copy without symlink components.');
const config=readConfig(parse(readPrivateFile(absolute(configFile),false,1024*1024)));
const library=new Navidrome(config.navidrome);const db=new DatabaseSync(path,{readOnly:true});
try{
 if(command==='capture'){
  const baseline=await captureReferenceBaseline(db,library);await exclusivePrivate(absolute(baselineFile),JSON.stringify(baseline),32*1024*1024);
  console.log(`Private baseline captured for ${baseline.references.length} references; previously missing: ${baseline.references.filter(r=>r.status==='missing').length}. No migration approved by capture.`);
 }else console.log(await verifyReferenceBaseline(db,library,JSON.parse(readPrivateFile(absolute(baselineFile),false,32*1024*1024))));
 console.log('Metadata/reference review only: verify original audio and post-scan IDs on disposable target copies before cutover. Any mismatch is a STOP.');
}finally{db.close();}
