const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Hash passwords
  const hashedPassword = await bcrypt.hash('Demo@1234', 10);

  // 1. Create Tenant A (Acme Corp)
  const tenantA = await prisma.tenant.upsert({
    where: { id: 'tenant-a-id-12345678' },
    update: {},
    create: {
      id: 'tenant-a-id-12345678',
      name: 'Acme Corp',
      description: 'Acme Corp Global Manufacturing and Logistics',
      type: 'Manufacturing',
    },
  });
  console.log(`🏢 Created/Upserted Tenant: ${tenantA.name}`);

  // 2. Create Tenant B (Wayne Enterprises)
  const tenantB = await prisma.tenant.upsert({
    where: { id: 'tenant-b-id-12345678' },
    update: {},
    create: {
      id: 'tenant-b-id-12345678',
      name: 'Wayne Enterprises',
      description: 'Wayne Enterprises Defense Technology and R&D',
      type: 'Technology',
    },
  });
  console.log(`🏢 Created/Upserted Tenant: ${tenantB.name}`);

  // 3. Create Admin for Tenant A
  const adminA = await prisma.user.upsert({
    where: { email: 'admin@tenant-a.com' },
    update: {},
    create: {
      email: 'admin@tenant-a.com',
      name: 'Acme Admin',
      password: hashedPassword,
      role: 'ADMIN',
      tenantId: tenantA.id,
      isActive: true,
    },
  });
  console.log(`👤 Created Admin: ${adminA.email}`);

  // 4. Create Agent for Tenant A
  const agentA = await prisma.user.upsert({
    where: { email: 'agent@tenant-a.com' },
    update: {},
    create: {
      email: 'agent@tenant-a.com',
      name: 'Acme Agent',
      password: hashedPassword,
      role: 'AGENT',
      tenantId: tenantA.id,
      isActive: true,
    },
  });
  console.log(`👤 Created Agent: ${agentA.email}`);

  // 5. Create Admin for Tenant B
  const adminB = await prisma.user.upsert({
    where: { email: 'admin@tenant-b.com' },
    update: {},
    create: {
      email: 'admin@tenant-b.com',
      name: 'Wayne Admin',
      password: hashedPassword,
      role: 'ADMIN',
      tenantId: tenantB.id,
      isActive: true,
    },
  });
  console.log(`👤 Created Admin: ${adminB.email}`);

  console.log('✅ Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('🔴 Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
