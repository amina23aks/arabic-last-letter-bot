export async function telegram(token, method, payload) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.ok === true) return data.result;
    }
  } catch {
    // Fetch errors and Telegram responses can contain the token-bearing URL.
  }
  throw new Error(`Telegram ${method} failed`);
}
