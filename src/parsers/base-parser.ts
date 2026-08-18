import { FieldResult, OVDResult, OVDType } from '../types';
import { OutputSanitizer } from '../security/sanitizer';

export abstract class BaseOVDParser {
  protected sanitizer: OutputSanitizer;
  protected documentType: OVDType;

  constructor(documentType: OVDType, sanitizer: OutputSanitizer) {
    this.documentType = documentType;
    this.sanitizer = sanitizer;
  }

  abstract parse(ocrText: string, wordConfidences?: Map<string, number>): OVDResult;

  protected calculateDocumentConfidence(fields: Record<string, FieldResult>): number {
    const all = Object.values(fields);
    if (all.length === 0) return 0;

    const found = all.filter((f) => f.confidence > 0);
    if (found.length === 0) return 0;

    const avg = found.reduce((sum, f) => sum + f.confidence, 0) / found.length;
    const completeness = found.length / all.length;

    return Math.max(0, Math.min(1, avg * 0.8 + completeness * 0.2));
  }

  protected createField(value: string | null, confidence: number, maxLength: number = 200): FieldResult {
    if (!value) return { value: '', confidence: 0 };
    return {
      value: this.sanitizer.sanitizeField(value, maxLength),
      confidence: Math.max(0, Math.min(1, confidence)),
    };
  }

  protected extractPattern(text: string, pattern: RegExp, baseConfidence: number = 0.8): { value: string; confidence: number } | null {
    const match = text.match(pattern);
    if (!match) return null;
    return { value: match[1] || match[0], confidence: baseConfidence };
  }

  protected buildResult(fields: Record<string, FieldResult>, validationErrors: string[], startTime: number): OVDResult {
    return {
      documentType: this.documentType,
      documentConfidence: this.calculateDocumentConfidence(fields),
      fields,
      isValid: validationErrors.length === 0 && this.calculateDocumentConfidence(fields) > 0.5,
      validationErrors,
      processingTimeMs: Date.now() - startTime,
    };
  }
}
