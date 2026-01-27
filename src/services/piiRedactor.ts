/**
 * PII Redactor Service
 *
 * Strips Personally Identifiable Information (PII) from text before sending to AI.
 * This is critical for bank compliance (NDPR, CBN guidelines).
 *
 * Supported PII types:
 * - Names (Nigerian naming patterns)
 * - Account numbers (NUBAN format - 10 digits)
 * - BVN (Bank Verification Number - 11 digits)
 * - NIN (National Identification Number - 11 digits)
 * - Phone numbers (Nigerian format)
 * - Email addresses
 * - Card numbers (PAN)
 * - Dates of birth
 */

import logger from '../config/logger';

export interface RedactionResult {
  redactedText: string;
  redactions: RedactionMapping[];
  hasRedactions: boolean;
}

export interface RedactionMapping {
  type: PIIType;
  original: string;
  token: string;
  startIndex: number;
  endIndex: number;
}

export type PIIType =
  | 'NAME'
  | 'ACCT_NUM'
  | 'BVN'
  | 'NIN'
  | 'PHONE'
  | 'EMAIL'
  | 'CARD_NUM'
  | 'DOB';

interface PIIPattern {
  type: PIIType;
  pattern: RegExp;
  tokenPrefix: string;
}

// Nigerian name patterns - common prefixes/suffixes
const NIGERIAN_NAME_PREFIXES = ['Chief', 'Dr', 'Engr', 'Barr', 'Prof', 'Alhaji', 'Alhaja', 'Pastor', 'Rev', 'Hon'];
const COMMON_NIGERIAN_FIRST_NAMES = [
  // Yoruba
  'Adebayo', 'Oluwaseun', 'Ayodeji', 'Temitope', 'Oluwafemi', 'Adewale', 'Olumide', 'Tunde', 'Funke', 'Bukola',
  'Adeola', 'Folake', 'Yetunde', 'Kehinde', 'Taiwo', 'Olayinka', 'Babatunde', 'Oluwakemi', 'Adunni', 'Abiodun',
  // Igbo
  'Chukwuemeka', 'Obioma', 'Chidinma', 'Emeka', 'Nnamdi', 'Obinna', 'Chinedu', 'Adaeze', 'Ngozi', 'Chiamaka',
  'Uchenna', 'Chinonso', 'Kenechukwu', 'Somtochukwu', 'Chisom', 'Ebuka', 'Ifeanyi', 'Kosisochukwu', 'Ogochukwu',
  // Hausa
  'Abubakar', 'Musa', 'Ibrahim', 'Suleiman', 'Yusuf', 'Fatima', 'Amina', 'Aisha', 'Halima', 'Zainab',
  'Mohammed', 'Abdullahi', 'Bello', 'Usman', 'Kabiru', 'Hauwa', 'Hadiza', 'Khadija', 'Sadiya',
  // Common English names used in Nigeria
  'John', 'Mary', 'Peter', 'Paul', 'Grace', 'Blessing', 'Favour', 'Joy', 'Peace', 'Faith',
  'Victor', 'Emmanuel', 'David', 'Samuel', 'Daniel', 'Michael', 'Joseph', 'Elizabeth', 'Sarah', 'Ruth'
];

class PIIRedactorService {
  private patterns: PIIPattern[] = [
    // Nigerian Account Number (NUBAN) - 10 digits
    {
      type: 'ACCT_NUM',
      pattern: /\b[0-9]{10}\b/g,
      tokenPrefix: 'ACCT_NUM',
    },
    // BVN - 11 digits starting with 22
    {
      type: 'BVN',
      pattern: /\b22[0-9]{9}\b/g,
      tokenPrefix: 'BVN',
    },
    // NIN - 11 digits
    {
      type: 'NIN',
      pattern: /\b[0-9]{11}\b/g,
      tokenPrefix: 'NIN',
    },
    // Nigerian Phone Numbers
    {
      type: 'PHONE',
      pattern: /(?:\+234|234|0)[789][01][0-9]{8}\b/g,
      tokenPrefix: 'PHONE',
    },
    // Email addresses
    {
      type: 'EMAIL',
      pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      tokenPrefix: 'EMAIL',
    },
    // Card numbers (13-19 digits, possibly with spaces/dashes)
    {
      type: 'CARD_NUM',
      pattern: /\b(?:\d[ -]*?){13,19}\b/g,
      tokenPrefix: 'CARD_NUM',
    },
    // Date of birth patterns (DD/MM/YYYY, DD-MM-YYYY, etc.)
    {
      type: 'DOB',
      pattern: /\b(?:0?[1-9]|[12][0-9]|3[01])[\/\-](?:0?[1-9]|1[0-2])[\/\-](?:19|20)\d{2}\b/g,
      tokenPrefix: 'DOB',
    },
  ];

  private tokenCounter: Map<PIIType, number> = new Map();

