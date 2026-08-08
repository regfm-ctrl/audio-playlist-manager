import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { findCategoryConflicts } from '@/lib/category-conflicts';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const conflicts = await findCategoryConflicts();
  return NextResponse.json({ conflicts });
}
