import {pwaWorker} from './pwa-worker.js';
import {createHash} from 'node:crypto';
import {loadPublicAssets} from '../server/src/public-assets.js';
import { defineConfig } from 'vite';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../server/src/environment.js';
import { readConfig } from '../server/src/config.js';
loadEnvironment();
export default defineConfig(() => {
  let outputDirectory='';
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    base: readConfig().basePath,
    plugins:[{name:'freeqify-public-shell',apply:'build',generateBundle(_options,bundle){const files=['index.html','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png',...Object.keys(bundle).filter(name=>/^assets\/.*\.(js|css)$/.test(name))];const version=createHash('sha256').update(JSON.stringify(bundle)).digest('hex').slice(0,16);this.emitFile({type:'asset',fileName:'sw.js',source:pwaWorker(files,version)});}},{name:'verify-public-artifacts',apply:'build',configResolved(config){outputDirectory=resolve(config.root,config.build.outDir);},async closeBundle(){await loadPublicAssets(outputDirectory,true);}}],
    build: { outDir: 'dist', emptyOutDir: true, rolldownOptions:{output:{comments:{legal:true},banner:()=>['LICENSE-butterchurn','LICENSE-presets'].map(name=>'/*! '+name+'\n'+readFileSync(new URL('./src/milkdrop/'+name,import.meta.url),'utf8')+' */').join('\n')}} },
  };
});
