// Only identified record conflicts are isolated. Auth, outages and invalid renders still fail.
export const replacementIsTerminal=state=>['complete','preserved'].includes(state?.phase);
export function editionConflict(reason,details={}){return Object.assign(Error(reason),{code:'EDITION_CONFLICT',details});}
export function isEditionConflict(error){return error.code==='EDITION_CONFLICT'||error.status===409||error.status===404&&/^\/api\/v2\/(pages|songs)\//.test(error.apiPath||'');}
export function recordPreservedEdition(report,item,state){
 if(state.phase!=='preserved')return false;
 const key=item.sourceId+':'+item.profileId,record={key,sourceId:item.sourceId,title:item.title,profile:item.profileId,songId:state.songId,phase:item.phase,...state.conflict};
 report.preservedEditions=[...(report.preservedEditions||[]).filter(p=>p.key!==key),record];return record;
}
