/**
 * Bank Cheque Parser
 */

import { FieldResult, OVDResult } from '../types';
import { OutputSanitizer } from '../security/sanitizer';
import { BaseOVDParser } from './base-parser';

export class ChequeParser extends BaseOVDParser {
  // Known Indian banks
  private static readonly KNOWN_BANKS: Array<{ names: string[]; canonical: string }> = [
    { names: ['STATE BANK OF INDIA', 'SBI'], canonical: 'State Bank of India' },
    { names: ['HDFC BANK', 'HDFC BANK LTD'], canonical: 'HDFC Bank' },
    { names: ['ICICI BANK', 'ICICI BANK LTD'], canonical: 'ICICI Bank' },
    { names: ['AXIS BANK', 'AXIS BANK LTD'], canonical: 'Axis Bank' },
    { names: ['KOTAK MAHINDRA BANK', 'KOTAK BANK'], canonical: 'Kotak Mahindra Bank' },
    { names: ['YES BANK'], canonical: 'Yes Bank' },
    { names: ['INDUSIND BANK'], canonical: 'IndusInd Bank' },
    { names: ['PUNJAB NATIONAL BANK', 'PNB'], canonical: 'Punjab National Bank' },
    { names: ['BANK OF BARODA', 'BOB'], canonical: 'Bank of Baroda' },
    { names: ['CANARA BANK'], canonical: 'Canara Bank' },
    { names: ['UNION BANK OF INDIA', 'UNION BANK'], canonical: 'Union Bank of India' },
    { names: ['IDBI BANK'], canonical: 'IDBI Bank' },
    { names: ['FEDERAL BANK'], canonical: 'Federal Bank' },
    { names: ['INDIAN BANK'], canonical: 'Indian Bank' },
    { names: ['BANK OF INDIA', 'BOI'], canonical: 'Bank of India' },
    { names: ['CENTRAL BANK OF INDIA'], canonical: 'Central Bank of India' },
    { names: ['RBL BANK', 'RATNAKAR BANK'], canonical: 'RBL Bank' },
    { names: ['BANDHAN BANK'], canonical: 'Bandhan Bank' },
    { names: ['IDFC FIRST BANK', 'IDFC BANK'], canonical: 'IDFC First Bank' },
    { names: ['INDIAN OVERSEAS BANK', 'IOB'], canonical: 'Indian Overseas Bank' },
    { names: ['UCO BANK'], canonical: 'UCO Bank' },
    { names: ['BANK OF MAHARASHTRA'], canonical: 'Bank of Maharashtra' },
    { names: ['SOUTH INDIAN BANK'], canonical: 'South Indian Bank' },
    { names: ['KARNATAKA BANK'], canonical: 'Karnataka Bank' },
    { names: ['CITY UNION BANK', 'CUB'], canonical: 'City Union Bank' },
    { names: ['DHANLAXMI BANK'], canonical: 'Dhanlaxmi Bank' },
    { names: ['KARUR VYSYA BANK', 'KVB'], canonical: 'Karur Vysya Bank' },
    { names: ['NAINITAL BANK'], canonical: 'Nainital Bank' },
    { names: ['JAMMU AND KASHMIR BANK', 'J&K BANK', 'JK BANK'], canonical: 'J&K Bank' },
    { names: ['AU SMALL FINANCE BANK', 'AU BANK'], canonical: 'AU Small Finance Bank' },
    { names: ['EQUITAS SMALL FINANCE BANK'], canonical: 'Equitas Small Finance Bank' },
    { names: ['UJJIVAN SMALL FINANCE BANK'], canonical: 'Ujjivan Small Finance Bank' },
  ];

  constructor(sanitizer: OutputSanitizer) {
    super('cheque', sanitizer);
  }

