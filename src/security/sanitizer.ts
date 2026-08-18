export class OutputSanitizer {
  sanitize(text: string): string {
    let sanitized = text;
    sanitized = sanitized.replace(/\0/g, '');
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    if (sanitized.length > 50_000) {
      sanitized = sanitized.substring(0, 50_000);
    }

    return sanitized;
  }

  sanitizeField(value: string, maxLength: number = 500): string {
    let sanitized = this.sanitize(value).trim();

    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }

    return sanitized;
  }

  sanitizeAadhaar(value: string): string | null {
    const digits = value.replace(/\D/g, '');

    if (digits.length !== 12) return null;
    if (digits[0] === '0' || digits[0] === '1') return null;

    return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)}`;
  }

  sanitizePAN(value: string): string | null {
    const cleaned = value.replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cleaned)) return null;
    return cleaned;
  }

  sanitizeIFSC(value: string): string | null {
    const cleaned = value.replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleaned)) return null;
    return cleaned;
  }

  sanitizeAccountNumber(value: string): string | null {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 18) return null;
    return digits;
  }
}
