export interface TrainingRun {
 id:string; name:string; status:'created'|'running'|'exporting'|'completed'|'failed'|'cancelled';
 fingerprint:string; categories:{id:number;key:string}[]; config:{epochs:number;imgsz:number;batch:number;model:string};
 dataset_summary:{splits:Record<string,{pages:number;boxes:number;synthetic:number;confirmedOther:number}>;warnings:string[];duplicatesRemoved:number;classCounts:Record<string,Record<string,number>>};
 last_seq:number;last_epoch:number;metrics:Record<string,number>;error:string|null;
 created_at:string;updated_at:string;heartbeat_at:string|null;completed_at:string|null;
 artifacts?:{kind:string;checksum:string;bytes:number|string;mime:string}[];
 workers?:{id:string;name:string;device:string;heartbeat_at:string}[];
}
export interface TrainingEvent {seq:number;kind:string;payload:{epoch?:number;metrics?:Record<string,number>;message?:string;status?:string};created_at:string}
export interface Prediction {
 id:string;run_id:string;status:'queued'|'running'|'completed'|'failed';width:number;height:number;confidence:number;iou:number;
 boxes:{classId:number;classKey:string;score:number;x:number;y:number;width:number;height:number}[]|null;
 elapsed_ms:number|null;error:string|null;
}
