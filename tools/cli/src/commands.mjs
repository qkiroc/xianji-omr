export const COMMANDS=[
 ['taxonomy','GET','/api/v2/taxonomy'],
 ['datasets list','GET','/api/v2/datasets'],['datasets create','POST','/api/v2/datasets'],['datasets update','PUT','/api/v2/datasets/:datasetId'],
 ['songs list','GET','/api/v2/datasets/:datasetId/songs'],['songs create','POST','/api/v2/datasets/:datasetId/songs'],['songs update','PUT','/api/v2/songs/:songId'],
 ['pages upload','POST','/api/v2/songs/:songId/pages'],['pages list','GET','/api/v2/songs/:songId/pages'],['pages get','GET','/api/v2/pages/:pageId'],['pages content','GET','/api/v2/pages/:pageId/content'],['pages normalize','POST','/api/v2/pages/:pageId/normalize'],['pages update','PUT','/api/v2/pages/:pageId'],['pages confirm','POST','/api/v2/pages/:pageId/confirm'],['pages unconfirm','POST','/api/v2/pages/:pageId/unconfirm'],
 ['snapshots list','GET','/api/v2/datasets/:datasetId/snapshots'],['snapshots create','POST','/api/v2/datasets/:datasetId/snapshots'],['snapshots retry','POST','/api/v2/snapshots/:snapshotId/retry'],['snapshots download','GET','/api/v2/snapshots/:snapshotId/:kind'],
 ['legacy images list','GET','/api/images'],['legacy images upload','POST','/api/images'],['legacy images get','GET','/api/images/:id'],['legacy images content','GET','/api/images/:id/content'],['legacy images update','PUT','/api/images/:id']
].map(([command,method,path])=>({command,method,path}));
