function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 цифр, "000000"-"999999" исключены на краях естественно
}

module.exports = { generateOtpCode };
