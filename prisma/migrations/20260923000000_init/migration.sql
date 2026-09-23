-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "FactSource" AS ENUM ('USER_FACT', 'OFFICIAL_SOURCE', 'AI_SUGGESTION');

-- CreateEnum
CREATE TYPE "CaseCategory" AS ENUM ('PRODUTO_NAO_RECEBIDO', 'REEMBOLSO_NAO_RECEBIDO', 'COBRANCA_INDEVIDA', 'CANCELAMENTO_NAO_REALIZADO', 'PRODUTO_COM_DEFEITO', 'SERVICO_NAO_PRESTADO', 'OUTRO');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('NOVO', 'EM_ANALISE', 'AGUARDANDO_USUARIO', 'AGUARDANDO_EMPRESA', 'RESPOSTA_RECEBIDA', 'PRECISA_DE_ACAO', 'ESCALADO', 'RESOLVIDO', 'ENCERRADO');

-- CreateEnum
CREATE TYPE "EscalationLevel" AS ENUM ('NENHUM', 'EMPRESA', 'SAC', 'OUVIDORIA', 'CONSUMIDOR_GOV', 'ORGAO_COMPETENTE');

-- CreateEnum
CREATE TYPE "CasePriority" AS ENUM ('BAIXA', 'NORMAL', 'ALTA');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'DINHEIRO', 'OUTRO', 'DESCONHECIDO');

-- CreateEnum
CREATE TYPE "PixSituation" AS ENUM ('GOLPE_FRAUDE', 'PIX_NAO_RECONHECIDO', 'PRODUTO_NAO_RECEBIDO', 'DESTINATARIO_ERRADO', 'PROBLEMA_BANCARIO', 'DISPUTA_COMERCIAL');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXTO', 'CLASSIFICACAO', 'PERGUNTAS', 'PLANO_DE_ACAO', 'RASCUNHO', 'ANALISE_DE_RESPOSTA', 'RESUMO', 'AVISO');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('NOTA_FISCAL', 'COMPROVANTE_PIX', 'PEDIDO', 'CONTRATO', 'CAPTURA_DE_TELA', 'EMAIL', 'CONVERSA', 'RESPOSTA_DA_EMPRESA', 'OUTRO');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDA', 'FALHOU', 'NAO_APLICAVEL');

