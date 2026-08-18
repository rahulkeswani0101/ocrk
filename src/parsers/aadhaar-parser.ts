/**
 * Aadhaar Card Parser
 * Handles front, back, or merged images — auto-detects and extracts available fields.
 */

import { FieldResult, OVDResult } from '../types';
import { OutputSanitizer } from '../security/sanitizer';
import { BaseOVDParser } from './base-parser';

export interface AadhaarParseOptions {
  maskAadhaar?: boolean;
}

export class AadhaarParser extends BaseOVDParser {
  private maskAadhaar: boolean;

  constructor(sanitizer: OutputSanitizer, options?: AadhaarParseOptions) {
    super('aadhaar', sanitizer);
    this.maskAadhaar = options?.maskAadhaar ?? true;
  }

  parse(ocrText: string): OVDResult {
    const startTime = Date.now();
    const text = ocrText;
    const upperText = text.toUpperCase();
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const validationErrors: string[] = [];

    // Always try to extract Aadhaar number (present on both sides)
    const aadhaarField = this.extractAadhaarNumber(text);

    // Try all fields — only include what's found
    const fields: Record<string, FieldResult> = {};

    if (aadhaarField.confidence > 0) {
      fields.aadhaarNumber = aadhaarField;
    } else {
      validationErrors.push('Aadhaar number not found');
    }

    // Front side fields
    const nameField = this.extractName(lines);
    if (nameField.confidence > 0) fields.name = nameField;

    const dobField = this.extractDOB(text);
    if (dobField.confidence > 0) fields.dateOfBirth = dobField;

    const genderField = this.extractGender(upperText);
    if (genderField.confidence > 0) fields.gender = genderField;

    // Back side fields
    const addressField = this.extractAddress(lines);
    if (addressField.confidence > 0) fields.address = addressField;

    const pinCodeField = this.extractPinCode(text);
    if (pinCodeField.confidence > 0) fields.pinCode = pinCodeField;

    // Must have at least Aadhaar number + 1 other field
    if (Object.keys(fields).length < 2) {
      validationErrors.push('Could not extract enough fields from image');
    }

    return this.buildResult(fields, validationErrors, startTime);
  }

  private extractAadhaarNumber(text: string): FieldResult {
    // Format: 4 digits + space + 4 digits + space + 4 digits (first digit 2-9)
    const aadhaarRegex = /\b([2-9]\d{3}\s?\d{4}\s?\d{4})\b/;
    const match = text.match(aadhaarRegex);

    if (!match) {
      // Try finding 12-digit sequence in all digits
      const digitsOnly = text.replace(/\D/g, '');
      const twelveDigitRegex = /([2-9]\d{11})/;
      const fallbackMatch = digitsOnly.match(twelveDigitRegex);

      if (fallbackMatch) {
        return this.createField(this.formatAndMask(fallbackMatch[1]), 0.6);
      }
      return this.createField(null, 0);
    }

    const rawNumber = match[1].replace(/\s/g, '');
    return this.createField(this.formatAndMask(rawNumber), 0.92);
  }

  private formatAndMask(number: string): string {
    if (this.maskAadhaar) {
      return `XXXX XXXX ${number.slice(8)}`;
    }
    return `${number.slice(0, 4)} ${number.slice(4, 8)} ${number.slice(8)}`;
  }

  private extractName(lines: string[]): FieldResult {
    const fullText = lines.join(' ');

    // Pattern: "Name" (or OCR variants like "Nane") followed by actual name in Title Case
    const namePatterns = [
      /[Nn][Aa][Mm][Ee]?\s*[^a-zA-Z]*\s*,?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,
      /[Nn][Aa][Mm][Ee]?\s*[:/]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,
      /[Nn][Aa][Nn][Ee]?\s*[^a-zA-Z]*\s*,?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,
    ];

    for (const pattern of namePatterns) {
      const match = fullText.match(pattern);
      if (match && match[1] && match[1].length > 3) {
        return this.createField(match[1].trim(), 0.85);
      }
    }

    // Line by line
    for (let i = 0; i < lines.length; i++) {
      const upper = lines[i].toUpperCase();
      if ((upper.includes('NAME') || upper.includes('NANE') || upper.includes('NAM'))
        && !upper.includes('GOVERNMENT') && !upper.includes('INDIA')) {

        const cleanNames = lines[i].match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
        if (cleanNames && cleanNames[1].length > 3) {
          return this.createField(cleanNames[1].trim(), 0.80);
        }

        if (i + 1 < lines.length) {
          const nextClean = lines[i + 1].match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
          if (nextClean && nextClean[1].length > 3) {
            return this.createField(nextClean[1].trim(), 0.75);
          }
        }
      }
    }

    // Fallback: any Title Case name pattern
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      const nameMatch = lines[i].match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
      if (nameMatch && nameMatch[1].length > 3 &&
        !/GOVERNMENT|INDIA|UIDAI|AADHAAR/i.test(lines[i])) {
        return this.createField(nameMatch[1].trim(), 0.60);
      }
    }

    return this.createField(null, 0);
  }

  private extractDOB(text: string): FieldResult {
    const dateRegex = /\b(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\b/;
    const yearRegex = /(?:year\s*(?:of\s*)?birth|yob)[:\s]*(\d{4})/i;

    const dateMatch = text.match(dateRegex);
    if (dateMatch) {
      return this.createField(dateMatch[1], 0.88);
    }

    const yearMatch = text.match(yearRegex);
    if (yearMatch) {
      return this.createField(yearMatch[1], 0.85);
    }

    return this.createField(null, 0);
  }

  private extractGender(text: string): FieldResult {
    if (text.includes('FEMALE')) {
      return this.createField('Female', 0.90);
    }
    if (text.includes('MALE')) {
      return this.createField('Male', 0.90);
    }
    if (text.includes('TRANSGENDER')) {
      return this.createField('Transgender', 0.90);
    }
    return this.createField(null, 0);
  }

  private extractAddress(lines: string[]): FieldResult {
    const addressKeywords = ['S/O', 'D/O', 'W/O', 'C/O', 'ADDRESS'];
    let addressStart = -1;

    for (let i = 0; i < lines.length; i++) {
      const upperLine = lines[i].toUpperCase();
      if (addressKeywords.some((kw) => upperLine.includes(kw))) {
        addressStart = i;
        break;
      }
    }

    if (addressStart === -1) return this.createField(null, 0);

    // Collect address lines (usually 2-5 lines)
    const addressLines: string[] = [];
    for (let i = addressStart; i < Math.min(addressStart + 6, lines.length); i++) {
      const line = lines[i];
      // Stop at Aadhaar number pattern
      if (/\b\d{4}\s?\d{4}\s?\d{4}\b/.test(line)) break;
      addressLines.push(line);
    }

    if (addressLines.length === 0) return this.createField(null, 0);
    return this.createField(addressLines.join(', '), 0.72);
  }

  private extractPinCode(text: string): FieldResult {
    // Indian pin code: 6 digits, first digit 1-9
    const pinRegex = /\b([1-9]\d{5})\b/;
    const match = text.match(pinRegex);

    if (!match) return this.createField(null, 0);

    // Make sure it's not part of Aadhaar number
    const index = text.indexOf(match[1]);
    const surrounding = text.substring(Math.max(0, index - 5), index + 10);
    if (/\d{12}/.test(surrounding.replace(/\s/g, ''))) {
      return this.createField(null, 0);
    }

    return this.createField(match[1], 0.80);
  }
}
