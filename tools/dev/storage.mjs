import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable} from 'node:stream';
export async function localStorage(root) {
  await mkdir(root,{recursive:true});
  const path=key=>join(root,createHash('sha256').update(key).digest('hex')+'.bin');
  return {
    async put(key,bytes){const dest=path(key),part=dest+'.'+randomUUID()+'.partial';try{await writeFile(part,bytes);await rename(part,dest);}finally{await rm(part,{force:true});}},
    async putStream(key,stream){const chunks=[];for await(const chunk of stream)chunks.push(chunk);await this.put(key,Buffer.concat(chunks));},
    async get(key){return readFile(path(key));},
    async getStream(key){return Readable.from(await this.get(key));},
    async delete(key){await rm(path(key),{force:true});},
  };
}
