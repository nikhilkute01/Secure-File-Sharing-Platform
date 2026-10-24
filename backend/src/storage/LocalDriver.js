const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

const ROOT = path.join(__dirname, '..', '..', 'uploads');

function safeId(id) {
  if (!/^[a-f0-9]{24}$/.test(String(id))) throw new Error('Bad file id');
  return String(id);
}
function safePart(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error('Bad part number');
  return n;
}


function limitBytes(max) {
  let seen = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      if (seen > max) return cb(new Error('PART_TOO_LARGE'));
      cb(null, chunk);
    },
  });
}

class LocalDriver {
  dir(fileId) {
    return path.join(ROOT, safeId(fileId));
  }

  async initUpload(fileId) {
    await fs.promises.mkdir(this.dir(fileId), { recursive: true });
  }

  async putPart(fileId, partNo, stream, maxBytes) {
    const base = path.join(this.dir(fileId), String(safePart(partNo)));
    const tmp = `${base}.tmp`;
    try {
      await pipeline(stream, limitBytes(maxBytes), fs.createWriteStream(tmp));
      await fs.promises.rename(tmp, `${base}.bin`); 
    } catch (err) {
      await fs.promises.unlink(tmp).catch(() => {});
      throw err;
    }
  }

  getPart(fileId, partNo) {
    return fs.createReadStream(path.join(this.dir(fileId), `${safePart(partNo)}.bin`));
  }

  async listParts(fileId) {
    try {
      const files = await fs.promises.readdir(this.dir(fileId));
      return files.filter((f) => f.endsWith('.bin')).map((f) => parseInt(f, 10));
    } catch {
      return [];
    }
  }
  

  stageDir(fileId) {
    return path.join(this.dir(fileId), 'next');
  }

  async initStage(fileId) {
    await fs.promises.rm(this.stageDir(fileId), { recursive: true, force: true });
    await fs.promises.mkdir(this.stageDir(fileId), { recursive: true });
  }

  async putStagePart(fileId, partNo, stream, maxBytes) {
    const base = path.join(this.stageDir(fileId), String(safePart(partNo)));
    const tmp = `${base}.tmp`;
    try {
      await pipeline(stream, limitBytes(maxBytes), fs.createWriteStream(tmp));
      await fs.promises.rename(tmp, `${base}.bin`);
    } catch (err) {
      await fs.promises.unlink(tmp).catch(() => {});
      throw err;
    }
  }

  async listStageParts(fileId) {
    try {
      const files = await fs.promises.readdir(this.stageDir(fileId));
      return files.filter((f) => f.endsWith('.bin')).map((f) => parseInt(f, 10));
    } catch {
      return [];
    }
  }

  
  async commitStage(fileId) {
    const dir = this.dir(fileId);
    const stage = this.stageDir(fileId);
    for (const n of await this.listStageParts(fileId)) {
      await fs.promises.rename(path.join(stage, `${n}.bin`), path.join(dir, `${n}.bin`));
    }
    await fs.promises.rm(stage, { recursive: true, force: true });
  }

  async abortStage(fileId) {
    await fs.promises.rm(this.stageDir(fileId), { recursive: true, force: true });
  }


  async deleteAll(fileId) {
    await fs.promises.rm(this.dir(fileId), { recursive: true, force: true });
  }
}

module.exports = LocalDriver;