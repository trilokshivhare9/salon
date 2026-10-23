import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceGender } from '@prisma/client';

export interface ExtractedServiceItem {
  name: string;
  category: string;
  price: number;
  durationMinutes: number;
  targetGender: ServiceGender;
  description?: string;
}

@Injectable()
export class ServicesAiScannerService {
  private readonly logger = new Logger(ServicesAiScannerService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Scans a salon rate card / menu photo using Google Gemini Multimodal Vision API
   * and extracts structured services conforming to salon domain rules.
   */
  async scanMenuCard(imageBase64: string, rawMimeType?: string): Promise<ExtractedServiceItem[]> {
    const apiKey =
      this.configService.get<string>('GEMINI_API_KEY') || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new BadRequestException('GEMINI_API_KEY is not configured on the server.');
    }

    // 1. Sanitize base64 payload & extract MIME type
    let cleanBase64 = imageBase64;
    let mimeType = rawMimeType || 'image/jpeg';

    if (imageBase64.startsWith('data:')) {
      const match = imageBase64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        cleanBase64 = match[2];
      } else {
        cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
      }
    }

    // 2. Prepare structured system prompt
    const prompt = `
You are an expert salon menu data extraction assistant.
Analyze this salon menu / rate card / price list image carefully and extract all services into a JSON array.

RULES:
1. Extract EVERY service listed on the card (haircuts, styling, beard, facial, cleanup, waxing, threading, manicure, pedicure, coloring, massage, spa, etc.).
2. For each service provide:
   - "name": Clean, concise service title (e.g. "Classic Haircut", "Beard Styling", "Charcoal D-Tan Facial").
   - "category": Logical salon category (e.g. "Hair", "Beard", "Facial & Skin", "Nails & Pedicure", "Waxing", "Massage & Spa", or use the category header from the card).
   - "price": Number in local currency (remove symbols like ₹, $, Rs, commas). Must be an integer >= 0.
   - "durationMinutes": Duration in minutes. MUST BE A MULTIPLE OF 15 AND AT LEAST 30 (e.g. 30, 45, 60, 75, 90). If duration is not stated on the card, estimate based on industry standards: quick haircut/beard = 30, facial/manicure = 45, coloring/smoothening = 60 or 90.
   - "targetGender": Must be strictly one of: "MALE", "FEMALE", "UNISEX", "KIDS". Look for column headers like "Men", "Gents", "Women", "Ladies", "Kids". If not specified or suitable for both, use "UNISEX".
   - "description": Brief 1-sentence description if mentioned on card, or empty string.

Return ONLY a valid JSON array of objects adhering to this schema:
[
  {
    "name": "Service Name",
    "category": "Category Name",
    "price": 300,
    "durationMinutes": 30,
    "targetGender": "UNISEX",
    "description": "Short description"
  }
]
`;

    // 3. Candidate models (primary: gemini-3.5-flash-lite, fallback: gemini-3.5-flash)
    const models = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'];
    let lastError: any = null;

    for (const model of models) {
      try {
        this.logger.log(`Invoking Gemini Vision model [${model}] for menu card extraction...`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const payload = {
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: cleanBase64,
                  },
                },
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        };

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          this.logger.warn(`Gemini [${model}] failed (${res.status}): ${JSON.stringify(errData)}`);
          lastError = errData;
          continue;
        }

        const data = await res.json();
        const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textOutput) {
          throw new Error('Gemini returned an empty response.');
        }

        const parsed = this.cleanAndParseJson(textOutput);
        const sanitized = this.sanitizeExtractedServices(parsed);

        this.logger.log(`Successfully extracted ${sanitized.length} services from image using [${model}].`);
        return sanitized;
      } catch (err: any) {
        this.logger.warn(`Error with model [${model}]: ${err.message}`);
        lastError = err;
      }
    }

    this.logger.error(`All Gemini models failed for menu card scan. Last error:`, lastError);
    throw new InternalServerErrorException(
      'Could not extract services from the image. Please verify the photo is clear and well-lit.',
    );
  }

  /**
   * Helper to robustly clean markdown codeblocks and parse JSON
   */
  private cleanAndParseJson(rawText: string): any[] {
    let cleaned = rawText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }

    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.services)) return parsed.services;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
      return [];
    } catch (err: any) {
      this.logger.error(`Failed to parse Gemini JSON output: ${cleaned}`);
      throw new Error(`Invalid JSON returned by AI: ${err.message}`);
    }
  }

  /**
   * Enforces strict business validations on extracted services
   */
  private sanitizeExtractedServices(items: any[]): ExtractedServiceItem[] {
    const validGenders = ['MALE', 'FEMALE', 'UNISEX', 'KIDS'];

    return items
      .filter((item) => item && typeof item.name === 'string' && item.name.trim().length > 0)
      .map((item) => {
        // Enforce duration: multiple of 15, minimum 30
        let duration = Number(item.durationMinutes) || 30;
        if (duration < 30) duration = 30;
        duration = Math.round(duration / 15) * 15;

        // Enforce price >= 0
        let price = Math.round(Number(item.price) || 0);
        if (price < 0 || isNaN(price)) price = 0;

        // Enforce gender
        let gender = (item.targetGender || 'UNISEX').toString().toUpperCase().trim();
        if (gender === 'MEN' || gender === 'MAN' || gender === 'GENTS') gender = 'MALE';
        if (gender === 'WOMEN' || gender === 'WOMAN' || gender === 'LADIES') gender = 'FEMALE';
        if (gender === 'CHILD' || gender === 'CHILDREN') gender = 'KIDS';
        if (!validGenders.includes(gender)) gender = 'UNISEX';

        // Clean category
        let category = (item.category || 'General').toString().trim();
        if (!category) category = 'General';

        return {
          name: item.name.trim(),
          category,
          price,
          durationMinutes: duration,
          targetGender: gender as ServiceGender,
          description: item.description ? item.description.toString().trim() : undefined,
        };
      });
  }
}
