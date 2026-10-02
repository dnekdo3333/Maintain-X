/**
 * Seeds the end-to-end test database (must end in "_test"):
 * one restaurant, a Super Admin, an admin and a worker, all with TEST_PASSWORD.
 *
 *   DATABASE_URL=…/maintainx_e2e_test npx tsx src/test/e2e-seed.ts
 */
import { prisma } from '../core/prisma.js'
import { ensureDefaultCategories } from '../modules/assets/categories.service.js'
import { createFixture, resetDatabase } from './db.js'

async function main() {
  await resetDatabase()
  const fx = await createFixture({ restaurants: 1 })
  await ensureDefaultCategories(prisma, fx.orgId)
  await prisma.restaurant.update({
    where: { id: fx.restaurantIds[0] },
    data: { name: 'Bookends Café' },
  })
  await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss', email: 'boss@e2e.test' })
  const admin = await fx.createUser({
    role: 'ADMIN',
    username: 'admin',
    restaurants: fx.restaurantIds,
  })
  const worker = await fx.createUser({
    role: 'WORKER',
    username: 'ravi',
    restaurants: fx.restaurantIds,
  })
  await prisma.user.update({
    where: { id: admin.id },
    data: { firstName: 'Priya', lastName: 'Shah' },
  })
  await prisma.user.update({
    where: { id: worker.id },
    data: { firstName: 'Ravi', lastName: 'Kumar' },
  })
  console.log('e2e database seeded')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
