import {mkdir,cp} from 'node:fs/promises';
await mkdir(new URL('./static/',import.meta.url),{recursive:true});await cp(new URL('../web/',import.meta.url),new URL('./static/',import.meta.url),{recursive:true});console.log('同源网页与原生ESM API构建就绪');
