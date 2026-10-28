import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password || email.length > 254 || password.length > 200) {
      return NextResponse.json({ error: "Introduza o e-mail e a palavra-passe." }, { status: 400 });
    }

    const result = await db.query(
      `SELECT u.id, u.email, u.full_name, u.password_hash, om.organisation_id, om.role
       FROM app_users u
       JOIN organisation_memberships om ON om.user_id = u.id
       JOIN organisations o ON o.id = om.organisation_id AND o.status = 'active'
       WHERE lower(u.email) = $1 AND u.status = 'active'
       ORDER BY CASE om.role WHEN 'superadmin' THEN 0 WHEN 'client_manager' THEN 1 ELSE 2 END
       LIMIT 1`,
      [email],
    );
    const user = result.rows[0];
    const valid = user ? await compare(password, user.password_hash) : await compare(password, "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy");
    if (!user || !valid) {
      return NextResponse.json({ error: "Credenciais inválidas." }, { status: 401 });
    }

    await createSession({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      organisationId: user.organisation_id,
      role: user.role,
    });
    return NextResponse.json({ user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role } });
  } catch (error) {
    console.error("Falha no início de sessão:", error);
    return NextResponse.json({ error: "Não foi possível iniciar sessão. Verifique a configuração do servidor." }, { status: 500 });
  }
}
