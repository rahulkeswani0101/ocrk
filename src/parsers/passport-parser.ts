/**
 * Indian Passport Parser
 */

import { FieldResult, OVDResult } from '../types';
import { OutputSanitizer } from '../security/sanitizer';
import { BaseOVDParser } from './base-parser';

export class PassportParser extends BaseOVDParser {
  constructor(sanitizer: OutputSanitizer) {
    super('passport', sanitizer);
  }

  parse(ocrText: string): OVDResult {
    const startTime = Date.now();
    const text = ocrText;
    const upperText = text.toUpperCase();
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const validationErrors: string[] = [];

    const passportNoField = this.extractPassportNumber(upperText);
    if (!passportNoField.value) {
      validationErrors.push('Passport number not found');
    }

    const nameField = this.extractName(lines);
    const dobField = this.extractDOB(text);
    const genderField = this.extractGender(upperText);
    const expiryField = this.extractExpiry(text);
    const placeOfBirthField = this.extractPlaceOfBirth(lines);
    const nationalityField = this.extractNationality(upperText);

    const fields: Record<string, FieldResult> = {};

    if (passportNoField.confidence > 0) fields.passportNumber = passportNoField;
    if (nameField.confidence > 0) fields.name = nameField;
    if (dobField.confidence > 0) fields.dateOfBirth = dobField;
    if (genderField.confidence > 0) fields.gender = genderField;
    if (expiryField.confidence > 0) fields.expiryDate = expiryField;
    if (placeOfBirthField.confidence > 0) fields.placeOfBirth = placeOfBirthField;
    if (nationalityField.confidence > 0) fields.nationality = nationalityField;

    if (Object.keys(fields).length < 2) {
      validationErrors.push('Could not extract enough fields from image');
    }

    return this.buildResult(fields, validationErrors, startTime);
  }

  private extractPassportNumber(text: string): FieldResult {
    // Indian passport: 1 letter + 7 digits (e.g., J8369854)
    const passportRegex = /\b([A-Z]\d{7})\b/;
    const match = text.match(passportRegex);

    if (match) {
      return this.createField(match[1], 0.93);
    }

    // MRZ line: passport number before <digit>countrycode
    const mrzRegex = /([A-Z][A-Z0-9]\d{6})<?\d/;
    const mrzMatch = text.match(mrzRegex);
    if (mrzMatch) {
      // Correct common OCR errors: B→8 in position 2 if needed
      let num = mrzMatch[1];
      // If 2nd char is a letter but should be digit, try to correct
      if (/^[A-Z][A-Z]\d{6}$/.test(num)) {
        const letterToDigit: Record<string, string> = { 'B': '8', 'O': '0', 'I': '1', 'S': '5', 'G': '6' };
        const corrected = letterToDigit[num[1]];
        if (corrected) {
          num = num[0] + corrected + num.slice(2);
        }
      }
      return this.createField(num, 0.85);
    }

    // Case-insensitive single letter + 7 digits
    const ciRegex = /\b([a-zA-Z])(\d{7})\b/;
    const ciMatch = text.match(ciRegex);
    if (ciMatch) {
      return this.createField(`${ciMatch[1].toUpperCase()}${ciMatch[2]}`, 0.78);
    }

    // Fuzzy: letter + noise + 7 digits 
    const fuzzyRegex = /\b([A-Za-z])\s?(\d{7})\b/;
    const fuzzyMatch = text.match(fuzzyRegex);
    if (fuzzyMatch) {
      return this.createField(`${fuzzyMatch[1].toUpperCase()}${fuzzyMatch[2]}`, 0.65);
    }

    return this.createField(null, 0);
  }

