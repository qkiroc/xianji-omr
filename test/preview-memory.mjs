// Only the managed cloud preview build lacks /proc for uv_resident_set_memory.
// Production builds/entrypoints never import this test-only adapter.
import {getHeapStatistics} from 'node:v8';
const original=process.memoryUsage,originalRss=original.rss;
function fallback(){const heap=getHeapStatistics();return{rss:process.resourceUsage().maxRSS*1024,heapTotal:heap.total_heap_size,heapUsed:heap.used_heap_size,external:heap.external_memory,arrayBuffers:0}}
function memory(){try{return original()}catch(e){if(e.code!=='ENOENT')throw e;return fallback()}}
memory.rss=()=>{try{return originalRss()}catch(e){if(e.code!=='ENOENT')throw e;return fallback().rss}};
process.memoryUsage=memory;
