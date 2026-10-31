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

    // 2. Prepare structured system prompt with strict anti-hallucination & grounding constraints
    const prompt = `
You are an expert salon menu data extraction assistant.
Analyze this salon menu / rate card / price list image carefully and extract ONLY the services and categories that are physically printed and visible in the image into a JSON array.

CRITICAL GROUNDING & ANTI-HALLUCINATION RULES:
1. STRICT EXTRACTION ONLY: Extract ONLY services and categories that are explicitly printed on this menu card.
2. DO NOT INVENT OR ASSUME: Never hallucinate, guess, or add any services, packages, prices, or categories that do not appear in the image, even if they are standard salon offerings.
3. EXACT CATEGORIES: Use the EXACT category/section headers printed on the menu card (e.g. "HAIR STYLING", "HAIR COLORING", "SKIN CARE"). If services are grouped under a printed section header, all those services must use that exact header as their "category". Never invent generic categories if a header is present. If the card has no section headings at all, use "General".
4. ACCURATE NAMES: Use the exact service name as printed on the card. Do NOT rephrase or merge unrelated services.
5. PRICES: Extract the exact numeric price printed next to the service (remove currency symbols like ₹, $, Rs, commas). Must be an integer >= 0. If a price is unreadable or not listed, set price to 0. Do NOT guess or invent prices.
6. DURATION: Duration in minutes. MUST BE A MULTIPLE OF 15 AND AT LEAST 30 (e.g. 30, 45, 60, 75, 90). If duration is printed on the card, use it. If not printed, estimate based on industry standards: quick haircut/beard = 30, facial/manicure = 45, coloring/smoothening = 60 or 90.
7. TARGET GENDER: Must be strictly one of: "MALE", "FEMALE", "UNISEX", "KIDS". Look for column headers or labels like "Men", "Gents", "Women", "Ladies", "Kids". If not specified or suitable for both, use "UNISEX".
8. DESCRIPTION: Provide a crisp, appealing, 1-sentence professional salon description for EVERY service (e.g. for "Women's Haircut": "Professional hair wash, precision haircut, and custom styled blow-dry finish", for "Men's Haircut": "Precision scissors and clipper cut tailored to your style with a clean finish", for "Full Perm": "Chemical curl texturing treatment for long-lasting volume and bounce"). If a description is explicitly printed on the card, use it; if no description is printed on the card, generate an accurate 1-sentence salon service description tailored to the service. EVERY service MUST have a non-empty description.

Return ONLY a valid JSON array of objects adhering to this schema:
[
  {
    "name": "Women's Haircut",
    "category": "HAIR STYLING",
    "price": 300,
    "durationMinutes": 30,
    "targetGender": "FEMALE",
    "description": "Professional wash, precision haircut, and custom styled blow-dry finish"
  }
]
`;

    // 3. Fast multimodal models (primary: gemini-flash-lite-latest for sub-2s response, fallback: gemini-flash-latest)
    const models = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
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

        let description = item.description ? item.description.toString().trim() : '';
        if (!description) {
          description = this.generateSmartDefaultDescription(item.name.trim(), category, gender);
        }

        return {
          name: item.name.trim(),
          category,
          price,
          durationMinutes: duration,
          targetGender: gender as ServiceGender,
          description,
        };
      });
  }

  private generateSmartDefaultDescription(name: string, category: string, gender: string): string {
    const lowerName = name.toLowerCase();
    const lowerCat = category.toLowerCase();

    if (lowerName.includes('haircut') || lowerName.includes('cut')) {
      if (gender === 'FEMALE') return 'Professional wash, custom precision haircut, and styled blow-dry finish.';
      if (gender === 'MALE') return 'Precision scissors and clipper cut tailored to your style with a clean finish.';
      if (gender === 'KIDS') return 'Gentle, kid-friendly haircut with quick styling and fun care.';
      return 'Expert precision haircut with consultation and professional styling finish.';
    }
    if (lowerName.includes('shave') || lowerName.includes('beard') || lowerName.includes('trim')) {
      return 'Hot towel prep, precision beard shaping, and soothing aftershave care.';
    }
    if (lowerName.includes('color') || lowerName.includes('highlight') || lowerName.includes('foil')) {
      return 'Custom professional hair coloring with vibrant gloss and conditioning care.';
    }
    if (lowerName.includes('facial') || lowerName.includes('clean') || lowerCat.includes('skin')) {
      return 'Deep pore cleansing, gentle exfoliation, and rejuvenating hydration facial.';
    }
    if (lowerName.includes('straight') || lowerName.includes('perm') || lowerName.includes('relaxer') || lowerName.includes('smoothen')) {
      return 'Professional texturizing treatment for sleek, smooth, and long-lasting results.';
    }
    if (lowerName.includes('spa') || lowerName.includes('massage')) {
      return 'Relaxing therapeutic treatment designed to rejuvenate and relieve stress.';
    }
    if (lowerName.includes('wax') || lowerName.includes('thread')) {
      return 'Smooth and precise hair removal treatment with soothing skin calm lotion.';
    }
    if (lowerName.includes('manicure') || lowerName.includes('pedicure') || lowerName.includes('nail')) {
      return 'Nail shaping, cuticle care, scrub, massage, and professional polish finish.';
    }
    return `Professional ${name} service customized to your preferences with salon-grade care.`;
  }
}
