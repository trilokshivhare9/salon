import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { JwtPayload } from '../jwt.strategy';

@Injectable()
export class TokenService {
  constructor(private jwtService: JwtService) {}

  hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  generateRefreshToken(): string {
    return `rt_${uuidv4()}_${crypto.randomBytes(16).toString('hex')}`;
  }

  calculateExpiryDate(days: number = 7): Date {
    const dt = new Date();
    dt.setDate(dt.getDate() + days);
    return dt;
  }

  generateAccessToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload, { expiresIn: '15m' });
  }
}