  private extractName(lines: string[]): FieldResult {
    const fullText = lines.join(' ');

    // Try MRZ line first (most reliable) — P<INDSURNAME<<GIVENNAME<<<
    const mrzNameRegex = /P<[A-Z]{3}([A-Z]+)<<([A-Z<]+)/;
    const mrzMatch = fullText.replace(/\s/g, '').match(mrzNameRegex);
    if (mrzMatch) {
      const surname = mrzMatch[1].replace(/</g, ' ').trim();
      const given = mrzMatch[2].replace(/</g, ' ').trim();
      const fullName = `${given} ${surname}`.toLowerCase().split(' ')
        .filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      return this.createField(fullName, 0.90);
    }

    // Pattern: "Given Name" or "Surname" followed by name
    const surnameRegex = /(?:Surname|Sur\s*Name)[^a-zA-Z]*([A-Z][A-Z\s]+)/i;
    const givenRegex = /(?:Given\s*Name|Given\s*Name\(?s?\)?)[^a-zA-Z]*([A-Z][A-Z\s]+)/i;

    const surnameMatch = fullText.match(surnameRegex);
    const givenMatch = fullText.match(givenRegex);

    const parts: string[] = [];
    if (givenMatch && givenMatch[1].trim().length > 1) parts.push(givenMatch[1].trim());
    if (surnameMatch && surnameMatch[1].trim().length > 1) parts.push(surnameMatch[1].trim());

    if (parts.length > 0) {
      const name = parts.join(' ').toLowerCase().split(' ')
        .filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      return this.createField(name, 0.82);
    }

    // Fallback: look for Title Case or UPPERCASE names near "Name" keyword
    for (let i = 0; i < lines.length; i++) {
      const upper = lines[i].toUpperCase();
      if (upper.includes('NAME') || upper.includes('SURNAME')) {
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine.length > 2 && /^[A-Z\s]+$/.test(nextLine)) {
            const name = nextLine.toLowerCase().split(' ')
              .filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
            return this.createField(name, 0.70);
          }
        }
      }
    }

    return this.createField(null, 0);
  }

  private extractDOB(text: string): FieldResult {
    // Passport uses DD/MM/YYYY or DD-MM-YYYY
    const dateRegex = /\b(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\b/g;
    const matches = [...text.matchAll(dateRegex)];

    // First date is usually DOB, second is issue/expiry
    if (matches.length >= 1) {
      return this.createField(matches[0][1], 0.85);
    }

    return this.createField(null, 0);
  }

  private extractExpiry(text: string): FieldResult {
    const upperText = text.toUpperCase();
    
    // Look for "expiry" or "valid till" nearby
    const expiryRegex = /(?:EXPIRY|EXPIRATION|VALID\s*(?:TILL|UNTIL|UPTO))[^0-9]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i;
    const match = upperText.match(expiryRegex);
    if (match) {
      return this.createField(match[1], 0.88);
    }

    // Fallback: if multiple dates found, last one is likely expiry
    const dateRegex = /\b(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\b/g;
    const matches = [...text.matchAll(dateRegex)];
    if (matches.length >= 2) {
      return this.createField(matches[matches.length - 1][1], 0.65);
    }

    return this.createField(null, 0);
  }

  private extractGender(text: string): FieldResult {
    if (text.includes('FEMALE') || text.includes('/F/')) {
      return this.createField('Female', 0.90);
    }
    if (text.includes('MALE') || text.includes('/M/')) {
      return this.createField('Male', 0.90);
    }
    return this.createField(null, 0);
  }

  private extractPlaceOfBirth(lines: string[]): FieldResult {
    for (let i = 0; i < lines.length; i++) {
      const upper = lines[i].toUpperCase();
      if (upper.includes('PLACE OF BIRTH') || upper.includes('BIRTH PLACE')) {
        const afterColon = lines[i].split(/[:/]/).slice(1).join(':').trim();
        if (afterColon && afterColon.length > 2) {
          return this.createField(afterColon, 0.78);
        }
        if (i + 1 < lines.length && lines[i + 1].length > 2) {
          return this.createField(lines[i + 1].trim(), 0.70);
        }
      }
    }
    return this.createField(null, 0);
  }

  private extractNationality(text: string): FieldResult {
    if (text.includes('INDIAN') || text.includes('INDIA')) {
      return this.createField('Indian', 0.90);
    }
    return this.createField(null, 0);
  }
}
