import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const COOKIE_NAME = "contaexpress_session";
const SESSION_SECONDS = 60 * 60 * 8;

function sessionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET deve ter pelo menos 32 caracteres.");
  }
  return new TextEncoder().encode(secret);
}

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  organisationId: string;
  role: string;
};

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({
    email: user.email,
    fullName: user.fullName,
    organisationId: user.organisationId,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(sessionKey());

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const token = (await cookies()).get(COOKIE_NAME)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, sessionKey(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.email !== "string" || typeof payload.fullName !== "string" || typeof payload.organisationId !== "string" || typeof payload.role !== "string") return null;
    const result = await db.query(
      `SELECT u.id, u.email, u.full_name, om.organisation_id, om.role
       FROM app_users u
       JOIN organisation_memberships om ON om.user_id = u.id
       JOIN organisations o ON o.id = om.organisation_id AND o.status = 'active'
       WHERE u.id = $1 AND u.status = 'active'
         AND om.organisation_id = $2 AND om.role = $3
       LIMIT 1`,
      [payload.sub, payload.organisationId, payload.role],
    );
    const current = result.rows[0];
    if (!current) return null;
    return { id: current.id, email: current.email, fullName: current.full_name, organisationId: current.organisation_id, role: current.role };
  } catch {
    return null;
  }
}

export async function requireSession() {
  const user = await getSession();
  if (!user) return { user: null, response: NextResponse.json({ error: "Sessão inválida ou expirada. Inicie sessão novamente." }, { status: 401 }) };
  return { user, response: null };
}

export function canManageCompanies(role: string) {
  return ["superadmin", "client_manager"].includes(role);
}

export async function writeAudit(input: {
  organisationId: string;
  actorUserId: string;
  eventType: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, unknown>;
}) {
  await db.query(
    `INSERT INTO audit_events (organisation_id, actor_user_id, event_type, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [input.organisationId, input.actorUserId, input.eventType, input.targetType, input.targetId ?? null, JSON.stringify(input.details ?? {})],
  );
}
