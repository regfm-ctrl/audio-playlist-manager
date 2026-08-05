import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';
import { getNextSting } from '@/lib/stings';

// Used when the manual playlist editor adds the first real item to a break
// that had no sponsor content (and therefore no intro/outro) at all. Picks
// the next sting in rotation for each, same as the automated scheduler does.
export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  let { accessToken } = body;
  if (!accessToken) accessToken = await getValidAccessToken();

  if (!accessToken) {
    return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });
  }

  const [introPath, outroPath] = await Promise.all([
    getNextSting('intro', accessToken),
    getNextSting('outro', accessToken),
  ]);

  return NextResponse.json({ introPath, outroPath });
}
