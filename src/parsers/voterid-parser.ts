/**
 * Voter ID (EPIC) Parser
 */

import { FieldResult, OVDResult } from '../types';
import { OutputSanitizer } from '../security/sanitizer';
import { BaseOVDParser } from './base-parser';

export class VoterIDParser extends BaseOVDParser {
  constructor(sanitizer: OutputSanitizer) {
    super('voter-id', sanitizer);
  }

  parse(ocrText: string): OVDResult {
    const startTime = Date.now();
    const text = ocrText;
    const upperText = text.toUpperCase();
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const validationErrors: string[] = [];

    const epicField = this.extractEPIC(upperText);
    if (!epicField.value) {
      validationErrors.push('EPIC number not found');
    }

    const nameField = this.extractName(lines);
    const fatherNameField = this.extractRelationName(lines);
    const dobField = this.extractDOB(text);
    const genderField = this.extractGender(upperText);
    const addressField = this.extractAddress(lines);

    const fields: Record<string, FieldResult> = {};

    if (epicField.confidence > 0) fields.epicNumber = epicField;
    if (nameField.confidence > 0) fields.name = nameField;
    if (fatherNameField.confidence > 0) fields.fatherOrHusbandName = fatherNameField;
    if (dobField.confidence > 0) fields.dateOfBirth = dobField;
    if (genderField.confidence > 0) fields.gender = genderField;
    if (addressField.confidence > 0) fields.address = addressField;

    if (Object.keys(fields).length < 2) {
      validationErrors.push('Could not extract enough fields from image');
    }

    return this.buildResult(fields, validationErrors, startTime);
  }

  private extractEPIC(text: string): FieldResult {
    // EPIC format: 3 letters + 7 digits (e.g., ABC1234567)
    const epicRegex = /\b([A-Z]{3}\d{7})\b/;
    const match = text.match(epicRegex);

    if (!match) {
      // Try with spaces
      const fuzzyRegex = /\b([A-Z]{3})\s*(\d{7})\b/;
      const fuzzyMatch = text.match(fuzzyRegex);
      if (fuzzyMatch) {
        return this.createField(`${fuzzyMatch[1]}${fuzzyMatch[2]}`, 0.75);
      }
      return this.createField(null, 0);
    }

    return this.createField(match[1], 0.93);
  }

