import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {join,dirname} from 'node:path';
import {readPrivateFile} from './private-files.mjs';
import {musicDirectory,safeLayout,privateDirectory,exclusivePrivate,availablePort,environment,serviceUnit,absolute,headroom} from './installation.mjs';
if(process.getuid()===0)throw new Error('Preparation runs without root. No sudo is invoked.');
if(Number(process.versions.node.split('.')[0])!==24)throw new Error('Activate Node.js 24 before preparing Freeqify.');
const args=process.argv.slice(2);let spec;
if(args[0]==='--spec'&&args.length===2)spec=JSON.parse(readPrivateFile(absolute(args[1]),false,1024*1024));
else if(args.length)throw new Error('Use no arguments for guided preparation, or --spec /absolute/private/spec.json.');
const terminal=!spec?createInterface({input:stdin,output:stdout}):null;
if(terminal&&!stdin.isTTY)throw new Error('Interactive setup requires a terminal; advanced users can pass --spec.');
try{
 console.log('Preparation only. This writes a NEW private bundle, never starts indexing or installs services. Run engine configuration as its eventual owner. Separate service identities require later administrator review.');
 const ask=async(key,question)=>{if(spec){if(spec[key]===undefined)throw new Error(`Missing explicit specification field: ${key}`);return spec[key];}return terminal.question(question+' ');};
 const installationMode=await ask('installationMode','Choose fresh (new accounts) or migrate (preserve both applications’ state):');
 if(!['fresh','migrate'].includes(installationMode))throw new Error('Choose fresh or migrate explicitly.');
 let music;
 while(!music){try{music=await musicDirectory(await ask('music','Where is your existing music collection? Enter its absolute directory path:'));}catch(e){if(spec)throw e;console.log(`${e.message} Check drive mount and read/traverse permissions as the engine owner, then try again.`);}}
 console.log(`Resolved music directory: ${music.resolved}; checked as UID ${music.uid}. No indexing will start.`);
 if((await ask('confirmation','Type CONFIRM to use this read-only collection:'))!=='CONFIRM')throw new Error('Cancelled; no configuration written.');
 const output=absolute(await ask('output','New private preparation bundle path (inside an existing 0700 parent):'));
 const paths=await safeLayout({music:music.resolved,output,
  serverState:await ask('serverState','Absolute Freeqify state directory:'),
  engineState:await ask('engineState','Absolute Navidrome state/cache directory:'),
  backups:await ask('backups','Absolute private backup directory:'),
  release:await ask('release','Absolute NEW immutable release directory (outside this checkout):')});
 const node=absolute(await ask('node','Absolute Node24 executable for the target services:'));
 const binary=absolute(await ask('binary','Absolute dedicated Navidrome executable:'));
 const port=Number(await ask('port','Unused Freeqify loopback port (1024–65535):'));
 const enginePort=Number(await ask('enginePort','Unused Navidrome loopback port (1024–65535):'));
 if(port===enginePort)throw new Error('Choose two distinct ports.');
 await availablePort(port);await availablePort(enginePort);await headroom(dirname(output),512*1024*1024);
 const base=await ask('basePath','URL prefix, beginning and ending with / (enter / for root):');
 if(!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))throw new Error('Invalid URL prefix.');
 const serverIdentity=await ask('serverIdentity','Dedicated Freeqify identity name (fq- prefix):');
 const engineIdentity=await ask('engineIdentity','Separate Navidrome identity name (fq- prefix):');
 if(serverIdentity===engineIdentity)throw new Error('Service identities must differ.');
 const serverConfig=absolute(await ask('serverConfig','Final private Freeqify config path (owned by Freeqify identity):'));
 const engineConfig=absolute(await ask('engineConfig','Final private engine config path (owned by Navidrome identity):'));
 const passwordFile=absolute(await ask('passwordFile','Final owner-only engine password file path (owned by Freeqify identity):'));
 await safeLayout({...paths,serverConfigDir:dirname(serverConfig),engineConfigDir:dirname(engineConfig)});
 if(dirname(passwordFile)!==dirname(serverConfig)||passwordFile===serverConfig)throw new Error('Password must have a distinct filename in the Freeqify private configuration directory.');
 const shared={NAVIDROME_URL:`http://127.0.0.1:${enginePort}/`};
 const units={server:serviceUnit({role:'server',identity:serverIdentity,release:paths.release,node,config:serverConfig,state:paths.serverState}),engine:serviceUnit({role:'engine',identity:engineIdentity,release:paths.release,node,config:engineConfig,state:paths.engineState,music:paths.music})};
 await privateDirectory(paths.output);
 await exclusivePrivate(join(paths.output,'server.env'),environment({...shared,HOST:'127.0.0.1',PORT:port,BASE_PATH:base,DATA_DIR:paths.serverState,WEB_DIST_DIR:join(paths.release,'apps/web/dist'),AUTH_SECURE_COOKIES:'false',DEPLOYMENT_MODE:'local',NAVIDROME_USERNAME:'',NAVIDROME_PASSWORD_FILE:passwordFile}));
 await exclusivePrivate(join(paths.output,'engine.env'),environment({...shared,MUSIC_DIR:paths.music,NAVIDROME_DATA_DIR:paths.engineState,NAVIDROME_BINARY:binary,NAVIDROME_SCAN_ON_STARTUP:installationMode==='fresh'?'true':'false',MUSIC_READINESS_FILE:join(dirname(engineConfig),'music-readiness.json')}));
 await exclusivePrivate(join(paths.output,'installation.json'),JSON.stringify({version:1,installationMode,...paths,node,binary,serverConfig,engineConfig,passwordFile,port,enginePort,basePath:base,serverIdentity,engineIdentity,musicDirectories:[music],status:'prepared-not-deployed'},null,2));
 for(const role of ['server','engine'])await exclusivePrivate(join(paths.output,`freeqify-${role}.service`),units[role]);
 console.log('Private bundle created. No services, data directories or music files changed. Review docs/linux-installation.md before provisioning. Configuration must be installed separately with correct per-identity ownership; shared bundle ownership is not a production arrangement.');
}finally{terminal?.close();}
