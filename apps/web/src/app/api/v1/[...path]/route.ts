/**
 * Point d'entrée API REST v1 (catch-all) → routeur interne (auth, RBAC, validation, audit…).
 * Runtime nodejs obligatoire : fs (locales/themes), drivers BD, crypto, puppeteer.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { handleApi } from '@/server/http/router';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let bootPromise: Promise<void> | null = null;
function ensureBoot(): Promise<void> {
  if (!bootPromise) {
    bootPromise = import('@/server/boot').then((m) => m.boot());
  }
  return bootPromise;
}

async function go(req: NextRequest, params: { path?: string[] }): Promise<NextResponse> {
  await ensureBoot();
  const path = (params.path ?? []).join('/');
  return handleApi(req, path);
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return go(req, await ctx.params);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return go(req, await ctx.params);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return go(req, await ctx.params);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return go(req, await ctx.params);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return go(req, await ctx.params);
}
