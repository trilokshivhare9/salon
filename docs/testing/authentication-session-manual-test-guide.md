# Human Manual Testing Guide: Authentication, Session Management, Refresh Tokens & Multi-Tenant Security

> **SAFETY WARNING**: 
> **NEVER RUN THESE MANUAL TESTS AGAINST PRODUCTION UNLESS EXPLICITLY AUTHORIZED BY PLATFORM SECURITY LEADERSHIP.**
> Always perform black-box manual testing against a dedicated local or staging development environment (`NODE_ENV=development`) connected to a test database (e.g., `salon_saas_dev`).

---

## 1. Testing Principles & Guidelines

This document provides a black-box manual testing protocol for human QA engineers, security auditors, and developers.

### Rules for the Human Tester:
- **Test actual running APIs**: Execute HTTP requests against the real running NestJS backend (`http://localhost:3000/api/v1`).
- **Use standard API clients**: Use Postman, Bruno, Insomnia, `curl`, or HTTP client tools.
- **Verify HTTP status & response payloads**: Check status codes (200, 201, 400, 401, 403, 404) and JSON body structures.
- **Verify PostgreSQL database state**: Check the database using `psql`, Prisma Studio (`npx prisma studio`), or DB client after important operations.
- **Record evidence**: Document API responses, DB screenshots, and HTTP status codes for every test case.

### Strict Prohibitions:
- ❌ **DO NOT modify application source code** or security logic during testing.
- ❌ **DO NOT modify Prisma schema** or database structure.
- ❌ **DO NOT bypass guards** or disable authentication middleware.
- ❌ **DO NOT insert fake database records** manually to force a test to pass.
- ❌ **DO NOT manually delete database records** to clean up a failed test.
- ❌ **DO NOT log or expose raw refresh tokens or passwords** in test reports.

---

## 2. Test Environment Setup & Configuration

### Target Backend Configuration
- **Base API URL**: `http://localhost:3000/api/v1`
- **Target Environment**: Local Development / Staging
- **Target PostgreSQL Database**: `salon_saas_dev`
- **Port**: `3000`

### Required Tools
1. **API Client**: Postman, Bruno, Insomnia, or `curl`
2. **Database Viewer**: Prisma Studio (`npx prisma studio --port 5555`) or `psql` shell
3. **JSON Formatter**: Browser dev tools or Postman JSON view

### Base Test Fixtures & Preconditions
Ensure the database contains the following initial test accounts (or create them via `/api/v1/auth/register` and `/api/v1/salons/platform/create` during setup):

| Role | Account Name | Email | Default Password | Salon Context |
| :--- | :--- | :--- | :--- | :--- |
| **Super Admin** | Platform Super Admin | `superadmin@salonsaas.com` | `Password123!` | Platform Level (`salonId: null`) |
| **Salon Owner A** | Owner Salon Alpha | `owner-alpha@salonsaas.com` | `Password123!` | Salon Alpha (`salonId: <salon-alpha-uuid>`) |
| **Salon Owner B** | Owner Salon Beta | `owner-beta@salonsaas.com` | `Password123!` | Salon Beta (`salonId: <salon-beta-uuid>`) |

---

## 3. Database Verification Protocol

For every test scenario where session state or user state changes, verify the corresponding PostgreSQL database tables using Prisma Studio (`npx prisma studio`) or SQL queries against `salon_saas_dev`.

### Authoritative Database Models & Exact Schema Fields

#### 1. `UserSession` Model (`user_sessions` table)
| Field | Type | Verification Criteria |
| :--- | :--- | :--- |
| `id` | String (UUID) | Unique Session Identifier (embedded as `sessionId` in Access Token JWT claims). |
| `adminId` | String (UUID) | Foreign key pointing to `admins.id`. Must match the logged-in user. |
| `tokenHash` | String | SHA-256 hex digest of the raw refresh token (`crypto.createHash('sha256')`). **Raw refresh token string must NEVER be stored in DB.** |
| `familyId` | String (UUID) | Token Rotation Family ID. Rotated sessions share the exact same `familyId`. |
| `isRevoked` | Boolean | `false` when session is active; `true` when revoked (logout, RTR rotation, or family revocation). |
| `revokedAt` | DateTime / Null | `null` when active; timestamp populated when `isRevoked` becomes `true`. |
| `lastUsedAt` | DateTime | Timestamp of last session activity. |
| `expiresAt` | DateTime | Expiration date (defaults to `createdAt` + 7 days). |
| `userAgent` | String / Null | HTTP `User-Agent` string captured from request header. |
| `ipAddress` | String / Null | Client IP address captured from request header. |
| `createdAt` | DateTime | Record creation timestamp. |
| `updatedAt` | DateTime | Record update timestamp. |