  private extractName(lines: string[]): FieldResult {
    const fullText = lines.join(' ');

    // Pattern: "ELECTOR'S NAME" or "Elector Name" followed by name
    const namePatterns = [
      /(?:ELECTOR'?S?\s*NAME|ELECTOR\s*NAME)\s*[:\-]?\s*([A-Z][A-Z\s]+?)(?:\s+(?:FATHER|FAT|SEX|DATE|AGE|\n|$))/i,
      /(?:ELECTOR'?S?\s*NAME|ELECTOR\s*NAME)\s*[:\-]?\s*([A-Z][a-zA-Z\s]+?)(?:\s+(?:FATHER|FAT|SEX|DATE|AGE|\n|$))/i,
    ];

    for (const pattern of namePatterns) {
      const match = fullText.match(pattern);
      if (match && match[1] && match[1].trim().length > 2) {
        const name = this.cleanName(match[1]);
        if (name) return this.createField(name, 0.85);
      }
    }

    // Fallback: generic "Name" keyword
    const genericPattern = /(?:Elector'?s?\s*)?Name\s*[:\-]?\s*([A-Z][A-Z\s]{3,40})/i;
    const genericMatch = fullText.match(genericPattern);
    if (genericMatch && genericMatch[1]) {
      const name = this.cleanName(genericMatch[1]);
      if (name) return this.createField(name, 0.78);
    }

    // Line by line
    for (let i = 0; i < lines.length; i++) {
      const upper = lines[i].toUpperCase();
      if ((upper.includes('NAME') || upper.includes('ELECTOR')) && !upper.includes('FATHER') && !upper.includes('HUSBAND')) {
        // Check same line after colon
        const afterColon = lines[i].split(/[:\-]/).slice(1).join(':').trim();
        if (afterColon.length > 2) {
          const name = this.cleanName(afterColon);
          if (name) return this.createField(name, 0.80);
        }
        // Next line
        if (i + 1 < lines.length) {
          const name = this.cleanName(lines[i + 1]);
          if (name) return this.createField(name, 0.75);
        }
      }
    }

    return this.createField(null, 0);
  }

  private extractRelationName(lines: string[]): FieldResult {
    const fullText = lines.join(' ');

    // Pattern: "FATHER'S NAME" or "HUSBAND'S NAME" followed by name
    const patterns = [
      /(?:FATHER'?S?\s*NAME|HUSBAND'?S?\s*NAME)\s*[:\-]?\s*([A-Z][A-Z\s]+?)(?:\s+(?:FAT|SEX|DATE|AGE|MALE|FEMALE|\n|$))/i,
    ];

    for (const pattern of patterns) {
      const match = fullText.match(pattern);
      if (match && match[1] && match[1].trim().length > 2) {
        const name = this.cleanName(match[1]);
        if (name) return this.createField(name, 0.82);
      }
    }

    // Line by line
    for (let i = 0; i < lines.length; i++) {
      const upper = lines[i].toUpperCase();
      if (upper.includes('FATHER') || upper.includes('HUSBAND')) {
        const afterColon = lines[i].split(/[:\-]/).slice(1).join(':').trim();
        if (afterColon.length > 2) {
          const name = this.cleanName(afterColon);
          if (name) return this.createField(name, 0.80);
        }
        if (i + 1 < lines.length) {
          const name = this.cleanName(lines[i + 1]);
          if (name) return this.createField(name, 0.72);
        }
      }
    }

    return this.createField(null, 0);
  }

  private cleanName(raw: string): string | null {
    // Remove non-English characters (Hindi, etc.) and known labels
    let cleaned = raw
      .replace(/[^a-zA-Z\s]/g, '')
      .replace(/\b(FATHER|HUSBAND|ELECTOR|NAME|SEX|MALE|FEMALE|DATE|BIRTH|AGE|FAT|ELECTION|COMMISSION|INDIA)\b/gi, '')
      .trim();

    // Collapse multiple spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    if (cleaned.length < 3) return null;

    // Title case
    return cleaned.toLowerCase().split(' ').filter(Boolean)
      .map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  }

  private extractDOB(text: string): FieldResult {
    // Look for "Date of Birth" or "DOB" or "Age" label
    const dobLabelRegex = /(?:Date\s*of\s*Birth|DOB|D\.O\.B)[^0-9]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i;
    const labelMatch = text.match(dobLabelRegex);
    if (labelMatch) {
      return this.createField(labelMatch[1], 0.88);
    }

    // Fallback: any date
    const dateRegex = /\b(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\b/;
    const match = text.match(dateRegex);
    if (match) {
      return this.createField(match[1], 0.65);
    }

    // Age-based (some old voter IDs show age instead of DOB)
    const ageRegex = /(?:Age|AGE)[^0-9]*(\d{2})/;
    const ageMatch = text.match(ageRegex);
    if (ageMatch) {
      return this.createField(`Age: ${ageMatch[1]}`, 0.60);
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
    return this.createField(null, 0);
  }

  private extractAddress(lines: string[]): FieldResult {
    let addressStart = -1;

    for (let i = 0; i < lines.length; i++) {
      const upper = lines[i].toUpperCase();
      if (upper.includes('ADDRESS') || upper.includes('ADDR')) {
        addressStart = i;
        break;
      }
    }

    if (addressStart === -1) return this.createField(null, 0);

    const addressLines: string[] = [];
    for (let i = addressStart; i < Math.min(addressStart + 5, lines.length); i++) {
      const line = lines[i];
      // Stop at EPIC number or other field labels
      if (/\b[A-Z]{3}\d{7}\b/.test(line)) break;
      addressLines.push(line);
    }

    if (addressLines.length === 0) return this.createField(null, 0);
    return this.createField(addressLines.join(', '), 0.68);
  }
}
