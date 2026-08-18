/**
 * PAN Card Parser
 */

import { FieldResult, OVDResult } from '../types';
import { OutputSanitizer } from '../security/sanitizer';
import { BaseOVDParser } from './base-parser';

export class PANParser extends BaseOVDParser {
  constructor(sanitizer: OutputSanitizer) {
    super('pan', sanitizer);
  }

  parse(ocrText: string): OVDResult {
    const startTime = Date.now();
    const upperText = ocrText.toUpperCase();
    const lines = ocrText.split('\n').map((l) => l.trim()).filter(Boolean);
    const validationErrors: string[] = [];

    // Extract PAN number (from uppercase text for better matching)
    const panField = this.extractPAN(upperText);
    if (!panField.value) {
      validationErrors.push('PAN number not found or invalid format');
    }

    // Extract Name (use original case lines)
    const nameField = this.extractName(lines);

    // Extract Father's Name
    const fatherNameField = this.extractFatherName(lines);

    // Extract Date of Birth
    const dobField = this.extractDOB(ocrText);

    const fields: Record<string, FieldResult> = {
      panNumber: panField,
      name: nameField,
      fatherName: fatherNameField,
      dateOfBirth: dobField,
    };

    // Additional validation
    if (panField.value) {
      const panValidation = this.sanitizer.sanitizePAN(panField.value);
      if (!panValidation) {
        validationErrors.push('PAN number failed format validation');
        fields.panNumber = { ...panField, confidence: panField.confidence * 0.5 };
      }
    }

    return this.buildResult(fields, validationErrors, startTime);
  }

  private extractPAN(text: string): FieldResult {
    // PAN format: 5 letters + 4 digits + 1 letter
    const panRegex = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/;
    const match = text.match(panRegex);

    if (!match) {
      // Try with common OCR mistakes (0 vs O, 1 vs I)
      const fuzzyRegex = /\b([A-Z0-9]{5}[0-9]{4}[A-Z0-9])\b/;
      const fuzzyMatch = text.match(fuzzyRegex);
      if (fuzzyMatch) {
        return this.createField(fuzzyMatch[1], 0.6);
      }
      return this.createField(null, 0);
    }

    // High confidence if perfect match
    return this.createField(match[1], 0.95);
  }

  private extractName(lines: string[]): FieldResult {
    const fullText = lines.join(' ');
    
    // Pattern 1: "Name" immediately followed by the actual name (no space/newline)
    // e.g., "NameSample Kumar" or "Name Sample Kumar"
    const nameDirectRegex = /Name\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/;
    const directMatch = fullText.match(nameDirectRegex);
    if (directMatch && directMatch[1] && !this.isLabel(directMatch[1])) {
      return this.createField(this.formatName(directMatch[1]), 0.85);
    }

    // Pattern 2: Look line by line for "Name" keyword
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const upperLine = line.toUpperCase();
      
      if (
        (upperLine.includes('NAME') || upperLine.includes('NAM')) &&
        !upperLine.includes('FATHER') &&
        !upperLine.includes("FATHER'S")
      ) {
        // Try to extract name from same line after "Name" keyword
        const afterName = line.replace(/.*[Nn][Aa][Mm][Ee]\s*/,'').trim();
        if (afterName.length > 2 && !this.isLabel(afterName)) {
          return this.createField(this.formatName(afterName), 0.85);
        }

        // Check next line
        if (i + 1 < lines.length && this.isLikelyName(lines[i + 1])) {
          return this.createField(this.formatName(lines[i + 1]), 0.80);
        }
        
        // Check 2 lines ahead
        if (i + 2 < lines.length && this.isLikelyName(lines[i + 2])) {
          return this.createField(this.formatName(lines[i + 2]), 0.70);
        }
      }
    }

    // Fallback: try to find a name-like pattern in first few lines
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      if (this.isLikelyName(lines[i]) && !lines[i].includes('INCOME TAX') && !lines[i].includes('GOVT')) {
        return this.createField(this.formatName(lines[i]), 0.5);
      }
    }

    return this.createField(null, 0);
  }

  private extractFatherName(lines: string[]): FieldResult {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const upperLine = line.toUpperCase();
      
      if (upperLine.includes('FATHER') || upperLine.includes("FATHER'S")) {
        // Name might be on same line or next line
        const afterColon = line.split(/[:/]/).slice(1).join(':').trim();
        const isJustLabel = /^(father'?s?\s*name|पिता का नाम)\s*$/i.test(afterColon);
        
        if (afterColon && afterColon.length > 2 && !isJustLabel) {
          return this.createField(this.formatName(afterColon), 0.85);
        }
        if (i + 1 < lines.length && this.isLikelyName(lines[i + 1])) {
          return this.createField(this.formatName(lines[i + 1]), 0.80);
        }
        if (i + 2 < lines.length && this.isLikelyName(lines[i + 2])) {
          return this.createField(this.formatName(lines[i + 2]), 0.65);
        }
      }
    }

    return this.createField(null, 0);
  }

  private extractDOB(text: string): FieldResult {
    // Common date formats on PAN cards: DD/MM/YYYY, DD-MM-YYYY
    // Also handle OCR noise like "101/01/2002" (extra digit prefix)
    const dateRegex = /\b(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\b/;
    const match = text.match(dateRegex);

    if (match) {
      const dateStr = match[1];
      if (this.isValidDate(dateStr)) {
        return this.createField(dateStr, 0.90);
      }
      return this.createField(dateStr, 0.6);
    }

    // Fallback: try to find date with extra noise chars before it
    const noisyDateRegex = /\d?(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/;
    const noisyMatch = text.match(noisyDateRegex);
    if (noisyMatch) {
      const dateStr = noisyMatch[1];
      if (this.isValidDate(dateStr)) {
        return this.createField(dateStr, 0.75);
      }
    }

    return this.createField(null, 0);
  }

  private isLikelyName(text: string): boolean {
    // A name is likely all letters and spaces, 3+ chars, not a known label
    const cleaned = text.replace(/[^a-zA-Z\s]/g, '').trim();
    if (cleaned.length < 3 || cleaned.split(' ').length < 1) return false;
    
    // Reject known labels/headers
    return !this.isLabel(cleaned);
  }

  private isLabel(text: string): boolean {
    const upper = text.toUpperCase().trim();
    const labels = ['INCOME TAX', 'GOVT', 'GOVERNMENT', 'INDIA', 'DEPARTMENT', 'PERMANENT', 'ACCOUNT', 'NUMBER', 'DATE', 'BIRTH', 'SIGNATURE', 'NAME', 'FATHER', 'NAAM'];
    return labels.some((label) => upper === label || upper === label + 'S');
  }

  private formatName(name: string): string {
    // Title case formatting
    return name
      .toLowerCase()
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private isValidDate(dateStr: string): boolean {
    const parts = dateStr.split(/[\/\-\.]/);
    if (parts.length !== 3) return false;

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);

    return day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2010;
  }
}
