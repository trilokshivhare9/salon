# Security Architecture & Threat Model

**Document Version:** 1.0.0  
**Compliance Standard:** OWASP Top 10 API Security, Least Privilege RBAC  
**Encryption Standard:** TLS 1.3 in transit, AES-256-GCM at rest for integration credentials  

---

## 1. Core Security Principles

1. **Zero Trust Multi-Tenancy:** A client request can never supply its own `salon_id` in headers or body to access protected resources. The tenant context is exclusively derived from the verified JWT payload or cryptographic session token.
2. **Defense-in-Depth:** Validation occurs at the Gateway, Middleware, Service Layer, and Database Constraint layers.
3. **Least Privilege RBAC:** Platform operators cannot inspect sensitive customer PII without explicit audit tracking. Staff members have zero access to billing or salon ownership configurations.
4. **Deterministic Error Masking:** Stack traces, internal SQL queries, and system paths are never leaked to clients.

---

## 2. Role-Based Access Control (RBAC) Matrix

| Resource / Action | Public Customer | Staff Member | Salon Owner / Admin | Platform Admin |
| :--- | :---: | :---: | :---: | :---: |
| **Browse Public Booking Catalog** | ✅ Allow | ✅ Allow | ✅ Allow | ✅ Allow |
| **Create Web Appointment** | ✅ Allow | ✅ Allow | ✅ Allow | ✅ Allow |
| **View Daily Salon Calendar** | ❌ Deny | ✅ Allow (Own Salon) | ✅ Allow (Own Salon) | ❌ Deny (Privacy) |
| **Create Manual / Walk-in Booking**| ❌ Deny | ✅ Allow (Own Salon) | ✅ Allow (Own Salon) | ❌ Deny |
| **Update Appointment Status** | ❌ Deny | ✅ Allow (Own Salon) | ✅ Allow (Own Salon) | ❌ Deny |
| **Manage Staff & Services** | ❌ Deny | ❌ Deny | ✅ Allow (Own Salon) | ❌ Deny |
| **Configure Working Hours & Breaks**| ❌ Deny | ❌ Deny | ✅ Allow (Own Salon) | ❌ Deny |
| **View Customer Phone Numbers** | ❌ Deny | ✅ Allow (Checked-in) | ✅ Allow (Own Salon) | ❌ Deny |
| **Manage WhatsApp Integration Keys**| ❌ Deny | ❌ Deny | ✅ Allow (Own Salon) | ❌ Deny |
| **Manage Billing & Subscriptions** | ❌ Deny | ❌ Deny | ✅ Allow (Own Salon) | ✅ Allow (All Salons) |
| **Suspend / Activate Salons** | ❌ Deny | ❌ Deny | ❌ Deny | ✅ Allow (All Salons) |

---

## 3. Tenant Isolation & Query Security

### 3.1 The Multi-Tenant Security Guard

In NestJS, an Auth Guard and Tenant Context Interceptor work in tandem:

```typescript
// Conceptual Tenant Interceptor
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // Set by JwtAuthGuard

    if (user && user.role !== 'PLATFORM_ADMIN') {
      if (!user.salonId) {
        throw new ForbiddenException('User is not associated with an active salon tenant.');
      }
      request.tenantId = user.salonId;
    }
    return next.handle();
  }
}
```

### 3.2 Prisma Tenant Isolation Extension
All tenant-scoped queries are bound to the authenticated `salon_id`:

```typescript
// Repository Query Pattern
async getAppointmentById(salonId: string, appointmentId: string) {
  const appointment = await this.prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      salonId: salonId, // Mandatory filter prevents cross-tenant lookup
    },
    include: { customer: true, staff: true, service: true }
  });

  if (!appointment) {
    throw new NotFoundException('Appointment not found or does not belong to this salon.');
  }
  return appointment;
}
```

---

## 4. Authentication, Password & Token Security

* **Password Hashing:** `Argon2id` (or `bcrypt` with work factor 12) with unique cryptographic salts per user.
* **JWT Access Tokens:** Short-lived access tokens (15 to 60 minutes) signed with `RS256` or high-entropy `HS256` secrets.
* **Refresh Tokens:** Long-lived (7 to 30 days) stored as cryptographically hashed tokens in the database with automatic token rotation and reuse detection.
* **Secrets Storage:** WhatsApp Access Tokens and Webhook Verify Tokens are encrypted before insertion into `whatsapp_accounts` using `AES-256-GCM` with an application-level master key.

---

## 5. Input Validation, Rate Limiting & DoS Protection

1. **Strict DTO Validation:** NestJS `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, and `transform: true` rejects unexpected fields.
2. **SQL Injection Prevention:** Prisma utilizes parameterized queries exclusively; raw SQL interpolations are prohibited.
3. **Public Booking Rate Limiting:**
   * Global IP Throttling: Max 60 requests per minute per IP.
   * Public Booking Endpoint (`POST /booking/:slug/appointments`): Max 5 booking creations per minute per client IP to prevent booking spam or denial-of-inventory attacks.
4. **CORS Configuration:** Restricted to verified production domains (`app.yoursaas.com`, `book.yoursaas.com`) in production.

---

## 6. Audit Logging Architecture

Every high-privilege action automatically records an entry in `AuditLog`:
* Salon profile updates
* Working hour & holiday changes
* Blocked slot reservations
* Manual appointment cancellations
* Subscription and billing updates

Each audit record tracks: `salon_id`, `user_id`, `action`, `entity_type`, `entity_id`, `ip_address`, `user_agent`, and a structured JSON `metadata` diff.
