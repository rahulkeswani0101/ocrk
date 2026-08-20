# docscanr

Secure OCR toolkit for document processing. Extracts structured fields from images with per-field confidence scoring. Supports Indian KYC/identity documents.

## Features

- **PAN Card** — PAN number, Name, Father's Name, DOB
- **Aadhaar Card** — Aadhaar number (masked), Name, DOB, Gender, Address
- **Passport** — Passport number, Name, DOB, Gender, Expiry, Place of Birth, Nationality
- **Voter ID** — EPIC number, Name, Father/Husband Name, DOB, Gender, Address
- **Bank Cheque** — IFSC, Account Number, Bank Name, MICR, Cheque Number
- **Confidence Scoring** — Per-field + document-level (0-1)
- **Security-first design** — Built for fintech compliance

## Install

```bash
npm install docscanr
```

Requires **Node.js >= 20.9** (server-side only, not for browser)

## Usage

```typescript
import { OCRToolkit } from 'docscanr';

const toolkit = new OCRToolkit();

// Extract raw text from any image
const result = await toolkit.extractText('./document.jpg');
console.log(result.text);
console.log(result.confidence); // 0.87

// Parse PAN Card
const pan = await toolkit.parseOVD('./pan-card.jpg', 'pan');
console.log(pan.fields.panNumber);   // { value: "ABCDE1234F", confidence: 0.95 }
console.log(pan.fields.name);        // { value: "Rahul Kumar", confidence: 0.85 }
console.log(pan.fields.dateOfBirth); // { value: "15/03/1995", confidence: 0.90 }
console.log(pan.isValid);            // true

// Parse Aadhaar (front, back, or merged — auto-detects)
const aadhaar = await toolkit.parseOVD('./aadhaar.jpg', 'aadhaar');
console.log(aadhaar.fields.aadhaarNumber); // { value: "XXXX XXXX 1234", confidence: 0.92 }
console.log(aadhaar.fields.name);          // { value: "John Doe", confidence: 0.85 }
console.log(aadhaar.fields.gender);        // { value: "Male", confidence: 0.90 }

// Parse Bank Cheque
const cheque = await toolkit.parseOVD('./cheque.jpg', 'cheque');
console.log(cheque.fields.ifscCode);      // { value: "HDFC0001234", confidence: 0.93 }
console.log(cheque.fields.accountNumber); // { value: "12345678901234", confidence: 0.80 }
console.log(cheque.fields.bankName);      // { value: "HDFC Bank", confidence: 0.92 }
```

## Configuration

```typescript
const toolkit = new OCRToolkit({
  security: {
    maxFileSize: 5 * 1024 * 1024, // 5MB limit
  },
  maskSensitiveData: true, // Mask Aadhaar numbers (default: true)
});
```

## Confidence Scoring

| Score | Meaning |
|-------|---------|
| 0.9+ | High confidence — strong pattern match |
| 0.7–0.9 | Medium — likely correct |
| 0.5–0.7 | Low — needs manual review |
| < 0.5 | Very low — likely incorrect |

## Supported Formats

JPEG, PNG, WebP, TIFF

## API

### `toolkit.extractText(input, options?)`

Extract raw text from an image.

- `input` — File path (`string`) or image `Buffer`
- Returns: `{ text, confidence, processingTimeMs }`

### `toolkit.parseOVD(input, type, options?)`

Parse a document into structured fields.

- `input` — File path (`string`) or image `Buffer`
- `type` — `'pan'` | `'aadhaar'` | `'cheque'` | `'passport'` | `'voter-id'`
- Returns: `{ documentType, documentConfidence, fields, isValid, validationErrors, processingTimeMs }`

## License

MIT