#### 2. `Admin` Model (`admins` table)
| Field | Type | Verification Criteria |
| :--- | :--- | :--- |
| `id` | String (UUID) | Primary Key. |
| `salonId` | String / Null | Associated Salon UUID (`null` for `SUPER_ADMIN`; required for `SALON_OWNER`). |
| `email` | String | Unique email address (lowercase). |
| `phone` | String / Null | Phone number. |
| `passwordHash` | String | Bcrypt password hash (`$2b$10$...`). **Raw password must NEVER be stored.** |
| `role` | AdminRole Enum | `SUPER_ADMIN` or `SALON_OWNER`. |
| `status` | AdminStatus Enum | `ACTIVE`, `INACTIVE`, or `SUSPENDED`. |

#### 3. `Salon` Model (`salons` table)
| Field | Type | Verification Criteria |
| :--- | :--- | :--- |
| `id` | String (UUID) | Salon Primary Key. |
| `name` | String | Salon Business Name. |
| `slug` | String | Unique URL slug. |
| `status` | SalonStatus Enum | `ACTIVE`, `INACTIVE`, `SUSPENDED`, or `DEACTIVATED`. |

---

## 4. Discovered API Endpoints Reference

| Module | Method | Endpoint Path | Auth Guard Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Auth** | `POST` | `/api/v1/auth/login` | `@Public()` | User login via Email or Phone + Password. |
| **Auth** | `POST` | `/api/v1/auth/refresh` | `@Public()` | Issue new Access Token & rotated Refresh Token via RTR. |
| **Auth** | `POST` | `/api/v1/auth/logout` | `@Public()` | Revoke specific session by Refresh Token. |
| **Auth** | `POST` | `/api/v1/auth/logout-all` | `JwtAuthGuard` | Revoke 100% of active sessions for the current user. |
| **Auth** | `POST` | `/api/v1/auth/register` | `@Public()` | Self-service registration of new Salon Owner + Salon. |
| **Auth** | `GET` | `/api/v1/auth/me` | `JwtAuthGuard` | Get currently authenticated user profile. |
| **Salons** | `GET` | `/api/v1/salons/platform/all` | `JwtAuthGuard`, `@Roles(SUPER_ADMIN)` | Super Admin view of all platform salons. |
| **Salons** | `POST` | `/api/v1/salons/platform/create` | `JwtAuthGuard`, `@Roles(SUPER_ADMIN)` | Super Admin salon creation. |
| **Salons** | `PATCH` | `/api/v1/salons/platform/:id/toggle-status` | `JwtAuthGuard`, `@Roles(SUPER_ADMIN)` | Super Admin toggle salon active/inactive status. |
| **Salons** | `GET` | `/api/v1/salons/profile` | `JwtAuthGuard`, `TenantContextGuard` | Get salon profile for current tenant context. |
| **Salons** | `PUT` | `/api/v1/salons/profile` | `JwtAuthGuard`, `TenantContextGuard` | Update salon profile for current tenant context. |

> **Note on Missing Endpoints**:
> Dedicated HTTP endpoints for *Password Change / Reset* and *Self-Service Account Deactivation* are currently **NOT IMPLEMENTED** in the HTTP API controller layer.
> Corresponding test scenarios (`SESSION-008`) are marked **NOT AVAILABLE VIA API / BLOCKED** and verified via manual DB status updates.

---

## 5. Manual Test Cases

### Category A: Authentication Tests (`AUTH-001` to `AUTH-007`)

#### AUTH-001: Successful Super Admin Login
- **Objective**: Verify Super Admin can authenticate and receive valid JWT access token + refresh token.
- **Preconditions**: Super Admin account exists (`superadmin@salonsaas.com` / `Password123!`).
- **HTTP Method**: `POST`
- **Endpoint**: `/api/v1/auth/login`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "email": "superadmin@salonsaas.com",
    "password": "Password123!"
  }
  ```
- **Expected HTTP Status**: `200 OK`
- **Expected Response Body**:
  ```json
  {
    "accessToken": "<jwt-string>",
    "refreshToken": "rt_<uuid>_<random-hex>",
    "expiresIn": 900,
    "user": {
      "id": "<superadmin-uuid>",
      "name": "Platform Super Admin",
      "email": "superadmin@salonsaas.com",
      "role": "SUPER_ADMIN",
      "salonId": null,
      "salon": null
    }
  }
  ```
- **Database Verification**:
  - `user_sessions`: 1 new record created with `adminId = <superadmin-uuid>`, `isRevoked = false`, `expiresAt = now + 7 days`.
  - `tokenHash` matches SHA-256 hash of returned `refreshToken`. Raw refresh token string is **NOT** in DB.
- **Pass Criteria**: Status 200, JWT returned, `salonId = null`, valid `UserSession` in DB.

#### AUTH-002: Successful Salon Owner Login
- **Objective**: Verify Salon Owner can authenticate via Email or Phone.
- **Preconditions**: Salon Owner Alpha account exists (`owner-alpha@salonsaas.com` / `Password123!`).
- **HTTP Method**: `POST`
- **Endpoint**: `/api/v1/auth/login`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "email": "owner-alpha@salonsaas.com",
    "password": "Password123!"
  }
  ```