  parse(ocrText: string): OVDResult {
    const startTime = Date.now();
    const text = ocrText;
    const upperText = text.toUpperCase();
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const validationErrors: string[] = [];

    // Extract IFSC code (most reliable — strict format)
    const ifscField = this.extractIFSC(upperText);
    if (!ifscField.value) {
      validationErrors.push('IFSC code not found');
    }

    // Extract Account Number (tricky — many digit sequences on a cheque)
    const accountField = this.extractAccountNumber(text, ifscField.value);
    if (!accountField.value) {
      validationErrors.push('Account number not found');
    }

    // Extract Bank Name
    const bankField = this.extractBankName(upperText);

    // Extract MICR Code
    const micrField = this.extractMICR(text);

    // Extract Cheque Number
    const chequeNoField = this.extractChequeNumber(text);

    // Extract Branch
    const branchField = this.extractBranch(lines);

    // Only include fields that were found
    const fields: Record<string, FieldResult> = {};
    
    if (ifscField.confidence > 0) fields.ifscCode = ifscField;
    if (accountField.confidence > 0) fields.accountNumber = accountField;
    if (bankField.confidence > 0) fields.bankName = bankField;
    if (micrField.confidence > 0) fields.micrCode = micrField;
    if (chequeNoField.confidence > 0) fields.chequeNumber = chequeNoField;
    if (branchField.confidence > 0) fields.branch = branchField;

    // Cross-validate: IFSC first 4 chars should match bank
    if (ifscField.value && bankField.value) {
      const ifscBankCode = ifscField.value.substring(0, 4);
      const bankIFSCMap: Record<string, string[]> = {
        'SBIN': ['State Bank of India'],
        'HDFC': ['HDFC Bank'],
        'ICIC': ['ICICI Bank'],
        'UTIB': ['Axis Bank'],
        'KKBK': ['Kotak Mahindra Bank'],
        'YESB': ['Yes Bank'],
        'INDB': ['IndusInd Bank'],
        'PUNB': ['Punjab National Bank'],
        'BARB': ['Bank of Baroda'],
        'CNRB': ['Canara Bank'],
        'UBIN': ['Union Bank of India'],
        'IBKL': ['IDBI Bank'],
        'FDRL': ['Federal Bank'],
        'IDIB': ['Indian Bank'],
        'BKID': ['Bank of India'],
        'RATN': ['RBL Bank'],
        'BDBL': ['Bandhan Bank'],
        'IDFB': ['IDFC First Bank'],
      };
      
      const expectedBanks = bankIFSCMap[ifscBankCode];
      if (expectedBanks && !expectedBanks.includes(bankField.value)) {
        // Mismatch — lower confidence but don't reject (OCR might have garbled bank name)
        if (fields.bankName) {
          fields.bankName = { ...fields.bankName, confidence: fields.bankName.confidence * 0.7 };
        }
      }
    }

    // Validate IFSC format
    if (ifscField.value) {
      const validIFSC = this.sanitizer.sanitizeIFSC(ifscField.value);
      if (!validIFSC) {
        validationErrors.push('IFSC code failed format validation');
        if (fields.ifscCode) {
          fields.ifscCode = { ...fields.ifscCode, confidence: fields.ifscCode.confidence * 0.5 };
        }
      }
    }

    // Validate Account Number
    if (accountField.value) {
      const validAccount = this.sanitizer.sanitizeAccountNumber(accountField.value);
      if (!validAccount) {
        validationErrors.push('Account number failed format validation');
        if (fields.accountNumber) {
          fields.accountNumber = { ...fields.accountNumber, confidence: fields.accountNumber.confidence * 0.5 };
        }
      }
    }

    return this.buildResult(fields, validationErrors, startTime);
  }

  private extractIFSC(text: string): FieldResult {
    // IFSC format: 4 letters + 0 + 6 alphanumeric (always 5th char is 0)
    const ifscRegex = /\b([A-Z]{4}0[A-Z0-9]{6})\b/;
    const match = text.match(ifscRegex);

    if (!match) {
      // Try with common OCR errors (0 vs O in 5th position)
      const fuzzyRegex = /\b([A-Z]{4}[O0][A-Z0-9]{6})\b/;
      const fuzzyMatch = text.match(fuzzyRegex);
      if (fuzzyMatch) {
        // Replace O with 0 in 5th position
        const corrected = fuzzyMatch[1].substring(0, 4) + '0' + fuzzyMatch[1].substring(5);
        return this.createField(corrected, 0.75);
      }
      return this.createField(null, 0);
    }

    return this.createField(match[1], 0.93);
  }

  private extractAccountNumber(text: string, _ifscCode: string | null): FieldResult {
    // Cheques have multiple number sequences:
    // - Cheque number (6 digits, top/bottom)
    // - Account number (9-18 digits)  
    // - MICR code (9 digits, bottom)
    // - Phone numbers (10 digits starting with 6-9)
    // - Pin codes (6 digits)
    // - IFSC (11 chars — already extracted)
    
    const allNumbers = [...text.matchAll(/\b(\d{9,18})\b/g)];
    
    if (allNumbers.length === 0) return this.createField(null, 0);

    // Score each candidate
    const candidates: Array<{ value: string; score: number }> = [];

    for (const match of allNumbers) {
      const num = match[1];
      let score = 0.5;

      // Phone number? Skip
      if (num.length === 10 && /^[6-9]/.test(num)) continue;

      // Is it the MICR code? (9 digits — could be, but we handle separately)
      if (num.length === 9) {
        score = 0.4; // Could be MICR, lower confidence for account
      }

      // Typical account number lengths for Indian banks
      if (num.length >= 11 && num.length <= 16) {
        score = 0.8; // Most Indian banks have 11-16 digit accounts
      }

      // If it's near "A/C" or "Account" text, boost confidence
      const index = text.indexOf(num);
      const nearby = text.substring(Math.max(0, index - 30), index).toUpperCase();
      if (nearby.includes('A/C') || nearby.includes('ACCOUNT') || nearby.includes('ACC')) {
        score = 0.90;
      }

      candidates.push({ value: num, score });
    }

    if (candidates.length === 0) return this.createField(null, 0);

    // Pick highest scoring candidate
    candidates.sort((a, b) => b.score - a.score);
    return this.createField(candidates[0].value, candidates[0].score);
  }

