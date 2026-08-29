# Salon Appointment & Customer Management SaaS

A multi-tenant, enterprise-grade B2B SaaS platform engineered specifically for independent salons, barbershops, and beauty studios.

[![Architecture: NestJS + Prisma + PostgreSQL](https://img.shields.io/badge/Backend-NestJS%20%7C%20Prisma%20%7C%20PostgreSQL-blue.svg)](#)
[![Frontend: Modern Responsive Web](https://img.shields.io/badge/Frontend-Responsive%20Web-purple.svg)](#)
[![Multi-Tenancy: Row--Level Isolation](https://img.shields.io/badge/Tenancy-Isolated%20by%20salon__id-green.svg)](#)
[![Concurrency: Zero Double--Booking](https://img.shields.io/badge/Concurrency-GiST%20Exclusion%20Lock-orange.svg)](#)

---

## 📖 Architecture & Design Documentation Package

Before writing production code, the complete product discovery, system architecture, database design, API specification, security model, and testing strategy have been formalized:

* 📄 **[Product Requirements Document (PRD)](docs/REQUIREMENTS.md)** — MoSCoW feature breakdown, user personas, and gap analysis.
* 🏛️ **[System Architecture](docs/ARCHITECTURE.md)** — Multi-tenant isolation model, core booking engine flow, and component diagrams.
* 🗄️ **[Database Architecture & Schema](docs/DATABASE.md)** — Complete PostgreSQL schema, Prisma definitions, temporal indexes, and GiST constraints.
* 🔌 **[RESTful API Specification](docs/API.md)** — Complete endpoints, payloads, response envelopes, and error codes.
* 🔒 **[Security Architecture & RBAC](docs/SECURITY.md)** — Zero-trust multi-tenancy, JWT session tokens, and least-privilege matrix.
* 🧪 **[Testing & Concurrency QA Strategy](docs/TESTING.md)** — Concurrency race-condition testing and tenant isolation test specs.
* 🚀 **[Deployment & DevOps Guide](docs/DEPLOYMENT.md)** — Multi-stage Docker, environment configurations, and health probes.
* 💬 **[WhatsApp Cloud API Integration](docs/WHATSAPP.md)** — Webhook receiver, 8-state conversation machine, and message templates.
* ⚖️ **[Architecture Decision Records (ADRs)](docs/DECISIONS.md)** — Technical rationale, design trade-offs, and historical context.
* 🗺️ **[Development Roadmap](docs/ROADMAP.md)** — Phased milestone execution plan and Definition of Done.

---

## 🌟 Core Pillars

1. **One Central Booking Engine:** All customer and internal channels (Public Web Booking `/book/:slug`, WhatsApp Bot, Staff Dashboard, Phone Bookings, Walk-ins) execute the exact same availability calculation and booking logic.
2. **Zero Double-Booking Guarantee:** Mathematical concurrency defense using database-level row locks and PostgreSQL GiST temporal exclusion constraints.
3. **Strict Multi-Tenant Isolation:** Single shared database with rigorous application-level and ORM-level `salon_id` enforcement.
4. **Decoupled WhatsApp Adapter:** WhatsApp acts strictly as an I/O communication channel, maintaining conversation states without polluting core domain logic.

---

## 📂 Project Structure

```
sall/
├── apps/
│   └── web/                     # Web Application (Dashboard + Public Booking)
├── backend/                     # NestJS Core Server & Booking Engine
│   ├── src/
│   │   ├── common/              # Guards, interceptors, filters, pipes
│   │   ├── modules/             # Auth, Salons, Staff, Services, Availability,
│   │   │                        # Appointments, Customers, WhatsApp, Reports
│   │   └── main.ts
│   └── prisma/
│       └── schema.prisma        # Database schema
├── docs/                        # Complete architecture documentation
├── infrastructure/              # Docker Compose & local database
├── README.md
└── .gitignore
```

---

## ⚡ Quick Start (Local Development)

### 1. Start Database & Infrastructure
```bash
cd infrastructure
docker-compose up -d
```

### 2. Configure Backend Environment
```bash
cd ../backend
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run start:dev
```

### 3. Run Web Client
```bash
cd ../apps/web
# Launch web application
```
