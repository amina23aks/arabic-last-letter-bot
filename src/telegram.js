class TelegramError extends Error {
  constructor(method, details) {
    super(`Telegram ${method} failed`);
    this.details = details;
  }
}

export function telegramErrorDetails(error) {
  return error instanceof TelegramError
    ? { message: error.message, ...error.details }
    : { reason: "unexpected error" };
}

export async function telegram(token, method, payload) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new TelegramError(method, { reason: "request failed" });
  }

  const data = await response.json().catch(() => null);
  if (response.ok && data?.ok === true) return data.result;
  throw new TelegramError(method, {
    status: response.status,
    ...(Number.isInteger(data?.error_code) ? { telegramCode: data.error_code } : {}),
  });
}
