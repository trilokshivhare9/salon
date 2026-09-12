/**
 * Sanitization utility for privacy & security.
 * Recursively scans headers, query parameters, and request bodies to redact sensitive credentials.
 */
export class SanitizationUtility {
  private static SENSITIVE_KEY_PATTERNS = [
    'password',
    'pass',
    'confirmpassword',
    'newpassword',
    'oldpassword',
    'authorization',
    'auth',
    'bearer',
    'accesstoken',
    'refreshtoken',
    'token',
    'secret',
    'jwt',
    'otp',
    'pin',
    'code',
    'cvv',
    'cardnumber',
    'apikey',
    'secretkey',
    'privatekey',
  ];

  public static sanitize(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data !== 'object') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitize(item));
    }

    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');

      const isSensitive = this.SENSITIVE_KEY_PATTERNS.some((pattern) => lowerKey.includes(pattern));

      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}
