import sharp from 'sharp';

export interface PreprocessResult {
  buffer: Buffer;
  originalDimensions: { width: number; height: number };
  processedDimensions: { width: number; height: number };
}

export class ImagePreprocessor {
  private maxDimension: number;

  constructor(maxDimension: number = 4000) {
    this.maxDimension = maxDimension;
  }

  async preprocess(imageBuffer: Buffer): Promise<PreprocessResult> {
    const metadata = await sharp(imageBuffer).metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;

    if (originalWidth > 10000 || originalHeight > 10000) {
      throw new Error(
        `Image dimensions ${originalWidth}x${originalHeight} exceed maximum allowed (10000x10000)`
      );
    }

    let pipeline = sharp(imageBuffer);

    if (originalWidth > this.maxDimension || originalHeight > this.maxDimension) {
      pipeline = pipeline.resize(this.maxDimension, this.maxDimension, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    pipeline = pipeline.grayscale();
    pipeline = pipeline.normalize();
    pipeline = pipeline.sharpen({ sigma: 1.5 });

    const processedBuffer = await pipeline.png().toBuffer();
    const processedMetadata = await sharp(processedBuffer).metadata();

    return {
      buffer: processedBuffer,
      originalDimensions: { width: originalWidth, height: originalHeight },
      processedDimensions: {
        width: processedMetadata.width || 0,
        height: processedMetadata.height || 0,
      },
    };
  }

  async quickValidate(imageBuffer: Buffer): Promise<boolean> {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      return !!(metadata.width && metadata.height && metadata.format);
    } catch {
      return false;
    }
  }
}
