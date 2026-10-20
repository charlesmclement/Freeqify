import {parse,populate} from 'dotenv';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {readPrivateFile} from './private-files.mjs';
export function loadPrivateEnvironment(root){
 const external=process.env.FREEQIFY_CONFIG_FILE??resolve(process.env.XDG_CONFIG_HOME??resolve(homedir(),'.config'),'freeqify/freeqify.env');
 for(const [file,optional] of [[external,!process.env.FREEQIFY_CONFIG_FILE],[resolve(root,'.env'),true]]){
  const text=readPrivateFile(file,optional,1024*1024);if(text!==undefined)populate(process.env,parse(text),{override:false});
 }
}