- **Expected HTTP Status**: `200 OK`
- **Expected Response Body**:
  - `user.role` = `"SALON_OWNER"`
  - `user.salonId` = `<salon-alpha-uuid>`
  - `user.salon` object contains name, slug, timezone, status.
- **Database Verification**: `user_sessions` record created with `adminId = ownerAdmin.id` and `familyId`.
- **Pass Criteria**: Status 200, valid tokens, `user.salonId` matches Salon Alpha.

#### AUTH-003: Login with Invalid Password
- **Objective**: Verify authentication fails when incorrect password is provided.
- **HTTP Method**: `POST`
- **Endpoint**: `/api/v1/auth/login`
- **Request Body**:
  ```json
  {
    "email": "owner-alpha@salonsaas.com",
    "password": "WrongPassword123!"
  }
  ```
- **Expected HTTP Status**: `401 Unauthorized`
- **Expected Response Body**:
  ```json
  {
    "statusCode": 401,
    "message": "Invalid email or password."
  }
  ```
- **Database Verification**: Zero new records added to `user_sessions`.
- **Pass Criteria**: Status 401, error message returned, DB unchanged.

#### AUTH-004: Login with Nonexistent User
- **Objective**: Verify authentication fails gracefully for unknown email/phone.
- **HTTP Method**: `POST`
- **Endpoint**: `/api/v1/auth/login`
- **Request Body**:
  ```json
  {
    "email": "nonexistent-user@salonsaas.com",
    "password": "Password123!"
  }
  ```
- **Expected HTTP Status**: `401 Unauthorized`
- **Pass Criteria**: Status 401, error message returned, DB unchanged.

#### AUTH-005: Protected API with Valid Access Token
- **Objective**: Verify access to protected endpoint using Bearer Access Token.
- **Preconditions**: Obtain `accessToken` from `AUTH-002`.
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/auth/me`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Expected HTTP Status**: `200 OK`
- **Expected Response Body**: Returns user profile (`id`, `name`, `email`, `role`, `salonId`, `salon`).
- **Pass Criteria**: Status 200, correct profile returned.

#### AUTH-006: Protected API without Token
- **Objective**: Verify request without Authorization header is rejected.
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/auth/me`
- **Headers**: *(No Authorization Header)*
- **Expected HTTP Status**: `401 Unauthorized`
- **Pass Criteria**: Status 401 Unauthorized.

