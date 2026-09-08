-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'SALON_OWNER');

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SalonStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "StylistStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "SalonUserStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('WHATSAPP', 'WEB', 'CUSTOMER_APP', 'PHONE', 'WALK_IN', 'MANUAL');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'SENT', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ConversationState" AS ENUM ('START', 'ACTIVE_HUB', 'SELECT_ADDON', 'SELECT_RESCHEDULE_DATE', 'SELECT_RESCHEDULE_TIME', 'CONFIRM_CANCEL', 'SELECT_APPOINTMENT', 'SELECT_SERVICE', 'SELECT_STAFF', 'SELECT_DATE', 'SELECT_TIME', 'COLLECT_NAME', 'CONFIRMATION', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ClientEtaStatus" AS ENUM ('ON_TIME', 'RUNNING_LATE_10M', 'RUNNING_LATE_20M', 'CANCEL_REQUESTED', 'ARRIVED');

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "salon_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'SALON_OWNER',
    "status" "AdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salons" (
    "id" TEXT NOT NULL,
    "created_by_admin_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "description" TEXT,
    "status" "SalonStatus" NOT NULL DEFAULT 'ACTIVE',
    "default_start_time" TEXT NOT NULL DEFAULT '09:00',
    "default_end_time" TEXT NOT NULL DEFAULT '21:00',
    "max_advance_days" INTEGER NOT NULL DEFAULT 30,
    "cancel_window_hours" INTEGER NOT NULL DEFAULT 2,
    "allow_specific_stylist" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "salon_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "status" "ServiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stylists" (
    "id" TEXT NOT NULL,
    "salon_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "profile_image_url" TEXT,
    "status" "StylistStatus" NOT NULL DEFAULT 'ACTIVE',
    "follows_salon_schedule" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stylists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stylist_services" (
    "salon_id" TEXT NOT NULL,
    "stylist_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stylist_services_pkey" PRIMARY KEY ("salon_id","stylist_id","service_id")
);

