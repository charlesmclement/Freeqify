import {StringDecoder} from 'node:string_decoder';
import { stdin, stdout } from 'node:process';
export async function hidden(prompt: string): Promise<string> {
  stdout.write(prompt); stdin.setRawMode(true); stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';const decoder=new StringDecoder('utf8');
    const cleanup = () => { stdin.off('data', input); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
    const input = (chunk: Buffer) => {
      for (const character of decoder.write(chunk)) {
        if (character === '\u0003') { cleanup(); reject(new Error('Administrator setup cancelled.')); return; }
        if (character === '\r' || character === '\n') { cleanup(); resolve(value); return; }
        if (character === '\u007f' || character === '\b') value = [...value].slice(0, -1).join('');
        else if (character >= ' ' && value.length < 512) value += character;
      }
    };
    stdin.on('data', input);
  });
}