  private extractBankName(text: string): FieldResult {
    // Try exact match first (most reliable)
    for (const bank of ChequeParser.KNOWN_BANKS) {
      for (const name of bank.names) {
        if (text.includes(name)) {
          return this.createField(bank.canonical, 0.92);
        }
      }
    }

    // Fuzzy: try to find "BANK" keyword and grab surrounding text
    const bankRegex = /\b([A-Z][A-Z\s]+BANK(?:\s+(?:OF|LTD|LIMITED|INDIA))*)\b/;
    const match = text.match(bankRegex);
    if (match && match[1].length > 4) {
      // Check it's not just "BANK" alone
      const bankName = match[1].trim();
      if (bankName !== 'BANK') {
        return this.createField(bankName, 0.65);
      }
    }

    return this.createField(null, 0);
  }

  private extractMICR(text: string): FieldResult {
    // MICR code: exactly 9 digits
    // Format: City Code (3) + Bank Code (3) + Branch Code (3)
    // Usually at very bottom of cheque in special MICR font
    // OCR often reads it with special chars mixed in (⑆, ⑇, etc.)
    
    // First try clean 9 digits
    const micrRegex = /\b(\d{9})\b/g;
    const matches = [...text.matchAll(micrRegex)];

    // MICR codes: first 3 digits are city code (valid Indian city codes start with 1-9)
    for (const match of matches) {
      const code = match[1];
      
      // Skip if it looks like part of a longer number
      const index = text.indexOf(code);
      const before = text[index - 1] || ' ';
      const after = text[index + 9] || ' ';
      if (/\d/.test(before) || /\d/.test(after)) continue;
      
      // Valid MICR: first digit 1-9 (city codes don't start with 0)
      if (code[0] !== '0') {
        return this.createField(code, 0.72);
      }
    }

    // Try extracting from MICR line (often has special chars)
    // Pattern: chequeNo (6) + MICR separator + MICR (9) + separator + account
    const micrLineRegex = /(\d{6})\D{0,3}(\d{9})\D{0,3}(\d{9,18})/;
    const lineMatch = text.match(micrLineRegex);
    if (lineMatch) {
      return this.createField(lineMatch[2], 0.80);
    }

    return this.createField(null, 0);
  }

  private extractChequeNumber(text: string): FieldResult {
    // Cheque number: typically 6 digits, sometimes with leading zeros
    // Usually at top-right or bottom MICR line
    
    // Look for "cheque no" or "chq" label nearby
    const labelRegex = /(?:cheque|chq|ch)\.?\s*(?:no|number|#)?\.?\s*[:\-]?\s*(\d{6})/i;
    const labelMatch = text.match(labelRegex);
    if (labelMatch) {
      return this.createField(labelMatch[1], 0.85);
    }

    // MICR line pattern: first 6 digits are usually cheque number
    const micrLineRegex = /\b(\d{6})\s+\d{9}\s+\d{9,}/;
    const micrMatch = text.match(micrLineRegex);
    if (micrMatch) {
      return this.createField(micrMatch[1], 0.75);
    }

    // Standalone 6-digit number (lower confidence — could be pin code)
    const sixDigitRegex = /\b(\d{6})\b/g;
    const matches = [...text.matchAll(sixDigitRegex)];
    for (const match of matches) {
      const num = match[1];
      // Pin codes start with 1-9, cheque numbers can start with 0
      // If starts with 0, likely cheque number
      if (num[0] === '0') {
        return this.createField(num, 0.60);
      }
    }

    return this.createField(null, 0);
  }

  private extractBranch(lines: string[]): FieldResult {
    for (const line of lines) {
      const upper = line.toUpperCase();
      
      // Pattern: "Branch: XYZ" or "XYZ Branch"
      if (upper.includes('BRANCH')) {
        // Remove "branch" keyword and clean up
        let branchName = line
          .replace(/branch/i, '')
          .replace(/[:\-,]/g, '')
          .trim();
        
        // Remove bank name if it's also in the line
        for (const bank of ChequeParser.KNOWN_BANKS) {
          for (const name of bank.names) {
            branchName = branchName.replace(new RegExp(name, 'i'), '').trim();
          }
        }

        if (branchName.length > 2 && branchName.length < 100) {
          return this.createField(branchName, 0.70);
        }
      }
    }

    // Try to find branch from IFSC (last 6 chars represent branch)
    // But we can't resolve branch name from code without a database, so skip

    return this.createField(null, 0);
  }
}
