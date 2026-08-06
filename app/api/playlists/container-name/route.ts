import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getStoredContainerName, storeContainerName } from '@/lib/playlist-names';

async function getUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const containerName = await getStoredContainerName(id);
  return NextResponse.json({ containerName });
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, containerName } = await req.json();
  if (!id || !containerName) return NextResponse.json({ error: 'Missing id or containerName' }, { status: 400 });

  await storeContainerName(id, containerName);
  return NextResponse.json({ ok: true });
}
