const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const prisma = require('../db');
const { generateOtpCode } = require('../utils/otp');
const { sendOtpEmail } = require('../utils/mailer');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET не задан в переменных окружения — обязателен для запуска');
}

const OTP_TTL_MINUTES = 10;

// Отдельный узкий лимит именно на запрос кода — защита от спама чужих
// почтовых ящиков и перебора (без него /request-otp можно дёргать бесконечно)
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.body?.email || req.ip,
  message: { error: 'too_many_requests' }
});

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// СТАРЫЙ анонимный вход по device_id — оставлен для обратной совместимости
// с уже установленными приложениями до перехода на email/OTP.
router.post('/register', async (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 8) {
    return res.status(400).json({ error: 'invalid_device_id' });
  }

  const user = await prisma.user.upsert({
    where: { deviceId },
    update: {},
    create: { deviceId }
  });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '365d' });
  res.json({ userId: user.id, token });
});

// Шаг 1: запросить код на email
router.post('/request-otp', otpRequestLimiter, async (req, res) => {
  const { email } = req.body;
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await prisma.otpCode.create({
    data: { email: normalizedEmail, code, expiresAt }
  });

  await sendOtpEmail(normalizedEmail, code);

  res.json({ sent: true, expiresInMinutes: OTP_TTL_MINUTES });
});

// Шаг 2: подтвердить код, получить токен.
// Если передан deviceId и на нём уже есть анонимный аккаунт без email —
// "апгрейдим" его до email-аккаунта, чтобы не потерять уже накопленные
// и синхронизированные подписки на этом устройстве.
router.post('/verify-otp', async (req, res) => {
  const { email, code, deviceId } = req.body;
  if (!isValidEmail(email) || !code) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const otp = await prisma.otpCode.findFirst({
    where: { email: normalizedEmail, code: String(code), used: false },
    orderBy: { createdAt: 'desc' }
  });

  if (!otp) {
    return res.status(401).json({ error: 'invalid_code' });
  }
  if (otp.expiresAt < new Date()) {
    return res.status(401).json({ error: 'code_expired' });
  }

  await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } });

  let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user) {
    const anonymousUser = deviceId
      ? await prisma.user.findUnique({ where: { deviceId } })
      : null;

    if (anonymousUser && !anonymousUser.email) {
      // апгрейдим существующий анонимный аккаунт этого устройства
      user = await prisma.user.update({
        where: { id: anonymousUser.id },
        data: { email: normalizedEmail }
      });
    } else {
      user = await prisma.user.create({ data: { email: normalizedEmail } });
    }
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '365d' });
  res.json({ userId: user.id, token, email: user.email });
});

module.exports = router;
