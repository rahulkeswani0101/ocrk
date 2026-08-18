export interface FieldResult {
  value: string;
  confidence: number;
  bbox?: BoundingBox;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OCRResult {
  text: string;
  confidence: number;
  processingTimeMs: number;
  words?: WordResult[];
}

export interface WordResult {
  text: string;
  confidence: number;
  bbox: BoundingBox;
}

export interface OVDResult {
  documentType: OVDType;
  documentConfidence: number;
  fields: Record<string, FieldResult>;
  isValid: boolean;
  validationErrors: string[];
  processingTimeMs: number;
}

export type OVDType = 'pan' | 'aadhaar' | 'cheque';

export interface ProcessingOptions {
  languages?: string[];
  preprocess?: boolean;
  dpi?: number;
  includeBoundingBoxes?: boolean;
}

export interface SecurityConfig {
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  sanitizeOutput?: boolean;
  secureMemoryWipe?: boolean;
  maxImageDimension?: number;
}
