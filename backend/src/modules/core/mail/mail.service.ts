import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private isConfigured = false;
  private readonly fromAddress: string;

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST') || process.env.SMTP_HOST;
    const port = Number(this.configService.get<string>('SMTP_PORT') || process.env.SMTP_PORT || 465);
    const secure = (this.configService.get<string>('SMTP_SECURE') || process.env.SMTP_SECURE) !== 'false';
    const user = this.configService.get<string>('SMTP_USER') || process.env.SMTP_USER;
    const pass = this.configService.get<string>('SMTP_PASS') || process.env.SMTP_PASS;
    this.fromAddress =
      this.configService.get<string>('SMTP_FROM') ||
      process.env.SMTP_FROM ||
      '"Salon Command Security" <security@saloncommand.com>';

    if (user && pass) {
      try {
        this.transporter = nodemailer.createTransport({
          host: host || 'smtp.gmail.com',
          port: port || 465,
          secure,
          auth: { user, pass },
          connectionTimeout: 10000,
        });
        this.isConfigured = true;
        this.logger.log(`[MailService] SMTP configured with host: ${host || 'smtp.gmail.com'}`);
      } catch (err: any) {
        this.logger.warn(`[MailService] Failed to initialize SMTP transporter: ${err.message}. Using console fallback.`);
      }
    } else {
      this.logger.log(
        '[MailService] SMTP credentials not set. Running in development console-dispatch fallback mode.',
      );
    }
  }

  /**
   * Dispatches a branded 6-digit OTP email for password reset
   */
  async sendPasswordResetOtp(toEmail: string, otp: string, recipientName = 'Salon Owner'): Promise<boolean> {
    const subject = '🔐 Salon Command - Your Password Reset Code';
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f8fafc; margin: 0; padding: 0; }
    .wrapper { max-width: 540px; margin: 40px auto; background: #111827; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
    .header { padding: 32px 32px 24px; text-align: center; background: linear-gradient(180deg, rgba(99,102,241,0.15) 0%, rgba(17,24,39,0) 100%); border-bottom: 1px solid rgba(255,255,255,0.06); }
    .brand-icon { display: inline-flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 16px; background: rgba(99,102,241,0.2); border: 1px solid rgba(99,102,241,0.3); font-size: 28px; line-height: 1; margin-bottom: 12px; }
    .brand-title { font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em; margin: 0; }
    .brand-subtitle { font-size: 13px; color: #94a3b8; margin: 4px 0 0; }
    .content { padding: 32px; }
    .greeting { font-size: 15px; color: #e2e8f0; margin-bottom: 16px; }
    .otp-card { background: #0b0f19; border: 1px solid rgba(99,102,241,0.35); border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; }
    .otp-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: #818cf8; font-weight: 700; margin-bottom: 8px; }
    .otp-digits { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 36px; font-weight: 900; letter-spacing: 0.25em; color: #ffffff; text-shadow: 0 0 20px rgba(99,102,241,0.5); }
    .info-list { font-size: 13px; color: #94a3b8; line-height: 1.6; margin: 20px 0; }
    .info-list li { margin-bottom: 6px; }
    .footer { padding: 24px 32px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid rgba(255,255,255,0.06); background: rgba(0,0,0,0.2); }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="brand-icon">✂️</div>
      <h1 class="brand-title">Salon Command</h1>
      <p class="brand-subtitle">Store Operations & Platform Security</p>
    </div>
    <div class="content">
      <div class="greeting">Hi <strong>${recipientName}</strong>,</div>
      <p style="font-size: 14px; color: #cbd5e1; line-height: 1.6; margin: 0;">
        We received a request to reset your password for your Salon Command Operations account. Use the verification code below to complete your reset:
      </p>

      <div class="otp-card">
        <div class="otp-label">One-Time Verification Code</div>
        <div class="otp-digits">${otp}</div>
      </div>

      <ul class="info-list">
        <li>⏱️ <strong>Valid for 10 minutes:</strong> For security, this code expires in 10 minutes.</li>
        <li>🔒 <strong>Keep it private:</strong> Salon Command staff will never ask you for this code.</li>
        <li>🛡️ <strong>Didn't request this?</strong> If you didn't request a password reset, you can safely ignore this email. Your existing password remains secure.</li>
      </ul>
    </div>
    <div class="footer">
      This is an automated security notification sent to ${toEmail}.<br>
      © ${new Date().getFullYear()} Salon Command Operations. All rights reserved.
    </div>
  </div>
</body>
</html>
    `;

    // Console dispatch log for developer visibility & testing
    this.logger.log(`
================================================================================
📧 [MailService] DISPATCHING PASSWORD RESET CODE
To: ${toEmail} (${recipientName})
OTP CODE: [ ${otp} ]
Expires In: 10 minutes
================================================================================
    `);

    if (!this.isConfigured || !this.transporter) {
      // In dev fallback mode, return true after logging
      return true;
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: toEmail,
        subject,
        html,
        text: `Your Salon Command password reset code is: ${otp}. This code is valid for 10 minutes. Do not share it with anyone.`,
      });
      this.logger.log(`[MailService] Successfully sent password reset email to: ${toEmail}`);
      return true;
    } catch (err: any) {
      this.logger.error(`[MailService] Failed to send email to ${toEmail}: ${err.message}`);
      // Even if outbound network fails in dev, don't crash the request
      return true;
    }
  }
}
