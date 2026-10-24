const DB = process.env.MONGO_DB || 'securevault';
const target = db.getSiblingDB(DB);

const isMongos = db.hello().msg === 'isdbgrid';
if (!isMongos) {
  print('Not connected to a mongos router: sharding commands skipped.');
  print('Start a sharded cluster (see header of this file) and re-run. App still works unsharded.');
  quit(0);
}

sh.enableSharding(DB);

// FILES: by owner
target.files.createIndex({ ownerId: 1, _id: 1 });
sh.shardCollection(`${DB}.files`, { ownerId: 1, _id: 1 });

target.acls.createIndex({ userId: 1, fileId: 1 }, { unique: true });
sh.shardCollection(`${DB}.acls`, { userId: 1, fileId: 1 }, true);


target.auditevents.createIndex({ fileId: 'hashed' });
sh.shardCollection(`${DB}.auditevents`, { fileId: 'hashed' });

print('Done. Check with: sh.status()');