#### AUTH-007: Expired Access Token
- **Objective**: Verify request with expired JWT is rejected.
- **Preconditions**: Use an access token generated over 15 minutes ago (or tampered exp timestamp).
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/auth/me`
- **Headers**: `Authorization: Bearer <expired-token>`
- **Expected HTTP Status**: `401 Unauthorized`
- **Pass Criteria**: Status 401 Unauthorized.

---

### Category B: Session Management Tests (`SESSION-001` to `SESSION-008`)

#### SESSION-001: Session Creation during Login
- **Objective**: Verify database session creation details upon login.
- **Execution**: Login via `POST /api/v1/auth/login`.
- **Database Verification**:
  - `user_sessions` query: `SELECT * FROM user_sessions WHERE admin_id = '<user-uuid>' ORDER BY created_at DESC LIMIT 1;`
  - `is_revoked` = `false`
  - `expires_at` = `created_at + 7 days`
  - `family_id` is a valid UUID.
- **Pass Criteria**: Valid `user_sessions` DB row exists matching token payload `sessionId`.

#### SESSION-002: Multiple Logins Create Independent Sessions
- **Objective**: Verify logging in from 2 devices creates 2 active sessions.
- **Execution**:
  1. Login on Device 1 (`User-Agent: DeviceA`).
  2. Login on Device 2 (`User-Agent: DeviceB`).
- **Database Verification**: `user_sessions` contains 2 active records (`is_revoked = false`) with different `id` and `family_id` values.
- **Pass Criteria**: Both sessions active independently in DB.

#### SESSION-003: Individual Session Logout
- **Objective**: Verify logging out revokes only the specific session.
- **HTTP Method**: `POST`
- **Endpoint**: `/api/v1/auth/logout`
- **Request Body**:
  ```json
  {
    "refreshToken": "<refreshToken-Device1>"
  }
  ```
- **Expected HTTP Status**: `200 OK`
- **Expected Response Body**: `{"success": true, "message": "Logged out successfully."}`
- **Database Verification**:
  - Device 1 session: `is_revoked = true`, `revoked_at` is set to current timestamp.
  - Device 2 session: `is_revoked = false` (remains active).
- **Pass Criteria**: Device 1 revoked, Device 2 active.

#### SESSION-004: Logout All Devices
- **Objective**: Verify `logout-all` revokes 100% of user sessions.
- **Preconditions**: User has 3 active sessions across different devices.
- **HTTP Method**: `POST`
- **Endpoint**: `/api/v1/auth/logout-all`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Expected HTTP Status**: `200 OK`
- **Expected Response Body**: `{"success": true, "message": "Logged out from all devices."}`
- **Database Verification**: `SELECT COUNT(*) FROM user_sessions WHERE admin_id = '<user-id>' AND is_revoked = false;` returns `0`.
- **Pass Criteria**: All DB sessions for user marked `is_revoked = true`.

#### SESSION-005: Session Revocation Check in JWT Guard
- **Objective**: Verify accessing protected API with access token of a revoked session fails.
- **Preconditions**: Log out session via `POST /api/v1/auth/logout`.
- **Execution**: Call `GET /api/v1/auth/me` using the `accessToken` issued before logout.
- **Expected HTTP Status**: `401 Unauthorized`
- **Expected Response Body**: `{"statusCode": 401, "message": "Session has been revoked or expired."}`
- **Pass Criteria**: Access blocked immediately after session revocation.

#### SESSION-006: Expired Session Behavior
- **Objective**: Verify expired session cannot be refreshed.
- **Preconditions**: In DB, update session `expires_at = now() - 1 hour`.
- **Execution**: Call `POST /api/v1/auth/refresh` with `refreshToken`.
- **Expected HTTP Status**: `401 Unauthorized`
- **Expected Response Body**: `{"statusCode": 401, "message": "Refresh token has expired. Please log in again."}`
- **Pass Criteria**: Status 401, error message returned.

#### SESSION-007: Deactivated Account Session Behavior
- **Objective**: Verify deactivating user account revokes session access on refresh.
- **Preconditions**: User logs in. In DB, update `admins` table `status = 'INACTIVE'`.
- **Execution**: Call `POST /api/v1/auth/refresh` with `refreshToken`.
- **Expected HTTP Status**: `401 Unauthorized`
- **Expected Response Body**: `{"statusCode": 401, "message": "User account deactivated or suspended."}`
- **Database Verification**: Session marked `is_revoked = true` in `user_sessions`.
- **Pass Criteria**: Status 401, session marked revoked in DB.

#### SESSION-008: Password / Security Invalidation
- **Status**: **NOT AVAILABLE VIA API / BLOCKED** (No dedicated `/auth/change-password` HTTP endpoint in current controller).
- **Verification Protocol**: Tested via DB password update or account deactivation test (`SESSION-007`).

---

### Category C: Refresh Token Testing (`REFRESH-001` to `REFRESH-009`)

#### REFRESH-001: Normal Token Refresh
- **Objective**: Verify exchanging a valid refresh token for a new access token and rotated refresh token.
- **HTTP Method**: `POST`
- **Endpoint**: `/api/v1/auth/refresh`
- **Request Body**:
  ```json
  {
    "refreshToken": "<valid-refreshToken-A>"
  }
  ```
- **Expected HTTP Status**: `200 OK`
- **Expected Response Body**:
  ```json
  {
    "accessToken": "<new-access-token>",
    "refreshToken": "<new-refreshToken-B>",
    "expiresIn": 900,
    "user": { ... }
  }
  ```
- **Pass Criteria**: Status 200, new tokens issued, `<new-refreshToken-B>` != `<valid-refreshToken-A>`.

#### REFRESH-002: Refresh Token Rotation (RTR)
- **Objective**: Verify old refresh token is marked revoked after rotation.
- **Execution**: Perform `REFRESH-001`.
- **Database Verification**:
  - Session for `refreshToken-A`: `is_revoked = true`, `revoked_at` populated.
  - New Session for `refreshToken-B`: `is_revoked = false`, shares exact same `family_id` as Session A.
- **Pass Criteria**: Old token session revoked, new token session created under same `familyId`.

#### REFRESH-003: Old Refresh Token Reuse Detection (Security Event)
- **Objective**: Verify reusing an already rotated refresh token triggers Token Family Revocation.
- **Preconditions**: Perform `REFRESH-001` (`refreshToken-A` rotated to `refreshToken-B`).
- **Execution**: Attempt `POST /api/v1/auth/refresh` using the **old** `refreshToken-A` again.
- **Expected HTTP Status**: `401 Unauthorized`
- **Expected Response Body**: `{"statusCode": 401, "message": "Security Breach Alert: Token reuse detected. All active family sessions revoked."}`
- **Database Verification**: `SELECT COUNT(*) FROM user_sessions WHERE family_id = '<family-uuid>' AND is_revoked = false;` returns `0`. All sessions under `familyId` are now revoked!
- **Pass Criteria**: Status 401, exact breach message returned, entire session family revoked in DB.

#### REFRESH-004: Refresh After Logout
- **Objective**: Verify refresh fails after user logs out.
- **Preconditions**: Perform logout (`LOGOUT-001`).
- **Execution**: Attempt `POST /api/v1/auth/refresh` with the logged-out refresh token.
- **Expected HTTP Status**: `401 Unauthorized`
- **Pass Criteria**: Status 401 Unauthorized.

#### REFRESH-005: Refresh After Logout-All
- **Objective**: Verify all refresh tokens fail after `logout-all`.
- **Preconditions**: Perform `POST /api/v1/auth/logout-all`.
- **Execution**: Attempt refresh using any previous refresh token.
- **Expected HTTP Status**: `401 Unauthorized`
- **Pass Criteria**: Status 401 Unauthorized across all tokens.

#### REFRESH-006: Refresh After Account Deactivation
- **Objective**: Verify refresh fails if account status is set to `SUSPENDED` or `INACTIVE`.
- **Execution**: Update `admins.status = 'SUSPENDED'` in DB and execute refresh.
- **Expected HTTP Status**: `401 Unauthorized`
- **Pass Criteria**: Status 401 Unauthorized.

#### REFRESH-007: Expired Refresh Token
- **Objective**: Verify expired refresh token is rejected.
- **Execution**: Pass refresh token whose DB `expires_at` is in the past.
- **Expected HTTP Status**: `401 Unauthorized`
- **Pass Criteria**: Status 401 Unauthorized.

#### REFRESH-008: Invalid Refresh Token Format / String
- **Objective**: Verify random string refresh token is rejected.
- **Execution**: `POST /api/v1/auth/refresh` with `{"refreshToken": "invalid-random-string"}`.
- **Expected HTTP Status**: `401 Unauthorized`
- **Expected Response Body**: `{"statusCode": 401, "message": "Invalid refresh token."}`
- **Pass Criteria**: Status 401 Unauthorized.

#### REFRESH-009: Concurrent Refresh Protection
- **Objective**: Verify system handles parallel refresh requests safely without race conditions.
- **Execution**: Send 2 simultaneous HTTP requests to `/api/v1/auth/refresh` using the same `refreshToken`.
- **Expected Outcome**: One request succeeds with HTTP 200 issuing rotated tokens; the near-simultaneous duplicate is handled safely by server mutex/session check without DB corruption.
- **Pass Criteria**: DB remains consistent with 1 active rotated session.

---

### Category D: Role Authorization Tests (`ROLE-001` to `ROLE-005`)

#### ROLE-001: Super Admin Accessing Platform Endpoint
- **Objective**: Verify Super Admin can access platform-wide endpoints.
- **Preconditions**: Logged in as Super Admin (`superadmin@salonsaas.com`).
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/salons/platform/all`
- **Headers**: `Authorization: Bearer <superadmin-accessToken>`
- **Expected HTTP Status**: `200 OK`
- **Expected Response Body**: List of all platform salons and system statistics.
- **Pass Criteria**: Status 200, platform data returned.