-- CreateTable
CREATE TABLE "salon_working_hours" (
    "id" TEXT NOT NULL,
    "salon_id" TEXT NOT NULL,
    "day_of_week" "DayOfWeek" NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "break_start_time" TEXT,
    "break_end_time" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salon_working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stylist_working_hours" (
    "id" TEXT NOT NULL,
    "stylist_id" TEXT NOT NULL,
    "day_of_week" "DayOfWeek" NOT NULL,
    "is_working" BOOLEAN NOT NULL DEFAULT true,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "break_start_time" TEXT,
    "break_end_time" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stylist_working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salon_users" (
    "id" TEXT NOT NULL,
    "salon_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "SalonUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salon_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "appointment_number" TEXT NOT NULL,
    "salon_id" TEXT NOT NULL,
    "salon_user_id" TEXT NOT NULL,
    "stylist_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "service_name_snapshot" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "appointment_date" DATE NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "source" "BookingSource" NOT NULL DEFAULT 'WHATSAPP',
    "expires_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_by_admin_id" TEXT,
    "reminder_2h_sent_at" TIMESTAMPTZ,
    "reminder_10m_sent_at" TIMESTAMPTZ,
    "late_follow_up_sent_at" TIMESTAMPTZ,
    "client_eta_status" "ClientEtaStatus",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_services" (
    "id" TEXT NOT NULL,
    "salon_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "service_name_snapshot" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "salon_id" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "state" "ConversationState" NOT NULL DEFAULT 'START',
    "selected_service_id" TEXT,
    "selected_staff_id" TEXT,
    "selected_date" DATE,
    "selected_start_time" TIMESTAMPTZ,
    "customer_name" TEXT,
    "active_appointment_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_accounts" (
    "id" TEXT NOT NULL,
    "salon_id" TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "waba_id" TEXT,
    "access_token_encrypted" TEXT NOT NULL,
    "webhook_verify_token" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_logs" (
    "id" TEXT NOT NULL,
    "salon_id" TEXT,
    "phone" TEXT NOT NULL,
    "direction" "WhatsAppMessageDirection" NOT NULL DEFAULT 'INBOUND',
    "message_text" TEXT,
    "interactive_id" TEXT,
    "conversation_state" TEXT,
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "meta_message_id" TEXT,
    "error_code" INTEGER,
    "error_message" TEXT,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "salon_id" TEXT NOT NULL,
    "appointment_id" TEXT,
    "user_id" TEXT,
    "recipient_phone" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'WHATSAPP',
    "template_name" TEXT,
    "message_body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "provider_message_id" TEXT,
    "error_details" TEXT,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "salon_id" TEXT,
    "admin_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_email_idx" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_salon_id_idx" ON "admins"("salon_id");

-- CreateIndex
CREATE UNIQUE INDEX "salons_slug_key" ON "salons"("slug");

-- CreateIndex
CREATE INDEX "salons_created_by_admin_id_idx" ON "salons"("created_by_admin_id");

-- CreateIndex
CREATE INDEX "salons_slug_idx" ON "salons"("slug");

-- CreateIndex
CREATE INDEX "salons_status_idx" ON "salons"("status");

-- CreateIndex
CREATE INDEX "services_salon_id_status_idx" ON "services"("salon_id", "status");

-- CreateIndex
CREATE INDEX "services_salon_id_name_idx" ON "services"("salon_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "services_salon_id_id_key" ON "services"("salon_id", "id");

-- CreateIndex
CREATE INDEX "stylists_salon_id_status_idx" ON "stylists"("salon_id", "status");

-- CreateIndex
CREATE INDEX "stylists_salon_id_name_idx" ON "stylists"("salon_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "stylists_salon_id_id_key" ON "stylists"("salon_id", "id");

-- CreateIndex
CREATE INDEX "stylist_services_salon_id_service_id_idx" ON "stylist_services"("salon_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "salon_working_hours_salon_id_day_of_week_key" ON "salon_working_hours"("salon_id", "day_of_week");

-- CreateIndex
CREATE UNIQUE INDEX "stylist_working_hours_stylist_id_day_of_week_key" ON "stylist_working_hours"("stylist_id", "day_of_week");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE INDEX "salon_users_salon_id_idx" ON "salon_users"("salon_id");

-- CreateIndex
CREATE INDEX "salon_users_user_id_idx" ON "salon_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "salon_users_salon_id_id_key" ON "salon_users"("salon_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "salon_users_salon_id_user_id_key" ON "salon_users"("salon_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_appointment_number_key" ON "appointments"("appointment_number");

-- CreateIndex
CREATE INDEX "appointments_salon_id_appointment_date_idx" ON "appointments"("salon_id", "appointment_date");

-- CreateIndex
CREATE INDEX "appointments_salon_id_stylist_id_appointment_date_idx" ON "appointments"("salon_id", "stylist_id", "appointment_date");

-- CreateIndex
CREATE INDEX "appointments_stylist_id_start_at_end_at_idx" ON "appointments"("stylist_id", "start_at", "end_at");

-- CreateIndex
CREATE INDEX "appointments_salon_id_salon_user_id_appointment_date_idx" ON "appointments"("salon_id", "salon_user_id", "appointment_date");

-- CreateIndex
CREATE INDEX "appointments_salon_id_status_idx" ON "appointments"("salon_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_salon_id_id_key" ON "appointments"("salon_id", "id");

-- CreateIndex
CREATE INDEX "appointment_services_salon_id_appointment_id_idx" ON "appointment_services"("salon_id", "appointment_id");

-- CreateIndex
CREATE INDEX "appointment_services_salon_id_service_id_idx" ON "appointment_services"("salon_id", "service_id");

-- CreateIndex
CREATE INDEX "conversations_customer_phone_idx" ON "conversations"("customer_phone");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_salon_id_customer_phone_key" ON "conversations"("salon_id", "customer_phone");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_salon_id_key" ON "whatsapp_accounts"("salon_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_phone_number_id_key" ON "whatsapp_accounts"("phone_number_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_logs_meta_message_id_key" ON "whatsapp_logs"("meta_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_logs_phone_idx" ON "whatsapp_logs"("phone");

-- CreateIndex
CREATE INDEX "whatsapp_logs_salon_id_created_at_idx" ON "whatsapp_logs"("salon_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_logs_salon_id_status_idx" ON "whatsapp_logs"("salon_id", "status");

-- CreateIndex
CREATE INDEX "notifications_salon_id_status_idx" ON "notifications"("salon_id", "status");

-- CreateIndex
CREATE INDEX "notifications_appointment_id_idx" ON "notifications"("appointment_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_salon_id_created_at_idx" ON "audit_logs"("salon_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_admin_id_idx" ON "audit_logs"("admin_id");

-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salons" ADD CONSTRAINT "salons_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stylists" ADD CONSTRAINT "stylists_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stylist_services" ADD CONSTRAINT "stylist_services_salon_id_stylist_id_fkey" FOREIGN KEY ("salon_id", "stylist_id") REFERENCES "stylists"("salon_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stylist_services" ADD CONSTRAINT "stylist_services_salon_id_service_id_fkey" FOREIGN KEY ("salon_id", "service_id") REFERENCES "services"("salon_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salon_working_hours" ADD CONSTRAINT "salon_working_hours_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stylist_working_hours" ADD CONSTRAINT "stylist_working_hours_stylist_id_fkey" FOREIGN KEY ("stylist_id") REFERENCES "stylists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salon_users" ADD CONSTRAINT "salon_users_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salon_users" ADD CONSTRAINT "salon_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_salon_id_salon_user_id_fkey" FOREIGN KEY ("salon_id", "salon_user_id") REFERENCES "salon_users"("salon_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_salon_id_stylist_id_fkey" FOREIGN KEY ("salon_id", "stylist_id") REFERENCES "stylists"("salon_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_salon_id_service_id_fkey" FOREIGN KEY ("salon_id", "service_id") REFERENCES "services"("salon_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_salon_id_appointment_id_fkey" FOREIGN KEY ("salon_id", "appointment_id") REFERENCES "appointments"("salon_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_salon_id_service_id_fkey" FOREIGN KEY ("salon_id", "service_id") REFERENCES "services"("salon_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_logs" ADD CONSTRAINT "whatsapp_logs_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