-- CreateEnum
CREATE TYPE "FactStatus" AS ENUM ('UNCONFIRMED', 'CONFIRMED', 'USER_CORRECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DeletionStatus" AS ENUM ('PENDENTE', 'CANCELADO', 'EXECUTADO');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('TERMS', 'PRIVACY', 'MARKETING', 'RESEARCH');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('CADASTRO', 'MINHA_CONTA', 'CHECKOUT_CASO', 'IMPORTACAO', 'SUPORTE');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'WHATSAPP', 'EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationPurpose" AS ENUM ('SERVICO', 'MARKETING');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDENTE', 'ENVIADA', 'FALHOU', 'CANCELADA');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('AGENDADO', 'ENVIADO', 'CANCELADO', 'CONCLUIDO');

-- CreateEnum
CREATE TYPE "FeedbackRating" AS ENUM ('SIM', 'NAO');

-- CreateEnum
CREATE TYPE "FeedbackReason" AS ENUM ('INFORMACAO_INCORRETA', 'NAO_ENTENDI', 'NAO_RESOLVEU', 'FONTE_NAO_AJUDOU', 'OUTRO');

-- CreateEnum
CREATE TYPE "Industry" AS ENUM ('ECOMMERCE', 'TELECOM', 'BANKING', 'FINTECH', 'INSURANCE', 'TRAVEL', 'UTILITIES', 'RETAIL', 'SERVICES', 'OTHER');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('VIEWER', 'SUPPORT', 'ANALYST', 'ADMIN', 'OWNER');

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'MOCK');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "marketing_consent_at" TIMESTAMP(3),
    "marketing_consent_source" "ConsentSource",
    "marketing_unsubscribed_at" TIMESTAMP(3),
    "case_notifications" BOOLEAN NOT NULL DEFAULT true,
    "marketing_notifications" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_prefix" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "invalidated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip_prefix" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "user_id" UUID,
    "category" "CaseCategory",
    "subcategory" TEXT,
    "company_name" TEXT,
    "company_normalized" TEXT,
    "company_id" UUID,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "payment_method" "PaymentMethod" NOT NULL DEFAULT 'DESCONHECIDO',
    "pix_situation" "PixSituation",
    "purchase_date" TIMESTAMP(3),
    "promised_date" TIMESTAMP(3),
    "actual_resolution_date" TIMESTAMP(3),
    "status" "CaseStatus" NOT NULL DEFAULT 'NOVO',
    "current_step" TEXT,
    "escalation_level" "EscalationLevel" NOT NULL DEFAULT 'NENHUM',
    "priority" "CasePriority" NOT NULL DEFAULT 'NORMAL',
    "state" VARCHAR(2),
    "city_bucket" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_events" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "event_date" TIMESTAMP(3) NOT NULL,
    "source" "FactSource" NOT NULL DEFAULT 'USER_FACT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_facts" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "document_id" UUID,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" "FactSource" NOT NULL,
    "status" "FactStatus" NOT NULL DEFAULT 'UNCONFIRMED',
    "confidence" DOUBLE PRECISION,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "user_id" UUID,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL DEFAULT 'OUTRO',
    "extraction_status" "ExtractionStatus" NOT NULL DEFAULT 'PENDENTE',
    "extraction_error" TEXT,
    "checksum_sha256" TEXT,
    "scan_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "user_id" UUID,
    "direction" "MessageDirection" NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXTO',
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "ai_request_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "case_id" UUID,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'AGENDADO',
    "sent_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "official_sources" (
    "id" UUID NOT NULL,
    "organization" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" TEXT,
    "content" TEXT,
    "last_verified_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "official_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_sources" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "claim" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "industry" "Industry" NOT NULL DEFAULT 'OTHER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_aliases" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "version" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "ConsentSource" NOT NULL,
    "ip_prefix" TEXT,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "DeletionStatus" NOT NULL DEFAULT 'PENDENTE',
    "reason" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "execute_after" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "ip_prefix" TEXT,

    CONSTRAINT "deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "case_id" UUID,
    "message_id" UUID,
    "rating" "FeedbackRating" NOT NULL,
    "reason" "FeedbackReason",
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "purpose" "NotificationPurpose" NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDENTE',
    "sent_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_requests" (
    "id" UUID NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "prompt_version" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "estimated_cost" DECIMAL(12,6),
    "latency_ms" INTEGER,
    "success" BOOLEAN NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_prefix" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_login_attempts" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "ip_prefix" TEXT,
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB,
    "ip_prefix" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_cases" (
    "id" UUID NOT NULL,
    "case_key" TEXT NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "state" VARCHAR(2),
    "city_bucket" TEXT,
    "category" "CaseCategory" NOT NULL,
    "subcategory" TEXT,
    "industry" "Industry" NOT NULL DEFAULT 'OTHER',
    "company_normalized" TEXT,
    "amount_bucket" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "resolution_status" "CaseStatus" NOT NULL,
    "resolution_days" INTEGER,
    "escalation_level" "EscalationLevel" NOT NULL,
    "source" "FactSource" NOT NULL DEFAULT 'AI_SUGGESTION',
    "confidence" DOUBLE PRECISION,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject_key" TEXT,
    "properties" JSONB,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_created_at_idx" ON "otp_challenges"("phone", "created_at");

-- CreateIndex
CREATE INDEX "otp_challenges_expires_at_idx" ON "otp_challenges"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "cases_public_id_key" ON "cases"("public_id");

-- CreateIndex
CREATE INDEX "cases_user_id_created_at_idx" ON "cases"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "cases_status_idx" ON "cases"("status");

-- CreateIndex
CREATE INDEX "cases_category_idx" ON "cases"("category");

-- CreateIndex
CREATE INDEX "cases_company_normalized_idx" ON "cases"("company_normalized");

-- CreateIndex
CREATE INDEX "case_events_case_id_event_date_idx" ON "case_events"("case_id", "event_date");

-- CreateIndex
CREATE INDEX "case_facts_case_id_field_idx" ON "case_facts"("case_id", "field");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE INDEX "documents_case_id_idx" ON "documents"("case_id");

-- CreateIndex
CREATE INDEX "documents_extraction_status_idx" ON "documents"("extraction_status");

-- CreateIndex
CREATE INDEX "messages_case_id_created_at_idx" ON "messages"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "reminders_scheduled_at_status_idx" ON "reminders"("scheduled_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "official_sources_url_key" ON "official_sources"("url");

-- CreateIndex
CREATE INDEX "official_sources_organization_idx" ON "official_sources"("organization");

-- CreateIndex
CREATE INDEX "official_sources_active_idx" ON "official_sources"("active");

-- CreateIndex
CREATE UNIQUE INDEX "case_sources_case_id_source_id_claim_key" ON "case_sources"("case_id", "source_id", "claim");

-- CreateIndex
CREATE UNIQUE INDEX "companies_canonical_name_key" ON "companies"("canonical_name");

-- CreateIndex
CREATE UNIQUE INDEX "companies_normalized_key" ON "companies"("normalized");

-- CreateIndex
CREATE INDEX "company_aliases_company_id_idx" ON "company_aliases"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_aliases_normalized_key" ON "company_aliases"("normalized");

-- CreateIndex
CREATE INDEX "consents_user_id_type_idx" ON "consents"("user_id", "type");

-- CreateIndex
CREATE INDEX "deletion_requests_status_execute_after_idx" ON "deletion_requests"("status", "execute_after");

-- CreateIndex
CREATE INDEX "deletion_requests_user_id_idx" ON "deletion_requests"("user_id");

-- CreateIndex
CREATE INDEX "feedback_created_at_idx" ON "feedback"("created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");

-- CreateIndex
CREATE INDEX "ai_requests_created_at_idx" ON "ai_requests"("created_at");

-- CreateIndex
CREATE INDEX "ai_requests_provider_model_idx" ON "ai_requests"("provider", "model");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_user_id_idx" ON "admin_sessions"("admin_user_id");

-- CreateIndex
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "admin_login_attempts_email_created_at_idx" ON "admin_login_attempts"("email", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_cases_case_key_key" ON "analytics_cases"("case_key");

-- CreateIndex
CREATE INDEX "analytics_cases_month_category_idx" ON "analytics_cases"("month", "category");

-- CreateIndex
CREATE INDEX "analytics_cases_company_normalized_idx" ON "analytics_cases"("company_normalized");

-- CreateIndex
CREATE INDEX "analytics_cases_industry_idx" ON "analytics_cases"("industry");

-- CreateIndex
CREATE INDEX "analytics_events_name_created_at_idx" ON "analytics_events"("name", "created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_facts" ADD CONSTRAINT "case_facts_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_facts" ADD CONSTRAINT "case_facts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_ai_request_id_fkey" FOREIGN KEY ("ai_request_id") REFERENCES "ai_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_sources" ADD CONSTRAINT "case_sources_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_sources" ADD CONSTRAINT "case_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "official_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