#### ROLE-002: Salon Owner Accessing Platform Endpoint (Role Escalation Prevention)
- **Objective**: Verify Salon Owner is blocked from platform endpoints.
- **Preconditions**: Logged in as Salon Owner (`owner-alpha@salonsaas.com`).
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/salons/platform/all`
- **Headers**: `Authorization: Bearer <salonOwner-accessToken>`
- **Expected HTTP Status**: `403 Forbidden`
- **Expected Response Body**: `{"statusCode": 403, "message": "You do not have the required permissions for this action."}`
- **Pass Criteria**: Status 403 Forbidden.

#### ROLE-003: Valid Role Accessing Salon Profile Endpoint
- **Objective**: Verify Salon Owner can access their salon profile.
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/salons/profile`
- **Headers**: `Authorization: Bearer <salonOwnerAlpha-accessToken>`
- **Expected HTTP Status**: `200 OK`
- **Pass Criteria**: Status 200, Salon Alpha profile data returned.

#### ROLE-004: Unauthenticated Role Access Attempt
- **Objective**: Verify unauthenticated request to role-guarded route is rejected.
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/salons/profile`
- **Headers**: *(No Authorization Header)*
- **Expected HTTP Status**: `401 Unauthorized`
- **Pass Criteria**: Status 401 Unauthorized.

#### ROLE-005: JWT Role Tampering Prevention
- **Objective**: Verify modifying JWT payload `role` string invalidates the token signature.
- **Execution**: Take valid `accessToken`, decode header/payload, change `"role": "SALON_OWNER"` to `"role": "SUPER_ADMIN"`, leave signature unchanged, send to `GET /api/v1/salons/platform/all`.
- **Expected HTTP Status**: `401 Unauthorized`
- **Pass Criteria**: Status 401 Unauthorized (JWT signature verification failure).

---

### Category E: Multi-Tenant Isolation & IDOR Tests (`TENANT-001` to `TENANT-012`)

#### TENANT-001: Salon A Owner Accesses Salon A Resources
- **Objective**: Verify Salon Owner Alpha accesses own salon profile.
- **Preconditions**: Authenticated as Salon Owner Alpha (`user.salonId = <salon-alpha-uuid>`).
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/salons/profile`
- **Headers**: `Authorization: Bearer <accessToken-Alpha>`
- **Expected HTTP Status**: `200 OK`
- **Expected Response**: Returns profile of **Salon Alpha**.
- **Pass Criteria**: Status 200, `request.tenantSalonId` resolves to Salon Alpha.

