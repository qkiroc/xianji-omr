import {uid,clone} from './api.js';
const open=(name)=>new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('draft');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
let database;
async function db(){return database||=await open('xianji-omr-layout-drafts')}
export async function saveDraft(document){const d=clone(document);d.draftId||=uid();document.draftId=d.draftId;return new Promise(async(resolve,reject)=>{try{const t=(await db()).transaction('draft','readwrite');t.objectStore('draft').put(d,d.draftId);t.oncomplete=resolve;t.onerror=()=>reject(t.error)}catch(e){reject(e)}})}
export async function drafts(){return new Promise(async(resolve,reject)=>{try{const r=(await db()).transaction('draft').objectStore('draft').getAll();r.onsuccess=()=>resolve(r.result.filter(d=>d.dirty));r.onerror=()=>reject(r.error)}catch(e){reject(e)}})}
// Read-only compatibility: do not upgrade, delete, mark saved or rewrite the previous editor's store.
export async function legacyDrafts(){if(!indexedDB.databases)return[];const names=await indexedDB.databases();if(!names.some(d=>d.name==='crop-annotator-cloud'))return[];const old=await open('crop-annotator-cloud');try{return await new Promise((resolve,reject)=>{const r=old.transaction('draft','readonly').objectStore('draft').getAll();r.onsuccess=()=>resolve(r.result.filter(d=>d&&typeof d==='object'&&d.image&&d.dirty!==false));r.onerror=reject})}finally{old.close()}}
