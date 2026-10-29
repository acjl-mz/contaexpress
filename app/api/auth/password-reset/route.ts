import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
const GENERIC_MESSAGE = "Se existir uma conta associada a este e-mail, receberá instruções para recuperar a palavra-passe.";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.length > 254) {
      return NextResponse.json({ error: "Introduza um endereço de e-mail válido." }, { status: 400 });
    }

    const userResult = await db.query(
      "SELECT id, email FROM app_users WHERE lower(email) = $1 AND status = 'active' LIMIT 1",
      [email],
    );
    const user = userResult.rows[0];
    if (user) {
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await db.query(
        "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
        [user.id],
      );
      await db.query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 minutes')",
        [user.id, tokenHash],
      );

      const apiKey = process.env.RESEND_API_KEY;
      const from = process.env.RESEND_FROM_EMAIL;
      const baseUrl = process.env.APP_BASE_URL;
      if (apiKey && from && baseUrl) {
        const link = new URL("/recuperar-palavra-passe", baseUrl);
        link.searchParams.set("token", token);
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            from,
            to: [user.email],
            subject: "Recuperação da palavra-passe — ContaExpress",
            text: `Recebemos um pedido para redefinir a palavra-passe da sua conta ContaExpress. Abra este link nos próximos 30 minutos: ${link.toString()}\n\nSe não pediu esta alteração, ignore esta mensagem.`,
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          console.error("Falha no envio de e-mail de recuperação:", response.status);
          return NextResponse.json({ message: GENERIC_MESSAGE });
        }
      } else {
        console.error("Recuperação de palavra-passe não enviou e-mail: configure RESEND_API_KEY, RESEND_FROM_EMAIL e APP_BASE_URL.");
      }
    }

    return NextResponse.json({ message: GENERIC_MESSAGE });
  } catch (error) {
    console.error("Falha no pedido de recuperação de palavra-passe:", error);
    return NextResponse.json({ error: "Não foi possível processar o pedido. Tente novamente mais tarde." }, { status: 500 });
  }
}