#### TENANT-002: Salon A Owner Attempts Access to Salon B Data (IDOR Prevention)
- **Objective**: Verify Salon Owner Alpha cannot access Salon Beta data.
- **Preconditions**: Salon Owner Alpha authenticated.
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/salons/profile`
- **Headers**: `Authorization: Bearer <accessToken-Alpha>`, `X-Salon-Id: <salon-beta-uuid>`
- **Expected HTTP Status**: `403 Forbidden`
- **Expected Response Body**: `{"statusCode": 403, "message": "Cross-tenant access attempt rejected. Header salonId mismatch."}`
- **Pass Criteria**: Status 403 Forbidden, zero Salon Beta data returned.

#### TENANT-003: Salon A Owner Manipulates Route Parameter `:salonId`
- **Objective**: Verify manipulating URL route parameter to another salon is rejected.
- **Preconditions**: Authenticated as Salon Owner Alpha.
- **HTTP Method**: `POST`
- **Endpoint**: `/api/v1/salons/<salon-beta-uuid>/whatsapp-config`
- **Headers**: `Authorization: Bearer <accessToken-Alpha>`
- **Request Body**: `{"phoneNumberId": "1234567890"}`
- **Expected HTTP Status**: `403 Forbidden`
- **Expected Response Body**: `{"statusCode": 403, "message": "Cross-tenant access attempt rejected. Route param salonId mismatch."}`
- **Pass Criteria**: Status 403 Forbidden.

#### TENANT-004: Salon A Owner Sends `X-Salon-Id = Salon B`
- **Objective**: Verify Salon Owner header override attempt fails.
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/salons/profile`
- **Headers**: `Authorization: Bearer <accessToken-Alpha>`, `X-Salon-Id: <salon-beta-uuid>`
- **Expected HTTP Status**: `403 Forbidden`
- **Pass Criteria**: Status 403 Forbidden.

#### TENANT-005: Salon A Owner Sends Conflicting Tenant Identifiers
- **Objective**: Verify sending `X-Salon-Id = Salon B` with URL parameter `Salon A` is rejected.
- **HTTP Method**: `POST`
- **Endpoint**: `/api/v1/salons/<salon-alpha-uuid>/whatsapp-config`
- **Headers**: `Authorization: Bearer <accessToken-Alpha>`, `X-Salon-Id: <salon-beta-uuid>`
- **Expected HTTP Status**: `403 Forbidden`
- **Pass Criteria**: Status 403 Forbidden.

#### TENANT-006: Super Admin Accessing Platform Endpoint Without Tenant Context
- **Objective**: Verify Super Admin accesses platform routes without requiring `X-Salon-Id`.
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/salons/platform/all`
- **Headers**: `Authorization: Bearer <superadmin-accessToken>`
- **Expected HTTP Status**: `200 OK`
- **Pass Criteria**: Status 200 OK (`tenantSalonId` remains undefined).

#### TENANT-007: Super Admin Accesses Valid Salon A Context via `X-Salon-Id`
- **Objective**: Verify Super Admin context switching to Salon Alpha.
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/salons/profile`
- **Headers**: `Authorization: Bearer <superadmin-accessToken>`, `X-Salon-Id: <salon-alpha-uuid>`
- **Expected HTTP Status**: `200 OK`
- **Expected Response**: Returns profile of **Salon Alpha**.
- **Pass Criteria**: Status 200 OK, `tenantSalonId` resolves to Salon Alpha.

