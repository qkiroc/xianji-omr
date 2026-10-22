import {mkdir,copyFile} from 'node:fs/promises';
await mkdir(new URL('./static/',import.meta.url),{recursive:true});await copyFile(new URL('../web/index.html',import.meta.url),new URL('./static/index.html',import.meta.url));console.log('网页/API 构建就绪（原生 ESM，无需转译）');
