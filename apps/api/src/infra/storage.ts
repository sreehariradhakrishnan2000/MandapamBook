import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.js';

export interface UploadTarget {
  url: string;
  method: 'PUT';
  /** Headers the client must send exactly; they are part of the signature. */
  headers: Record<string, string>;
  expiresAt: string;
}

export interface StoredObjectInfo {
  sizeBytes: number;
  contentType: string | undefined;
}

/**
 * Object storage used for venue photos and invoices. Business code depends on this
 * interface only; S3ObjectStorage works with any S3-compatible service (Neon storage,
 * AWS S3, Cloudflare R2, SeaweedFS).
 */
export interface ObjectStorage {
  /** Presigned PUT that only accepts the given content type and exact size. */
  createUploadUrl(
    key: string,
    contentType: string,
    sizeBytes: number,
    ttlSeconds: number,
  ): Promise<UploadTarget>;
  createDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  head(key: string): Promise<StoredObjectInfo | null>;
  /** Reads at most `bytes` from the start of the object (for magic-byte checks). */
  readPrefix(key: string, bytes: number): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export interface S3Config {
  endpoint?: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async createUploadUrl(
    key: string,
    contentType: string,
    sizeBytes: number,
    ttl: number,
  ): Promise<UploadTarget> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: ttl,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'Content-Length': String(sizeBytes) },
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  createDownloadUrl(key: string, ttl: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      {
        expiresIn: ttl,
      },
    );
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      if (err instanceof NotFound || (err as { name?: string }).name === 'NotFound') return null;
      throw err;
    }
  }

  async readPrefix(key: string, bytes: number): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    const body = await res.Body?.transformToByteArray();
    return Buffer.from(body ?? []);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}

/** In-process storage for tests and offline development. Not allowed in production. */
export class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async createUploadUrl(
    key: string,
    contentType: string,
    sizeBytes: number,
    ttl: number,
  ): Promise<UploadTarget> {
    return {
      url: `memory://upload/${encodeURIComponent(key)}`,
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'Content-Length': String(sizeBytes) },
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }
  async createDownloadUrl(key: string): Promise<string> {
    return `memory://download/${encodeURIComponent(key)}`;
  }
  async head(key: string): Promise<StoredObjectInfo | null> {
    const o = this.objects.get(key);
    return o ? { sizeBytes: o.body.length, contentType: o.contentType } : null;
  }
  async readPrefix(key: string, bytes: number): Promise<Buffer> {
    return this.objects.get(key)?.body.subarray(0, bytes) ?? Buffer.alloc(0);
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  /** Simulates the browser's PUT to the presigned URL. */
  put(key: string, body: Buffer, contentType: string): void {
    this.objects.set(key, { body, contentType });
  }
}

/** The configured object store: S3-compatible, or in-memory for development and tests. */
export function createObjectStorage(
  env: Pick<
    Env,
    | 'STORAGE_PROVIDER'
    | 'S3_ENDPOINT'
    | 'S3_REGION'
    | 'S3_BUCKET'
    | 'S3_ACCESS_KEY_ID'
    | 'S3_SECRET_ACCESS_KEY'
    | 'S3_FORCE_PATH_STYLE'
  >,
): ObjectStorage {
  if (env.STORAGE_PROVIDER !== 's3') return new MemoryObjectStorage();
  return new S3ObjectStorage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    // loadEnv requires both when STORAGE_PROVIDER=s3.
    accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
}