#### TENANT-008: Super Admin Accesses Valid Salon B Context via `X-Salon-Id`
- **Objective**: Verify Super Admin context switching to Salon Beta.
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/salons/profile`
- **Headers**: `Authorization: Bearer <superadmin-accessToken>`, `X-Salon-Id: <salon-beta-uuid>`
- **Expected HTTP Status**: `200 OK`
- **Expected Response**: Returns profile of **Salon Beta**.
- **Pass Criteria**: Status 200 OK, `tenantSalonId` resolves to Salon Beta.

#### TENANT-009: Super Admin Provides Nonexistent Salon ID
- **Objective**: Verify Super Admin context switch to non-existent UUID fails.
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/salons/profile`
- **Headers**: `Authorization: Bearer <superadmin-accessToken>`, `X-Salon-Id: 00000000-0000-0000-0000-000000000000`
- **Expected HTTP Status**: `404 Not Found`
- **Expected Response Body**: `{"statusCode": 404, "message": "Target salon context '00000000-0000-0000-0000-000000000000' does not exist."}`
- **Pass Criteria**: Status 404 Not Found.

#### TENANT-010: Super Admin Provides Deactivated Salon ID
- **Objective**: Verify Super Admin context switch to deactivated salon is rejected.
- **Preconditions**: In DB, update Salon Beta `status = 'DEACTIVATED'`.
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/salons/profile`
- **Headers**: `Authorization: Bearer <superadmin-accessToken>`, `X-Salon-Id: <salon-beta-uuid>`
- **Expected HTTP Status**: `403 Forbidden`
- **Expected Response Body**: `{"statusCode": 403, "message": "Target salon context '<salon-beta-uuid>' is deactivated."}`
- **Pass Criteria**: Status 403 Forbidden.

#### TENANT-011: Salon Owner Attempts Super Admin Context Switch Mechanism
- **Objective**: Verify Salon Owner passing valid `X-Salon-Id: <salon-beta-uuid>` header is rejected.
- **HTTP Method**: `GET`
- **Endpoint**: `/api/v1/salons/profile`
- **Headers**: `Authorization: Bearer <accessToken-OwnerAlpha>`, `X-Salon-Id: <salon-beta-uuid>`
- **Expected HTTP Status**: `403 Forbidden`
- **Pass Criteria**: Status 403 Forbidden.

#### TENANT-012: Direct IDOR Resource Manipulation
- **Objective**: Verify Salon Owner Alpha attempting to update Salon Beta profile fails.
- **HTTP Method**: `PUT`
- **Endpoint**: `/api/v1/salons/profile`
- **Headers**: `Authorization: Bearer <accessToken-OwnerAlpha>`, `X-Salon-Id: <salon-beta-uuid>`
- **Request Body**: `{"name": "Hacked Salon Name"}`
- **Expected HTTP Status**: `403 Forbidden`
- **Database Verification**: Salon Beta name in DB remains unchanged.
- **Pass Criteria**: Status 403, DB data untouched.

---

## 6. Database Consistency Testing Protocol

The human tester MUST perform Before & After database state recordings for every test altering session state:

### Step-by-Step Procedure:
1. **RECORD BEFORE STATE**: Run `SELECT id, admin_id, token_hash, family_id, is_revoked, revoked_at, last_used_at, expires_at FROM user_sessions WHERE admin_id = '<user-id>';`
2. **EXECUTE API OPERATION**: Send HTTP request via Postman/curl.
3. **RECORD AFTER STATE**: Run the same SQL query again.
4. **VERIFY CHANGES**:
   - **Login**: Exactly 1 new row inserted. `is_revoked = false`. `expires_at = now + 7 days`.
   - **Refresh**: Old row `is_revoked` changes from `false` to `true`; `revoked_at` is set. New row created with same `family_id`.
   - **Logout**: Row `is_revoked` changes to `true`; `revoked_at` is set.
   - **Logout-All**: All rows for user change `is_revoked` to `true`.
   - **Reuse Breach**: 100% of rows matching `family_id` change `is_revoked` to `true`.

---

## 7. Failure Rule & Severity Classification

### Strict Failure Protocol:
When a test fails, the tester **MUST NOT**:
- Modify backend source code or configuration.
- Manually edit PostgreSQL database tables to force a pass.
- Skip recording evidence.

### Severity Classification Matrix:
- 🚨 **CRITICAL**: IDOR vulnerability (Salon A accesses Salon B), Token Reuse breach failure, JWT signature bypass, unhashed refresh token stored in DB.
- 🔴 **HIGH**: Logout fails to revoke session, Refresh Token Rotation (RTR) fails, Account deactivation ignored.
- 🟡 **MEDIUM**: Incorrect HTTP status code returned (e.g., 500 instead of 403), missing error message field.
- 🟢 **LOW**: Minor formatting inconsistency in response payload.

---

## 8. Test Data Cleanup Protocol

At the conclusion of testing on a local development/test database:
1. **API Cleanup**: Call `POST /api/v1/auth/logout-all` to invalidate active test sessions.
2. **Administrative Cleanup**: If required in local dev, run `npx prisma db seed` or wipe local test DB (`salon_saas_dev`).
3. ⚠️ **WARNING**: NEVER perform database wiping operations on Staging or Production environments.

---

## 9. Human Manual Test Report Template

Copy and fill out the template below when completing a manual testing cycle:

```markdown
# AUTHENTICATION & SESSION MANAGEMENT MANUAL TEST REPORT

