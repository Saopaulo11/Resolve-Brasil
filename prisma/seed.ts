/**
 * Демо-данные для разработки (§82).
 *
 * Здесь нет и не должно быть выдуманных клиентов, компаний, жалоб,
 * статистики, отзывов и успешных исходов. Ровно три записи, каждая явно
 * помечена как демонстрационная, чтобы её нельзя было принять за настоящую
 * и чтобы она не попала в продуктовую аналитику.
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { DEMO_PHONE } from "../src/analytics/pipeline";
import { PrismaClient } from "../src/generated/prisma/client";
import { generatePublicCaseId } from "../src/utils/ids";
const DEMO_COMPANY = "DEMO — Empresa de Teste";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL не задан — seed выполнить невозможно.");
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    if (process.env.NODE_ENV === "production") {
      // Демо-данные в production смешались бы с настоящими делами, и
      // отличить их потом было бы нечем.
      throw new Error("Seed запрещён в production.");
    }

    const user = await prisma.user.upsert({
      where: { phone: DEMO_PHONE },
      update: {},
      create: {
        phone: DEMO_PHONE,
        phoneVerified: true,
        displayName: "DEMO — Usuário de Teste",
        // Маркетинг выключен: согласия демо-пользователь не давал (§17).
        marketingConsent: false,
      },
    });

    const company = await prisma.company.upsert({
      where: { normalized: "demo-empresa-de-teste" },
      update: {},
      create: {
        canonicalName: DEMO_COMPANY,
        normalized: "demo-empresa-de-teste",
        industry: "ECOMMERCE",
      },
    });

    const existing = await prisma.case.findFirst({
      where: { userId: user.id },
      select: { id: true },
    });

    if (!existing) {
      await prisma.case.create({
        data: {
          publicId: generatePublicCaseId(),
          userId: user.id,
          companyId: company.id,
          category: "PRODUTO_NAO_RECEBIDO",
          companyName: DEMO_COMPANY,
          companyNormalized: company.normalized,
          description:
            "DEMO — caso de demonstração para desenvolvimento. " +
            "Não representa uma reclamação real.",
          currency: "BRL",
          paymentMethod: "PIX",
          status: "NOVO",
        },
      });
    }

    console.log("Seed concluído: 1 usuário, 1 empresa e 1 caso de demonstração.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
