const { PassThrough, Transform } = require('stream');
const {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  CopyObjectCommand,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const MB = 1024 * 1024;

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

class S3Driver {
  constructor() {
    this.bucket = process.env.S3_BUCKET;
    if (!this.bucket) throw new Error('S3_BUCKET is not set');
    this.client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: !!process.env.S3_ENDPOINT, 
    });
  }

  key(fileId, n) { return `${safeId(fileId)}/${safePart(n)}.bin`; }
  stageKey(fileId, n) { return `${safeId(fileId)}/next/${safePart(n)}.bin`; }

  async initUpload() { /* S3 has no folders; nothing to create */ }
  async initStage(fileId) { await this.abortStage(fileId); }

  async _put(key, stream, maxBytes) {
    const limiter = limitBytes(maxBytes);
    stream.on('error', (e) => limiter.destroy(e));
    stream.pipe(limiter);
    const up = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: limiter, ContentType: 'application/octet-stream' },
      partSize: 5 * MB,
      queueSize: 2,
      leavePartsOnError: false, 
    });
    await up.done();
  }

  putPart(fileId, n, stream, maxBytes) { return this._put(this.key(fileId, n), stream, maxBytes); }
  putStagePart(fileId, n, stream, maxBytes) { return this._put(this.stageKey(fileId, n), stream, maxBytes); }

  getPart(fileId, n) {
    const out = new PassThrough();
    this.client
      .send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(fileId, n) }))
      .then((r) => {
        r.Body.on('error', (e) => out.destroy(e));
        r.Body.pipe(out);
      })
      .catch((e) => out.destroy(e));
    return out;
  }

  async _list(prefix, delimiter) {
    const keys = [];
    let token;
    do {
      const r = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          Delimiter: delimiter,
          ContinuationToken: token,
        })
      );
      (r.Contents || []).forEach((o) => keys.push(o.Key));
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  _partNumbers(keys) {
    return keys
      .map((k) => k.split('/').pop())
      .filter((f) => /^\d+\.bin$/.test(f))
      .map((f) => parseInt(f, 10));
  }

  async listParts(fileId) {
    try {
      return this._partNumbers(await this._list(`${safeId(fileId)}/`, '/'));
    } catch {
      return [];
    }
  }

  async listStageParts(fileId) {
    try {
      return this._partNumbers(await this._list(`${safeId(fileId)}/next/`));
    } catch {
      return [];
    }
  }

  async _deleteKeys(keys) {
    for (let i = 0; i < keys.length; i += 1000) {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
        })
      );
    }
  }

  async commitStage(fileId) {
    const parts = await this.listStageParts(fileId);
    for (const n of parts) {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: encodeURIComponent(`${this.bucket}/${this.stageKey(fileId, n)}`),
          Key: this.key(fileId, n),
        })
      );
    }
    await this.abortStage(fileId);
  }

  async abortStage(fileId) {
    await this._deleteKeys(await this._list(`${safeId(fileId)}/next/`));
  }

  async deleteAll(fileId) {
    await this._deleteKeys(await this._list(`${safeId(fileId)}/`));
  }
}

module.exports = S3Driver;