**Environment**: Local Development (`http://localhost:3000/api/v1`)  
**Database**: PostgreSQL (`salon_saas_dev`)  
**Date**: YYYY-MM-DD  
**Tester Name**: [Tester Name]  
**Git Commit ID**: [Commit Hash]  

---

### EXECUTIVE SUMMARY MATRIX

| Category | Total Tests | Passed | Failed | Blocked |
| :--- | :---: | :---: | :---: | :---: |
| Authentication (`AUTH`) | 7 | | | |
| Sessions (`SESSION`) | 8 | | | |
| Refresh Tokens (`REFRESH`) | 9 | | | |
| Logout (`LOGOUT`) | 5 | | | |
| Role Authorization (`ROLE`) | 5 | | | |
| Multi-Tenant Isolation (`TENANT`) | 12 | | | |
| **TOTAL** | **46** | | | |

---

### INDIVIDUAL TEST EXECUTION DETAILS

#### Test Case ID: [e.g. AUTH-001]
- **Test Name**: [Test Name]
- **Status**: [ PASS / FAIL / BLOCKED ]
- **Role / User**: [e.g. SUPER_ADMIN / superadmin@salonsaas.com]
- **HTTP Endpoint**: [POST /api/v1/auth/login]
- **Expected HTTP Status**: [200 OK]
- **Actual HTTP Status**: [200 OK]
- **API Response**:
  ```json
  [Paste API Response Snippet Here]
  ```
- **Database Verification**:
  - `user_sessions` Before: [Record State]
  - `user_sessions` After: [Record State]
  - DB Verdict: [ PASS / FAIL ]
- **Security Verification**: [ PASS / FAIL ]
- **Evidence Screenshots / References**: [Attach screenshot or log line]
- **Notes / Observations**: [Notes]

---

### FAILURE DISCREPANCY LOG (If Any)

| Test ID | Severity | Observed Behavior | Expected Behavior | Reproduction Steps |
| :--- | :--- | :--- | :--- | :--- |
| | | | | |

---

### FINAL SYSTEM VERDICT

**System Security Status**: [ PASS / PASS WITH ISSUES / FAIL / BLOCKED ]

*(System can ONLY be marked PASS if 100% of Critical and High security tests pass without exception.)*
```

---

## 10. Final Assessment Summary

1. **File Created**: `docs/testing/authentication-session-manual-test-guide.md`
2. **Actual API Endpoints Discovered**:
   - `POST /api/v1/auth/login`
   - `POST /api/v1/auth/refresh`
   - `POST /api/v1/auth/logout`
   - `POST /api/v1/auth/logout-all`
   - `POST /api/v1/auth/register`
   - `GET /api/v1/auth/me`
   - `GET /api/v1/salons/platform/all`
   - `POST /api/v1/salons/platform/create`
   - `PATCH /api/v1/salons/platform/:id/toggle-status`
   - `GET /api/v1/salons/profile`
   - `PUT /api/v1/salons/profile`
3. **Actual Database Models & Fields Used**:
   - `UserSession`: `id`, `adminId`, `tokenHash`, `familyId`, `isRevoked`, `revokedAt`, `lastUsedAt`, `expiresAt`, `userAgent`, `ipAddress`, `createdAt`, `updatedAt`
   - `Admin`: `id`, `salonId`, `name`, `email`, `phone`, `passwordHash`, `role`, `status`
   - `Salon`: `id`, `name`, `slug`, `status`
4. **Number of Test Scenarios Defined**: **46 Scenarios**
   - `AUTH`: 7 scenarios
   - `SESSION`: 8 scenarios
   - `REFRESH`: 9 scenarios
   - `LOGOUT`: 5 scenarios
   - `ROLE`: 5 scenarios
   - `TENANT`: 12 scenarios
5. **Scenarios Currently Not Available via API**:
   - `SESSION-008` (Self-Service Password Reset/Change HTTP Endpoint) is currently not exposed as a dedicated API endpoint in the auth controller; verified via DB status changes.
