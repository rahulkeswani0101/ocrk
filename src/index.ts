import { OCREngine } from './engine/ocr-engine';
import { ImagePreprocessor } from './engine/image-preprocessor';
import { SecurityValidator } from './security/validator';
import { OutputSanitizer } from './security/sanitizer';
import { PANParser } from './parsers/pan-parser';
import { AadhaarParser } from './parsers/aadhaar-parser';
import { ChequeParser } from './parsers/cheque-parser';
import { PassportParser } from './parsers/passport-parser';
import { VoterIDParser } from './parsers/voterid-parser';
import { OCRResult, OVDResult, OVDType, ProcessingOptions, SecurityConfig } from './types';

export interface ToolkitOptions {
  security?: SecurityConfig;
  maskSensitiveData?: boolean;
}

export class OCRToolkit {
  private engine: OCREngine;
  private preprocessor: ImagePreprocessor;
  private validator: SecurityValidator;
  private sanitizer: OutputSanitizer;
  private maskSensitiveData: boolean;

  constructor(options?: ToolkitOptions) {
    this.validator = new SecurityValidator(options?.security);
    this.sanitizer = new OutputSanitizer();
    this.engine = new OCREngine(this.validator, this.sanitizer);
    this.preprocessor = new ImagePreprocessor();
    this.maskSensitiveData = options?.maskSensitiveData ?? true;
  }

  async extractText(input: string | Buffer, options?: ProcessingOptions): Promise<OCRResult> {
    const imageBuffer = await this.validator.validateFile(input);

    let processBuffer: Buffer;

    if (options?.preprocess !== false) {
      const preprocessed = await this.preprocessor.preprocess(imageBuffer);
      processBuffer = preprocessed.buffer;
      this.validator.secureWipe(imageBuffer);
    } else {
      processBuffer = imageBuffer;
    }

    try {
      return await this.engine.extractTextFromValidated(processBuffer, options);
    } finally {
      this.validator.secureWipe(processBuffer);
    }
  }

  async parseOVD(input: string | Buffer, documentType: OVDType, options?: ProcessingOptions): Promise<OVDResult> {
    const ocrResult = await this.extractText(input, { ...options, preprocess: true });
    const parser = this.getParser(documentType);
    return parser.parse(ocrResult.text);
  }

  private getParser(type: OVDType) {
    switch (type) {
      case 'pan':
        return new PANParser(this.sanitizer);
      case 'aadhaar':
        return new AadhaarParser(this.sanitizer, { maskAadhaar: this.maskSensitiveData });
      case 'cheque':
        return new ChequeParser(this.sanitizer);
      case 'passport':
        return new PassportParser(this.sanitizer);
      case 'voter-id':
        return new VoterIDParser(this.sanitizer);
      default:
        throw new Error(`Unsupported document type: ${type}. Supported: pan, aadhaar, cheque, passport, voter-id`);
    }
  }

  getSecurityConfig() {
    return this.validator.getConfig();
  }
}

export { SecurityValidator, SecurityError } from './security/validator';
export { OutputSanitizer } from './security/sanitizer';
export { OCREngine } from './engine/ocr-engine';
export { ImagePreprocessor } from './engine/image-preprocessor';
export { PANParser } from './parsers/pan-parser';
export { AadhaarParser } from './parsers/aadhaar-parser';
export { ChequeParser } from './parsers/cheque-parser';
export { PassportParser } from './parsers/passport-parser';
export { VoterIDParser } from './parsers/voterid-parser';
export { BaseOVDParser } from './parsers/base-parser';

export type {
  OCRResult, OVDResult, OVDType, FieldResult, BoundingBox,
  WordResult, ProcessingOptions, SecurityConfig,
} from './types';
