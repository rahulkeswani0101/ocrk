import Tesseract from 'tesseract.js';
import { OCRResult, ProcessingOptions, WordResult } from '../types';
import { SecurityValidator } from '../security/validator';
import { OutputSanitizer } from '../security/sanitizer';

const DEFAULT_OPTIONS: ProcessingOptions = {
  languages: ['eng'],
  preprocess: true,
  dpi: 300,
  includeBoundingBoxes: false,
};

const PROCESSING_TIMEOUT_MS = 30_000;

export class OCREngine {
  private validator: SecurityValidator;
  private sanitizer: OutputSanitizer;

  constructor(validator: SecurityValidator, sanitizer: OutputSanitizer) {
    this.validator = validator;
    this.sanitizer = sanitizer;
  }

  async extractText(input: string | Buffer, options?: ProcessingOptions): Promise<OCRResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();
    const imageBuffer = await this.validator.validateFile(input);

    try {
      return await this.processAndReturn(imageBuffer, opts, startTime);
    } finally {
      this.validator.secureWipe(imageBuffer);
    }
  }

  async extractTextFromValidated(imageBuffer: Buffer, options?: ProcessingOptions): Promise<OCRResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    return await this.processAndReturn(imageBuffer, opts, Date.now());
  }

  private async processAndReturn(imageBuffer: Buffer, opts: ProcessingOptions, startTime: number): Promise<OCRResult> {
    const result = await this.withTimeout(
      this.processImage(imageBuffer, opts),
      PROCESSING_TIMEOUT_MS
    );

    const processingTimeMs = Date.now() - startTime;

    let words: WordResult[] | undefined;
    if (opts.includeBoundingBoxes && result.data.words) {
      words = result.data.words.map((word) => ({
        text: this.sanitizer.sanitizeField(word.text, 100),
        confidence: word.confidence / 100,
        bbox: {
          x: word.bbox.x0,
          y: word.bbox.y0,
          width: word.bbox.x1 - word.bbox.x0,
          height: word.bbox.y1 - word.bbox.y0,
        },
      }));
    }

    return {
      text: this.sanitizer.sanitize(result.data.text),
      confidence: result.data.confidence / 100,
      processingTimeMs,
      words,
    };
  }

  private async processImage(imageBuffer: Buffer, options: ProcessingOptions): Promise<Tesseract.RecognizeResult> {
    const langs = options.languages?.join('+') || 'eng';
    return await Tesseract.recognize(imageBuffer, langs, { logger: () => {} });
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`OCR processing timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => { clearTimeout(timer); resolve(result); })
        .catch((error) => { clearTimeout(timer); reject(error); });
    });
  }
}
