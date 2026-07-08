import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import type { Env } from '../config/env';

export interface StoredRecording {
  /** Cloudinary public id — persisted; signed URLs are minted from it on demand. */
  publicId: string;
  bytes: number;
}

/**
 * Cloudinary recording storage. Uploads are `type: authenticated` so playback
 * always requires a short-lived signed URL (never a public link). Runs in MOCK
 * mode when Cloudinary is not configured, so the flow works locally.
 *
 * Data residency (DPDP): recordings live in the Cloudinary account's region —
 * provision the account/sub-account in India. This adapter is region-agnostic.
 */
@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);
  private mock = true;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    const url = this.config.get('CLOUDINARY_URL', { infer: true });
    const cloud = this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
    const key = this.config.get('CLOUDINARY_API_KEY', { infer: true });
    const secret = this.config.get('CLOUDINARY_API_SECRET', { infer: true });
    if (url) {
      cloudinary.config({ secure: true }); // reads CLOUDINARY_URL from env
      this.mock = false;
    } else if (cloud && key && secret) {
      cloudinary.config({ cloud_name: cloud, api_key: key, api_secret: secret, secure: true });
      this.mock = false;
    }
    this.logger.log(`Cloudinary ${this.mock ? 'MOCK mode (not configured)' : 'configured'}`);
  }

  isMock(): boolean {
    return this.mock;
  }

  private folder(): string {
    return this.config.get('CLOUDINARY_FOLDER', { infer: true });
  }

  async upload(buffer: Buffer, publicId: string): Promise<StoredRecording> {
    if (this.mock) {
      return { publicId: `${this.folder()}/${publicId}`, bytes: buffer.byteLength };
    }
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: 'video', type: 'authenticated', folder: this.folder(), public_id: publicId, overwrite: true },
        (err, res) => (err || !res ? reject(err ?? new Error('no upload result')) : resolve(res)),
      );
      stream.end(buffer);
    });
    return { publicId: result.public_id, bytes: result.bytes };
  }

  /** A signed, expiring download URL for a stored recording. */
  signedUrl(publicId: string, ttlSeconds: number): { url: string; expiresAt: Date } {
    const expiresAtSec = Math.floor(Date.now() / 1000) + ttlSeconds;
    const expiresAt = new Date(expiresAtSec * 1000);
    if (this.mock) {
      return { url: `https://mock.cloudinary.local/${encodeURIComponent(publicId)}?exp=${expiresAtSec}`, expiresAt };
    }
    const url = cloudinary.utils.private_download_url(publicId, 'mp3', {
      resource_type: 'video',
      expires_at: expiresAtSec,
    });
    return { url, expiresAt };
  }

  /** Permanently delete a stored recording (DPDP erasure). */
  async destroy(publicId: string): Promise<void> {
    if (this.mock) {
      this.logger.log(`[mock] destroy ${publicId}`);
      return;
    }
    await cloudinary.uploader.destroy(publicId, { resource_type: 'video', type: 'authenticated' });
  }
}
