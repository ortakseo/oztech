// OzTech sohbet asistanı — Vercel serverless fonksiyonu (POST /api/chat).
// API anahtarı yalnızca sunucuda, ANTHROPIC_API_KEY ortam değişkeninde durur;
// tarayıcıya asla gönderilmez.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const MAX_MESSAGES = 20; // geçmişten en fazla bu kadar mesaj
const MAX_CHARS = 2000; // mesaj başına karakter sınırı

const SYSTEM = `Sen OzTech'in (Öz Teknoloji) web sitesindeki sohbet asistanısın.
OzTech; Yemeksepeti, Trendyol Yemek ve Migros Yemek'te satış yapan restoran markalarına
platform yönetimi (menü, fiyat, kampanya, reklam takibi), web tasarım ve WhatsApp üzerinden
yapay zekâ destekli müşteri iletişimi hizmeti verir. Marka sahibi Özgür Can Özcan'dır.
Adres: Fatih Mah., Atatürk Blv. No: 141/D, 35700 Bergama / İzmir.
E-posta: ozgurcanozcanbusiness@gmail.com

Ziyaretçilerin sorularını kısa, samimi ve net yanıtla; ziyaretçi hangi dilde yazarsa o dilde cevap ver.
Fiyat, süre veya garanti gibi bilmediğin bilgileri uydurma; bunlar için e-posta ile iletişime
geçmelerini öner. OzTech ve restoran dijital operasyonları dışındaki konularda kibarca
konuyu hizmetlere yönlendir.`;

function cleanMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const msgs = raw
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim() !== "",
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  // Konuşma kullanıcı mesajıyla başlayıp bitmeli.
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null;
  return msgs;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Yalnızca POST desteklenir." });
  }

  const messages = cleanMessages(req.body?.messages);
  if (!messages) {
    return res.status(400).json({ error: "Geçersiz mesaj." });
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  try {
    const stream = client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 2048,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        res.write(event.delta.text);
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      res.write("\n\nBu isteğe yanıt veremiyorum. Başka bir konuda yardımcı olabilirim.");
    }
    res.end();
  } catch (err) {
    console.error("chat error:", err);
    const msg =
      err instanceof Anthropic.RateLimitError
        ? "Şu anda çok yoğunuz, lütfen birazdan tekrar deneyin."
        : "Bir hata oluştu, lütfen daha sonra tekrar deneyin.";
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    } else {
      res.write(`\n\n${msg}`);
      res.end();
    }
  }
}
