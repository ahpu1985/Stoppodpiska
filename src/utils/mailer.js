const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'onboarding@resend.dev'; // дефолтный тестовый домен Resend, работает без верификации своего домена

const isConfigured = Boolean(RESEND_API_KEY);

async function sendOtpEmail(email, code) {
  if (!isConfigured) {
    // Без RESEND_API_KEY — просто логируем, чтобы можно было тестировать
    // локально без реального сервиса. ОБЯЗАТЕЛЬНО настроить перед реальным
    // запуском — иначе пользователи не получат код.
    console.log(`[DEV MODE — RESEND_API_KEY не задан] OTP для ${email}: ${code}`);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: email,
      subject: 'Код подтверждения — Мои подписки',
      text: `Ваш код подтверждения: ${code}\n\nКод действителен 10 минут. Если вы не запрашивали код — просто проигнорируйте это письмо.`,
      html: `<p>Ваш код подтверждения: <strong>${code}</strong></p><p>Код действителен 10 минут. Если вы не запрашивали код — просто проигнорируйте это письмо.</p>`
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend API error (${response.status}): ${errorBody}`);
  }
}

module.exports = { sendOtpEmail, isConfigured };
