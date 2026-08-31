const express = require('express');
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /subscriptions/sync?since=<epoch millis>
// Возвращает все изменения (включая удалённые — isDeleted) после указанного момента.
// Клиент передаёт 0 при первой синхронизации, чтобы получить весь список.
router.get('/sync', async (req, res) => {
  const since = BigInt(req.query.since || '0');
  const sinceDate = new Date(Number(since));

  const items = await prisma.subscription.findMany({
    where: { userId: req.userId, updatedAt: { gt: sinceDate } },
    orderBy: { updatedAt: 'asc' }
  });

  res.json({
    serverTime: Date.now(),
    items: items.map(serialize)
  });
});

// POST /subscriptions/sync
// body: { items: [{ localId, remoteId?, name, price, currency, billingCycle,
//                    nextPaymentDate, category, notifyDaysBefore, isDeleted, updatedAt }] }
// remoteId отсутствует -> создаём новую запись и возвращаем маппинг localId->remoteId.
// remoteId есть -> апсертим по нему (last-write-wins по updatedAt клиента).
router.post('/sync', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items_must_be_array' });
  }

  const idMapping = {}; // localId -> remoteId, для новых записей

  for (const item of items) {
    if (item.remoteId) {
      const existing = await prisma.subscription.findUnique({ where: { id: item.remoteId } });
      if (!existing || existing.userId !== req.userId) continue; // защита от подмены чужого id

      // last-write-wins: применяем только если клиентское изменение новее серверного
      if (new Date(item.updatedAt) >= existing.updatedAt) {
        await prisma.subscription.update({
          where: { id: item.remoteId },
          data: toWriteData(item)
        });
      }
    } else {
      const created = await prisma.subscription.create({
        data: { ...toWriteData(item), userId: req.userId }
      });
      idMapping[item.localId] = created.id;
    }
  }

  res.json({ idMapping, serverTime: Date.now() });
});

function toWriteData(item) {
  return {
    name: item.name,
    price: item.price,
    currency: item.currency || 'RUB',
    billingCycle: item.billingCycle,
    customIntervalDays: item.customIntervalDays ?? null,
    nextPaymentDate: BigInt(item.nextPaymentDate),
    category: item.category,
    notifyDaysBefore: item.notifyDaysBefore ?? 3,
    isArchived: !!item.isArchived,
    promoCode: item.promoCode ?? null,
    isDeleted: !!item.isDeleted
  };
}

function serialize(row) {
  return {
    remoteId: row.id,
    name: row.name,
    price: row.price,
    currency: row.currency,
    billingCycle: row.billingCycle,
    customIntervalDays: row.customIntervalDays,
    nextPaymentDate: row.nextPaymentDate.toString(),
    category: row.category,
    notifyDaysBefore: row.notifyDaysBefore,
    isArchived: row.isArchived,
    promoCode: row.promoCode,
    isDeleted: row.isDeleted,
    updatedAt: row.updatedAt.getTime()
  };
}

module.exports = router;
