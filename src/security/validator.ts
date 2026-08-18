import * as fs from 'fs';
import * as path from 'path';
import { SecurityConfig } from '../types';

const MAGIC_BYTES: Record<string, Buffer[]> = {
  'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
  'image/webp': [Buffer.from('RIFF'), Buffer.from('WEBP')],
  'image/tiff': [Buffer.from([0x49, 0x49, 0x2A, 0x00]), Buffer.from([0x4D, 0x4D, 0x00, 0x2A])],
};

const DEFAULT_CONFIG: Required<SecurityConfig> = {
  maxFileSize: 10 * 1024 * 1024,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/tiff'],
  sanitizeOutput: true,
  secureMemoryWipe: true,
  maxImageDimension: 10000,
};

export class SecurityValidator {
  private config: Required<SecurityConfig>;

  constructor(config?: SecurityConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async validateFile(input: string | Buffer): Promise<Buffer> {
    let buffer: Buffer;

    if (typeof input === 'string') {
      this.validatePath(input);

      if (!fs.existsSync(input)) {
        throw new SecurityError('FILE_NOT_FOUND', 'File does not exist');
      }

      const stats = fs.statSync(input);
      if (stats.size > this.config.maxFileSize) {
        throw new SecurityError('FILE_TOO_LARGE', `File size ${stats.size} exceeds limit`);
      }

      buffer = fs.readFileSync(input);
    } else {
      buffer = input;
    }

    if (buffer.length > this.config.maxFileSize) {
      throw new SecurityError('FILE_TOO_LARGE', `Buffer size ${buffer.length} exceeds limit`);
    }

    if (buffer.length === 0) {
      throw new SecurityError('EMPTY_FILE', 'File is empty');
    }

    const detectedType = this.detectMimeType(buffer);
    if (!detectedType) {
      throw new SecurityError('INVALID_FILE_TYPE', 'File type could not be determined from content. Only JPEG, PNG, WebP, and TIFF are supported.');
    }

    if (!this.config.allowedMimeTypes.includes(detectedType)) {
      throw new SecurityError('DISALLOWED_FILE_TYPE', `File type ${detectedType} is not allowed`);
    }

    return buffer;
  }

  private detectMimeType(buffer: Buffer): string | null {
    for (const [mimeType, signatures] of Object.entries(MAGIC_BYTES)) {
      if (mimeType === 'image/webp') {
        if (buffer.length >= 12 && buffer.subarray(0, 4).equals(signatures[0]) && buffer.subarray(8, 12).equals(signatures[1])) {
          return mimeType;
        }
      } else {
        for (const sig of signatures) {
          if (buffer.length >= sig.length && buffer.subarray(0, sig.length).equals(sig)) {
            return mimeType;
          }
        }
      }
    }
    return null;
  }

  private validatePath(filePath: string): void {
    if (filePath.includes('\0')) {
      throw new SecurityError('NULL_BYTE_INJECTION', 'Null byte detected in file path');
    }

    const resolved = path.resolve(filePath);
    const normalized = path.normalize(filePath);

    if (normalized.includes('..')) {
      throw new SecurityError('PATH_TRAVERSAL', 'Path traversal detected');
    }

    if (resolved.startsWith('/dev/') || resolved.startsWith('/proc/') || resolved.startsWith('/sys/')) {
      throw new SecurityError('RESTRICTED_PATH', 'Access to device/system files is not allowed');
    }

    const blocked = ['/etc', '/usr', '/bin', '/sbin', '/var', '/sys', '/proc'];
    for (const dir of blocked) {
      if (resolved.startsWith(dir)) {
        throw new SecurityError('RESTRICTED_PATH', `Access to ${dir} is not allowed`);
      }
    }

    try {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) {
        throw new SecurityError('SYMLINK_NOT_ALLOWED', 'Symbolic links are not allowed');
      }
    } catch (e: any) {
      if (e.code !== 'ENOENT' && e instanceof SecurityError) throw e;
    }
  }

  sanitizeText(text: string): string {
    if (!this.config.sanitizeOutput) return text;
    return text.replace(/\0/g, '').replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').substring(0, 100_000);
  }

  secureWipe(buffer: Buffer): void {
    if (!this.config.secureMemoryWipe) return;
    buffer.fill(0x00);
    buffer.fill(0xFF);
    buffer.fill(0x00);
  }

  getConfig(): Readonly<Required<SecurityConfig>> {
    return Object.freeze({ ...this.config });
  }
}

export class SecurityError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
    if (Error.captureStackTrace) Error.captureStackTrace(this, SecurityError);
  }
}