  /**
   * Redact all PII from the given text
   */
  redact(text: string): RedactionResult {
    this.resetTokenCounter();

    let redactedText = text;
    const redactions: RedactionMapping[] = [];

    // First, redact pattern-based PII (numbers, emails, etc.)
    for (const piiPattern of this.patterns) {
      const matches = text.matchAll(piiPattern.pattern);

      for (const match of matches) {
        if (match.index === undefined) continue;

        const original = match[0];
        const token = this.generateToken(piiPattern.type);

        redactions.push({
          type: piiPattern.type,
          original,
          token,
          startIndex: match.index,
          endIndex: match.index + original.length,
        });
      }
    }

    // Then, detect and redact names (more complex logic)
    const nameRedactions = this.detectNames(text);
    redactions.push(...nameRedactions);

    // Sort redactions by start index (descending) to replace from end to start
    // This preserves correct indices during replacement
    redactions.sort((a, b) => b.startIndex - a.startIndex);

    // Apply redactions
    for (const redaction of redactions) {
      redactedText =
        redactedText.substring(0, redaction.startIndex) +
        `[${redaction.token}]` +
        redactedText.substring(redaction.endIndex);
    }

    // Re-sort by start index (ascending) for the output
    redactions.sort((a, b) => a.startIndex - b.startIndex);

    logger.debug(`PII Redaction: Found ${redactions.length} PII items`, {
      types: redactions.map(r => r.type),
    });

    return {
      redactedText,
      redactions,
      hasRedactions: redactions.length > 0,
    };
  }

  /**
   * Restore original values in AI response using the redaction mapping
   * Use with caution - only for internal display, never for external responses
   */
  restore(text: string, redactions: RedactionMapping[]): string {
    let restoredText = text;

    for (const redaction of redactions) {
      const tokenPattern = new RegExp(`\\[${redaction.token}\\]`, 'g');
      restoredText = restoredText.replace(tokenPattern, redaction.original);
    }

    return restoredText;
  }

  /**
   * Detect potential names in text
   * Uses a combination of:
   * - Common Nigerian name dictionary
   * - Title prefixes (Chief, Dr, etc.)
   * - Capitalization patterns
   * - Context clues ("my name is", "I am", etc.)
   */
  private detectNames(text: string): RedactionMapping[] {
    const redactions: RedactionMapping[] = [];

    // Pattern 1: "my name is X" or "I am X" or "this is X"
    const nameIntroPatterns = [
      /(?:my name is|i am|i'm|this is|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gi,
      /(?:name|customer|client|account holder)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gi,
    ];

    for (const pattern of nameIntroPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match.index === undefined || !match[1]) continue;

        const fullMatch = match[0];
        const name = match[1].trim();
        const nameStartIndex = match.index + fullMatch.indexOf(name);

        redactions.push({
          type: 'NAME',
          original: name,
          token: this.generateToken('NAME'),
          startIndex: nameStartIndex,
          endIndex: nameStartIndex + name.length,
        });
      }
    }

    // Pattern 2: Known Nigerian names (case-insensitive search)
    for (const knownName of COMMON_NIGERIAN_FIRST_NAMES) {
      const namePattern = new RegExp(`\\b${knownName}\\b`, 'gi');
      const matches = text.matchAll(namePattern);

      for (const match of matches) {
        if (match.index === undefined) continue;

        // Check if this position is already redacted
        const alreadyRedacted = redactions.some(
          r => match.index! >= r.startIndex && match.index! < r.endIndex
        );

        if (!alreadyRedacted) {
          redactions.push({
            type: 'NAME',
            original: match[0],
            token: this.generateToken('NAME'),
            startIndex: match.index,
            endIndex: match.index + match[0].length,
          });
        }
      }
    }

    // Pattern 3: Title + Name (Chief Okonkwo, Dr. Adebayo, etc.)
    for (const prefix of NIGERIAN_NAME_PREFIXES) {
      const titlePattern = new RegExp(`\\b${prefix}\\.?\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2})`, 'gi');
      const matches = text.matchAll(titlePattern);

      for (const match of matches) {
        if (match.index === undefined) continue;

        const alreadyRedacted = redactions.some(
          r => match.index! >= r.startIndex && match.index! < r.endIndex
        );

        if (!alreadyRedacted) {
          redactions.push({
            type: 'NAME',
            original: match[0],
            token: this.generateToken('NAME'),
            startIndex: match.index,
            endIndex: match.index + match[0].length,
          });
        }
      }
    }

    return redactions;
  }

  /**
   * Generate a unique token for a PII type
   */
  private generateToken(type: PIIType): string {
    const count = (this.tokenCounter.get(type) || 0) + 1;
    this.tokenCounter.set(type, count);
    return `${type}_${count}`;
  }

  /**
   * Reset token counter (call before processing a new text)
   */
  private resetTokenCounter(): void {
    this.tokenCounter.clear();
  }

  /**
   * Check if text contains any PII
   */
  containsPII(text: string): boolean {
    const result = this.redact(text);
    return result.hasRedactions;
  }

  /**
   * Get statistics about PII in text
   */
  analyze(text: string): { total: number; byType: Record<PIIType, number> } {
    const result = this.redact(text);

    const byType: Record<PIIType, number> = {
      NAME: 0,
      ACCT_NUM: 0,
      BVN: 0,
      NIN: 0,
      PHONE: 0,
      EMAIL: 0,
      CARD_NUM: 0,
      DOB: 0,
    };

    for (const redaction of result.redactions) {
      byType[redaction.type]++;
    }

    return {
      total: result.redactions.length,
      byType,
    };
  }
}

// Export singleton instance
export const piiRedactor = new PIIRedactorService();
export default piiRedactor;
