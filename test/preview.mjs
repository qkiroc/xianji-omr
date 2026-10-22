import {fixture} from './fixture.mjs';
const f=await fixture({webPort:4173,origin:'http://terminal.local:4173',previewLogin:true});console.log('隔离测试预览就绪；admin / test-admin-12345；不是生产资源');const stop=async()=>{await f.close();process.exit(0)};process.on('SIGTERM',stop);process.on('SIGINT',stop);
